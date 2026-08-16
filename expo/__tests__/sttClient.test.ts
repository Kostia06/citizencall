import { transcribeAudio, MOCK_TRANSCRIPT } from '../src/api/sttClient';

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as unknown as Response;
}

describe('transcribeAudio', () => {
  it('returns the canned transcript in MOCK mode without touching fetch', async () => {
    const fetchImpl = jest.fn();
    const text = await transcribeAudio({ uri: 'file:///rec.m4a', mock: true, fetchImpl });
    expect(text).toBe(MOCK_TRANSCRIPT);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts a multipart form to /api/stt and returns the trimmed text', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ text: '  do the thing  ' }));
    const text = await transcribeAudio({ uri: 'file:///rec.m4a', mimeType: 'audio/m4a', mock: false, fetchImpl });

    expect(text).toBe('do the thing');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toMatch(/\/api\/stt$/);
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('returns an empty string when the backend reports no speech (not a fallback)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ text: '' }));
    const text = await transcribeAudio({ uri: 'file:///rec.m4a', mock: false, fetchImpl });
    expect(text).toBe('');
  });

  it('falls back to the canned transcript when the backend is unreachable', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('network down'));
    const text = await transcribeAudio({ uri: 'file:///rec.m4a', mock: false, fetchImpl });
    expect(text).toBe(MOCK_TRANSCRIPT);
  });

  it('falls back to the canned transcript on a non-2xx response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ message: 'boom' }, false));
    const text = await transcribeAudio({ uri: 'file:///rec.m4a', mock: false, fetchImpl });
    expect(text).toBe(MOCK_TRANSCRIPT);
  });
});
