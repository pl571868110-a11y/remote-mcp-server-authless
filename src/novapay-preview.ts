import { handleNovaPayIngestRequest } from "./novapay-ingest";
import { handleNovaPayReconcileRequest } from "./novapay-reconcile";

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const ingestResponse = await handleNovaPayIngestRequest(request, env, ctx);
		if (ingestResponse) return ingestResponse;

		const reconcileResponse = await handleNovaPayReconcileRequest(request, env, ctx);
		if (reconcileResponse) return reconcileResponse;

		return new Response("Not Found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
