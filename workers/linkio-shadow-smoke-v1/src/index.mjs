import {WorkflowEntrypoint} from 'cloudflare:workers';
export class SmokeWorkflow extends WorkflowEntrypoint {
  async run(event,step) {
    return step.do('shadow-audit-readonly',async()=>{
      let payload=event?.payload||{};
      if(typeof payload==='string') {try{payload=JSON.parse(payload)}catch{throw new TypeError('INVALID_WORKFLOW_PAYLOAD')}}
      if(!payload||typeof payload!=='object'||Array.isArray(payload)) throw new TypeError('INVALID_WORKFLOW_PAYLOAD');
      const maxQuality=Number.isSafeInteger(payload.maxQuality)?payload.maxQuality:25;
      const maxUnknown=Number.isSafeInteger(payload.maxUnknown)?payload.maxUnknown:17;
      const audit=await this.env.READER.inspect({maxQuality,maxUnknown});
      if(audit.noReplay!==true||audit.noTaskMutation!==true||audit.noFinancialWrites!==true)throw new Error('SAFETY_CONTRACT_FAILED');
      if(audit.recovery.some(x=>x.replayPermitted!==false))throw new Error('REPLAY_GUARD_FAILED');
      return {
        schema:'linkio.shadow.smoke.v2',mode:'SHADOW_ONLY',
        qualityCount:audit.qualityCount,recoveryCount:audit.recoveryCount,
        quality:audit.quality.map(x=>({
          taskId:x.taskId,
          original:x.reportedQuality,
          shadow:x.shadowQuality,
          lengthPass:x.independentLength??null,
          citationCheck:x.citationCheck,
          citationArtifactAvailable:x.hasCitationArtifact??false,
          issues:x.reportedIssues||[],
          failed:x.failed||[],
          unverifiable:x.unverifiable||[],
          reason:x.reason||null
        })),
        recovery:audit.recovery.map(x=>({taskId:x.taskId,classification:x.classification,replayPermitted:false})),
        noReplay:true,noTaskMutation:true,noFinancialWrites:true
      };
    });
  }
}
export default {fetch(){return new Response('Not found',{status:404,headers:{'cache-control':'no-store'}})}};
