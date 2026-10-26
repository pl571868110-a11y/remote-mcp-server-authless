import { z } from "zod";

type NovaPayIngestEnv = Env & {
	PCC_CFO_DB?: D1Database;
	NOVAPAY_INGEST_TOKEN?: string;
};

const amountSchema = z.union([z.number(), z.string()]);

const paymentSchema = z.object({
	row_no: z.union([z.number(), z.string()]).optional(),
	transfer_date: z.string().min(1),
	accepted_amount: amountSchema,
	fee_amount: amountSchema,
	transferred_amount: amountSchema,
	tariff: z.string().optional().default(""),
	en_np: z.union([z.string(), z.number()]).optional(),
	order_number: z.string().min(1),
	operation_id: z.union([z.string(), z.number()]).optional(),
	comfort_transfer: z.string().optional().default(""),
});

const ingestSchema = z.object({
	registry: z.object({
		registry_no: z.union([z.string(), z.number()]),
		registry_date: z.string().min(1),
		recipient_account: z.string().optional().default(""),
		payment_count: z.union([z.number(), z.string()]),
		accepted_amount: amountSchema,
		fee_amount: amountSchema,
		transferred_amount: amountSchema,
		source_filename: z.string().optional().default(""),
		file_sha256: z.string().regex(/^[a-f0-9]{64}$/i),
		gmail_message_id: z.string().optional().default(""),
		imported_at: z.string().optional(),
	}),
	payments: z.array(paymentSchema).min(1),
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

function normalizeDate(value: string): string {
	const s = value.trim();
	if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
	const m = s.match(/^(\d{2})[.\/-](\d{2})[.\/-](\d{4})$/);
	if (m) return `${m[3]}-${m[2]}-${m[1]}`;
	throw new Error(`Unsupported date format: ${value}`);
}

function cents(value: string | number): number {
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("Amount is not finite");
		return Math.round(value * 100);
	}
	const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
	if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) {
		throw new Error(`Invalid monetary amount: ${value}`);
	}
	const [whole, fraction = ""] = normalized.split(".");
	const sign = whole.startsWith("-") ? -1 : 1;
	const absWhole = whole.replace("-", "");
	return sign * (Number(absWhole) * 100 + Number((fraction + "00").slice(0, 2)));
}

function textId(value: string | number | undefined): string {
	return value == null ? "" : String(value).trim();
}

function paymentKey(registryNo: string, payment: z.infer<typeof paymentSchema>): string {
	const operationId = textId(payment.operation_id);
	const enNp = textId(payment.en_np);
	const row = textId(payment.row_no);
	return [registryNo, operationId || `row:${row}`, payment.order_number.trim(), enNp].join("|");
}

function timingSafeEnoughEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

export async function handleNovaPayIngestRequest(
	request: Request,
	env: Env,
	_ctx: ExecutionContext,
): Promise<Response | null> {
	const url = new URL(request.url);
	if (url.pathname !== "/internal/novapay/ingest") return null;

	const e = env as NovaPayIngestEnv;
	if (!e.PCC_CFO_DB) return json({ error: "PCC_CFO_DB is not configured" }, 503);
	if (!e.NOVAPAY_INGEST_TOKEN) return json({ error: "NOVAPAY_INGEST_TOKEN is not configured" }, 503);

	const supplied = bearerToken(request);
	if (!supplied || !timingSafeEnoughEqual(supplied, e.NOVAPAY_INGEST_TOKEN)) {
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

	const parsed = ingestSchema.safeParse(raw);
	if (!parsed.success) {
		return json({ error: "Invalid payload", details: parsed.error.flatten() }, 400);
	}

	try {
		const registryNo = String(parsed.data.registry.registry_no).trim();
		const registryDate = normalizeDate(parsed.data.registry.registry_date);
		const importedAt = parsed.data.registry.imported_at || new Date().toISOString();
		const paymentCount = Number(parsed.data.registry.payment_count);
		if (!Number.isInteger(paymentCount) || paymentCount < 1) throw new Error("payment_count must be a positive integer");
		if (paymentCount !== parsed.data.payments.length) {
			throw new Error(`payment_count=${paymentCount} but payments.length=${parsed.data.payments.length}`);
		}

		const accepted = cents(parsed.data.registry.accepted_amount);
		const fee = cents(parsed.data.registry.fee_amount);
		const transferred = cents(parsed.data.registry.transferred_amount);
		if (accepted - fee !== transferred) {
			throw new Error(`Registry totals mismatch: ${accepted} - ${fee} != ${transferred} cents`);
		}

		let rowsAccepted = 0;
		let rowsFee = 0;
		let rowsTransferred = 0;
		for (const payment of parsed.data.payments) {
			rowsAccepted += cents(payment.accepted_amount);
			rowsFee += cents(payment.fee_amount);
			rowsTransferred += cents(payment.transferred_amount);
		}
		if (rowsAccepted !== accepted || rowsFee !== fee || rowsTransferred !== transferred) {
			throw new Error("Payment rows do not match registry totals");
		}

		const existing = await e.PCC_CFO_DB.prepare(
			"SELECT registry_no FROM novapay_registries WHERE file_sha256 = ? LIMIT 1",
		)
			.bind(parsed.data.registry.file_sha256.toLowerCase())
			.first<{ registry_no: string }>();

		if (existing) {
			return json({
				ok: true,
				duplicate: true,
				registry_no: existing.registry_no,
				rows_received: parsed.data.payments.length,
				rows_written: 0,
			});
		}

		const statements: D1PreparedStatement[] = [];
		statements.push(
			e.PCC_CFO_DB.prepare(`
				INSERT INTO novapay_registries (
					registry_no, registry_date, recipient_account, payment_count,
					accepted_amount_cents, fee_amount_cents, transferred_amount_cents,
					source_filename, file_sha256, gmail_message_id, imported_at, source
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'gmail_xlsx')
				ON CONFLICT(registry_no) DO UPDATE SET
					registry_date=excluded.registry_date,
					recipient_account=excluded.recipient_account,
					payment_count=excluded.payment_count,
					accepted_amount_cents=excluded.accepted_amount_cents,
					fee_amount_cents=excluded.fee_amount_cents,
					transferred_amount_cents=excluded.transferred_amount_cents,
					source_filename=excluded.source_filename,
					file_sha256=excluded.file_sha256,
					gmail_message_id=excluded.gmail_message_id,
					imported_at=excluded.imported_at
			`)
				.bind(
					registryNo,
					registryDate,
					parsed.data.registry.recipient_account || null,
					paymentCount,
					accepted,
					fee,
					transferred,
					parsed.data.registry.source_filename || null,
					parsed.data.registry.file_sha256.toLowerCase(),
					parsed.data.registry.gmail_message_id || null,
					importedAt,
				),
		);

		for (const payment of parsed.data.payments) {
			const pAccepted = cents(payment.accepted_amount);
			const pFee = cents(payment.fee_amount);
			const pTransferred = cents(payment.transferred_amount);
			if (pAccepted - pFee !== pTransferred) {
				throw new Error(`Payment ${payment.order_number}: accepted - fee != transferred`);
			}
			const key = paymentKey(registryNo, payment);
			statements.push(
				e.PCC_CFO_DB.prepare(`
					INSERT INTO novapay_payments (
						payment_key, registry_no, row_no, transfer_date,
						accepted_amount_cents, fee_amount_cents, transferred_amount_cents,
						tariff, en_np, order_number, operation_id, comfort_transfer, created_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
					ON CONFLICT(payment_key) DO UPDATE SET
						transfer_date=excluded.transfer_date,
						accepted_amount_cents=excluded.accepted_amount_cents,
						fee_amount_cents=excluded.fee_amount_cents,
						transferred_amount_cents=excluded.transferred_amount_cents,
						tariff=excluded.tariff,
						en_np=excluded.en_np,
						order_number=excluded.order_number,
						operation_id=excluded.operation_id,
						comfort_transfer=excluded.comfort_transfer
				`)
					.bind(
						key,
						registryNo,
						payment.row_no == null ? null : Number(payment.row_no),
						normalizeDate(payment.transfer_date),
						pAccepted,
						pFee,
						pTransferred,
						payment.tariff || null,
						textId(payment.en_np) || null,
						payment.order_number.trim(),
						textId(payment.operation_id) || null,
						payment.comfort_transfer || null,
						importedAt,
					),
			);
		}

		await e.PCC_CFO_DB.batch(statements);
		return json({
			ok: true,
			duplicate: false,
			registry_no: registryNo,
			rows_received: parsed.data.payments.length,
			rows_written: parsed.data.payments.length,
		});
	} catch (error: any) {
		return json({ error: error?.message || String(error), rows_written: 0 }, 422);
	}
}
