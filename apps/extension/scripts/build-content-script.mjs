import { build } from 'vite';
import { resolve } from 'node:path';

await build({
  configFile: false,
  build: {
    outDir: resolve('dist'),
    emptyOutDir: true,
    lib: {
      entry: resolve('src/shell/content-script.ts'),
      name: 'StudyLensContentScript',
      formats: ['iife'],
      fileName: () => 'content-script.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
