import type { ExpoConfig } from 'expo/config';

// API base + mock mode are read from EXPO_PUBLIC_* env vars at build time
// (Expo's standard client-env convention — inlined by Metro, no extra
// plumbing needed). Defaults keep the app fully demoable with zero backend
// and, when MOCK is turned off, pointed at the worker's local dev port.
// See src/api/config.ts for the runtime read of these same vars, and
// SPEC.md §13 for the worker API contract.
//
//   EXPO_PUBLIC_API_BASE=http://localhost:8787 pnpm start   # talk to local worker
//   EXPO_PUBLIC_MOCK=false pnpm start                        # disable mock fallback

const config: ExpoConfig = {
  name: 'Understudy',
  slug: 'understudy',
  version: '1.0.0',
  scheme: 'understudy',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  backgroundColor: '#050506',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'dev.understudy.app',
    infoPlist: {
      // expo-audio ships no config plugin (no Info.plist auto-injection),
      // unlike expo-secure-store/expo-web-browser above — set manually.
      NSMicrophoneUsageDescription: 'Understudy uses the microphone to transcribe voice commands into the command bar.',
    },
  },
  android: {
    package: 'dev.understudy.app',
    adaptiveIcon: {
      backgroundColor: '#050506',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    permissions: ['RECORD_AUDIO'],
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: ['expo-router', 'expo-secure-store', 'expo-web-browser', 'expo-font', 'expo-image'],
};

export default config;
