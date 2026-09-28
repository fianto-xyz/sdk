# Contributing

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

Every push to `master` and every pull request runs `.github/workflows/ci.yml` on Node 20.x,
22.x and 24.x: `pnpm install --frozen-lockfile`, then `check:generated`, `lint`, `typecheck`,
`test`, `check:packages` in that order. A PR can't merge with any of those red.

## Releases

Releases are automatic and happen only when a "Version packages" pull request merges to
`master` — nobody runs `pnpm release` by hand outside of local testing:

1. Every change that affects a published package needs a changeset (see above), committed with
   the change's PR.
2. Once that PR merges to `master`, `.github/workflows/release.yml` runs `changeset version`,
   which opens or updates a "Version packages" PR bumping every `@fianto/*` package together
   (the `fixed` group in `.changeset/config.json`) and rolling the pending changesets into
   `CHANGELOG.md` entries.
3. Merging **that** PR runs the same workflow again, this time publishing every package to npm
   with provenance (`pnpm release`, i.e. `check:packages` then `changeset publish`) and creating
   the matching GitHub releases/tags.

Before the first release can run, the `NPM_TOKEN` repository secret and the `@fianto` npm
organization must already exist — the workflow has no way to create either. The first publish
ships every package at `0.1.0`; only add a changeset for a version after that.
