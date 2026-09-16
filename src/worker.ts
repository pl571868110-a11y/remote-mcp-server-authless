import legacyWorker from "./index";
import { handleGoogleRequest } from "./google";
import { handleGoogleDiagnosticsRequest } from "./google-diagnostics";
import { handleShopifyRequest } from "./shopify-pl";
import { handleShopifyUaRequest } from "./shopify-ua";
import { handleMetaReviewRequest, handleMetaReviewScheduled } from "./meta-reviewer";

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const metaReviewResponse = await handleMetaReviewRequest(request, env);
		if (metaReviewResponse) return metaReviewResponse;

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

	async scheduled(
		controller: ScheduledController,
		env: Env,
		ctx: ExecutionContext,
	): Promise<void> {
		await handleMetaReviewScheduled(controller, env, ctx);
	},
} satisfies ExportedHandler<Env>;
