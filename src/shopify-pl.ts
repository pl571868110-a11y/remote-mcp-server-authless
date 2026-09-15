import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

type ShopifyEnv = Env & {
	SHOPIFY_PL_SHOP?: string;
	SHOPIFY_PL_ADMIN_TOKEN?: string;
};

let currentEnv: ShopifyEnv;

function jsonText(data: unknown, isError = false) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
		...(isError ? { isError: true } : {}),
	};
}

function normalizedShopDomain(raw: string): string {
	const value = raw.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
	if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(value)) {
		throw new Error("SHOPIFY_PL_SHOP must be the store's *.myshopify.com domain");
	}
	return value;
}

async function shopifyGraphql(query: string, variables: Record<string, unknown> = {}) {
	if (!currentEnv.SHOPIFY_PL_SHOP || !currentEnv.SHOPIFY_PL_ADMIN_TOKEN) {
		throw new Error(
			"SHOPIFY_PL_SHOP / SHOPIFY_PL_ADMIN_TOKEN are not configured in Cloudflare Worker secrets",
		);
	}

	const shop = normalizedShopDomain(currentEnv.SHOPIFY_PL_SHOP);
	const res = await fetch(`https://${shop}/admin/api/2026-07/graphql.json`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Shopify-Access-Token": currentEnv.SHOPIFY_PL_ADMIN_TOKEN,
		},
		body: JSON.stringify({ query, variables }),
	});

	const raw = await res.text();
	let data: any;
	try {
		data = raw ? JSON.parse(raw) : {};
	} catch {
		throw new Error(
			`Shopify Admin API ${res.status} returned non-JSON (${res.headers.get("content-type") || "unknown"}): ${raw.slice(0, 500)}`,
		);
	}
	if (!res.ok) throw new Error(`Shopify Admin API ${res.status}: ${JSON.stringify(data)}`);
	if (data.errors?.length) throw new Error(`Shopify GraphQL error: ${JSON.stringify(data.errors)}`);
	return data.data;
}

function createShopifyServer() {
	const server = new McpServer({
		name: "PetsChoice Shopify Poland Connector",
		version: "1.0.0",
	});

	server.registerTool(
		"shopify_pl_store_identity",
		{
			description: "Verify which Shopify Poland store is connected. Read-only.",
			inputSchema: z.object({}),
		},
		async () => {
			try {
				const data = await shopifyGraphql(`
					query StoreIdentity {
						shop {
							name
							myshopifyDomain
							primaryDomain { host url }
							currencyCode
						}
					}
				`);
				return jsonText(data.shop);
			} catch (error: any) {
				return jsonText({ error: error?.message || String(error) }, true);
			}
		},
	);

	server.registerTool(
		"shopify_pl_order_by_id",
		{
			description: "Read a Shopify Poland order by numeric Shopify order ID or full gid. Read-only.",
			inputSchema: z.object({
				order_id: z.string().min(1),
			}),
		},
		async ({ order_id }) => {
			try {
				const gid = order_id.startsWith("gid://shopify/Order/")
					? order_id
					: `gid://shopify/Order/${order_id.replace(/\D/g, "")}`;
				const data = await shopifyGraphql(
					`query OrderById($id: ID!) {
						order(id: $id) {
							id
							name
							createdAt
							processedAt
							currencyCode
							displayFinancialStatus
							displayFulfillmentStatus
							test
							totalPriceSet { shopMoney { amount currencyCode } }
							currentTotalPriceSet { shopMoney { amount currencyCode } }
							totalRefundedSet { shopMoney { amount currencyCode } }
							customer { displayName email }
							lineItems(first: 50) {
								nodes { title quantity sku originalUnitPriceSet { shopMoney { amount currencyCode } } }
							}
						}
					}`,
					{ id: gid },
				);
				return jsonText({ requested_id: order_id, order: data.order });
			} catch (error: any) {
				return jsonText({ error: error?.message || String(error) }, true);
			}
		},
	);

	server.registerTool(
		"shopify_pl_orders_between",
		{
			description: "Read Shopify Poland orders created in a date range for GA4 reconciliation. Read-only; returns up to 100 orders.",
			inputSchema: z.object({
				start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
				end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
			}),
		},
		async ({ start_date, end_date }) => {
			try {
				const search = `created_at:>=${start_date} created_at:<=${end_date}T23:59:59`;
				const data = await shopifyGraphql(
					`query OrdersBetween($query: String!) {
						orders(first: 100, query: $query, sortKey: CREATED_AT) {
							nodes {
								id
								name
								createdAt
								processedAt
								currencyCode
								displayFinancialStatus
								displayFulfillmentStatus
								test
								totalPriceSet { shopMoney { amount currencyCode } }
								currentTotalPriceSet { shopMoney { amount currencyCode } }
							}
							pageInfo { hasNextPage endCursor }
						}
					}`,
					{ query: search },
				);
				return jsonText({ start_date, end_date, ...data.orders });
			} catch (error: any) {
				return jsonText({ error: error?.message || String(error) }, true);
			}
		},
	);

	return server;
}

const shopifyMcpHandler = createMcpHandler(createShopifyServer);

export async function handleShopifyRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response | null> {
	currentEnv = env as ShopifyEnv;
	const url = new URL(request.url);
	if (url.pathname !== "/shopify-pl-mcp") return null;

	const rewritten = new URL(request.url);
	rewritten.pathname = "/mcp";
	return shopifyMcpHandler(new Request(rewritten.toString(), request), env, ctx);
}
