import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

type ShopifyUaEnv = Env & {
	SHOPIFY_SHOP?: string;
	SHOPIFY_CLIENT_ID?: string;
	SHOPIFY_CLIENT_SECRET?: string;
};

let currentEnv: ShopifyUaEnv;
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

function jsonText(data: unknown, isError = false) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
		...(isError ? { isError: true } : {}),
	};
}

function normalizedShopDomain(raw: string): string {
	let value = raw.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
	if (!value.includes(".")) value = `${value}.myshopify.com`;
	if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(value)) {
		throw new Error("SHOPIFY_SHOP must be the store's myshopify subdomain or *.myshopify.com domain");
	}
	return value;
}

async function getAccessToken(): Promise<string> {
	if (!currentEnv.SHOPIFY_SHOP || !currentEnv.SHOPIFY_CLIENT_ID || !currentEnv.SHOPIFY_CLIENT_SECRET) {
		throw new Error("SHOPIFY_SHOP / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET are not configured in Cloudflare Worker secrets");
	}
	if (cachedAccessToken && Date.now() < cachedAccessToken.expiresAt - 5 * 60 * 1000) {
		return cachedAccessToken.token;
	}
	const shop = normalizedShopDomain(currentEnv.SHOPIFY_SHOP);
	const body = new URLSearchParams({
		grant_type: "client_credentials",
		client_id: currentEnv.SHOPIFY_CLIENT_ID,
		client_secret: currentEnv.SHOPIFY_CLIENT_SECRET,
	});
	const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
	});
	const raw = await res.text();
	let data: any;
	try {
		data = raw ? JSON.parse(raw) : {};
	} catch {
		throw new Error(`Shopify token endpoint ${res.status} returned non-JSON: ${raw.slice(0, 300)}`);
	}
	if (!res.ok || !data.access_token) {
		throw new Error(`Shopify token exchange failed (${res.status}): ${JSON.stringify(data)}`);
	}
	const expiresIn = Number(data.expires_in || 86400);
	cachedAccessToken = {
		token: String(data.access_token),
		expiresAt: Date.now() + expiresIn * 1000,
	};
	return cachedAccessToken.token;
}

async function shopifyGraphql(query: string, variables: Record<string, unknown> = {}) {
	if (!currentEnv.SHOPIFY_SHOP) throw new Error("SHOPIFY_SHOP is not configured");
	const shop = normalizedShopDomain(currentEnv.SHOPIFY_SHOP);
	const token = await getAccessToken();
	const res = await fetch(`https://${shop}/admin/api/2026-07/graphql.json`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Shopify-Access-Token": token,
		},
		body: JSON.stringify({ query, variables }),
	});
	const raw = await res.text();
	let data: any;
	try {
		data = raw ? JSON.parse(raw) : {};
	} catch {
		throw new Error(`Shopify Admin API ${res.status} returned non-JSON: ${raw.slice(0, 500)}`);
	}
	if (!res.ok) throw new Error(`Shopify Admin API ${res.status}: ${JSON.stringify(data)}`);
	if (data.errors?.length) throw new Error(`Shopify GraphQL error: ${JSON.stringify(data.errors)}`);
	return data.data;
}

function createShopifyUaServer() {
	const server = new McpServer({ name: "PetsChoice Shopify UA Connector", version: "1.0.0" });

	server.registerTool(
		"shopify_store_identity",
		{
			description: "Verify the connected Ukrainian PetsChoice Shopify store. Read-only.",
			inputSchema: z.object({}),
		},
		async () => {
			try {
				const data = await shopifyGraphql(`query StoreIdentity { shop { name myshopifyDomain primaryDomain { host url } currencyCode } }`);
				return jsonText(data.shop);
			} catch (error: any) {
				return jsonText({ error: error?.message || String(error) }, true);
			}
		},
	);

	server.registerTool(
		"shopify_get_order",
		{
			description: "Read a Ukrainian Shopify order by order name such as 4646 or #4646. Read-only.",
			inputSchema: z.object({ order: z.string().min(1) }),
		},
		async ({ order }) => {
			try {
				const normalized = order.startsWith("#") ? order : `#${order}`;
				const data = await shopifyGraphql(
					`query OrderByName($query: String!) {
						orders(first: 5, query: $query) {
							nodes {
								id name createdAt processedAt currencyCode
								displayFinancialStatus displayFulfillmentStatus test
								tags
								totalPriceSet { shopMoney { amount currencyCode } }
								currentTotalPriceSet { shopMoney { amount currencyCode } }
								customer { displayName email }
								fulfillments { status trackingInfo { company number url } }
								lineItems(first: 50) { nodes { title quantity sku } }
							}
						}
					}`,
					{ query: `name:${JSON.stringify(normalized)}` },
				);
				return jsonText({ requested_order: order, matches: data.orders.nodes });
			} catch (error: any) {
				return jsonText({ error: error?.message || String(error) }, true);
			}
		},
	);

	return server;
}

const shopifyUaMcpHandler = createMcpHandler(createShopifyUaServer);

export async function handleShopifyUaRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response | null> {
	currentEnv = env as ShopifyUaEnv;
	const url = new URL(request.url);
	if (url.pathname !== "/shopify-ua-mcp") return null;
	const rewritten = new URL(request.url);
	rewritten.pathname = "/mcp";
	return shopifyUaMcpHandler(new Request(rewritten.toString(), request), env, ctx);
}
