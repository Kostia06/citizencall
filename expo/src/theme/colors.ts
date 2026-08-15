// Mirrors ui/tailwind.config.js — dark theme only, one accent. Keep values
// identical to the web client so the two feel like the same product.
export const colors = {
  void: '#050506',
  surface: '#1C1C1E',
  surfaceRaised: '#242426',
  surfaceSunken: '#141416',

  hairline: 'rgba(255,255,255,0.08)',
  hairlineBright: 'rgba(255,255,255,0.28)',

  textPrimary: 'rgba(255,255,255,0.92)',
  textSecondary: 'rgba(255,255,255,0.55)',
  textTertiary: 'rgba(255,255,255,0.35)',
  textQuaternary: 'rgba(255,255,255,0.25)',

  accent: '#5B8CFF',
  accentDim: '#3E5FBE',
  accentBright: '#8FB0FF',
  accentGlow: 'rgba(91,140,255,0.45)',

  ember: '#FF8B5E',
  emberGlow: 'rgba(255,139,94,0.4)',

  success: '#34D399', // tailwind emerald-400
  danger: '#F87171', // tailwind red-400
} as const;
