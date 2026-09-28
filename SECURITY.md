# Security policy

## Reporting a vulnerability

Email **security@fianto.xyz** with a description of the issue, the package(s) and version(s)
affected, and steps to reproduce (a minimal repro, if you have one, helps a lot). Please don't
open a public GitHub issue for a vulnerability before it's fixed — that gives every other user
the same head start an attacker would get.

We'll acknowledge your report within **2 business days**, and aim to have a fix (or at least a
clear plan and timeline) within **7 days** for a confirmed vulnerability, sooner for anything
that could expose an app secret, a webhook secret, or let one merchant's checkout affect
another's. We'll credit you in the release notes if you'd like, or keep it anonymous — your
call.

## Supported versions

This SDK is pre-1.0 (`0.x`). Only the **latest published `0.x` release** of each `@fianto/*`
package is supported with security fixes — all seven packages release together at the same
version (see the root [`README.md`](README.md#contributing-and-releases)), so "latest" always
means the same version number across the whole SDK. There is no backport policy for older `0.x`
releases; upgrade to the latest release to pick up a fix.

## Scope

In scope: `@fianto/sdk`, `@fianto/js`, `@fianto/react`, `@fianto/nextjs`, `@fianto/hono`,
`@fianto/express`, `@fianto/cli` — the code in this repository. A vulnerability in the fianto
API or dashboard itself (as opposed to this SDK's client code) should also go to
security@fianto.xyz, but is triaged separately.

Some things are accepted, documented risk rather than vulnerabilities to report — see each
package's README "Security" section (`@fianto/sdk`'s in particular) for what's already
considered and why: for example, `dangerouslyAllowBrowser` shipping the app secret to every
visitor is opt-in and named for exactly that reason, and a webhook route's Origin/`Sec-Fetch-Site`
check is CSRF protection only, not a substitute for your own route authenticating and
rate-limiting the caller (see `@fianto/sdk`'s README, "Authenticate and rate-limit
`createSession`").
