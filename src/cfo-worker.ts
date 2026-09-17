import { handleNovaPayIngestRequest } from "./novapay-ingest";
import { handleNovaPayReconcileRequest } from "./novapay-reconcile";
import { handleNovaPayRegistryReconcileRequest } from "./novapay-reconcile-registry";

function health(env: Env) {
	const e = env as Env & {
		PCC_CFO_DB?: D1Database;
		SHOPIFY_UA_SERVICE?: Fetcher;
		NOVAPAY_INGEST_TOKEN?: string;
	};

	return new Response(
		JSON.stringify(
			{
				ok: true,
				service: "pcc-ai-cfo-ua",
				version: "1.0.0",
				bindings: {
					d1: Boolean(e.PCC_CFO_DB),
					shopify_service: Boolean(e.SHOPIFY_UA_SERVICE),
					novapay_ingest_secret: Boolean(e.NOVAPAY_INGEST_TOKEN),
				},
			},
			null,
			2,
		),
		{
			status: 200,
			headers: { "Content-Type": "application/json; charset=utf-8" },
		},
	);
}

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/health" && request.method === "GET") {
			return health(env);
		}

		const ingestResponse = await handleNovaPayIngestRequest(request, env, ctx);
		if (ingestResponse) return ingestResponse;

		const registryReconcileResponse = await handleNovaPayRegistryReconcileRequest(request, env, ctx);
		if (registryReconcileResponse) return registryReconcileResponse;

		const reconcileResponse = await handleNovaPayReconcileRequest(request, env, ctx);
		if (reconcileResponse) return reconcileResponse;

		return new Response("Not Found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
