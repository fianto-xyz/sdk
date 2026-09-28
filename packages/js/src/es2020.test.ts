import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The CDN bundle targets es2020 and tsdown lowers syntax but adds no polyfills: a newer built-in
// in the source throws at runtime on older browsers (Object.hasOwn: Safari < 15.4).
const NEWER_BUILT_INS = [/\bObject\.hasOwn\(/, /\.at\(/, /\bstructuredClone\(/, /\.findLast(Index)?\(/, /\.replaceAll\(/];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') && !entry.name.includes('.test.') ? [path] : [];
  });
}

it('uses no built-in newer than es2020 in @fianto/js source', () => {
  const found = sources(import.meta.dirname).flatMap((file) =>
    NEWER_BUILT_INS.filter((pattern) => pattern.test(readFileSync(file, 'utf8'))).map((pattern) => `${file}: ${pattern}`));
  expect(found).toEqual([]);
});
