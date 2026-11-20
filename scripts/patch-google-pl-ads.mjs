import {createHash} from 'node:crypto';
export const BASE_VERSION='b66ec207-1454-410e-adb7-c703a68fb03a';
export const BASE_WORKER_SHA='e95d64cd94b133376fadd7d37dd6d75565bca71c17be1a3bd1d7fb03344273de';
export const tokenHelper=`async function getPolandAdsAccessToken() {
  const env = currentEnv2;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_PL_REFRESH_TOKEN) {
    throw new Error("GOOGLE_PL_ADS_CREDENTIALS_NOT_CONFIGURED");
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: env.GOOGLE_PL_REFRESH_TOKEN, grant_type: "refresh_token"})
  });
  let data;
  try { data = await response.json(); } catch { throw new Error("GOOGLE_PL_ADS_OAUTH_INVALID_RESPONSE"); }
  if (!response.ok || typeof data.access_token !== "string" || !data.access_token) {
    throw new Error("GOOGLE_PL_ADS_OAUTH_FAILED_HTTP_" + response.status);
  }
  return data.access_token;
}
`;
const anchor='async function googleAdsSearch(query, market = "PL") {\n  const { customerId, loginCustomerId } = googleAdsAccount(market);\n  const token = await getAccessToken(market);';
export function patchWorker(source) {
  if(createHash('sha256').update(source).digest('hex')!==BASE_WORKER_SHA)throw Error('GOOGLE_PL_PATCH_BLOCKED: baseline checksum mismatch');
  if(source.split(anchor).length!==2)throw Error('GOOGLE_PL_PATCH_BLOCKED: anchor count mismatch');
  return source.replace(anchor,tokenHelper+'async function googleAdsSearch(query, market = "PL") {\n  const { customerId, loginCustomerId } = googleAdsAccount(market);\n  if (market === "PL" && customerId !== "1582377809") throw new Error("IDENTITY_MISMATCH: Google Ads Poland customer");\n  const token = market === "PL" ? await getPolandAdsAccessToken() : await getAccessToken(market);');
}
