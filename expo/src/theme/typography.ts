import type { TextStyle } from 'react-native';

// Subset of ui/DESIGN.md's type scale that's relevant on a phone-sized
// screen — display sizes are web-hero-only and dropped here.
export const typography: Record<string, TextStyle> = {
  headline1: { fontSize: 32, fontWeight: '600', letterSpacing: -0.3 },
  headline2: { fontSize: 22, fontWeight: '600', letterSpacing: -0.2 },
  title: { fontSize: 17, fontWeight: '600' },
  bodyLg: { fontSize: 16, fontWeight: '400' },
  body: { fontSize: 15, fontWeight: '400' },
  label: { fontSize: 13, fontWeight: '500' },
  caption: { fontSize: 11, fontWeight: '500', letterSpacing: 0.8, textTransform: 'uppercase' },
  mono: { fontFamily: 'ui-monospace', fontSize: 13 },
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 6, md: 10, lg: 14, xl: 18, pill: 999 } as const;
