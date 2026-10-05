import { expect, it } from 'vitest';
import { subscribeCompleted, subscribeOrderId } from './subscribe-attempts.js';

it('keeps one order_id until that subscribe completes, then moves to a new one', () => {
  const first = subscribeOrderId('u1', 'pro');
  expect(subscribeOrderId('u1', 'pro')).toBe(first);
  subscribeCompleted(first);
  subscribeCompleted(first); // a redelivered webhook changes nothing
  const second = subscribeOrderId('u1', 'pro');
  expect(second).not.toBe(first);
  expect(subscribeOrderId('u2', 'pro')).toBe('sub_u2_pro_0');
  subscribeCompleted(second);
  expect(subscribeOrderId('u1', 'pro')).toBe('sub_u1_pro_2');
});
