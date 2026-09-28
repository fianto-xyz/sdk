import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WEBHOOK_EVENT_TYPES } from './events.js';

it('matches the spec webhooks section, minus endpoint.verification', () => {
  const specPath = fileURLToPath(new URL('../../../../spec/openapi.json', import.meta.url));
  const spec = JSON.parse(readFileSync(specPath, 'utf8')) as { webhooks?: Record<string, unknown> };
  const specTypes = Object.keys(spec.webhooks ?? {}).filter((type) => type !== 'endpoint.verification').sort();
  expect([...WEBHOOK_EVENT_TYPES].sort()).toEqual(specTypes);
});
