# @fianto/cli

A command line for developing against [fianto](https://fianto.xyz): check your application's
status, inspect recent events, forward them to a route running on your own machine, trigger a
test delivery, and sign a payload by hand — the `fianto` binary.

```bash
npx @fianto/cli whoami
# or, added to your project:
pnpm add -D @fianto/cli
pnpm exec fianto whoami
```

Requires Node.js ≥ 20.3. This package holds your app secret, so it belongs on your development
machine or a trusted CI job — never ship it to a browser.

## Credentials

Most commands call the fianto API and need application credentials, from the environment or
flags (**flags win**). Get them from **Dashboard → Developers → Applications**: your app, then
"Reveal" the secret.

| Flag | Env var | Default |
|---|---|---|
| `--app-id <id>` | `FIANTO_APP_ID` | — (required) |
| `--app-secret <secret>` | `FIANTO_APP_SECRET` | — (required) |
| `--base-url <url>` | `FIANTO_BASE_URL` | `https://api.fianto.xyz` |

A missing `--app-id`/`--app-secret` (or their env vars) exits `2` and names exactly which flag or
env var to set. `--base-url`/`FIANTO_BASE_URL` is optional — omit it to use the production API,
or point it at your own self-hosted deployment or a backend running locally (there's no separate
"devnet" API host to switch to).

Commands that sign or verify webhooks instead take a **webhook** secret. Set it once as
`FIANTO_WEBHOOK_SECRET` in your shell/CI env — the safest place for it — or override it per
invocation with a flag:

| Env var | Flag | Notes |
|---|---|---|
| `FIANTO_WEBHOOK_SECRET` | `--secret <whsec_...>` | Highest precedence when given. |
| — | `--secret-file <path>` | Reads the file as UTF-8 and trims it — handy for a secret mounted from a file (e.g. a Docker/K8s secret) rather than an env var. Beaten by `--secret`. |

**`fianto trigger <type> --forward-to <url>` and `fianto sign` need only the webhook secret — no
`--app-id`, `--app-secret` or `--base-url`, and no network call to fianto at all.** They only
sign a local payload and (for `trigger --forward-to`) POST it to a URL you gave them.

The secret is never printed — not in normal output, not in an error, not in `--help`.

## Commands

### `fianto whoami`

`GET v1/application`: who these credentials belong to and where webhooks are configured to go.

```
$ fianto whoami
Application  Shop (fian_app_1)
Merchant     Acme
Webhook      ACTIVE https://shop.test/wh
```

(`Webhook      not configured` if no endpoint is registered yet.)

### `fianto events list [--type <type>] [--limit <n>]`

A page of `GET v1/events`, newest first — the API's own order. `--limit` defaults to 20, max 100.

```
$ fianto events list --type order.paid --limit 5
evt_2  2026-09-28T00:00:01Z  order.paid
evt_1  2026-09-28T00:00:00Z  order.paid
```

### `fianto events get <evt_id>`

`GET v1/events/:id`, pretty-printed.

```
$ fianto events get evt_x
{
  "id": "evt_x",
  "object": "event",
  "type": "order.paid",
  "timestamp": "2026-09-28T00:00:00Z",
  "data": { "order_id": "ord_1" }
}
```

### `fianto events tail --forward-to <url> [--secret <whsec_>|--secret-file <path>] [--since <duration>] [--type <type>] [--interval <ms>]`

Polls `GET v1/events`, re-signs each new one exactly as fianto would (`signWebhook` from
`@fianto/sdk/webhooks`), and `POST`s it to your local `--forward-to` URL — a stand-in for a real
webhook delivery while you develop against `localhost`. Runs until you press Ctrl-C.

```
$ fianto events tail --forward-to http://localhost:3000/api/webhooks/fianto --secret whsec_...
Forwarding events from the last 5m to http://localhost:3000/api/webhooks/fianto (Ctrl-C to stop)
→ 200 order.paid evt_2 42ms
✗ order.paid evt_3 fetch failed
```

- **`--since`** defaults to `5m` (`30s`, `10m`, `2h`, `1d` are all valid — a number followed by
  `s`, `m`, `h` or `d`). On start, only events **newer** than `now - --since` are forwarded —
  never the full 90-day event store, however far back `--since` reaches.
- **`--interval`** defaults to `2000` (ms) and must be an integer of at least `500`.
- **Each poll reads events 100 at a time** (`GET v1/events?limit=100`) and follows `next_cursor`
  across as many pages as it takes to catch up, so a burst of more than 100 new events in one
  interval is never skipped.
- **What's forwarded is the delivery envelope fianto itself would send** — `id`, `type`,
  `timestamp`, `data` — not the `list`/`get` shape (which also carries `object: "event"`).
- **A failed poll** (API or network error) prints `✗ poll failed: <message>` and tries again after
  `--interval`; the tail keeps running.
- **Each event id is forwarded once, oldest first** — within a single poll and across polls for
  the life of the process (an in-memory seen-set, capped at 10,000 ids, oldest dropped first).
- **This is a local dev convenience, not a delivery guarantee.** It's at-most-once *per run*: if
  your local server is down, a forward attempt is logged with `✗` and the event is still marked
  seen rather than retried, and a crash or restart of the CLI itself forwards nothing that
  already went out and may miss whatever landed during the gap. For fianto's own at-least-once,
  retried delivery to a real endpoint, register one in the dashboard.
- **Ctrl-C** finishes whichever forward is already in flight (never mid-request) and exits `130`
  — nothing else already gathered for that poll's batch goes out afterward, and no new poll
  starts. A second Ctrl-C stops immediately instead of waiting even for that.

### `fianto trigger <type> [--forward-to <url>] [--secret <whsec_>|--secret-file <path>] [--allow-remote]`

Two different things depending on the type and `--forward-to` — see [Safety
split](#safety-split) below.

**Any** known event type (including `test.event`) **with** `--forward-to`: signs a realistic
local sample (`sampleEvent(type)`) and `POST`s it to that URL only. No API call, no app
credentials needed — only the webhook secret.

```
$ fianto trigger order.paid --forward-to http://localhost:3000/api/webhooks/fianto --secret whsec_...
→ 200 order.paid (local sample)
```

- **`--forward-to` only accepts a loopback URL** — `localhost`, an address in `127.0.0.0/8`, or
  `[::1]` — **unless `--allow-remote` is passed.** A signed sample is indistinguishable from a
  real delivery to whatever receives it; sending one to an arbitrary public URL could be mistaken
  for (and act on) a real order. The sample data also carries unmistakable ids (`order_id:
  "sample_order_1001"` and similar) for the same reason.
- **A non-2xx response from `--forward-to` is treated as a failure**: the status line is still
  printed, then the command exits `1`.
- **A warning is printed to stderr** when the signing secret came from `FIANTO_WEBHOOK_SECRET`
  rather than `--secret`/`--secret-file` — a nudge to notice you're about to sign with whatever
  secret happens to be in your environment.

`test.event` with **no** `--forward-to`: asks fianto itself to deliver a real, signed
`test.event` to your registered webhook endpoint (`POST v1/webhook/test-event`, sharing the
dashboard's 10/hour budget for that route). This is the one case that does call the API and
does need app credentials.

```
$ fianto trigger test.event
Sent test.event evt_abc123 to your registered endpoint
```

Any *other* business event type with no `--forward-to` is refused as a usage error — fianto
will never send one of those on your behalf (see [Safety split](#safety-split)).

### `fianto sign --payload <file> [--secret <whsec_>|--secret-file <path>] [--id <id>] [--timestamp <unix>]`

Reads a JSON event from `<file>`, signs it exactly as fianto would, and prints the signed body
followed by a ready `curl` command (with `$URL` left for you to fill in). No API call — only
the webhook secret is needed. Every value interpolated into that `curl` line — including `--id`
— is POSIX-shell-quoted, so pasting it is safe even if `--id` contains a quote, `$(...)`, spaces
or a newline.

```
$ fianto sign --payload event.json --secret whsec_...
{"id":"evt_fixed","type":"order.paid","timestamp":"2026-09-28T10:00:00Z","data":{}}
curl -X POST "$URL" -H 'content-type: application/json' -H 'webhook-id: evt_fixed' -H 'webhook-timestamp: 1790000000' -H 'webhook-signature: v1,...' --data-binary @event.json
```

`--id` defaults to the payload's own `id` field (else a fresh `evt_` id); `--timestamp` (Unix
seconds) defaults to now.

### `fianto --version` / `fianto -v`

Prints the installed `@fianto/cli` version and exits `0`.

### `fianto help` / `fianto --help` / `fianto`

Prints the usage text above and exits `0` — including with no command at all.

## Safety split

fianto never sends a business-event sample on your behalf. `fianto trigger <type>
--forward-to <url>` signs a realistic *local* sample and posts it to a URL you gave it —
nothing reaches fianto's API. The **only** thing fianto itself can be asked to send is
`test.event` (`fianto trigger test.event`, no `--forward-to`), delivered to the webhook
endpoint you've registered, never to an arbitrary URL. `fianto events tail` forwards *real*
events your account already produced, but the forwarding itself is done locally by the CLI,
signed with your own secret — fianto's delivery pipeline is not involved.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success. |
| `1` | A handled error. An `APIError` prints `code: message (request req_id)` to stderr; any other error prints its message to stderr (with ` (cause: ...)` appended when the error carries a `cause`). |
| `2` | A usage error — unknown command, unknown flag, or a required flag/env var missing. The reason, then the full usage text, go to stderr. |
| `130` | `events tail` was stopped with Ctrl-C. |

```
$ fianto whoami
invalid_api_credentials: Bad credentials (request req_abcdefgh)
$ echo $?
1
```

```
$ fianto events tail
events tail requires --forward-to <url>
Usage: fianto <command> [options]
...
$ echo $?
2
```

## Runtime notes

`fianto events tail` and `trigger --forward-to` POST to whatever URL you pass — typically
`http://localhost:<port>/...`, a route built with `@fianto/nextjs`'s `Webhooks()`,
`@fianto/hono`'s `webhooks()`, `@fianto/express`'s `webhooks()`, or `createWebhookHandler` from
`@fianto/sdk/handlers` directly. Point it at the same route you'll register as your production
webhook endpoint.

## Troubleshooting

- **`Missing --app-id: pass --app-id or set FIANTO_APP_ID.`** (or `--app-secret`) — set the named
  flag or env var. `trigger --forward-to` and `sign` don't need any of these. `--base-url` is
  never required: it defaults to the production API.
- **`Missing --secret: pass --secret, --secret-file <path>, or set FIANTO_WEBHOOK_SECRET.`** —
  needed by `events tail`, `trigger --forward-to` and `sign`; use the signing secret for the
  endpoint you registered.
- **`--forward-to must be a loopback URL ... unless --allow-remote is passed.`** — `trigger` only
  posts a signed sample to `localhost`/`127.0.0.0/8`/`[::1]` by default; pass `--allow-remote` if
  you really mean to send it somewhere else (see [Safety split](#safety-split)).
- **`events tail` prints nothing** — the account has produced no events inside `--since` (default
  the last 5 minutes); widen it, e.g. `--since 1d`.
- **`events tail` shows `✗ ... fetch failed`** — your local server (`--forward-to`) isn't
  running or isn't listening on that port yet; the CLI keeps polling and will forward the next
  matching event once it's up (already-attempted events are not retried — see `events tail`
  above).

## License

MIT
