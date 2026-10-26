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

export function addDays(date: string, days: number): string {
	const [year, month, day] = date.split("-").map(Number);
	const d = new Date(Date.UTC(year, month - 1, day + days));
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function localMidnightUtcIso(date: string, timeZone: string): string {
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

export function buildCreatedAtSearch(
        startDate: string,
        endDate: string,
        timeZone: string,
): string {
        const startInstant = localMidnightUtcIso(startDate, timeZone);
        const endExclusiveInstant = localMidnightUtcIso(addDays(endDate, 1), timeZone);
        return `created_at:>='${startInstant}' created_at:<'${endExclusiveInstant}'`;
}

function createShopifyUaServer(includeWriteTools = false) {
	const server = new McpServer({ name: "PetsChoice Shopify UA Connector", version: "1.3.0" });

        if (!includeWriteTools) {
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
				const search = buildCreatedAtSearch(start_date, end_date, timeZone);

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


  // ============================================================
  // SHOPIFY UA â€” MARK CONFIRMED OFFLINE/COD PAYMENTS AS PAID
  // ============================================================
        }
  if (includeWriteTools) {
  server.registerTool(
    "shopify_ua_mark_orders_paid",
    {
      description:
        "Safely mark Ukrainian Shopify orders as paid after external payment verification. " +
        "Use dry_run first. Only PENDING, non-cancelled, non-test orders with a tracking number, " +
        "positive outstanding balance and Shopify canMarkAsPaid=true are eligible. Write action.",
      inputSchema: z.object({
        orders: z.array(z.string().min(1)).min(1).max(100),
        mode: z.enum(["dry_run", "execute"]),
      }),
    },
    async ({ orders, mode }) => {
      try {
        const normalizedOrders = [
          ...new Set(
            orders.map((order) => {
              const value = order.trim();
              return value.startsWith("#") ? value : `#${value}`;
            }),
          ),
        ];

        const scopeData = await shopifyGraphql(`
          query ShopifyUaAccessScopes {
            currentAppInstallation {
              accessScopes {
                handle
              }
            }
          }
        `);

        const grantedScopes: string[] =
          scopeData.currentAppInstallation?.accessScopes?.map(
            (scope: any) => String(scope.handle),
          ) || [];

        const hasWriteOrders = grantedScopes.includes("write_orders");

        const inspectQuery = `
          query ShopifyUaOrderForPayment($query: String!) {
            orders(first: 5, query: $query) {
              nodes {
                id
                name
                test
                cancelledAt
                displayFinancialStatus
                canMarkAsPaid
                totalOutstandingSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                fulfillments {
                  status
                  trackingInfo {
                    company
                    number
                    url
                  }
                }
              }
            }
          }
        `;

        const markPaidMutation = `
          mutation ShopifyUaMarkOrderPaid($input: OrderMarkAsPaidInput!) {
            orderMarkAsPaid(input: $input) {
              order {
                id
                name
                displayFinancialStatus
                canMarkAsPaid
                totalOutstandingSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const results: any[] = [];

        for (const requestedOrder of normalizedOrders) {
          const data = await shopifyGraphql(inspectQuery, {
            query: `name:${JSON.stringify(requestedOrder)}`,
          });

          const order = (data.orders?.nodes || []).find(
            (item: any) => item.name === requestedOrder,
          );

          if (!order) {
            results.push({
              order: requestedOrder,
              status: "NOT_FOUND",
            });
            continue;
          }

          const outstanding = Number(
            order.totalOutstandingSet?.shopMoney?.amount || 0,
          );

          const currency =
            order.totalOutstandingSet?.shopMoney?.currencyCode || null;

          const trackingNumbers = (order.fulfillments || [])
            .flatMap((fulfillment: any) => fulfillment.trackingInfo || [])
            .map((tracking: any) => tracking.number)
            .filter(Boolean);

          const blockers: string[] = [];

          if (order.test) blockers.push("TEST_ORDER");
          if (order.cancelledAt) blockers.push("CANCELLED");
          if (order.displayFinancialStatus !== "PENDING") {
            blockers.push(
              `FINANCIAL_STATUS_${order.displayFinancialStatus}`,
            );
          }
          if (!order.canMarkAsPaid) blockers.push("CAN_MARK_AS_PAID_FALSE");
          if (!(outstanding > 0)) blockers.push("NO_OUTSTANDING_BALANCE");
          if (!trackingNumbers.length) blockers.push("NO_TRACKING_NUMBER");

          if (blockers.length) {
            results.push({
              order: requestedOrder,
              id: order.id,
              status: "SKIPPED",
              financial_status: order.displayFinancialStatus,
              outstanding,
              currency,
              tracking_numbers: trackingNumbers,
              blockers,
            });
            continue;
          }

          if (mode === "dry_run") {
            results.push({
              order: requestedOrder,
              id: order.id,
              status: "ELIGIBLE",
              financial_status: order.displayFinancialStatus,
              outstanding,
              currency,
              tracking_numbers: trackingNumbers,
              can_mark_as_paid: order.canMarkAsPaid,
            });
            continue;
          }

          if (!hasWriteOrders) {
            results.push({
              order: requestedOrder,
              id: order.id,
              status: "ERROR",
              error: "Shopify app does not have write_orders scope",
            });
            continue;
          }

          const mutationData = await shopifyGraphql(markPaidMutation, {
            input: { id: order.id },
          });

          const payload = mutationData.orderMarkAsPaid;
          const userErrors = payload?.userErrors || [];

          if (userErrors.length) {
            results.push({
              order: requestedOrder,
              id: order.id,
              status: "ERROR",
              user_errors: userErrors,
            });
            continue;
          }

          results.push({
            order: requestedOrder,
            id: order.id,
            status: "MARKED_PAID",
            financial_status: payload?.order?.displayFinancialStatus,
            outstanding_after:
              payload?.order?.totalOutstandingSet?.shopMoney?.amount,
            currency:
              payload?.order?.totalOutstandingSet?.shopMoney?.currencyCode,
          });
        }

        return jsonText({
          mode,
          write_orders_scope: hasWriteOrders,
          requested_count: normalizedOrders.length,
          eligible_count: results.filter((r) => r.status === "ELIGIBLE").length,
          marked_paid_count: results.filter(
            (r) => r.status === "MARKED_PAID",
          ).length,
          skipped_count: results.filter((r) => r.status === "SKIPPED").length,
          error_count: results.filter((r) => r.status === "ERROR").length,
          results,
        });
      } catch (error: any) {
        return jsonText(
          { error: error?.message || String(error) },
          true,
        );
      }
    },
  );

  }

  // ============================================================
  // SHOPIFY UA â€” READ-ONLY INVENTORY LOOKUP BY SKU
  // ============================================================
  if (!includeWriteTools) {
  server.registerTool(
    "shopify_ua_inventory_by_sku",
    {
      description:
        "Look up Ukrainian Shopify inventory levels for up to 50 SKUs across all locations. Read-only.",
      inputSchema: z.object({
        skus: z.array(z.string().min(1)).min(1).max(50),
      }),
    },
    async ({ skus }) => {
      const normalizedSkus = [
        ...new Set(skus.map((sku) => sku.trim()).filter(Boolean)),
      ];

      const inventoryQuery = `
        query ShopifyUaInventoryBySku($query: String!) {
          productVariants(first: 10, query: $query) {
            nodes {
              id
              sku
              title
              product {
                id
                title
              }
              inventoryItem {
                id
                tracked
                inventoryLevels(first: 250) {
                  nodes {
                    id
                    updatedAt
                    location {
                      id
                      name
                    }
                    quantities(
                      names: ["available", "on_hand", "committed", "incoming", "reserved"]
                    ) {
                      name
                      quantity
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const quantityByName = (quantities: any[], name: string): number => {
        const found = (quantities || []).find((q: any) => q.name === name);
        return found ? Number(found.quantity) || 0 : 0;
      };

      const results: any[] = [];

      for (const requestedSku of normalizedSkus) {
        try {
          const data = await shopifyGraphql(inventoryQuery, {
            query: `sku:${JSON.stringify(requestedSku)}`,
          });

          const nodes = data.productVariants?.nodes || [];
          const matchingNodes = nodes.filter(
            (node: any) => node.sku === requestedSku,
          );

          const matches = matchingNodes.map((node: any) => {
            const inventoryItem = node.inventoryItem;
            const levels = inventoryItem?.inventoryLevels?.nodes || [];

            const locations = levels.map((level: any) => {
              const quantities = level.quantities || [];
              return {
                location_id: level.location?.id ?? null,
                location_name: level.location?.name ?? null,
                updated_at: level.updatedAt ?? null,
                available: quantityByName(quantities, "available"),
                on_hand: quantityByName(quantities, "on_hand"),
                committed: quantityByName(quantities, "committed"),
                incoming: quantityByName(quantities, "incoming"),
                reserved: quantityByName(quantities, "reserved"),
              };
            });

            const totals = locations.reduce(
              (acc: any, loc: any) => {
                acc.available += loc.available;
                acc.on_hand += loc.on_hand;
                acc.committed += loc.committed;
                acc.incoming += loc.incoming;
                acc.reserved += loc.reserved;
                return acc;
              },
              { available: 0, on_hand: 0, committed: 0, incoming: 0, reserved: 0 },
            );

            return {
              variant_id: node.id,
              product_id: node.product?.id ?? null,
              product_title: node.product?.title ?? null,
              variant_title: node.title,
              inventory_item_id: inventoryItem?.id ?? null,
              tracked: inventoryItem?.tracked ?? null,
              totals,
              locations,
            };
          });

          results.push({
            sku: requestedSku,
            found: matches.length > 0,
            matches,
          });
        } catch (error: any) {
          results.push({
            sku: requestedSku,
            found: false,
            matches: [],
            error: error?.message || String(error),
          });
        }
      }

      return jsonText({
        requested_count: normalizedSkus.length,
        results,
      });
    },
  );

  }
	return server;
}

const shopifyUaMcpHandler = createMcpHandler(() => createShopifyUaServer(false));
const shopifyUaWriteMcpHandler = createMcpHandler(() => createShopifyUaServer(true));

export async function handleShopifyUaRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response | null> {
	currentEnv = env as ShopifyUaEnv;
	const url = new URL(request.url);
  const isReadRoute = url.pathname === "/shopify-ua-mcp";
  const isWriteRoute = url.pathname === "/shopify-ua-write-mcp";

  if (!isReadRoute && !isWriteRoute) return null;

  const rewritten = new URL(request.url);
  rewritten.pathname = "/mcp";

  const rewrittenRequest = new Request(rewritten.toString(), request);

  return isWriteRoute
    ? shopifyUaWriteMcpHandler(rewrittenRequest, env, ctx)
    : shopifyUaMcpHandler(rewrittenRequest, env, ctx);
}
