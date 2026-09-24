PRAGMA foreign_keys = ON;

CREATE TABLE beta_users (
  id TEXT PRIMARY KEY,
  access_subject TEXT NOT NULL UNIQUE,
  email_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('invited', 'active', 'disabled'))
);

CREATE TABLE routines (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES beta_users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('en', 'es')),
  source_mode TEXT NOT NULL CHECK (source_mode IN ('demo', 'deepseek')),
  status TEXT NOT NULL CHECK (status IN ('active', 'archived', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE routine_versions (
  id TEXT PRIMARY KEY,
  routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  parent_version_id TEXT REFERENCES routine_versions(id),
  week_start TEXT NOT NULL,
  timezone TEXT NOT NULL,
  input_json TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  generated_by TEXT NOT NULL CHECK (generated_by IN ('demo', 'deepseek', 'replan')),
  created_at TEXT NOT NULL,
  UNIQUE (routine_id, version_number)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  routine_version_id TEXT NOT NULL REFERENCES routine_versions(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  starts_at TEXT NOT NULL,
  scheduled_minutes INTEGER NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'done', 'skipped', 'missed')),
  completed_at TEXT,
  note TEXT,
  UNIQUE (routine_version_id, ordinal)
);

CREATE TABLE generation_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES beta_users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('demo', 'deepseek')),
  outcome TEXT NOT NULL CHECK (outcome IN ('pending', 'completed', 'refused', 'failed')),
  routine_id TEXT REFERENCES routines(id) ON DELETE SET NULL,
  provider_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES beta_users(id) ON DELETE CASCADE,
  routine_version_id TEXT REFERENCES routine_versions(id) ON DELETE SET NULL,
  score INTEGER NOT NULL CHECK (score IN (-1, 1)),
  category TEXT CHECK (category IN ('useful', 'too_generic', 'too_hard', 'too_easy', 'unsafe', 'other')),
  created_at TEXT NOT NULL
);

CREATE TABLE usage_windows (
  user_id TEXT NOT NULL REFERENCES beta_users(id) ON DELETE CASCADE,
  window_start TEXT NOT NULL,
  live_generations INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, window_start)
);

CREATE INDEX sessions_by_version_status ON sessions(routine_version_id, status);
CREATE INDEX routines_by_user_status ON routines(user_id, status, updated_at DESC);
CREATE INDEX generation_by_user_created ON generation_requests(user_id, created_at DESC);
