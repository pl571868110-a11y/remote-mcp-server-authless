import legacyWorker from "./index";
import { handleGoogleRequest } from "./google";
import { handleGoogleDiagnosticsRequest } from "./google-diagnostics";
import { handleShopifyRequest } from "./shopify-pl";
import { handleShopifyUaRequest } from "./shopify-ua";

function authorizeShopifyUaWrite(request: Request, env: Env): Response | null {
	if (new URL(request.url).pathname !== "/shopify-ua-write-mcp") return null;
	const configured = (env as Env & { PCC_MCP_WRITE_TOKEN?: string }).PCC_MCP_WRITE_TOKEN;
	if (!configured || typeof configured !== "string") {
		return new Response("Shopify UA write auth not configured", { status: 503, headers: { "Cache-Control": "no-store" } });
	}
	const header = request.headers.get("Authorization") || "";
	const supplied = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
	const encoder = new TextEncoder();
	const actual = encoder.encode(supplied);
	const expected = encoder.encode(configured);
	let diff = actual.length ^ expected.length;
	for (let i = 0; i < Math.max(actual.length, expected.length); i++) {
		diff |= (actual[i] || 0) ^ (expected[i] || 0);
	}
	if (!supplied || diff !== 0) {
		return new Response("Unauthorized", {
			status: 401,
			headers: { "Cache-Control": "no-store", "WWW-Authenticate": "Bearer" },
		});
	}
	return null;
}

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const writeAuthResponse = authorizeShopifyUaWrite(request, env);
		if (writeAuthResponse) return writeAuthResponse;

		const googleResponse = await handleGoogleRequest(request, env, ctx);
		if (googleResponse) return googleResponse;

		const googleDiagnosticsResponse = await handleGoogleDiagnosticsRequest(request, env, ctx);
		if (googleDiagnosticsResponse) return googleDiagnosticsResponse;

		const shopifyResponse = await handleShopifyRequest(request, env, ctx);
		if (shopifyResponse) return shopifyResponse;

		const shopifyUaResponse = await handleShopifyUaRequest(request, env, ctx);
		if (shopifyUaResponse) return shopifyUaResponse;

		return legacyWorker.fetch(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
