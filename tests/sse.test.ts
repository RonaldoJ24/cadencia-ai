import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSse, SSE_HEARTBEAT, SseParser, type SseMessage } from '../lib/sse.ts';

function parseAll(chunks: string[]): SseMessage[] {
  const messages: SseMessage[] = [];
  const parser = new SseParser((message) => messages.push(message));
  for (const chunk of chunks) parser.push(chunk);
  parser.end();
  return messages;
}

const stream = [
  formatSse('stage', { stage: 'draft', status: 'started' }),
  SSE_HEARTBEAT,
  formatSse('result', { outcome: 'ready', text: 'línea con acento' }),
].join('');

void test('formatted events parse back in one chunk', () => {
  assert.deepEqual(parseAll([stream]), [
    { event: 'stage', data: '{"stage":"draft","status":"started"}' },
    { event: 'result', data: '{"outcome":"ready","text":"línea con acento"}' },
  ]);
});

void test('events split at every possible position parse the same', () => {
  const expected = parseAll([stream]);
  for (let cut = 1; cut < stream.length; cut += 1) {
    assert.deepEqual(parseAll([stream.slice(0, cut), stream.slice(cut)]), expected, `split at ${cut}`);
  }
});

void test('CRLF and CR line endings, comments and multi-line data are handled', () => {
  const crlf = stream.replace(/\n/gu, '\r\n');
  assert.deepEqual(parseAll([crlf]), parseAll([stream]));
  // A \r\n split between chunks must not produce an extra blank line.
  assert.deepEqual(parseAll(['event: a\r', '\ndata: 1\r\n\r\n']), [{ event: 'a', data: '1' }]);
  assert.deepEqual(parseAll(['event: a\rdata: 1\r\r']), [{ event: 'a', data: '1' }]);
  assert.deepEqual(parseAll([': comment\ndata: x\ndata: y\n\n']), [{ event: 'message', data: 'x\ny' }]);
});

void test('an unterminated final event is not dispatched', () => {
  assert.deepEqual(parseAll(['event: stage\ndata: {}']), []);
});
