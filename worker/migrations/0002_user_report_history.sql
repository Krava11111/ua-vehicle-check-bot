CREATE TABLE IF NOT EXISTS user_report_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  report_reference TEXT NOT NULL,
  vehicle_key TEXT NOT NULL,
  vin TEXT,
  plate TEXT,
  brand TEXT,
  model TEXT,
  make_year INTEGER,
  first_viewed_at TEXT NOT NULL,
  last_viewed_at TEXT NOT NULL,
  view_count INTEGER NOT NULL DEFAULT 1,
  UNIQUE (telegram_user_id, vehicle_key)
);

CREATE INDEX IF NOT EXISTS idx_user_report_history_recent
  ON user_report_history (telegram_user_id, last_viewed_at DESC, id DESC);
