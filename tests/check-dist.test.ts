import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findLocalPaths } from '../scripts/check-dist.mjs';

function buildOutput(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cadencia-dist-'));
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(root, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

void test('flags a font URL that points at a local folder', () => {
  const root = buildOutput({
    'server/index.js': 'src: url(/Users/someone/old-folder/.vinext/fonts/geist/geist.woff2)',
    'client/_next/static/app.css': 'body { font-family: Geist; }',
  });
  const findings = findLocalPaths(root);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, path.join('server', 'index.js'));
  assert.match(findings[0].match, /^\/Users\/someone\//u);
});

void test('accepts clean output and ignores the deploy config and binary assets', () => {
  const root = buildOutput({
    'server/index.js': 'src: url(/_next/static/_vinext_fonts/geist/geist.woff2)',
    'server/wrangler.json': '{"configPath":"/home/runner/work/cadencia/wrangler.jsonc"}',
    'client/font.woff2': '/Users/binary-noise/',
  });
  assert.deepEqual(findLocalPaths(root), []);
});

void test('flags Linux home, temp and Windows user paths', () => {
  const root = buildOutput({
    'a.js': '"/home/runner/work/app/file.ts"',
    'b.js': '"/private/tmp/build/file.ts"',
    'c.js': '"C:\\\\Users\\\\dev\\\\app"',
  });
  assert.equal(findLocalPaths(root).length, 3);
});
