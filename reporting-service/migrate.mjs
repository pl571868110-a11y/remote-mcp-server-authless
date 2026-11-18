import{readFileSync,writeFileSync,existsSync,statSync}from"node:fs";
import{webcrypto}from"node:crypto";
const root=process.env.PCC_REPORT_ROOT||"/opt/data/petschoice-reporting";
try{
 if(existsSync(root+"/credentials.json")){console.log("CREDENTIALS_ALREADY_PRESENT");process.exit(0);}
 const envelope=JSON.parse(readFileSync(root+"/migration-envelope.json","utf8"));
 if(envelope.v!==1||envelope.expires<Date.now())throw Error("EXPIRED");
 if((statSync(root+"/migration-private.der").mode&0o077)!==0)throw Error("PERMISSIONS");
 const s=webcrypto.subtle;
 const privateKey=await s.importKey("pkcs8",readFileSync(root+"/migration-private.der"),{name:"ECDH",namedCurve:"P-256"},false,["deriveKey"]);
 const pub=await s.importKey("spki",Buffer.from(envelope.public_key,"base64"),{name:"ECDH",namedCurve:"P-256"},false,[]);
 const key=await s.deriveKey({name:"ECDH",public:pub},privateKey,{name:"AES-GCM",length:256},false,["decrypt"]);
 const plain=await s.decrypt({name:"AES-GCM",iv:Buffer.from(envelope.iv,"base64"),additionalData:new TextEncoder().encode("petschoice-reporting-migration:v1")},key,Buffer.from(envelope.data,"base64"));
 const data=JSON.parse(new TextDecoder().decode(plain));
 if(data.purpose!=="petschoice-reporting-migration:v1"||data.expires!==envelope.expires)throw Error("CONTEXT");
 for(const k of ["GOOGLE_UA_ADS_CLIENT_ID","GOOGLE_UA_ADS_CLIENT_SECRET","GOOGLE_UA_ADS_REFRESH_TOKEN","META_ACCESS_TOKEN"])if(typeof data.credentials[k]!=="string"||!data.credentials[k])throw Error("MISSING");
 writeFileSync(root+"/credentials.json",JSON.stringify(data.credentials),{mode:0o600,flag:"wx"});
 console.log("CREDENTIALS_MIGRATED_ENCRYPTED_NO_VALUES_LOGGED");
}catch{console.error("MIGRATION_FAILED");process.exitCode=1;}

