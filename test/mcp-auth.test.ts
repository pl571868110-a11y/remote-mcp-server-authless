import test from "node:test";
import assert from "node:assert/strict";

import { authorizeMcpRequest } from "../src/mcp-auth.ts";

const TOKEN = "test-read-token-123";
const WRITE_TOKEN = "test-write-token-456";
const CFO_TOKEN = "test-cfo-read-token-789";

function env(readToken?: string, writeToken?: string, cfoToken?: string): Env {
        return {
                PCC_MCP_READ_TOKEN: readToken,
                PCC_MCP_WRITE_TOKEN: writeToken,
                PCC_CFO_READ_TOKEN: cfoToken,
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

const protectedPaths = [
        "/mcp",
        "/google-mcp",
        "/shopify-pl-mcp",
        "/shopify-ua-mcp",
];

for (const path of protectedPaths) {
        test(`${path}: missing credential -> 401`, () => {
                const result = authorizeMcpRequest(req(path), env(TOKEN));
                assert.ok(result);
                assert.equal(result.status, 401);
        });

        test(`${path}: wrong credential -> 401`, () => {
                const result = authorizeMcpRequest(
                        req(path, "definitely-wrong"),
                        env(TOKEN),
                );
                assert.ok(result);
                assert.equal(result.status, 401);
        });

        test(`${path}: correct credential -> allowed`, () => {
                const result = authorizeMcpRequest(
                        req(path, TOKEN),
                        env(TOKEN),
                );
                assert.equal(result, null);
        });

        test(`${path}: server secret missing -> 503 fail closed`, () => {
                const result = authorizeMcpRequest(req(path, TOKEN), env());
                assert.ok(result);
                assert.equal(result.status, 503);
        });
}

test("/cfo-read-mcp: missing credential -> 401", () => {
        const result = authorizeMcpRequest(req("/cfo-read-mcp"), env(TOKEN, WRITE_TOKEN, CFO_TOKEN));
        assert.ok(result);
        assert.equal(result.status, 401);
});

test("/cfo-read-mcp: wrong credential -> 401", () => {
        const result = authorizeMcpRequest(
                req("/cfo-read-mcp", "definitely-wrong"),
                env(TOKEN, WRITE_TOKEN, CFO_TOKEN),
        );
        assert.ok(result);
        assert.equal(result.status, 401);
});

test("/cfo-read-mcp: dedicated CFO credential -> allowed", () => {
        const result = authorizeMcpRequest(
                req("/cfo-read-mcp", CFO_TOKEN),
                env(TOKEN, WRITE_TOKEN, CFO_TOKEN),
        );
        assert.equal(result, null);
});

test("/cfo-read-mcp: general READ credential -> 401", () => {
        const result = authorizeMcpRequest(
                req("/cfo-read-mcp", TOKEN),
                env(TOKEN, WRITE_TOKEN, CFO_TOKEN),
        );
        assert.ok(result);
        assert.equal(result.status, 401);
});

test("/cfo-read-mcp: CFO secret missing -> 503 fail closed", () => {
        const result = authorizeMcpRequest(
                req("/cfo-read-mcp", CFO_TOKEN),
                env(TOKEN, WRITE_TOKEN),
        );
        assert.ok(result);
        assert.equal(result.status, 503);
});

const unprotectedPaths = [
        "/oauth/google/start",
        "/oauth/google/callback",
        "/novapay/ingest",
        "/health",
];

for (const path of unprotectedPaths) {
        test(`${path}: MCP gate does not intercept`, () => {
                const result = authorizeMcpRequest(req(path), env(TOKEN));
                assert.equal(result, null);
        });
}

test("lookalike path does not accidentally match", () => {
        assert.equal(
                authorizeMcpRequest(req("/mcp-evil"), env(TOKEN)),
                null,
        );
});

test("Basic auth is rejected", () => {
        const request = new Request("https://example.test/mcp", {
                headers: {
                        Authorization: "Basic dGVzdDp0ZXN0",
                },
        });

        const result = authorizeMcpRequest(request, env(TOKEN));
        assert.ok(result);
        assert.equal(result.status, 401);
});

test("empty Bearer token is rejected", () => {
        const request = new Request("https://example.test/mcp", {
                headers: {
                        Authorization: "Bearer ",
                },
        });

        const result = authorizeMcpRequest(request, env(TOKEN));
        assert.ok(result);
        assert.equal(result.status, 401);
});

test("/shopify-ua-write-mcp: missing credential -> 401", () => {
        const result = authorizeMcpRequest(
                req("/shopify-ua-write-mcp"),
                env(TOKEN, WRITE_TOKEN),
        );
        assert.ok(result);
        assert.equal(result.status, 401);
});

test("/shopify-ua-write-mcp: wrong credential -> 401", () => {
        const result = authorizeMcpRequest(
                req("/shopify-ua-write-mcp", "definitely-wrong"),
                env(TOKEN, WRITE_TOKEN),
        );
        assert.ok(result);
        assert.equal(result.status, 401);
});

test("/shopify-ua-write-mcp: WRITE credential -> allowed", () => {
        const result = authorizeMcpRequest(
                req("/shopify-ua-write-mcp", WRITE_TOKEN),
                env(TOKEN, WRITE_TOKEN),
        );
        assert.equal(result, null);
});

test("/shopify-ua-write-mcp: READ credential -> 401", () => {
        const result = authorizeMcpRequest(
                req("/shopify-ua-write-mcp", TOKEN),
                env(TOKEN, WRITE_TOKEN),
        );
        assert.ok(result);
        assert.equal(result.status, 401);
});

test("/shopify-ua-write-mcp: WRITE secret missing -> 503 fail closed", () => {
        const result = authorizeMcpRequest(
                req("/shopify-ua-write-mcp", WRITE_TOKEN),
                env(TOKEN),
        );
        assert.ok(result);
        assert.equal(result.status, 503);
});

test("/shopify-ua-mcp: WRITE credential cannot use READ route", () => {
        const result = authorizeMcpRequest(
                req("/shopify-ua-mcp", WRITE_TOKEN),
                env(TOKEN, WRITE_TOKEN),
        );
        assert.ok(result);
        assert.equal(result.status, 401);
});

test("/shopify-ua-mcp: READ credential remains allowed with WRITE secret present", () => {
        const result = authorizeMcpRequest(
                req("/shopify-ua-mcp", TOKEN),
                env(TOKEN, WRITE_TOKEN),
        );
        assert.equal(result, null);
});
