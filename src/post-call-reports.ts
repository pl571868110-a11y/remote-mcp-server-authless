export const REPORT_AGENT = "agent_3901m7df3appemrsy0h3cy8crhef";
export const REPORT_PATH = "/elevenlabs/post-call";
type ReportDB = { prepare(sql: string): { bind(...args: unknown[]): { run(): Promise<unknown> } } };
type ReportEnv = { REPORT_DB: ReportDB; ELEVENLABS_WEBHOOK_SECRET?: string };
function reply(body: unknown, status = 200) { return Response.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
export async function validSignature(raw: string, signature: string, secret: string, now = Date.now()) {
  const fields = signature.split(",").map(s => s.trim());
  const t = fields.find(s => s.startsWith("t="))?.slice(2);
  const hashes = fields.filter(s => s.startsWith("v0=")).map(s => s.slice(3));
  if (!t || !/^\d+$/.test(t) || Math.abs(now / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  for (const h of hashes) {
    if (!/^[0-9a-f]{64}$/i.test(h)) continue;
    const bytes = Uint8Array.from(h.match(/../g)!, x => parseInt(x, 16));
    if (await crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(t + "." + raw))) return true;
  }
  return false;
}
function short(value: unknown, n: number) {
  // Summaries are untrusted customer content, not automation instructions.
  return typeof value === "string" ? value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email скрыт]")
    .replace(/\+?\d[\d ()-]{7,}\d/g, match => "…" + match.replace(/\D/g, "").slice(-4))
    .slice(0, n) : "";
}
export function reportFromEvent(event: any) {
  const d = event?.data;
  if (event?.type !== "post_call_transcription" || d?.agent_id !== REPORT_AGENT) return null;
  if (!/^conv_[a-zA-Z0-9_-]{5,100}$/.test(d?.conversation_id || "")) return null;
  if (d.status !== "done" && d.status !== "failed") return null;
  const vars = d.conversation_initiation_client_data?.dynamic_variables || {};
  const caller = typeof vars.system__caller_id === "string" ? vars.system__caller_id : "";
  const telephone = !!(caller || d.metadata?.phone_call || vars.system__call_sid || vars.system__call_id);
  // Preview/chat sessions do not create customer-call notifications.
  if (!telephone) return null;
  return {
    id: d.conversation_id,
    started: Number.isFinite(d.metadata?.start_time_unix_secs) ? d.metadata.start_time_unix_secs : null,
    duration: Number.isFinite(d.metadata?.call_duration_secs) ? Math.max(0, d.metadata.call_duration_secs) : null,
    caller: caller ? "…" + caller.replace(/\D/g, "").slice(-4) : "не определён",
    summary: short(d.analysis?.transcript_summary, 3000) || "Резюме не сформировано; требуется просмотреть разговор.",
    outcome: ["success", "failure", "unknown"].includes(d.analysis?.call_successful) ? d.analysis.call_successful : "unknown",
    url: "https://elevenlabs.io/app/agents/agents/" + REPORT_AGENT + "/history/" + d.conversation_id + "?branchId=agtbrch_2301m7df3apqfnd8vyp2ps5cs633",
  };
}
export default {
  async fetch(request: Request, env: ReportEnv): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET") return reply({ service: "petschoice-call-reports", configured: !!env.ELEVENLABS_WEBHOOK_SECRET });
    if (path !== REPORT_PATH) return reply({ error: "not_found" }, 404);
    if (request.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
    if (!env.ELEVENLABS_WEBHOOK_SECRET || !env.REPORT_DB) return reply({ error: "not_configured" }, 503);
    try {
      if (Number(request.headers.get("Content-Length") || 0) > 2_000_000) return reply({ error: "too_large" }, 413);
      const raw = await request.text();
      if (raw.length > 2_000_000) return reply({ error: "too_large" }, 413);
      if (!await validSignature(raw, request.headers.get("ElevenLabs-Signature") || "", env.ELEVENLABS_WEBHOOK_SECRET)) return reply({ error: "invalid_signature" }, 401);
      const report = reportFromEvent(JSON.parse(raw));
      if (!report) return reply({ status: "ignored" });
      // Store only the short report, never raw transcript/audio/email/full phone.
      await env.REPORT_DB.prepare(`INSERT OR IGNORE INTO call_reports
        (conversation_id, started_at, duration_secs, caller_masked, summary, outcome, conversation_url, state, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
        .bind(report.id, report.started, report.duration, report.caller, report.summary, report.outcome, report.url, new Date().toISOString()).run();
      return reply({ status: "received" });
    } catch { return reply({ error: "temporary_failure" }, 503); }
  },
};
