import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

type RegistryReconcileEnv = Env & {
	PCC_CFO_DB?: D1Database;
	NOVAPAY_INGEST_TOKEN?: string;
	SHOPIFY_UA_SERVICE?: Fetcher;
};

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

const requestSchema = z.object({
	registry_no: z.union([z.string(), z.number()]),
});

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

function moneyToCents(value: unknown): number | null {
	if (value == null || value === "") return null;
	const s = String(value).trim();
	if (!/^-?\d+(?:\.\d{1,2})?$/.test(s)) return null;
	const [whole, fraction = ""] = s.split(".");
	const sign = whole.startsWith("-") ? -1 : 1;
	const absWhole = whole.replace("-", "");
	return sign * (Number(absWhole) * 100 + Number((fraction + "00").slice(0, 2)));
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

async function loadShopifyOrdersByName(
	env: RegistryReconcileEnv,
	orderNames: string[],
): Promise<Map<string, ShopifyOrder>> {
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
	const client = new Client({ name: "pcc-cfo-novapay-registry-reconcile", version: "1.0.0" });
	const byName = new Map<string, ShopifyOrder>();

	try {
		await client.connect(transport);

		for (const orderName of orderNames) {
			const result: any = await client.callTool({
				name: "shopify_get_order",
				arguments: { order: orderName },
			});
			if (result?.isError) {
				throw new Error(`Shopify MCP tool error for ${orderName}: ${JSON.stringify(result.content || result)}`);
			}

			const block = (result?.content || []).find((item: any) => item?.type === "text");
			if (!block?.text) continue;
			const parsed = JSON.parse(block.text);
			if (parsed?.error) throw new Error(`Shopify UA for ${orderName}: ${parsed.error}`);

			const matches: ShopifyOrder[] = Array.isArray(parsed?.matches) ? parsed.matches : [];
			const exact = matches.find((order) => String(order?.name) === orderName) || matches[0];
			if (exact?.name) byName.set(orderName, exact);
		}

		return byName;
	} finally {
		await client.close().catch(() => undefined);
	}
}

export async function reconcileNovaPayRegistry(
	env: Env,
	registryNoInput: string | number,
): Promise<{
	ok: true;
	registry_no: string;
	payments_checked: number;
	shopify_orders_loaded: number;
	results: Record<string, number>;
	exceptions: Array<Record<string, unknown>>;
}> {
	const e = env as RegistryReconcileEnv;
	if (!e.PCC_CFO_DB) throw new Error("PCC_CFO_DB is not configured");
	if (!e.SHOPIFY_UA_SERVICE) throw new Error("SHOPIFY_UA_SERVICE is not configured");

	const registryNo = String(registryNoInput).trim();
	if (!registryNo) throw new Error("registry_no is required");

	const paymentsResult = await e.PCC_CFO_DB.prepare(`
		SELECT payment_key, registry_no, transfer_date,
		       accepted_amount_cents, fee_amount_cents, transferred_amount_cents,
		       order_number, en_np, operation_id
		FROM novapay_payments
		WHERE registry_no = ?
		ORDER BY row_no, payment_key
	`)
		.bind(registryNo)
		.all<NovaPayRow>();

	const payments = paymentsResult.results || [];
	if (!payments.length) {
		return {
			ok: true,
			registry_no: registryNo,
			payments_checked: 0,
			shopify_orders_loaded: 0,
			results: {},
			exceptions: [],
		};
	}

	const uniqueNames = Array.from(new Set(payments.map((p) => p.order_number).filter(Boolean)));
	const ordersByName = await loadShopifyOrdersByName(e, uniqueNames);
	const checkedAt = new Date().toISOString();
	const counts: Record<string, number> = {};
	const exceptions: Array<Record<string, unknown>> = [];
	const statements: D1PreparedStatement[] = [];

	for (const payment of payments) {
		const order = ordersByName.get(payment.order_number);
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

	return {
		ok: true,
		registry_no: registryNo,
		payments_checked: payments.length,
		shopify_orders_loaded: ordersByName.size,
		results: counts,
		exceptions,
	};
}

export async function handleNovaPayRegistryReconcileRequest(
	request: Request,
	env: Env,
	_ctx: ExecutionContext,
): Promise<Response | null> {
	const url = new URL(request.url);
	if (url.pathname !== "/internal/novapay/reconcile-registry") return null;

	const e = env as RegistryReconcileEnv;
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

	try {
		return json(await reconcileNovaPayRegistry(env, parsed.data.registry_no));
	} catch (error: any) {
		return json({ error: error?.message || String(error) }, 502);
	}
}
