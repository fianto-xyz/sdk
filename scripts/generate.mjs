// Regenerates packages/sdk/src/generated/* from spec/openapi.json. Never edit the output.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const SPEC = 'spec/openapi.json';
const OUT = 'packages/sdk/src/generated';

execFileSync('pnpm', ['exec', 'openapi-typescript', SPEC, '-o', `${OUT}/api.ts`], { stdio: 'inherit' });

const spec = JSON.parse(readFileSync(SPEC, 'utf8'));
const codeSchema = spec.components.schemas.Error.properties.code;
const known = (codeSchema.anyOf ?? [codeSchema]).find((s) => Array.isArray(s.enum)).enum;
const pascal = (code) => code.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join('');
// The Error.code description marks a retired code as "`code`: Deprecated: <why>."; carry it as @deprecated.
const deprecated = new Map(
  [...(codeSchema.description ?? '').matchAll(/`(\w+)`: Deprecated: ([^.]*\.)/g)].map((m) => [m[1], m[2]]),
);
const lines = [...known].sort().flatMap((code) => [
  ...(deprecated.has(code) ? [`  /** @deprecated ${deprecated.get(code)} */`] : []),
  `  ${pascal(code)}: '${code}',`,
]);
writeFileSync(
  `${OUT}/error-codes.ts`,
  [
    '// Generated from spec/openapi.json by scripts/generate.mjs. Do not edit.',
    '',
    '/** Every error `code` the v1 API documents. Treat any other string as an unknown error. */',
    'export const ErrorCode = {',
    ...lines,
    '} as const;',
    '',
    'export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];',
    '',
  ].join('\n'),
);
console.log(`${OUT}/api.ts, ${OUT}/error-codes.ts written`);
