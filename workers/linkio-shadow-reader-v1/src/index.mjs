import { WorkerEntrypoint } from 'cloudflare:workers';
import {decodeStoredText,validId,validLimit,buildQualityInput,formatQuality} from './reader-core.mjs';
const QUALITY_SQL = "SELECT e.task_id,e.observed_at,e.payload_json,f.result_json AS final_result,h.result_json AS hermes_result,h.state AS hermes_state FROM aicr_events e LEFT JOIN aicr_stage_runs f ON f.task_id=e.task_id AND f.stage='gpt_final' LEFT JOIN aicr_stage_runs h ON h.task_id=e.task_id AND h.stage='hermes_execution' WHERE e.event_kind='quality_checks' AND json_extract(e.payload_json,'$.phase')='final' ORDER BY e.observed_at DESC LIMIT ?";
const UNKNOWN_SQL = "SELECT t.id,t.idempotency_key,t.state,t.error_code,t.updated_at,(SELECT json_group_array(json_object('stage',s.stage,'state',s.state)) FROM aicr_stage_runs s WHERE s.task_id=t.id) AS stages FROM aicr_tasks t WHERE t.state='unknown' ORDER BY t.updated_at DESC LIMIT ?";

export class ShadowReader extends WorkerEntrypoint {
  async inspect(input={}) {
    if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('INVALID_INPUT');
    const maxQuality=input.maxQuality===undefined?10:input.maxQuality;
    const maxUnknown=input.maxUnknown===undefined?17:input.maxUnknown;
    if(!validLimit(maxQuality,30)||!validLimit(maxUnknown,25))throw new TypeError('INVALID_LIMIT');
    const [q,u]=await Promise.all([
      this.env.AUDIT_DB.prepare(QUALITY_SQL).bind(maxQuality).all(),
      this.env.AUDIT_DB.prepare(UNKNOWN_SQL).bind(maxUnknown).all()
    ]);
    const quality=await Promise.all((q.results||[]).map(async r=>{
      const built=buildQualityInput(r);
      if(!built.input)return {taskId:r.task_id,reportedQuality:'unverified',shadowQuality:'UNVERIFIED',citationCheck:'UNVERIFIED',reason:built.error,noMutation:true};
      try {
        const x=await this.env.SHADOW.assess({quality:built.input});
        return formatQuality({taskId:r.task_id,...built},x.quality);
      }catch {return {taskId:r.task_id,shadowQuality:'UNVERIFIED',citationCheck:'UNVERIFIED',reason:'SHADOW_RPC_FAILED',noMutation:true};}
    }));
    const recovery=await Promise.all((u.results||[]).map(async r=>{
      try {
        const stages=JSON.parse(r.stages||'[]');
        if(!Array.isArray(stages)||!validId(r.idempotency_key))throw new Error('INVALID_STAGES');
        const x=await this.env.SHADOW.assess({recovery:{taskId:r.id,idempotencyKey:r.idempotency_key,state:r.state,errorCode:r.error_code,stages,receipts:[]}});
        return {taskId:r.id,classification:x.recovery.classification,replayPermitted:false,receiptScope:'D1_ONLY_NOT_EXTERNAL_VERIFIED'};
      }catch{return {taskId:r.id,classification:'UNVERIFIED',replayPermitted:false,reason:'INVALID_STORED_EVIDENCE_OR_RPC'};}
    }));
    return {schema:'linkio.shadow-reader.v1',mode:'on_demand_only',source:'CONTROL_ROOM_D1',
      qualityCount:quality.length,recoveryCount:recovery.length,quality,recovery,
      noReplay:true,noTaskMutation:true,noFinancialWrites:true};
  }
}
export default {fetch(){return new Response('Not found',{status:404,headers:{'cache-control':'no-store'}})}};
