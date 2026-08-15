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
        },
        surface: {
          DEFAULT: '#1c1c1e',
          raised: '#242426',
          sunken: '#141416',
        },
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
      },
      animation: {
        'bar-in': 'bar-in .55s cubic-bezier(.22,1,.36,1) both',
        'hop-in': 'hop-in .45s cubic-bezier(.22,1,.36,1) both',
        shake: 'shake .45s cubic-bezier(.36,.07,.19,.97) both',
        breathe: 'breathe 1.6s ease-in-out infinite',
        'ring-expand': 'ring-expand 1.6s ease-out infinite',
        'chip-pop': 'chip-pop .3s cubic-bezier(.22,1,.36,1) both',
      },
    },
  },
  plugins: [],
};
