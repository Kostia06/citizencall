// EXPO_PUBLIC_* env vars are inlined by Metro at build time (Expo's
// standard client-env convention — see app.config.ts's header comment).
// MOCK defaults on so the app is fully demoable with zero backend, mirroring
// ui/src/api.ts's `VITE_MOCK` default. Flip with:
//   EXPO_PUBLIC_MOCK=false EXPO_PUBLIC_API_BASE=http://localhost:8787 pnpm start
export const MOCK: boolean = process.env.EXPO_PUBLIC_MOCK !== 'false';

export const API_BASE: string = process.env.EXPO_PUBLIC_API_BASE ?? 'http://localhost:8787';

/** Demo user id for anonymous/mock sessions — mirrors SPEC.md §13's
 * DEMO_USERS convention until a real account exists. */
export const ANON_USER_ID = 'demo_kos';
