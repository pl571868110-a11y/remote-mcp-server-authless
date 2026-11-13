import test from "node:test";
import assert from "node:assert/strict";
import {Miniflare} from "miniflare";
import {resolve} from "node:path";

const probe={
  name:"probe", modules:true, compatibilityDate:"2026-08-01",
  script:"export default { async fetch(req, env) { const x=await req.json();return Response.json(await env.RECOVERY.classify(x));} };",
  serviceBindings:{RECOVERY:{name:"recovery",entrypoint:"TaskRecovery"}}
};
const recovery={name:"recovery",modules:true,scriptPath:resolve("src/index.mjs"),compatibilityDate:"2026-08-01"};
const mf=new Miniflare({workers:[probe,recovery]});
test.after(async()=>{await mf.dispose()});
async function classify(input){
  const res=await mf.dispatchFetch("http://probe.invalid/review",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
  assert.equal(res.status,200);
  return res.json();
}
const base={taskId:"synthetic-unknown-1",idempotencyKey:"same-id-1",state:"unknown",stages:[],receipts:[]};
test("RPC unconfirmed HERMES blocks replay",async()=>{
  const r=await classify({...base,stages:[{stage:"hermes_execution",state:"unknown"}]});
  assert.equal(r.classification,"EXECUTION_UNCONFIRMED");
  assert.equal(r.replayPermitted,false);assert.equal(r.mayChangeState,false);
});
test("RPC receipt presence alone is not verified",async()=>{
  const r=await classify({...base,stages:[{stage:"hermes_execution",state:"unknown"}],receipts:[{kind:"backend_receipt",source:"hermes",ref:"synthetic-1"}]});
  assert.equal(r.classification,"POTENTIAL_EXECUTION_RECEIPTS_UNVERIFIED");
  assert.equal(r.definitiveExecutionProof,false);assert.equal(r.replayPermitted,false);
});
test("RPC upstream interruption does not authorize retry",async()=>{
  const r=await classify({...base,errorCode:"UPSTREAM_INTERRUPTED"});
  assert.equal(r.classification,"NO_EXECUTION_EVIDENCE");assert.equal(r.replayPermitted,false);
});
