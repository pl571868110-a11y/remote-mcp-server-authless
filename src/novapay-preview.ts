import { handleNovaPayIngestRequest } from "./novapay-ingest";
import {
	handleNovaPayReconcileRequest,
	reconcileNovaPayRegistry,
} from "./novapay-reconcile";

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const ingestResponse = await handleNovaPayIngestRequest(request, env, ctx);
		if (ingestResponse) {
			if (new URL(request.url).pathname === "/internal/novapay/ingest" && ingestResponse.ok) {
				try {
					const payload: any = await ingestResponse.clone().json();
					if (payload?.ok === true && payload?.registry_no) {
						ctx.waitUntil(
							reconcileNovaPayRegistry(env, String(payload.registry_no)).catch((error) => {
								console.error("NovaPay registry reconciliation failed", {
									registry_no: String(payload.registry_no),
									error: error?.message || String(error),
								});
							}),
						);
					}
				} catch (error: any) {
					console.error("Unable to queue NovaPay reconciliation", error?.message || String(error));
				}
			}
			return ingestResponse;
		}

		const reconcileResponse = await handleNovaPayReconcileRequest(request, env, ctx);
		if (reconcileResponse) return reconcileResponse;

		return new Response("Not Found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
