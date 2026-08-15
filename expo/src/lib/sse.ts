// Minimal SSE frame parser for React Native's streaming fetch (`expo/fetch`)
// — there is no native EventSource in RN, and expo/fetch gives us a
// ReadableStream of raw bytes/text instead. This does the same job
// EventSource does internally: buffer text, split on blank-line-terminated
// frames, extract `data:`/`id:` fields, ignore comment lines (`:ping`
// heartbeats per SPEC.md §13(c)).
//
// Pragmatic choice over polling: the worker already speaks SSE (`/api/run/
// :id/stream`), so re-parsing the same wire format here is less surface
// area than reshaping the server response into a poll-friendly one, and it
// preserves live, per-hop streaming instead of a coarse "done yet?" loop.
export interface SseFrame {
  id?: string;
  data: string;
}

export class SseParser {
  private buffer = '';

  /** Feed a raw text chunk; returns any complete frames it produced. */
  push(chunk: string): SseFrame[] {
    this.buffer += chunk;
    const frames: SseFrame[] = [];
    let sepIndex: number;
    // Frames are separated by a blank line (\n\n); tolerate \r\n too.
    while ((sepIndex = this.buffer.search(/\r?\n\r?\n/)) !== -1) {
      const raw = this.buffer.slice(0, sepIndex);
      const match = this.buffer.slice(sepIndex).match(/^\r?\n\r?\n/);
      this.buffer = this.buffer.slice(sepIndex + (match?.[0].length ?? 2));
      const frame = parseFrame(raw);
      if (frame) frames.push(frame);
    }
    return frames;
  }
}

function parseFrame(raw: string): SseFrame | null {
  const lines = raw.split(/\r?\n/);
  let id: string | undefined;
  const dataLines: string[] = [];
  for (const line of lines) {
    if (!line || line.startsWith(':')) continue; // comment / heartbeat
    if (line.startsWith('id:')) id = line.slice(3).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  return { id, data: dataLines.join('\n') };
}
