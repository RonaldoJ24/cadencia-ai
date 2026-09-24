// Cloudflare adaptation Workflow: one instance per proposal.
// D1 is authoritative product state; this Workflow is operational state.
// Payloads carry IDs only — never user goal or session content.
//
// Settlement ownership: the HTTP layer only records a human decision and
// notifies. After waking, this Workflow rereads the persisted decision plus
// authoritative proposal/schedule/evidence state and commits or marks stale
// through the same guarded path as every other settler. A wait timeout and
// an unexpected step error are distinct: a throw out of waitForEvent means
// no event arrived (the settle step reloads D1 and decides expiry vs. a
// meanwhile-persisted decision), while errors inside step.do propagate and
// retry the step.

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { envDb } from '../../lib/server/db.ts';
import { getProposal } from '../../lib/server/adaptation.ts';
import {
  DECISION_EVENT_TYPE,
  materializeCandidate,
  settleAdaptation,
  type DecisionEvent,
  type WorkflowParams,
} from '../../lib/server/workflow-coord.ts';

type Env = Cloudflare.Env & { ADAPTATION_WORKFLOW?: unknown };

const APPROVAL_TIMEOUT = '30 minutes';

export class AdaptationWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
  override async run(event: Readonly<WorkflowEvent<WorkflowParams>>, step: WorkflowStep): Promise<unknown> {
    const params = event.payload;
    const db = envDb({ DB: (this.env as unknown as Record<string, unknown>).DB });
    if (!db) throw new Error('cadencia_workflow_no_db');

    // 1-7. Load authoritative D1 state, confirm eligibility, snapshot base
    // revision + evidence watermark, derive via deterministic policy (or
    // validated AI content for private connected mode), run the planner,
    // hash + diff, persist awaiting_approval with the engine-captured trace.
    const materialized = await step.do('derive adaptation candidate', async () => {
      const row = await materializeCandidate(db, {
        proposalId: params.proposalId,
        nowIso: new Date().toISOString(),
      });
      return { proposalId: row.id, status: row.status, candidateHash: row.candidate_hash };
    });

    // 8-9. Durable wait for the decision event. Stable operation
    // identifier: 'await reviewer decision'. A throw means no event arrived
    // (timeout); settle still runs and decides from D1. The payload itself
    // is only a wake-up: every binding is re-read from D1, never trusted
    // from the event.
    try {
      await step.waitForEvent<DecisionEvent>('await reviewer decision', {
        type: DECISION_EVENT_TYPE,
        timeout: APPROVAL_TIMEOUT,
      });
    } catch {
      // No event arrived: settle decides expiry vs. persisted decision below.
    }

    // 10-12. Reload authoritative D1 state; commit idempotently or mark
    // stale; record the terminal outcome. A duplicate event or a retry
    // after a successful commit discovers the committed candidate.
    const settled = await step.do('settle adaptation decision', async () =>
      settleAdaptation(db, {
        proposalId: params.proposalId,
        nowIso: new Date().toISOString(),
      }));

    const terminal = await getProposal(db, params.proposalId).catch(() => null);
    return {
      proposalId: params.proposalId,
      candidateHash: materialized.candidateHash,
      status: terminal?.status ?? settled.status,
    };
  }
}
