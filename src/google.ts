import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

const GOOGLE_ADS_CUSTOMER_ID = "3206813262";
const GA4_PROPERTY_ID = "463531572";
const MERCHANT_ACCOUNT_ID = "5772972099";
const OAUTH_REDIRECT_URI =
	"https://remote-mcp-server-authless.pl571868110.workers.dev/oauth/google/callback";

const GOOGLE_SCOPES = [
	"https://www.googleapis.com/auth/adwords",
	"https://www.googleapis.com/auth/analytics.readonly",
	"https://www.googleapis.com/auth/content",
];

type GoogleEnv = Env & {
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
	GOOGLE_REFRESH_TOKEN?: string;
	GOOGLE_ADS_LOGIN_CUSTOMER_ID?: string;
};

let currentEnv: GoogleEnv;

function jsonText(data: unknown, isError = false) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
		...(isError ? { isError: true } : {}),
	};
}

function base64UrlEncode(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
	const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
	const binary = atob(padded);
	return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function signState(payload: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(payload),
	);
	return `${base64UrlEncode(new TextEncoder().encode(payload))}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function verifyState(state: string, secret: string): Promise<boolean> {
	const [payloadPart, signaturePart] = state.split(".");
	if (!payloadPart || !signaturePart) return false;
	const payloadBytes = base64UrlDecode(payloadPart);
	const payload = new TextDecoder().decode(payloadBytes);
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify"],
	);
	const ok = await crypto.subtle.verify(
		"HMAC",
		key,
		base64UrlDecode(signaturePart),
		new TextEncoder().encode(payload),
	);
	if (!ok) return false;
	try {
		const parsed = JSON.parse(payload) as { ts?: number };
		return typeof parsed.ts === "number" && Date.now() - parsed.ts < 10 * 60 * 1000;
	} catch {
		return false;
	}
}

async function getAccessToken(): Promise<string> {
	if (!currentEnv.GOOGLE_CLIENT_ID || !currentEnv.GOOGLE_CLIENT_SECRET) {
		throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured");
	}
	if (!currentEnv.GOOGLE_REFRESH_TOKEN) {
		throw new Error("GOOGLE_REFRESH_TOKEN is not configured. Complete /oauth/google/start first.");
	}

	const body = new URLSearchParams({
		client_id: currentEnv.GOOGLE_CLIENT_ID,
		client_secret: currentEnv.GOOGLE_CLIENT_SECRET,
		refresh_token: currentEnv.GOOGLE_REFRESH_TOKEN,
		grant_type: "refresh_token",
	});
	const res = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
	});
	const data = (await res.json()) as any;
	if (!res.ok || !data.access_token) {
		throw new Error(`Google token refresh failed (${res.status}): ${JSON.stringify(data)}`);
	}
	return data.access_token as string;
}

async function googleAdsSearch(query: string) {
	const token = await getAccessToken();
	const headers: Record<string, string> = {
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
	};
	if (currentEnv.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
		headers["login-customer-id"] = currentEnv.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/-/g, "");
	}
	const res = await fetch(
		`https://googleads.googleapis.com/v25/customers/${GOOGLE_ADS_CUSTOMER_ID}/googleAds:search`,
		{
			method: "POST",
			headers,
			body: JSON.stringify({ query }),
		},
	);
	const data = await res.json();
	if (!res.ok) throw new Error(`Google Ads API ${res.status}: ${JSON.stringify(data)}`);
	return data;
}

function createGoogleServer() {
	const server = new McpServer({
		name: "PetsChoice Google Connector",
		version: "1.0.0",
	});

	server.registerTool(
		"google_ads_campaigns",
		{
			description: "Read campaigns, status, channel type and daily budget from the whitelisted PetsChoice Poland Google Ads account.",
			inputSchema: z.object({}),
		},
		async () => {
			try {
				const data = await googleAdsSearch(`
					SELECT
						campaign.id,
						campaign.name,
						campaign.status,
						campaign.advertising_channel_type,
						campaign_budget.amount_micros
					FROM campaign
					ORDER BY campaign.name
				`);
				return jsonText({ customer_id: GOOGLE_ADS_CUSTOMER_ID, ...data });
			} catch (error: any) {
				return jsonText({ error: error?.message || String(error) }, true);
			}
		},
	);

	server.registerTool(
		"google_ads_summary",
		{
			description: "Read spend, clicks, impressions, conversions and conversion value for the whitelisted PetsChoice Poland Google Ads account.",
			inputSchema: z.object({
				start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
				end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
			}),
		},
		async ({ start_date, end_date }) => {
			try {
				const data = await googleAdsSearch(`
					SELECT
						campaign.id,
						campaign.name,
						campaign.status,
						metrics.impressions,
						metrics.clicks,
						metrics.cost_micros,
						metrics.conversions,
						metrics.conversions_value
					FROM campaign
					WHERE segments.date BETWEEN '${start_date}' AND '${end_date}'
					ORDER BY metrics.cost_micros DESC
				`);
				return jsonText({ customer_id: GOOGLE_ADS_CUSTOMER_ID, start_date, end_date, ...data });
			} catch (error: any) {
				return jsonText({ error: error?.message || String(error) }, true);
			}
		},
	);

	server.registerTool(
		"ga4_purchase_report",
		{
			description: "Read GA4 purchase and revenue metrics from the whitelisted PetsChoice Poland GA4 property.",
			inputSchema: z.object({
				start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
				end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
			}),
		},
		async ({ start_date, end_date }) => {
			try {
				const token = await getAccessToken();
				const res = await fetch(
					`https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runReport`,
					{
						method: "POST",
						headers: {
							Authorization: `Bearer ${token}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							dateRanges: [{ startDate: start_date, endDate: end_date }],
							dimensions: [{ name: "date" }],
							metrics: [
								{ name: "sessions" },
								{ name: "transactions" },
								{ name: "purchaseRevenue" },
							],
							orderBys: [{ dimension: { dimensionName: "date" } }],
						}),
					},
				);
				const raw = await res.text();
				let data: any;
				try {
					data = raw ? JSON.parse(raw) : {};
				} catch {
					throw new Error(`GA4 Data API ${res.status} returned non-JSON (${res.headers.get("content-type") || "unknown content-type"}): ${raw.slice(0, 500)}`);
				}
				if (!res.ok) throw new Error(`GA4 Data API ${res.status}: ${JSON.stringify(data)}`);
				return jsonText({ property_id: GA4_PROPERTY_ID, start_date, end_date, data });
			} catch (error: any) {
				return jsonText({ error: error?.message || String(error) }, true);
			}
		},
	);

	server.registerTool(
		"merchant_products",
		{
			description: "Read processed products and issue data from the whitelisted PetsChoice Poland Merchant Center account.",
			inputSchema: z.object({
				page_size: z.number().int().min(1).max(100).optional().default(50),
			}),
		},
		async ({ page_size }) => {
			try {
				const token = await getAccessToken();
				const res = await fetch(
					`https://merchantapi.googleapis.com/products/v1/accounts/${MERCHANT_ACCOUNT_ID}/products?pageSize=${page_size}`,
					{ headers: { Authorization: `Bearer ${token}` } },
				);
				const data = await res.json();
				if (!res.ok) throw new Error(`Merchant API ${res.status}: ${JSON.stringify(data)}`);
				return jsonText({ merchant_account_id: MERCHANT_ACCOUNT_ID, data });
			} catch (error: any) {
				return jsonText({ error: error?.message || String(error) }, true);
			}
		},
	);

	return server;
}

const googleMcpHandler = createMcpHandler(createGoogleServer);

export async function handleGoogleRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response | null> {
	currentEnv = env as GoogleEnv;
	const url = new URL(request.url);

	if (url.pathname === "/oauth/google/start") {
		if (!currentEnv.GOOGLE_CLIENT_ID || !currentEnv.GOOGLE_CLIENT_SECRET) {
			return new Response("Google OAuth client is not configured", { status: 500 });
		}
		const state = await signState(
			JSON.stringify({ ts: Date.now(), nonce: crypto.randomUUID() }),
			currentEnv.GOOGLE_CLIENT_SECRET,
		);
		const params = new URLSearchParams({
			client_id: currentEnv.GOOGLE_CLIENT_ID,
			redirect_uri: OAUTH_REDIRECT_URI,
			response_type: "code",
			scope: GOOGLE_SCOPES.join(" "),
			access_type: "offline",
			prompt: "consent",
			include_granted_scopes: "true",
			state,
		});
		return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 302);
	}

	if (url.pathname === "/oauth/google/callback") {
		if (!currentEnv.GOOGLE_CLIENT_ID || !currentEnv.GOOGLE_CLIENT_SECRET) {
			return new Response("Google OAuth client is not configured", { status: 500 });
		}
		const error = url.searchParams.get("error");
		if (error) return new Response(`Google OAuth error: ${error}`, { status: 400 });
		const code = url.searchParams.get("code");
		const state = url.searchParams.get("state") || "";
		if (!code || !(await verifyState(state, currentEnv.GOOGLE_CLIENT_SECRET))) {
			return new Response("Invalid or expired OAuth callback", { status: 400 });
		}

		const body = new URLSearchParams({
			code,
			client_id: currentEnv.GOOGLE_CLIENT_ID,
			client_secret: currentEnv.GOOGLE_CLIENT_SECRET,
			redirect_uri: OAUTH_REDIRECT_URI,
			grant_type: "authorization_code",
		});
		const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
		});
		const tokenData = (await tokenRes.json()) as any;
		if (!tokenRes.ok) {
			return new Response(`Token exchange failed: ${JSON.stringify(tokenData)}`, { status: 500 });
		}
		if (!tokenData.refresh_token) {
			return new Response(
				"OAuth succeeded, but Google did not return a refresh token. Re-open /oauth/google/start and approve consent again.",
				{ status: 400 },
			);
		}
		const html = `<!doctype html><html><head><meta charset="utf-8"><title>PCC Google OAuth</title></head><body style="font-family:system-ui;max-width:800px;margin:40px auto;padding:0 20px"><h1>Google connection authorized</h1><p>Copy the refresh token below directly into Cloudflare Worker Secrets as <strong>GOOGLE_REFRESH_TOKEN</strong>. Do not paste or screenshot it in chat.</p><textarea readonly style="width:100%;height:160px">${String(tokenData.refresh_token).replace(/</g, "&lt;")}</textarea><p>After saving the secret in Cloudflare, close this page.</p></body></html>`;
		return new Response(html, {
			headers: {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "no-store",
				Pragma: "no-cache",
			},
		});
	}

	if (url.pathname === "/google-mcp") {
		const rewritten = new URL(request.url);
		rewritten.pathname = "/mcp";
		return googleMcpHandler(new Request(rewritten.toString(), request), env, ctx);
	}

	return null;
}
