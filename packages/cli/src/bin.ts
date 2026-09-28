import { Fianto } from '@fianto/sdk';
import { consoleOutput } from './output.js';
import { main } from './main.js';

const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
const code = await main(process.argv.slice(2), {
  output: consoleOutput,
  env: process.env,
  makeClient: (c) => new Fianto({ appId: c.appId, appSecret: c.appSecret, baseUrl: c.baseUrl }),
  fetch: globalThis.fetch,
  now: Date.now,
  sleep: (ms, signal) => new Promise((resolve) => { const t = setTimeout(resolve, ms); signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true }); }),
  signal: controller.signal,
});
process.exitCode = code;
