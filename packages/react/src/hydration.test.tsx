// @vitest-environment jsdom
import { act } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { FiantoButton } from './fianto-button.js';

afterEach(() => {
  vi.restoreAllMocks();
});

it('hydrates without a locale mismatch, then adopts the navigator locale after mount', async () => {
  // The server never sees `navigator`, so it always renders the `en` default when no `locale`
  // prop is given. Stubbing `navigator.language` to `vi-VN` *before* the first client render
  // proves the component doesn't read it during that render either — only React itself would
  // complain (via console.error) if the client's first render disagreed with the server's.
  const languageSpy = vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('vi-VN');
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  const session = { id: 'fian_cs_1', url: 'https://pay.test/c/x' };
  const html = renderToString(<FiantoButton session={session} label="pay" />);
  expect(html).toContain('aria-label="Pay with fianto"');

  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.append(container);

  await act(async () => {
    hydrateRoot(container, <FiantoButton session={session} label="pay" />);
  });

  expect(errorSpy).not.toHaveBeenCalled();

  // After the post-mount effect adopts navigator.language, the button re-renders in Vietnamese.
  const button = container.querySelector('button')!;
  expect(button.getAttribute('aria-label')).toBe('Thanh toán với fianto');

  document.body.removeChild(container);
  languageSpy.mockRestore();
});
