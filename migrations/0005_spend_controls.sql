-- Dollar caps and a kill switch for live AI, adjustable without a deploy.
--
-- app_settings holds operational switches read on every live request:
--   live_enabled          '1' allows live generation, anything else pauses it
--   daily_cap_microusd    spend cap per UTC day, in millionths of a dollar
--   monthly_cap_microusd  spend cap per UTC month, in millionths of a dollar
--
-- spend_ledger has one row per live generation. A row is inserted as
-- 'reserved' at its worst-case cost before the model is called, only if the
-- day's and month's committed spend plus that reservation stay within the
-- caps. It becomes 'settled' at the cost computed from reported token usage.
-- A reservation whose usage is unknown stays at its worst case.

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES
  ('live_enabled', '1', '2026-09-24T00:00:00Z'),
  ('daily_cap_microusd', '500000', '2026-09-24T00:00:00Z'),
  ('monthly_cap_microusd', '5000000', '2026-09-24T00:00:00Z');

CREATE TABLE IF NOT EXISTS spend_ledger (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  month TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'settled')),
  reserved_microusd INTEGER NOT NULL CHECK (reserved_microusd >= 0),
  actual_microusd INTEGER CHECK (actual_microusd IS NULL OR actual_microusd >= 0),
  model TEXT,
  prompt_tokens INTEGER CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
  completion_tokens INTEGER CHECK (completion_tokens IS NULL OR completion_tokens >= 0),
  attempts INTEGER CHECK (attempts IS NULL OR attempts >= 0),
  request_id TEXT,
  created_at TEXT NOT NULL,
  settled_at TEXT
);

CREATE INDEX IF NOT EXISTS spend_ledger_day ON spend_ledger(day);
CREATE INDEX IF NOT EXISTS spend_ledger_month ON spend_ledger(month);
