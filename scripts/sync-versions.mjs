// Rewrites every packages/*/src/version.ts's hand-kept `VERSION` constant from that package's
// own package.json. `changeset version` (the release workflow's version-script) only bumps
// package.json files, so without this, version.test.ts (which asserts VERSION === package.json's
// version) fails on every "Version packages" PR the moment a bump lands. Run right after
// `changeset version`, before the workflow commits the PR.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VERSION_LINE = /export const VERSION = '[^']*';/;

let changed = 0;
for (const name of readdirSync('packages')) {
  const versionPath = resolve(`packages/${name}/src/version.ts`);
  let source;
  try {
    source = readFileSync(versionPath, 'utf8');
  } catch {
    continue; // most packages have no hand-kept version.ts — nothing to sync
  }
  if (!VERSION_LINE.test(source)) {
    console.error(`${versionPath} exists but doesn't match "export const VERSION = '...';" — update this script.`);
    process.exit(1);
  }
  const pkg = JSON.parse(readFileSync(resolve(`packages/${name}/package.json`), 'utf8'));
  const next = source.replace(VERSION_LINE, `export const VERSION = '${pkg.version}';`);
  if (next !== source) {
    writeFileSync(versionPath, next);
    console.log(`packages/${name}/src/version.ts -> ${pkg.version}`);
    changed += 1;
  }
}
if (changed === 0) console.log('Every version.ts already matches its package.json.');
