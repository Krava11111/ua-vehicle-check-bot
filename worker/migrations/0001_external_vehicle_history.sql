CREATE TABLE IF NOT EXISTS marketplace_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  vin TEXT NOT NULL,
  normalized_vin TEXT NOT NULL,
  url TEXT,
  title TEXT,
  brand TEXT,
  normalized_brand TEXT,
  model TEXT,
  normalized_model TEXT,
  year INTEGER,
  price REAL,
  currency TEXT,
  mileage INTEGER,
  mileage_unit TEXT,
  normalized_mileage_km INTEGER,
  city TEXT,
  region TEXT,
  description_hash TEXT,
  seller_type TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  removed_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, external_id)
);

CREATE INDEX IF NOT EXISTS ix_marketplace_vin_seen
  ON marketplace_listings(normalized_vin, last_seen_at);

CREATE TABLE IF NOT EXISTS marketplace_listing_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  observed_at TEXT NOT NULL,
  price REAL,
  currency TEXT,
  mileage INTEGER,
  mileage_unit TEXT,
  normalized_mileage_km INTEGER,
  description_hash TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS ix_listing_snapshot_observed
  ON marketplace_listing_snapshots(listing_id, observed_at);

CREATE TABLE IF NOT EXISTS auction_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  vin TEXT NOT NULL,
  normalized_vin TEXT NOT NULL,
  auction_name TEXT,
  lot_number TEXT,
  auction_date TEXT,
  location TEXT,
  seller_type TEXT,
  sale_status TEXT,
  final_bid REAL,
  currency TEXT,
  estimated_retail_value REAL,
  repair_cost REAL,
  primary_damage TEXT,
  secondary_damage TEXT,
  odometer INTEGER,
  odometer_unit TEXT,
  normalized_odometer_km INTEGER,
  odometer_status TEXT,
  title_type TEXT,
  keys_available INTEGER,
  run_and_drive INTEGER,
  engine_starts INTEGER,
  source_url TEXT,
  brand TEXT,
  normalized_brand TEXT,
  model TEXT,
  normalized_model TEXT,
  year INTEGER,
  color TEXT,
  engine_capacity INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, external_id)
);

CREATE INDEX IF NOT EXISTS ix_auction_vin_date
  ON auction_events(normalized_vin, auction_date);

CREATE TABLE IF NOT EXISTS auction_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auction_event_id INTEGER NOT NULL REFERENCES auction_events(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(auction_event_id, source_url)
);

CREATE INDEX IF NOT EXISTS ix_auction_photos_event ON auction_photos(auction_event_id);

CREATE TABLE IF NOT EXISTS mileage_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  normalized_vin TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  original_mileage INTEGER NOT NULL,
  original_unit TEXT NOT NULL,
  normalized_mileage_km INTEGER NOT NULL,
  source TEXT NOT NULL,
  source_reference TEXT,
  source_url TEXT,
  confidence TEXT NOT NULL DEFAULT 'MEDIUM',
  fingerprint TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_mileage_vin_date
  ON mileage_records(normalized_vin, observed_at);

CREATE TABLE IF NOT EXISTS provider_usage_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  date TEXT NOT NULL,
  requests_count INTEGER NOT NULL DEFAULT 0,
  cache_hits INTEGER NOT NULL DEFAULT 0,
  cache_misses INTEGER NOT NULL DEFAULT 0,
  successful_requests INTEGER NOT NULL DEFAULT 0,
  failed_requests INTEGER NOT NULL DEFAULT 0,
  estimated_cost REAL NOT NULL DEFAULT 0,
  UNIQUE(provider, date)
);
