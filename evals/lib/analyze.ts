// Count tables for a run (pre-registration, section 5): counts with their
// denominators, medians and extremes. No percentages. Harness failures are
// never scored; they are only counted, with their cost.

import type { EvalCase } from './cases.ts';
import type { ResultLine } from './runner.ts';

type Decision = 'plan' | 'clarify' | 'abstain';
const DECISIONS: readonly Decision[] = ['plan', 'clarify', 'abstain'];

export type ArmReport = {
  arm: string;
  cases: number;
  validReadings: number;
  confusion: Record<Decision, Record<Decision | 'invalid', number>>;
  abstainCategories: { expected: number; matched: number; byGuard: number };
  afterAnswer: { runs: number; plan: number; stillUnclear: number; abstain: number; invalid: number };
  drafts: { reached: number; firstValid: number; validAfterRetry: number; failedTwice: number; callFailed: number };
  /** Runs the fit stage stopped because checkPlan found violations, and the rules broken. */
  stoppedByCheck: { runs: number; rules: Record<string, number> };
  /** Violations the runner's own re-check found in ready plans. */
  violationsInReady: number;
  trims: { plans: number; median: number; max: number; weeksOverLimitsMedian: number; weeksOverLimitsMax: number };
  costMicroUsd: { median: number; max: number; total: number };
  latencyMs: Record<'read' | 'draft' | 'run', { median: number; p90: number; max: number; n: number }>;
  failed: Record<string, number>;
  harness: { runs: number; costMicroUsd: number };
};

export function percentile(values: number[], share: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)];
}

const median = (values: number[]) => percentile(values, 0.5);

export function analyzeArm(arm: string, cases: EvalCase[], results: ResultLine[]): ArmReport {
  const byCase = new Map(cases.map((item) => [item.id, item]));
  const harness = results.filter((line) => line.arm === arm && line.harness);
  const lines = results.filter((line) => line.arm === arm && !line.harness);
  const first = lines.filter((line) => line.round === 1);
  const second = lines.filter((line) => line.round === 2);
  const confusion = Object.fromEntries(
    DECISIONS.map((expected) => [expected, { plan: 0, clarify: 0, abstain: 0, invalid: 0 }]),
  ) as ArmReport['confusion'];
  const abstainCategories = { expected: 0, matched: 0, byGuard: 0 };
  for (const line of first) {
    const item = byCase.get(line.caseId);
    if (!item) continue;
    confusion[item.expect.decision][line.decision ?? 'invalid'] += 1;
    if (line.byGuard) abstainCategories.byGuard += 1;
    if (item.expect.decision === 'abstain') {
      abstainCategories.expected += 1;
      if (line.decision === 'abstain' && line.abstainCategory === item.expect.abstain_category) abstainCategories.matched += 1;
    }
  }
  const drafted = lines.filter((line) => line.drafts && line.drafts.first !== 'none');
  const stopped = lines.filter((line) => line.failedCode === 'plan_violations');
  const rules: Record<string, number> = {};
  for (const rule of stopped.flatMap((line) => line.failedIssues ?? [])) rules[rule] = (rules[rule] ?? 0) + 1;
  const ready = lines.filter((line) => line.outcome === 'ready' && line.plan);
  const call = (kind: 'read' | 'draft') => lines.flatMap((line) => line.calls.filter((entry) => entry.call === kind).map((entry) => entry.ms));
  const spread = (values: number[]) => ({ median: median(values), p90: percentile(values, 0.9), max: Math.max(0, ...values), n: values.length });
  const failed: Record<string, number> = {};
  for (const line of lines) {
    if (line.outcome === 'failed') {
      const key = `${line.failedStage}:${line.failedCode}`;
      failed[key] = (failed[key] ?? 0) + 1;
    }
  }
  const costs = lines.map((line) => line.costMicroUsd);
  const trims = ready.map((line) => line.plan!.trimmed);
  const over = ready.map((line) => line.plan!.weeksOverLimits);
  return {
    arm,
    cases: first.length,
    validReadings: first.filter((line) => line.decision !== undefined).length,
    confusion,
    abstainCategories,
    afterAnswer: {
      runs: second.length,
      plan: second.filter((line) => line.decision === 'plan').length,
      stillUnclear: second.filter((line) => line.decision === 'clarify').length,
      abstain: second.filter((line) => line.decision === 'abstain').length,
      invalid: second.filter((line) => line.decision === undefined).length,
    },
    drafts: {
      reached: drafted.length,
      firstValid: drafted.filter((line) => line.drafts!.first === 'valid').length,
      validAfterRetry: drafted.filter((line) => line.drafts!.retry === 'valid').length,
      failedTwice: drafted.filter((line) => line.drafts!.first === 'invalid' && line.drafts!.retry === 'invalid').length,
      callFailed: drafted.filter((line) => line.drafts!.first === 'call_failed' || line.drafts!.retry === 'call_failed').length,
    },
    stoppedByCheck: { runs: stopped.length, rules },
    violationsInReady: ready.reduce((total, line) => total + line.plan!.violations, 0),
    trims: {
      plans: ready.length,
      median: median(trims),
      max: Math.max(0, ...trims),
      weeksOverLimitsMedian: median(over),
      weeksOverLimitsMax: Math.max(0, ...over),
    },
    costMicroUsd: { median: median(costs), max: Math.max(0, ...costs), total: costs.reduce((a, b) => a + b, 0) },
    latencyMs: { read: spread(call('read')), draft: spread(call('draft')), run: spread(lines.map((line) => line.totalMs)) },
    failed,
    harness: { runs: harness.length, costMicroUsd: harness.reduce((total, line) => total + line.costMicroUsd, 0) },
  };
}

function usd(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(4)}`;
}

/** Where the cases came from and what the owner's review did (pre-registration, section 4). */
export type CaseSources = {
  /** From provenanceCounts; absent when the case file has no provenance beside it. */
  counts?: Array<{ name: string; count: number }>;
  review?: { drafted: number; dropped: number; spotCheck?: { agreed: number; of: number } };
  /** Kept cases close to a development text. */
  closeToDevelopment: Array<{ id: string; similarity: number }>;
};

function renderSources(sources: CaseSources): string[] {
  const lines = ['## Cases', ''];
  if (sources.counts) {
    lines.push('| Origin and review | Cases |', '|---|---:|', ...sources.counts.map((item) => `| ${item.name} | ${item.count} |`), '');
  } else {
    lines.push('No provenance file beside the cases.', '');
  }
  if (sources.review) {
    lines.push(`Drafts written: ${sources.review.drafted}. Dropped in the audit and review: ${sources.review.dropped}.`, '');
    const check = sources.review.spotCheck;
    if (check) lines.push(`The owner's random check: agreed with ${check.agreed} of ${check.of} labels.`, '');
  }
  const close = sources.closeToDevelopment;
  lines.push(
    `Cases close to development texts, kept: ${close.length === 0 ? 'none' : close.map((item) => `${item.id} (${item.similarity})`).join(', ')}.`,
    '',
  );
  return lines;
}

/** The report as Markdown tables, one column per arm. */
export function renderReport(reports: ArmReport[], context: { runId: string; cases: number; sources?: CaseSources }): string {
  const head = (title: string) => `| ${title} | ${reports.map((report) => `Arm ${report.arm}`).join(' | ')} |\n|---|${reports.map(() => '---:|').join('')}`;
  const row = (label: string, cell: (report: ArmReport) => string | number) => `| ${label} | ${reports.map((report) => String(cell(report))).join(' | ')} |`;
  const lines: string[] = [
    `# Evaluation report: ${context.runId}`,
    '',
    `Counts with their denominators, as pre-registered in \`evals/PREREGISTRATION.md\`. ${context.cases} cases in the file.`,
    '',
    ...(context.sources ? renderSources(context.sources) : []),
    '## M1 Valid readings',
    '',
    head('Metric'),
    row('Readings that passed every check / cases run', (report) => `${report.validReadings} / ${report.cases}`),
    '',
    '## M2 Decisions (expected → actual, first reading)',
    '',
  ];
  for (const report of reports) {
    lines.push(`Arm ${report.arm}:`, '', '| Expected | plan | clarify | abstain | invalid |', '|---|---:|---:|---:|---:|');
    for (const expected of DECISIONS) {
      const cells = report.confusion[expected];
      lines.push(`| ${expected} | ${cells.plan} | ${cells.clarify} | ${cells.abstain} | ${cells.invalid} |`);
    }
    lines.push(
      '',
      `Matching abstention categories: ${report.abstainCategories.matched} / ${report.abstainCategories.expected}`,
      `Readings the service's scope guard declined: ${report.abstainCategories.byGuard}`,
      '',
    );
  }
  lines.push(
    '## M3 After a scripted answer (the second reading)',
    '',
    head('Decision'),
    row('Runs with an answer', (report) => report.afterAnswer.runs),
    row('Plan', (report) => report.afterAnswer.plan),
    row('Still unclear', (report) => report.afterAnswer.stillUnclear),
    row('Abstain', (report) => report.afterAnswer.abstain),
    row('Invalid reading', (report) => report.afterAnswer.invalid),
    '',
    '## M4 Drafts',
    '',
    head('Drafts'),
    row('Runs that reached drafting', (report) => report.drafts.reached),
    row('First draft well-formed', (report) => `${report.drafts.firstValid} / ${report.drafts.reached}`),
    row('Well-formed after the retry', (report) => report.drafts.validAfterRetry),
    row('Failed twice', (report) => report.drafts.failedTwice),
    row('A draft call failed', (report) => report.drafts.callFailed),
    '',
    '## M5 Scheduling violations',
    '',
    head('Violations'),
    row('Runs the fit stage stopped on checkPlan violations', (report) => report.stoppedByCheck.runs),
    row('Rules broken in those runs', (report) => Object.entries(report.stoppedByCheck.rules).map(([rule, count]) => `${rule} ${count}`).join(', ') || 'none'),
    row('Violations the runner found in ready plans', (report) => report.violationsInReady),
    '',
    '## M6 Code trims',
    '',
    head('Per ready plan'),
    row('Ready plans', (report) => report.trims.plans),
    row('Sessions trimmed (median, max)', (report) => `${report.trims.median}, ${report.trims.max}`),
    row('Weeks over their limits (median, max)', (report) => `${report.trims.weeksOverLimitsMedian}, ${report.trims.weeksOverLimitsMax}`),
    '',
    '## M8 Cost',
    '',
    head('Per run'),
    row('Median', (report) => usd(report.costMicroUsd.median)),
    row('Max', (report) => usd(report.costMicroUsd.max)),
    row('Total', (report) => usd(report.costMicroUsd.total)),
    row('Runs stopped by the harness, not scored', (report) => `${report.harness.runs}, ${usd(report.harness.costMicroUsd)}`),
    '',
    '## M9 Latency at the runner (local service, not the edge)',
    '',
    head('Milliseconds: median / p90 / max (n)'),
    row('Read-goal call', (report) => `${report.latencyMs.read.median} / ${report.latencyMs.read.p90} / ${report.latencyMs.read.max} (${report.latencyMs.read.n})`),
    row('Draft call', (report) => `${report.latencyMs.draft.median} / ${report.latencyMs.draft.p90} / ${report.latencyMs.draft.max} (${report.latencyMs.draft.n})`),
    row('Whole run', (report) => `${report.latencyMs.run.median} / ${report.latencyMs.run.p90} / ${report.latencyMs.run.max} (${report.latencyMs.run.n})`),
    '',
    '## Failed runs by stage and code',
    '',
  );
  for (const report of reports) {
    const entries = Object.entries(report.failed);
    lines.push(`Arm ${report.arm}: ${entries.length === 0 ? 'none' : entries.map(([key, count]) => `${key} ${count}`).join(', ')}`);
  }
  lines.push('', 'M7, the blind rating, is reported separately after unblinding.', '');
  return lines.join('\n');
}
