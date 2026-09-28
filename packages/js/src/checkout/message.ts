export const MESSAGE_TYPE = 'fianto.checkout';
const STATUSES = new Set(['succeeded', 'canceled', 'expired']);

export function checkoutStatusFrom(
  event: MessageEvent,
  popup: Window,
  origin: string,
  sessionId: string,
): 'succeeded' | 'canceled' | 'expired' | null {
  if (event.source !== popup || event.origin !== origin) return null;
  const data = event.data as { type?: unknown; session_id?: unknown; status?: unknown } | null;
  if (!data || typeof data !== 'object') return null;
  if (data.type !== MESSAGE_TYPE || data.session_id !== sessionId || typeof data.status !== 'string') return null;
  return STATUSES.has(data.status) ? (data.status as 'succeeded' | 'canceled' | 'expired') : null;
}
