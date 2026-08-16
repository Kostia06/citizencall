/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: '#5B8CFF',
          dim: '#3E5FBE',
          bright: '#8FB0FF',
          glow: 'rgba(91,140,255,0.45)',
        },
        // surface/void/ink read off CSS custom properties (index.css) so
        // they retheme under `[data-theme='light']` with no class changes
        // at call sites — bg-surface/60, text-ink/70 etc. all keep working.
        surface: {
          DEFAULT: 'rgb(var(--color-surface) / <alpha-value>)',
          raised: 'rgb(var(--color-surface-raised) / <alpha-value>)',
          sunken: 'rgb(var(--color-surface-sunken) / <alpha-value>)',
        },
        void: 'rgb(var(--color-void) / <alpha-value>)',
        // Foreground ink scale — white in dark, near-black in light.
        ink: {
          DEFAULT: 'rgb(var(--color-ink) / <alpha-value>)',
        },
        // `white` itself is REMAPPED to the same ink scale. The app's
        // entire dark-mode surface was written as `text-white/NN`,
        // `border-white/NN`, `bg-white/[0.0N]` — hundreds of call sites
        // across every route/component, most outside this slice's file
        // ownership. Rather than hand-edit every file, every one of those
        // classes now resolves through `--color-ink` automatically, so
        // light mode "just works" app-wide without touching them. Any
        // surface that must stay LITERALLY white regardless of theme
        // (logo backing tiles, toggle-switch knobs, text sitting on the
        // constant blue accent chip) uses the new static `paper` token
        // instead — see the audit in the UI/UX task report for the
        // handful of call sites (inside and outside this slice's owned
        // files) that needed that swap.
        white: 'rgb(var(--color-ink) / <alpha-value>)',
        // Static, non-themed white — for surfaces that must stay literally
        // white in both themes (e.g. logo backing tiles behind transparent
        // PNGs, toggle-switch knobs, text on the constant accent chip),
        // where the now-themed `white`/`ink` opacity would otherwise
        // invert them.
        paper: '#ffffff',
        ember: {
          DEFAULT: '#FF8B5E',
          glow: 'rgba(255,139,94,0.4)',
        },
      },
      fontSize: {
        'display-1': ['7rem', { lineHeight: '0.95', letterSpacing: '-0.03em' }],
        'display-2': ['4.5rem', { lineHeight: '1.0', letterSpacing: '-0.02em' }],
        'headline-1': ['clamp(2rem,4.5vw,3.5rem)', { lineHeight: '1.1', letterSpacing: '-0.01em' }],
        'headline-2': ['clamp(1.5rem,3vw,2rem)', { lineHeight: '1.15', letterSpacing: '-0.005em' }],
      },
      boxShadow: {
        lift: '0 8px 30px rgba(0,0,0,0.35)',
        'glow-accent': '0 0 24px rgba(91,140,255,0.35)',
        'glow-ember': '0 0 20px rgba(255,139,94,0.4)',
      },
      backdropBlur: {
        soft: '20px',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"Segoe UI"',
          'Inter',
          'sans-serif',
        ],
        mono: ['"SF Mono"', '"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      keyframes: {
        'bar-in': {
          '0%': { opacity: '0', transform: 'scale(.955)', filter: 'blur(6px)' },
          '100%': { opacity: '1', transform: 'scale(1)', filter: 'blur(0)' },
        },
        'hop-in': {
          '0%': { opacity: '0', transform: 'translateY(10px) scale(.965)', filter: 'blur(3px)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)', filter: 'blur(0)' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-6px)' },
          '40%': { transform: 'translateX(5px)' },
          '60%': { transform: 'translateX(-4px)' },
          '80%': { transform: 'translateX(3px)' },
        },
        breathe: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.55' },
          '50%': { transform: 'scale(1.18)', opacity: '1' },
        },
        'ring-expand': {
          '0%': { transform: 'scale(.6)', opacity: '0.8' },
          '100%': { transform: 'scale(1.9)', opacity: '0' },
        },
        'chip-pop': {
          '0%': { opacity: '0', transform: 'scale(.7) translateY(4px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'fade-crossfade-out': {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        'fade-crossfade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        // New — HopCard failure: synchronized red-tinted glow alongside the
        // existing `shake` keyframe (kept unchanged). DESIGN.md §5 HopCard.
        'fail-flash': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(255,139,94,0)' },
          '20%, 80%': { boxShadow: '0 0 20px 0 rgba(255,139,94,0.4)' },
        },
        // New — command bar confirm pulse on ⏎ — DESIGN.md §6.
        'confirm-pulse': {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.015)' },
          '100%': { transform: 'scale(1)' },
        },
        // New — command bar ⌘K / focus glow — DESIGN.md §5 Command bar.
        'focus-glow-pulse': {
          '0%': { boxShadow: '0 0 0 0 rgba(91,140,255,0.45)' },
          '100%': { boxShadow: '0 0 0 6px rgba(91,140,255,0)' },
        },
        // New — ⇧⏎ bypass-cache tell — DESIGN.md §5 Command bar / §6.
        'ember-edge-flash': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(255,139,94,0)' },
          '50%': { boxShadow: '0 0 20px 2px rgba(255,139,94,0.4)' },
        },
        // New — RunEndSummary total settle pulse — DESIGN.md §5 Cost count-up.
        'count-settle': {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.04)' },
          '100%': { transform: 'scale(1)' },
        },
        // New — canvas background fade-in once the first frame is ready —
        // DESIGN.md §4 step 1/8 (opacity ceiling 0.4–0.55).
        'canvas-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '0.48' },
        },
        // New — full-viewport drag-over accent glow — DESIGN.md §6.
        'drag-glow-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      animation: {
        'bar-in': 'bar-in .55s cubic-bezier(.22,1,.36,1) both',
        'hop-in': 'hop-in .45s cubic-bezier(.22,1,.36,1) both',
        shake: 'shake .45s cubic-bezier(.36,.07,.19,.97) both',
        'shake-glow': 'shake .45s cubic-bezier(.36,.07,.19,.97) both, fail-flash .45s ease both',
        breathe: 'breathe 1.6s ease-in-out infinite',
        'ring-expand': 'ring-expand 1.6s ease-out infinite',
        'chip-pop': 'chip-pop .3s cubic-bezier(.22,1,.36,1) both',
        'confirm-pulse': 'confirm-pulse .2s ease-out both',
        'focus-glow-pulse': 'focus-glow-pulse .4s ease-out both',
        'ember-edge-flash': 'ember-edge-flash .15s ease-out both',
        'count-settle': 'count-settle .2s ease-out both',
        'canvas-in': 'canvas-in .4s ease-out both',
        'drag-glow-in': 'drag-glow-in .3s ease-out both',
      },
    },
  },
  plugins: [],
};
