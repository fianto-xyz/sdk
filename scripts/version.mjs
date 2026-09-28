// The release workflow's version-script. changesets/action invokes this as a single command
// (via @actions/exec, not a shell), so the "changeset version && sync versions && relock"
// sequence has to be one process rather than `&&`-chained directly in the workflow YAML — `&&`
// there would just be passed as a literal argument to `changeset`, not interpreted.
//
// 1. `changeset version` bumps every package.json (and CHANGELOG.md) per the pending changesets.
// 2. `sync-versions.mjs` then rewrites each package's hand-kept src/version.ts to match — step 1
//    alone leaves those stale, and version.test.ts asserts they match package.json.
// 3. `pnpm install --lockfile-only` updates pnpm-lock.yaml for the new versions without a full
//    reinstall, so the "Version packages" PR's lockfile isn't left out of date.
import { execFileSync } from 'node:child_process';

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

run('pnpm', ['changeset', 'version']);
run('node', ['scripts/sync-versions.mjs']);
run('pnpm', ['install', '--lockfile-only']);
