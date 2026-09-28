import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: { index: 'src/index.ts', 'button-core': 'src/button-core/index.ts', button: 'src/button/index.ts' },
    format: ['esm', 'cjs'],
    platform: 'browser',
    target: 'es2022',
    dts: true,
    clean: true,
    exports: true,
  },
  {
    entry: { 'fianto-button.global': 'src/button/global.ts' },
    format: ['iife'],
    platform: 'browser',
    target: 'es2020',
    minify: true,
    dts: false,
    exports: false,
    clean: false,
  },
]);
