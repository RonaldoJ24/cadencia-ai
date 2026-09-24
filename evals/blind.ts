// Makes the blind rating pack for two arms of a run: <run-dir>/rating-pack.json
// for evals/rate/index.html, and <run-dir>/rating-key.json, which the page
// never loads. The seed is random unless given, and is written only to the key.
//
//   node --experimental-strip-types evals/blind.ts --cases evals/cases/cases.jsonl \
//     --run evals/runs/<run-id> --arms A,B [--seed <integer>]

import { randomInt } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { makePack } from './lib/blind.ts';
import { parseCases } from './lib/cases.ts';
import type { ResultLine } from './lib/runner.ts';

const { values } = parseArgs({ options: { cases: { type: 'string' }, run: { type: 'string' }, arms: { type: 'string', default: 'A,B' }, seed: { type: 'string' } } });
const arms = values.arms.split(',').map((arm) => arm.trim());
const seed = values.seed === undefined ? randomInt(2 ** 32) : Number(values.seed);
if (!values.cases || !values.run || arms.length !== 2 || !Number.isInteger(seed)) {
  console.error('usage: evals/blind.ts --cases <file> --run <run-dir> --arms A,B [--seed <integer>]');
  process.exit(2);
}
const { cases } = parseCases(readFileSync(values.cases, 'utf8'));
const results = readFileSync(join(values.run, 'results.jsonl'), 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as ResultLine);
const runId = (JSON.parse(readFileSync(join(values.run, 'manifest.json'), 'utf8')) as { runId: string }).runId;
const { pack, key } = makePack(cases, results, [arms[0], arms[1]], seed, runId);
writeFileSync(join(values.run, 'rating-pack.json'), `${JSON.stringify(pack)}\n`);
writeFileSync(join(values.run, 'rating-key.json'), `${JSON.stringify(key, null, 2)}\n`);
console.log(`${pack.items.length} pairs in ${join(values.run, 'rating-pack.json')}. Do not open rating-key.json until the ratings are exported.`);
