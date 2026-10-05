// DEMO ONLY: an in-memory store, lost on restart and not shared between server instances. A real
// app keeps this counter on the user's own record in its database.
//
// Why a counter at all: for `mode: 'subscription'`, an order_id can be used by one completed
// checkout only. Once a subscribe completes, a new checkout under the same order_id is refused
// with 409 `order_id_in_use`.
//
// Why it advances at subscription.ENDED, not at subscription.created: while the user's
// subscription is live, reusing its order_id is exactly what stops a second one. A second click
// reuses the open checkout, and once the subscribe completed fianto answers `order_id_in_use`
// instead of letting the user subscribe again (from another wallet, say) while the first
// subscription still bills. Only after it ended does the user get a new order_id to subscribe
// again.

interface Store {
  /** `${userId}:${plan}` → how many of this user's subscriptions to the plan have ended. */
  ended: Map<string, number>;
  /** order_id → the `${userId}:${plan}` key it was issued for. */
  issued: Map<string, string>;
}

// On globalThis so every route module of this process shares one store.
const store: Store = ((globalThis as { __fiantoSubscribeAttempts?: Store }).__fiantoSubscribeAttempts ??= {
  ended: new Map(),
  issued: new Map(),
});

/** The order_id for this user's subscription to `plan`: the same one until it has ended. */
export function subscribeOrderId(userId: string, plan: string): string {
  const key = `${userId}:${plan}`;
  const orderId = `sub_${userId}_${plan}_${store.ended.get(key) ?? 0}`;
  store.issued.set(orderId, key);
  return orderId;
}

/**
 * Call from the `subscription.ended` webhook with `event.data.order_id`: the user's next
 * subscribe to that plan gets a new order_id. Safe to call more than once per order_id.
 */
export function subscribeEnded(orderId: string): void {
  const key = store.issued.get(orderId);
  if (key === undefined) return;
  store.issued.delete(orderId);
  store.ended.set(key, (store.ended.get(key) ?? 0) + 1);
}
