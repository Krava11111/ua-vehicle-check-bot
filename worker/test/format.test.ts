import assert from "node:assert/strict";
import test from "node:test";

import { archiveUrl, memberName } from "../src/index-client.js";
import { renderVehicle } from "../src/format.js";
import type { IndexManifest, VehicleMatch } from "../src/types.js";

const manifest: IndexManifest = {
  schema_version: 2,
  version: "20260819-abc",
  generated_at: "2026-08-19T12:00:00Z",
  dataset_updated_at: "2026-08-19T09:42:00Z",
  source_fingerprint: "abc",
  source_label: "МВС України / data.gov.ua",
  source_url: "https://data.gov.ua/example",
  repository: "owner/repo",
  shard_prefix_length: 3,
  max_events_per_vehicle: 50,
  archive_url_template: "https://github.com/owner/repo/releases/download/vehicle-data-{version}-{group}/index-{group}.zip",
  counts: { vehicles: 1, plates: 1, events: 1 },
};

test("builds grouped release archive URL and member name", () => {
  assert.equal(
    archiveUrl(manifest, "abc"),
    "https://github.com/owner/repo/releases/download/vehicle-data-20260819-abc-a/index-a.zip",
  );
  assert.equal(memberName("vehicles", "abc"), "vehicles-abc.json.gz");
});

test("renders compact vehicle", () => {
  const match: VehicleMatch = {
    key: "WVWZZZ3CZHE123456",
    matchedBy: "VIN",
    candidates: 1,
    vehicle: {
      v: "WVWZZZ3CZHE123456", p: "KA3333CC", b: "Volkswagen", m: "Passat", y: 2017,
      c: "Чорний", k: "Легковий", bt: "Універсал", pu: "Загальний", f: "Diesel",
      ec: 1968, ow: 1500, tw: 2100,
      e: [["2024-02-17", "410", "ЗАМІНА НОМЕРНОГО ЗНАКУ", "KA3333CC", "Київська область", "ТСЦ 8041"]],
    },
  };
  const rendered = renderVehicle(match, manifest, "uk");
  assert.match(rendered, /Volkswagen Passat/);
  assert.match(rendered, /KA3333CC/);
  assert.match(rendered, /17\.02\.2024/);
});
