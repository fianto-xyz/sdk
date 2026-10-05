import { expect, it } from 'vitest';
import { subscribeEnded, subscribeOrderId } from './subscribe-attempts.js';

it('keeps one order_id for the whole life of a subscription, and moves on only once it ended', () => {
  const first = subscribeOrderId('u1', 'pro');
  // Open checkout, and later a live subscription: the same order_id, so fianto reuses the open
  // checkout or refuses a second subscribe with order_id_in_use.
  expect(subscribeOrderId('u1', 'pro')).toBe(first);
  subscribeEnded(first);
  subscribeEnded(first); // a redelivered webhook changes nothing
  const second = subscribeOrderId('u1', 'pro');
  expect(second).not.toBe(first);
  expect(subscribeOrderId('u2', 'pro')).toBe('sub_u2_pro_0');
  subscribeEnded(second);
  expect(subscribeOrderId('u1', 'pro')).toBe('sub_u1_pro_2');
});
