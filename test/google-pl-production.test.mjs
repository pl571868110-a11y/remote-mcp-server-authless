import test from 'node:test';
import assert from 'node:assert/strict';
import before from '../production-baseline/worker.js';
import after from '../production-candidate/worker.js';
const env = {PCC_MCP_READ_TOKEN:'synthetic-read',PCC_MCP_WRITE_TOKEN:'synthetic-write',PCC_GOOGLE_PL_READ_TOKEN:'synthetic-google'};
const ctx = {waitUntil(){}};
const origin = 'https://remote-mcp-server-authless.pl571868110.workers.dev';
for(const path of ['/mcp','/google-mcp','/google-diagnostics-mcp','/shopify-pl-mcp','/shopify-ua-mcp','/shopify-ua-write-mcp','/meta-server-mcp','/google-ua-diagnostics-mcp','/unknown']) {
 for(const authorization of [null,'Bearer synthetic-read','Bearer invalid']) {
  test(`preserves route/auth ${path} ${authorization??'anonymous'}`,async(t)=>{
   let outbound=0;t.mock.method(globalThis,'fetch',async()=>{outbound++;throw Error('NETWORK_DISABLED');});
   const headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
   if(authorization)headers.Authorization=authorization;
   const req=()=>new Request(origin+path,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})});
   const a=await before.fetch(req(),env,ctx),b=await after.fetch(req(),env,ctx);
   assert.equal(b.status,a.status);assert.equal(b.headers.get('WWW-Authenticate'),a.headers.get('WWW-Authenticate'));
   assert.equal(await b.text(),await a.text());assert.equal(outbound,0);
  });
 }
}
test('PL setup route remains disabled without temporary credential',async()=>{
 const r=await after.fetch(new Request(origin+'/oauth/google/pl/start'),env,ctx);assert.equal(r.status,503);
});
