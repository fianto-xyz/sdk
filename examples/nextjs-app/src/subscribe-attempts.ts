// DEMO ONLY: an in-memory store, lost on restart and not shared between server instances. A real
// app keeps this counter on the user's own record in its database.
//
// Why a counter at all: for `mode: 'subscription'`, an order_id can be used by one completed
// checkout only. Once a subscribe completes, a new checkout under the same order_id is refused
// with 409 `order_id_in_use`, so the user's next subscribe (after a cancel, say) needs a new one.
// Until then the order_id stays the same, so a second click reuses the open checkout instead of
// opening another one the payer could also pay.

interface Store {
  /** `${userId}:${plan}` → how many of this user's subscribes to the plan have completed. */
  completed: Map<string, number>;
  /** order_id → the `${userId}:${plan}` key it was issued for. */
  issued: Map<string, string>;
}

// On globalThis so every route module of this process shares one store.
const store: Store = ((globalThis as { __fiantoSubscribeAttempts?: Store }).__fiantoSubscribeAttempts ??= {
  completed: new Map(),
  issued: new Map(),
});

/** The order_id for this user's next subscribe to `plan`. */
export function subscribeOrderId(userId: string, plan: string): string {
  const key = `${userId}:${plan}`;
  const orderId = `sub_${userId}_${plan}_${store.completed.get(key) ?? 0}`;
  store.issued.set(orderId, key);
  return orderId;
}

/**
 * Call from the `subscription.created` webhook with `event.data.order_id`: the next subscribe
 * of that user to that plan gets a new order_id. Safe to call more than once per order_id.
 */
export function subscribeCompleted(orderId: string): void {
  const key = store.issued.get(orderId);
  if (key === undefined) return;
  store.issued.delete(orderId);
  store.completed.set(key, (store.completed.get(key) ?? 0) + 1);
}
