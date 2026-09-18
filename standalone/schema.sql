-- Continuity Layer standalone — Cloudflare D1 schema
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  status TEXT DEFAULT 'pending',
  tier TEXT DEFAULT 'Free',
  capsule TEXT DEFAULT '',
  claim TEXT DEFAULT '',
  name TEXT DEFAULT '',
  receipt TEXT DEFAULT '',
  interview TEXT DEFAULT '',
  notified TEXT DEFAULT '',
  sync_request TEXT DEFAULT '',
  created_at INTEGER,
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  k TEXT,
  v TEXT
);
CREATE INDEX IF NOT EXISTS idx_settings_k ON settings(k);
CREATE TABLE IF NOT EXISTS otps (
  rowid_otp INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,
  code TEXT,
  at INTEGER,
  tries INTEGER DEFAULT 0
);
