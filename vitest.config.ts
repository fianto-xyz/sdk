import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      { find: '@fianto/sdk/webhooks', replacement: fileURLToPath(new URL('./packages/sdk/src/webhooks/index.ts', import.meta.url)) },
      { find: '@fianto/sdk/handlers', replacement: fileURLToPath(new URL('./packages/sdk/src/handlers/index.ts', import.meta.url)) },
      { find: '@fianto/sdk', replacement: fileURLToPath(new URL('./packages/sdk/src/index.ts', import.meta.url)) },
    ],
  },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
    globals: true,
  },
});
