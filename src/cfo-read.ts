import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

type CfoReadEnv = Env & {
	PCC_CFO_DB?: D1Database;
};

let currentEnv: CfoReadEnv;

function jsonText(data: unknown, isError = false) {
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify(data, null, 2),
			},
		],
		...(isError ? { isError: true } : {}),
	};
}

function parseJson(value: unknown): unknown {
	if (value == null || value === "") return null;

	try {
		return JSON.parse(String(value));
	} catch {
		return String(value);
	}
}

function normalizeOrder(value: string | undefined): string | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

async function readAudit(input: {
	limit: number;
	run_id?: string;
	order?: string;
	status?: string;
	since?: string;
}) {
	if (!currentEnv.PCC_CFO_DB) {
		throw new Error("PCC_CFO_DB is not configured");
	}

	const db = currentEnv.PCC_CFO_DB;
	const runId = input.run_id?.trim() || null;
	const orderNumber = normalizeOrder(input.order);
	const eventStatus = input.status?.trim() || null;
	const since = input.since?.trim() || null;

	const runs = await db
		.prepare(`
			SELECT
				r.run_id,
				r.trigger_source,
				r.mode,
				r.status,
				r.started_at,
				r.finished_at,
				r.candidates_found,
				r.novaposhta_confirmed,
				r.ready_for_shopify,
				r.marked_paid,
				r.verified_match_current,
				r.decisions_count,
				r.error_message
			FROM cfo_auto_paid_runs r
			WHERE (? IS NULL OR r.run_id = ?)
			  AND (? IS NULL OR r.started_at >= ?)
			  AND (
				? IS NULL OR EXISTS (
					SELECT 1
					FROM cfo_auto_paid_events e
					WHERE e.run_id = r.run_id
					  AND e.order_number = ?
				)
			  )
			  AND (
				? IS NULL OR EXISTS (
					SELECT 1
					FROM cfo_auto_paid_events e
					WHERE e.run_id = r.run_id
					  AND e.event_status = ?
				)
			  )
			ORDER BY r.started_at DESC
			LIMIT ?
		`)
		.bind(
			runId,
			runId,
			since,
			since,
			orderNumber,
			orderNumber,
			eventStatus,
			eventStatus,
			input.limit,
		)
		.all();

	const events = await db
		.prepare(`
			SELECT
				event_id,
				run_id,
				payment_key,
				registry_no,
				order_number,
				tracking_number,
				accepted_amount_cents,
				event_status,
				blockers_json,
				details_json,
				created_at
			FROM cfo_auto_paid_events
			WHERE (? IS NULL OR run_id = ?)
			  AND (? IS NULL OR created_at >= ?)
			  AND (? IS NULL OR order_number = ?)
			  AND (? IS NULL OR event_status = ?)
			ORDER BY event_id DESC
			LIMIT ?
		`)
		.bind(
			runId,
			runId,
			since,
			since,
			orderNumber,
			orderNumber,
			eventStatus,
			eventStatus,
			input.limit,
		)
		.all();

	const normalizedEvents = (events.results || []).map((row: any) => ({
		...row,
		amount_uah:
			row.accepted_amount_cents == null
				? null
				: row.accepted_amount_cents / 100,
		blockers: parseJson(row.blockers_json),
		details: parseJson(row.details_json),
		blockers_json: undefined,
		details_json: undefined,
	}));

	const statusCounts: Record<string, number> = {};
	for (const event of normalizedEvents as any[]) {
		const key = String(event.event_status || "UNKNOWN");
		statusCounts[key] = (statusCounts[key] || 0) + 1;
	}

	return {
		ok: true,
		filters: {
			run_id: runId,
			order: orderNumber,
			status: eventStatus,
			since,
			limit: input.limit,
		},
		summary: {
			runs: (runs.results || []).length,
			events: normalizedEvents.length,
			status_counts: statusCounts,
		},
		runs: runs.results || [],
		events: normalizedEvents,
	};
}

async function readReport(hours: number) {
	if (!currentEnv.PCC_CFO_DB) {
		throw new Error("PCC_CFO_DB is not configured");
	}

	const db = currentEnv.PCC_CFO_DB;
	const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

	const runsResult = await db
		.prepare(`
			SELECT
				run_id,
				trigger_source,
				mode,
				status,
				started_at,
				finished_at,
				candidates_found,
				novaposhta_confirmed,
				ready_for_shopify,
				marked_paid,
				verified_match_current,
				decisions_count,
				error_message
			FROM cfo_auto_paid_runs
			WHERE started_at >= ?
			ORDER BY started_at DESC
			LIMIT 100
		`)
		.bind(since)
		.all();

	const eventsResult = await db
		.prepare(`
			SELECT
				event_id,
				run_id,
				registry_no,
				order_number,
				tracking_number,
				accepted_amount_cents,
				event_status,
				blockers_json,
				details_json,
				created_at
			FROM cfo_auto_paid_events
			WHERE created_at >= ?
			ORDER BY event_id DESC
			LIMIT 500
		`)
		.bind(since)
		.all();

	const runs = (runsResult.results || []) as any[];
	const events = (eventsResult.results || []) as any[];

	function sum(field: string): number {
		return runs.reduce(
			(total, row) => total + Number(row?.[field] || 0),
			0,
		);
	}

	const verified = events
		.filter((row) => row.event_status === "VERIFIED")
		.map((row) => ({
			order: row.order_number,
			registry_no: row.registry_no,
			tracking_number: row.tracking_number,
			amount_uah:
				row.accepted_amount_cents == null
					? null
					: row.accepted_amount_cents / 100,
			created_at: row.created_at,
		}));

	const skipped = events
		.filter((row) => row.event_status === "SKIPPED")
		.map((row) => ({
			order: row.order_number,
			registry_no: row.registry_no,
			tracking_number: row.tracking_number,
			amount_uah:
				row.accepted_amount_cents == null
					? null
					: row.accepted_amount_cents / 100,
			blockers: parseJson(row.blockers_json),
			created_at: row.created_at,
		}));

	const eventErrors = events
		.filter((row) => row.event_status === "ERROR")
		.map((row) => ({
			run_id: row.run_id,
			order: row.order_number,
			details: parseJson(row.details_json),
			created_at: row.created_at,
		}));

	const failedRuns = runs
		.filter((row) => row.status === "FAILED")
		.map((row) => ({
			run_id: row.run_id,
			trigger_source: row.trigger_source,
			started_at: row.started_at,
			error_message: row.error_message,
		}));

	return {
		ok: true,
		window: {
			hours,
			since,
			generated_at: new Date().toISOString(),
		},
		summary: {
			runs: runs.length,
			scheduled_runs: runs.filter(
				(row) => row.trigger_source === "scheduled",
			).length,
			api_runs: runs.filter(
				(row) => row.trigger_source === "api",
			).length,
			succeeded_runs: runs.filter(
				(row) => row.status === "SUCCEEDED",
			).length,
			failed_runs: failedRuns.length,
			candidates_found: sum("candidates_found"),
			novaposhta_confirmed: sum("novaposhta_confirmed"),
			ready_for_shopify: sum("ready_for_shopify"),
			marked_paid: sum("marked_paid"),
			verified_match_current: sum("verified_match_current"),
			skipped_events: skipped.length,
			error_events: eventErrors.length,
		},
		verified_paid_orders: verified,
		skipped_orders: skipped,
		errors: {
			failed_runs: failedRuns,
			events: eventErrors,
		},
		runs,
	};
}

function createCfoReadServer() {
	const server = new McpServer({
		name: "PetsChoice CFO Read Connector",
		version: "1.0.0",
	});

	server.registerTool(
		"cfo_auto_paid_audit",
		{
			description:
				"Read-only history of PCC AI CFO automatic Shopify UA paid decisions. Does not change Shopify or D1.",
			inputSchema: z.object({
				limit: z.number().int().min(1).max(100).default(20),
				run_id: z.string().min(1).optional(),
				order: z.string().min(1).optional(),
				status: z.string().min(1).optional(),
				since: z.string().min(1).optional(),
			}),
		},
		async (input) => {
			try {
				return jsonText(await readAudit(input));
			} catch (error: any) {
				return jsonText(
					{ error: error?.message || String(error) },
					true,
				);
			}
		},
	);

	server.registerTool(
		"cfo_auto_paid_report",
		{
			description:
				"Read-only one-click operational report for PCC AI CFO automatic Shopify UA paid processing. Defaults to the last 24 hours.",
			inputSchema: z.object({
				hours: z.number().int().min(1).max(168).default(24),
			}),
		},
		async ({ hours }) => {
			try {
				return jsonText(await readReport(hours));
			} catch (error: any) {
				return jsonText(
					{ error: error?.message || String(error) },
					true,
				);
			}
		},
	);

	return server;
}

const cfoReadMcpHandler = createMcpHandler(createCfoReadServer);

export async function handleCfoReadRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response | null> {
	const url = new URL(request.url);

	if (url.pathname !== "/cfo-read-mcp") {
		return null;
	}

	currentEnv = env as CfoReadEnv;

	const rewritten = new URL(request.url);
	rewritten.pathname = "/mcp";

	return cfoReadMcpHandler(
		new Request(rewritten.toString(), request),
		env,
		ctx,
	);
}
