// Extracts every ```ts / ```tsx block from every README.md in the workspace, wraps each in its
// own module, and type-checks them all together against the BUILT packages (run `pnpm build`
// first). A block whose info string is `ts no-check` / `tsx no-check` is skipped: use that only
// for something that cannot sensibly compile on its own — a partial fragment, shell output,
// JSON, HTML. A documented call signature, import or type name that doesn't compile is exactly
// what this check exists to catch — keep `no-check` rare and justified.
//
// Module resolution: a scratch `node_modules/@fianto/<name>` is symlinked straight at each
// `packages/<name>` directory (same shape pnpm's own workspace symlinks give a real consumer),
// plus the type-only peer deps (`react`, `hono`, `express`, ...) a snippet's imports need,
// reused from wherever a workspace package already installed them — nothing is fetched.
//
// Run via `pnpm check:docs`, and as part of CI's `check` job.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, '.check-docs');
const FENCE = /```(ts|tsx)( no-check)?\n([\s\S]*?)```/g;

// Type-only deps some snippets' imports need, borrowed from whichever workspace package already
// has them installed (same source `scripts/check-consumers.mjs` uses).
const PEER_TYPE_DEPS = [
  { from: 'packages/react/node_modules/react', as: 'react' },
  { from: 'packages/react/node_modules/@types/react', as: '@types/react' },
  { from: 'packages/hono/node_modules/hono', as: 'hono' },
  { from: 'packages/express/node_modules/express', as: 'express' },
  { from: 'packages/express/node_modules/@types/express', as: '@types/express' },
];

/** Every README.md in the workspace, skipping node_modules, dist and the scratch dir itself. */
function findReadmes(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.check-docs' || entry.startsWith('.git')) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) findReadmes(path, out);
    else if (entry === 'README.md') out.push(path);
  }
  return out;
}

function slug(path) {
  return relative(ROOT, path).replace(/[/\\]/g, '-').replace(/\.md$/, '');
}

function symlink(from, to) {
  if (!existsSync(from)) return;
  mkdirSync(join(to, '..'), { recursive: true });
  symlinkSync(realpathSync(from), to, 'dir');
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

// Every published `packages/<name>` (has a `check` script, i.e. it's `publint`/`attw`-checked —
// the same filter `check:packages`/`check-consumers.mjs` use) is its own package's real source,
// symlinked in as `@fianto/<name>` — module resolution then works exactly like a real consumer's
// (or another workspace package's) `node_modules/@fianto/<name>` symlink would.
for (const name of readdirSync(join(ROOT, 'packages'))) {
  const pkgJsonPath = join(ROOT, 'packages', name, 'package.json');
  if (!existsSync(pkgJsonPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  if (pkg.scripts?.check === undefined) continue;
  symlink(join(ROOT, 'packages', name), join(OUT_DIR, 'node_modules', '@fianto', name));
}
for (const { from, as } of PEER_TYPE_DEPS) symlink(join(ROOT, from), join(OUT_DIR, 'node_modules', as));

const readmes = findReadmes(ROOT).sort();
const files = [];
let total = 0;
let skipped = 0;

for (const readme of readmes) {
  const text = readFileSync(readme, 'utf8');
  let match;
  let index = 0;
  FENCE.lastIndex = 0;
  while ((match = FENCE.exec(text)) !== null) {
    const [, lang, noCheck, body] = match;
    index += 1;
    total += 1;
    if (noCheck) {
      skipped += 1;
      continue;
    }
    const ext = lang === 'tsx' ? 'tsx' : 'ts';
    const name = `${slug(readme)}-${index}.${ext}`;
    writeFileSync(join(OUT_DIR, name), body);
    files.push(name);
  }
}

console.log(`${readmes.length} README(s), ${total} ts/tsx block(s), ${skipped} marked no-check, ${files.length} to type-check.`);

if (files.length === 0) {
  rmSync(OUT_DIR, { recursive: true, force: true });
  process.exit(0);
}

writeFileSync(
  join(OUT_DIR, 'tsconfig.json'),
  JSON.stringify(
    {
      extends: '../tsconfig.base.json',
      compilerOptions: { jsx: 'react-jsx', baseUrl: '.' },
      include: files,
    },
    null,
    2,
  ),
);

try {
  execFileSync(join(ROOT, 'node_modules', '.bin', 'tsc'), ['-p', join(OUT_DIR, 'tsconfig.json'), '--noEmit'], {
    stdio: 'inherit',
    cwd: ROOT,
  });
} catch {
  console.error(
    "\nA README ts/tsx snippet failed to type-check. Fix the snippet (it should compile as shown)," +
      ' or mark it ```ts no-check if it is a partial fragment that cannot sensibly compile on its' +
      " own — keep that rare and justified, see this script's header comment.",
  );
  process.exitCode = 1;
} finally {
  rmSync(OUT_DIR, { recursive: true, force: true });
}
