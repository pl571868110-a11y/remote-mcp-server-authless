import legacyWorker from "./index";
import { handleGoogleRequest } from "./google";
import { handleShopifyRequest } from "./shopify-pl";
import { handleShopifyUaRequest } from "./shopify-ua";

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const googleResponse = await handleGoogleRequest(request, env, ctx);
		if (googleResponse) return googleResponse;

		const shopifyResponse = await handleShopifyRequest(request, env, ctx);
		if (shopifyResponse) return shopifyResponse;

		const shopifyUaResponse = await handleShopifyUaRequest(request, env, ctx);
		if (shopifyUaResponse) return shopifyUaResponse;

		return legacyWorker.fetch(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
