// Checks the owner's evaluation cases: every problem, the coverage quotas from
// the pre-registration, and cases close to texts used during development.
//
//   node --experimental-strip-types evals/validate.ts evals/cases/cases.jsonl

import { readFileSync } from 'node:fs';
import { contamination, coverage, parseCases } from './lib/cases.ts';

const path = process.argv[2];
if (!path) {
  console.error('usage: node --experimental-strip-types evals/validate.ts <cases.jsonl>');
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
const short = quotas.filter((quota) => quota.count < quota.minimum);
process.exit(problems.length > 0 || short.length > 0 ? 1 : 0);
