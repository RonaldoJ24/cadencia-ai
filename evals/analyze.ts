// Writes <run-dir>/report.md: the pre-registered count tables for every arm,
// after where the cases came from (provenance.jsonl and review.json beside the
// cases file, when present) and any kept case close to a development text.
// Rate the blind pack before reading this report (pre-registration, section 6).
//
//   node --experimental-strip-types evals/analyze.ts --cases evals/cases/cases.jsonl --run evals/runs/<run-id>

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { analyzeArm, renderReport, type CaseSources } from './lib/analyze.ts';
import { contamination, parseCases, parseProvenance, provenanceCounts } from './lib/cases.ts';
import type { ResultLine } from './lib/runner.ts';

const { values } = parseArgs({ options: { cases: { type: 'string' }, run: { type: 'string' } } });
if (!values.cases || !values.run) {
  console.error('usage: evals/analyze.ts --cases <file> --run <run-dir>');
  process.exit(2);
}
const { cases } = parseCases(readFileSync(values.cases, 'utf8'));
const results = readFileSync(join(values.run, 'results.jsonl'), 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as ResultLine);
const manifest = JSON.parse(readFileSync(join(values.run, 'manifest.json'), 'utf8')) as { runId: string; arms: Array<{ id: string }> };

const provenancePath = join(dirname(values.cases), 'provenance.jsonl');
const reviewPath = join(dirname(values.cases), 'review.json');
const review = existsSync(reviewPath) ? (JSON.parse(readFileSync(reviewPath, 'utf8')) as { drafted?: unknown; dropped?: unknown }) : null;
const sources: CaseSources = {
  ...(existsSync(provenancePath) ? { counts: provenanceCounts(parseProvenance(readFileSync(provenancePath, 'utf8'), cases).lines) } : {}),
  ...(review && Number.isInteger(review.drafted) && Number.isInteger(review.dropped)
    ? { review: { drafted: review.drafted as number, dropped: review.dropped as number } }
    : {}),
  closeToDevelopment: contamination(cases).map((item) => ({ id: item.id, similarity: item.similarity })),
};
const report = renderReport(manifest.arms.map((arm) => analyzeArm(arm.id, cases, results)), { runId: manifest.runId, cases: cases.length, sources });
writeFileSync(join(values.run, 'report.md'), report);
console.log(report);
