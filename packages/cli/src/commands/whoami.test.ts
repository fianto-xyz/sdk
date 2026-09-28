import { describe, expect, it, vi } from 'vitest';
import type { Output } from '../output.js';
import { whoami } from './whoami.js';

function fakeOutput(): { output: Output; lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { output: { out: (l) => lines.push(l), err: (l) => errors.push(l) }, lines, errors };
}

describe('whoami', () => {
  it('prints application, merchant and webhook status', async () => {
    const { output, lines } = fakeOutput();
    const client = {
      application: {
        retrieve: vi.fn(async () => ({
          app_id: 'fian_app_1',
          name: 'Shop',
          merchant: { name: 'Acme' },
          webhook: { status: 'ACTIVE', url: 'https://shop.test/wh' },
        })),
      },
    };
    await whoami(client as never, output);
    expect(client.application.retrieve).toHaveBeenCalledTimes(1);
    expect(lines).toEqual([
      'Application  Shop (fian_app_1)',
      'Merchant     Acme',
      'Webhook      ACTIVE https://shop.test/wh',
    ]);
  });

  it('prints "not configured" when the application has no webhook', async () => {
    const { output, lines } = fakeOutput();
    const client = {
      application: {
        retrieve: vi.fn(async () => ({
          app_id: 'fian_app_1',
          name: 'Shop',
          merchant: { name: 'Acme' },
          webhook: null,
        })),
      },
    };
    await whoami(client as never, output);
    expect(lines).toEqual([
      'Application  Shop (fian_app_1)',
      'Merchant     Acme',
      'Webhook      not configured',
    ]);
  });
});
