CREATE TABLE IF NOT EXISTS partner_activations (
  telegram_user_id TEXT PRIMARY KEY,
  activated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_partner_activations_updated
  ON partner_activations (updated_at DESC);
