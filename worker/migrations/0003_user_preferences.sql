CREATE TABLE IF NOT EXISTS user_preferences (
  telegram_user_id TEXT PRIMARY KEY,
  language TEXT NOT NULL CHECK (language IN ('uk', 'ru')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
