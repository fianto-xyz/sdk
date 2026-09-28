import { BUTTON_CSS, buttonClassName, buttonMarkup, resolveButtonOptions } from './index.js';

it('renders the logo and the label, and a spinner when loading', () => {
  const html = buttonMarkup(resolveButtonOptions({ label: 'buy' }));
  expect(html).toContain('<svg');
  expect(html).toContain('Buy with');
  expect(html).toContain('aria-hidden="true"');
  expect(buttonMarkup(resolveButtonOptions({ loading: true }))).toContain('fianto-spinner');
});

it('builds the class list from the options', () => {
  expect(buttonClassName(resolveButtonOptions({ theme: 'dark', shape: 'pill', size: 'fill' })))
    .toBe('fianto-button fianto-theme-dark fianto-shape-pill fianto-size-fill fianto-label-pay');
});

it('clamps height and radius and honours reduced motion', () => {
  expect(BUTTON_CSS).toContain('clamp(40px, var(--fianto-button-height, 44px), 55px)');
  expect(BUTTON_CSS).toContain('--fianto-button-radius');
  expect(BUTTON_CSS).toContain('prefers-reduced-motion');
  expect(BUTTON_CSS).toContain('prefers-color-scheme: dark');
  expect(BUTTON_CSS).toContain('#0002F8');
});
