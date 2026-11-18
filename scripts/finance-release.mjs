import {readFileSync,realpathSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const ACCOUNT='1900a9d879ec765d42d9fd578138a36f';
const CONTRACTS={"remote-mcp-server-authless":{"main":"finance-entry.mjs","version":"e52594fc-b8cc-415e-b995-f695c6c04333","modules":{"finance-write.mjs":"ee68351cc1d33614194ea32c9f524914166f1e11bf3748f67e057c4288645c6e","return-tracking.mjs":"ed163fae15c3d10862fd8be2f7bc878232150a83917d0a9ae915e64a0865c06b","worker.js":"6233e46c7acf68d9e8bfe58f691e1649e9d5bf68c72645743019872c94600b54","worker.js.map":"6f9aff6826af379d4045233d51b5a820c784bc5a34095fd8ff18cee2aac28f65","finance-entry.mjs":"f7fd9149e37d8483a4bf25f96eec14e19f57e73eaf309f0a4404defd1a880ff1"}},"pcc-ai-cfo-ua":{"main":"cfo-release-20261109.mjs","version":"f53e7a9f-710e-43a6-a263-0cbb50e7209d","modules":{"cfo-verification-20261109.mjs":"3e982fb217d12902e9070cb1fb0e3642619bbdcdd152d6a93327f3ed6671fff3","claim-recovery.mjs":"a394c0155d637f0acf5e172c282a98053e94161f0596632a1c9cae510bafec1a","cfo-core-20261109.mjs":"5ab4f6cd5be482220abff2859f671094f2eb5d0cf26e725979a41997d39b39dc","cfo-release-20261109.mjs":"ef1a1f57044a9197f430029b806c1fd03a5f5af98dffa2197ed8340c5cbfbae0"}},"pcc-shopify-ua-cancel-5203-candidate":{"main":"executor-entry.mjs","version":"45e18351-7323-45c8-88ac-13633054c882","modules":{"executor-entry.mjs":"3f17731728272aeb25bd2fdecdbb865e4f6938a8ccd14b10e3e04f0e6602ad97","production-worker.mjs":"3483ef87e3e19e66c9b9a64762e5c94921470bcd26f9a3a450fc1e3181d77623","return-evidence.mjs":"d9f939a5a4bf2693d097be1a95df5071495664ab169b30e5723cc2eb7a2f9f64","return-server.mjs":"5a87292f385079df28a07f130d70896c5254318fc6f46c4e8668e4b07c24d9e9","return-workflow.mjs":"2ce653bedb31a1431948b6cf479c540c44195b170c705882a9a308be4952b2ee","cancellation-executor.mjs":"9fade4d6a2c2e81d2b1e2b7409683b6971de032fb19caf5b66d3eb2aa12dcc70"}}};
const sha=x=>createHash('sha256').update(x).digest('hex');
const fail=message=>{throw Error('FINANCE_RELEASE_BLOCKED: '+message);};

export function validateRelease(root,worker){
 const contract=CONTRACTS[worker];if(!contract)fail('unknown Worker');
 const base=realpathSync(root);const inside=file=>{const path=realpathSync(resolve(base,file));if(!path.startsWith(base+sep))fail('path escapes release root');return path;};
 let manifest;try{manifest=JSON.parse(readFileSync(inside('.finance-release/'+worker+'.json'),'utf8'));}catch{fail('complete approved release package missing');}
 if(manifest.worker!==worker||manifest.main_module!==contract.main||manifest.expected_version!==contract.version)fail('wrong target, entrypoint or baseline version');
 if(!Array.isArray(manifest.modules)||manifest.modules.length!==Object.keys(contract.modules).length)fail('module inventory mismatch');
 const names=new Set();const modules=manifest.modules.map(m=>{
  if(!m||typeof m.name!=='string'||names.has(m.name)||!Object.hasOwn(contract.modules,m.name))fail('duplicate or unapproved module');names.add(m.name);
  const data=readFileSync(inside(m.path));if(sha(data)!==contract.modules[m.name])fail('module checksum mismatch: '+m.name);
  return {name:m.name,data};
 });
 for(const name of Object.keys(contract.modules))if(!names.has(name))fail('required module missing: '+name);
 return {worker,contract,modules};
}

export async function publishRelease(release,{preview=false,token=process.env.CLOUDFLARE_API_TOKEN,request=fetch}={}){
 if(!token)fail('Cloudflare build credential unavailable');
 const base=`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/${release.worker}`;
 const api=async(path,method='GET',body)=>{
  const response=await request(base+path,{method,headers:{authorization:'Bearer '+token},...(body?{body}: {})});
  const result=await response.json();if(!response.ok||!result.success)fail('Cloudflare '+method+' '+path+' failed (HTTP '+response.status+')');return result.result;
 };
 const deployment=await api('/deployments');
 const versions=deployment.deployments?.[0]?.versions;
 if(versions?.length!==1||versions[0].percentage!==100||versions[0].version_id!==release.contract.version)fail('live deployment changed; revalidate against production');
 const settings=await api('/settings');
 const metadata={main_module:release.contract.main,compatibility_date:settings.compatibility_date,
  compatibility_flags:settings.compatibility_flags,bindings:settings.bindings.filter(b=>b.type!=='secret_text'),keep_bindings:['secret_text'],
  annotations:{'workers/message':'Validated complete finance release; module integrity gate PASS'}};
 for(const key of ['usage_model','tags','tail_consumers','logpush','observability','limits'])if(settings[key]!==undefined)metadata[key]=settings[key];
 if(settings.placement&&Object.keys(settings.placement).length)metadata.placement=settings.placement;
 const latest=await api('/deployments');if(JSON.stringify(latest.deployments?.[0]?.versions)!==JSON.stringify(versions))fail('deployment race; retry from approved snapshot');
 const body=new FormData();body.append('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));
 for(const m of release.modules)body.append(m.name,new Blob([m.data],{type:m.name.endsWith('.map')?'application/source-map':'application/javascript+module'}),m.name);
 const result=await api(preview?'/versions':'',preview?'POST':'PUT',body);
 return {worker:release.worker,preview,id:result.id,version:result.deployment_id||result.id};
}

export async function main(args=process.argv.slice(2)){
 const worker=args.find(a=>a.startsWith('--worker='))?.slice(9);const action=args.filter(a=>['--check','--publish','--preview'].includes(a));
 if(action.length!==1)fail('exactly one action required');
 const release=validateRelease(process.cwd(),worker);
 if(action[0]==='--check'){console.log('FINANCE RELEASE GATE PASS: '+worker);return;}
 console.log(JSON.stringify(await publishRelease(release,{preview:action[0]==='--preview'})));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
