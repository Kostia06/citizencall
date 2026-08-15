import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Worker serves ui/dist as static assets — see SPEC.md §1.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
});
