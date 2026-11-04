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
    // The demo examples (src/ui/demos.ts) import fixtures from the repo's
    // dgm/ folder, outside app/; the build inlines them either way.
    fs: { allow: ['.', '../dgm'] },
  },
});
