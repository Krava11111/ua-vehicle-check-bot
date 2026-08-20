import type { VehicleReportData } from "./types.js";

const REPORT_TTL_MS = 24 * 60 * 60 * 1000;
const memory = new Map<string, { expiresAt: number; value: VehicleReportData }>();
const CACHE_ORIGIN = "https://starcar-report-state.invalid/";

function cacheRequest(reference: string): Request {
  return new Request(`${CACHE_ORIGIN}${encodeURIComponent(reference)}`);
}

function defaultCache(): Cache | null {
  if (typeof caches === "undefined") return null;
  return (caches as unknown as { default?: Cache }).default ?? null;
}

export async function putReport(data: VehicleReportData): Promise<void> {
  memory.set(data.reference, { expiresAt: Date.now() + REPORT_TTL_MS, value: data });
  const cache = defaultCache();
  if (!cache) return;
  try {
    await cache.put(cacheRequest(data.reference), new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${Math.floor(REPORT_TTL_MS / 1000)}`,
      },
    }));
  } catch (error) {
    console.error("report_cache_put_failed", error instanceof Error ? error.message : String(error));
  }
}

export async function getReport(reference: string): Promise<VehicleReportData | null> {
  const cached = memory.get(reference);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  memory.delete(reference);
  const cache = defaultCache();
  if (!cache) return null;
  try {
    const response = await cache.match(cacheRequest(reference));
    if (!response) return null;
    const value = await response.json() as VehicleReportData;
    memory.set(reference, { expiresAt: Date.now() + REPORT_TTL_MS, value });
    return value;
  } catch (error) {
    console.error("report_cache_get_failed", error instanceof Error ? error.message : String(error));
    return null;
  }
}

export function clearReportCacheForTests(): void {
  memory.clear();
}
