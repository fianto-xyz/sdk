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
    // global.ts pulls in button/index.ts only for its side effect (registering
    // <fianto-button> — `import './index.js';`, no binding used), and rolldown's tree-shaker
    // drops an imported-but-unbound module's top-level code unless something marks it as
    // side-effecting. package.json's `sideEffects` only tells a DOWNSTREAM consumer's bundler
    // which shipped dist/ files to keep; it says nothing to rolldown about this package's own
    // src/ during tsdown's build of the entries above. Without this, the IIFE bundle would
    // build "successfully" with zero references to <fianto-button> — the element it exists to
    // register never gets defined.
    treeshake: { moduleSideEffects: [{ test: /src[\\/]button[\\/]index\.ts$/, sideEffects: true }] },
  },
]);
