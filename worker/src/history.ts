import type {
  AuctionHistoryEvent,
  AuctionImportRecord,
  CrossSourceWarning,
  D1DatabaseLike,
  Env,
  ExternalVehicleHistory,
  HistoryImportPayload,
  MarketplaceImportRecord,
  MarketplaceListingHistory,
  MarketplaceSnapshot,
  MileagePoint,
  OdometerWarning,
  TimelineEvent,
  VehicleMatch,
  WarningSeverity,
} from "./types.js";

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const MILES_TO_KM = 1.609344;
const HISTORY_CACHE_ORIGIN = "https://vehicle-history-cache.invalid";

interface MarketplaceRow {
  id: number;
  provider: string;
  external_id: string;
  vin: string;
  normalized_vin: string;
  url: string | null;
  title: string | null;
  brand: string | null;
  normalized_brand: string | null;
  model: string | null;
  normalized_model: string | null;
  year: number | null;
  city: string | null;
  region: string | null;
  first_seen_at: string;
  last_seen_at: string;
  removed_at: string | null;
  is_active: number;
}

interface SnapshotRow {
  listing_id: number;
  observed_at: string;
  price: number | null;
  currency: string | null;
  mileage: number | null;
  mileage_unit: string | null;
  normalized_mileage_km: number | null;
  description_hash: string | null;
  is_active: number;
}

interface AuctionRow {
  id: number;
  provider: string;
  external_id: string;
  vin: string;
  auction_name: string | null;
  lot_number: string | null;
  auction_date: string | null;
  location: string | null;
  sale_status: string | null;
  final_bid: number | null;
  currency: string | null;
  estimated_retail_value: number | null;
  repair_cost: number | null;
  primary_damage: string | null;
  secondary_damage: string | null;
  odometer: number | null;
  odometer_unit: string | null;
  normalized_odometer_km: number | null;
  odometer_status: string | null;
  title_type: string | null;
  keys_available: number | null;
  run_and_drive: number | null;
  engine_starts: number | null;
  source_url: string | null;
  brand: string | null;
  normalized_brand: string | null;
  model: string | null;
  normalized_model: string | null;
  year: number | null;
  color: string | null;
  engine_capacity: number | null;
}

interface PhotoRow {
  auction_event_id: number;
  source_url: string;
}

interface MileageRow {
  observed_at: string;
  original_mileage: number;
  original_unit: string;
  normalized_mileage_km: number;
  source: string;
  source_reference: string | null;
  source_url: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

interface ExistingListingRow {
  id: number;
  price: number | null;
  currency: string | null;
  mileage: number | null;
  mileage_unit: string | null;
  description_hash: string | null;
  is_active: number;
}

interface ExistingAuctionRow {
  id: number;
}

export interface HistoryProvider {
  searchByVin(vin: string, match: VehicleMatch): Promise<ExternalVehicleHistory>;
}

function normalizeVin(value: string): string | null {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return VIN_RE.test(normalized) ? normalized : null;
}

function normalizeText(value: string | null | undefined): string | null {
  return value ? value.trim().replace(/\s+/g, " ").toUpperCase() : null;
}

function normalizeModel(value: string | null | undefined): string | null {
  return value ? value.toUpperCase().replace(/[^A-ZА-ЯІЇЄ0-9]/g, "") : null;
}

function normalizeCurrency(value: string | null | undefined): string | null {
  if (!value) return null;
  const symbols: Record<string, string> = { "$": "USD", "€": "EUR", "₴": "UAH" };
  return (symbols[value.trim()] ?? value.trim().toUpperCase()).slice(0, 3);
}

export function normalizeMileageKm(value: number | null | undefined, unit: string | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return null;
  const normalizedUnit = (unit ?? "km").trim().toLowerCase();
  if (["mi", "mile", "miles"].includes(normalizedUnit)) return Math.round(value * MILES_TO_KM);
  if (["km", "км", "kilometer", "kilometers"].includes(normalizedUnit)) return Math.round(value);
  return null;
}

function boolValue(value: number | null): boolean | null {
  return value === null ? null : value === 1;
}

function dateValue(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function severityForRollback(difference: number): WarningSeverity {
  if (difference >= 20_000) return "HIGH";
  if (difference >= 5_000) return "MEDIUM";
  return "LOW";
}

export function analyzeOdometer(points: MileagePoint[], toleranceKm: number): OdometerWarning[] {
  const ordered = [...points].sort((left, right) => dateValue(left.date) - dateValue(right.date));
  const warnings: OdometerWarning[] = [];
  let highest: MileagePoint | null = null;
  for (const point of ordered) {
    if (highest && highest.normalizedMileageKm - point.normalizedMileageKm > toleranceKm) {
      const differenceKm = highest.normalizedMileageKm - point.normalizedMileageKm;
      warnings.push({
        severity: severityForRollback(differenceKm),
        previous: highest,
        current: point,
        differenceKm,
      });
    }
    if (!highest || point.normalizedMileageKm > highest.normalizedMileageKm) highest = point;
  }
  return warnings;
}

function sourceValues(match: VehicleMatch, auctions: AuctionHistoryEvent[], marketplace: MarketplaceListingHistory[]): Record<string, Record<string, string>> {
  const values: Record<string, Record<string, string>> = {};
  const add = (field: string, source: string, value: unknown): void => {
    if (value === null || value === undefined || value === "") return;
    values[field] ??= {};
    values[field][source] = String(value);
  };
  add("brand", "МВС", match.vehicle.b);
  add("model", "МВС", match.vehicle.m);
  add("year", "МВС", match.vehicle.y);
  add("color", "МВС", match.vehicle.c);
  add("engineCapacity", "МВС", match.vehicle.ec);
  for (const event of auctions) {
    const source = event.auctionName ?? event.provider;
    add("brand", source, event.brand);
    add("model", source, event.model);
    add("year", source, event.year);
    add("color", source, event.color);
    add("engineCapacity", source, event.engineCapacity);
  }
  for (const listing of marketplace) {
    add("brand", listing.provider, listing.brand);
    add("model", listing.provider, listing.model);
    add("year", listing.provider, listing.year);
  }
  return values;
}

export function analyzeCrossSource(match: VehicleMatch, auctions: AuctionHistoryEvent[], marketplace: MarketplaceListingHistory[]): CrossSourceWarning[] {
  const labels: Record<string, string> = {
    brand: "марка",
    model: "модель",
    year: "рік",
    color: "колір",
    engineCapacity: "об’єм двигуна",
  };
  const warnings: CrossSourceWarning[] = [];
  for (const [field, sources] of Object.entries(sourceValues(match, auctions, marketplace))) {
    const normalized = new Set(
      Object.values(sources).map((value) => field === "model" ? normalizeModel(value) : ["brand", "color"].includes(field) ? normalizeText(value) : value),
    );
    if (normalized.size > 1) {
      warnings.push({
        field,
        message: `У різних джерелах вказано різний параметр «${labels[field] ?? field}».`,
        sources,
      });
    }
  }
  return warnings;
}

function buildTimeline(match: VehicleMatch, auctions: AuctionHistoryEvent[], marketplace: MarketplaceListingHistory[]): TimelineEvent[] {
  const timeline: TimelineEvent[] = [];
  for (const event of match.vehicle.e ?? []) {
    if (!event[0]) continue;
    timeline.push({
      date: event[0],
      type: "registration",
      source: "МВС",
      title: event[2] ?? event[1] ?? "Реєстраційна операція",
      description: event[4],
      mileageKm: null,
      price: null,
      currency: null,
      confidence: "HIGH",
    });
  }
  for (const event of auctions) {
    if (!event.auctionDate) continue;
    timeline.push({
      date: event.auctionDate,
      type: "auction",
      source: event.auctionName ?? event.provider,
      title: "Аукціонна подія",
      description: event.primaryDamage,
      mileageKm: event.normalizedOdometerKm,
      price: event.finalBid,
      currency: event.currency,
      confidence: "HIGH",
    });
  }
  for (const listing of marketplace) {
    for (const snapshot of listing.snapshots) {
      timeline.push({
        date: snapshot.observedAt,
        type: "marketplace",
        source: listing.provider,
        title: snapshot.isActive ? "Оголошення виявлено" : "Оголошення знято/більше не виявляється джерелом",
        description: listing.city,
        mileageKm: snapshot.normalizedMileageKm,
        price: snapshot.price,
        currency: snapshot.currency,
        confidence: "HIGH",
      });
    }
  }
  return timeline.sort((left, right) => dateValue(left.date) - dateValue(right.date));
}

function calculateScore(
  auctions: AuctionHistoryEvent[],
  odometer: OdometerWarning[],
  cross: CrossSourceWarning[],
  repeatedSalePeriods: number,
): { value: number; factors: string[] } {
  let value = 100;
  const factors = ["🟢 VIN використовується для об’єднання доступної історії"];
  if (auctions.length) {
    value -= 8;
    factors.push(`🟡 Аукціонних подій: ${auctions.length}`);
  }
  if (auctions.some((event) => event.primaryDamage || event.secondaryDamage)) {
    value -= 12;
    factors.push("🟠 Джерело аукціону вказує пошкодження");
  }
  for (const warning of odometer) value -= warning.severity === "HIGH" ? 25 : warning.severity === "MEDIUM" ? 12 : 5;
  if (odometer.length) factors.push("🔴 Виявлено можливу невідповідність показань пробігу");
  value -= Math.min(28, cross.length * 7);
  if (cross.length) factors.push("🟠 Є розбіжності характеристик між джерелами");
  if (repeatedSalePeriods > 1) {
    value -= 5;
    factors.push("🟡 Автомобіль повторно з’являвся в оголошеннях");
  }
  return { value: Math.max(0, Math.min(100, value)), factors };
}

async function recordUsage(db: D1DatabaseLike, cacheHit: boolean): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await db.prepare(
    `INSERT INTO provider_usage_daily(provider, date, cache_hits, cache_misses)
     VALUES('cloudflare-d1', ?, ?, ?)
     ON CONFLICT(provider, date) DO UPDATE SET
       cache_hits = cache_hits + excluded.cache_hits,
       cache_misses = cache_misses + excluded.cache_misses`,
  ).bind(today, cacheHit ? 1 : 0, cacheHit ? 0 : 1).run();
}

async function recordProviderImport(db: D1DatabaseLike, provider: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await db.prepare(
    `INSERT INTO provider_usage_daily(
       provider, date, requests_count, successful_requests
     ) VALUES(?, ?, 1, 1)
     ON CONFLICT(provider, date) DO UPDATE SET
       requests_count = requests_count + 1,
       successful_requests = successful_requests + 1`,
  ).bind(provider, today).run();
}

function cacheApi(): Cache | null {
  const storage = globalThis.caches as CacheStorage & { default?: Cache };
  return storage?.default ?? null;
}

function cacheRequest(vin: string): Request {
  return new Request(`${HISTORY_CACHE_ORIGIN}/vin/${vin}`);
}

export class D1HistoryProvider implements HistoryProvider {
  constructor(
    private readonly db: D1DatabaseLike,
    private readonly toleranceKm: number,
    private readonly scoreEnabled: boolean,
  ) {}

  async searchByVin(vin: string, match: VehicleMatch): Promise<ExternalVehicleHistory> {
    const [listingResult, snapshotResult, auctionResult, photoResult, mileageResult] = await Promise.all([
      this.db.prepare("SELECT * FROM marketplace_listings WHERE normalized_vin = ? ORDER BY first_seen_at").bind(vin).all<MarketplaceRow>(),
      this.db.prepare(
        `SELECT s.* FROM marketplace_listing_snapshots s
         JOIN marketplace_listings l ON l.id = s.listing_id
         WHERE l.normalized_vin = ? ORDER BY s.observed_at`,
      ).bind(vin).all<SnapshotRow>(),
      this.db.prepare("SELECT * FROM auction_events WHERE normalized_vin = ? ORDER BY auction_date").bind(vin).all<AuctionRow>(),
      this.db.prepare(
        `SELECT p.auction_event_id, p.source_url FROM auction_photos p
         JOIN auction_events a ON a.id = p.auction_event_id
         WHERE a.normalized_vin = ? ORDER BY p.position`,
      ).bind(vin).all<PhotoRow>(),
      this.db.prepare("SELECT * FROM mileage_records WHERE normalized_vin = ? ORDER BY observed_at").bind(vin).all<MileageRow>(),
    ]);
    const snapshots = new Map<number, MarketplaceSnapshot[]>();
    for (const row of snapshotResult.results ?? []) {
      const current = snapshots.get(row.listing_id) ?? [];
      current.push({
        observedAt: row.observed_at,
        price: row.price,
        currency: row.currency,
        mileage: row.mileage,
        mileageUnit: row.mileage_unit,
        normalizedMileageKm: row.normalized_mileage_km,
        descriptionHash: row.description_hash,
        isActive: row.is_active === 1,
      });
      snapshots.set(row.listing_id, current);
    }
    const marketplace: MarketplaceListingHistory[] = (listingResult.results ?? []).map((row) => ({
      provider: row.provider,
      externalId: row.external_id,
      vin: row.vin,
      url: row.url,
      title: row.title,
      brand: row.brand,
      normalizedBrand: row.normalized_brand,
      model: row.model,
      normalizedModel: row.normalized_model,
      year: row.year,
      city: row.city,
      region: row.region,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      removedAt: row.removed_at,
      isActive: row.is_active === 1,
      snapshots: snapshots.get(row.id) ?? [],
    }));
    const photos = new Map<number, string[]>();
    for (const row of photoResult.results ?? []) {
      const current = photos.get(row.auction_event_id) ?? [];
      current.push(row.source_url);
      photos.set(row.auction_event_id, current);
    }
    const auctions: AuctionHistoryEvent[] = (auctionResult.results ?? []).map((row) => ({
      provider: row.provider,
      externalId: row.external_id,
      vin: row.vin,
      auctionName: row.auction_name,
      lotNumber: row.lot_number,
      auctionDate: row.auction_date,
      location: row.location,
      saleStatus: row.sale_status,
      finalBid: row.final_bid,
      currency: row.currency,
      estimatedRetailValue: row.estimated_retail_value,
      repairCost: row.repair_cost,
      primaryDamage: row.primary_damage,
      secondaryDamage: row.secondary_damage,
      odometer: row.odometer,
      odometerUnit: row.odometer_unit,
      normalizedOdometerKm: row.normalized_odometer_km,
      odometerStatus: row.odometer_status,
      titleType: row.title_type,
      keysAvailable: boolValue(row.keys_available),
      runAndDrive: boolValue(row.run_and_drive),
      engineStarts: boolValue(row.engine_starts),
      sourceUrl: row.source_url,
      brand: row.brand,
      normalizedBrand: row.normalized_brand,
      model: row.model,
      normalizedModel: row.normalized_model,
      year: row.year,
      color: row.color,
      engineCapacity: row.engine_capacity,
      photos: photos.get(row.id) ?? [],
    }));
    const mileage: MileagePoint[] = (mileageResult.results ?? []).map((row) => ({
      date: row.observed_at,
      mileage: row.original_mileage,
      unit: row.original_unit,
      normalizedMileageKm: row.normalized_mileage_km,
      source: row.source,
      sourceReference: row.source_reference,
      sourceUrl: row.source_url,
      confidence: row.confidence,
    }));
    const odometerWarnings = analyzeOdometer(mileage, this.toleranceKm);
    const crossSourceWarnings = analyzeCrossSource(match, auctions, marketplace);
    const repeatedSalePeriods = new Set(marketplace.map((item) => `${item.provider}:${item.externalId}`)).size;
    const score = calculateScore(auctions, odometerWarnings, crossSourceWarnings, repeatedSalePeriods);
    return {
      vin,
      marketplace,
      auctions,
      mileage,
      odometerWarnings,
      crossSourceWarnings,
      timeline: buildTimeline(match, auctions, marketplace),
      repeatedSalePeriods,
      historyScore: this.scoreEnabled ? score.value : null,
      scoreFactors: this.scoreEnabled ? score.factors : [],
      storageAvailable: true,
    };
  }
}

function emptyHistory(vin: string, match: VehicleMatch): ExternalVehicleHistory {
  return {
    vin,
    marketplace: [],
    auctions: [],
    mileage: [],
    odometerWarnings: [],
    crossSourceWarnings: [],
    timeline: buildTimeline(match, [], []),
    repeatedSalePeriods: 0,
    historyScore: null,
    scoreFactors: [],
    storageAvailable: false,
  };
}

export class ExternalHistoryService {
  async getByVin(vinValue: string, match: VehicleMatch, env: Env): Promise<ExternalVehicleHistory> {
    const vin = normalizeVin(vinValue);
    if (!vin) throw new Error("invalid_vin");
    if (!env.HISTORY_DB) return emptyHistory(vin, match);
    const cache = cacheApi();
    const key = cacheRequest(vin);
    if (cache) {
      const cached = await cache.match(key);
      if (cached) {
        await recordUsage(env.HISTORY_DB, true);
        return (await cached.json()) as ExternalVehicleHistory;
      }
    }
    await recordUsage(env.HISTORY_DB, false);
    const provider = new D1HistoryProvider(
      env.HISTORY_DB,
      Math.max(0, Number(env.ODOMETER_ROLLBACK_TOLERANCE_KM ?? "1000")),
      (env.HISTORY_SCORE_ENABLED ?? "true").toLowerCase() === "true",
    );
    const result = await provider.searchByVin(vin, match);
    if (cache) {
      const ttl = Math.max(60, Number(env.HISTORY_CACHE_TTL ?? "21600"));
      await cache.put(key, Response.json(result, { headers: { "Cache-Control": `public, max-age=${ttl}` } }));
    }
    return result;
  }
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`invalid_${field}`);
  return value.trim();
}

function optionalText(value: unknown, max: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > max) throw new Error("invalid_text");
  return value.trim();
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("invalid_number");
  return value;
}

function isoDate(value: unknown): string {
  const text = requiredText(value, "date", 40);
  if (Number.isNaN(Date.parse(text))) throw new Error("invalid_date");
  return new Date(text).toISOString();
}

async function saveMileage(
  db: D1DatabaseLike,
  vin: string,
  date: string,
  mileage: number | null,
  unit: string | null,
  source: string,
  reference: string,
  sourceUrl: string | null,
): Promise<void> {
  const km = normalizeMileageKm(mileage, unit);
  if (mileage === null || !unit || km === null) return;
  const fingerprint = await sha256(`${vin}|${source}|${reference}|${date}|${mileage}|${unit}`);
  await db.prepare(
    `INSERT OR IGNORE INTO mileage_records(
       normalized_vin, observed_at, original_mileage, original_unit,
       normalized_mileage_km, source, source_reference, source_url, confidence, fingerprint
     ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'HIGH', ?)`,
  ).bind(vin, date, Math.round(mileage), unit, km, source, reference, sourceUrl, fingerprint).run();
}

async function importMarketplace(db: D1DatabaseLike, raw: MarketplaceImportRecord): Promise<string> {
  const provider = requiredText(raw.provider, "provider", 50);
  const externalId = requiredText(raw.externalId, "external_id", 255);
  const vin = normalizeVin(requiredText(raw.vin, "vin", 32));
  if (!vin) throw new Error("invalid_vin");
  const observedAt = isoDate(raw.observedAt);
  const price = optionalNumber(raw.price);
  const mileage = optionalNumber(raw.mileage);
  const mileageUnit = optionalText(raw.mileageUnit, 10);
  const currency = normalizeCurrency(optionalText(raw.currency, 10));
  const mileageKm = normalizeMileageKm(mileage, mileageUnit);
  const active = raw.isActive !== false;
  const descriptionHash = optionalText(raw.descriptionHash, 64);
  const existing = await db.prepare(
    `SELECT id, price, currency, mileage, mileage_unit, description_hash, is_active
     FROM marketplace_listings WHERE provider = ? AND external_id = ?`,
  ).bind(provider, externalId).first<ExistingListingRow>();
  await db.prepare(
    `INSERT INTO marketplace_listings(
       provider, external_id, vin, normalized_vin, url, title, brand, normalized_brand,
       model, normalized_model, year, price, currency, mileage, mileage_unit,
       normalized_mileage_km, city, region, description_hash, seller_type,
       first_seen_at, last_seen_at, removed_at, is_active
     ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, external_id) DO UPDATE SET
       vin=excluded.vin, normalized_vin=excluded.normalized_vin, url=excluded.url,
       title=excluded.title, brand=excluded.brand, normalized_brand=excluded.normalized_brand,
       model=excluded.model, normalized_model=excluded.normalized_model, year=excluded.year,
       price=excluded.price, currency=excluded.currency, mileage=excluded.mileage,
       mileage_unit=excluded.mileage_unit, normalized_mileage_km=excluded.normalized_mileage_km,
       city=excluded.city, region=excluded.region, description_hash=excluded.description_hash,
       seller_type=excluded.seller_type, last_seen_at=excluded.last_seen_at,
       removed_at=excluded.removed_at, is_active=excluded.is_active, updated_at=CURRENT_TIMESTAMP`,
  ).bind(
    provider, externalId, raw.vin, vin, optionalText(raw.url, 2048), optionalText(raw.title, 500),
    optionalText(raw.brand, 255), normalizeText(raw.brand), optionalText(raw.model, 255),
    normalizeModel(raw.model), optionalNumber(raw.year), price, currency, mileage, mileageUnit,
    mileageKm, optionalText(raw.city, 255), optionalText(raw.region, 255), descriptionHash,
    optionalText(raw.sellerType, 50), observedAt, observedAt, active ? null : observedAt, active ? 1 : 0,
  ).run();
  const listing = await db.prepare(
    "SELECT id, price, currency, mileage, mileage_unit, description_hash, is_active FROM marketplace_listings WHERE provider = ? AND external_id = ?",
  ).bind(provider, externalId).first<ExistingListingRow>();
  if (!listing) throw new Error("listing_upsert_failed");
  const changed = !existing || existing.price !== price || existing.currency !== currency
    || existing.mileage !== mileage || existing.mileage_unit !== mileageUnit
    || existing.description_hash !== descriptionHash || existing.is_active !== (active ? 1 : 0);
  if (changed) {
    await db.prepare(
      `INSERT INTO marketplace_listing_snapshots(
         listing_id, observed_at, price, currency, mileage, mileage_unit,
         normalized_mileage_km, description_hash, is_active
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(listing.id, observedAt, price, currency, mileage, mileageUnit, mileageKm, descriptionHash, active ? 1 : 0).run();
  }
  await saveMileage(db, vin, observedAt, mileage, mileageUnit, provider, externalId, optionalText(raw.url, 2048));
  await recordProviderImport(db, provider);
  return vin;
}

async function importAuction(db: D1DatabaseLike, raw: AuctionImportRecord): Promise<string> {
  const provider = requiredText(raw.provider, "provider", 50);
  const externalId = requiredText(raw.externalId, "external_id", 255);
  const vin = normalizeVin(requiredText(raw.vin, "vin", 32));
  if (!vin) throw new Error("invalid_vin");
  const auctionDate = raw.auctionDate ? isoDate(raw.auctionDate) : null;
  const odometer = optionalNumber(raw.odometer);
  const odometerUnit = optionalText(raw.odometerUnit, 10);
  const normalizedOdometerKm = normalizeMileageKm(odometer, odometerUnit);
  const currency = normalizeCurrency(optionalText(raw.currency, 10));
  await db.prepare(
    `INSERT INTO auction_events(
       provider, external_id, vin, normalized_vin, auction_name, lot_number, auction_date,
       location, seller_type, sale_status, final_bid, currency, estimated_retail_value,
       repair_cost, primary_damage, secondary_damage, odometer, odometer_unit,
       normalized_odometer_km, odometer_status, title_type, keys_available, run_and_drive,
       engine_starts, source_url, brand, normalized_brand, model, normalized_model, year,
       color, engine_capacity
     ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, external_id) DO UPDATE SET
       vin=excluded.vin, normalized_vin=excluded.normalized_vin, auction_name=excluded.auction_name,
       lot_number=excluded.lot_number, auction_date=excluded.auction_date, location=excluded.location,
       seller_type=excluded.seller_type, sale_status=excluded.sale_status, final_bid=excluded.final_bid,
       currency=excluded.currency, estimated_retail_value=excluded.estimated_retail_value,
       repair_cost=excluded.repair_cost, primary_damage=excluded.primary_damage,
       secondary_damage=excluded.secondary_damage, odometer=excluded.odometer,
       odometer_unit=excluded.odometer_unit, normalized_odometer_km=excluded.normalized_odometer_km,
       odometer_status=excluded.odometer_status, title_type=excluded.title_type,
       keys_available=excluded.keys_available, run_and_drive=excluded.run_and_drive,
       engine_starts=excluded.engine_starts, source_url=excluded.source_url,
       brand=excluded.brand, normalized_brand=excluded.normalized_brand, model=excluded.model,
       normalized_model=excluded.normalized_model, year=excluded.year, color=excluded.color,
       engine_capacity=excluded.engine_capacity, updated_at=CURRENT_TIMESTAMP`,
  ).bind(
    provider, externalId, raw.vin, vin, optionalText(raw.auctionName, 100), optionalText(raw.lotNumber, 100),
    auctionDate, optionalText(raw.location, 255), optionalText(raw.sellerType, 100), optionalText(raw.saleStatus, 100),
    optionalNumber(raw.finalBid), currency, optionalNumber(raw.estimatedRetailValue), optionalNumber(raw.repairCost),
    optionalText(raw.primaryDamage, 255), optionalText(raw.secondaryDamage, 255), odometer, odometerUnit,
    normalizedOdometerKm, optionalText(raw.odometerStatus, 100), optionalText(raw.titleType, 255),
    raw.keysAvailable === undefined || raw.keysAvailable === null ? null : raw.keysAvailable ? 1 : 0,
    raw.runAndDrive === undefined || raw.runAndDrive === null ? null : raw.runAndDrive ? 1 : 0,
    raw.engineStarts === undefined || raw.engineStarts === null ? null : raw.engineStarts ? 1 : 0,
    optionalText(raw.sourceUrl, 2048), optionalText(raw.brand, 255), normalizeText(raw.brand),
    optionalText(raw.model, 255), normalizeModel(raw.model), optionalNumber(raw.year), optionalText(raw.color, 100),
    optionalNumber(raw.engineCapacity),
  ).run();
  const event = await db.prepare(
    "SELECT id FROM auction_events WHERE provider = ? AND external_id = ?",
  ).bind(provider, externalId).first<ExistingAuctionRow>();
  if (!event) throw new Error("auction_upsert_failed");
  for (const [position, sourceUrl] of (raw.photoUrls ?? []).slice(0, 100).entries()) {
    const url = optionalText(sourceUrl, 2048);
    if (!url) continue;
    await db.prepare(
      "INSERT OR IGNORE INTO auction_photos(auction_event_id, source_url, position, is_primary) VALUES(?, ?, ?, ?)",
    ).bind(event.id, url, position, position === 0 ? 1 : 0).run();
  }
  if (auctionDate) {
    await saveMileage(db, vin, auctionDate, odometer, odometerUnit, raw.auctionName ?? provider, externalId, optionalText(raw.sourceUrl, 2048));
  }
  await recordProviderImport(db, provider);
  return vin;
}

export async function importHistory(payload: HistoryImportPayload, env: Env): Promise<{ marketplace: number; auctions: number; vins: string[] }> {
  if (!env.HISTORY_DB) throw new Error("history_storage_unavailable");
  const marketplace = payload.marketplace ?? [];
  const auctions = payload.auctions ?? [];
  if (!Array.isArray(marketplace) || !Array.isArray(auctions) || marketplace.length > 100 || auctions.length > 100) {
    throw new Error("invalid_import_batch");
  }
  const vins = new Set<string>();
  for (const item of marketplace) vins.add(await importMarketplace(env.HISTORY_DB, item));
  for (const item of auctions) vins.add(await importAuction(env.HISTORY_DB, item));
  const cache = cacheApi();
  if (cache) await Promise.all([...vins].map((vin) => cache.delete(cacheRequest(vin))));
  return { marketplace: marketplace.length, auctions: auctions.length, vins: [...vins] };
}
