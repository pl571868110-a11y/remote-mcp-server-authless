import test from 'node:test';
import assert from 'node:assert/strict';
import { SHOPIFY_UA_ACCESS_ISSUER as issuer, SHOPIFY_UA_ACCESS_AUDIENCE as audience, verifyShopifyUaAccessAssertion as verify, authorizeShopifyUaAccessRequest as authorize } from '../src/shopify-ua-access-auth.mjs';

const pair = await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5', modulusLength:2048, publicExponent:new Uint8Array([1,0,1]), hash:'SHA-256'}, true, ['sign','verify']);
const jwk = {...await crypto.subtle.exportKey('jwk', pair.publicKey), kid:'test-key', alg:'RS256'};
const now = Math.floor(Date.now()/1000);
const email = 'owner@example.test';
const claims = {iss:issuer,aud:[audience],iat:now-10,exp:now+600,sub:'owner-id',email};
const base64 = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
async function sign(overrides={}, header={alg:'RS256',kid:'test-key'}) {
  const message = base64(header)+'.'+base64({...claims,...overrides});
  return message+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(message))).toString('base64url');
}
const keys = async (url,options) => {assert.equal(url,issuer+'/cdn-cgi/access/certs');assert.equal(options.redirect,'manual');return Response.json({keys:[jwk]});};
test('signed owner assertion is accepted', async()=>assert.equal(await verify(await sign(),[email],keys),true));
for (const [label, override] of Object.entries({issuer:{iss:'https://evil.test'},audience:{aud:['other-app']},expired:{exp:now-1},future:{nbf:now+600},iat:{iat:now+600},identity:{email:'stranger@example.test'},noSubject:{sub:''}})) {
  test('reject '+label,async()=>assert.equal(await verify(await sign(override),[email],keys),false));
}
test('reject altered signature',async()=>{const jwt=await sign();const [h,p,s]=jwt.split('.');assert.equal(await verify(h+'.'+base64({...claims,sub:'altered'})+'.'+s,[email],keys),false);});
test('reject unsigned and malformed headers',async()=>{assert.equal(await verify(await sign({}, {alg:'none',kid:'test-key'}),[email],keys),false);assert.equal(await verify('bad',[email],keys),false);});
test('reject unavailable or wrong JWKS',async()=>{const jwt=await sign();assert.equal(await verify(jwt,[email],async()=>{throw Error('network');}),false);assert.equal(await verify(jwt,[email],async()=>Response.json({keys:[{...jwk,kid:'wrong'}]})),false);});
test('require explicit owner allowlist',async()=>assert.equal(await verify(await sign(),[],keys),false));
test('reject JWKS redirects without following them',async()=>assert.equal(await verify(await sign(),[email],async(url,options)=>{assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://evil.test'}});}),false));
test('scope, hostname, static authorization and fail-closed config stay intact',async()=>{
  const jwt=await sign();const env={PCC_SHOPIFY_UA_ACCESS_EMAILS:email};
  const req=(path,host='remote-mcp-server-authless.pl571868110.workers.dev')=>new Request('https://'+host+path,{headers:{'Cf-Access-Jwt-Assertion':jwt}});
  const denied=()=>new Response('Unauthorized',{status:401});
  assert.equal(await authorize(req('/shopify-ua-mcp'),env,denied,keys),null);
  for(const path of ['/mcp','/shopify-ua-write-mcp','/shopify-pl-mcp','/cfo-read-mcp'])assert.equal((await authorize(req(path),env,denied,keys)).status,401);
  assert.equal((await authorize(req('/shopify-ua-mcp','other.test'),env,denied,keys)).status,401);
  assert.equal((await authorize(req('/shopify-ua-mcp'),env,()=>new Response('bad config',{status:503}),keys)).status,503);
  assert.equal(await authorize(req('/shopify-ua-mcp'),env,()=>null,keys),null);
  assert.equal((await authorize(new Request('https://remote-mcp-server-authless.pl571868110.workers.dev/shopify-ua-mcp'),env,denied,keys)).status,401);
});
