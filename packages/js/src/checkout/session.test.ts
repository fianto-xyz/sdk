// @vitest-environment jsdom
import { InvalidSessionError, redirectToCheckout } from '../index.js';

const SESSION = { id: 'fian_cs_1', url: 'https://pay.fianto.test/c/fian_cst_x' };

let assign: ReturnType<typeof vi.fn>;
beforeEach(() => {
  assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it('assigns the session url (object form)', async () => {
  void redirectToCheckout(SESSION);
  await vi.waitFor(() => expect(assign).toHaveBeenCalledWith(SESSION.url));
});

it('assigns the session url (function form)', async () => {
  void redirectToCheckout(async () => SESSION);
  await vi.waitFor(() => expect(assign).toHaveBeenCalledWith(SESSION.url));
});

it('rejects InvalidSessionError for a bad session without assigning', async () => {
  await expect(redirectToCheckout({ id: '', url: SESSION.url })).rejects.toBeInstanceOf(InvalidSessionError);
  expect(assign).not.toHaveBeenCalled();
});

it('rejects InvalidSessionError for a bad url without assigning', async () => {
  await expect(redirectToCheckout({ id: 'fian_cs_1', url: 'javascript:alert(1)' })).rejects.toBeInstanceOf(InvalidSessionError);
  expect(assign).not.toHaveBeenCalled();
});
