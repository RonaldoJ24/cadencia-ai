// Writes <run-dir>/report.md: the pre-registered count tables for every arm.
// Rate the blind pack before reading this report (pre-registration, section 6).
//
//   node --experimental-strip-types evals/analyze.ts --cases evals/cases/cases.jsonl --run evals/runs/<run-id>

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { analyzeArm, renderReport } from './lib/analyze.ts';
import { parseCases } from './lib/cases.ts';
import type { ResultLine } from './lib/runner.ts';

const { values } = parseArgs({ options: { cases: { type: 'string' }, run: { type: 'string' } } });
if (!values.cases || !values.run) {
  console.error('usage: evals/analyze.ts --cases <file> --run <run-dir>');
  process.exit(2);
}
const { cases } = parseCases(readFileSync(values.cases, 'utf8'));
const results = readFileSync(join(values.run, 'results.jsonl'), 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as ResultLine);
const manifest = JSON.parse(readFileSync(join(values.run, 'manifest.json'), 'utf8')) as { runId: string; arms: Array<{ id: string }> };
const report = renderReport(manifest.arms.map((arm) => analyzeArm(arm.id, cases, results)), { runId: manifest.runId, cases: cases.length });
writeFileSync(join(values.run, 'report.md'), report);
console.log(report);
