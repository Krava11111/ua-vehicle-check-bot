import type { CompactVehicle, IndexManifest, VehicleMatch } from "./types.js";

const MANIFEST_TTL_MS = 5 * 60 * 1000;
const ZIP_DIRECTORY_TTL_MS = 10 * 60 * 1000;
const ZIP_TAIL_BYTES = 65_557;
const MAX_DIRECTORY_BYTES = 128 * 1024;
const MAX_SHARD_BYTES = 12 * 1024 * 1024;

interface ZipEntry {
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

interface ZipDirectory {
  entries: Map<string, ZipEntry>;
}

let cachedManifest: { url: string; expiresAt: number; value: IndexManifest } | null = null;
const zipDirectoryCache = new Map<string, { expiresAt: number; value: ZipDirectory }>();

export async function sha256Prefix(value: string, length: number): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

export async function loadManifest(url: string, fetcher: typeof fetch = fetch): Promise<IndexManifest> {
  const now = Date.now();
  if (cachedManifest?.url === url && cachedManifest.expiresAt > now) return cachedManifest.value;
  const separator = url.includes("?") ? "&" : "?";
  const response = await fetcher(`${url}${separator}refresh=${Math.floor(now / MANIFEST_TTL_MS)}`, {
    redirect: "follow",
    headers: { Accept: "application/json", "User-Agent": "ua-vehicle-check-worker/1.0" },
  });
  if (!response.ok) throw new Error(`Manifest request failed: ${response.status}`);
  const manifest = (await response.json()) as IndexManifest;
  if (manifest.schema_version !== 2 || !manifest.archive_url_template || manifest.shard_prefix_length < 1) {
    throw new Error("Unsupported vehicle index manifest");
  }
  cachedManifest = { url, expiresAt: now + MANIFEST_TTL_MS, value: manifest };
  return manifest;
}

export function archiveUrl(manifest: IndexManifest, shard: string): string {
  return manifest.archive_url_template
    .replace("{version}", encodeURIComponent(manifest.version))
    .replaceAll("{group}", shard[0] ?? "0");
}

export function memberName(kind: "plates" | "vehicles", shard: string): string {
  return `${kind}-${shard}.json.gz`;
}

async function fetchRange(
  url: string,
  range: string,
  fetcher: typeof fetch,
): Promise<{ bytes: ArrayBuffer; start: number; total: number } | null> {
  const response = await fetcher(url, {
    redirect: "follow",
    headers: { Range: range, "User-Agent": "ua-vehicle-check-worker/1.0" },
  });
  if (response.status === 404) return null;
  if (response.status !== 206) {
    await response.body?.cancel();
    throw new Error(`GitHub did not honor an index range request: ${response.status}`);
  }
  const contentRange = response.headers.get("content-range") ?? "";
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange);
  if (!match) throw new Error("Invalid Content-Range from GitHub");
  const bytes = await response.arrayBuffer();
  return { bytes, start: Number(match[1]), total: Number(match[3]) };
}

function findEndOfCentralDirectory(bytes: ArrayBuffer): number {
  const view = new DataView(bytes);
  for (let offset = view.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error("ZIP end-of-central-directory record was not found");
}

function parseCentralDirectory(bytes: ArrayBuffer): ZipDirectory {
  const view = new DataView(bytes);
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  let offset = 0;
  while (offset + 46 <= view.byteLength) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > view.byteLength) throw new Error("Truncated ZIP central directory");
    const name = decoder.decode(new Uint8Array(bytes, offset + 46, nameLength));
    entries.set(name, {
      method: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      uncompressedSize: view.getUint32(offset + 24, true),
      localHeaderOffset: view.getUint32(offset + 42, true),
    });
    offset = next;
  }
  if (entries.size === 0) throw new Error("ZIP central directory is empty");
  return { entries };
}

async function loadZipDirectory(url: string, fetcher: typeof fetch): Promise<ZipDirectory | null> {
  const now = Date.now();
  const cached = zipDirectoryCache.get(url);
  if (cached && cached.expiresAt > now) return cached.value;

  // GitHub's release CDN supports explicit ranges but can reject suffix ranges with 501.
  const probe = await fetchRange(url, "bytes=0-0", fetcher);
  if (!probe) return null;
  const tailStart = Math.max(0, probe.total - ZIP_TAIL_BYTES);
  const tail = probe.total === 1
    ? probe
    : await fetchRange(url, `bytes=${tailStart}-${probe.total - 1}`, fetcher);
  if (!tail) return null;
  const eocdOffset = findEndOfCentralDirectory(tail.bytes);
  const eocd = new DataView(tail.bytes, eocdOffset);
  const directorySize = eocd.getUint32(12, true);
  const directoryOffset = eocd.getUint32(16, true);
  if (directorySize <= 0 || directorySize > MAX_DIRECTORY_BYTES) {
    throw new Error("ZIP directory is outside the supported size limit");
  }

  const relativeStart = directoryOffset - tail.start;
  let directoryBytes: ArrayBuffer;
  if (relativeStart >= 0 && relativeStart + directorySize <= tail.bytes.byteLength) {
    directoryBytes = tail.bytes.slice(relativeStart, relativeStart + directorySize);
  } else {
    const directory = await fetchRange(
      url,
      `bytes=${directoryOffset}-${directoryOffset + directorySize - 1}`,
      fetcher,
    );
    if (!directory) return null;
    directoryBytes = directory.bytes;
  }
  const parsed = parseCentralDirectory(directoryBytes);
  zipDirectoryCache.set(url, { expiresAt: now + ZIP_DIRECTORY_TTL_MS, value: parsed });
  return parsed;
}

async function loadStoredZipMember(
  url: string,
  name: string,
  fetcher: typeof fetch,
): Promise<ArrayBuffer | null> {
  const directory = await loadZipDirectory(url, fetcher);
  const entry = directory?.entries.get(name);
  if (!entry) return null;
  if (entry.method !== 0) throw new Error("Index ZIP members must use the stored method");
  if (entry.compressedSize > MAX_SHARD_BYTES || entry.uncompressedSize > MAX_SHARD_BYTES) {
    throw new Error("Index shard is too large");
  }

  const header = await fetchRange(
    url,
    `bytes=${entry.localHeaderOffset}-${entry.localHeaderOffset + 29}`,
    fetcher,
  );
  if (!header) return null;
  const view = new DataView(header.bytes);
  if (view.byteLength !== 30 || view.getUint32(0, true) !== 0x04034b50) {
    throw new Error("Invalid ZIP local file header");
  }
  const dataOffset = entry.localHeaderOffset + 30 + view.getUint16(26, true) + view.getUint16(28, true);
  const member = await fetchRange(
    url,
    `bytes=${dataOffset}-${dataOffset + entry.compressedSize - 1}`,
    fetcher,
  );
  return member?.bytes ?? null;
}

async function loadShardJson<T>(
  manifest: IndexManifest,
  kind: "plates" | "vehicles",
  shard: string,
  fetcher: typeof fetch,
): Promise<T | null> {
  const compressed = await loadStoredZipMember(
    archiveUrl(manifest, shard),
    memberName(kind, shard),
    fetcher,
  );
  if (!compressed) return null;
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text()) as T;
}

async function loadVehicle(
  key: string,
  manifest: IndexManifest,
  fetcher: typeof fetch,
): Promise<CompactVehicle | null> {
  const shard = await sha256Prefix(key, manifest.shard_prefix_length);
  const vehicles = await loadShardJson<Record<string, CompactVehicle>>(
    manifest,
    "vehicles",
    shard,
    fetcher,
  );
  return vehicles?.[key] ?? null;
}

export async function findVehicles(
  kind: "PLATE" | "VIN",
  normalized: string,
  manifest: IndexManifest,
  maxCandidates: number,
  fetcher: typeof fetch = fetch,
): Promise<VehicleMatch[]> {
  let keys: string[];
  if (kind === "VIN") {
    keys = [normalized];
  } else {
    const shard = await sha256Prefix(normalized, manifest.shard_prefix_length);
    const plates = await loadShardJson<Record<string, string[]>>(manifest, "plates", shard, fetcher);
    keys = plates?.[normalized] ?? [];
  }
  const limited = keys.slice(0, Math.max(1, maxCandidates));
  const vehicles = await Promise.all(limited.map((key) => loadVehicle(key, manifest, fetcher)));
  return vehicles.flatMap((vehicle, index) => {
    const key = limited[index];
    return vehicle && key ? [{ key, vehicle, matchedBy: kind, candidates: keys.length }] : [];
  });
}

export function clearCachesForTests(): void {
  cachedManifest = null;
  zipDirectoryCache.clear();
}
