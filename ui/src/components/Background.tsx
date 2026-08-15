import { useEffect, useRef, useState } from 'react';
import { MESH_COLORS } from '../lib/motion';

interface Blob {
  cx: number; // natural center, in internal-canvas fraction (0..1)
  cy: number;
  f1: number;
  f2: number;
  ax: number; // drift amplitude, px (internal resolution)
  ay: number;
  radius: number;
  colorA: string;
  colorB: string;
  phase: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpColor(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bch = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${bch})`;
}

function makeBlobs(w: number, h: number): Blob[] {
  const defs: Array<[number, number, string, string]> = [
    [0.22, 0.28, MESH_COLORS[2], MESH_COLORS[4]], // signal blue -> violet
    [0.75, 0.22, MESH_COLORS[3], MESH_COLORS[2]], // cyan -> blue
    [0.5, 0.65, MESH_COLORS[4], MESH_COLORS[1]], // violet -> indigo
    [0.85, 0.75, MESH_COLORS[1], MESH_COLORS[2]], // indigo -> blue
    [0.15, 0.8, MESH_COLORS[5], MESH_COLORS[4]], // magenta (sparing) -> violet
  ];
  return defs.map(([cx, cy, colorA, colorB], i) => ({
    cx,
    cy,
    f1: 0.05 + i * 0.013,
    f2: 0.037 + i * 0.017,
    ax: w * (0.12 + (i % 3) * 0.03),
    ay: h * (0.12 + (i % 2) * 0.04),
    radius: Math.max(w, h) * (0.32 - i * 0.02),
    colorA,
    colorB,
    phase: i * 1.7,
  }));
}

/** Canvas 2D gradient-mesh background — DESIGN.md §4. Procedural, rAF-driven,
 * no library. Internal resolution stays low; a CSS blur on the element
 * upscales it for free. Cursor biases exactly one blob, never chases it. */
export default function Background() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reduceMotion = reduceMotionMq.matches;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let w = 0;
    let h = 0;
    let blobs: Blob[] = [];

    function resize() {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      w = Math.round(vw * 0.28 * dpr);
      h = Math.round(vh * 0.28 * dpr);
      canvas!.width = w;
      canvas!.height = h;
      blobs = makeBlobs(w, h);
    }
    resize();
    window.addEventListener('resize', resize);

    // Cursor: smoothed toward target via cheap exponential lerp, never a
    // literal chase — DESIGN.md §4 step 4.
    const cursor = { x: w / 2, y: h / 2, targetX: w / 2, targetY: h / 2 };
    function onPointerMove(e: PointerEvent) {
      cursor.targetX = (e.clientX / window.innerWidth) * w;
      cursor.targetY = (e.clientY / window.innerHeight) * h;
    }
    if (!reduceMotion) window.addEventListener('pointermove', onPointerMove);

    function draw(t: number) {
      ctx!.globalCompositeOperation = 'source-over';
      const base = ctx!.createLinearGradient(0, 0, 0, h);
      base.addColorStop(0, MESH_COLORS[0]);
      base.addColorStop(1, '#050506');
      ctx!.fillStyle = base;
      ctx!.fillRect(0, 0, w, h);

      ctx!.globalCompositeOperation = 'lighter';
      blobs.forEach((b, i) => {
        let x = b.cx * w + Math.sin(t * b.f1 + b.phase) * b.ax;
        let y = b.cy * h + Math.cos(t * b.f2 + b.phase) * b.ay;
        if (i === 0) {
          // Bias exactly one blob toward the smoothed cursor, clamped.
          const maxOffset = 120 * dpr * 0.28;
          const dx = Math.max(-maxOffset, Math.min(maxOffset, cursor.x - x));
          const dy = Math.max(-maxOffset, Math.min(maxOffset, cursor.y - y));
          x += dx * 0.5;
          y += dy * 0.5;
        }
        const colorT = (Math.sin(t * b.f1 * 0.5 + b.phase) + 1) / 2;
        const color = lerpColor(b.colorA, b.colorB, colorT);
        const grad = ctx!.createRadialGradient(x, y, 0, x, y, b.radius);
        grad.addColorStop(0, color.replace('rgb', 'rgba').replace(')', ',0.55)'));
        grad.addColorStop(1, color.replace('rgb', 'rgba').replace(')', ',0)'));
        ctx!.fillStyle = grad;
        ctx!.fillRect(0, 0, w, h);
      });
    }

    if (reduceMotion) {
      draw(0);
      setReady(true);
      return () => window.removeEventListener('resize', resize);
    }

    let rafId = 0;
    let frameCount = 0;
    let hidden = document.hidden;
    let announcedReady = false;

    function tick(now: number) {
      rafId = requestAnimationFrame(tick);
      if (hidden) return;
      frameCount++;
      if (frameCount % 2 !== 0) return; // ~30fps throttle
      cursor.x += (cursor.targetX - cursor.x) * 0.06;
      cursor.y += (cursor.targetY - cursor.y) * 0.06;
      draw(now / 1000);
      if (!announcedReady) {
        announcedReady = true;
        setReady(true);
      }
    }
    rafId = requestAnimationFrame(tick);

    function onVisibility() {
      hidden = document.hidden;
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className={`bg-canvas ${ready ? 'animate-canvas-in' : ''}`} aria-hidden />;
}
