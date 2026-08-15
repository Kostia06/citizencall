// POST /api/stt — ElevenLabs Scribe proxy (providers/elevenlabs.ts).
// Upstream is mocked with cloudflare:test's fetchMock (undici MockAgent
// wired into workerd's outbound fetch), so no test ever hits the real API.
import { env, fetchMock } from 'cloudflare:test';
import { afterEach, beforeAll, expect, it } from 'vitest';
import app from '../src/index';

const sttEnv = { ...env, ELEVENLABS_API_KEY: 'test-elevenlabs-key' };

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

function audioForm(bytes: number, name = 'clip.webm', type = 'audio/webm'): FormData {
  const form = new FormData();
  form.append('audio', new File([new Uint8Array(bytes)], name, { type }));
  return form;
}

function interceptScribe() {
  return fetchMock.get('https://api.elevenlabs.io').intercept({ method: 'POST', path: '/v1/speech-to-text' });
}

it('transcribes a multipart audio field and sets the anon cookie', async () => {
  interceptScribe().reply(200, JSON.stringify({ text: 'hello understudy' }), {
    headers: { 'Content-Type': 'application/json' },
  });

  const res = await app.request('/api/stt', { method: 'POST', body: audioForm(2048) }, sttEnv);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ text: 'hello understudy' });
  // No auth required, but the request still participates in the anon
  // cookie session (rate-limit attribution later).
  expect(res.headers.get('Set-Cookie')).toMatch(/^__Host-anon=/);
});

it('400s without an audio file field', async () => {
  const noField = new FormData();
  noField.append('audio', 'a string, not a file');
  const res = await app.request('/api/stt', { method: 'POST', body: noField }, sttEnv);
  expect(res.status).toBe(400);

  const notMultipart = await app.request(
    '/api/stt',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    sttEnv
  );
  expect(notMultipart.status).toBe(400);
});

it('413s past the 15MB cap without calling upstream', async () => {
  const res = await app.request('/api/stt', { method: 'POST', body: audioForm(15 * 1024 * 1024 + 1) }, sttEnv);
  expect(res.status).toBe(413);
});

it('502s with {error} when upstream fails', async () => {
  interceptScribe().reply(500, 'scribe exploded');
  const res = await app.request('/api/stt', { method: 'POST', body: audioForm(1024) }, sttEnv);
  expect(res.status).toBe(502);
  const body = await res.json<{ error: string }>();
  expect(body.error).toContain('500');
});

it('502s when upstream 200s without a transcript', async () => {
  interceptScribe().reply(200, JSON.stringify({ unexpected: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
  const res = await app.request('/api/stt', { method: 'POST', body: audioForm(1024) }, sttEnv);
  expect(res.status).toBe(502);
});

it('503s (fail closed) when ELEVENLABS_API_KEY is unset', async () => {
  const res = await app.request('/api/stt', { method: 'POST', body: audioForm(1024) }, env);
  expect(res.status).toBe(503);
});
