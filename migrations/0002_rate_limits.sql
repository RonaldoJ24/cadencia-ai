-- Packet 05: operational rate-limit counters. Keys are opaque caller scopes
-- (user id or non-reversible IP hash); no content, prompts, or tokens here.
CREATE TABLE rate_hits (
  key TEXT NOT NULL,
  ts INTEGER NOT NULL
);

CREATE INDEX rate_hits_key_ts ON rate_hits(key, ts);
