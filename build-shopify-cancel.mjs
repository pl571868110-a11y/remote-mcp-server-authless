import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';

const base = readFileSync('shopify-ua-cancel.ts', 'utf8');
const guarded = readFileSync('shopify-ua-cancel-guard.ts', 'utf8')
  .replace(/^import \{ cancelReturnedOrder \} from '\.\/shopify-ua-cancel\.ts';\s*/m, '');
const transformed = stripTypeScriptTypes(`${base}\n${guarded}`, { mode: 'transform' });
const banner = '// PETSCHOICE Shopify UA cancel candidate; NOT deployed; requires trusted D1 orchestration.\n';
const output = banner + transformed;
mkdirSync('dist', { recursive: true });
writeFileSync('dist/shopify-ua-cancel-bundle.mjs', output);
const sha256 = createHash('sha256').update(output).digest('hex');
writeFileSync('dist/shopify-ua-cancel-bundle.sha256', `${sha256}  shopify-ua-cancel-bundle.mjs\n`);
console.log(JSON.stringify({ file: 'dist/shopify-ua-cancel-bundle.mjs', bytes: Buffer.byteLength(output), sha256 }));
