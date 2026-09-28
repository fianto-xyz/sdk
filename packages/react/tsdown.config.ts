import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  clean: true,
  exports: true,
  external: ['react', 'react/jsx-runtime', '@fianto/js', '@fianto/js/button-core'],
  // Next.js's App Router bundler reads the RSC boundary directive off the built file, not the
  // source: a source-level `'use client'` in src/index.ts is a rolldown "module level directive"
  // that the bundler only warns it "may not preserve" (it depends on the output staying a single
  // chunk). The output banner guarantees it's the first line of every emitted entry regardless.
  banner: "'use client';",
});
