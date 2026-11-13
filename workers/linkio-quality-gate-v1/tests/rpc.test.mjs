import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { resolve } from "node:path";

const quality = { name: "quality", modules: true, scriptPath: resolve("src/index.mjs") };
const probe = {
  name: "probe", modules: true,
  script: "export default { async fetch(request, env) { const payload = await request.json(); const result = await env.QUALITY.evaluate(payload); return Response.json(result); } };",
  serviceBindings: { QUALITY: { name: "quality", entrypoint: "QualityGate" } }
};
const mf = new Miniflare({ workers: [probe, quality], compatibilityDate: "2026-11-01", compatibilityFlags: ["rpc"] });
test.after(async()=>{await mf.dispose();});

async function evaluate(text, policy) {
  const res = await mf.dispatchFetch("http://test.invalid/evaluate", { method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({taskId:"synthetic-1",stage:"gpt_final",text,policy}) });
  assert.equal(res.status, 200);
  return res.json();
}
test("service-binding RPC PASS",async()=>{const r=await evaluate("hello",{maxChars:10});assert.equal(r.status,"PASS");assert.equal(r.accepted,true);});
test("service-binding RPC FAIL",async()=>{const r=await evaluate("12345678901",{maxChars:10});assert.equal(r.status,"FAIL");assert.equal(r.accepted,false);assert.ok(r.failed.includes("MAX_CHARS"));});
test("unverified source does not pass",async()=>{const r=await evaluate("source",{maxChars:50,sourceUrls:["https://example.com/a"],requireVerifiedSources:true});assert.equal(r.status,"UNVERIFIED");assert.equal(r.accepted,false);});
