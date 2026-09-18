type AutoPaidMode = "dry_run" | "execute";
type AutoPaidTriggerSource = "api" | "scheduled";

type AutoPaidAuditEnv = Env & {
	PCC_CFO_DB?: D1Database;
	PCC_MCP_READ_TOKEN?: string;
};

type AutoPaidResult = {
	ok?: boolean;
	candidates_found?: number;
	novaposhta_confirmed?: number;
	ready_for_shopify?: number;
	marked_paid?: number;
	verified_match_current?: number;
	decisions?: Array<Record<string, unknown>>;
	[key: string]: unknown;
};

function isoNow(): string {
	return new Date().toISOString();
}

function safeJson(value: unknown, maxLength = 12000): string | null {
	try {
		const text = JSON.stringify(value);

		if (text.length <= maxLength) {
			return text;
		}

		return JSON.stringify({
			truncated: true,
			preview: text.slice(0, Math.max(0, maxLength - 64)),
		});
	} catch {
		return null;
	}
}

function errorMessage(error: unknown): string {
	const value =
		error instanceof Error ? error.message : String(error ?? "Unknown error");
	return value.slice(0, 2000);
}

function nullableString(value: unknown): string | null {
	if (value == null) return null;
	const text = String(value).trim();
	return text || null;
}

function integerCount(value: unknown): number {
	const n = Number(value ?? 0);
	return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

function eventStatement(
	db: D1Database,
	runId: string,
	decision: Record<string, unknown>,
	eventStatusOverride?: string,
): D1PreparedStatement {
	const order = nullableString(decision.order);
	const registryNo = nullableString(decision.registry_no);
	const eventStatus =
		eventStatusOverride || nullableString(decision.status) || "UNKNOWN";
	const blockers = Array.isArray(decision.blockers)
		? safeJson(decision.blockers)
		: null;
	const details = safeJson(decision);
	const createdAt = isoNow();

	return db
		.prepare(`
			INSERT INTO cfo_auto_paid_events (
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
			)
			VALUES (
				?,
				(
					SELECT payment_key
					FROM novapay_payments
					WHERE order_number = ?
					  AND (? IS NULL OR registry_no = ?)
					ORDER BY transfer_date DESC
					LIMIT 1
				),
				?,
				?,
				(
					SELECT en_np
					FROM novapay_payments
					WHERE order_number = ?
					  AND (? IS NULL OR registry_no = ?)
					ORDER BY transfer_date DESC
					LIMIT 1
				),
				(
					SELECT accepted_amount_cents
					FROM novapay_payments
					WHERE order_number = ?
					  AND (? IS NULL OR registry_no = ?)
					ORDER BY transfer_date DESC
					LIMIT 1
				),
				?,
				?,
				?,
				?
			)
		`)
		.bind(
			runId,
			order,
			registryNo,
			registryNo,
			registryNo,
			order,
			order,
			registryNo,
			registryNo,
			order,
			registryNo,
			registryNo,
			eventStatus,
			blockers,
			details,
			createdAt,
		);
}

export async function runAutoPaidWithAudit(
	env: Env,
	mode: AutoPaidMode,
	triggerSource: AutoPaidTriggerSource,
	runner: () => Promise<AutoPaidResult>,
): Promise<AutoPaidResult> {
	const e = env as AutoPaidAuditEnv;

	if (!e.PCC_CFO_DB) {
		throw new Error("PCC_CFO_DB is not configured");
	}

	const db = e.PCC_CFO_DB;
	const runId = crypto.randomUUID();
	const startedAt = isoNow();

	// Fail closed: automated writes must never start without a durable audit run.
	await db
		.prepare(`
			INSERT INTO cfo_auto_paid_runs (
				run_id,
				trigger_source,
				mode,
				status,
				started_at
			)
			VALUES (?, ?, ?, 'RUNNING', ?)
		`)
		.bind(runId, triggerSource, mode, startedAt)
		.run();

	try {
		const result = await runner();
		const decisions = Array.isArray(result?.decisions)
			? result.decisions
			: [];

		const statements: D1PreparedStatement[] = [];

		for (const decision of decisions) {
			statements.push(eventStatement(db, runId, decision));

			/*
			 * A successful run cannot return after a failed post-write verification:
			 * runAutoPaid throws in that case. Therefore, when all marked writes are
			 * reflected in verified_match_current, each MARKED_PAID decision is also
			 * safe to record as VERIFIED.
			 */
			if (
				decision.status === "MARKED_PAID" &&
				integerCount(result.marked_paid) > 0 &&
				integerCount(result.marked_paid) ===
					integerCount(result.verified_match_current)
			) {
				statements.push(
					eventStatement(
						db,
						runId,
						{
							...decision,
							verification: "PAID_MATCH_CURRENT_DELTA_ZERO",
						},
						"VERIFIED",
					),
				);
			}
		}

		statements.push(
			db
				.prepare(`
					UPDATE cfo_auto_paid_runs
					SET status = 'SUCCEEDED',
					    finished_at = ?,
					    candidates_found = ?,
					    novaposhta_confirmed = ?,
					    ready_for_shopify = ?,
					    marked_paid = ?,
					    verified_match_current = ?,
					    decisions_count = ?
					WHERE run_id = ?
				`)
				.bind(
					isoNow(),
					integerCount(result.candidates_found),
					integerCount(result.novaposhta_confirmed),
					integerCount(result.ready_for_shopify),
					integerCount(result.marked_paid),
					integerCount(result.verified_match_current),
					decisions.length,
					runId,
				),
		);

		await db.batch(statements);

		return {
			...result,
			audit_run_id: runId,
		};
	} catch (error) {
		const message = errorMessage(error);

		try {
			await db.batch([
				db
					.prepare(`
						INSERT INTO cfo_auto_paid_events (
							run_id,
							event_status,
							details_json,
							created_at
						)
						VALUES (?, 'ERROR', ?, ?)
					`)
					.bind(
						runId,
						safeJson({ error: message }),
						isoNow(),
					),
				db
					.prepare(`
						UPDATE cfo_auto_paid_runs
						SET status = 'FAILED',
						    finished_at = ?,
						    error_message = ?
						WHERE run_id = ?
					`)
					.bind(isoNow(), message, runId),
			]);
		} catch (auditError) {
			console.error("PCC CFO auto-paid audit failure", {
				run_id: runId,
				audit_error:
					auditError instanceof Error
						? auditError.message
						: String(auditError),
			});
		}

		throw error;
	}
}


function jsonResponse(data: unknown, status = 200): Response {
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

function parseStoredJson(value: unknown): unknown {
	if (value == null || value === "") return null;

	try {
		return JSON.parse(String(value));
	} catch {
		return String(value);
	}
}

function clampLimit(raw: string | null, fallback = 20): number {
	const n = Number(raw ?? fallback);

	if (!Number.isFinite(n)) return fallback;

	return Math.min(100, Math.max(1, Math.trunc(n)));
}

export async function handleAutoPaidAuditReadRequest(
	request: Request,
	env: Env,
): Promise<Response | null> {
	const url = new URL(request.url);

	if (url.pathname !== "/internal/auto-paid/audit") {
		return null;
	}

	if (request.method !== "GET") {
		return new Response("Method Not Allowed", {
			status: 405,
			headers: { Allow: "GET" },
		});
	}

	const e = env as AutoPaidAuditEnv;

	if (!e.PCC_CFO_DB) {
		return jsonResponse({ error: "PCC_CFO_DB is not configured" }, 503);
	}

	if (!e.PCC_MCP_READ_TOKEN) {
		return jsonResponse({ error: "PCC_MCP_READ_TOKEN is not configured" }, 503);
	}

	const supplied = bearerToken(request);

	if (!supplied || !constantTimeEqual(supplied, e.PCC_MCP_READ_TOKEN)) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}

	const limit = clampLimit(url.searchParams.get("limit"));
	const runId = nullableString(url.searchParams.get("run_id"));
	const orderNumber = nullableString(url.searchParams.get("order"));
	const eventStatus = nullableString(url.searchParams.get("status"));
	const since = nullableString(url.searchParams.get("since"));

	const runs = await e.PCC_CFO_DB.prepare(`
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
			limit,
		)
		.all();

	const events = await e.PCC_CFO_DB.prepare(`
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
			limit,
		)
		.all();

	const normalizedEvents = (events.results || []).map((row: any) => ({
		...row,
		blockers: parseStoredJson(row.blockers_json),
		details: parseStoredJson(row.details_json),
		blockers_json: undefined,
		details_json: undefined,
	}));

	return jsonResponse({
		ok: true,
		filters: {
			run_id: runId,
			order: orderNumber,
			status: eventStatus,
			since,
			limit,
		},
		runs: runs.results || [],
		events: normalizedEvents,
	});
}
