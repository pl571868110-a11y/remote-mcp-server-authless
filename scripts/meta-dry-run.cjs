require('./register-ts.cjs');
const { metaAccountSummary, metaAccountContext } = require('../src/meta-ads.ts');
const { buildMetaReview, validReviewRange } = require('../src/meta-reviewer.ts');

async function main() {
  const full = process.argv.includes('--full');
  const args = process.argv.slice(2).filter(arg => arg !== '--full');
  const [start = '2026-09-07', end = '2026-09-13'] = args;
  if (args.length > 2 || !validReviewRange(start, end)) throw new Error('Usage: npm run meta:dry-run -- [--full] [YYYY-MM-DD YYYY-MM-DD]');
  if (!process.env.META_ACCESS_TOKEN) throw new Error('META_ACCESS_TOKEN is not configured. Set it locally; never paste it into chat or commit it.');
  // No D1 binding and no runReview/sendTelegram calls: API reads only.
  const env = { ...process.env, META_REVIEW_ENABLED: 'false', META_REVIEW_TELEGRAM_ENABLED: 'false' };
  const review = full ? await buildMetaReview(env, start, end, 'on_demand') : null;
  const metaContext = review?.metaContext || await metaAccountContext(env);
  const meta = review?.meta || await metaAccountSummary(env, start, end);
  const reference = { spend: 21891.78, purchases: 35, purchaseValue: 46717.70, roas: 2.134 };
  const comparison = start === '2026-09-07' && end === '2026-09-13'
    ? Object.fromEntries(Object.entries(reference).map(([key, expected]) => [key, {
        actual: meta[key], expected, deltaPct: meta[key] == null ? null : (meta[key] - expected) / expected * 100,
        withinTolerance: meta[key] != null && Math.abs(meta[key] - expected) <= (key === 'purchases' ? 0 : Math.abs(expected) * 0.01),
      }])) : null;
  console.log(JSON.stringify({ mode: full ? 'full' : 'meta-only', start, end, persisted: false, telegramSent: false, metaContext, meta, comparison, ...(review ? { review } : {}) }, null, 2));
  if (comparison && Object.values(comparison).some(item => !item.withinTolerance)) {
    console.error('Reference mismatch: inspect attribution settings, date range and currency before any production deployment.');
    process.exitCode = 2;
  }
}
main().catch(() => {
  // Upstream exceptions can contain secrets. Keep diagnostics safe by default.
  console.error(process.env.META_ACCESS_TOKEN ? 'Dry-run failed: check API access and credentials. No report was saved or sent.' : 'META_ACCESS_TOKEN is not configured. Add it to ignored .dev.vars and rerun.');
  process.exitCode = 1;
});
