import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {handlePolandOAuth, refreshPolandAccessToken, PL_START, CALLBACK, PL_EMAIL} from "../src/google-pl-oauth.ts";
const origin = new URL(CALLBACK).origin;
const env = {GOOGLE_CLIENT_ID:"synthetic-client", GOOGLE_CLIENT_SECRET:"synthetic-client-secret", GOOGLE_PL_OAUTH_SETUP_TOKEN:"synthetic-setup-code-with-32-chars", GOOGLE_REFRESH_TOKEN:"legacy-never-use"};
async function begin() {
	const r = await handlePolandOAuth(new Request(origin+PL_START,{method:"POST",headers:{Origin:origin},body:new URLSearchParams({setup_code:env.GOOGLE_PL_OAUTH_SETUP_TOKEN})}),env);
	assert.equal(r?.status,303);
	const target = new URL(r!.headers.get("Location")!);
	return {target, cookie:r!.headers.get("Set-Cookie")!.split(";")[0]};
}
function callback(state:string,cookie?:string) { const u=new URL(CALLBACK);u.searchParams.set("state",state);u.searchParams.set("code","synthetic-code");return new Request(u,{headers:cookie?{Cookie:cookie}:{}}); }
function token(scope="https://www.googleapis.com/auth/adwords https://www.googleapis.com/auth/content") {return Response.json({access_token:"synthetic-access",refresh_token:"synthetic-refresh",scope});}
test("disabled setup never starts OAuth",async()=>assert.equal((await handlePolandOAuth(new Request(origin+PL_START),{}))?.status,503));
test("legacy callback is passed through",async()=>assert.equal(await handlePolandOAuth(new Request(CALLBACK+"?state=legacy"),env),null));
test("wrong origin and missing setup code are rejected",async()=>{
	for(const headers of [{Origin:"https://evil.test"},{Origin:origin}])assert.equal((await handlePolandOAuth(new Request(origin+PL_START,{method:"POST",headers,body:"setup_code=wrong"}),env))?.status,403);
});
test("start requests only PL scopes with browser binding and PKCE",async()=>{
	const {target,cookie}=await begin();
	assert.equal(target.searchParams.get("login_hint"),PL_EMAIL);
	assert.equal(target.searchParams.get("redirect_uri"),CALLBACK);
	assert.equal(target.searchParams.get("code_challenge_method"),"S256");
	assert.equal(target.searchParams.get("include_granted_scopes"),"false");
	assert.ok(cookie.startsWith("__Host-pcc-google-pl="));
	assert.ok(!target.searchParams.get("scope")!.includes("webmasters"));
});
test("missing or tampered browser state never reaches Google",async(t)=>{
	let calls=0;t.mock.method(globalThis,"fetch",async()=>{calls++;throw new Error();});
	const {target,cookie}=await begin();const s=target.searchParams.get("state")!;
	for(const req of [callback(s),callback(s+"x",cookie),callback("pl1.malformed.x",cookie),callback(s,"__Host-pcc-google-pl=bad")])assert.equal((await handlePolandOAuth(req,env))?.status,400);
	assert.equal(calls,0);
});
test("expired and future state fail before network",async(t)=>{
	const realNow=Date.now();let now=realNow;t.mock.method(Date,"now",()=>now);
	const {target,cookie}=await begin();
	for(const offset of [600_001,-1000]){now=realNow+offset;assert.equal((await handlePolandOAuth(callback(target.searchParams.get("state")!,cookie),env))?.status,400);}
});
test("wrong or unverified Google account never exposes a refresh token",async(t)=>{
	for(const info of [{email:"wrong@example.test",email_verified:true},{email:PL_EMAIL,email_verified:false}]) {
		let n=0;const mock=t.mock.method(globalThis,"fetch",async()=>++n===1?token():Response.json(info));
		const {target,cookie}=await begin();const r=await handlePolandOAuth(callback(target.searchParams.get("state")!,cookie),env);
		assert.equal(r?.status,403);assert.ok(!(await r!.text()).includes("synthetic-refresh"));mock.mock.restore();
	}
});
test("partial consent is rejected",async(t)=>{
	t.mock.method(globalThis,"fetch",async()=>token("https://www.googleapis.com/auth/adwords"));
	const {target,cookie}=await begin();assert.equal((await handlePolandOAuth(callback(target.searchParams.get("state")!,cookie),env))?.status,403);
});
test("verified PL flow labels only the separate secret and clears cookie",async(t)=>{
	let n=0;t.mock.method(globalThis,"fetch",async(_url,init)=>{
		if(++n===1){assert.ok(new URLSearchParams(init?.body as URLSearchParams).has("code_verifier"));return token();}
		return Response.json({email:PL_EMAIL,email_verified:true});
	});
	const {target,cookie}=await begin();const r=(await handlePolandOAuth(callback(target.searchParams.get("state")!,cookie),env))!;
	assert.equal(r.status,200);assert.equal(r.headers.get("Cache-Control"),"no-store");assert.ok(r.headers.get("Set-Cookie")!.includes("Max-Age=0"));
	assert.ok((await r.text()).includes("GOOGLE_PL_REFRESH_TOKEN"));assert.equal(n,2);
});
test("upstream errors cannot leak credentials",async(t)=>{
	t.mock.method(globalThis,"fetch",async()=>Response.json({error:"synthetic-refresh"},{status:400}));
	const {target,cookie}=await begin();const r=(await handlePolandOAuth(callback(target.searchParams.get("state")!,cookie),env))!;
	assert.ok(!(await r.text()).includes("synthetic-refresh"));
});
test("PL refresh never falls back to the shared credential",async(t)=>{
	let calls=0;t.mock.method(globalThis,"fetch",async(_url,init)=>{calls++;assert.equal(new URLSearchParams(init?.body as URLSearchParams).get("refresh_token"),"synthetic-pl");return Response.json({access_token:"ok"});});
	await assert.rejects(refreshPolandAccessToken(env),/NOT_CONFIGURED/);assert.equal(calls,0);
	assert.equal(await refreshPolandAccessToken({...env,GOOGLE_PL_REFRESH_TOKEN:"synthetic-pl"}),"ok");
});
test("integration routes only Ads/Merchant to PL and preserves GSC/GA4",()=>{
	const source=readFileSync(new URL("../src/google.ts",import.meta.url),"utf8");
	assert.match(source,/async function googleAdsSearch\(query: string\) \{\s*const token = await refreshPolandAccessToken\(currentEnv\)/);
	assert.match(source,/async function ga4RunReport[^]*?const token = await getAccessToken\(\)/);
	assert.match(source,/async function gscRequest[^]*?const token = await getAccessToken\(\)/);
	const merchant=source.slice(source.indexOf('"merchant_products",'),source.indexOf('"search_console_access"'));
	assert.match(merchant,/refreshPolandAccessToken\(currentEnv\)/);
});
