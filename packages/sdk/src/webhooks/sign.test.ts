import { randomBytes } from 'node:crypto';
import { Webhook } from 'standardwebhooks';
import { signWebhook } from './sign.js';
import { verifyWebhook } from './verify.js';

const secret = `whsec_${randomBytes(32).toString('base64')}`;

it('produces headers the reference library and verifyWebhook accept', async () => {
  const event = { id: `evt_${'a'.repeat(32)}`, type: 'test.event', timestamp: '2026-09-28T10:00:00.000Z', data: { message: 'hi' } };
  const { body, headers } = await signWebhook({ event, secret });
  expect(headers['webhook-id']).toBe(event.id);
  expect(headers['content-type']).toBe('application/json');
  expect(() => new Webhook(secret).verify(body, headers)).not.toThrow();
  await expect(verifyWebhook(body, headers, { secret })).resolves.toEqual(event);
});

it('invents an evt_ id for an envelope without one and signs with every secret', async () => {
  const other = `whsec_${randomBytes(32).toString('base64')}`;
  const { headers } = await signWebhook({
    event: { type: 'endpoint.verification', timestamp: 't', data: { challenge: 'c' } },
    secret: [secret, other], timestamp: 1_790_000_000,
  });
  expect(headers['webhook-id']).toMatch(/^evt_[0-9a-f]{32}$/);
  expect(headers['webhook-timestamp']).toBe('1790000000');
  expect(headers['webhook-signature'].split(' ')).toHaveLength(2);
});
