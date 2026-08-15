// Ported from ui/src/components/Mic.tsx's fetch-to-/api/stt round trip —
// multipart POST of the recorded clip, `{ text }` back. MOCK mode (or any
// failure reaching the backend) falls over to a canned transcript so the
// mic stays demoable with zero network, same withMockFallback contract as
// authClient/storeClient.
import { API_BASE, MOCK } from './config';

export const MOCK_TRANSCRIPT = 'Summarize open pull requests and flag anything that needs review.';

export interface TranscribeOpts {
  /** Local file uri of the recorded clip (expo-audio's `recorder.uri`). */
  uri: string;
  mimeType?: string;
  /** Injectable for tests — default to the module's MOCK flag / global fetch. */
  mock?: boolean;
  fetchImpl?: typeof fetch;
}

function extFor(mimeType?: string): string {
  if (mimeType?.includes('m4a') || mimeType?.includes('mp4')) return 'm4a';
  if (mimeType?.includes('wav')) return 'wav';
  return 'caf';
}

/** Posts the recorded clip to `${API_BASE}/api/stt` and resolves to the
 * transcript text. An empty string means "no speech detected" — a normal,
 * non-error outcome the caller toasts, not a failure. A genuine network/
 * backend failure falls back to MOCK_TRANSCRIPT rather than throwing, so a
 * flaky connection never dead-ends the mic mid-demo. */
export async function transcribeAudio(opts: TranscribeOpts): Promise<string> {
  const mock = opts.mock ?? MOCK;
  if (mock) return MOCK_TRANSCRIPT;

  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const form = new FormData();
    // React Native's FormData accepts this { uri, name, type } shape in
    // place of a Blob — Metro's fetch polyfill reads the file at `uri`
    // directly, unlike the web client's in-memory Blob from MediaRecorder.
    form.append('audio', {
      uri: opts.uri,
      name: `recording.${extFor(opts.mimeType)}`,
      type: opts.mimeType ?? 'audio/m4a',
    } as unknown as Blob);

    const res = await doFetch(`${API_BASE}/api/stt`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`POST /api/stt failed: ${res.status}`);
    const body = (await res.json()) as { text?: string };
    return body.text?.trim() ?? '';
  } catch (err) {
    console.warn('[stt] backend unreachable, falling back to canned transcript', err);
    return MOCK_TRANSCRIPT;
  }
}
