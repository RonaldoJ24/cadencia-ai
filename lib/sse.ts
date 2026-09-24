// Minimal server-sent events framing, shared by the route and the browser.

export type SseMessage = { event: string; data: string };

export function formatSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const SSE_HEARTBEAT = ': keepalive\n\n';

/**
 * Incremental parser: feed it chunks as they arrive, in any split. Handles
 * \n, \r\n and \r line endings, comment lines and multi-line data.
 */
export class SseParser {
  private buffer = '';
  private event = '';
  private data: string[] = [];
  private readonly onMessage: (message: SseMessage) => void;

  constructor(onMessage: (message: SseMessage) => void) {
    this.onMessage = onMessage;
  }

  push(chunk: string): void {
    this.buffer += chunk;
    this.drain(false);
  }

  /** Call once the stream ends; a final message needs its blank line. */
  end(): void {
    this.drain(true);
  }

  private drain(final: boolean): void {
    for (;;) {
      const match = /\r\n|\n|\r/u.exec(this.buffer);
      if (!match) break;
      // A trailing \r may be the first half of \r\n split across chunks.
      if (match[0] === '\r' && match.index === this.buffer.length - 1 && !final) break;
      const line = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      this.line(line);
    }
    if (final && this.buffer) {
      this.line(this.buffer);
      this.buffer = '';
    }
  }

  private line(line: string): void {
    if (line === '') {
      if (this.data.length > 0) {
        this.onMessage({ event: this.event || 'message', data: this.data.join('\n') });
      }
      this.event = '';
      this.data = [];
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /u, '');
    if (field === 'event') this.event = value;
    else if (field === 'data') this.data.push(value);
  }
}

/**
 * Reads a streamed response body, calling onMessage for each event and
 * onChunk for every chunk received, heartbeats included.
 */
export async function readSse(
  body: ReadableStream<Uint8Array>,
  onMessage: (message: SseMessage) => void,
  onChunk?: () => void,
): Promise<void> {
  const parser = new SseParser(onMessage);
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk?.();
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.end();
  } finally {
    reader.releaseLock();
  }
}
