// Runs the pre-registered evaluation against locally running services, one per
// arm, and writes evals/runs/<run-id>/ (or evals/dry-runs/<run-id>/ for a dry
// run, which is never evidence).
//
//   CADENCIA_SERVICE_TOKEN=... node --experimental-strip-types evals/run.ts \
//     --cases evals/cases/cases.jsonl --systems evals/systems.json \
//     --run-id 2026-10-01-main --budget-usd 10 [--arms A,B] [--dry-run]

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { coverage, parseCases } from './lib/cases.ts';
import { RunRefused, runEvaluation, type Arm, type RunSummary } from './lib/runner.ts';

const { values } = parseArgs({
  options: {
    cases: { type: 'string' },
    systems: { type: 'string', default: 'evals/systems.json' },
    'run-id': { type: 'string' },
    'budget-usd': { type: 'string' },
    arms: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

const runId = values['run-id'];
const budget = Number(values['budget-usd']);
if (!values.cases || !runId || !/^[A-Za-z0-9._-]{1,60}$/u.test(runId) || !(budget > 0)) {
  fail('usage: evals/run.ts --cases <file> --run-id <id> --budget-usd <dollars> [--systems <file>] [--arms A,B] [--dry-run]');
}
const token = process.env.CADENCIA_SERVICE_TOKEN?.trim();
if (!token) fail('CADENCIA_SERVICE_TOKEN must be set to the local services\' token');

const { cases, problems } = parseCases(readFileSync(values.cases, 'utf8'));
if (problems.length > 0) fail(`the cases have ${problems.length} problems; run evals/validate.ts first`);
const systems = JSON.parse(readFileSync(values.systems, 'utf8')) as { frozen: boolean; arms: Arm[] };
const dryRun = values['dry-run'];
if (!dryRun) {
  if (!systems.frozen) fail('Part B is not frozen; a scored run needs systems.json frozen at tag eval-freeze-v1');
  const short = coverage(cases).filter((quota) => quota.count < quota.minimum);
  if (short.length > 0) fail(`coverage quotas not met: ${short.map((quota) => quota.name).join(', ')}`);
  // The manifest records the commit, so the commit must be all there is.
  const changed = execFileSync('git', ['status', '--porcelain', '--', '.', ':(exclude)evals/runs'], { encoding: 'utf8' }).trim();
  if (changed) fail('commit every change before a scored run (only evals/runs/ may differ)');
}
const wanted = values.arms?.split(',').map((arm) => arm.trim()) ?? systems.arms.map((arm) => arm.id);
const arms = systems.arms.filter((arm) => wanted.includes(arm.id));
if (arms.length !== wanted.length) fail(`unknown arm in ${wanted.join(',')}`);

const outDir = join('evals', dryRun ? 'dry-runs' : 'runs', runId);
mkdirSync(outDir, { recursive: true });
let summary: RunSummary;
try {
  summary = await runEvaluation({
    runId,
    outDir,
    cases,
    arms,
    token,
    budgetMicroUsd: Math.floor(budget * 1_000_000),
    gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    log: (line) => console.log(line),
  });
} catch (error) {
  if (error instanceof RunRefused) fail(`refused: ${error.message}`);
  throw error;
}
console.log(JSON.stringify({ outDir, ...summary }));
