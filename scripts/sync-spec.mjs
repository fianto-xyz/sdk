// Copies the backend's committed OpenAPI document into spec/openapi.json.
// FIANTO_BACKEND_DIR overrides the default sibling checkout (../backend).
import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const backend = resolve(process.env.FIANTO_BACKEND_DIR ?? '../backend');
const source = resolve(backend, 'openapi/v1.json');
if (!existsSync(source)) {
  console.error(`No OpenAPI document at ${source}. Set FIANTO_BACKEND_DIR to the backend checkout.`);
  process.exit(1);
}
copyFileSync(source, resolve('spec/openapi.json'));
console.log(`spec/openapi.json <- ${source}`);
