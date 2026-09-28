import { renderToString } from 'react-dom/server';
import { FiantoButton } from './index.js';

it('renders on the server without touching window', () => {
  expect(typeof window).toBe('undefined');
  const html = renderToString(<FiantoButton session={{ id: 'fian_cs_1', url: 'https://pay.test/c/x' }} label="pay" />);
  expect(html).toContain('aria-label="Pay with fianto"');
  expect(html).toContain('fianto-button');
});
