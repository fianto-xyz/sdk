import { readFileSync } from 'node:fs';
import { VERSION } from './version.js';

it('matches package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(VERSION).toBe(pkg.version);
});
