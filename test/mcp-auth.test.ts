import test from "node:test";
import assert from "node:assert/strict";

import { authorizeMcpRequest, MCP_ROUTE_SCOPES } from "../src/mcp-auth.ts";

const LEGACY_READ = "test-legacy-read-token";
const WRITE_TOKEN = "test-write-token";
const CFO_TOKEN = "test-cfo-read-token";
const GOOGLE_PL_TOKEN = "test-google-pl-read-token";
const SHOPIFY_PL_TOKEN = "test-shopify-pl-read-token";

type TokenSet = {
	legacy?: string;
	write?: string;
	cfo?: string;
	googlePl?: string;
	shopifyPl?: string;
};

function env(tokens: TokenSet = {}): Env {
	return {
		PCC_MCP_READ_TOKEN: tokens.legacy ?? LEGACY_READ,
		PCC_MCP_WRITE_TOKEN: tokens.write ?? WRITE_TOKEN,
		PCC_CFO_READ_TOKEN: tokens.cfo ?? CFO_TOKEN,
		PCC_GOOGLE_PL_READ_TOKEN: tokens.googlePl ?? GOOGLE_PL_TOKEN,
		PCC_SHOPIFY_PL_READ_TOKEN: tokens.shopifyPl ?? SHOPIFY_PL_TOKEN,
	} as Env;
}

function req(path: string, token?: string): Request {
	const headers = new Headers();

	if (token !== undefined) {
		headers.set("Authorization", `Bearer ${token}`);
	}

	return new Request(`https://example.test${path}`, {
		method: "POST",
		headers,
	});
}

/** Маршрут → единственный credential, которым он должен открываться. */
const ROUTE_MATRIX: Array<{ path: string; token: string; scope: string }> = [
	{ path: "/mcp", token: LEGACY_READ, scope: "legacy-read" },
	{ path: "/shopify-ua-mcp", token: LEGACY_READ, scope: "legacy-read" },
	{ path: "/google-mcp", token: GOOGLE_PL_TOKEN, scope: "google-pl-read" },
	{
		path: "/google-diagnostics-mcp",
		token: GOOGLE_PL_TOKEN,
		scope: "google-pl-read",
	},
	{
		path: "/shopify-pl-mcp",
		token: SHOPIFY_PL_TOKEN,
		scope: "shopify-pl-read",
	},
	{ path: "/cfo-read-mcp", token: CFO_TOKEN, scope: "cfo-read" },
	{
		path: "/shopify-ua-write-mcp",
		token: WRITE_TOKEN,
		scope: "shopify-ua-write",
	},
];

const ALL_TOKENS: Array<[string, string]> = [
	["legacy READ", LEGACY_READ],
	["WRITE", WRITE_TOKEN],
	["CFO READ", CFO_TOKEN],
	["Google PL READ", GOOGLE_PL_TOKEN],
	["Shopify PL READ", SHOPIFY_PL_TOKEN],
];

function keyOf(scope: string): keyof TokenSet {
	switch (scope) {
		case "legacy-read":
			return "legacy";
		case "shopify-ua-write":
			return "write";
		case "cfo-read":
			return "cfo";
		case "google-pl-read":
			return "googlePl";
		case "shopify-pl-read":
			return "shopifyPl";
		default:
			throw new Error(`unknown scope ${scope}`);
	}
}

for (const { path, token, scope } of ROUTE_MATRIX) {
	test(`${path}: missing credential -> 401`, () => {
		const result = authorizeMcpRequest(req(path), env());
		assert.ok(result);
		assert.equal(result.status, 401);
	});

	test(`${path}: wrong credential -> 401`, () => {
		const result = authorizeMcpRequest(req(path, "definitely-wrong"), env());
		assert.ok(result);
		assert.equal(result.status, 401);
	});

	test(`${path}: dedicated credential -> allowed`, () => {
		const result = authorizeMcpRequest(req(path, token), env());
		assert.equal(result, null);
	});

	test(`${path}: its own secret missing -> 503 fail closed`, () => {
		const result = authorizeMcpRequest(
			req(path, token),
			env({ [keyOf(scope)]: "" } as TokenSet),
		);
		assert.ok(result);
		assert.equal(result.status, 503);
	});

	test(`${path}: scope mapping is declared`, () => {
		assert.equal(MCP_ROUTE_SCOPES[path], scope);
	});
}

// Cross-token rejection: ни один credential не открывает чужой контур.
for (const { path, token, scope } of ROUTE_MATRIX) {
	for (const [label, other] of ALL_TOKENS) {
		if (other === token) continue;
		test(`${path}: ${label} credential -> 401 (cross-contour)`, () => {
			const result = authorizeMcpRequest(req(path, other), env());
			assert.ok(result, `${label} must not authorize ${path} (${scope})`);
			assert.equal(result.status, 401);
		});
	}
}

// Ключевые границы из требований заказчика.
test("Google PL credential cannot read Shopify PL route", () => {
	const result = authorizeMcpRequest(req("/shopify-pl-mcp", GOOGLE_PL_TOKEN), env());
	assert.ok(result);
	assert.equal(result.status, 401);
});

test("Shopify PL credential cannot read Google route", () => {
	const result = authorizeMcpRequest(req("/google-mcp", SHOPIFY_PL_TOKEN), env());
	assert.ok(result);
	assert.equal(result.status, 401);
});

test("both PL credentials cannot use the legacy /mcp route", () => {
	for (const token of [GOOGLE_PL_TOKEN, SHOPIFY_PL_TOKEN]) {
		const result = authorizeMcpRequest(req("/mcp", token), env());
		assert.ok(result);
		assert.equal(result.status, 401);
	}
});

test("legacy READ credential cannot use the new PL routes", () => {
	for (const path of ["/google-mcp", "/google-diagnostics-mcp", "/shopify-pl-mcp"]) {
		const result = authorizeMcpRequest(req(path, LEGACY_READ), env());
		assert.ok(result);
		assert.equal(result.status, 401);
	}
});

test("both Google routes share one scope and one credential", () => {
	const result = authorizeMcpRequest(
		req("/google-diagnostics-mcp", GOOGLE_PL_TOKEN),
		env({ googlePl: GOOGLE_PL_TOKEN }),
	);
	assert.equal(result, null);
});

test("CFO credential cannot use any other route", () => {
	for (const path of [
		"/mcp",
		"/shopify-ua-mcp",
		"/google-mcp",
		"/google-diagnostics-mcp",
		"/shopify-pl-mcp",
		"/shopify-ua-write-mcp",
	]) {
		const result = authorizeMcpRequest(req(path, CFO_TOKEN), env());
		assert.ok(result);
		assert.equal(result.status, 401);
	}
});

test("WRITE credential cannot use read routes", () => {
	for (const path of [
		"/mcp",
		"/shopify-ua-mcp",
		"/google-mcp",
		"/google-diagnostics-mcp",
		"/shopify-pl-mcp",
	]) {
		const result = authorizeMcpRequest(req(path, WRITE_TOKEN), env());
		assert.ok(result);
		assert.equal(result.status, 401);
	}
});

test("READ credentials cannot use the write route", () => {
	for (const token of [LEGACY_READ, GOOGLE_PL_TOKEN, SHOPIFY_PL_TOKEN, CFO_TOKEN]) {
		const result = authorizeMcpRequest(req("/shopify-ua-write-mcp", token), env());
		assert.ok(result);
		assert.equal(result.status, 401);
	}
});

// Fail-closed при нарушении изоляции: один и тот же секрет в двух scope.
test("shared secret between Google PL and Shopify PL fails closed (503)", () => {
	const shared = "same-secret-for-two-contours";
	const broken = env({ googlePl: shared, shopifyPl: shared });
	for (const path of ["/google-mcp", "/shopify-pl-mcp"]) {
		const result = authorizeMcpRequest(req(path, shared), broken);
		assert.ok(result);
		assert.equal(result.status, 503);
	}
});

test("shared secret violation blocks every protected route (global fail closed)", () => {
	const shared = "same-secret-for-two-contours";
	const broken = env({ googlePl: shared, shopifyPl: shared });
	const result = authorizeMcpRequest(req("/mcp", LEGACY_READ), broken);
	assert.ok(result);
	assert.equal(result.status, 503);
});

test("legacy token reused as a PL secret is also a violation", () => {
	const broken = env({ shopifyPl: LEGACY_READ });
	const result = authorizeMcpRequest(req("/mcp", LEGACY_READ), broken);
	assert.ok(result);
	assert.equal(result.status, 503);
});

test("empty values do not count as a shared-secret violation", () => {
	const result = authorizeMcpRequest(
		req("/mcp", LEGACY_READ),
		env({ googlePl: "", shopifyPl: "" }),
	);
	assert.equal(result, null);
});

// Legacy-совместимость: пока новые секреты не заданы, /mcp и /shopify-ua-mcp
// продолжают работать старым токеном (у них собственный scope).
test("legacy routes keep working when the new PL secrets are unset", () => {
	const legacyOnly = {
		PCC_MCP_READ_TOKEN: LEGACY_READ,
		PCC_MCP_WRITE_TOKEN: WRITE_TOKEN,
		PCC_CFO_READ_TOKEN: CFO_TOKEN,
	} as Env;
	assert.equal(authorizeMcpRequest(req("/mcp", LEGACY_READ), legacyOnly), null);
	assert.equal(
		authorizeMcpRequest(req("/shopify-ua-mcp", LEGACY_READ), legacyOnly),
		null,
	);
});

test("PL routes fail closed with 503 when their secrets are not configured yet", () => {
	const legacyOnly = {
		PCC_MCP_READ_TOKEN: LEGACY_READ,
		PCC_MCP_WRITE_TOKEN: WRITE_TOKEN,
		PCC_CFO_READ_TOKEN: CFO_TOKEN,
	} as Env;
	for (const path of ["/google-mcp", "/google-diagnostics-mcp", "/shopify-pl-mcp"]) {
		const result = authorizeMcpRequest(req(path, LEGACY_READ), legacyOnly);
		assert.ok(result);
		assert.equal(result.status, 503);
	}
});

const unprotectedPaths = [
	"/oauth/google/start",
	"/oauth/google/callback",
	"/novapay/ingest",
	"/health",
];

for (const path of unprotectedPaths) {
	test(`${path}: MCP gate does not intercept`, () => {
		const result = authorizeMcpRequest(req(path), env());
		assert.equal(result, null);
	});
}

test("lookalike path does not accidentally match", () => {
	assert.equal(authorizeMcpRequest(req("/mcp-evil"), env()), null);
});

test("Basic auth is rejected", () => {
	const request = new Request("https://example.test/mcp", {
		headers: {
			Authorization: "Basic dGVzdDp0ZXN0",
		},
	});

	const result = authorizeMcpRequest(request, env());
	assert.ok(result);
	assert.equal(result.status, 401);
});

test("empty Bearer token is rejected", () => {
	const request = new Request("https://example.test/mcp", {
		headers: {
			Authorization: "Bearer ",
		},
	});

	const result = authorizeMcpRequest(request, env());
	assert.ok(result);
	assert.equal(result.status, 401);
});

test("401 responses never advertise the expected token", () => {
	const response = authorizeMcpRequest(req("/google-mcp", LEGACY_READ), env());
	assert.ok(response);
	assert.equal(response.headers.get("WWW-Authenticate"), "Bearer");
	assert.equal(response.headers.get("Cache-Control"), "no-store");
});
