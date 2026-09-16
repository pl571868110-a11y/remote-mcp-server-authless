export {};

declare global {
	interface Env {
		ANTHROPIC_API_KEY?: string;
		MONOBANK_TOKEN?: string;
		NOVAPOSHTA_API_KEY?: string;
		NOVAPAY_REFRESH_TOKEN?: string;
		NOVAPAY_LOGIN?: string;
		NOVAPAY_PUBLIC_CERTIFICATE?: string;
		PRIVATBANK_TOKEN?: string;

		// Existing Shopify UA connector credentials.
		SHOPIFY_SHOP?: string;
		SHOPIFY_CLIENT_ID?: string;
		SHOPIFY_CLIENT_SECRET?: string;

		// Existing Google OAuth credentials, reused read-only for GA4 UA.
		GOOGLE_CLIENT_ID?: string;
		GOOGLE_CLIENT_SECRET?: string;
		GOOGLE_REFRESH_TOKEN?: string;
		GA4_UA_PROPERTY_ID?: string;

		// Meta Contractor Reviewer — read-only Meta Marketing API.
		META_ACCESS_TOKEN?: string;
		META_AD_ACCOUNT_ID?: string;
		META_GRAPH_API_VERSION?: string;

		// Reviewer control plane and Telegram output.
		META_REVIEW_INTERNAL_TOKEN?: string;
		TELEGRAM_BOT_TOKEN?: string;
		TELEGRAM_ALLOWED_CHAT_ID?: string;
		TELEGRAM_WEBHOOK_SECRET?: string;
		META_REVIEW_SEND_FINAL?: string;

		// Configurable alert thresholds.
		META_CPA_WARN_PCT?: string;
		META_CPA_CRITICAL_PCT?: string;
		META_ROAS_WARN_PCT?: string;
		META_ROAS_CRITICAL_PCT?: string;
		META_CTR_WARN_PCT?: string;
		META_FREQUENCY_WARN?: string;

		// Optional until the D1 database is created/bound in Wrangler.
		META_REVIEW_DB?: D1Database;
	}
}
