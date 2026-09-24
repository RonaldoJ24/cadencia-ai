// Unblinds exported ratings with the pack's key and writes <run-dir>/ratings.md
// (M7): preferences and the score counts for each arm.
//
//   node --experimental-strip-types evals/unblind.ts --run evals/runs/<run-id> --ratings <ratings.json>

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { unblind, type PackKey, type Ratings } from './lib/blind.ts';

const { values } = parseArgs({ options: { run: { type: 'string' }, ratings: { type: 'string' } } });
if (!values.run || !values.ratings) {
  console.error('usage: evals/unblind.ts --run <run-dir> --ratings <ratings.json>');
  process.exit(2);
}
const key = JSON.parse(readFileSync(join(values.run, 'rating-key.json'), 'utf8')) as PackKey;
const ratings = JSON.parse(readFileSync(values.ratings, 'utf8')) as Ratings;
const table = unblind(key, ratings);
const [a, b] = key.arms;
const statements = { fit: 'It fits my constraints', progression: 'The progression makes sense', clarity: 'The sessions are clear and doable' } as const;
const lines = [
  `# Blind rating: ${key.pack}`,
  '',
  `One rater (${ratings.rater}), ${table.pairs} rated pairs out of ${key.items.length} (${table.unrated} unrated), rated ${ratings.ratedAt}.`,
  '',
  '| Preferred | Pairs |',
  '|---|---:|',
  `| Arm ${a} | ${table.preferred[a]} |`,
  `| Arm ${b} | ${table.preferred[b]} |`,
  `| About the same | ${table.preferred.tie} |`,
  '',
  'Scores per plan, counts of 1 / 2 / 3 / 4 / 5:',
  '',
  `| Statement | Arm ${a} | Arm ${b} |`,
  '|---|---|---|',
  ...(Object.keys(statements) as Array<keyof typeof statements>).map((statement) =>
    `| ${statements[statement]} | ${table.scores[a][statement].join(' / ')} | ${table.scores[b][statement].join(' / ')} |`),
  '',
];
writeFileSync(join(values.run, 'ratings.md'), lines.join('\n'));
console.log(lines.join('\n'));
