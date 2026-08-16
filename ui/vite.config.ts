import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Worker serves ui/dist as static assets — see SPEC.md §1.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // The 1,201-app Composio catalog JSON and framer-motion dominated a
        // single 500KB+ main chunk — split them so the app shell loads fast
        // and the catalog arrives in parallel.
        manualChunks: {
          catalog: ['./src/store/composio-apps.json'],
          motion: ['framer-motion'],
        },
      },
    },
  },
  server: {
    port: 5173,
    // Dev-only same-origin proxy to the local Worker (wrangler dev :8787) —
    // avoids CORS entirely and lets the __Host-* cookies behave exactly as
    // in production, where the Worker serves the SPA itself. Live mode is
    // just `VITE_MOCK=false pnpm dev`; MOCK mode never calls these paths.
    proxy: {
      '/api': 'http://localhost:8787',
      '/auth': 'http://localhost:8787',
      '/oauth': 'http://localhost:8787',
    },
  },
});