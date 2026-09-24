// Checks the evaluation cases: every problem, the coverage quotas from the
// pre-registration, cases close to texts used during development, and, when
// given, the provenance file and the review.json beside it (evals/cases/SOURCING.md).
// Drafts are checked without them.
//
//   node --experimental-strip-types evals/validate.ts evals/cases/cases.jsonl [evals/cases/provenance.jsonl]

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { contamination, coverage, parseCases, parseProvenance, parseReviewSummary, provenanceCounts } from './lib/cases.ts';

const path = process.argv[2];
const provenancePath = process.argv[3];
if (!path) {
  console.error('usage: node --experimental-strip-types evals/validate.ts <cases.jsonl> [provenance.jsonl]');
  process.exit(2);
}

const { cases, problems } = parseCases(readFileSync(path, 'utf8'));
for (const problem of problems) {
  console.log(`line ${problem.line}${problem.id ? ` (${problem.id})` : ''}: ${problem.message}`);
}
console.log(`\n${cases.length} valid cases, ${problems.length} problems\n`);
const quotas = coverage(cases);
for (const quota of quotas) {
  console.log(`${quota.count >= quota.minimum ? 'ok  ' : 'SHORT'} ${quota.name}: ${quota.count} (minimum ${quota.minimum})`);
}
const flagged = contamination(cases);
if (flagged.length > 0) {
  console.log('\nClose to development texts (keep or rewrite; kept ones are reported with the results):');
  for (const item of flagged) console.log(`  ${item.id}: word overlap ${item.similarity} with "${item.text}"`);
}
let provenanceProblems = 0;
if (provenancePath) {
  const provenance = parseProvenance(readFileSync(provenancePath, 'utf8'), cases);
  provenanceProblems = provenance.problems.length;
  console.log(`\nProvenance: ${provenance.lines.length} lines, ${provenanceProblems} problems`);
  for (const problem of provenance.problems) {
    console.log(`  ${problem.line > 0 ? `line ${problem.line}${problem.id ? ` (${problem.id})` : ''}: ` : ''}${problem.message}`);
  }
  for (const item of provenanceCounts(provenance.lines)) console.log(`  ${item.name}: ${item.count}`);
  // review.json sits beside the provenance file (SOURCING.md, Audit and owner check).
  const reviewPath = join(dirname(provenancePath), 'review.json');
  const review = existsSync(reviewPath)
    ? parseReviewSummary(JSON.parse(readFileSync(reviewPath, 'utf8')), cases)
    : { problems: [`no review.json beside ${provenancePath}`] };
  provenanceProblems += review.problems.length;
  for (const problem of review.problems) console.log(`  review.json: ${problem}`);
  if (review.summary) {
    const { drafted, dropped, spotCheck } = review.summary;
    console.log(`  drafts ${drafted}, dropped ${dropped}; owner agreed with ${spotCheck.agreed} of ${spotCheck.ids.length} random labels`);
  }
}
const short = quotas.filter((quota) => quota.count < quota.minimum);
process.exit(problems.length > 0 || short.length > 0 || provenanceProblems > 0 ? 1 : 0);
