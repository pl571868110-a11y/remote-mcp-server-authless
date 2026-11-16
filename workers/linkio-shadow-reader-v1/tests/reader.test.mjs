import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeStoredText,buildQualityInput,formatQuality} from '../src/reader-core.mjs';
const id='9be19740-c766-41b8-a972-d4e66e675a1a';
const contract={format:'rules-json',count:2,maxWords:12};
const row=(stage,quality='failed')=>({
 task_id:id,final_result:JSON.stringify('short text'),
 hermes_result:stage==='completed'?JSON.stringify({result:'{"rules":[{"rule":"a","quote":"b","url":"https://example.com/a"},{"rule":"c","quote":"d","url":"https://example.com/b"}]}'}):null,
 hermes_state:stage,
 payload_json:JSON.stringify({state:quality,lengths:[{stage:'gpt_final',limit:2000}],contract:{citations:contract},issues:quality==='failed'?['CITATION_JSON_INVALID']:[],sources:[]})
});
test('decode stored string',()=>assert.equal(decodeStoredText(JSON.stringify('ok')),'ok'));
test('decode stored result wrapper',()=>assert.equal(decodeStoredText(JSON.stringify({result:'text'})),'text'));
test('does not invent missing artifact',()=>{const b=buildQualityInput(row('unknown'));assert.equal(b.input.policy.citationArtifact,null);assert.equal(b.hasCitationArtifact,false)});
test('passes exact existing citation contract',()=>{const b=buildQualityInput(row('completed'));assert.equal(b.input.policy.citationContract.format,'rules-json');assert.equal(b.hasCitationArtifact,true)});
test('preserves original server citation FAIL',()=>{const b=buildQualityInput(row('unknown'));assert.deepEqual(b.input.policy.upstreamQuality.issues,['CITATION_JSON_INVALID'])});
test('missing final result is unverified',()=>{const b=buildQualityInput({...row('completed'),final_result:null});assert.equal(b.error,'NO_VERIFIABLE_FINAL_TEXT_OR_LIMIT')});
test('passed length but failed citation stays FAIL',()=>{const x=formatQuality({taskId:id,reportedQuality:'failed',reportedIssues:['CITATION_JSON_INVALID'],hasCitationContract:true,hasCitationArtifact:false},{status:'FAIL',checks:[{code:'MAX_CHARS',pass:true}],failed:['UPSTREAM_QUALITY_FAILED','CITATION_JSON_INVALID'],unverifiable:['CITATION_ARTIFACT_UNAVAILABLE'],scope:'TEXT_LENGTH_AND_RULES_JSON_STRUCTURE_ONLY'});assert.equal(x.shadowQuality,'FAIL');assert.equal(x.citationCheck,'FAIL')});
test('citation unknown is not passed',()=>{const x=formatQuality({taskId:id,reportedQuality:'unverified',reportedIssues:[],hasCitationContract:true,hasCitationArtifact:false},{status:'UNVERIFIED',checks:[],failed:[],unverifiable:['CITATION_ARTIFACT_UNAVAILABLE'],scope:'TEXT_LENGTH_AND_RULES_JSON_STRUCTURE_ONLY'});assert.equal(x.citationCheck,'UNVERIFIED')});
