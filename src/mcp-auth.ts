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

const READ_MCP_PATHS = new Set([
        "/mcp",
        "/google-mcp",
        "/shopify-pl-mcp",
        "/shopify-ua-mcp",
        "/google-diagnostics-mcp",
]);

const CFO_READ_MCP_PATHS = new Set([
        "/cfo-read-mcp",
]);

const WRITE_MCP_PATHS = new Set([
        "/shopify-ua-write-mcp",
]);

export function authorizeMcpRequest(
        request: Request,
        env: Env,
): Response | null {
        const url = new URL(request.url);

        const isReadRoute = READ_MCP_PATHS.has(url.pathname);
        const isCfoReadRoute = CFO_READ_MCP_PATHS.has(url.pathname);
        const isWriteRoute = WRITE_MCP_PATHS.has(url.pathname);

        if (!isReadRoute && !isCfoReadRoute && !isWriteRoute) {
                return null;
        }

        const expected = isWriteRoute
                ? env.PCC_MCP_WRITE_TOKEN
                : isCfoReadRoute
                  ? env.PCC_CFO_READ_TOKEN
                  : env.PCC_MCP_READ_TOKEN;
        if (!expected) {
                return new Response("MCP authentication is not configured", {
                        status: 503,
                        headers: { "Cache-Control": "no-store" },
                });
        }

        const supplied = bearerToken(request);
        if (!supplied || !constantTimeEqual(supplied, expected)) {
                return new Response("Unauthorized", {
                        status: 401,
                        headers: {
                                "Cache-Control": "no-store",
                                "WWW-Authenticate": "Bearer",
                        },
                });
        }

        return null;
}
