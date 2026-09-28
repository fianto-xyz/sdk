# Contributing

## Node version

The **published packages** run on Node ≥20.3 (`engines.node` in every `packages/*/package.json`).
That's the floor `runtime-node20`'s `smoke-runtime.mjs` verifies against the actual built `dist/`.

**Building or contributing to this repo needs newer Node than that.** The build tool, `tsdown`,
declares `engines.node: "^22.18.0 || ^24.11.0 || >=26.0.0"` (`node_modules/tsdown/package.json`) —
so does `jsdom` (vitest's browser-test environment) and `@changesets/cli`. Below that floor,
`pnpm build`/`pnpm typecheck`/`pnpm test`/`pnpm check:packages` all fail the same way, tsdown's
optional config-loader failing to import `unrun`:

```
ERROR  Error: Failed to import module "unrun". Please ensure it is installed.
```

Use Node 22.18.0+ or 24.11.0+ (or 26+) to work on this repo. `pnpm dev`/CI's `check` job run on
the 22.x/24.x matrix for the same reason — the 20.3.0 leg (`runtime-node20`) only ever runs the
already-built `dist/` output, never the build tooling itself.

## Changesets

Every change that affects a published package needs a changeset:

```bash
pnpm changeset
```

Pick the packages and the bump (all `@fianto/*` packages are versioned together), write one
line for the changelog, and commit the generated `.changeset/*.md` file with your change.

## Publishing

Publish **only** with:

```bash
pnpm release
```

It runs `pnpm check:packages` (build, publint, attw) and then `changeset publish`, which rewrites
`workspace:*` dependencies to real versions. Never run `npm publish` (or `pnpm publish` inside a
package by hand): `npm publish` ships `workspace:*` unresolved and the package cannot be installed.

## CI

Every push to `master` and every pull request runs `.github/workflows/ci.yml`'s `check` job on
Node 22.x and 24.x (see Node version above for why 20.x can't be in that matrix):
`pnpm install --frozen-lockfile`, then `check:generated`, `lint`, `typecheck`, `test`,
`check:packages` in that order. A separate `runtime-node20` job builds on Node 22.x and then
switches to Node 20.3.0 — `engines.node`'s floor — to run the built `dist/` output directly. A PR
can't merge with either job red.

## Releases

Releases are automatic and run from the `release` job in `.github/workflows/ci.yml`, which
`needs: check`: it runs only on a push to `master`, and only after every CI leg passed — a red CI
never publishes. Nobody runs `pnpm release` by hand outside of local testing.

The first push to master publishes 0.1.0 once CI passes (see the maintainer setup below); later
releases go through the Changesets 'Version packages' PR:

1. Every change that affects a published package needs a changeset (see above), committed with
   the change's PR.
2. Once that PR merges to `master` and CI passes, the `release` job runs `changeset version`,
   which opens or updates a "Version packages" PR bumping every `@fianto/*` package together
   (the `fixed` group in `.changeset/config.json`) and rolling the pending changesets into
   `CHANGELOG.md` entries.
3. Merging **that** PR runs the same job again (again only after CI passes), this time publishing every package to npm
   with provenance (`pnpm release`, i.e. `check:packages` then `changeset publish`) and creating
   the matching GitHub releases/tags.

### Maintainer setup (before the first release)

The `NPM_TOKEN` repository secret and the `@fianto` npm organization must already exist before
the first release can run — the workflow has no way to create either. Create both first. The
first publish ships every package at `0.1.0`; only add a changeset for a version after that.
