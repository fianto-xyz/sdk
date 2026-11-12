// The CLI README documents every trigger flag, and the status line a card sample prints.
import { readFileSync } from 'node:fs';

const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

it('documents trigger --method and its card status line', () => {
  expect(README).toContain('### `fianto trigger <type> [--forward-to <url>] [--secret <whsec_>|--secret-file <path>] [--allow-remote] [--method crypto|card]`');
  expect(README).toContain('→ 200 order.paid (local card sample)');
  expect(README).toMatch(/`--method` without `--forward-to`/);
  expect(README).toMatch(/payment\.disputed[^\n]*card/);
});
