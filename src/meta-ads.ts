export type MetaLevel = "account" | "campaign" | "adset" | "ad";

export type MetaPerformanceRow = {
	entityId: string;
	entityName: string;
	spend: number;
	impressions: number;
	clicks: number;
	purchases: number;
	purchaseValue: number;
	roas: number | null;
	cpa: number | null;
	cpm: number | null;
	ctr: number | null;
	cpc: number | null;
	frequency: number | null;
	addToCart: number;
	checkout: number;
};

export type MetaChangeHistory = {
	available: boolean;
	items: Array<{
		timestamp: string;
		actor: string | null;
		application: string | null;
		entityId: string | null;
		entityName: string | null;
		operation: string;
		extra: unknown;
	}>;
	error?: string;
};

type MetaEnv = Pick<
	Env,
	"META_ACCESS_TOKEN" | "META_AD_ACCOUNT_ID" | "META_GRAPH_API_VERSION"
>;

function numberValue(value: unknown): number {
	const n = Number(value ?? 0);
	return Number.isFinite(n) ? n : 0;
}

function nullableNumber(value: unknown): number | null {
	if (value === null || value === undefined || value === "") return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

function adAccountId(env: MetaEnv): string {
	const raw = (env.META_AD_ACCOUNT_ID || "1792664644903675").trim();
	return raw.startsWith("act_") ? raw : `act_${raw}`;
}

function apiVersion(env: MetaEnv): string {
	return (env.META_GRAPH_API_VERSION || "v24.0").trim();
}

function requireToken(env: MetaEnv): string {
	if (!env.META_ACCESS_TOKEN) {
		throw new Error("META_ACCESS_TOKEN is not configured");
	}
	return env.META_ACCESS_TOKEN;
}

async function graphGet(
	env: MetaEnv,
	path: string,
	params: Record<string, string>,
): Promise<any> {
	const token = requireToken(env);
	const url = new URL(`https://graph.facebook.com/${apiVersion(env)}/${path}`);
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
	url.searchParams.set("access_token", token);
	const response = await fetch(url.toString(), { method: "GET" });
	const raw = await response.text();
	let data: any;
	try {
		data = raw ? JSON.parse(raw) : {};
	} catch {
		throw new Error(`Meta API ${response.status} returned non-JSON: ${raw.slice(0, 300)}`);
	}
	if (!response.ok || data?.error) {
		throw new Error(`Meta API ${response.status}: ${JSON.stringify(data?.error || data)}`);
	}
	return data;
}

async function graphGetAll(
	env: MetaEnv,
	path: string,
	params: Record<string, string>,
): Promise<any[]> {
	const first = await graphGet(env, path, params);
	const rows: any[] = Array.isArray(first?.data) ? [...first.data] : [];
	let next: string | undefined = first?.paging?.next;
	let pages = 1;
	while (next && pages < 50) {
		const response = await fetch(next, { method: "GET" });
		const raw = await response.text();
		let data: any;
		try {
			data = raw ? JSON.parse(raw) : {};
		} catch {
			throw new Error(`Meta pagination ${response.status} returned non-JSON`);
		}
		if (!response.ok || data?.error) {
			throw new Error(`Meta pagination ${response.status}: ${JSON.stringify(data?.error || data)}`);
		}
		if (Array.isArray(data?.data)) rows.push(...data.data);
		next = data?.paging?.next;
		pages += 1;
	}
	if (next) throw new Error("Meta pagination exceeded 50 pages");
	return rows;
}

function pickAction(rows: any, candidates: string[]): number {
	if (!Array.isArray(rows)) return 0;
	for (const candidate of candidates) {
		const match = rows.find((item: any) => item?.action_type === candidate);
		if (match) return numberValue(match.value);
	}
	return 0;
}

const PURCHASE_ACTIONS = [
	"offsite_conversion.fb_pixel_purchase",
	"purchase",
	"omni_purchase",
];
const ADD_TO_CART_ACTIONS = [
	"offsite_conversion.fb_pixel_add_to_cart",
	"add_to_cart",
	"omni_add_to_cart",
];
const CHECKOUT_ACTIONS = [
	"offsite_conversion.fb_pixel_initiate_checkout",
	"initiate_checkout",
	"omni_initiated_checkout",
];

function entityIdentity(row: any, level: MetaLevel): [string, string] {
	if (level === "campaign") return [String(row.campaign_id || ""), String(row.campaign_name || "")];
	if (level === "adset") return [String(row.adset_id || ""), String(row.adset_name || "")];
	if (level === "ad") return [String(row.ad_id || ""), String(row.ad_name || "")];
	return [String(row.account_id || ""), String(row.account_name || "")];
}

function normalizeRow(row: any, level: MetaLevel): MetaPerformanceRow {
	const [entityId, entityName] = entityIdentity(row, level);
	const spend = numberValue(row.spend);
	const purchases = pickAction(row.actions, PURCHASE_ACTIONS);
	const purchaseValue = pickAction(row.action_values, PURCHASE_ACTIONS);
	const addToCart = pickAction(row.actions, ADD_TO_CART_ACTIONS);
	const checkout = pickAction(row.actions, CHECKOUT_ACTIONS);
	return {
		entityId,
		entityName,
		spend,
		impressions: numberValue(row.impressions),
		clicks: numberValue(row.clicks),
		purchases,
		purchaseValue,
		roas: spend > 0 ? purchaseValue / spend : null,
		cpa: purchases > 0 ? spend / purchases : null,
		cpm: nullableNumber(row.cpm),
		ctr: nullableNumber(row.ctr),
		cpc: nullableNumber(row.cpc),
		frequency: nullableNumber(row.frequency),
		addToCart,
		checkout,
	};
}

export async function metaPerformance(
	env: MetaEnv,
	level: MetaLevel,
	startDate: string,
	endDate: string,
): Promise<MetaPerformanceRow[]> {
	const identityFields =
		level === "campaign"
			? "campaign_id,campaign_name,"
			: level === "adset"
				? "campaign_id,campaign_name,adset_id,adset_name,"
				: level === "ad"
					? "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,"
					: "account_id,account_name,";
	const fields = `${identityFields}spend,impressions,clicks,cpm,ctr,cpc,frequency,actions,action_values`;
	const rows = await graphGetAll(env, `${adAccountId(env)}/insights`, {
		fields,
		level,
		time_range: JSON.stringify({ since: startDate, until: endDate }),
		time_increment: "all_days",
		limit: "500",
	});
	return rows.map((row) => normalizeRow(row, level)).sort((a, b) => b.spend - a.spend);
}

export async function metaAccountSummary(
	env: MetaEnv,
	startDate: string,
	endDate: string,
): Promise<MetaPerformanceRow> {
	const rows = await metaPerformance(env, "account", startDate, endDate);
	return (
		rows[0] || {
			entityId: adAccountId(env),
			entityName: "",
			spend: 0,
			impressions: 0,
			clicks: 0,
			purchases: 0,
			purchaseValue: 0,
			roas: null,
			cpa: null,
			cpm: null,
			ctr: null,
			cpc: null,
			frequency: null,
			addToCart: 0,
			checkout: 0,
		}
	);
}

export async function metaChangeHistory(
	env: MetaEnv,
	startDate: string,
	endDate: string,
): Promise<MetaChangeHistory> {
	try {
		const since = `${startDate}T00:00:00`;
		const until = `${endDate}T23:59:59`;
		const rows = await graphGetAll(env, `${adAccountId(env)}/activities`, {
			fields: "event_time,event_type,translated_event_type,object_id,object_name,actor_name,application_name,extra_data",
			since,
			until,
			limit: "200",
		});
		return {
			available: true,
			items: rows.map((row) => ({
				timestamp: String(row.event_time || ""),
				actor: row.actor_name ? String(row.actor_name) : null,
				application: row.application_name ? String(row.application_name) : null,
				entityId: row.object_id ? String(row.object_id) : null,
				entityName: row.object_name ? String(row.object_name) : null,
				operation: String(row.translated_event_type || row.event_type || "unknown"),
				extra: row.extra_data ?? null,
			})),
		};
	} catch (error: any) {
		return {
			available: false,
			items: [],
			error: error?.message || String(error),
		};
	}
}
