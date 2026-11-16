// Read-only deterministic checks. Never fetches source URLs or mutates task state.
const normalize = v => v.normalize('NFKC').replace(/\s+/g,' ').trim();
const countChars = v => [...v].length;
const isHttps = v => {
  if (typeof v!=='string') return false;
  try { const u = new URL(v); return u.protocol==='https:' && !!u.hostname && !u.username && !u.password; }
  catch { return false; }
};
const nonempty = v => typeof v==='string' && v.trim().length>0;
const wordCount = v => normalize(v).split(/\s+/).filter(Boolean).length;
function addCitationChecks({contract,artifact,sourceUrls,checks,unverifiable}) {
  if (contract === undefined) return;
  if (!contract || typeof contract!=='object' || Array.isArray(contract) ||
      contract.format!=='rules-json' || !Number.isSafeInteger(contract.count) ||
      contract.count<1 || contract.count>20 || !Number.isSafeInteger(contract.maxWords) ||
      contract.maxWords<1 || contract.maxWords>300) throw new TypeError('INVALID_CITATION_CONTRACT');
  if (artifact===null || artifact===undefined) {
    unverifiable.push('CITATION_ARTIFACT_UNAVAILABLE');
    return;
  }
  if (typeof artifact!=='string' || artifact.length>120000) throw new TypeError('INVALID_CITATION_ARTIFACT');
  let parsed;
  try {parsed=JSON.parse(artifact);} catch {checks.push({code:'CITATION_JSON_INVALID',pass:false});return;}
  if (!parsed || typeof parsed!=='object' || Array.isArray(parsed) || !Array.isArray(parsed.rules)) {
    checks.push({code:'CITATION_JSON_INVALID',pass:false});return;
  }
  checks.push({code:'CITATION_COUNT',pass:parsed.rules.length===contract.count,actual:parsed.rules.length,limit:contract.count});
  for (let i=0; i<parsed.rules.length && i<20; i++) {
    const rule=parsed.rules[i];
    const shape=rule && typeof rule==='object' && !Array.isArray(rule) &&
      nonempty(rule.rule) && nonempty(rule.quote) && isHttps(rule.url);
    checks.push({code:'CITATION_RULE_SHAPE_'+i,pass:!!shape});
    if (!shape) continue;
    checks.push({code:'CITATION_MAX_WORDS_'+i,pass:wordCount(rule.quote)<=contract.maxWords,actual:wordCount(rule.quote),limit:contract.maxWords});
    if (sourceUrls.length) checks.push({code:'CITATION_SOURCE_URL_'+i,pass:sourceUrls.includes(rule.url)});
  }
  // Quote occurrence in raw retrieved source is out of scope; do not claim it.
}
export function evaluate(input) {
  if (!input || typeof input!=='object' || Array.isArray(input)) throw new TypeError('INVALID_INPUT');
  const {taskId,stage,text,policy} = input;
  if(typeof taskId!=='string' || !/^[\w:-]{1,128}$/.test(taskId)) throw new TypeError('INVALID_TASK_ID');
  if(typeof stage!=='string' || !/^[a-z][a-z0-9_]{0,63}$/.test(stage)) throw new TypeError('INVALID_STAGE');
  if(typeof text!=='string' || text.length>250000) throw new TypeError('INVALID_TEXT');
  if(!policy || typeof policy!=='object' || Array.isArray(policy)) throw new TypeError('INVALID_POLICY');
  const {maxChars,minChars=0,requiredQuotes=[],sourceUrls=[],requireVerifiedSources=false,
    citationContract,citationArtifact=null,upstreamQuality} = policy;
  if(!Number.isSafeInteger(maxChars) || maxChars<1 || maxChars>100000) throw new TypeError('INVALID_CHAR_LIMIT');
  if(!Number.isSafeInteger(minChars) || minChars<0 || minChars>maxChars) throw new TypeError('INVALID_MIN_LIMIT');
  if(!Array.isArray(requiredQuotes)||requiredQuotes.length>20||!requiredQuotes.every(q=>nonempty(q)&&q.length<=500))throw new TypeError('INVALID_QUOTES');
  if(!Array.isArray(sourceUrls)||sourceUrls.length>20||!sourceUrls.every(isHttps))throw new TypeError('INVALID_SOURCE_URLS');
  if(typeof requireVerifiedSources!=='boolean')throw new TypeError('INVALID_SOURCE_POLICY');
  if(upstreamQuality!==undefined && (!upstreamQuality || typeof upstreamQuality!=='object' ||
      !['passed','failed','unverified'].includes(upstreamQuality.state) ||
      !Array.isArray(upstreamQuality.issues) || upstreamQuality.issues.length>40 ||
      !upstreamQuality.issues.every(x=>typeof x==='string' && /^[A-Z0-9_]{1,100}$/.test(x))))
      throw new TypeError('INVALID_UPSTREAM_QUALITY');
  const len=countChars(text);
  const checks=[
    {code:'MAX_CHARS',pass:len<=maxChars,actual:len,limit:maxChars},
    {code:'MIN_CHARS',pass:len>=minChars,actual:len,limit:minChars}
  ];
  const norm=normalize(text);
  for(let i=0;i<requiredQuotes.length;i++)
    checks.push({code:'QUOTE_PRESENT_'+i,pass:norm.includes(normalize(requiredQuotes[i]))});
  if(sourceUrls.length) checks.push({code:'SOURCE_URL_FORMAT',pass:true,count:sourceUrls.length});
  const unverifiable=requireVerifiedSources?['SOURCE_AUTHENTICITY_NOT_VERIFIED']:[];
  addCitationChecks({contract:citationContract,artifact:citationArtifact,sourceUrls,checks,unverifiable});
  const failed=checks.filter(x=>!x.pass).map(x=>x.code);
  if(upstreamQuality?.state==='failed'){
    failed.push('UPSTREAM_QUALITY_FAILED');
    for(const issue of upstreamQuality.issues) if(!failed.includes(issue))failed.push(issue);
  }
  if(upstreamQuality?.state==='unverified')unverifiable.push('UPSTREAM_QUALITY_UNVERIFIED');
  const status=failed.length?'FAIL':unverifiable.length?'UNVERIFIED':'PASS';
  return {schema:'linkio.quality-gate.v1',taskId,stage,status,checks,failed,unverifiable,
    scope:'TEXT_LENGTH_AND_RULES_JSON_STRUCTURE_ONLY',readOnly:true,accepted:status==='PASS'};
}
