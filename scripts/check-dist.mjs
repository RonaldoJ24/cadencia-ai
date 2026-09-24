#!/usr/bin/env node

// Fails the build when the deployable output contains an absolute path from
// the machine that built it. A stale .vinext font cache copied from another
// folder did exactly that: the live page pointed its fonts at the old local
// path, leaking folder names and serving 404s.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The generated deploy config records its own location; it is read by
// Wrangler, never served to visitors.
const IGNORED_FILES = [path.join('server', 'wrangler.json')];
const BINARY = /\.(?:woff2?|ttf|otf|png|jpe?g|gif|webp|avif|ico)$/iu;
const LOCAL_PATH = /\/Users\/[^/\s"'`)]+\/|\/home\/[^/\s"'`)]+\/|\/private\/(?:tmp|var)\/|[A-Za-z]:\\{1,2}Users\\{1,2}/u;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

export function findLocalPaths(root) {
  const ignored = new Set(IGNORED_FILES.map((file) => path.join(root, file)));
  const findings = [];
  for (const file of walk(root)) {
    if (ignored.has(file) || BINARY.test(file)) continue;
    const match = LOCAL_PATH.exec(fs.readFileSync(file, 'utf8'));
    if (match) findings.push({ file: path.relative(root, file), match: match[0] });
  }
  return findings;
}

function main() {
  const root = path.resolve(process.argv[2] ?? 'dist');
  if (!fs.existsSync(root)) {
    console.error(`check-dist: ${root} does not exist; run the build first.`);
    process.exit(1);
  }
  const findings = findLocalPaths(root);
  if (findings.length > 0) {
    console.error('check-dist: the build contains absolute local paths:');
    for (const { file, match } of findings) console.error(`  ${file}: ${match}`);
    console.error('Delete the .vinext cache (rm -rf .vinext) and build again.');
    process.exit(1);
  }
  console.log('check-dist: no local paths in the build output.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
