import { SseParser } from '../src/lib/sse';

describe('SseParser', () => {
  it('parses a single complete frame', () => {
    const parser = new SseParser();
    const frames = parser.push('id: 1\ndata: {"t":"run_start"}\n\n');
    expect(frames).toEqual([{ id: '1', data: '{"t":"run_start"}' }]);
  });

  it('buffers a frame split across multiple chunks', () => {
    const parser = new SseParser();
    expect(parser.push('data: {"t":"pl')).toEqual([]);
    const frames = parser.push('an"}\n\n');
    expect(frames).toEqual([{ data: '{"t":"plan"}' }]);
  });

  it('parses multiple frames delivered in one chunk', () => {
    const parser = new SseParser();
    const frames = parser.push('data: {"a":1}\n\ndata: {"a":2}\n\n');
    expect(frames.map((f) => f.data)).toEqual(['{"a":1}', '{"a":2}']);
  });

  it('ignores :ping heartbeat comment lines (SPEC.md §13c)', () => {
    const parser = new SseParser();
    const frames = parser.push(':ping\n\ndata: {"a":1}\n\n');
    expect(frames).toEqual([{ data: '{"a":1}' }]);
  });

  it('leaves an incomplete trailing frame in the buffer', () => {
    const parser = new SseParser();
    const frames = parser.push('data: {"a":1}\n\ndata: {"a":2}');
    expect(frames).toEqual([{ data: '{"a":1}' }]);
  });
});
