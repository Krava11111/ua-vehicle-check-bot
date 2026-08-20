import assert from "node:assert/strict";
import test from "node:test";

import { checkWanted, clearCachesForTests, findPlateHistory, findVehicles, sha256Prefix } from "../src/index-client.js";
import type { CompactPlateAssignment, CompactVehicle, IndexManifest, WantedRecord } from "../src/types.js";

function storedZip(name: string, payload: Uint8Array): Uint8Array {
  const encodedName = new TextEncoder().encode(name);
  const localSize = 30 + encodedName.length + payload.length;
  const centralSize = 46 + encodedName.length;
  const result = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(result.buffer);

  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint32(18, payload.length, true);
  view.setUint32(22, payload.length, true);
  view.setUint16(26, encodedName.length, true);
  result.set(encodedName, 30);
  result.set(payload, 30 + encodedName.length);

  const central = localSize;
  view.setUint32(central, 0x02014b50, true);
  view.setUint16(central + 4, 20, true);
  view.setUint16(central + 6, 20, true);
  view.setUint32(central + 20, payload.length, true);
  view.setUint32(central + 24, payload.length, true);
  view.setUint16(central + 28, encodedName.length, true);
  result.set(encodedName, central + 46);

  const end = central + centralSize;
  view.setUint32(end, 0x06054b50, true);
  view.setUint16(end + 8, 1, true);
  view.setUint16(end + 10, 1, true);
  view.setUint32(end + 12, centralSize, true);
  view.setUint32(end + 16, central, true);
  return result;
}

test("range-reads and decompresses one vehicle ZIP member", async () => {
  clearCachesForTests();
  const vin = "WVWZZZ3CZHE123456";
  const shard = await sha256Prefix(vin, 3);
  const vehicle: CompactVehicle = {
    v: vin, p: "KA3333CC", b: "Volkswagen", m: "Passat", y: 2017, c: null,
    k: null, bt: null, pu: null, f: null, ec: null, ow: null, tw: null, e: [],
  };
  const gzipStream = new Blob([JSON.stringify({ [vin]: vehicle })])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const gzip = new Uint8Array(await new Response(gzipStream).arrayBuffer());
  const zip = storedZip(`vehicles-${shard}.json.gz`, gzip);

  const fetcher: typeof fetch = async (_input, init) => {
    const range = new Headers(init?.headers).get("range") ?? "";
    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (!match) return new Response("range required", { status: 400 });
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), zip.length - 1);
    return new Response(zip.slice(start, end + 1), {
      status: 206,
      headers: { "Content-Range": `bytes ${start}-${end}/${zip.length}` },
    });
  };
  const manifest: IndexManifest = {
    schema_version: 2,
    version: "fixture",
    generated_at: "2026-08-20T00:00:00Z",
    source_fingerprint: "fixture",
    source_label: "fixture",
    source_url: "https://example.com",
    repository: "owner/repo",
    shard_prefix_length: 3,
    max_events_per_vehicle: 50,
    archive_url_template: "https://example.com/index-{group}.zip",
    counts: { vehicles: 1, plates: 1, events: 0 },
  };

  const matches = await findVehicles("VIN", vin, manifest, 3, fetcher);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.vehicle.p, "KA3333CC");
});

test("range-reads wanted records by VIN", async () => {
  clearCachesForTests();
  const vin = "WVWZZZ3CZHE123456";
  const shard = await sha256Prefix(vin, 3);
  const record: WantedRecord = [
    "wanted-1", "KA3333CC", vin, null, "VOLKSWAGEN", "PASSAT", "ЧОРНИЙ",
    "2026-08-18", "2026-08-18", "Легковий автотранспорт",
  ];
  const gzipStream = new Blob([JSON.stringify({ [vin]: [record] })])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const gzip = new Uint8Array(await new Response(gzipStream).arrayBuffer());
  const zip = storedZip(`wanted-${shard}.json.gz`, gzip);
  const fetcher: typeof fetch = async (_input, init) => {
    const range = new Headers(init?.headers).get("range") ?? "";
    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (!match) return new Response("range required", { status: 400 });
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), zip.length - 1);
    return new Response(zip.slice(start, end + 1), {
      status: 206,
      headers: { "Content-Range": `bytes ${start}-${end}/${zip.length}` },
    });
  };
  const manifest: IndexManifest = {
    schema_version: 3,
    version: "fixture",
    generated_at: "2026-08-20T00:00:00Z",
    source_fingerprint: "fixture",
    source_label: "fixture",
    source_url: "https://example.com",
    repository: "owner/repo",
    shard_prefix_length: 3,
    max_events_per_vehicle: 50,
    archive_url_template: "https://example.com/index-{group}.zip",
    counts: { vehicles: 1, plates: 1, events: 0 },
    wanted: {
      schema_version: 1,
      version: "wanted-fixture",
      generated_at: "2026-08-20T00:00:00Z",
      dataset_updated_at: "2026-08-20T07:15:11Z",
      source_fingerprint: "wanted",
      source_label: "police",
      source_url: "https://data.gov.ua/wanted",
      shard_prefix_length: 3,
      archive_url_template: "https://example.com/wanted-{group}.zip",
      counts: { identifiers: 1 },
    },
  };

  const result = await checkWanted([vin], manifest, fetcher);
  assert.equal(result.status, "match");
  assert.equal(result.matches[0]?.[0], "wanted-1");
});

test("range-reads a schema 4 plate-history shard", async () => {
  clearCachesForTests();
  const plate = "AA1234BB";
  const shard = await sha256Prefix(plate, 3);
  const assignments: CompactPlateAssignment[] = [
    ["vin-1", "WVWZZZ3CZHE123456", "Volkswagen", "Passat", 2017, "Чорний", "Легковий", "2021-05-01", "2024-01-10", 3, "HIGH"],
    ["vin-2", "TMBJG7NE0J0123456", "Skoda", "Octavia", 2018, "Сірий", "Легковий", "2024-01-12", "2024-01-12", 1, "LOW"],
  ];
  const gzipStream = new Blob([JSON.stringify({ [plate]: assignments })])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const gzip = new Uint8Array(await new Response(gzipStream).arrayBuffer());
  const zip = storedZip(`plate-history-${shard}.json.gz`, gzip);
  const fetcher: typeof fetch = async (_input, init) => {
    const range = new Headers(init?.headers).get("range") ?? "";
    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (!match) return new Response("range required", { status: 400 });
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), zip.length - 1);
    return new Response(zip.slice(start, end + 1), {
      status: 206,
      headers: { "Content-Range": `bytes ${start}-${end}/${zip.length}` },
    });
  };
  const manifest: IndexManifest = {
    schema_version: 4,
    version: "plate-history-fixture",
    generated_at: "2026-08-20T00:00:00Z",
    source_fingerprint: "fixture",
    source_label: "fixture",
    source_url: "https://example.com",
    repository: "owner/repo",
    shard_prefix_length: 3,
    max_events_per_vehicle: 50,
    history_start_year: 2013,
    plate_history_available: true,
    archive_url_template: "https://example.com/index-{group}.zip",
    counts: { vehicles: 2, plates: 1, events: 4, plate_assignments: 2 },
  };

  const result = await findPlateHistory(plate, manifest, 20, fetcher);
  assert.equal(result.assignments.length, 2);
  assert.equal(result.assignments[1]?.[1], "TMBJG7NE0J0123456");
  assert.equal(result.totalAssignments, 2);
  assert.equal(result.source, "plate-history");
});
