import { reconcileNovaPayRegistry } from "./novapay-reconcile-registry";

type AutoPaidEnv = Env & {
PCC_CFO_DB?: D1Database;
SHOPIFY_UA_SERVICE?: Fetcher;
PCC_MCP_READ_TOKEN?: string;
PCC_MCP_WRITE_TOKEN?: string;
NOVAPAY_INGEST_TOKEN?: string;
};

type Candidate = {
payment_key: string;
registry_no: string;
order_number: string;
accepted_amount_cents: number;
en_np: string | null;
};

type AutoPaidMode = "dry_run" | "execute";

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
for (let i = 0; i < a.length; i++) {
diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
}
return diff === 0;
}

function moneyToCents(value: unknown): number | null {
if (value == null || value === "") return null;

const s = String(value).trim();

if (!/^-?\d+(?:\.\d{1,2})?$/.test(s)) {
return null;
}

const [whole, fraction = ""] = s.split(".");
const sign = whole.startsWith("-") ? -1 : 1;
const absWhole = whole.replace("-", "");

return (
sign *
(Number(absWhole) * 100 + Number((fraction + "00").slice(0, 2)))
);
}

function normalizeOrder(value: unknown): string {
const s = String(value || "").trim();
if (!s) return "";
return s.startsWith("#") ? s : `#${s}`;
}

function parseMcpRpc(raw: string): any {
const trimmed = raw.trim();

if (trimmed.startsWith("{")) {
return JSON.parse(trimmed);
}

const dataLines = raw
.split(/\r?\n/)
.filter((line) => line.startsWith("data: "))
.map((line) => line.slice(6));

if (!dataLines.length) {
throw new Error(`MCP returned no data event: ${raw.slice(0, 500)}`);
}

return JSON.parse(dataLines.join("\n"));
}

async function callMcpTool(
env: AutoPaidEnv,
path: "/mcp" | "/shopify-ua-write-mcp",
token: string,
name: string,
args: Record<string, unknown>,
): Promise<any> {
if (!env.SHOPIFY_UA_SERVICE) {
throw new Error("SHOPIFY_UA_SERVICE is not configured");
}

const response = await env.SHOPIFY_UA_SERVICE.fetch(
new Request(`https://pcc-internal.local${path}`, {
method: "POST",
headers: {
Authorization: `Bearer ${token}`,
"Content-Type": "application/json",
Accept: "application/json, text/event-stream",
},
body: JSON.stringify({
jsonrpc: "2.0",
id: 1,
method: "tools/call",
params: {
name,
arguments: args,
},
}),
}),
);

const raw = await response.text();

if (!response.ok) {
throw new Error(
`MCP ${name} HTTP ${response.status}: ${raw.slice(0, 500)}`,
);
}

const rpc = parseMcpRpc(raw);

if (rpc?.error) {
throw new Error(
`MCP ${name} RPC error: ${JSON.stringify(rpc.error)}`,
);
}

const result = rpc?.result;

if (result?.isError) {
throw new Error(
`MCP ${name} tool error: ${JSON.stringify(result.content || result)}`,
);
}

const block = (result?.content || []).find(
(item: any) => item?.type === "text",
);

if (!block?.text) {
throw new Error(`MCP ${name} returned no text payload`);
}

return JSON.parse(block.text);
}

async function loadCandidates(env: AutoPaidEnv): Promise<Candidate[]> {
if (!env.PCC_CFO_DB) {
throw new Error("PCC_CFO_DB is not configured");
}

const result = await env.PCC_CFO_DB.prepare(`
SELECT
p.payment_key,
p.registry_no,
p.order_number,
p.accepted_amount_cents,
p.en_np
FROM novapay_payments p
JOIN novapay_shopify_reconciliation r
ON r.payment_key = p.payment_key
WHERE r.result_status = 'MATCH_AMOUNT_SHOPIFY_NOT_PAID'
  AND r.delta_cents = 0
  AND UPPER(COALESCE(r.shopify_financial_status, '')) = 'PENDING'
  AND COALESCE(r.shopify_test, 0) = 0
  AND r.shopify_cancelled_at IS NULL
ORDER BY p.transfer_date ASC, p.registry_no ASC, p.order_number ASC
LIMIT 100
`).all<Candidate>();

return result.results || [];
}

export async function runAutoPaid(
env: Env,
mode: AutoPaidMode,
) {
const e = env as AutoPaidEnv;

if (!e.PCC_CFO_DB) {
throw new Error("PCC_CFO_DB is not configured");
}
if (!e.SHOPIFY_UA_SERVICE) {
throw new Error("SHOPIFY_UA_SERVICE is not configured");
}
if (!e.PCC_MCP_READ_TOKEN) {
throw new Error("PCC_MCP_READ_TOKEN is not configured");
}
if (!e.PCC_MCP_WRITE_TOKEN) {
throw new Error("PCC_MCP_WRITE_TOKEN is not configured");
}

const rawCandidates = await loadCandidates(e);

/*
 * Fail closed if one Shopify order is represented by
 * more than one reconciliation candidate.
 */
const grouped = new Map<string, Candidate[]>();

for (const candidate of rawCandidates) {
const order = normalizeOrder(candidate.order_number);
if (!order) continue;

const list = grouped.get(order) || [];
list.push(candidate);
grouped.set(order, list);
}

const candidates: Candidate[] = [];
const decisions: Array<Record<string, unknown>> = [];

for (const [order, rows] of grouped.entries()) {
if (rows.length !== 1) {
decisions.push({
order,
status: "SKIPPED",
blockers: ["AMBIGUOUS_MULTIPLE_PAYMENTS"],
});
continue;
}

candidates.push(rows[0]);
}

if (!candidates.length) {
return {
ok: true,
mode,
candidates_found: rawCandidates.length,
ready_for_shopify: 0,
marked_paid: 0,
verified_match_current: 0,
decisions,
};
}

const trackingNumbers = [
...new Set(
candidates
.map((candidate) => String(candidate.en_np || "").trim())
.filter(Boolean),
),
];

let npRows: any[] = [];

if (trackingNumbers.length) {
const value = await callMcpTool(
e,
"/mcp",
e.PCC_MCP_READ_TOKEN,
"novaposhta_status",
{ tracking_numbers: trackingNumbers },
);

if (!Array.isArray(value)) {
throw new Error("novaposhta_status did not return an array");
}

npRows = value;
}

const npByTracking = new Map<string, any>();

for (const row of npRows) {
const tracking = String(row?.trackingNumber || "").trim();
if (tracking) npByTracking.set(tracking, row);
}

const npConfirmed: Candidate[] = [];

for (const candidate of candidates) {
const order = normalizeOrder(candidate.order_number);
const tracking = String(candidate.en_np || "").trim();
const blockers: string[] = [];

if (!tracking) {
blockers.push("NO_TTN_IN_NOVAPAY");
}

const np = tracking ? npByTracking.get(tracking) : undefined;

if (tracking && !np) {
blockers.push("TTN_NOT_FOUND_IN_NOVAPOSHTA");
}

if (np) {
if (!np.actualDeliveryDate) {
blockers.push("NOT_DELIVERED");
}

if (np.paymentCollected !== true) {
blockers.push("PAYMENT_NOT_COLLECTED");
}

const npAmountCents = moneyToCents(np.amount);

if (npAmountCents == null) {
blockers.push("NOVAPOSHTA_AMOUNT_INVALID");
} else if (npAmountCents !== candidate.accepted_amount_cents) {
blockers.push("NOVAPOSHTA_NOVAPAY_AMOUNT_MISMATCH");
}

const npOrder = normalizeOrder(np.shopifyOrder);

if (npOrder && npOrder !== order) {
blockers.push("NOVAPOSHTA_ORDER_MISMATCH");
}
}

if (blockers.length) {
decisions.push({
order,
registry_no: candidate.registry_no,
status: "SKIPPED",
blockers,
});
continue;
}

npConfirmed.push(candidate);
}

if (!npConfirmed.length) {
return {
ok: true,
mode,
candidates_found: rawCandidates.length,
novaposhta_confirmed: 0,
ready_for_shopify: 0,
marked_paid: 0,
verified_match_current: 0,
decisions,
};
}

/*
 * Mandatory Shopify dry-run immediately before any write.
 */
const dryRun = await callMcpTool(
e,
"/shopify-ua-write-mcp",
e.PCC_MCP_WRITE_TOKEN,
"shopify_ua_mark_orders_paid",
{
orders: npConfirmed.map((candidate) =>
normalizeOrder(candidate.order_number)
),
mode: "dry_run",
},
);

const dryResults: any[] = Array.isArray(dryRun?.results)
? dryRun.results
: [];

const dryByOrder = new Map<string, any>();

for (const row of dryResults) {
dryByOrder.set(normalizeOrder(row?.order), row);
}

const ready: Candidate[] = [];

for (const candidate of npConfirmed) {
const order = normalizeOrder(candidate.order_number);
const row = dryByOrder.get(order);
const blockers: string[] = [];

if (!row) {
blockers.push("SHOPIFY_DRY_RUN_MISSING");
} else {
if (row.status !== "ELIGIBLE") {
blockers.push(`SHOPIFY_${row.status || "UNKNOWN"}`);
}

if (String(row.financial_status || "").toUpperCase() !== "PENDING") {
blockers.push("SHOPIFY_NOT_PENDING");
}

if (row.can_mark_as_paid !== true) {
blockers.push("SHOPIFY_CAN_MARK_AS_PAID_FALSE");
}

const outstandingCents = moneyToCents(row.outstanding);

if (outstandingCents !== candidate.accepted_amount_cents) {
blockers.push("SHOPIFY_OUTSTANDING_AMOUNT_MISMATCH");
}

const trackingNumbers = Array.isArray(row.tracking_numbers)
? row.tracking_numbers.map((value: unknown) =>
String(value).trim()
)
: [];

const expectedTracking = String(candidate.en_np || "").trim();

if (
!expectedTracking ||
!trackingNumbers.includes(expectedTracking)
) {
blockers.push("SHOPIFY_TTN_MISMATCH");
}
}

if (blockers.length) {
decisions.push({
order,
registry_no: candidate.registry_no,
status: "SKIPPED",
blockers,
});
continue;
}

ready.push(candidate);
}

if (mode === "dry_run" || !ready.length) {
for (const candidate of ready) {
decisions.push({
order: normalizeOrder(candidate.order_number),
registry_no: candidate.registry_no,
status: "READY",
});
}

return {
ok: true,
mode,
candidates_found: rawCandidates.length,
novaposhta_confirmed: npConfirmed.length,
ready_for_shopify: ready.length,
marked_paid: 0,
verified_match_current: 0,
decisions,
};
}

const execute = await callMcpTool(
e,
"/shopify-ua-write-mcp",
e.PCC_MCP_WRITE_TOKEN,
"shopify_ua_mark_orders_paid",
{
orders: ready.map((candidate) =>
normalizeOrder(candidate.order_number)
),
mode: "execute",
},
);

const executeResults: any[] = Array.isArray(execute?.results)
? execute.results
: [];

const executeByOrder = new Map<string, any>();

for (const row of executeResults) {
executeByOrder.set(normalizeOrder(row?.order), row);
}

const marked: Candidate[] = [];

for (const candidate of ready) {
const order = normalizeOrder(candidate.order_number);
const row = executeByOrder.get(order);

const markedOk =
row?.status === "MARKED_PAID" &&
String(row?.financial_status || "").toUpperCase() === "PAID" &&
moneyToCents(row?.outstanding_after) === 0;

if (!markedOk) {
decisions.push({
order,
registry_no: candidate.registry_no,
status: "WRITE_FAILED_OR_UNVERIFIED",
shopify_result: row || null,
});
continue;
}

marked.push(candidate);

decisions.push({
order,
registry_no: candidate.registry_no,
status: "MARKED_PAID",
});
}

/*
 * Refresh reconciliation after Shopify writes.
 */
const registries = [
...new Set(marked.map((candidate) => candidate.registry_no)),
];

for (const registryNo of registries) {
await reconcileNovaPayRegistry(e, registryNo);
}

let verified = 0;

for (const candidate of marked) {
const row = await e.PCC_CFO_DB.prepare(`
SELECT result_status,
       shopify_financial_status,
       delta_cents
FROM novapay_shopify_reconciliation
WHERE payment_key = ?
`)
.bind(candidate.payment_key)
.first<{
result_status: string;
shopify_financial_status: string;
delta_cents: number | null;
}>();

const ok =
row?.result_status === "MATCH_CURRENT" &&
String(row?.shopify_financial_status || "").toUpperCase() ===
"PAID" &&
row?.delta_cents === 0;

if (!ok) {
throw new Error(
`Post-write verification failed for ${normalizeOrder(candidate.order_number)}`,
);
}

verified++;
}

return {
ok: true,
mode,
candidates_found: rawCandidates.length,
novaposhta_confirmed: npConfirmed.length,
ready_for_shopify: ready.length,
marked_paid: marked.length,
verified_match_current: verified,
decisions,
};
}

export async function handleAutoPaidRequest(
request: Request,
env: Env,
): Promise<Response | null> {
const url = new URL(request.url);

if (url.pathname !== "/internal/auto-paid") {
return null;
}

const e = env as AutoPaidEnv;

if (!e.PCC_MCP_WRITE_TOKEN) {
return json({ error: "PCC_MCP_WRITE_TOKEN is not configured" }, 503);
}

const supplied = bearerToken(request);

if (
!supplied ||
!constantTimeEqual(supplied, e.PCC_MCP_WRITE_TOKEN)
) {
return json({ error: "Unauthorized" }, 401);
}

if (request.method !== "POST") {
return new Response("Method Not Allowed", {
status: 405,
headers: { Allow: "POST" },
});
}

let raw: any;

try {
raw = await request.json();
} catch {
return json({ error: "Invalid JSON body" }, 400);
}

const mode: AutoPaidMode =
raw?.mode === "execute" ? "execute" : "dry_run";

try {
return json(await runAutoPaid(env, mode));
} catch (error: any) {
return json(
{ error: error?.message || String(error) },
502,
);
}
}
