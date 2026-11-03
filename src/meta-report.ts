// Read-only Meta collector. No arbitrary Graph paths or paging URLs are accepted.
export type MetaEnv = {
  META_ACCESS_TOKEN?: string;
  META_REVIEW_INTERNAL_TOKEN?: string;
};
const ACCOUNTS = [
  { country: "UA", id: "act_1792664644903675", currency: "UAH" },
  { country: "PL", id: "act_1310408940864798", currency: "PLN" },
] as const;
const PURCHASE = "offsite_conversion.fb_pixel_purchase";
const DAY = 86400000;
type Fetcher = typeof fetch;
type Metrics = { spend: number; purchases: number; revenue: number };
function dateMs(value: string): number {
  const ms = Date.parse(value + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value)
    throw new Error("INVALID_DATE");
  return ms;
}
function numeric(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number") throw new Error("INVALID_METRIC");
  const n = Number(value);
  if (value === "" || !Number.isFinite(n) || n < 0) throw new Error("INVALID_METRIC");
  return n;
}
function purchaseValue(values: unknown): number {
  if (values == null) return 0;
  if (!Array.isArray(values)) throw new Error("INVALID_ACTIONS");
  const matches = values.filter(v => v?.action_type === PURCHASE);
  if (matches.length > 1) throw new Error("DUPLICATE_PURCHASE_TYPE");
  return matches.length ? numeric(matches[0].value) : 0;
}
function derived(m: Metrics) {
  return { ...m, cpa: m.purchases > 0 ? m.spend / m.purchases : null, roas: m.spend > 0 ? m.revenue / m.spend : null };
}
class GraphError extends Error {
  readonly status: number;
  readonly graphCode: number | null;
  constructor(status: number, graphCode: number | null) { super("META_API_ERROR"); this.status=status; this.graphCode=graphCode; }
}
export async function collectMeta(env: MetaEnv, since: string, until: string, fetcher: Fetcher = fetch) {
  const start = dateMs(since), end = dateMs(until);
  if (end < start || (end - start) / DAY >= 93) throw new Error("RANGE_MUST_BE_1_TO_93_DAYS");
  if (!env.META_ACCESS_TOKEN) throw new Error("META_TOKEN_NOT_CONFIGURED");
  const results = await Promise.all(ACCOUNTS.map(async account => {
    const days = new Map<string, ReturnType<typeof derived> & { date: string }>();
    const cursors = new Set<string>();
    let after: string | undefined;
    let complete = false;
    let error: { code: string; http_status?: number; graph_code?: number | null } | null = null;
    try {
      for (let page = 0; page < 100; page++) {
        const url = new URL(`https://graph.facebook.com/v24.0/${account.id}/insights`);
        url.search = new URLSearchParams({
          fields: "account_id,account_currency,date_start,date_stop,spend,actions,action_values",
          level: "account", time_increment: "1", limit: "100",
          time_range: JSON.stringify({ since, until }),
          action_attribution_windows: JSON.stringify(["7d_click", "1d_view"]),
          action_report_time: "impression", ...(after ? { after } : {}),
        }).toString();
        const response = await fetcher(url, {
          headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` },
          signal: AbortSignal.timeout(20000), redirect: "error",
        });
        const body: any = await response.json();
        if (!response.ok || body.error) throw new GraphError(response.status, Number.isInteger(body.error?.code) ? body.error.code : null);
        if (!Array.isArray(body.data)) throw new Error("INVALID_META_RESPONSE");
        for (const row of body.data) {
          if (row.account_id !== account.id.slice(4) || row.account_currency !== account.currency) throw new Error("ACCOUNT_OR_CURRENCY_MISMATCH");
          const ms = dateMs(row.date_start);
          if (ms < start || ms > end || row.date_stop !== row.date_start) throw new Error("DATE_MISMATCH");
          if (days.has(row.date_start)) throw new Error("DUPLICATE_DAY");
          days.set(row.date_start, { date: row.date_start, ...derived({ spend: numeric(row.spend), purchases: purchaseValue(row.actions), revenue: purchaseValue(row.action_values) }) });
        }
        if (!body.paging?.next) { complete = true; break; }
        const cursor = body.paging?.cursors?.after;
        if (typeof cursor !== "string" || !cursor || cursors.has(cursor)) throw new Error("INVALID_PAGING_CURSOR");
        cursors.add(cursor); after = cursor;
      }
      if (!complete) throw new Error("PAGE_LIMIT_REACHED");
    } catch (e) {
      const allowed = ["INVALID_METRIC", "INVALID_ACTIONS", "DUPLICATE_PURCHASE_TYPE", "INVALID_META_RESPONSE", "ACCOUNT_OR_CURRENCY_MISMATCH", "INVALID_DATE", "DATE_MISMATCH", "DUPLICATE_DAY", "INVALID_PAGING_CURSOR", "PAGE_LIMIT_REACHED"];
      // Never return upstream messages, paging URLs, token-bearing request URLs or stack traces.
      error = e instanceof GraphError ? { code: e.message, http_status: e.status, graph_code: e.graphCode }
        : { code: e instanceof Error && allowed.includes(e.message) ? e.message : "META_FETCH_FAILED" };
    }
    const rows = [...days.values()].sort((a,b) => a.date.localeCompare(b.date));
    const sum = rows.reduce((a,r) => ({ spend: a.spend+r.spend, purchases: a.purchases+r.purchases, revenue: a.revenue+r.revenue }), {spend:0,purchases:0,revenue:0});
    return { ...account, status: complete ? "VERIFIED" : rows.length ? "PARTIAL" : "UNAVAILABLE", complete, error, days: rows, totals: complete ? derived(sum) : null };
  }));
  return { fetched_at: new Date().toISOString(), since, until, attribution: ["7d_click", "1d_view"], action_report_time: "impression", purchase_type: PURCHASE, results };
}
function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
export async function handleMetaReport(request: Request, env: MetaEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/meta-report") return null;
  if (!env.META_REVIEW_INTERNAL_TOKEN || !env.META_ACCESS_TOKEN) return json({error:"META_REPORT_NOT_CONFIGURED"},503);
  // Separate application credential: Cloudflare Access authentication remains required externally.
  const supplied = request.headers.get("X-Meta-Report-Key") || "";
  const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [a,b] = await Promise.all([digest(supplied),digest(env.META_REVIEW_INTERNAL_TOKEN)]);
  let diff = 0; for(let i=0;i<a.length;i++) diff |= a[i]^b[i];
  if (!supplied || diff !== 0) return json({error:"UNAUTHORIZED"},401);
  if (request.method !== "GET") return json({error:"METHOD_NOT_ALLOWED"},405);
  try { return json(await collectMeta(env,url.searchParams.get("since") || "",url.searchParams.get("until") || "")); }
  catch(e) { const code=e instanceof Error && ["INVALID_DATE","RANGE_MUST_BE_1_TO_93_DAYS"].includes(e.message) ? e.message : "META_REPORT_FAILED"; return json({error:code},code==="META_REPORT_FAILED"?503:400); }
}
