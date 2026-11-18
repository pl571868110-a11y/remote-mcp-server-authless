import http from "node:http";
import {readFileSync,statSync} from "node:fs";
import {authorized,verified} from "./policy.mjs";
import {collectGoogleUa} from "./google-ua-collector.mjs";
import {collectMeta} from "./meta-report.mjs";
const root=process.env.PCC_REPORT_ROOT||"/opt/data/petschoice-reporting";
function protectedRead(path){const s=statSync(path);if((s.mode&0o077)!==0||s.uid!==process.getuid())throw Error("PRIVATE_FILE_PERMISSIONS");return readFileSync(path,"utf8");}
const env=JSON.parse(protectedRead(root+"/credentials.json")),token=protectedRead(root+"/local-token").trim();
if(!/^[a-f0-9]{64}$/.test(token))throw Error("LOCAL_AUTH_INVALID");
const port=Number(process.env.PCC_REPORT_PORT||8766);
if(![8766,8767].includes(port))throw Error("INVALID_PORT");
const fetcher=(input,init={})=>fetch(input,{...init,signal:AbortSignal.timeout(60000),redirect:"manual"});
function dates(){const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Warsaw",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());const end=new Date(today+"T12:00:00Z");end.setUTCDate(end.getUTCDate()-1);const start=new Date(end);start.setUTCDate(start.getUTCDate()-1);return [start.toISOString().slice(0,10),end.toISOString().slice(0,10)];}
const server=http.createServer(async(req,res)=>{
 const send=(status,data)=>{res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(data));};
 if(!authorized(req.headers.authorization,token))return send(401,{error:"UNAUTHORIZED"});
 if(req.method!=="GET")return send(405,{error:"METHOD_NOT_ALLOWED"});
 const u=new URL(req.url,"http://127.0.0.1");
 try{
  if(u.pathname==="/health"){
   const [since,until]=dates();const [g,m]=await Promise.all([collectGoogleUa(env,since,until,fetcher),collectMeta(env,since,until,fetcher)]);
   const ok=verified(g,m,since,until);return send(ok?200:503,{ok,since,until,checked_at:new Date().toISOString(),sources:{google_ua:{status:g.status,complete:g.complete},meta:m.results.map(x=>({country:x.country,status:x.status,complete:x.complete}))}});
  }
  if(!["/google-ua-report","/meta-report"].includes(u.pathname))return send(404,{error:"NOT_FOUND"});
  const since=u.searchParams.get("since"),until=u.searchParams.get("until");
  const data=u.pathname==="/google-ua-report"?await collectGoogleUa(env,since,until,fetcher):await collectMeta(env,since,until,fetcher);
  return send(200,data);
 }catch{return send(503,{error:"SOURCE_UNAVAILABLE"});}
});
server.requestTimeout=180000;server.headersTimeout=10000;
server.listen(port,process.env.PCC_REPORT_BIND==="0.0.0.0"?"0.0.0.0":"127.0.0.1",()=>console.log(JSON.stringify({event:"REPORTING_LISTENING",port})));
for(const signal of ["SIGTERM","SIGINT"])process.on(signal,()=>server.close(()=>process.exit(0)));

