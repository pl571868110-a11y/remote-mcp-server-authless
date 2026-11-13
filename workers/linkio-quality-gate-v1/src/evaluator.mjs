// Pure deterministic quality checks. No network, storage, external API or mutations.
const normalize = value => value.normalize('NFKC').replace(/\s+/g, ' ').trim();
const countChars = value => [...value].length;

export function evaluate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('INVALID_INPUT');
  const { taskId, stage, text, policy } = input;
  if (typeof taskId !== 'string' || !/^[\w:-]{1,128}$/.test(taskId)) throw new TypeError('INVALID_TASK_ID');
  if (typeof stage !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(stage)) throw new TypeError('INVALID_STAGE');
  if (typeof text !== 'string' || text.length > 250000) throw new TypeError('INVALID_TEXT');
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new TypeError('INVALID_POLICY');
  const { maxChars, minChars = 0, requiredQuotes = [], sourceUrls = [], requireVerifiedSources = false } = policy;
  if (!Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > 100000) throw new TypeError('INVALID_CHAR_LIMIT');
  if (!Number.isSafeInteger(minChars) || minChars < 0 || minChars > maxChars) throw new TypeError('INVALID_MIN_LIMIT');
  if (!Array.isArray(requiredQuotes) || requiredQuotes.length > 20 || !requiredQuotes.every(q=>typeof q==='string' && q.length>0 && q.length<=500)) throw new TypeError('INVALID_QUOTES');
  if (!Array.isArray(sourceUrls) || sourceUrls.length > 20 || !sourceUrls.every(u=>typeof u==='string' && /^https:\/\/[^\s/]+\//.test(u))) throw new TypeError('INVALID_SOURCE_URLS');
  if (typeof requireVerifiedSources !== 'boolean') throw new TypeError('INVALID_SOURCE_POLICY');
  const len = countChars(text);
  const checks = [{ code:'MAX_CHARS', pass:len<=maxChars, actual:len, limit:maxChars }, {code:'MIN_CHARS', pass:len>=minChars, actual:len, limit:minChars}];
  const ntext = normalize(text);
  for (let i=0;i<requiredQuotes.length;i++) checks.push({code:'QUOTE_PRESENT_'+i,pass:ntext.includes(normalize(requiredQuotes[i]))});
  if (sourceUrls.length) checks.push({code:'SOURCE_URL_FORMAT',pass:true,count:sourceUrls.length});
  const failed = checks.filter(c=>!c.pass).map(c=>c.code);
  const unverifiable = requireVerifiedSources ? ['SOURCE_AUTHENTICITY_NOT_VERIFIED'] : [];
  const status = failed.length ? 'FAIL' : unverifiable.length ? 'UNVERIFIED' : 'PASS';
  return {schema:'linkio.quality-gate.v1',taskId,stage,status,checks,failed,unverifiable,readOnly:true,accepted:status==='PASS'};
}
