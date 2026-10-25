// Validation-only entry point. Upload with `wrangler versions upload`, never deploy this entry.
import { handleMetaReviewRequest } from "./meta-reviewer";

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const path = new URL(request.url).pathname;
		if (!["/internal/meta-review/health", "/internal/meta-review/dry-run"].includes(path)) {
			return new Response("Not found", { status: 404 });
		}
		return await handleMetaReviewRequest(request, {
			...env,
			META_REVIEW_ENABLED: "false",
			META_REVIEW_TELEGRAM_ENABLED: "false",
		}) ?? new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
