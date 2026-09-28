// Packs every published @fianto/* package (the tarball npm would actually publish, not the
// checkout) and typechecks a tiny consumer against it under all three TypeScript module
// resolution modes — node10 (moduleResolution: node, module: commonjs; e.g. NestJS),
// node16 and bundler — with skipLibCheck: false, so a d.ts a real consumer can't resolve, or
// can't parse (e.g. a JS directive banner like 'use client' leaking into a .d.ts — TS1036 under
// skipLibCheck: false), fails CI instead of only showing up downstream.
//
// Run after `pnpm build`. Node >=22 only (uses recursive fs helpers and the workspace's own
// tsc); this is a CI-only diagnostic, not something published.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const TSC = resolve('node_modules/.bin/tsc');

// Every package.json under packages/** with a `check` script is published (examples/* are
// private and have no `check` script — same filter check:packages uses).
const PUBLISHED = readdirSync('packages').filter((name) => {
  try {
    return JSON.parse(readFileSync(`packages/${name}/package.json`, 'utf8')).scripts?.check !== undefined || name === 'cli';
  } catch {
    return false;
  }
});

// What a consumer can actually `import`, as { bindingName: specifier }. @fianto/cli ships only
// a `bin` (no main/types/exports) — nothing to import — so it's packed below (packing every
// published package matters: a file missing from `files` would go undetected otherwise) but
// left out of the consumer's imports.
//
// Namespace imports, not bare `import 'specifier';`: TS 5.9 does not check module resolution
// for a side-effect-only import (no binding) — `import 'pkg/nonexistent';` typechecks fine even
// under node10. A namespace import only gets resolution-checked if the binding is actually
// referenced, so every one of these is re-exported from the generated consumer file below (see
// writeConsumer) and `noUncheckedSideEffectImports: true` is set on top as a second line of
// defence, in case some future entry point is ever added as a bare side-effect import instead.
const IMPORTS = {
  sdk: [
    { as: 'sdk', from: '@fianto/sdk' },
    { as: 'sdkWebhooks', from: '@fianto/sdk/webhooks' },
    { as: 'sdkHandlers', from: '@fianto/sdk/handlers' },
  ],
  js: [
    { as: 'js', from: '@fianto/js' },
    { as: 'jsButton', from: '@fianto/js/button' },
    { as: 'jsButtonCore', from: '@fianto/js/button-core' },
  ],
  react: [{ as: 'react_', from: '@fianto/react' }],
  nextjs: [{ as: 'nextjs', from: '@fianto/nextjs' }],
  hono: [{ as: 'hono_', from: '@fianto/hono' }],
  express: [{ as: 'express_', from: '@fianto/express' }],
};

// A cross-entry usage, not just an import: constructs a root @fianto/sdk client and passes it
// into @fianto/sdk/handlers' createCheckoutHandler. If a subpath's typesVersions entry ever
// points at a different declaration-file family than the package's own root `types` field (e.g.
// root resolves to the .d.cts build, a subpath to the .d.ts/ESM build), tsdown's per-format dts
// bundling means the two sides declare the *same* runtime class as two structurally-identical
// but nominally distinct types, and TS rejects passing one where the other is expected ("Types
// have separate declarations of a private property"). A plain import of each entry point does
// not catch this — only actually using a value across the entry-point boundary does.
const CROSS_ENTRY_USAGE = `
sdkHandlers.createCheckoutHandler({
  fianto: new sdk.Fianto({ appId: 'fian_app_x', appSecret: 'fian_sk_test_x' }),
  createSession: async () => ({
    order_id: 'order_1',
    mode: 'payment',
    amount: '1000000',
    success_url: 'https://example.com/success',
    cancel_url: 'https://example.com/cancel',
  }),
});
`;

// Type-only dependencies the packed packages' own .d.ts files reference (@fianto/hono ->
// `hono`, @fianto/express -> `express`/`@types/express`, @fianto/react -> `react`). Sourced
// from the workspace's own installed copies rather than reinstalled, so the check uses exactly
// the versions already pinned in the lockfile.
const PEER_TYPE_DEPS = [
  { from: 'packages/react/node_modules/react', as: 'react' },
  { from: 'packages/react/node_modules/@types/react', as: '@types/react' },
  { from: 'packages/hono/node_modules/hono', as: 'hono' },
  { from: 'packages/express/node_modules/express', as: 'express' },
  { from: 'packages/express/node_modules/@types/express', as: '@types/express' },
];

const RESOLUTIONS = {
  node10: { module: 'commonjs', moduleResolution: 'node' },
  node16: { module: 'node16', moduleResolution: 'node16' },
  bundler: { module: 'esnext', moduleResolution: 'bundler' },
};

/**
 * Cheap, precise check that runs before the (slower, less specific) compile below: a .d.ts/
 * .d.cts must never start with a JS directive banner (e.g. react's 'use client') — that's
 * invalid ambient-context syntax (TS1036) the moment a consumer sets skipLibCheck: false.
 */
function checkNoDirectiveInDts() {
  const offenders = [];
  for (const name of PUBLISHED) {
    const dist = `packages/${name}/dist`;
    if (!existsSync(dist)) continue;
    for (const file of readdirSync(dist)) {
      if (!/\.d\.(c|m)?ts$/.test(file)) continue;
      const firstLine = readFileSync(join(dist, file), 'utf8').split('\n', 1)[0]?.trim();
      if (firstLine && /^(['"])use [a-z]+\1;?$/.test(firstLine)) {
        offenders.push(`packages/${name}/dist/${file} starts with ${JSON.stringify(firstLine)}`);
      }
    }
  }
  if (offenders.length > 0) {
    console.error('check-consumers: a directive banner leaked into a built .d.ts:\n');
    for (const offender of offenders) console.error(`  - ${offender}`);
    process.exit(1);
  }
}

function packAll(scratch) {
  const scopeDir = join(scratch, 'node_modules', '@fianto');
  mkdirSync(scopeDir, { recursive: true });
  for (const name of PUBLISHED) {
    const dir = resolve(`packages/${name}`);
    const tarball = execFileSync('npm', ['pack', '--silent', '--pack-destination', scratch], { cwd: dir, encoding: 'utf8' }).trim();
    const dest = join(scopeDir, name);
    mkdirSync(dest, { recursive: true });
    execFileSync('tar', ['xf', join(scratch, tarball), '-C', dest, '--strip-components=1']);
  }
}

function linkPeerTypeDeps(scratch) {
  for (const { from, as } of PEER_TYPE_DEPS) {
    if (!existsSync(from)) continue;
    const dest = join(scratch, 'node_modules', as);
    mkdirSync(resolve(dest, '..'), { recursive: true });
    symlinkSync(realpathSync(from), dest, 'dir');
  }
}

function writeConsumer(scratch) {
  const imports = ['// Auto-generated by scripts/check-consumers.mjs — imports every published entry point.'];
  const bindings = [];
  for (const name of PUBLISHED) {
    for (const { as, from } of IMPORTS[name] ?? []) {
      imports.push(`import * as ${as} from '${from}';`);
      bindings.push(as);
    }
  }
  // Every binding is re-exported, so TS actually checks each import's resolution (see IMPORTS'
  // comment above) even for entry points CROSS_ENTRY_USAGE doesn't otherwise reference.
  const lines = [...imports, '', `export { ${bindings.join(', ')} };`, CROSS_ENTRY_USAGE];
  writeFileSync(join(scratch, 'consumer.ts'), `${lines.join('\n')}\n`);
}

function typecheck(scratch) {
  let ok = true;
  for (const [name, options] of Object.entries(RESOLUTIONS)) {
    const tsconfigPath = join(scratch, `tsconfig.${name}.json`);
    writeFileSync(
      tsconfigPath,
      JSON.stringify(
        {
          compilerOptions: {
            target: 'es2022',
            module: options.module,
            moduleResolution: options.moduleResolution,
            esModuleInterop: true,
            strict: true,
            skipLibCheck: false,
            noUncheckedSideEffectImports: true,
            noEmit: true,
            types: [],
          },
          include: ['consumer.ts'],
        },
        null,
        2,
      ),
    );
    try {
      execFileSync(TSC, ['-p', tsconfigPath], { cwd: scratch, encoding: 'utf8', stdio: 'pipe' });
      console.log(`check-consumers: ${name} OK`);
    } catch (error) {
      ok = false;
      console.error(`check-consumers: ${name} FAILED`);
      console.error(error.stdout || error.stderr || error.message);
    }
  }
  return ok;
}

checkNoDirectiveInDts();

const scratch = mkdtempSync(join(tmpdir(), 'fianto-check-consumers-'));
let ok = false;
try {
  packAll(scratch);
  linkPeerTypeDeps(scratch);
  writeConsumer(scratch);
  ok = typecheck(scratch);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (!ok) {
  console.error('\ncheck-consumers: FAILED');
  process.exit(1);
}
console.log('check-consumers: every published package resolves under node10, node16 and bundler');
