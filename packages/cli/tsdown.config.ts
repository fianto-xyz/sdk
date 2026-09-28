import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { bin: 'src/bin.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  banner: '#!/usr/bin/env node',
  dts: false,
  clean: true,
  exports: false,
  // platform: 'node' defaults fixedExtension to true (.mjs); the package's bin points at
  // dist/bin.js and "type": "module" already disambiguates ESM, so force the plain extension.
  fixedExtension: false,
  external: ['@fianto/sdk'],
});
