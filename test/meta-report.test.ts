import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectMeta, handleMetaReport } from '../src/meta-report.ts';
const token = 'test-secret-do-not-return';
const env = {META_ACCESS_TOKEN:token,META_REVIEW_INTERNAL_TOKEN:'report-key'};
const row = (spend='100',date='2026-11-01') => ({account_id:'1792664644903675',account_currency:'UAH',date_start:date,date_stop:date,spend,actions:[{action_type:'purchase',value:'99'},{action_type:'offsite_conversion.fb_pixel_purchase',value:'2'}],action_values:[{action_type:'offsite_conversion.fb_pixel_purchase',value:'300'}]});
test('isolates PL permission failure and ignores duplicate purchase aliases',async()=>{
 const result=await collectMeta(env,'2026-11-01','2026-11-02',async(input:any)=>new Response(JSON.stringify(String(input).includes('act_1310')?{error:{code:200,message:token}}:{data:[row()]}),{status:String(input).includes('act_1310')?403:200}));
 assert.equal(result.results[0].totals?.roas,3); assert.equal(result.results[0].totals?.purchases,2);
 assert.equal(result.results[1].status,'UNAVAILABLE'); assert.equal(result.results[1].totals,null);
 assert.equal(JSON.stringify(result).includes(token),false);
});
test('rebuilds pagination on fixed Graph host; does not follow supplied next URL',async()=>{
 const seen:string[]=[];
 const result=await collectMeta(env,'2026-11-01','2026-11-02',async(input:any)=>{
  const u=new URL(String(input));seen.push(u.toString());
  if(u.pathname.includes('act_1310'))return Response.json({data:[]});
  return Response.json(u.searchParams.has('after')?{data:[row('0','2026-11-02')]}:{data:[row()],paging:{next:'https://evil.invalid/?access_token='+token,cursors:{after:'cursor-2'}}});
 });
 assert.equal(seen.every(v=>new URL(v).hostname==='graph.facebook.com'),true);
 assert.equal(result.results[0].days.length,2);assert.equal(result.results[0].totals?.spend,100);
 assert.equal(result.results[0].days[1].roas,null);
});
test('partial pagination failure never presents totals as complete',async()=>{
 const r=await collectMeta(env,'2026-11-01','2026-11-02',async(input:any)=>{
  const u=new URL(String(input));if(u.pathname.includes('act_1310'))return Response.json({data:[]});
  if(u.searchParams.has('after'))throw new Error(token);
  return Response.json({data:[row()],paging:{next:'yes',cursors:{after:'a'}}});
 });
 assert.equal(r.results[0].status,'PARTIAL');assert.equal(r.results[0].totals,null);assert.ok(!JSON.stringify(r).includes(token));
});
test('rejects malformed dates and ranges before fetching',async()=>{
 let calls=0;const f:any=async()=>{calls++;return Response.json({data:[]});};
 await assert.rejects(()=>collectMeta(env,'2026-02-30','2026-03-01',f));
 await assert.rejects(()=>collectMeta(env,'2026-01-01','2026-11-01',f));assert.equal(calls,0);
});
test('fails closed, does not accept Cloudflare bearer as report credential',async()=>{
 assert.equal((await handleMetaReport(new Request('https://worker/meta-report'),{}))?.status,503);
 assert.equal((await handleMetaReport(new Request('https://worker/meta-report',{headers:{Authorization:'Bearer report-key'}}),env))?.status,401);
 assert.equal(await handleMetaReport(new Request('https://worker/other'),env),null);
});
test('currency mismatch cannot produce a verified report',async()=>{
 const r=await collectMeta(env,'2026-11-01','2026-11-02',async()=>Response.json({data:[{...row(),account_currency:'USD'}]}));
 assert.equal(r.results[0].status,'UNAVAILABLE');assert.equal(r.results[0].totals,null);
});
