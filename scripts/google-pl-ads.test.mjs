import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {patchWorker,tokenHelper} from './patch-google-pl-ads.mjs';
const worker=readFileSync('modules/remote-mcp-server-authless/worker.js','utf8');
function harness(env,fetcher,legacy=()=>{throw Error('legacy credential used');}){
 const search=worker.slice(worker.indexOf('async function googleAdsSearch('),worker.indexOf('__name(googleAdsSearch,'));
 return runInNewContext(tokenHelper+search+';({getPolandAdsAccessToken,googleAdsSearch})',{
  currentEnv2:env,URLSearchParams,fetch:fetcher,getAccessToken:legacy,
  googleAdsAccount:()=>({customerId:env.customerId||'1582377809'}),readJsonResponse:async r=>r.json()
 });
}
const env={GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',GOOGLE_PL_REFRESH_TOKEN:'synthetic-poland',GOOGLE_REFRESH_TOKEN:'synthetic-shared'};
test('PL uses isolated stored credential and fixed Ads endpoint',async()=>{
 const calls=[];const h=harness(env,async(url,init)=>{calls.push({url,init});return Response.json(url.includes('/token')?{access_token:'synthetic-access'}:{results:[]});});
 await h.googleAdsSearch('SELECT customer.id FROM customer');
 assert.equal(calls.length,2);assert.equal(calls[0].init.body.get('refresh_token'),'synthetic-poland');
 assert.equal(calls[1].url,'https://googleads.googleapis.com/v25/customers/1582377809/googleAds:search');
 assert.equal(calls[1].init.headers.Authorization,'Bearer synthetic-access');
});
test('missing PL grant fails closed without shared-token fallback',async()=>{
 const h=harness({...env,GOOGLE_PL_REFRESH_TOKEN:undefined},()=>{throw Error('network called');});
 await assert.rejects(()=>h.googleAdsSearch('query'),/CREDENTIALS_NOT_CONFIGURED/);
});
test('wrong PL customer is rejected before OAuth/network',async()=>{
 const h=harness({...env,customerId:'3206813262'},()=>{throw Error('network called');});
 await assert.rejects(()=>h.googleAdsSearch('query'),/IDENTITY_MISMATCH/);
});
test('OAuth failure is redacted and never retried',async()=>{
 let calls=0;const h=harness(env,()=>{calls++;return Response.json({error:'invalid_grant',error_description:'synthetic-sensitive'},{status:400});});
 await assert.rejects(()=>h.googleAdsSearch('query'),e=>e.message==='GOOGLE_PL_ADS_OAUTH_FAILED_HTTP_400');assert.equal(calls,1);
});
test('UA keeps existing credential selection',async()=>{
 const markets=[];const h=harness(env,()=>Response.json({results:[]}),async market=>{markets.push(market);return 'ua-synthetic';});
 await h.googleAdsSearch('query','UA');assert.deepEqual(markets,['UA']);
});
test('shared GA4 refresh function stays on shared credential',()=>{
 const shared=worker.slice(worker.indexOf('async function getAccessToken('),worker.indexOf('__name(getAccessToken,'));
 assert.ok(shared.includes('currentEnv2.GOOGLE_REFRESH_TOKEN'));assert.ok(!shared.includes('GOOGLE_PL_REFRESH_TOKEN'));
 assert.ok(worker.includes('async function ga4RunReport(body) {\n  const token = await getAccessToken();'));
});
test('patch refuses unapproved or already patched source',()=>{assert.throws(()=>patchWorker(worker),/baseline checksum mismatch/);assert.throws(()=>patchWorker('unknown'),/baseline checksum mismatch/);});
