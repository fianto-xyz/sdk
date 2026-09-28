import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      { find: '@fianto/sdk/webhooks', replacement: fileURLToPath(new URL('./packages/sdk/src/webhooks/index.ts', import.meta.url)) },
      { find: '@fianto/sdk/handlers', replacement: fileURLToPath(new URL('./packages/sdk/src/handlers/index.ts', import.meta.url)) },
      { find: '@fianto/sdk', replacement: fileURLToPath(new URL('./packages/sdk/src/index.ts', import.meta.url)) },
      { find: '@fianto/js/button-core', replacement: fileURLToPath(new URL('./packages/js/src/button-core/index.ts', import.meta.url)) },
      { find: '@fianto/js/button', replacement: fileURLToPath(new URL('./packages/js/src/button/index.ts', import.meta.url)) },
      { find: '@fianto/js', replacement: fileURLToPath(new URL('./packages/js/src/index.ts', import.meta.url)) },
      { find: /^@fianto\/express$/, replacement: fileURLToPath(new URL('./packages/express/src/index.ts', import.meta.url)) },
      { find: /^@fianto\/nextjs$/, replacement: fileURLToPath(new URL('./packages/nextjs/src/index.ts', import.meta.url)) },
      { find: /^@fianto\/hono$/, replacement: fileURLToPath(new URL('./packages/hono/src/index.ts', import.meta.url)) },
      { find: /^@fianto\/react$/, replacement: fileURLToPath(new URL('./packages/react/src/index.ts', import.meta.url)) },
    ],
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.test.tsx', 'examples/*/src/**/*.test.ts'],
    environment: 'node',
    globals: true,
  },
});
