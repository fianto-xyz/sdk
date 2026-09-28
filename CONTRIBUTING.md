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
