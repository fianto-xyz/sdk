import { MARK_PATHS, MARK_VIEWBOX, WORDMARK_PATH, WORDMARK_VIEWBOX } from './brand.js';

it('carries the mark and an outlined wordmark', () => {
  expect(MARK_VIEWBOX).toBe('240 240 774 774');
  expect(MARK_PATHS).toHaveLength(4);
  expect(WORDMARK_PATH).toMatch(/^M[\d.\s,-]/);
  expect(WORDMARK_PATH.length).toBeGreaterThan(200);
  const [, , width, height] = WORDMARK_VIEWBOX.split(' ').map(Number);
  expect(width).toBeGreaterThan(height! * 2); // "fianto" is wider than tall
});
