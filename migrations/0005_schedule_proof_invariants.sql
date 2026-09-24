-- 0005 Schedule Proof invariants (correction attempt 1).
-- Local only: 0004 is already deployed; do not edit it.
--
-- RELEASE ORDER (binding): apply this migration BEFORE deploying the
-- accompanying code. The code probes for these columns/tables at runtime
-- (requireProofSchema) and answers 503 while the schema is absent, but the
-- release is only complete with both halves in place.
--
-- Design notes (per current Cloudflare D1 + Workflows docs):
-- - D1 batch() is a SQL transaction: a *failed statement* aborts/rolls back
--   the sequence, but a zero-row conditional success is NOT a failure. Every
--   dependent write in the approval path therefore repeats the full canonical
--   predicate (revision + schedule hash + watermark); see
--   lib/server/adaptation.ts commitClaimedProposal.
-- - Partial indexes are supported in D1 (PRAGMA index_list reports `partial`).
--   The index below is the database-enforced one-active-proposal invariant
--   per sandbox. Application prechecks remain as fast-path errors.
-- - waitForEvent timeout throws; the Workflow treats any wait throw as "no
--   event arrived" and reloads the persisted decision from D1 (persisted
--   decisions win over expiry). Errors inside step.do propagate and retry.

-- At most one active proposal per sandbox. Terminal states
-- (committed/rejected/stale/expired/cancelled/failed) are excluded so a
-- sandbox can always start a new replay after settling the previous one.
CREATE UNIQUE INDEX IF NOT EXISTS adaptation_active_per_sandbox
  ON adaptation_proposals(sandbox_hash)
  WHERE scope = 'sandbox'
    AND status IN ('queued', 'computing', 'awaiting_approval', 'committing');

-- Trace captured at decision time, keyed to the revision it produced.
-- The served trace always comes from these columns, never reconstructed
-- from a completed plan after the fact.
ALTER TABLE adaptation_proposals ADD COLUMN trace_json TEXT;
ALTER TABLE demo_sandboxes ADD COLUMN current_trace_json TEXT;
ALTER TABLE routine_versions ADD COLUMN trace_json TEXT;

-- Immutable human decisions, recorded BEFORE any Workflow notification.
-- The Workflow settles purely from this row plus authoritative D1 state;
-- event payloads carry only stable identifiers (proposalId + decision).
CREATE TABLE IF NOT EXISTS adaptation_decisions (
  proposal_id TEXT PRIMARY KEY REFERENCES adaptation_proposals(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'cancelled')),
  candidate_hash TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  evidence_watermark INTEGER NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  notified INTEGER NOT NULL DEFAULT 0
);
