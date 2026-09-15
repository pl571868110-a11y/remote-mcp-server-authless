import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

const GA4_PROPERTY_ID = "463531572";

type GoogleDiagEnv = Env & {
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
	GOOGLE_REFRESH_TOKEN?: string;
};

let currentEnv: GoogleDiagEnv;

function jsonText(data: unknown, isError = false) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
		...(isError ? { isError: true } : {}),
	};
}

async function getAccessToken(): Promise<string> {
	if (!currentEnv.GOOGLE_CLIENT_ID || !currentEnv.GOOGLE_CLIENT_SECRET) {
		throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured");
	}
	if (!currentEnv.GOOGLE_REFRESH_TOKEN) {
		throw new Error("GOOGLE_REFRESH_TOKEN is not configured");
	}
	const body = new URLSearchParams({
		client_id: currentEnv.GOOGLE_CLIENT_ID,
		client_secret: currentEnv.GOOGLE_CLIENT_SECRET,
		refresh_token: currentEnv.GOOGLE_REFRESH_TOKEN,
		grant_type: "refresh_token",
	});
	const res = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
	});
	const data = (await res.json()) as any;
	if (!res.ok || !data.access_token) {
		throw new Error(`Google token refresh failed (${res.status}): ${JSON.stringify(data)}`);
	}
	return String(data.access_token);
}

async function ga4RunReport(body: Record<string, unknown>) {
	const token = await getAccessToken();
	const res = await fetch(
		`https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runReport`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		},
	);
	const raw = await res.text();
	let data: any;
	try {
		data = raw ? JSON.parse(raw) : {};
	} catch {
		throw new Error(`GA4 Data API ${res.status} returned non-JSON: ${raw.slice(0, 500)}`);
	}
	if (!res.ok) throw new Error(`GA4 Data API ${res.status}: ${JSON.stringify(data)}`);
	return data;
}

function createGoogleDiagnosticsServer() {
	const server = new McpServer({
		name: "PetsChoice Google Diagnostics",
		version: "1.0.0",
	});

	server.registerTool(
		"ga4_event_timeline",
		{
			description: "Read-only GA4 ecommerce event timeline by minute for begin_checkout, add_payment_info and purchase, including transaction ID when present.",
			inputSchema: z.object({
				date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
			}),
		},
		async ({ date }) => {
			try {
				const data = await ga4RunReport({
					dateRanges: [{ startDate: date, endDate: date }],
					dimensions: [
						{ name: "dateHourMinute" },
						{ name: "eventName" },
						{ name: "transactionId" },
					],
					metrics: [
						{ name: "eventCount" },
						{ name: "transactions" },
						{ name: "purchaseRevenue" },
					],
					dimensionFilter: {
						filter: {
							fieldName: "eventName",
							inListFilter: {
								values: ["begin_checkout", "add_payment_info", "purchase"],
								caseSensitive: true,
							},
						},
					},
					orderBys: [
						{ dimension: { dimensionName: "dateHourMinute" } },
						{ dimension: { dimensionName: "eventName" } },
					],
					limit: "1000",
				});
				return jsonText({ property_id: GA4_PROPERTY_ID, date, data });
			} catch (error: any) {
				return jsonText({ error: error?.message || String(error) }, true);
			}
		},
	);

	return server;
}

const handler = createMcpHandler(createGoogleDiagnosticsServer);

export async function handleGoogleDiagnosticsRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response | null> {
	currentEnv = env as GoogleDiagEnv;
	const url = new URL(request.url);
	if (url.pathname !== "/google-diagnostics-mcp") return null;
	const rewritten = new URL(request.url);
	rewritten.pathname = "/mcp";
	return handler(new Request(rewritten.toString(), request), env, ctx);
}
