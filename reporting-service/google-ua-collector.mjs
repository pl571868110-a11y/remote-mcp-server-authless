import {loadUaCredentials} from './google-ua-token-store.mjs';
export const CUSTOMER='8073944491';
const API='https://googleads.googleapis.com/v25';
const SAFE=/^[A-Z][A-Z0-9_]{1,100}$/;
class Failure extends Error { constructor(code,http_status,request_id){super(code);this.code=code;this.http_status=http_status;this.request_id=request_id;} }
export function validateRange(since,until){
  const parse=s=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw new Failure('INVALID_DATE');const d=new Date(s+'T00:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==s)throw new Failure('INVALID_DATE');return d;};
  const a=parse(since),b=parse(until),days=(b-a)/86400000+1;
  if(days<1||days>93)throw new Failure('RANGE_MUST_BE_1_TO_93_DAYS');
}
function failure(error){return {code:error instanceof Failure?error.code:'GOOGLE_FETCH_FAILED',...(error.http_status?{http_status:error.http_status}:{}),...(error.request_id?{request_id:error.request_id}:{}),...(error.detail?{detail:error.detail}:{})};}
function number(value,nonnegative=false){const n=Number(value??0);if(!Number.isFinite(n)||(nonnegative&&n<0))throw new Failure('INVALID_METRIC');return n;}
async function jsonFetch(url,options,fetcher){
  const response=await fetcher(url,{...options,redirect:'manual',signal:AbortSignal.timeout(25000)});
  let data;try{data=await response.json();}catch{throw new Failure('NON_JSON_RESPONSE',response.status);}
  if(!response.ok){
    const detail=data.error?.details?.flatMap(x=>x.errors||[]).find(x=>x.errorCode);
    const codes=Object.values(detail?.errorCode||{}).filter(x=>typeof x==='string'&&SAFE.test(x));
    const code=codes[0]||(SAFE.test(data.error?.status||'')?data.error.status:'GOOGLE_HTTP_ERROR');
    const e=new Failure(code,response.status,response.headers.get('request-id')||undefined); e.detail={reason:data.error?.details?.find(x=>x.reason)?.reason||null,message:String(data.error?.message||'').replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g,'[redacted]').slice(0,500)}; throw e;
  }
  return data;
}
async function refresh(env,prefix,fetcher){
  const id=env[prefix+'CLIENT_ID'],secret=env[prefix+'CLIENT_SECRET'],refresh_token=env[prefix+'REFRESH_TOKEN'];
  if(!id||!secret||!refresh_token)throw new Failure('OAUTH_NOT_CONFIGURED');
  const r=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:id,client_secret:secret,refresh_token,grant_type:'refresh_token'}),redirect:'manual',signal:AbortSignal.timeout(20000)});
  let data;try{data=await r.json();}catch{throw new Failure('OAUTH_NON_JSON',r.status);}
  if(!r.ok||!data.access_token)throw new Failure(data.error==='invalid_grant'?'OAUTH_INVALID_GRANT':data.error==='invalid_client'?'OAUTH_INVALID_CLIENT':'OAUTH_REFRESH_FAILED',r.status);
  return data.access_token;
}
export async function search(token,env,customer,query,login,fetcher=fetch){
  if(!/^\d{10}$/.test(customer)||login&&!/^\d{10}$/.test(login))throw new Failure('INVALID_CUSTOMER_ID');
  const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  if(env.GOOGLE_ADS_DEVELOPER_TOKEN)headers['developer-token']=env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if(login)headers['login-customer-id']=login;
  let pageToken;const seen=new Set(),out=[];
  for(let page=0;page<100;page++){
    const data=await jsonFetch(`${API}/customers/${customer}/googleAds:search`,{method:'POST',headers,body:JSON.stringify({query,...pageToken?{pageToken}:{}})},fetcher);
    if(data.results!==undefined&&!Array.isArray(data.results))throw new Failure('INVALID_RESPONSE');
    out.push(...data.results||[]);
    if(!data.nextPageToken)return out;
    if(seen.has(data.nextPageToken))throw new Failure('REPEATED_PAGE_TOKEN');
    seen.add(data.nextPageToken);pageToken=data.nextPageToken;
  }
  throw new Failure('PAGE_LIMIT_EXCEEDED');
}
const identityQuery='SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer LIMIT 1';
export async function resolveGoogleUaIdentity(env,fetcher){
  const attempts=[];
  for(const prefix of ['GOOGLE_UA_ADS_','GOOGLE_UA_','GOOGLE_']){
    try{
      const token=await refresh(env,prefix,fetcher);let login;
      let rows;
      try{rows=await search(token,env,CUSTOMER,identityQuery,undefined,fetcher);}catch(e){
        if(!['USER_PERMISSION_DENIED','CUSTOMER_NOT_FOUND','NOT_ADS_USER','PERMISSION_DENIED'].includes(e.code))throw e;
        const headers={Authorization:'Bearer '+token};if(env.GOOGLE_ADS_DEVELOPER_TOKEN)headers['developer-token']=env.GOOGLE_ADS_DEVELOPER_TOKEN;
        const accessible=await jsonFetch(API+'/customers:listAccessibleCustomers',{headers},fetcher);
        const candidates=(accessible.resourceNames||[]).map(x=>x.match(/^customers\/(\d{10})$/)?.[1]).filter(Boolean).slice(0,20);
        for(const id of candidates){
          if(id===CUSTOMER)continue;
          const own=await search(token,env,id,identityQuery,undefined,fetcher);
          if(own[0]?.customer?.manager!==true)continue;
          const children=await search(token,env,id,`SELECT customer_client.id FROM customer_client WHERE customer_client.id = ${CUSTOMER}`,id,fetcher);
          if(children.some(x=>String(x.customerClient?.id)===CUSTOMER)){login=id;rows=await search(token,env,CUSTOMER,identityQuery,id,fetcher);break;}
        }
        if(!rows)throw e;
      }
      const account=rows[0]?.customer;
      if(rows.length!==1||String(account?.id)!==CUSTOMER||account.currencyCode!=='UAH'||account.manager===true)throw new Failure('ACCOUNT_IDENTITY_MISMATCH');
      return {token,prefix,login,account,attempts};
    }catch(e){attempts.push({credential_set:prefix,error:failure(e)});}
  }
  const e=new Failure('UA_SOURCE_UNAVAILABLE');e.attempts=attempts;throw e;
}
export function aggregate(costRows,purchaseRows,since,until){
  const days=new Map(),costSeen=new Set(),purchaseSeen=new Set();
  const get=date=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||date<since||date>until)throw new Failure('DATE_MISMATCH');if(!days.has(date))days.set(date,{date,cost_micros:0,purchases:0,revenue:0});return days.get(date);};
  for(const r of costRows){const date=r.segments?.date;if(costSeen.has(date))throw new Failure('DUPLICATE_COST_ROW');costSeen.add(date);const micros=number(r.metrics?.costMicros,true);if(!Number.isSafeInteger(micros))throw new Failure('INVALID_COST_MICROS');get(date).cost_micros+=micros;}
  for(const r of purchaseRows){if(r.segments?.conversionActionCategory!=='PURCHASE')throw new Failure('CONVERSION_CATEGORY_MISMATCH');const date=r.segments.date,key=date+':'+r.segments.conversionAction;if(purchaseSeen.has(key)||!/^customers\/8073944491\/conversionActions\/\d+$/.test(r.segments.conversionAction||''))throw new Failure('DUPLICATE_OR_INVALID_CONVERSION_ROW');purchaseSeen.add(key);const d=get(date);d.purchases+=number(r.metrics?.conversions);d.revenue+=number(r.metrics?.conversionsValue);}
  const derived=x=>({spend:x.cost_micros/1e6,purchases:x.purchases,revenue:x.revenue,cpa:x.purchases>0?x.cost_micros/1e6/x.purchases:null,roas:x.cost_micros>0?x.revenue/(x.cost_micros/1e6):null});
  const rows=[...days.values()].sort((a,b)=>a.date.localeCompare(b.date));const sum=rows.reduce((a,r)=>({cost_micros:a.cost_micros+r.cost_micros,purchases:a.purchases+r.purchases,revenue:a.revenue+r.revenue}),{cost_micros:0,purchases:0,revenue:0});
  return {days:rows.map(r=>({date:r.date,...derived(r)})),totals:derived(sum)};
}
export async function collectGoogleUa(env,since,until,fetcher=fetch){
  validateRange(since,until);
  const base={customer_id:CUSTOMER,country:'UA',currency:'UAH',since,until,source:'Google Ads API v25',methodology:{conversion_category:'PURCHASE',metric:'conversions',value:'conversions_value',date_basis:'ad_interaction_date',attribution:'account conversion action settings; fractional attributed credit preserved'}};
  try{
    env=await loadUaCredentials(env);
    const c=await resolveGoogleUaIdentity(env,fetcher),where=`segments.date BETWEEN '${since}' AND '${until}'`;
    const costs=await search(c.token,env,CUSTOMER,`SELECT segments.date, metrics.cost_micros FROM customer WHERE ${where}`,c.login,fetcher);
    const purchases=await search(c.token,env,CUSTOMER,`SELECT segments.date, segments.conversion_action, segments.conversion_action_category, metrics.conversions, metrics.conversions_value FROM customer WHERE ${where} AND segments.conversion_action_category = 'PURCHASE'`,c.login,fetcher);
    const actions=await search(c.token,env,CUSTOMER,"SELECT conversion_action.id, conversion_action.name, conversion_action.category, conversion_action.status, conversion_action.primary_for_goal, conversion_action.attribution_model_settings.attribution_model FROM conversion_action WHERE conversion_action.category = 'PURCHASE'",c.login,fetcher);
    return {...base,status:'VERIFIED',complete:true,error:null,credential_set:c.prefix,login_customer_id:c.login||null,account_name:c.account.descriptiveName,account_timezone:c.account.timeZone,conversion_actions:actions.map(r=>r.conversionAction),...aggregate(costs,purchases,since,until),fetched_at:new Date().toISOString()};
  }catch(e){return {...base,status:'UNAVAILABLE',complete:false,error:failure(e),attempts:e.attempts||[],days:[],totals:null,fetched_at:new Date().toISOString()};}
}

