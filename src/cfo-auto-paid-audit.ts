type AutoPaidMode = "dry_run" | "execute";
type AutoPaidTriggerSource = "api" | "scheduled";

type AutoPaidAuditEnv = Env & {
	PCC_CFO_DB?: D1Database;
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
