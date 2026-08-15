import { useEffect, useRef, useState } from 'react';

interface MicProps {
  onInterim(text: string): void;
  onFinal(text: string): void;
  onToast(message: string): void;
  disabled?: boolean;
}

// Web Speech API — SPEC.md §7.2. Chrome/Edge only; Electron throws a
// `network` error because Google's Speech API keys aren't shipped (§7.3).
function getSpeechRecognition(): (new () => any) | undefined {
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
}

/** Mic button — 5th element in the pill. Idle: grey glyph. Recording: red
 * dot, breathing ring, 5-bar AnalyserNode waveform. Degrades to type-only
 * on unsupported browsers or a denied permission. */
export default function Mic({ onInterim, onFinal, onToast, disabled }: MicProps) {
  const [recording, setRecording] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const recognitionRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!getSpeechRecognition()) setUnsupported(true);
    return () => {
      stop();
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
        const barHeight = Math.max(2, avg * canvas.height);
        const x = i * (canvas.width / bars) + 1;
        const y = (canvas.height - barHeight) / 2;
        ctx.fillStyle = 'rgba(91,140,255,0.9)';
        ctx.fillRect(x, y, canvas.width / bars - 2, barHeight);
      }
      rafRef.current = requestAnimationFrame(render);
    };
    rafRef.current = requestAnimationFrame(render);
  }

  async function startWaveform() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      drawWaveform();
    } catch {
      // Waveform is decoration — speech recognition works without it.
    }
  }

  function stopWaveform() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => undefined);
    streamRef.current = null;
    audioCtxRef.current = null;
    analyserRef.current = null;
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && canvasRef.current) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  }

  function start() {
    const SR = getSpeechRecognition();
    if (!SR) {
      setUnsupported(true);
      onToast('Speech unavailable — type instead');
      return;
    }
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onresult = (e: any) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        e.results[i].isFinal ? (final += t) : (interim += t);
      }
      if (final) onFinal(final);
      else onInterim(interim);
    };
    rec.onerror = (e: any) => {
      onToast(e.error === 'not-allowed' ? 'Microphone blocked' : 'Speech unavailable — type instead');
      setRecording(false);
      stopWaveform();
    };
    rec.onend = () => {
      setRecording(false);
      stopWaveform();
    };

    recognitionRef.current = rec;
    rec.start();
    setRecording(true);
    startWaveform();
  }

  function stop() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setRecording(false);
    stopWaveform();
  }

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
      <button
        type="button"
        disabled={disabled}
        aria-label={recording ? 'Stop recording' : unsupported ? 'Voice unavailable' : 'Start voice input'}
        onClick={() => (recording ? stop() : start())}
        className="flex h-8 w-8 items-center justify-center rounded-full text-[#8E8E93] transition-colors hover:text-white disabled:opacity-30"
      >
        {recording ? (
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
            <rect x="9" y="2.5" width="6" height="11" rx="3" />
            <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" strokeLinecap="round" />
          </svg>
        )}
      </button>
    </div>
  );
}
