import legacyWorker from "./index";
import { handleGoogleRequest } from "./google";

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const googleResponse = await handleGoogleRequest(request, env, ctx);
		if (googleResponse) return googleResponse;
		return legacyWorker.fetch(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
