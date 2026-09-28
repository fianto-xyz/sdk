// @vitest-environment jsdom
import { InvalidSessionError, MESSAGE_TYPE, POPUP_NAME, PopupBlockedError, openCheckout } from '../index.js';

type FakePopup = { closed: boolean; location: { replace: ReturnType<typeof vi.fn> }; document: Document; close: () => void };

function fakePopup(): FakePopup {
  const doc = document.implementation.createHTMLDocument('');
  const popup: FakePopup = {
    closed: false,
    location: { replace: vi.fn() },
    document: doc,
    close: () => { popup.closed = true; },
  };
  return popup;
}

const SESSION = { id: 'fian_cs_1', url: 'https://pay.fianto.test/c/fian_cst_x' };
const ORIGIN = 'https://pay.fianto.test';

function post(source: unknown, data: unknown, origin = ORIGIN) {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source: source as MessageEventSource }));
}

let popup: FakePopup;
let open: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  popup = fakePopup();
  open = vi.fn(() => popup);
  vi.stubGlobal('open', open);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('opens the named popup synchronously, then navigates it', async () => {
  const promise = openCheckout({ session: async () => SESSION });
  expect(open).toHaveBeenCalledWith('', POPUP_NAME, expect.stringContaining('width=480'));
  expect(open.mock.calls[0]![2]).not.toContain('noopener');
  expect(popup.document.body.textContent).toContain('Loading secure checkout');
  await vi.waitFor(() => expect(popup.location.replace).toHaveBeenCalledWith(SESSION.url));
  post(popup, { type: MESSAGE_TYPE, session_id: 'fian_cs_1', status: 'succeeded' });
  await expect(promise).resolves.toEqual({ status: 'succeeded', session_id: 'fian_cs_1' });
});

// Review Focus 1
it.each([
  ['another window', () => window, ORIGIN, { type: MESSAGE_TYPE, session_id: 'fian_cs_1', status: 'succeeded' }],
  ['another origin', () => popup, 'https://evil.test', { type: MESSAGE_TYPE, session_id: 'fian_cs_1', status: 'succeeded' }],
  ['another type', () => popup, ORIGIN, { type: 'other', session_id: 'fian_cs_1', status: 'succeeded' }],
  ['another session', () => popup, ORIGIN, { type: MESSAGE_TYPE, session_id: 'fian_cs_2', status: 'succeeded' }],
  ['an unknown status', () => popup, ORIGIN, { type: MESSAGE_TYPE, session_id: 'fian_cs_1', status: 'paid' }],
  ['a non-object', () => popup, ORIGIN, 'succeeded'],
])('ignores a message from %s', async (_name, source, origin, data) => {
  const promise = openCheckout({ session: SESSION });
  await vi.waitFor(() => expect(popup.location.replace).toHaveBeenCalled());
  post(source(), data, origin);
  popup.closed = true;
  await vi.advanceTimersByTimeAsync(600);
  await expect(promise).resolves.toEqual({ status: 'closed', session_id: 'fian_cs_1' });
});

it('resolves closed when the payer closes the popup', async () => {
  const promise = openCheckout({ session: SESSION });
  await vi.waitFor(() => expect(popup.location.replace).toHaveBeenCalled());
  popup.closed = true;
  await vi.advanceTimersByTimeAsync(600);
  await expect(promise).resolves.toEqual({ status: 'closed', session_id: 'fian_cs_1' });
});

// Review Focus 2
it('falls back to a redirect when the popup is blocked', async () => {
  open.mockReturnValue(null);
  const assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
  const session = vi.fn(async () => SESSION);
  void openCheckout({ session });
  await vi.waitFor(() => expect(assign).toHaveBeenCalledWith(SESSION.url));
  expect(session).toHaveBeenCalledOnce();
});

it('rejects PopupBlockedError without creating a session when fallback is none', async () => {
  open.mockReturnValue(null);
  const session = vi.fn(async () => SESSION);
  await expect(openCheckout({ session, fallback: 'none' })).rejects.toBeInstanceOf(PopupBlockedError);
  expect(session).not.toHaveBeenCalled();
});

// Review Focus 3
it('closes the popup and rejects when the session call fails', async () => {
  await expect(openCheckout({ session: async () => { throw new Error('409 payment_in_progress'); } })).rejects.toThrow('payment_in_progress');
  expect(popup.closed).toBe(true);
  expect(popup.location.replace).not.toHaveBeenCalled();
});

it.each(['javascript:alert(1)', 'http://pay.fianto.test/c/x', 'not a url', ''])('refuses the session url %j', async (url) => {
  await expect(openCheckout({ session: { id: 'fian_cs_1', url } })).rejects.toBeInstanceOf(InvalidSessionError);
  expect(popup.closed).toBe(true);
  expect(popup.location.replace).not.toHaveBeenCalled();
});

it('allows http on localhost for development', async () => {
  void openCheckout({ session: { id: 'fian_cs_1', url: 'http://localhost:3003/c/x' } });
  await vi.waitFor(() => expect(popup.location.replace).toHaveBeenCalledWith('http://localhost:3003/c/x'));
});

// Review Focus 4
it('resolves the previous checkout as closed when a new one starts', async () => {
  const first = openCheckout({ session: SESSION });
  await vi.waitFor(() => expect(popup.location.replace).toHaveBeenCalled());
  void openCheckout({ session: { id: 'fian_cs_2', url: SESSION.url } });
  await expect(first).resolves.toEqual({ status: 'closed', session_id: 'fian_cs_1' });
  expect(open).toHaveBeenCalledTimes(2);
  expect(open.mock.calls[1]![1]).toBe(POPUP_NAME);
});

it('removes its listener after settling', async () => {
  const remove = vi.spyOn(window, 'removeEventListener');
  const promise = openCheckout({ session: SESSION });
  await vi.waitFor(() => expect(popup.location.replace).toHaveBeenCalled());
  post(popup, { type: MESSAGE_TYPE, session_id: 'fian_cs_1', status: 'canceled' });
  await promise;
  expect(remove).toHaveBeenCalledWith('message', expect.any(Function));
});
