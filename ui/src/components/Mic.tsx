import { useEffect, useRef, useState } from 'react';
import { API_BASE, MOCK } from '../api';

interface MicProps {
  onInterim(text: string): void;
  onFinal(text: string): void;
  onToast(message: string): void;
  disabled?: boolean;
}

type Phase = 'idle' | 'recording' | 'transcribing';

// Canned result for MOCK mode / no-backend demos — ElevenLabs STT round trip
// has nothing to talk to, so this keeps the mic fully demoable.
const MOCK_TRANSCRIPT = 'Summarize open pull requests and flag anything that needs review.';

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return undefined;
  for (const type of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

function extFor(mimeType?: string): string {
  if (mimeType?.includes('mp4')) return 'mp4';
  return 'webm';
}

/** Mic button — 5th element in the pill. Idle: grey glyph. Recording: red
 * dot, breathing ring, 5-bar AnalyserNode waveform (unchanged, decorative —
 * it never sees the recorded audio, only a live monitoring stream).
 * Transcribing: brief pulsing label between "stop" and the transcript
 * landing. Records via MediaRecorder and posts the blob to
 * `${API_BASE}/api/stt` (ElevenLabs STT behind the Worker) — MOCK mode (or
 * no backend reachable) fails over to a canned transcript so the bar stays
 * demoable with zero network. Degrades to type-only when MediaRecorder or
 * mic permission is unavailable. */
export default function Mic({ onInterim, onFinal, onToast, disabled }: MicProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [unsupported, setUnsupported] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  // Browser-local LIVE interim transcript while recording (display-only via
  // onInterim); ElevenLabs stays the authoritative FINAL transcript. Chrome/
  // Safari only — recording works identically without it, just no live text.
  const recognizerRef = useRef<{ stop(): void } | null>(null);
  // Chunked interim STT for browsers with NO SpeechRecognition (Firefox/Zen):
  // every ~2.5s the accumulated audio is posted to /api/stt for a partial
  // transcript. Serialized (skip while a request is in flight); the on-stop
  // final transcription stays authoritative.
  const interimTimerRef = useRef<number | undefined>(undefined);
  const interimInFlightRef = useRef(false);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string | undefined>(undefined);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const barHeightsRef = useRef<number[]>([0, 0, 0, 0, 0]);

  useEffect(() => {
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) setUnsupported(true);
    return () => {
      mediaRecorderRef.current?.stop();
      teardownStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function drawWaveform() {
    const analyser = analyserRef.current;
    const canvas = canvasRef.current;
    if (!analyser || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const data = new Uint8Array(analyser.frequencyBinCount);

    const render = () => {
      analyser.getByteFrequencyData(data);
      const bars = 5;
      const bucket = Math.floor(data.length / bars);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < bars; i++) {
        let sum = 0;
        for (let j = 0; j < bucket; j++) sum += data[i * bucket + j];
        const avg = sum / bucket / 255; // 0..1
        const targetHeight = Math.max(2, avg * canvas.height);
        // Per-bar smoothing so bars settle instead of jitter frame-to-frame
        // — DESIGN.md §5 Mic.
        const prev = barHeightsRef.current[i] ?? targetHeight;
        const barHeight = prev + (targetHeight - prev) * 0.35;
        barHeightsRef.current[i] = barHeight;
        const x = i * (canvas.width / bars) + 1;
        const y = (canvas.height - barHeight) / 2;
        ctx.fillStyle = 'rgba(91,140,255,0.9)';
        ctx.fillRect(x, y, canvas.width / bars - 2, barHeight);
      }
      rafRef.current = requestAnimationFrame(render);
    };
    rafRef.current = requestAnimationFrame(render);
  }

  function attachAnalyser(stream: MediaStream) {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      drawWaveform();
    } catch {
      // Waveform is decoration — recording works without it.
    }
  }

  function teardownStream() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => undefined);
    streamRef.current = null;
    audioCtxRef.current = null;
    analyserRef.current = null;
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && canvasRef.current) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  }

  async function start() {
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setUnsupported(true);
      onToast('Voice unavailable — type instead');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      mimeTypeRef.current = mimeType;
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        void finishRecording();
      };
      mediaRecorderRef.current = recorder;
      // 1s timeslice so chunksRef grows during recording — the chunked
      // interim path needs data before stop() (webm chunks are only valid
      // concatenated from the start, so we always send the full prefix).
      recorder.start(1000);
      setPhase('recording');
      attachAnalyser(stream);
      startInterimRecognition();
      if (!recognizerRef.current && !MOCK) startChunkedInterim();
    } catch {
      onToast('Microphone blocked');
      setPhase('idle');
    }
  }

  function stop() {
    // onstop (assembles the blob + kicks off transcription) fires
    // asynchronously off this call.
    if (interimTimerRef.current) window.clearInterval(interimTimerRef.current);
    interimTimerRef.current = undefined;
    recognizerRef.current?.stop();
    recognizerRef.current = null;
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
  }

  /** Cross-browser live transcript: POST the accumulated audio every ~2.5s
   * for a partial transcript (Firefox/Zen have no SpeechRecognition). Costs
   * one STT call per tick — bounded by the recording length. */
  function startChunkedInterim() {
    if (interimTimerRef.current) window.clearInterval(interimTimerRef.current);
    interimTimerRef.current = window.setInterval(async () => {
      if (interimInFlightRef.current) return;
      const chunks = chunksRef.current;
      if (chunks.length === 0) return;
      interimInFlightRef.current = true;
      try {
        const blob = new Blob(chunks, { type: mimeTypeRef.current ?? chunks[0].type ?? 'audio/webm' });
        const form = new FormData();
        form.append('audio', blob, 'interim.webm');
        const res = await fetch(`${API_BASE}/api/stt`, { method: 'POST', body: form, credentials: 'include' });
        if (res.ok) {
          const body = (await res.json()) as { text?: string };
          // Still recording? (stop() clears the timer, but a request may
          // resolve after.) Only then surface the partial.
          if (interimTimerRef.current && body.text?.trim()) onInterim(body.text.trim());
        }
      } catch {
        /* interim is best-effort */
      } finally {
        interimInFlightRef.current = false;
      }
    }, 2500);
  }

  /** Live interim words while recording — SpeechRecognition where available.
   * Errors/absence are silent: the ElevenLabs path is unaffected. */
  function startInterimRecognition() {
    type SR = { new (): { continuous: boolean; interimResults: boolean; lang: string; onresult: (e: { results: ArrayLike<{ 0: { transcript: string } }> }) => void; onerror: () => void; start(): void; stop(): void } };
    const Ctor = (window as unknown as { SpeechRecognition?: SR; webkitSpeechRecognition?: SR }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SR }).webkitSpeechRecognition;
    if (!Ctor) return;
    try {
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = navigator.language || 'en-US';
      rec.onresult = (e) => {
        const text = Array.from({ length: e.results.length }, (_, i) => e.results[i]![0].transcript).join('');
        if (text.trim()) onInterim(text);
      };
      rec.onerror = () => undefined;
      rec.start();
      recognizerRef.current = rec;
    } catch {
      /* no live transcript — fine */
    }
  }

  async function finishRecording() {
    const mimeType = mimeTypeRef.current;
    teardownStream();
    const chunks = chunksRef.current;
    chunksRef.current = [];

    if (chunks.length === 0) {
      setPhase('idle');
      onToast('No audio captured');
      return;
    }

    setPhase('transcribing');
    const blob = new Blob(chunks, { type: mimeType ?? chunks[0].type ?? 'audio/webm' });

    if (MOCK) {
      window.setTimeout(() => {
        setPhase('idle');
        onFinal(MOCK_TRANSCRIPT);
      }, 1000);
      return;
    }

    try {
      const form = new FormData();
      form.append('audio', blob, `recording.${extFor(mimeType)}`);
      const res = await fetch(`${API_BASE}/api/stt`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(`POST /api/stt failed: ${res.status}`);
      const body = (await res.json()) as { text?: string };
      setPhase('idle');
      if (body.text?.trim()) onFinal(body.text.trim());
      else onToast('No speech detected');
    } catch {
      setPhase('idle');
      onToast('Transcription failed — type instead');
    }
  }

  const recording = phase === 'recording';
  const transcribing = phase === 'transcribing';

  return (
    <div className="relative flex items-center justify-center">
      {recording && (
        <>
          <span className="absolute h-8 w-8 rounded-full bg-red-500/25 animate-breathe" />
          <canvas
            ref={canvasRef}
            width={36}
            height={18}
            className="absolute -left-10 top-1/2 -translate-y-1/2"
            aria-hidden
          />
        </>
      )}
      {transcribing && (
        <span className="absolute -left-[4.75rem] top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] text-white/40 animate-pulse">
          Transcribing…
        </span>
      )}
      <button
        type="button"
        disabled={disabled || transcribing}
        aria-label={recording ? 'Stop recording' : transcribing ? 'Transcribing' : unsupported ? 'Voice unavailable' : 'Start voice input'}
        onClick={() => (recording ? stop() : start())}
        className="relative flex h-8 w-8 items-center justify-center rounded-full text-[#8E8E93] transition-colors hover:text-white disabled:opacity-30"
      >
        {/* Idle→recording crossfade, 150ms — DESIGN.md §5 Mic. All three
            glyphs stay mounted and swap opacity rather than instant-swap. */}
        <span
          className={`absolute inset-0 flex items-center justify-center transition-opacity duration-150 ease-out ${
            recording ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
        </span>
        <span
          className={`absolute inset-0 flex items-center justify-center transition-opacity duration-150 ease-out ${
            transcribing ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.7px] border-accent/30 border-t-accent" />
        </span>
        <span
          className={`absolute inset-0 flex items-center justify-center transition-opacity duration-150 ease-out ${
            !recording && !transcribing ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
            <rect x="9" y="2.5" width="6" height="11" rx="3" />
            <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" strokeLinecap="round" />
          </svg>
        </span>
      </button>
    </div>
  );
}
