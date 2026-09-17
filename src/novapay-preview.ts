import { handleNovaPayIngestRequest } from "./novapay-ingest";

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const response = await handleNovaPayIngestRequest(request, env, ctx);
		if (response) return response;
		return new Response("Not Found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
