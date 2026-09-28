import { Fianto } from '@fianto/sdk';
import { consoleOutput } from './output.js';
import { main } from './main.js';

const controller = new AbortController();
// First Ctrl-C: abort the signal so the running command (e.g. `events tail`) can wind down after
// finishing whatever forward is in flight, then exit 130. A second Ctrl-C means "stop now" —
// exit immediately without waiting for that cleanup.
let interrupted = false;
process.on('SIGINT', () => {
  if (interrupted) process.exit(130);
  interrupted = true;
  controller.abort();
});
const code = await main(process.argv.slice(2), {
  output: consoleOutput,
  env: process.env,
  makeClient: (c) => new Fianto({ appId: c.appId, appSecret: c.appSecret, ...(c.baseUrl ? { baseUrl: c.baseUrl } : {}) }),
  fetch: globalThis.fetch,
  now: Date.now,
  sleep: (ms, signal) => new Promise((resolve) => { const t = setTimeout(resolve, ms); signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true }); }),
  signal: controller.signal,
});
process.exitCode = interrupted ? 130 : code;
