import { importHistory } from "./history.js";
import type {
  AuctionImportRecord,
  Env,
  MarketplaceImportRecord,
} from "./types.js";

export type ProviderConnectionStatus = "connected" | "not_configured" | "unavailable";

export interface ProviderRefreshResult {
  autoRia: ProviderConnectionStatus;
  auctions: ProviderConnectionStatus;
  checkedAt: string;
}

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const REFRESH_CACHE_ORIGIN = "https://external-provider-refresh.invalid";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function number(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function boolean(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (value === 1 || value === "1" || value === "yes" || value === "true") return true;
    if (value === 0 || value === "0" || value === "no" || value === "false") return false;
  }
  return null;
}

function isoDate(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function normalizeVin(value: unknown): string | null {
  const normalized = text(value)?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
  return VIN_RE.test(normalized) ? normalized : null;
}

function cacheApi(): Cache | null {
  const storage = globalThis.caches as CacheStorage & { default?: Cache };
  return storage?.default ?? null;
}

function cacheRequest(vin: string, env: Env): Request {
  const configuration = `${env.AUTO_RIA_API_KEY ? "r1" : "r0"}-${env.AUCTION_API_KEY ? "a1" : "a0"}`;
  return new Request(`${REFRESH_CACHE_ORIGIN}/vin/${vin}/${configuration}`);
}

async function jsonResponse(response: Response, provider: string): Promise<unknown> {
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${provider}_http_${response.status}`);
  return response.json();
}

function autoRiaIds(payload: unknown): string[] {
  const root = record(payload);
  const result = record(root.result);
  const searchResult = record(result.search_result ?? root.search_result);
  return array(searchResult.ids ?? result.ids ?? root.ids)
    .map((value) => text(value))
    .filter((value): value is string => Boolean(value))
    .slice(0, 10);
}

function autoRiaListing(payload: unknown, expectedVin: string): MarketplaceImportRecord | null {
  const root = record(payload);
  const data = record(root.data ?? root.result ?? root);
  const autoData = record(data.autoData ?? data.auto_data);
  const location = record(data.locationCityName ?? data.location);
  const vin = normalizeVin(data.VIN ?? data.vin ?? autoData.VIN ?? autoData.vin);
  if (vin !== expectedVin) return null;
  const externalId = text(data.autoId, data.auto_id, data.id);
  if (!externalId) return null;
  const price = number(data.USD, data.price, record(data.price)?.value);
  const exactMileage = number(data.mileage, data.race);
  const raceThousands = number(data.raceInt);
  const mileage = exactMileage ?? (raceThousands === null ? null : raceThousands * 1_000);
  return {
    provider: "AUTO.RIA",
    externalId,
    vin,
    url: text(data.linkToView, data.url) ?? `https://auto.ria.com/uk/auto_${externalId}.html`,
    title: text(data.title, data.titleHead),
    brand: text(autoData.markName, data.markName, data.brand),
    model: text(autoData.modelName, data.modelName, data.model),
    year: number(autoData.year, data.year),
    price,
    currency: price === null ? null : "USD",
    mileage,
    mileageUnit: mileage === null ? null : "km",
    city: text(data.locationCityName, location.name, data.city),
    region: text(data.stateDataName, data.region),
    sellerType: text(data.userType, data.sellerType),
    observedAt: isoDate(data.updateDate, data.addDate, data.created_at),
    isActive: true,
  };
}

async function fetchAutoRia(vin: string, env: Env): Promise<MarketplaceImportRecord[]> {
  const apiKey = env.AUTO_RIA_API_KEY;
  if (!apiKey) return [];
  const search = new URL(env.AUTO_RIA_SEARCH_URL ?? "https://developers.ria.com/auto/search");
  search.searchParams.set("api_key", apiKey);
  search.searchParams.set("vin", vin);
  search.searchParams.set("search_by_parameters[vin]", vin);
  search.searchParams.set("countpage", "10");
  const searchPayload = await jsonResponse(await fetch(search, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  }), "auto_ria_search");
  const infoUrl = env.AUTO_RIA_INFO_URL ?? "https://developers.ria.com/auto/info";
  const results = await Promise.all(autoRiaIds(searchPayload).map(async (id) => {
    const url = new URL(infoUrl);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("auto_id", id);
    const payload = await jsonResponse(await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    }), "auto_ria_info");
    return autoRiaListing(payload, vin);
  }));
  return results.filter((listing): listing is MarketplaceImportRecord => listing !== null);
}

function nested(root: Record<string, unknown>, key: string): Record<string, unknown> {
  return record(root[key]);
}

function auctionRecords(payload: unknown): Record<string, unknown>[] {
  const root = record(payload);
  const data = root.data;
  const dataRecord = record(data);
  const candidates = [
    dataRecord.history,
    root.history,
    data,
    root.results,
    root.items,
  ];
  for (const candidate of candidates) {
    const values = array(candidate).map(record).filter((item) => Object.keys(item).length);
    if (values.length) return values;
  }
  return Object.keys(dataRecord).length ? [dataRecord] : [];
}

function photoUrls(item: Record<string, unknown>): string[] {
  const media = nested(item, "media");
  const candidates = [item.photos, item.photo_urls, media.photos, media.images];
  for (const candidate of candidates) {
    const urls = array(candidate)
      .map((value) => typeof value === "string" ? value : text(record(value).url, record(value).src))
      .filter((value): value is string => Boolean(value));
    if (urls.length) return urls.slice(0, 24);
  }
  return [];
}

async function shortHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].slice(0, 12)
    .map((part) => part.toString(16).padStart(2, "0")).join("");
}

async function auctionRecord(
  item: Record<string, unknown>,
  vin: string,
): Promise<AuctionImportRecord> {
  const auction = nested(item, "auction");
  const pricing = nested(item, "pricing");
  const condition = nested(item, "condition");
  const odometer = nested(item, "odometer");
  const location = nested(item, "location");
  const specs = nested(item, "vehicle_specs");
  const saleDocument = nested(item, "sale_document");
  const platform = text(item.platform, item.auction_name, auction.platform) ?? "US auction";
  const lot = text(item.lot_number, item.lot, item.platform_id, item.id);
  const externalId = lot
    ? `${platform}:${lot}`
    : `${platform}:${await shortHash(JSON.stringify(item))}`;
  const mileage = number(odometer.value, odometer.miles, item.odometer, item.mileage);
  const mileageUnit = text(odometer.unit, item.odometer_unit, item.mileage_unit)
    ?? (odometer.miles !== undefined ? "mi" : null);
  return {
    provider: "auction-api",
    externalId,
    vin,
    auctionName: platform,
    lotNumber: lot,
    auctionDate: isoDate(auction.sale_date, auction.date, item.sale_date, item.auction_date, item.date),
    location: text(location.name, location.city, item.location, item.facility),
    sellerType: text(nested(item, "seller").type, item.seller_type),
    saleStatus: text(auction.sale_status, auction.status, item.sale_status, item.status),
    finalBid: number(pricing.last_sold_price, pricing.final_bid, item.final_bid, item.sale_price),
    currency: text(pricing.currency, item.currency) ?? "USD",
    estimatedRetailValue: number(pricing.estimated_retail_value, item.estimated_retail_value),
    repairCost: number(condition.repair_cost, item.repair_cost),
    primaryDamage: text(condition.primary_damage, item.primary_damage, item.damage),
    secondaryDamage: text(condition.secondary_damage, item.secondary_damage),
    odometer: mileage,
    odometerUnit: mileageUnit,
    odometerStatus: text(odometer.status, item.odometer_status),
    titleType: text(saleDocument.name, saleDocument.type, item.title_type, item.title_code),
    keysAvailable: boolean(condition.keys_available, item.keys_available),
    runAndDrive: boolean(condition.run_and_drive, item.run_and_drive),
    engineStarts: boolean(condition.engine_starts, item.engine_starts),
    sourceUrl: text(item.url, item.source_url, item.lot_url),
    brand: text(item.make, item.brand),
    model: text(item.model),
    year: number(item.year),
    color: text(specs.color, item.color),
    engineCapacity: number(specs.engine_capacity, item.engine_capacity),
    photoUrls: photoUrls(item),
  };
}

async function fetchAuctions(vin: string, env: Env): Promise<AuctionImportRecord[]> {
  if (!env.AUCTION_API_KEY) return [];
  const base = (env.AUCTION_API_BASE_URL ?? "https://apibara.tech/api/v1/vehicle-auction").replace(/\/$/, "");
  const response = await fetch(`${base}/vehicles/${encodeURIComponent(vin)}/history?per_page=20`, {
    headers: { Accept: "application/json", "X-API-Key": env.AUCTION_API_KEY },
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await jsonResponse(response, "auction_api");
  return Promise.all(auctionRecords(payload).map((item) => auctionRecord(item, vin)));
}

export async function refreshExternalProviders(vinValue: string, env: Env): Promise<ProviderRefreshResult> {
  const vin = normalizeVin(vinValue);
  if (!vin) throw new Error("invalid_vin");
  const cache = cacheApi();
  const request = cacheRequest(vin, env);
  if (cache) {
    const cached = await cache.match(request);
    if (cached) return cached.json() as Promise<ProviderRefreshResult>;
  }
  const status: ProviderRefreshResult = {
    autoRia: env.AUTO_RIA_API_KEY ? "connected" : "not_configured",
    auctions: env.AUCTION_API_KEY ? "connected" : "not_configured",
    checkedAt: new Date().toISOString(),
  };
  const payload: { marketplace: MarketplaceImportRecord[]; auctions: AuctionImportRecord[] } = {
    marketplace: [],
    auctions: [],
  };
  const [marketplaceResult, auctionResult] = await Promise.allSettled([
    env.AUTO_RIA_API_KEY ? fetchAutoRia(vin, env) : Promise.resolve([]),
    env.AUCTION_API_KEY ? fetchAuctions(vin, env) : Promise.resolve([]),
  ]);
  if (marketplaceResult.status === "fulfilled") payload.marketplace = marketplaceResult.value;
  else {
    status.autoRia = "unavailable";
    console.error("auto_ria_refresh_failed", marketplaceResult.reason instanceof Error ? marketplaceResult.reason.message : String(marketplaceResult.reason));
  }
  if (auctionResult.status === "fulfilled") payload.auctions = auctionResult.value;
  else {
    status.auctions = "unavailable";
    console.error("auction_refresh_failed", auctionResult.reason instanceof Error ? auctionResult.reason.message : String(auctionResult.reason));
  }
  if (env.HISTORY_DB && (payload.marketplace.length || payload.auctions.length)) {
    await importHistory(payload, env);
  }
  if (cache) {
    const ttl = Math.max(300, Number(env.HISTORY_CACHE_TTL ?? "21600"));
    await cache.put(request, Response.json(status, {
      headers: { "Cache-Control": `public, max-age=${ttl}` },
    }));
  }
  return status;
}
