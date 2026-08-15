// ElevenLabs Scribe speech-to-text proxy (SPEC.md §7 voice input). The
// worker fronts the API so the ELEVENLABS_API_KEY never reaches a client;
// browsers post MediaRecorder blobs (webm/ogg/wav) to POST /api/stt.
const ELEVENLABS_STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';
const STT_MODEL_ID = 'scribe_v1';

// 15MB cap — comfortably above a few minutes of MediaRecorder audio while
// keeping the worker from buffering unbounded uploads.
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

export class SttUpstreamError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(`ElevenLabs STT failed (${status}): ${detail}`);
    this.name = 'SttUpstreamError';
    this.status = status;
  }
}

interface ScribeResponse {
  text?: string;
}

// Proxies one audio file to ElevenLabs Scribe and returns the transcript.
// Throws SttUpstreamError on any upstream failure (non-2xx, or a 2xx body
// without a transcript) so the route can answer a clean 502.
export async function transcribeAudio(apiKey: string, audio: File): Promise<string> {
  const form = new FormData();
  form.append('model_id', STT_MODEL_ID);
  form.append('file', audio, audio.name || 'audio');

  // No explicit Content-Type header: fetch derives the multipart boundary
  // from the FormData body itself.
  const res = await fetch(ELEVENLABS_STT_URL, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new SttUpstreamError(res.status, detail.slice(0, 300));
  }

  const body = (await res.json().catch(() => null)) as ScribeResponse | null;
  if (typeof body?.text !== 'string') {
    throw new SttUpstreamError(res.status, 'upstream response had no transcript text');
  }
  return body.text;
}
