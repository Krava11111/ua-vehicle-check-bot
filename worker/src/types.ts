export interface Env {
  BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  WEBHOOK_SECRET_PATH: string;
  INDEX_MANIFEST_URL: string;
  DEFAULT_LANGUAGE?: string;
  RATE_LIMIT_PER_MINUTE?: string;
  MAX_CANDIDATES?: string;
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
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
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
