import {readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {resolve,dirname,sep} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {patchWorker,BASE_VERSION} from './patch-google-pl-ads.mjs';
import {validateRelease} from './finance-release.mjs';
const root=realpathSync(process.cwd());
const packed=[0,1].map(i=>readFileSync(resolve(root,'.finance-release/approved-gateway-source.part'+i),'utf8').trim()).join('');
const payload=JSON.parse(gunzipSync(Buffer.from(packed,'base64'),{maxOutputLength:16*1024*1024}));
if(payload.manifest?.worker!=='remote-mcp-server-authless'||payload.modules?.length!==13)throw Error('Invalid complete finance package');
payload.manifest.expected_version=BASE_VERSION;
for(const m of payload.modules){
 if(m.path==='modules/remote-mcp-server-authless/worker.js') m.source=patchWorker(m.source);
 const path=resolve(root,m.path);if(!path.startsWith(root+sep)||!m.path.startsWith('modules/remote-mcp-server-authless/'))throw Error('Invalid artifact path');
 mkdirSync(dirname(path),{recursive:true});writeFileSync(path,m.source);
}
writeFileSync(resolve(root,'.finance-release/remote-mcp-server-authless.json'),JSON.stringify(payload.manifest));
validateRelease(root,'remote-mcp-server-authless');
console.log('Complete approved finance package materialized; module gate PASS');
