// Separate Poland Ads/Merchant credentials. No writes to Google or token storage.
export const PL_EMAIL = "petschoiceclub.pl@gmail.com";
export const PL_START = "/oauth/google/pl/start";
export const CALLBACK = "https://remote-mcp-server-authless.pl571868110.workers.dev/oauth/google/callback";
const COOKIE = "__Host-pcc-google-pl";
const TTL = 600_000;
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/adwords", "https://www.googleapis.com/auth/content"];
export type PlEnv = {
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
	GOOGLE_PL_REFRESH_TOKEN?: string;
	GOOGLE_PL_OAUTH_SETUP_TOKEN?: string;
};
const enc = new TextEncoder();
function b64(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function unb64(s: string) { return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0)); }
function equal(a: string, b: string) {
	const x = enc.encode(a), y = enc.encode(b); let d = x.length ^ y.length;
	for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
	return d === 0;
}
async function key(secret: string) { return crypto.subtle.importKey("raw", enc.encode(secret), {name:"HMAC", hash:"SHA-256"}, false, ["sign", "verify"]); }
function response(body: string, status = 200, cookie?: string) {
	const headers: Record<string, string> = {
		"Content-Type":"text/html; charset=utf-8", "Cache-Control":"no-store", "Pragma":"no-cache",
		"Referrer-Policy":"no-referrer", "X-Content-Type-Options":"nosniff",
		"Content-Security-Policy":"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
	};
	if (cookie) headers["Set-Cookie"] = cookie;
	return new Response(body, {status, headers});
}
const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
function escapeHtml(s: string) { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }

export async function refreshPolandAccessToken(env: PlEnv): Promise<string> {
	if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_PL_REFRESH_TOKEN) {
		throw new Error("GOOGLE_PL_CREDENTIALS_NOT_CONFIGURED");
	}
	try {
		const r = await fetch("https://oauth2.googleapis.com/token", {
			method:"POST", signal:AbortSignal.timeout(20_000), headers:{"Content-Type":"application/x-www-form-urlencoded"},
			body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID, client_secret:env.GOOGLE_CLIENT_SECRET,
				refresh_token:env.GOOGLE_PL_REFRESH_TOKEN, grant_type:"refresh_token"}),
		});
		const data = await r.json() as {access_token?: string};
		if (!r.ok || typeof data.access_token !== "string" || !data.access_token) throw new Error();
		return data.access_token;
	} catch { throw new Error("GOOGLE_PL_TOKEN_REFRESH_FAILED"); }
}

export async function handlePolandOAuth(request: Request, env: PlEnv): Promise<Response | null> {
	const url = new URL(request.url);
	const state = url.searchParams.get("state") ?? "";
	const start = url.pathname === PL_START;
	const callback = url.pathname === new URL(CALLBACK).pathname && state.startsWith("pl1.");
	if (!start && !callback) return null; // Existing LINKIO flow remains separate.
	if (url.origin !== new URL(CALLBACK).origin) return response("PL_OAUTH_WRONG_ORIGIN", 400);
	if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_PL_OAUTH_SETUP_TOKEN || env.GOOGLE_PL_OAUTH_SETUP_TOKEN.length < 32) {
		return response("PL_OAUTH_SETUP_DISABLED", 503);
	}
	if (start) {
		if (request.method === "GET") return response(`<h1>Connect Poland Google Ads and Merchant Center</h1><p>Account: ${PL_EMAIL}</p><form method="post" action="${PL_START}"><label>Temporary setup code <input name="setup_code" type="password" autocomplete="off" required maxlength="256"></label><button>Continue to Google</button></form>`);
		if (request.method !== "POST") return response("METHOD_NOT_ALLOWED", 405);
		if (request.headers.get("Origin") !== url.origin) return response("PL_OAUTH_ORIGIN_REJECTED", 403);
		if (Number(request.headers.get("Content-Length") ?? 0) > 1024) return response("PL_OAUTH_BODY_TOO_LARGE", 413);
		const raw = await request.text();
		if (raw.length > 1024) return response("PL_OAUTH_BODY_TOO_LARGE", 413);
		if (!equal(new URLSearchParams(raw).get("setup_code") ?? "", env.GOOGLE_PL_OAUTH_SETUP_TOKEN)) return response("PL_OAUTH_SETUP_DENIED", 403);
		const nonce = b64(crypto.getRandomValues(new Uint8Array(32)));
		const verifier = b64(crypto.getRandomValues(new Uint8Array(32)));
		const challenge = b64(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier))));
		const payload = b64(enc.encode(JSON.stringify({ts:Date.now(), nonce, challenge})));
		const signed = `pl1.${payload}`;
		const signature = b64(new Uint8Array(await crypto.subtle.sign("HMAC", await key(env.GOOGLE_CLIENT_SECRET), enc.encode(signed))));
		const params = new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID, redirect_uri:CALLBACK, response_type:"code",
			scope:SCOPES.join(" "), access_type:"offline", prompt:"select_account consent", login_hint:PL_EMAIL,
			include_granted_scopes:"false", state:`${signed}.${signature}`, code_challenge:challenge, code_challenge_method:"S256"});
		const headers = new Headers(response("").headers);
		headers.set("Location", `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
		headers.set("Set-Cookie", `${COOKIE}=${b64(enc.encode(JSON.stringify({nonce, verifier})))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
		return new Response(null, {status:303, headers});
	}
	if (request.method !== "GET") return response("METHOD_NOT_ALLOWED", 405, clearCookie);
	try {
		const parts = state.split(".");
		if (parts.length !== 3 || state.length > 2048) throw new Error();
		if (!await crypto.subtle.verify("HMAC", await key(env.GOOGLE_CLIENT_SECRET), unb64(parts[2]), enc.encode(`pl1.${parts[1]}`))) throw new Error();
		const p = JSON.parse(new TextDecoder().decode(unb64(parts[1])));
		const age = Date.now() - p.ts;
		if (!Number.isFinite(age) || age < 0 || age >= TTL) throw new Error();
		const cookies = (request.headers.get("Cookie") ?? "").split(";").map(v => v.trim()).filter(v=>v.startsWith(`${COOKIE}=`));
		if (cookies.length !== 1) throw new Error();
		const c = JSON.parse(new TextDecoder().decode(unb64(cookies[0].slice(COOKIE.length + 1))));
		if (typeof c.nonce !== "string" || typeof c.verifier !== "string" || !equal(c.nonce,p.nonce)) throw new Error();
		const challenge = b64(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(c.verifier))));
		if (!equal(challenge,p.challenge)) throw new Error();
		if (url.searchParams.has("error")) return response("PL_OAUTH_CONSENT_NOT_COMPLETED", 400, clearCookie);
		const code = url.searchParams.get("code");
		if (!code) throw new Error();
		const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
			method:"POST", signal:AbortSignal.timeout(20_000), headers:{"Content-Type":"application/x-www-form-urlencoded"},
			body:new URLSearchParams({code, client_id:env.GOOGLE_CLIENT_ID, client_secret:env.GOOGLE_CLIENT_SECRET,
				redirect_uri:CALLBACK, grant_type:"authorization_code", code_verifier:c.verifier}),
		});
		const tokens = await tokenResponse.json() as {access_token?:string; refresh_token?:string; scope?:string};
		if (!tokenResponse.ok || !tokens.access_token || !tokens.refresh_token) return response("PL_OAUTH_TOKEN_EXCHANGE_FAILED", 400, clearCookie);
		const granted = new Set((tokens.scope ?? "").split(" "));
		if (!SCOPES.filter(s=>s.startsWith("https:")).every(s=>granted.has(s))) return response("PL_OAUTH_SCOPES_MISSING", 403, clearCookie);
		const infoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
			signal:AbortSignal.timeout(20_000), headers:{Authorization:`Bearer ${tokens.access_token}`},
		});
		const info = await infoResponse.json() as {email?:string; email_verified?:boolean};
		if (!infoResponse.ok || info.email_verified !== true || info.email?.toLowerCase() !== PL_EMAIL) return response("PL_OAUTH_WRONG_ACCOUNT", 403, clearCookie);
		return response(`<h1>Poland account confirmed</h1><p>${PL_EMAIL}</p><p>Save the value below only as Cloudflare Worker secret <strong>GOOGLE_PL_REFRESH_TOKEN</strong>. Do not replace GOOGLE_REFRESH_TOKEN. Do not share this page or screenshot it. Close this page after saving, then disable the temporary setup code.</p><textarea readonly autocomplete="off">${escapeHtml(tokens.refresh_token)}</textarea>`, 200, clearCookie);
	} catch { return response("PL_OAUTH_CALLBACK_REJECTED", 400, clearCookie); }
}
