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

function addDays(date: string, days: number): string {
	const [year, month, day] = date.split("-").map(Number);
	const d = new Date(Date.UTC(year, month - 1, day + days));
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function localMidnightUtcIso(date: string, timeZone: string): string {
	const [year, month, day] = date.split("-").map(Number);
	const targetAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
	const formatter = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	});
	let guess = targetAsUtc;
	for (let i = 0; i < 3; i++) {
		const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
		const represented = Date.UTC(
			Number(parts.year),
			Number(parts.month) - 1,
			Number(parts.day),
			Number(parts.hour),
			Number(parts.minute),
			Number(parts.second),
		);
		guess += targetAsUtc - represented;
	}
	return new Date(guess).toISOString();
}

function createShopifyUaServer() {
	const server = new McpServer({ name: "PetsChoice Shopify UA Connector", version: "1.1.0" });

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

	server.registerTool(
		"shopify_ua_orders_between",
		{
			description: "Read all Ukrainian Shopify orders created in an inclusive store-local date range. Cursor-paginated, read-only, and no customer PII.",
			inputSchema: z.object({
				start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
				end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
			}),
		},
		async ({ start_date, end_date }) => {
			try {
				if (start_date > end_date) throw new Error("start_date must be on or before end_date");

				const identity = await shopifyGraphql(`query UaOrdersStoreContext {
					shop { name primaryDomain { host } currencyCode ianaTimezone }
				}`);
				const shop = identity.shop;
				const timeZone = String(shop.ianaTimezone || "Europe/Kyiv");
				const startInstant = localMidnightUtcIso(start_date, timeZone);
				const endExclusiveInstant = localMidnightUtcIso(addDays(end_date, 1), timeZone);
				const search = `created_at:>=${startInstant} created_at:<${endExclusiveInstant}`;

				const query = `query UaOrdersBetween($query: String!, $after: String) {
					orders(first: 100, after: $after, query: $query, sortKey: CREATED_AT) {
						nodes {
							id name createdAt processedAt currencyCode
							displayFinancialStatus displayFulfillmentStatus
							cancelledAt test tags
							totalPriceSet { shopMoney { amount currencyCode } }
							currentTotalPriceSet { shopMoney { amount currencyCode } }
							subtotalPriceSet { shopMoney { amount currencyCode } }
							currentSubtotalPriceSet { shopMoney { amount currencyCode } }
							totalDiscountsSet { shopMoney { amount currencyCode } }
							currentTotalDiscountsSet { shopMoney { amount currencyCode } }
							totalRefundedSet { shopMoney { amount currencyCode } }
						}
						pageInfo { hasNextPage endCursor }
					}
				}`;

				const orders: any[] = [];
				let after: string | null = null;
				do {
					const data = await shopifyGraphql(query, { query: search, after });
					for (const order of data.orders.nodes) {
						orders.push({
							...order,
							financialStatus: order.displayFinancialStatus,
							fulfillmentStatus: order.displayFulfillmentStatus,
						});
					}
					after = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null;
					if (data.orders.pageInfo.hasNextPage && !after) throw new Error("Shopify pagination returned hasNextPage without endCursor");
				} while (after);

				return jsonText({
					store: shop.primaryDomain?.host || shop.name || "petschoice.club",
					currency: shop.currencyCode,
					start_date,
					end_date,
					orders_count: orders.length,
					orders,
				});
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
