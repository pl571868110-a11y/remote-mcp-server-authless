type WriteEnv = {
  PCC_MCP_WRITE_TOKEN?: string;
  PCC_MCP_READ_TOKEN?: string;
  PCC_SHOPIFY_UA_WRITE_ACCESS_AUD?: string;
  PCC_SHOPIFY_UA_WRITE_ACCESS_EMAILS?: string;
};
type AccessContext = {
  access?: { aud: string; getIdentity(): Promise<{ email?: string } | null> };
};

function equal(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const x = encoder.encode(a), y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

// ctx.access is supplied by workerd after Access validation, never by HTTP headers.
// Service bindings do not propagate it; CFO continues to require its write token.
export async function authorizeShopifyUaWrite(
  request: Request, env: WriteEnv, ctx: AccessContext,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== "/shopify-ua-write-mcp") return null;
  const headers = { "Cache-Control": "no-store", "WWW-Authenticate": "Bearer" };
  const configured = env.PCC_MCP_WRITE_TOKEN;
  if (!configured || configured === env.PCC_MCP_READ_TOKEN) {
    return new Response("Shopify UA write auth not configured", { status: 503, headers });
  }
  const auth = request.headers.get("Authorization") || "";
  const supplied = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  // A read credential can never be upgraded to write access, even with Access.
  if (supplied && env.PCC_MCP_READ_TOKEN && equal(supplied, env.PCC_MCP_READ_TOKEN)) {
    return new Response("Unauthorized", { status: 401, headers });
  }
  if (supplied && equal(supplied, configured)) return null;
  const aud = env.PCC_SHOPIFY_UA_WRITE_ACCESS_AUD?.trim();
  const emails = (env.PCC_SHOPIFY_UA_WRITE_ACCESS_EMAILS || "")
    .split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  if (aud && emails.length && ctx.access?.aud === aud) {
    try {
      const identity = await ctx.access.getIdentity();
      if (identity?.email && emails.includes(identity.email.toLowerCase())) return null;
    } catch {
      // Fail closed; do not return identity-service errors or credential material.
    }
  }
  return new Response("Unauthorized", { status: 401, headers });
}
