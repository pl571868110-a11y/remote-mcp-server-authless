import test from "node:test";
import assert from "node:assert/strict";
import worker, { validSignature, reportFromEvent, REPORT_AGENT } from "../src/post-call-reports.ts";
const secret = "synthetic-webhook-secret";
async function signature(raw: string, t: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(t+"."+raw)));
  return `t=${t},v0=${Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("")}`;
}
const event = {type:"post_call_transcription",data:{agent_id:REPORT_AGENT,conversation_id:"conv_synthetic123",status:"done",analysis:{transcript_summary:"Synthetic customer question",call_successful:"failure"},metadata:{start_time_unix_secs:100,call_duration_secs:25},conversation_initiation_client_data:{dynamic_variables:{system__caller_id:"+48500100200"}}}};
test("valid signature accepted; tampering, wrong secret and replay rejected", async()=>{
  const t=Math.floor(Date.now()/1000), raw=JSON.stringify(event), s=await signature(raw,t);
  assert.equal(await validSignature(raw,s,secret),true);
  assert.equal(await validSignature(raw+" ",s,secret),false);
  assert.equal(await validSignature(raw,s,"other"),false);
  assert.equal(await validSignature(raw,await signature(raw,t-400),secret),false);
});
test("only intended agent and telephone conversations accepted",()=>{
  assert.equal(reportFromEvent({...event,data:{...event.data,agent_id:"other"}}),null);
  assert.equal(reportFromEvent({...event,data:{...event.data,conversation_initiation_client_data:{}}}),null);
  assert.equal(reportFromEvent({...event,type:"post_call_audio"}),null);
});
test("reports omit transcript and mask phone",()=>{
  const report=reportFromEvent({...event,data:{...event.data,transcript:[{message:"private raw transcript"}]}})!;
  assert.equal(report.caller,"…0200");
  assert.ok(!JSON.stringify(report).includes("private raw transcript"));
  assert.ok(!JSON.stringify(report).includes("+48500100200"));
});
test("duplicate webhook acknowledged using one unique conversation record",async()=>{
  const seen=new Set();
  const db={prepare:(sql:string)=>{assert.match(sql,/INSERT OR IGNORE/);return {bind:(...args:unknown[])=>({run:async()=>{seen.add(args[0]);}})};}};
  const raw=JSON.stringify(event),sig=await signature(raw,Math.floor(Date.now()/1000));
  for(let i=0;i<2;i++){
    const r=await worker.fetch(new Request("https://example.invalid/elevenlabs/post-call",{method:"POST",headers:{"ElevenLabs-Signature":sig},body:raw}),{REPORT_DB:db as any,ELEVENLABS_WEBHOOK_SECRET:secret});
    assert.equal(r.status,200);
  }
  assert.equal(seen.size,1);
});
