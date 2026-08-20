export interface Env {
  BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  WEBHOOK_SECRET_PATH: string;
  INDEX_MANIFEST_URL: string;
  DEFAULT_LANGUAGE?: string;
  RATE_LIMIT_PER_MINUTE?: string;
  MAX_CANDIDATES?: string;
  MAX_PLATE_HISTORY_CANDIDATES?: string;
  VEHICLE_HISTORY_START_YEAR?: string;
  HISTORY_DB?: D1DatabaseLike;
  HISTORY_IMPORT_SECRET?: string;
  HISTORY_CACHE_TTL?: string;
  ODOMETER_ROLLBACK_TOLERANCE_KM?: string;
  HISTORY_SCORE_ENABLED?: string;
  AUTO_RIA_API_KEY?: string;
  AUTO_RIA_SEARCH_URL?: string;
  AUTO_RIA_INFO_URL?: string;
  AUCTION_API_KEY?: string;
  AUCTION_API_BASE_URL?: string;
  BIDFAX_BASE_URL?: string;
}

export interface D1ResultLike<T = Record<string, unknown>> {
  success: boolean;
  results?: T[];
  meta?: { changes?: number; last_row_id?: number };
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
  run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch<T = Record<string, unknown>>(
    statements: D1PreparedStatementLike[],
  ): Promise<D1ResultLike<T>[]>;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface TelegramUser {
  id: number;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  reply_to_message?: TelegramMessage;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export type Language = "uk" | "ru";

export interface IndexManifest {
  schema_version: number;
  version: string;
  generated_at: string;
  dataset_updated_at?: string | null;
  source_fingerprint: string;
  source_label: string;
  source_url: string;
  repository: string;
  shard_prefix_length: number;
  max_events_per_vehicle: number;
  archive_url_template: string;
  counts: {
    vehicles: number;
    plates: number;
    events: number;
    [key: string]: number;
  };
  wanted?: WantedIndexManifest;
  history_start_year?: number;
  plate_history_available?: boolean;
}

export interface WantedIndexManifest {
  schema_version: number;
  version: string;
  generated_at: string;
  dataset_updated_at?: string | null;
  source_fingerprint: string;
  source_label: string;
  source_url: string;
  shard_prefix_length: number;
  archive_url_template: string;
  counts: Record<string, number>;
}

export type CompactEvent = [
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  (string | null)?,
  (string | null)?,
  (number | null)?,
  (string | null)?,
  (string | null)?,
  (number | null)?,
  (number | null)?,
  (string | null)?,
];

export type WantedRecord = [
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
];

export interface WantedCheck {
  status: "match" | "clear" | "unavailable";
  checkedAt: string | null;
  sourceUrl: string | null;
  matches: WantedRecord[];
}

export interface CompactVehicle {
  v: string | null;
  p: string | null;
  b: string | null;
  m: string | null;
  y: number | null;
  c: string | null;
  k: string | null;
  bt: string | null;
  pu: string | null;
  f: string | null;
  ec: number | null;
  ow: number | null;
  tw: number | null;
  e: CompactEvent[];
}

export interface VehicleMatch {
  key: string;
  vehicle: CompactVehicle;
  matchedBy: "PLATE" | "VIN";
  candidates: number;
}

export interface VehicleCandidate {
  candidateId: string;
  vehicleKey: string;
  vin: string | null;
  plate: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  fuel: string | null;
  engineCapacity: number | null;
  bodyType: string | null;
  vehicleType: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  registrationsCount: number;
  confidence: AssignmentConfidence;
}

export interface VehicleReportData {
  schemaVersion: 1;
  reference: string;
  collectedAt: string;
  match: VehicleMatch;
  wanted: WantedCheck;
  insurance: {
    status: "unavailable";
    source: "MTSBU";
    checkUrl: string;
  };
  externalHistory: {
    auctions: "available" | "empty" | "not_connected" | "unavailable";
    marketplace: "available" | "empty" | "not_connected" | "unavailable";
    odometer: "available" | "empty" | "not_connected" | "unavailable";
    data: ExternalVehicleHistory | null;
    bidfaxUrl: string | null;
  };
  source: {
    label: string;
    url: string;
    updatedAt: string | null;
    historyStartYear: number;
    maxEventsPerVehicle: number;
  };
}

export type FullReportSection =
  | "registrations"
  | "ownership"
  | "plates"
  | "vin"
  | "import"
  | "insurance"
  | "auctions"
  | "marketplace"
  | "odometer"
  | "analytics"
  | "timeline"
  | "sources";

export type AssignmentConfidence = "HIGH" | "MEDIUM" | "LOW";

export type CompactPlateAssignment = [
  string,
  string | null,
  string | null,
  string | null,
  number | null,
  string | null,
  string | null,
  string | null,
  string | null,
  number,
  AssignmentConfidence,
];

export interface PlateHistoryResult {
  plate: string;
  assignments: CompactPlateAssignment[];
  totalAssignments: number;
  truncated: boolean;
  source: "plate-history" | "vehicle-fallback";
}

export type Confidence = "HIGH" | "MEDIUM" | "LOW";
export type WarningSeverity = "LOW" | "MEDIUM" | "HIGH";

export interface MarketplaceSnapshot {
  observedAt: string;
  price: number | null;
  currency: string | null;
  mileage: number | null;
  mileageUnit: string | null;
  normalizedMileageKm: number | null;
  descriptionHash: string | null;
  isActive: boolean;
}

export interface MarketplaceListingHistory {
  provider: string;
  externalId: string;
  vin: string;
  url: string | null;
  title: string | null;
  brand: string | null;
  normalizedBrand: string | null;
  model: string | null;
  normalizedModel: string | null;
  year: number | null;
  city: string | null;
  region: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  removedAt: string | null;
  isActive: boolean;
  snapshots: MarketplaceSnapshot[];
}

export interface AuctionHistoryEvent {
  provider: string;
  externalId: string;
  vin: string;
  auctionName: string | null;
  lotNumber: string | null;
  auctionDate: string | null;
  location: string | null;
  saleStatus: string | null;
  finalBid: number | null;
  currency: string | null;
  estimatedRetailValue: number | null;
  repairCost: number | null;
  primaryDamage: string | null;
  secondaryDamage: string | null;
  odometer: number | null;
  odometerUnit: string | null;
  normalizedOdometerKm: number | null;
  odometerStatus: string | null;
  titleType: string | null;
  keysAvailable: boolean | null;
  runAndDrive: boolean | null;
  engineStarts: boolean | null;
  sourceUrl: string | null;
  brand: string | null;
  normalizedBrand: string | null;
  model: string | null;
  normalizedModel: string | null;
  year: number | null;
  color: string | null;
  engineCapacity: number | null;
  photos: string[];
}

export interface MileagePoint {
  date: string;
  mileage: number;
  unit: string;
  normalizedMileageKm: number;
  source: string;
  sourceReference: string | null;
  sourceUrl: string | null;
  confidence: Confidence;
}

export interface OdometerWarning {
  severity: WarningSeverity;
  previous: MileagePoint;
  current: MileagePoint;
  differenceKm: number;
}

export interface CrossSourceWarning {
  field: string;
  message: string;
  sources: Record<string, string>;
}

export interface TimelineEvent {
  date: string;
  type: "registration" | "auction" | "marketplace";
  source: string;
  title: string;
  description: string | null;
  mileageKm: number | null;
  price: number | null;
  currency: string | null;
  confidence: Confidence;
}

export interface ExternalVehicleHistory {
  vin: string;
  marketplace: MarketplaceListingHistory[];
  auctions: AuctionHistoryEvent[];
  mileage: MileagePoint[];
  odometerWarnings: OdometerWarning[];
  crossSourceWarnings: CrossSourceWarning[];
  timeline: TimelineEvent[];
  repeatedSalePeriods: number;
  historyScore: number | null;
  scoreFactors: string[];
  storageAvailable: boolean;
}

export interface MarketplaceImportRecord {
  provider: string;
  externalId: string;
  vin: string;
  url?: string | null;
  title?: string | null;
  brand?: string | null;
  model?: string | null;
  year?: number | null;
  price?: number | null;
  currency?: string | null;
  mileage?: number | null;
  mileageUnit?: string | null;
  city?: string | null;
  region?: string | null;
  descriptionHash?: string | null;
  sellerType?: string | null;
  observedAt: string;
  isActive?: boolean;
}

export interface AuctionImportRecord {
  provider: string;
  externalId: string;
  vin: string;
  auctionName?: string | null;
  lotNumber?: string | null;
  auctionDate?: string | null;
  location?: string | null;
  sellerType?: string | null;
  saleStatus?: string | null;
  finalBid?: number | null;
  currency?: string | null;
  estimatedRetailValue?: number | null;
  repairCost?: number | null;
  primaryDamage?: string | null;
  secondaryDamage?: string | null;
  odometer?: number | null;
  odometerUnit?: string | null;
  odometerStatus?: string | null;
  titleType?: string | null;
  keysAvailable?: boolean | null;
  runAndDrive?: boolean | null;
  engineStarts?: boolean | null;
  sourceUrl?: string | null;
  brand?: string | null;
  model?: string | null;
  year?: number | null;
  color?: string | null;
  engineCapacity?: number | null;
  photoUrls?: string[];
}

export interface HistoryImportPayload {
  marketplace?: MarketplaceImportRecord[];
  auctions?: AuctionImportRecord[];
}
