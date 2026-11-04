import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeShopifyUaWrite as authorize } from '../src/shopify-ua-write-auth.ts';

const env = { PCC_MCP_WRITE_TOKEN: 'synthetic-write', PCC_MCP_READ_TOKEN: 'synthetic-read', PCC_SHOPIFY_UA_WRITE_ACCESS_AUD: 'synthetic-write-aud', PCC_SHOPIFY_UA_WRITE_ACCESS_EMAILS: 'owner@example.test' };
const request = (token?: string, path = '/shopify-ua-write-mcp', extra = {}) => new Request(`https://example.test${path}`, { headers: { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
const access = (aud = env.PCC_SHOPIFY_UA_WRITE_ACCESS_AUD, email = 'owner@example.test') => ({ access: { aud, getIdentity: async () => ({email}) } });

test('internal CFO write token accepted without Access', async () => assert.equal(await authorize(request(env.PCC_MCP_WRITE_TOKEN), env, {}), null));
test('anonymous denied', async () => assert.equal((await authorize(request(), env, {}))?.status, 401));
test('read token denied even with valid Access', async () => assert.equal((await authorize(request(env.PCC_MCP_READ_TOKEN), env, access()))?.status, 401));
test('wrong token denied without Access', async () => assert.equal((await authorize(request('wrong'), env, {}))?.status, 401));
test('verified write audience and owner accepted', async () => assert.equal(await authorize(request('oauth-token'), env, access()), null));
test('read audience cannot authorize write', async () => assert.equal((await authorize(request(), env, access('read-aud')))?.status, 401));
test('other user denied', async () => assert.equal((await authorize(request(), env, access(undefined, 'other@example.test')))?.status, 401));
test('spoofed identity headers ignored', async () => assert.equal((await authorize(request(undefined, undefined, { 'Cf-Access-Jwt-Assertion': 'forged', 'Cf-Access-Authenticated-User-Email': 'owner@example.test' }), env, {}))?.status, 401));
test('missing write token fails closed even with Access', async () => assert.equal((await authorize(request(), {...env, PCC_MCP_WRITE_TOKEN: undefined}, access()))?.status, 503));
test('shared read/write token fails closed', async () => assert.equal((await authorize(request(), {...env, PCC_MCP_WRITE_TOKEN: env.PCC_MCP_READ_TOKEN}, access()))?.status, 503));
test('OAuth disabled without explicit write audience', async () => assert.equal((await authorize(request(), {...env, PCC_SHOPIFY_UA_WRITE_ACCESS_AUD: undefined}, access()))?.status, 401));
test('OAuth disabled without explicit write owners', async () => assert.equal((await authorize(request(), {...env, PCC_SHOPIFY_UA_WRITE_ACCESS_EMAILS: ''}, access()))?.status, 401));
test('identity lookup failure denied without leaking details', async () => { const response = await authorize(request(), env, {access: {aud: env.PCC_SHOPIFY_UA_WRITE_ACCESS_AUD, getIdentity: async () => { throw Error('private'); }}}); assert.equal(response?.status,401); assert.equal(await response?.text(), 'Unauthorized'); });
test('other routes untouched', async () => assert.equal(await authorize(request(undefined,'/shopify-ua-mcp'), env, access()), null));
