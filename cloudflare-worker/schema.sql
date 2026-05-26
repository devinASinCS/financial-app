-- Run: wrangler d1 execute cashio-db --file ./schema.sql --remote

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,        -- Google 'sub' claim
  email         TEXT UNIQUE NOT NULL,
  name          TEXT,
  picture       TEXT,
  refresh_token TEXT,                    -- AES-256-GCM encrypted
  created_at    INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,           -- 32-byte random hex
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Mirrors localStorage: one row per fm_* key per user
CREATE TABLE IF NOT EXISTS user_data (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,              -- e.g. 'fm_transactions'
  value      TEXT NOT NULL,             -- JSON string
  updated_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, key)
);

-- Per-user GAS import API keys
CREATE TABLE IF NOT EXISTS api_keys (
  key        TEXT PRIMARY KEY,           -- 32-byte random hex
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label      TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_apikeys_user ON api_keys(user_id);
