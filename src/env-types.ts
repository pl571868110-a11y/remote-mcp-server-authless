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
	}
}
