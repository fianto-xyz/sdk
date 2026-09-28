// Deliberately no environment pragma comment here: this file runs in vitest's default `node`
// environment (see root vitest.config.ts), where `HTMLElement`/`customElements`/`document` are
// all undefined — the same shape as an SSR import or a bare `require('@fianto/js/button')` in a
// Node script. (Vitest's pragma scanner matches that magic comment string anywhere in the file,
// so it can't even be spelled out here to explain its absence.)

it('imports without a DOM and never throws', async () => {
  expect(typeof HTMLElement).toBe('undefined');
  expect(typeof customElements).toBe('undefined');
  await expect(import('./index.js')).resolves.toBeDefined();
});

it('defineFiantoButton is a no-op without customElements', async () => {
  const { defineFiantoButton, FiantoButtonElement } = await import('./index.js');
  expect(() => defineFiantoButton()).not.toThrow();
  // No DOM registry to check against, so this just confirms the module's own top-level
  // `defineFiantoButton()` call (in ./index.js) and this explicit call both no-op silently,
  // and the class itself is still exported and usable as a value (e.g. for `customElements.define`
  // once a real DOM shows up later).
  expect(typeof FiantoButtonElement).toBe('function');
});
