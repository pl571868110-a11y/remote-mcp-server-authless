function constantTimeEqual(a: string, b: string): boolean {
	const enc = new TextEncoder();
	const aa = enc.encode(a);
	const bb = enc.encode(b);

	if (aa.length !== bb.length) return false;

	let diff = 0;
	for (let i = 0; i < aa.length; i++) {
		diff |= aa[i] ^ bb[i];
	}
	return diff === 0;
}

function bearerToken(request: Request): string {
	const auth = request.headers.get("Authorization") || "";
	if (!auth.startsWith("Bearer ")) return "";
	return auth.slice(7).trim();
}

/**
 * Каждый защищённый MCP-маршрут привязан ровно к одному credential scope.
 * Один токен НЕ должен авторизовывать маршрут другого контура — привязка
 * задаётся этой таблицей, а не общей проверкой "любой READ-токен".
 */
export type McpTokenScope =
	| "legacy-read"
	| "google-pl-read"
	| "shopify-pl-read"
	| "cfo-read"
	| "shopify-ua-write";

const ROUTE_SCOPES: Record<string, McpTokenScope> = {
	"/mcp": "legacy-read",
	"/shopify-ua-mcp": "legacy-read",
	"/google-mcp": "google-pl-read",
	"/google-diagnostics-mcp": "google-pl-read",
	"/shopify-pl-mcp": "shopify-pl-read",
	"/cfo-read-mcp": "cfo-read",
	"/shopify-ua-write-mcp": "shopify-ua-write",
};

const SCOPE_ENV_KEYS: Record<McpTokenScope, keyof Env & string> = {
	"legacy-read": "PCC_MCP_READ_TOKEN",
	"google-pl-read": "PCC_GOOGLE_PL_READ_TOKEN",
	"shopify-pl-read": "PCC_SHOPIFY_PL_READ_TOKEN",
	"cfo-read": "PCC_CFO_READ_TOKEN",
	"shopify-ua-write": "PCC_MCP_WRITE_TOKEN",
};

export const MCP_ROUTE_SCOPES: Readonly<Record<string, McpTokenScope>> = ROUTE_SCOPES;

function unauthorized(): Response {
	return new Response("Unauthorized", {
		status: 401,
		headers: {
			"Cache-Control": "no-store",
			"WWW-Authenticate": "Bearer",
		},
	});
}

function notConfigured(reason: string): Response {
	return new Response(reason, {
		status: 503,
		headers: { "Cache-Control": "no-store" },
	});
}

/**
 * Fail-closed проверка конфигурации: если два РАЗНЫХ scope настроены одним и
 * тем же значением секрета, изоляция контуров нарушена — отказываем всем
 * защищённым маршрутам, а не притворяемся, что границы существуют.
 */
function sharedSecretScopes(env: Env): string[] {
	const seen = new Map<string, McpTokenScope>();
	const conflicts: string[] = [];
	for (const scope of Object.keys(SCOPE_ENV_KEYS) as McpTokenScope[]) {
		const value = env[SCOPE_ENV_KEYS[scope] as keyof Env];
		if (typeof value !== "string" || value.length === 0) continue;
		const previous = seen.get(value);
		if (previous && previous !== scope) {
			conflicts.push(`${SCOPE_ENV_KEYS[previous]}=${SCOPE_ENV_KEYS[scope]}`);
			continue;
		}
		seen.set(value, scope);
	}
	return conflicts;
}

export function authorizeMcpRequest(
	request: Request,
	env: Env,
): Response | null {
	const url = new URL(request.url);
	const scope = ROUTE_SCOPES[url.pathname];
	if (!scope) return null;

	const conflicts = sharedSecretScopes(env);
	if (conflicts.length > 0) {
		return notConfigured(
			`MCP credential isolation violated: shared secret between ${conflicts.join(", ")}`,
		);
	}

	const expected = env[SCOPE_ENV_KEYS[scope] as keyof Env];
	if (!expected || typeof expected !== "string") {
		return notConfigured(
			`MCP authentication for ${url.pathname} is not configured`,
		);
	}

	const supplied = bearerToken(request);
	if (!supplied || !constantTimeEqual(supplied, expected)) {
		return unauthorized();
	}

	return null;
}
