import { handleCfoReadRequest } from "./cfo-read";
import legacyWorker from "./index";
import { authorizeMcpRequest } from "./mcp-auth";
import { handleGoogleRequest } from "./google";
import { handleGoogleDiagnosticsRequest } from "./google-diagnostics";
import { handleShopifyRequest } from "./shopify-pl";
import { handleShopifyUaRequest } from "./shopify-ua";
import { handleNovaPayIngestRequest } from "./novapay-ingest";

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const authFailure = authorizeMcpRequest(request, env);
                if (authFailure) return authFailure;

                const cfoReadResponse = await handleCfoReadRequest(request, env, ctx);
		if (cfoReadResponse) return cfoReadResponse;

                const novaPayIngestResponse = await handleNovaPayIngestRequest(request, env, ctx);
		if (novaPayIngestResponse) return novaPayIngestResponse;

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
