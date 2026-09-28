import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: { index: 'src/index.ts', 'button-core': 'src/button-core/index.ts' },
    format: ['esm', 'cjs'],
    platform: 'browser',
    target: 'es2022',
    dts: true,
    clean: true,
    exports: true,
  },
]);
