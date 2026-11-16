# LINKIO Shadow Reader v1 — Additive Only

Private Cloudflare Worker (no workers.dev, preview or custom/public route). On-demand read-only RPC to Control Room D1 and the separate Shadow Audit worker. No cron, no resends, no mutations, no financial database or payment APIs. SQL is fixed and parameterized with bounded result counts.

Quality checks use the original stored `quality_checks` report as upstream evidence, preserve its reported failures, and independently validate length and `rules-json` citation artifact when stored. Missing HERMES results become `UNVERIFIED` — never presumed valid. The module does NOT establish authenticity of source quotes.

A D1 binding is technically capable of writing: **read-only is enforced by deployed code and review, not by a database-level permission.** Integration into the existing Control Room is intentionally absent.
