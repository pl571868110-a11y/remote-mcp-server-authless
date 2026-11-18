const enc=new TextEncoder();
export const AUTH_KEY='ua-ads:8073944491:v1';
const aad=enc.encode(AUTH_KEY);
const b64=x=>btoa(String.fromCharCode(...new Uint8Array(x)));
const bytes=x=>Uint8Array.from(atob(x),c=>c.charCodeAt(0));
async function key(env){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',enc.encode(AUTH_KEY+':'+env.GOOGLE_CLIENT_SECRET)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
export async function saveUaToken(env,token){
 if(!env.PCC_GOOGLE_UA_ADS_AUTH||typeof token!=='string'||token.length<16)throw Error('TOKEN_STORE_NOT_READY');
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},await key(env),enc.encode(token));
 await env.PCC_GOOGLE_UA_ADS_AUTH.put(AUTH_KEY,JSON.stringify({v:1,iv:b64(iv),data:b64(data),created_at:new Date().toISOString()}));
}
export async function loadUaCredentials(env){
 if(!env.PCC_GOOGLE_UA_ADS_AUTH)return env;
 const r=await env.PCC_GOOGLE_UA_ADS_AUTH.get(AUTH_KEY,{type:'json'});
 if(!r)return env;
 if(r.v!==1)throw Error('TOKEN_STORE_VERSION');
 const token=new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(r.iv),additionalData:aad},await key(env),bytes(r.data)));
 return {...env,GOOGLE_UA_ADS_CLIENT_ID:env.GOOGLE_CLIENT_ID,GOOGLE_UA_ADS_CLIENT_SECRET:env.GOOGLE_CLIENT_SECRET,GOOGLE_UA_ADS_REFRESH_TOKEN:token};
}

