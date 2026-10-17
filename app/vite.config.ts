import { defineConfig } from 'vite';

// Static SPA. Base is './' so the build works when opened directly off the
// filesystem (file://), per the plan's local-use requirement.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
  server: {
    port: 5173,
    open: false,
  },
});
