// Production Cloudflare Workflow ports. Builds WorkflowPorts from the
// ADAPTATION_WORKFLOW binding when present; returns null otherwise so
// callers fall back to the labeled local coordinator path. Payloads stay
// IDs-only in both cases.

import type { DecisionEvent, WorkflowParams, WorkflowPorts } from './workflow-coord.ts';

type WorkflowBinding = {
  create: (opts: { id: string; params: unknown }) => Promise<unknown>;
  /** Matches the runtime: get() resolves with the instance handle. */
  get: (id: string) => Promise<{
    sendEvent: (event: { type: string; payload: unknown }) => Promise<unknown>;
  }>;
};

function asBinding(value: unknown): WorkflowBinding | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.create !== 'function' || typeof candidate.get !== 'function') return null;
  return candidate as unknown as WorkflowBinding;
}

export async function bindingWorkflowPorts(source?: unknown): Promise<WorkflowPorts | null> {
  let binding = asBinding(source);
  if (!binding) {
    try {
      const worker = await import('cloudflare:workers');
      binding = asBinding((worker.env as unknown as Record<string, unknown>)?.ADAPTATION_WORKFLOW);
    } catch {
      binding = null;
    }
  }
  if (!binding) return null;
  const handle = binding;
  return {
    createWorkflow: async (params: WorkflowParams) => {
      // Stable instance ID derived from the proposal ID: duplicate creates
      // for the same proposal address the same instance instead of forking.
      await handle.create({ id: `workflow-${params.proposalId}`, params });
    },
    sendEvent: async (envelope: { workflowId: string; type: string; payload: DecisionEvent }) => {
      const instance = await handle.get(envelope.workflowId);
      await instance.sendEvent({ type: envelope.type, payload: envelope.payload });
    },
    newId: () => crypto.randomUUID(),
  };
}
