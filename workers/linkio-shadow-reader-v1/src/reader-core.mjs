// Pure helpers shared by Reader and isolated tests. No D1, network or side effects.
export function decodeStoredText(value) {
  if (typeof value!=='string') return null;
  try {
    const x=JSON.parse(value);
    if(typeof x==='string') return x;
    if(x&&typeof x==='object'&&typeof x.result==='string') return x.result;
    return null;
  } catch {return null;}
}
export function validId(v) {return typeof v==='string' && /^[A-Za-z0-9_:-]{1,128}$/.test(v);}
export function validLimit(v,max) {return Number.isSafeInteger(v)&&v>=1&&v<=max;}
export function buildQualityInput(row) {
  let report;try{report=JSON.parse(row.payload_json)}catch{return {error:'INVALID_STORED_QUALITY'};}
  if(!report || !validId(row.task_id))return {error:'INVALID_STORED_QUALITY'};
  const limits=Array.isArray(report.lengths)?report.lengths:[];
  const finalLimit=limits.find(x=>x.stage==='gpt_final'&&Number.isSafeInteger(x.limit));
  const text=decodeStoredText(row.final_result);
  if(!finalLimit || !validLimit(finalLimit.limit,100000)||text===null)return {error:'NO_VERIFIABLE_FINAL_TEXT_OR_LIMIT'};
  const citationContract=report.contract?.citations?.format==='rules-json'
    ? report.contract.citations : undefined;
  const citationArtifact=row.hermes_state==='completed'
    ? decodeStoredText(row.hermes_result) : null;
  const reportState=['passed','failed','unverified'].includes(report.state)?report.state:'unverified';
  const upstreamQuality={
    state:reportState,
    issues:Array.isArray(report.issues)
      ? report.issues.filter(x=>typeof x==='string' && /^[A-Z0-9_]{1,100}$/.test(x)).slice(0,40)
      :[]
  };
  const sourceUrls=Array.isArray(report.sources)
    ? report.sources.map(x=>x?.url).filter(x=>typeof x==='string').slice(0,20)
    :[];
  const policy={maxChars:finalLimit.limit,upstreamQuality,sourceUrls};
  if(citationContract) {policy.citationContract=citationContract;policy.citationArtifact=citationArtifact;}
  return {
    input:{taskId:row.task_id,stage:'gpt_final',text,policy},
    reportedQuality:reportState,reportedIssues:upstreamQuality.issues,
    hasCitationContract:!!citationContract,hasCitationArtifact:typeof citationArtifact==='string'
  };
}
export function formatQuality(row,gate) {
  return {
    taskId:row.taskId,reportedQuality:row.reportedQuality,reportedIssues:row.reportedIssues,
    shadowQuality:gate.status,
    independentLength:gate.checks.find(x=>x.code==='MAX_CHARS')?.pass??null,
    citationCheck:row.hasCitationContract
      ? (gate.failed.some(x=>x==='CITATION_JSON_INVALID'||x.startsWith('CITATION_'))?'FAIL':
         gate.unverifiable.includes('CITATION_ARTIFACT_UNAVAILABLE')?'UNVERIFIED':'STRUCTURE_PASS')
      :'NOT_REQUESTED',
    hasCitationArtifact:row.hasCitationArtifact,
    failed:gate.failed,unverifiable:gate.unverifiable,
    scope:gate.scope,noMutation:true
  };
}
