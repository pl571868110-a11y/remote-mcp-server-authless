import {
	metaAccountSummary,
	metaChangeHistory,
	metaPerformance,
	type MetaPerformanceRow,
} from "./meta-ads";

type ReviewSeverity = "info" | "warning" | "critical";
type ReviewStatus = "GREEN" | "YELLOW" | "RED";
type ReportType = "preliminary" | "final" | "on_demand";

export type ReviewFinding = {
	id: string;
	category:
		| "performance"
		| "tracking"
		| "campaign"
		| "adset"
		| "creative"
		| "contractor_action"
		| "shopify"
		| "ga4";
	severity: ReviewSeverity;
	statement: string;
	evidence: Array<{
		source: "meta" | "shopify" | "ga4" | "history";
		metric?: string;
		current?: number | string | null;
		previous?: number | string | null;
		delta_pct?: number | null;
		entity_id?: string | null;
		entity_name?: string | null;
	}>;
	recommendation?: string | null;
	contractor_question?: string | null;
};

type ShopifySummary = {
	orders: number;
	grossSales: number;
	netSales: number;
	refunds: number;
	cancelled: number;
	currency: string;
	timeZone: string;
};

type Ga4Summary = {
	transactions: number;
	purchaseRevenue: number;
	sessions: number;
	propertyId: string;
};

type MetaReview = {
	id: string;
	reportType: ReportType;
	periodStart: string;
	periodEnd: string;
	generatedAt: string;
	status: ReviewStatus;
	meta: MetaPerformanceRow;
	metaPrevious: MetaPerformanceRow;
	metaFourWeekAverage: Partial<MetaPerformanceRow>;
	shopify: ShopifySummary;
	shopifyPrevious: ShopifySummary;
	ga4: Ga4Summary;
	ga4Previous: Ga4Summary;
	campaigns: MetaPerformanceRow[];
	adsets: MetaPerformanceRow[];
	ads: MetaPerformanceRow[];
	changeHistory: Awaited<ReturnType<typeof metaChangeHistory>>;
	findings: ReviewFinding[];
	recommendations: string[];
	contractorQuestions: string[];
	telegramMessage: string;
};

function asNumber(value: unknown): number {
	const n = Number(value ?? 0);
	return Number.isFinite(n) ? n : 0;
}

function round(value: number | null | undefined, digits = 2): number | null {
	if (value === null || value === undefined || !Number.isFinite(value)) return null;
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function pctChange(current: number | null | undefined, previous: number | null | undefined): number | null {
	if (current === null || current === undefined || previous === null || previous === undefined || previous === 0) return null;
	return ((current - previous) / Math.abs(previous)) * 100;
}

function addDays(date: string, days: number): string {
	const [year, month, day] = date.split("-").map(Number);
	const d = new Date(Date.UTC(year, month - 1, day + days));
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function daysInclusive(start: string, end: string): number {
	const ms = new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime();
	return Math.floor(ms / 86400000) + 1;
}

function previousRange(start: string, end: string): { start: string; end: string } {
	const days = daysInclusive(start, end);
	return { start: addDays(start, -days), end: addDays(end, -days) };
}

function localDateInfo(now: Date, timeZone = "Europe/Warsaw") {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-GB", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			weekday: "short",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		}).formatToParts(now).map((p) => [p.type, p.value]),
	);
	return {
		date: `${parts.year}-${parts.month}-${parts.day}`,
		weekday: parts.weekday,
		hour: Number(parts.hour),
		minute: Number(parts.minute),
	};
}

const WEEKDAY_INDEX: Record<string, number> = {
	Mon: 0,
	Tue: 1,
	Wed: 2,
	Thu: 3,
	Fri: 4,
	Sat: 5,
	Sun: 6,
};

function currentWeekRange(now = new Date()): { start: string; end: string } {
	const local = localDateInfo(now);
	const index = WEEKDAY_INDEX[local.weekday] ?? 0;
	return { start: addDays(local.date, -index), end: local.date };
}

function lastCompletedWeekRange(now = new Date()): { start: string; end: string } {
	const local = localDateInfo(now);
	const index = WEEKDAY_INDEX[local.weekday] ?? 0;
	const end = addDays(local.date, -(index + 1));
	return { start: addDays(end, -6), end };
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

async function shopifyAccessToken(env: Env): Promise<string> {
	if (!env.SHOPIFY_SHOP || !env.SHOPIFY_CLIENT_ID || !env.SHOPIFY_CLIENT_SECRET) {
		throw new Error("SHOPIFY_SHOP / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET are not configured");
	}
	const shop = env.SHOPIFY_SHOP.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
	const domain = shop.includes(".") ? shop : `${shop}.myshopify.com`;
	const body = new URLSearchParams({
		grant_type: "client_credentials",
		client_id: env.SHOPIFY_CLIENT_ID,
		client_secret: env.SHOPIFY_CLIENT_SECRET,
	});
	const response = await fetch(`https://${domain}/admin/oauth/access_token`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
	});
	const data: any = await response.json();
	if (!response.ok || !data?.access_token) throw new Error(`Shopify token exchange failed (${response.status})`);
	return String(data.access_token);
}

async function shopifyGraphql(env: Env, query: string, variables: Record<string, unknown> = {}): Promise<any> {
	const rawShop = (env.SHOPIFY_SHOP || "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
	const shop = rawShop.includes(".") ? rawShop : `${rawShop}.myshopify.com`;
	const token = await shopifyAccessToken(env);
	const response = await fetch(`https://${shop}/admin/api/2026-07/graphql.json`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Shopify-Access-Token": token,
		},
		body: JSON.stringify({ query, variables }),
	});
	const data: any = await response.json();
	if (!response.ok || data?.errors?.length) throw new Error(`Shopify GraphQL failed (${response.status}): ${JSON.stringify(data?.errors || {})}`);
	return data.data;
}

async function shopifySalesSummary(env: Env, startDate: string, endDate: string): Promise<ShopifySummary> {
	const identity = await shopifyGraphql(env, `query ReviewShopContext { shop { currencyCode ianaTimezone } }`);
	const timeZone = String(identity.shop.ianaTimezone || "Europe/Kyiv");
	const startInstant = localMidnightUtcIso(startDate, timeZone);
	const endExclusiveInstant = localMidnightUtcIso(addDays(endDate, 1), timeZone);
	const search = `created_at:>=${startInstant} created_at:<${endExclusiveInstant}`;
	const query = `query ReviewOrders($query: String!, $after: String) {
		orders(first: 100, after: $after, query: $query, sortKey: CREATED_AT) {
			nodes {
				id name test cancelledAt displayFinancialStatus
				totalPriceSet { shopMoney { amount currencyCode } }
				currentTotalPriceSet { shopMoney { amount currencyCode } }
				totalRefundedSet { shopMoney { amount currencyCode } }
			}
			pageInfo { hasNextPage endCursor }
		}
	}`;
	const orders: any[] = [];
	let after: string | null = null;
	do {
		const data = await shopifyGraphql(env, query, { query: search, after });
		orders.push(...(data.orders.nodes || []));
		after = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null;
		if (data.orders.pageInfo.hasNextPage && !after) throw new Error("Shopify pagination returned hasNextPage without endCursor");
	} while (after);
	const realOrders = orders.filter((order) => !order.test);
	return {
		orders: realOrders.length,
		grossSales: realOrders.reduce((sum, order) => sum + asNumber(order.totalPriceSet?.shopMoney?.amount), 0),
		netSales: realOrders.reduce((sum, order) => sum + asNumber(order.currentTotalPriceSet?.shopMoney?.amount), 0),
		refunds: realOrders.reduce((sum, order) => sum + asNumber(order.totalRefundedSet?.shopMoney?.amount), 0),
		cancelled: realOrders.filter((order) => Boolean(order.cancelledAt)).length,
		currency: String(identity.shop.currencyCode || "UAH"),
		timeZone,
	};
}

async function googleAccessToken(env: Env): Promise<string> {
	if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) {
		throw new Error("Google OAuth credentials are not configured");
	}
	const body = new URLSearchParams({
		client_id: env.GOOGLE_CLIENT_ID,
		client_secret: env.GOOGLE_CLIENT_SECRET,
		refresh_token: env.GOOGLE_REFRESH_TOKEN,
		grant_type: "refresh_token",
	});
	const response = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
	});
	const data: any = await response.json();
	if (!response.ok || !data?.access_token) throw new Error(`Google token refresh failed (${response.status})`);
	return String(data.access_token);
}

async function ga4Summary(env: Env, startDate: string, endDate: string): Promise<Ga4Summary> {
	const propertyId = env.GA4_UA_PROPERTY_ID || "550699954";
	const token = await googleAccessToken(env);
	const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
		body: JSON.stringify({
			dateRanges: [{ startDate, endDate }],
			metrics: [{ name: "transactions" }, { name: "purchaseRevenue" }, { name: "sessions" }],
		}),
	});
	const data: any = await response.json();
	if (!response.ok) throw new Error(`GA4 Data API failed (${response.status}): ${JSON.stringify(data?.error || {})}`);
	const values = data.rows?.[0]?.metricValues || [];
	return {
		transactions: asNumber(values[0]?.value),
		purchaseRevenue: asNumber(values[1]?.value),
		sessions: asNumber(values[2]?.value),
		propertyId,
	};
}

function threshold(env: Env, key: keyof Env, fallback: number): number {
	const value = Number(env[key]);
	return Number.isFinite(value) ? value : fallback;
}

function avgMeta(rows: MetaPerformanceRow[]): Partial<MetaPerformanceRow> {
	if (!rows.length) return {};
	const mean = (fn: (row: MetaPerformanceRow) => number | null) => {
		const values = rows.map(fn).filter((value): value is number => value !== null && Number.isFinite(value));
		return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
	};
	return {
		spend: mean((r) => r.spend) ?? 0,
		purchases: mean((r) => r.purchases) ?? 0,
		purchaseValue: mean((r) => r.purchaseValue) ?? 0,
		roas: mean((r) => r.roas),
		cpa: mean((r) => r.cpa),
		cpm: mean((r) => r.cpm),
		ctr: mean((r) => r.ctr),
		cpc: mean((r) => r.cpc),
		frequency: mean((r) => r.frequency),
		addToCart: mean((r) => r.addToCart) ?? 0,
		checkout: mean((r) => r.checkout) ?? 0,
	};
}

function severityFor(value: number | null, warning: number, critical: number, direction: "up" | "down"): ReviewSeverity | null {
	if (value === null) return null;
	if (direction === "up") {
		if (value >= critical) return "critical";
		if (value >= warning) return "warning";
	} else {
		if (value <= -critical) return "critical";
		if (value <= -warning) return "warning";
	}
	return null;
}

function collectFindings(
	env: Env,
	meta: MetaPerformanceRow,
	previous: MetaPerformanceRow,
	shopify: ShopifySummary,
	shopifyPrevious: ShopifySummary,
	ga4: Ga4Summary,
	campaigns: MetaPerformanceRow[],
	changes: Awaited<ReturnType<typeof metaChangeHistory>>,
): ReviewFinding[] {
	const findings: ReviewFinding[] = [];
	const cpaDelta = pctChange(meta.cpa, previous.cpa);
	const roasDelta = pctChange(meta.roas, previous.roas);
	const ctrDelta = pctChange(meta.ctr, previous.ctr);
	const cpaSeverity = severityFor(cpaDelta, threshold(env, "META_CPA_WARN_PCT", 15), threshold(env, "META_CPA_CRITICAL_PCT", 30), "up");
	if (cpaSeverity) findings.push({
		id: "cpa-wow",
		category: "performance",
		severity: cpaSeverity,
		statement: `Meta CPA increased ${round(cpaDelta)}% WoW.`,
		evidence: [{ source: "meta", metric: "CPA", current: round(meta.cpa), previous: round(previous.cpa), delta_pct: round(cpaDelta) }],
		recommendation: "Review budget allocation and avoid broad scaling until CPA stabilizes.",
		contractor_question: "Which changes this week were intended to control CPA, and what was their measured effect?",
	});
	const roasSeverity = severityFor(roasDelta, threshold(env, "META_ROAS_WARN_PCT", 15), threshold(env, "META_ROAS_CRITICAL_PCT", 30), "down");
	if (roasSeverity) findings.push({
		id: "roas-wow",
		category: "performance",
		severity: roasSeverity,
		statement: `Meta purchase ROAS decreased ${Math.abs(round(roasDelta) || 0)}% WoW.`,
		evidence: [{ source: "meta", metric: "ROAS", current: round(meta.roas), previous: round(previous.roas), delta_pct: round(roasDelta) }],
		recommendation: "Review which campaigns absorbed spend while purchase value fell before increasing total budget.",
		contractor_question: "What explains the ROAS decline, and which campaign-level action is planned in response?",
	});
	const ctrSeverity = severityFor(ctrDelta, threshold(env, "META_CTR_WARN_PCT", 15), 30, "down");
	if (ctrSeverity) findings.push({
		id: "ctr-wow",
		category: "creative",
		severity: ctrSeverity,
		statement: `Meta CTR decreased ${Math.abs(round(ctrDelta) || 0)}% WoW.`,
		evidence: [{ source: "meta", metric: "CTR", current: round(meta.ctr, 4), previous: round(previous.ctr, 4), delta_pct: round(ctrDelta) }],
		recommendation: "Check creative/audience combinations with the largest CTR deterioration and prepare replacements where needed.",
		contractor_question: "Which creatives are being replaced or refreshed next week?",
	});
	const frequencyWarn = threshold(env, "META_FREQUENCY_WARN", 4);
	if (meta.frequency !== null && meta.frequency >= frequencyWarn) findings.push({
		id: "frequency",
		category: "creative",
		severity: "warning",
		statement: `Account frequency reached ${round(meta.frequency)}. This is a fatigue signal to investigate, not proof of fatigue by itself.`,
		evidence: [{ source: "meta", metric: "frequency", current: round(meta.frequency), previous: round(previous.frequency) }],
		recommendation: "Inspect frequency and CTR at ad set/ad level before refreshing or reallocating spend.",
		contractor_question: "Which audiences or creatives have the highest frequency, and what refresh plan is in place?",
	});
	const zeroPurchaseThreshold = (meta.cpa || previous.cpa || 0) * 1.5;
	for (const campaign of campaigns) {
		if (campaign.purchases === 0 && zeroPurchaseThreshold > 0 && campaign.spend >= zeroPurchaseThreshold) {
			findings.push({
				id: `zero-purchase-${campaign.entityId}`,
				category: "campaign",
				severity: "warning",
				statement: `${campaign.entityName || campaign.entityId} spent ${round(campaign.spend)} with zero attributed purchases.`,
				evidence: [{ source: "meta", metric: "spend_without_purchase", current: round(campaign.spend), entity_id: campaign.entityId, entity_name: campaign.entityName }],
				recommendation: "Review whether this campaign should remain funded at its current level.",
				contractor_question: `Why did ${campaign.entityName || campaign.entityId} remain active after exceeding the zero-purchase spend threshold?`,
			});
		}
	}
	const shopifyNetDelta = pctChange(shopify.netSales, shopifyPrevious.netSales);
	if (shopifyNetDelta !== null && shopifyNetDelta <= -10) findings.push({
		id: "shopify-net-sales",
		category: "shopify",
		severity: "warning",
		statement: `Shopify net sales decreased ${Math.abs(round(shopifyNetDelta) || 0)}% WoW.`,
		evidence: [{ source: "shopify", metric: "net_sales", current: round(shopify.netSales), previous: round(shopifyPrevious.netSales), delta_pct: round(shopifyNetDelta) }],
		recommendation: "Review reversals/refunds and order quality alongside attributed ad performance.",
	});
	const ga4Coverage = shopify.orders > 0 ? ga4.transactions / shopify.orders : 1;
	if (shopify.orders > 0 && ga4Coverage < 0.7) findings.push({
		id: "ga4-coverage",
		category: "tracking",
		severity: ga4Coverage < 0.4 ? "critical" : "warning",
		statement: `GA4 recorded ${ga4.transactions} transactions versus ${shopify.orders} Shopify orders; GA4 coverage is incomplete for this period.`,
		evidence: [
			{ source: "ga4", metric: "transactions", current: ga4.transactions },
			{ source: "shopify", metric: "orders", current: shopify.orders },
		],
		recommendation: "Treat Shopify as business sales truth and investigate missing GA4 purchase events before using GA4 for contractor scoring.",
		contractor_question: "Were any tracking, pixel, CAPI, checkout, or consent changes made this week?",
	});
	if (!changes.available) findings.push({
		id: "change-history-unavailable",
		category: "contractor_action",
		severity: "info",
		statement: "Meta change history is unavailable through the configured direct token, so contractor actions cannot be fully verified from platform history.",
		evidence: [{ source: "history", metric: "available", current: "false" }],
		recommendation: "Keep the contractor action log as fallback until direct Meta history permissions are confirmed.",
	});
	return findings;
}

function statusFromFindings(findings: ReviewFinding[]): ReviewStatus {
	if (findings.some((finding) => finding.severity === "critical")) return "RED";
	if (findings.some((finding) => finding.severity === "warning")) return "YELLOW";
	return "GREEN";
}

function uniqueStrings(values: Array<string | null | undefined>, limit: number): string[] {
	return [...new Set(values.filter((value): value is string => Boolean(value)))].slice(0, limit);
}

function money(value: number | null | undefined): string {
	return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(value || 0);
}

function percent(value: number | null): string {
	if (value === null) return "n/a";
	const sign = value > 0 ? "+" : "";
	return `${sign}${round(value, 1)}%`;
}

function formatTelegram(review: Omit<MetaReview, "telegramMessage">): string {
	const spendDelta = pctChange(review.meta.spend, review.metaPrevious.spend);
	const purchaseDelta = pctChange(review.meta.purchases, review.metaPrevious.purchases);
	const cpaDelta = pctChange(review.meta.cpa, review.metaPrevious.cpa);
	const roasDelta = pctChange(review.meta.roas, review.metaPrevious.roas);
	const ctrDelta = pctChange(review.meta.ctr, review.metaPrevious.ctr);
	const cpmDelta = pctChange(review.meta.cpm, review.metaPrevious.cpm);
	const statusEmoji = review.status === "GREEN" ? "🟢" : review.status === "YELLOW" ? "🟡" : "🔴";
	const attention = review.findings.filter((f) => f.severity !== "info").slice(0, 5);
	const changes = review.changeHistory.available
		? review.changeHistory.items.slice(0, 4).map((item) => `• ${item.operation}${item.entityName ? ` — ${item.entityName}` : ""}`)
		: ["• Meta change history unavailable"];
	return [
		`📊 PetsChoice — Meta Weekly Review`,
		`${review.periodStart} — ${review.periodEnd}${review.reportType === "preliminary" ? " (PRELIMINARY)" : ""}`,
		"",
		"META",
		`Spend: ${money(review.meta.spend)} UAH`,
		`Purchases: ${review.meta.purchases}`,
		`Revenue: ${money(review.meta.purchaseValue)} UAH`,
		`CPA: ${review.meta.cpa === null ? "n/a" : `${money(review.meta.cpa)} UAH`}`,
		`ROAS: ${review.meta.roas === null ? "n/a" : round(review.meta.roas)}`,
		"",
		"SHOPIFY",
		`Orders: ${review.shopify.orders}`,
		`Gross sales: ${money(review.shopify.grossSales)} UAH`,
		`Net sales: ${money(review.shopify.netSales)} UAH`,
		`Refunds: ${money(review.shopify.refunds)} UAH`,
		"",
		"TRACKING",
		`GA4 purchases: ${review.ga4.transactions}`,
		`GA4 revenue: ${money(review.ga4.purchaseRevenue)} UAH`,
		"",
		"WoW",
		`Spend: ${percent(spendDelta)}`,
		`Purchases: ${percent(purchaseDelta)}`,
		`CPA: ${percent(cpaDelta)}`,
		`ROAS: ${percent(roasDelta)}`,
		`CTR: ${percent(ctrDelta)}`,
		`CPM: ${percent(cpmDelta)}`,
		`Frequency: ${review.meta.frequency === null ? "n/a" : round(review.meta.frequency)}`,
		"",
		"WHAT CHANGED",
		...changes,
		"",
		"⚠️ ATTENTION",
		...(attention.length ? attention.map((f) => `• ${f.statement}`) : ["• No configured warning threshold was triggered."]),
		"",
		"NEXT WEEK",
		...review.recommendations.map((item, index) => `${index + 1}. ${item}`),
		"",
		"❓ CONTRACTOR",
		...(review.contractorQuestions.length ? review.contractorQuestions.map((item, index) => `${index + 1}. ${item}`) : ["1. No mandatory question generated."]),
		"",
		`STATUS: ${statusEmoji} ${review.status}`,
	].join("\n").slice(0, 4000);
}

export async function buildMetaReview(env: Env, startDate: string, endDate: string, reportType: ReportType): Promise<MetaReview> {
	const previous = previousRange(startDate, endDate);
	const priorWeeks = Array.from({ length: 4 }, (_, index) => {
		const shift = (index + 1) * 7;
		return { start: addDays(startDate, -shift), end: addDays(endDate, -shift) };
	});
	const [
		meta,
		metaPrevious,
		shopify,
		shopifyPrevious,
		ga4,
		ga4Previous,
		campaigns,
		adsets,
		ads,
		changeHistory,
		...baselineRows
	] = await Promise.all([
		metaAccountSummary(env, startDate, endDate),
		metaAccountSummary(env, previous.start, previous.end),
		shopifySalesSummary(env, startDate, endDate),
		shopifySalesSummary(env, previous.start, previous.end),
		ga4Summary(env, startDate, endDate),
		ga4Summary(env, previous.start, previous.end),
		metaPerformance(env, "campaign", startDate, endDate),
		metaPerformance(env, "adset", startDate, endDate),
		metaPerformance(env, "ad", startDate, endDate),
		metaChangeHistory(env, startDate, endDate),
		...priorWeeks.map((range) => metaAccountSummary(env, range.start, range.end)),
	]);
	const findings = collectFindings(env, meta, metaPrevious, shopify, shopifyPrevious, ga4, campaigns, changeHistory);
	const status = statusFromFindings(findings);
	const recommendations = uniqueStrings(findings.map((finding) => finding.recommendation), 5);
	if (!recommendations.length) recommendations.push("Keep budgets stable and continue monitoring campaign-level CPA/ROAS and tracking coverage.");
	const contractorQuestions = uniqueStrings(findings.map((finding) => finding.contractor_question), 5);
	const id = `${reportType}:${startDate}:${endDate}`;
	const base = {
		id,
		reportType,
		periodStart: startDate,
		periodEnd: endDate,
		generatedAt: new Date().toISOString(),
		status,
		meta,
		metaPrevious,
		metaFourWeekAverage: avgMeta(baselineRows as MetaPerformanceRow[]),
		shopify,
		shopifyPrevious,
		ga4,
		ga4Previous,
		campaigns,
		adsets,
		ads,
		changeHistory,
		findings,
		recommendations,
		contractorQuestions,
	};
	return { ...base, telegramMessage: formatTelegram(base) };
}

async function saveReview(env: Env, review: MetaReview): Promise<boolean> {
	if (!env.META_REVIEW_DB) return false;
	await env.META_REVIEW_DB.prepare(`
		INSERT INTO meta_weekly_reviews (
			id, period_start, period_end, report_type, generated_at,
			meta_spend, meta_purchases, meta_revenue, meta_roas, meta_cpa, meta_cpm, meta_ctr, meta_cpc, meta_frequency, meta_add_to_cart, meta_checkout,
			shopify_orders, shopify_gross_sales, shopify_net_sales, shopify_refunds, shopify_cancelled,
			ga4_transactions, ga4_purchase_revenue,
			status, findings_json, recommendations_json, contractor_questions_json, raw_json, telegram_message
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(period_start, period_end, report_type) DO UPDATE SET
			generated_at=excluded.generated_at,
			meta_spend=excluded.meta_spend, meta_purchases=excluded.meta_purchases, meta_revenue=excluded.meta_revenue,
			meta_roas=excluded.meta_roas, meta_cpa=excluded.meta_cpa, meta_cpm=excluded.meta_cpm, meta_ctr=excluded.meta_ctr,
			meta_cpc=excluded.meta_cpc, meta_frequency=excluded.meta_frequency, meta_add_to_cart=excluded.meta_add_to_cart, meta_checkout=excluded.meta_checkout,
			shopify_orders=excluded.shopify_orders, shopify_gross_sales=excluded.shopify_gross_sales, shopify_net_sales=excluded.shopify_net_sales,
			shopify_refunds=excluded.shopify_refunds, shopify_cancelled=excluded.shopify_cancelled,
			ga4_transactions=excluded.ga4_transactions, ga4_purchase_revenue=excluded.ga4_purchase_revenue,
			status=excluded.status, findings_json=excluded.findings_json, recommendations_json=excluded.recommendations_json,
			contractor_questions_json=excluded.contractor_questions_json, raw_json=excluded.raw_json, telegram_message=excluded.telegram_message
	`).bind(
		review.id, review.periodStart, review.periodEnd, review.reportType, review.generatedAt,
		review.meta.spend, review.meta.purchases, review.meta.purchaseValue, review.meta.roas, review.meta.cpa, review.meta.cpm, review.meta.ctr, review.meta.cpc, review.meta.frequency, review.meta.addToCart, review.meta.checkout,
		review.shopify.orders, review.shopify.grossSales, review.shopify.netSales, review.shopify.refunds, review.shopify.cancelled,
		review.ga4.transactions, review.ga4.purchaseRevenue,
		review.status, JSON.stringify(review.findings), JSON.stringify(review.recommendations), JSON.stringify(review.contractorQuestions), JSON.stringify(review), review.telegramMessage,
	).run();
	return true;
}

async function telegramAlreadySent(env: Env, review: MetaReview): Promise<boolean> {
	if (!env.META_REVIEW_DB) return false;
	const row = await env.META_REVIEW_DB.prepare(
		"SELECT telegram_sent_at FROM meta_weekly_reviews WHERE period_start=? AND period_end=? AND report_type=?",
	).bind(review.periodStart, review.periodEnd, review.reportType).first<{ telegram_sent_at: string | null }>();
	return Boolean(row?.telegram_sent_at);
}

async function markTelegramSent(env: Env, review: MetaReview): Promise<void> {
	if (!env.META_REVIEW_DB) return;
	await env.META_REVIEW_DB.prepare(
		"UPDATE meta_weekly_reviews SET telegram_sent_at=? WHERE period_start=? AND period_end=? AND report_type=?",
	).bind(new Date().toISOString(), review.periodStart, review.periodEnd, review.reportType).run();
}

async function sendTelegram(env: Env, text: string): Promise<void> {
	if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ALLOWED_CHAT_ID) throw new Error("Telegram bot token/chat id are not configured");
	const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ chat_id: env.TELEGRAM_ALLOWED_CHAT_ID, text, disable_web_page_preview: true }),
	});
	const data: any = await response.json();
	if (!response.ok || data?.ok === false) throw new Error(`Telegram sendMessage failed (${response.status}): ${JSON.stringify(data)}`);
}

async function runReview(env: Env, start: string, end: string, reportType: ReportType, send: boolean): Promise<MetaReview> {
	const review = await buildMetaReview(env, start, end, reportType);
	const wasSent = await telegramAlreadySent(env, review);
	await saveReview(env, review);
	if (send && !wasSent) {
		await sendTelegram(env, review.telegramMessage);
		await markTelegramSent(env, review);
	}
	return review;
}

function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data, null, 2), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});
}

function internalAuthorized(request: Request, env: Env): boolean {
	if (!env.META_REVIEW_INTERNAL_TOKEN) return false;
	const bearer = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
	const header = request.headers.get("X-Internal-Token");
	return bearer === env.META_REVIEW_INTERNAL_TOKEN || header === env.META_REVIEW_INTERNAL_TOKEN;
}

async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
	if (!env.TELEGRAM_WEBHOOK_SECRET || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET) {
		return new Response("Forbidden", { status: 403 });
	}
	const update: any = await request.json();
	const message = update?.message;
	const chatId = String(message?.chat?.id ?? "");
	if (!env.TELEGRAM_ALLOWED_CHAT_ID || chatId !== String(env.TELEGRAM_ALLOWED_CHAT_ID)) return new Response("OK");
	const command = String(message?.text || "").trim().split(/\s+/)[0].split("@")[0];
	if (command === "/meta_week") {
		const range = lastCompletedWeekRange();
		await runReview(env, range.start, range.end, "on_demand", true);
	} else if (command === "/meta_now") {
		const range = currentWeekRange();
		await runReview(env, range.start, range.end, "on_demand", true);
	} else if (command === "/meta_history") {
		if (!env.META_REVIEW_DB) await sendTelegram(env, "Meta review history is unavailable: META_REVIEW_DB is not bound.");
		else {
			const history = await env.META_REVIEW_DB.prepare(
				"SELECT period_start, period_end, status, meta_spend, meta_purchases, meta_roas, meta_cpa, shopify_orders, shopify_net_sales FROM meta_weekly_reviews ORDER BY generated_at DESC LIMIT 4",
			).all();
			const lines = (history.results || []).map((row: any) => `${row.period_start}–${row.period_end}: ${row.status} | spend ${money(row.meta_spend)} | purchases ${row.meta_purchases} | ROAS ${round(row.meta_roas)} | Shopify ${row.shopify_orders} orders`);
			await sendTelegram(env, ["📚 Meta Review History", ...lines].join("\n"));
		}
	}
	return new Response("OK");
}

export async function handleMetaReviewRequest(request: Request, env: Env): Promise<Response | null> {
	const url = new URL(request.url);
	if (url.pathname === "/telegram/webhook" && request.method === "POST") return handleTelegramWebhook(request, env);
	if (!url.pathname.startsWith("/internal/meta-review/")) return null;
	if (!internalAuthorized(request, env)) return new Response("Unauthorized", { status: 401 });
	if (url.pathname === "/internal/meta-review/health") {
		return jsonResponse({ ok: true, meta: Boolean(env.META_ACCESS_TOKEN), shopify: Boolean(env.SHOPIFY_SHOP && env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET), ga4: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN), telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_ALLOWED_CHAT_ID), d1: Boolean(env.META_REVIEW_DB) });
	}
	if (url.pathname === "/internal/meta-review/run" && request.method === "POST") {
		const body: any = await request.json().catch(() => ({}));
		const range = body.start_date && body.end_date ? { start: String(body.start_date), end: String(body.end_date) } : lastCompletedWeekRange();
		if (!/^\d{4}-\d{2}-\d{2}$/.test(range.start) || !/^\d{4}-\d{2}-\d{2}$/.test(range.end) || range.start > range.end) return jsonResponse({ error: "Invalid date range" }, 400);
		const review = await runReview(env, range.start, range.end, "on_demand", Boolean(body.send_telegram));
		return jsonResponse(review);
	}
	if (url.pathname === "/internal/meta-review/latest" && request.method === "GET") {
		if (!env.META_REVIEW_DB) return jsonResponse({ error: "META_REVIEW_DB is not bound" }, 503);
		const row = await env.META_REVIEW_DB.prepare("SELECT raw_json FROM meta_weekly_reviews ORDER BY generated_at DESC LIMIT 1").first<{ raw_json: string }>();
		return row ? jsonResponse(JSON.parse(row.raw_json)) : jsonResponse({ report: null });
	}
	if (url.pathname === "/internal/meta-review/history" && request.method === "GET") {
		if (!env.META_REVIEW_DB) return jsonResponse({ error: "META_REVIEW_DB is not bound" }, 503);
		const rows = await env.META_REVIEW_DB.prepare("SELECT period_start, period_end, report_type, generated_at, status, meta_spend, meta_purchases, meta_revenue, meta_roas, meta_cpa, shopify_orders, shopify_net_sales, ga4_transactions, ga4_purchase_revenue FROM meta_weekly_reviews ORDER BY generated_at DESC LIMIT 12").all();
		return jsonResponse(rows.results || []);
	}
	return new Response("Not found", { status: 404 });
}

export async function handleMetaReviewScheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
	const local = localDateInfo(new Date(controller.scheduledTime), "Europe/Warsaw");
	if (local.weekday === "Sun" && local.hour === 20) {
		const range = currentWeekRange(new Date(controller.scheduledTime));
		await runReview(env, range.start, range.end, "preliminary", true);
		return;
	}
	if (local.weekday === "Mon" && local.hour === 8) {
		const range = lastCompletedWeekRange(new Date(controller.scheduledTime));
		const sendFinal = String(env.META_REVIEW_SEND_FINAL || "false").toLowerCase() === "true";
		await runReview(env, range.start, range.end, "final", sendFinal);
	}
}
