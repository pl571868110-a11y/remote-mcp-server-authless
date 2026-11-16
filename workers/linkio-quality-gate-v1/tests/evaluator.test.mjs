import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate} from '../src/evaluator.mjs';
const base=(text='ok',policy={maxChars:10})=>({taskId:'task-1',stage:'gpt_final',text,policy});
const source='https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/';
const contract={format:'rules-json',count:2,maxWords:12};
const good=JSON.stringify({rules:[
{rule:'Algorithm can vary',quote:'What backoff algorithm to apply between each attempt',url:source},
{rule:'Workflow can sleep',quote:'You can set a Workflow to sleep as an explicit step',url:source}
]});
test('pass simple',()=>assert.equal(evaluate(base()).status,'PASS'));
test('fail above limit',()=>assert.deepEqual(evaluate(base('12345678901')).failed,['MAX_CHARS']));
test('fail min',()=>assert.deepEqual(evaluate(base('x',{maxChars:10,minChars:2})).failed,['MIN_CHARS']));
test('quote normalized',()=>assert.equal(evaluate(base('hello  world',{maxChars:50,requiredQuotes:['hello world']})).status,'PASS'));
test('missing quote',()=>assert.equal(evaluate(base('none',{maxChars:50,requiredQuotes:['different']})).status,'FAIL'));
test('unverifiable authenticity not PASS',()=>assert.equal(evaluate(base('text',{maxChars:50,sourceUrls:['https://example.com/x'],requireVerifiedSources:true})).status,'UNVERIFIED'));
test('reject empty policy',()=>assert.throws(()=>evaluate(base('hi',{})),/INVALID_CHAR_LIMIT/));
test('reject nontext',()=>assert.throws(()=>evaluate(base(null)),/INVALID_TEXT/));
test('reject bad source URLs',()=>assert.throws(()=>evaluate(base('text',{maxChars:50,sourceUrls:['http://example.com/x']})),/INVALID_SOURCE_URLS/));
test('correct unicode codepoints',()=>assert.equal(evaluate(base('🙂🙂',{maxChars:2})).checks[0].actual,2));
test('reject oversized content',()=>assert.throws(()=>evaluate(base('x'.repeat(250001))),/INVALID_TEXT/));
test('rules-json valid structure',()=>assert.equal(evaluate(base('done',{maxChars:100,citationContract:contract,citationArtifact:good,sourceUrls:[source]})).status,'PASS'));
test('rules-json rejects appended prose',()=>assert.ok(evaluate(base('done',{maxChars:100,citationContract:contract,citationArtifact:good+' trailing'})).failed.includes('CITATION_JSON_INVALID')));
test('rules-json missing is UNVERIFIED',()=>assert.equal(evaluate(base('done',{maxChars:100,citationContract:contract})).status,'UNVERIFIED'));
test('rules-json count mismatch',()=>assert.ok(evaluate(base('done',{maxChars:100,citationContract:contract,citationArtifact:JSON.stringify({rules:[{rule:'a',quote:'b',url:source}]})})).failed.includes('CITATION_COUNT')));
test('rules-json word cap',()=>assert.ok(evaluate(base('done',{maxChars:100,citationContract:{...contract,maxWords:2},citationArtifact:good})).failed.some(x=>x.startsWith('CITATION_MAX_WORDS_'))));
test('rules-json invalid URL',()=>assert.ok(evaluate(base('done',{maxChars:100,citationContract:contract,citationArtifact:good.replace('https://','http://')})).failed.some(x=>x.startsWith('CITATION_RULE_SHAPE_'))));
test('upstream failure blocks length pass',()=>{const r=evaluate(base('short',{maxChars:200,upstreamQuality:{state:'failed',issues:['CITATION_JSON_INVALID']}}));assert.equal(r.status,'FAIL');assert.ok(r.failed.includes('CITATION_JSON_INVALID'))});
test('upstream failed and missing artifact still blocks',()=>{const r=evaluate(base('short',{maxChars:200,citationContract:contract,upstreamQuality:{state:'failed',issues:['CITATION_JSON_INVALID']}}));assert.equal(r.status,'FAIL');assert.ok(r.unverifiable.includes('CITATION_ARTIFACT_UNAVAILABLE'))});
test('upstream unverified cannot be PASS',()=>assert.equal(evaluate(base('short',{maxChars:200,upstreamQuality:{state:'unverified',issues:[]}})).status,'UNVERIFIED'));
test('does not output citation artifact',()=>{const r=evaluate(base('private',{maxChars:200,citationContract:contract,citationArtifact:good}));assert.equal(JSON.stringify(r).includes('Algorithm can vary'),false)});
