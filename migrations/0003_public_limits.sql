 -- Packet: Public API rate and concurrency controls.
 -- Tracks daily generation counts and active in-flight concurrency.
 -- No user IDs, prompts, content, or raw IP addresses are ever stored.
 
 CREATE TABLE IF NOT EXISTS public_daily_usage (
   scope TEXT NOT NULL,
   day TEXT NOT NULL,
   count INTEGER NOT NULL DEFAULT 0,
   PRIMARY KEY (scope, day)
 );
 
 CREATE INDEX IF NOT EXISTS public_daily_usage_day ON public_daily_usage(day);
 
 CREATE TABLE IF NOT EXISTS public_concurrency (
   id TEXT PRIMARY KEY,
   ip_hash TEXT NOT NULL,
   created_at INTEGER NOT NULL,
   expires_at INTEGER NOT NULL
 );
 
CREATE UNIQUE INDEX IF NOT EXISTS public_concurrency_ip ON public_concurrency(ip_hash);
CREATE INDEX IF NOT EXISTS public_concurrency_expires ON public_concurrency(expires_at);

CREATE TABLE IF NOT EXISTS public_limits_config (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

INSERT OR IGNORE INTO public_limits_config (key, value) VALUES
  ('minute_limit', 2),
  ('visitor_daily_quota', 5),
  ('global_daily_cap', 50),
  ('visitor_concurrency', 1),
  ('global_concurrency', 10);
