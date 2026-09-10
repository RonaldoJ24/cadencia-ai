-- Schedule Proof adaptation store. Reuses routines, routine_versions,
-- sessions, generation_requests, usage_windows where they fit; adds only
-- what cannot fit: capability-scoped demo sandboxes, adaptation proposals
-- with base/evidence binding, monotonic evidence watermarks, audit trail.

CREATE TABLE IF NOT EXISTS demo_sandboxes (
  capability_hash TEXT PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  current_revision INTEGER NOT NULL DEFAULT 1,
  base_schedule_hash TEXT NOT NULL,
  current_schedule_json TEXT NOT NULL,
  evidence_watermark INTEGER NOT NULL DEFAULT 1,
  evidence_hash TEXT NOT NULL,
  active_workflow_id TEXT
);

CREATE INDEX IF NOT EXISTS demo_sandboxes_expires ON demo_sandboxes(expires_at);

CREATE TABLE IF NOT EXISTS adaptation_proposals (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('owner', 'sandbox')),
  routine_id TEXT REFERENCES routines(id) ON DELETE CASCADE,
  sandbox_hash TEXT REFERENCES demo_sandboxes(capability_hash) ON DELETE CASCADE,
  base_revision INTEGER NOT NULL,
  base_schedule_hash TEXT NOT NULL,
  evidence_watermark INTEGER NOT NULL,
  evidence_hash TEXT NOT NULL,
  planner_version TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  candidate_json TEXT NOT NULL,
  candidate_hash TEXT NOT NULL,
  diff_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'computing', 'awaiting_approval', 'committing', 'committed', 'rejected', 'stale', 'expired', 'cancelled', 'failed')),
  workflow_id TEXT,
  actor TEXT NOT NULL CHECK (actor IN ('reviewer', 'owner', 'system')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS adaptation_proposals_scope ON adaptation_proposals(scope, status);
CREATE INDEX IF NOT EXISTS adaptation_proposals_routine ON adaptation_proposals(routine_id, status);
CREATE INDEX IF NOT EXISTS adaptation_proposals_sandbox ON adaptation_proposals(sandbox_hash, status);

CREATE TABLE IF NOT EXISTS evidence_watermarks (
  scope_key TEXT PRIMARY KEY,
  watermark INTEGER NOT NULL DEFAULT 0,
  evidence_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS adaptation_audit (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES adaptation_proposals(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  detail_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS adaptation_audit_proposal ON adaptation_audit(proposal_id);
