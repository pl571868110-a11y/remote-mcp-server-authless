import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

type ReconcileEnv = Env & {
	PCC_CFO_DB?: D1Database;
	NOVAPAY_INGEST_TOKEN?: string;
	SHOPIFY_UA_SERVICE?: Fetcher;
};

const requestSchema = z.object({
	start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	lookback_days: z.number().int().min(0).max(365).optional().default(90),
});

type NovaPayRow = {
	payment_key: string;
	registry_no: string;
	transfer_date: string;
	accepted_amount_cents: number;
	fee_amount_cents: number;
	transferred_amount_cents: number;
	order_number: string;
	en_np: string | null;
	operation_id: string | null;
};

type ShopifyOrder = {
	id: string;
	name: string;
	createdAt?: string;
	processedAt?: string;
	currencyCode?: string;
	displayFinancialStatus?: string;
	financialStatus?: string;
	cancelledAt?: string | null;
	test?: boolean;
	totalPriceSet?: { shopMoney?: { amount?: string; currencyCode?: string } };
	currentTotalPriceSet?: { shopMoney?: { amount?: string; currencyCode?: string } };
};

function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data, null, 2), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});
}

function bearerToken(request: Request): string {
	const auth = request.headers.get("Authorization") || "";
	return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

function addDays(date: string, days: number): string {
	const [year, month, day] = date.split("-").map(Number);
	const d = new Date(Date.UTC(year, month - 1, day + days));
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function moneyToCents(value: unknown): number | null {
	if (value == null || value === "") return null;
	const s = String(value).trim();
	if (!/^-?\d+(?:\.\d{1,2})?$/.test(s)) return null;
	const [whole, fraction = ""] = s.split(".");
	const sign = whole.startsWith("-") ? -1 : 1;
	const absWhole = whole.replace("-", "");
	return sign * (Number(absWhole) * 100 + Number((fraction + "00").slice(0, 2)));
}

async function callShopifyOrdersBetween(
	env: ReconcileEnv,
	startDate: string,
	endDate: string,
): Promise<{ store?: string; currency?: string; orders: ShopifyOrder[] }> {
	if (!env.SHOPIFY_UA_SERVICE) {
		throw new Error("SHOPIFY_UA_SERVICE binding is not configured");
	}

	const serviceFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
		const req = new Request(input, init);
		return env.SHOPIFY_UA_SERVICE!.fetch(req);
	};

	const transport = new StreamableHTTPClientTransport(
		new URL("https://shopify-ua.internal/shopify-ua-mcp"),
		{ fetch: serviceFetch },
	);
	const client = new Client({ name: "pcc-cfo-novapay-reconcile", version: "1.0.0" });

	try {
		await client.connect(transport);
		const result: any = await client.callTool({
			name: "shopify_ua_orders_between",
			arguments: { start_date: startDate, end_date: endDate },
		});
		if (result?.isError) {
			throw new Error(`Shopify MCP tool error: ${JSON.stringify(result.content || result)}`);
		}
		const block = (result?.content || []).find((item: any) => item?.type === "text");
		if (!block?.text) throw new Error("Shopify MCP returned no text payload");
		const parsed = JSON.parse(block.text);
		if (parsed?.error) throw new Error(`Shopify UA: ${parsed.error}`);
		return {
			store: parsed?.store,
			currency: parsed?.currency,
			orders: Array.isArray(parsed?.orders) ? parsed.orders : [],
		};
	} finally {
		await client.close().catch(() => undefined);
	}
}

function classify(payment: NovaPayRow, order: ShopifyOrder | undefined) {
	if (!order) {
		return {
			status: "ORDER_NOT_FOUND",
			deltaCents: null as number | null,
			totalCents: null as number | null,
			currentTotalCents: null as number | null,
		};
	}

	const totalCents = moneyToCents(order.totalPriceSet?.shopMoney?.amount);
	const currentTotalCents = moneyToCents(order.currentTotalPriceSet?.shopMoney?.amount);
	const currentDelta = currentTotalCents == null ? null : payment.accepted_amount_cents - currentTotalCents;
	const originalDelta = totalCents == null ? null : payment.accepted_amount_cents - totalCents;
	const financial = String(order.displayFinancialStatus || order.financialStatus || "").toUpperCase();

	if (order.test) {
		return { status: "TEST_ORDER", deltaCents: currentDelta, totalCents, currentTotalCents };
	}
	if (order.cancelledAt) {
		return { status: "CANCELLED_ORDER", deltaCents: currentDelta, totalCents, currentTotalCents };
	}
	if (currentDelta === 0) {
		const paidLike = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(financial);
		return {
			status: paidLike ? "MATCH_CURRENT" : "MATCH_AMOUNT_SHOPIFY_NOT_PAID",
			deltaCents: 0,
			totalCents,
			currentTotalCents,
		};
	}
	if (originalDelta === 0) {
		return {
			status: "MATCH_ORIGINAL_CURRENT_CHANGED",
			deltaCents: currentDelta,
			totalCents,
			currentTotalCents,
		};
	}
	return { status: "AMOUNT_MISMATCH", deltaCents: currentDelta, totalCents, currentTotalCents };
}

export async function handleNovaPayReconcileRequest(
	request: Request,
	env: Env,
	_ctx: ExecutionContext,
): Promise<Response | null> {
	const url = new URL(request.url);
	if (url.pathname !== "/internal/novapay/reconcile") return null;

	const e = env as ReconcileEnv;
	if (!e.PCC_CFO_DB) return json({ error: "PCC_CFO_DB is not configured" }, 503);
	if (!e.NOVAPAY_INGEST_TOKEN) return json({ error: "NOVAPAY_INGEST_TOKEN is not configured" }, 503);
	if (!e.SHOPIFY_UA_SERVICE) return json({ error: "SHOPIFY_UA_SERVICE is not configured" }, 503);

	const supplied = bearerToken(request);
	if (!supplied || !constantTimeEqual(supplied, e.NOVAPAY_INGEST_TOKEN)) {
		return json({ error: "Unauthorized" }, 401);
	}
	if (request.method !== "POST") {
		return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
	}

	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return json({ error: "Invalid JSON body" }, 400);
	}
	const parsed = requestSchema.safeParse(raw);
	if (!parsed.success) {
		return json({ error: "Invalid payload", details: parsed.error.flatten() }, 400);
	}
	if (parsed.data.start_date > parsed.data.end_date) {
		return json({ error: "start_date must be on or before end_date" }, 400);
	}

	try {
		const paymentsResult = await e.PCC_CFO_DB.prepare(`
			SELECT payment_key, registry_no, transfer_date,
			       accepted_amount_cents, fee_amount_cents, transferred_amount_cents,
			       order_number, en_np, operation_id
			FROM novapay_payments
			WHERE transfer_date >= ? AND transfer_date <= ?
			ORDER BY transfer_date, registry_no, row_no
		`)
			.bind(parsed.data.start_date, parsed.data.end_date)
			.all<NovaPayRow>();

		const payments = paymentsResult.results || [];
		if (!payments.length) {
			return json({
				ok: true,
				start_date: parsed.data.start_date,
				end_date: parsed.data.end_date,
				payments_checked: 0,
				shopify_orders_loaded: 0,
				results: {},
			});
		}

		const shopifyStart = addDays(parsed.data.start_date, -parsed.data.lookback_days);
		const shopify = await callShopifyOrdersBetween(e, shopifyStart, parsed.data.end_date);
		const byName = new Map<string, ShopifyOrder>();
		for (const order of shopify.orders) {
			if (order?.name) byName.set(String(order.name), order);
		}

		const checkedAt = new Date().toISOString();
		const statements: D1PreparedStatement[] = [];
		const counts: Record<string, number> = {};
		const exceptions: Array<Record<string, unknown>> = [];

		for (const payment of payments) {
			const order = byName.get(payment.order_number);
			const c = classify(payment, order);
			counts[c.status] = (counts[c.status] || 0) + 1;

			if (c.status !== "MATCH_CURRENT") {
				exceptions.push({
					payment_key: payment.payment_key,
					registry_no: payment.registry_no,
					transfer_date: payment.transfer_date,
					order_number: payment.order_number,
					novapay_accepted: payment.accepted_amount_cents / 100,
					shopify_total: c.totalCents == null ? null : c.totalCents / 100,
					shopify_current_total: c.currentTotalCents == null ? null : c.currentTotalCents / 100,
					delta: c.deltaCents == null ? null : c.deltaCents / 100,
					financial_status: order?.displayFinancialStatus || order?.financialStatus || null,
					status: c.status,
				});
			}

			statements.push(
				e.PCC_CFO_DB.prepare(`
					INSERT INTO novapay_shopify_reconciliation (
						payment_key, shopify_order_id, shopify_order_name,
						shopify_total_cents, shopify_current_total_cents,
						shopify_financial_status, shopify_cancelled_at, shopify_test,
						result_status, delta_cents, checked_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
					ON CONFLICT(payment_key) DO UPDATE SET
						shopify_order_id=excluded.shopify_order_id,
						shopify_order_name=excluded.shopify_order_name,
						shopify_total_cents=excluded.shopify_total_cents,
						shopify_current_total_cents=excluded.shopify_current_total_cents,
						shopify_financial_status=excluded.shopify_financial_status,
						shopify_cancelled_at=excluded.shopify_cancelled_at,
						shopify_test=excluded.shopify_test,
						result_status=excluded.result_status,
						delta_cents=excluded.delta_cents,
						checked_at=excluded.checked_at
				`)
					.bind(
						payment.payment_key,
						order?.id || null,
						order?.name || null,
						c.totalCents,
						c.currentTotalCents,
						order?.displayFinancialStatus || order?.financialStatus || null,
						order?.cancelledAt || null,
						order?.test ? 1 : 0,
						c.status,
						c.deltaCents,
						checkedAt,
					),
			);
		}

		for (let i = 0; i < statements.length; i += 100) {
			await e.PCC_CFO_DB.batch(statements.slice(i, i + 100));
		}

		return json({
			ok: true,
			start_date: parsed.data.start_date,
			end_date: parsed.data.end_date,
			shopify_query_start_date: shopifyStart,
			shopify_query_end_date: parsed.data.end_date,
			shopify_store: shopify.store || null,
			shopify_currency: shopify.currency || null,
			payments_checked: payments.length,
			shopify_orders_loaded: shopify.orders.length,
			results: counts,
			exceptions,
		});
	} catch (error: any) {
		return json({ error: error?.message || String(error) }, 502);
	}
}
