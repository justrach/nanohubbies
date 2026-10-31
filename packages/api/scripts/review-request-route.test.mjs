import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const built=await build({entryPoints:[new URL('../src/review/request-route.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false});
const {reviewRequestRoute}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
function fixture(capabilities={protocol:1,revisionTracking:'storage',answerTracking:'storage-v2',readerFeedback:'v1'}){
 const calls=[],seq={requestedReviews:async()=>({...capabilities,revision:2,requests:[]}),editRequestedReviewsWithFeedback:async input=>{calls.push(input);return{...capabilities,revision:3,requests:[]};}},hub={team:async()=>null,repositoryArchive:async()=>({archived:false,transition:null})};
 const env={SEQUENCER:{idFromName:x=>x,get:()=>seq},HUB:{idFromName:x=>x,get:()=>hub}},user={id:'writer',name:'Writer',cli:{credentialId:'scoped-cli',scopes:['read','pulls:write']}},pull={number:1,state:'open',author:{id:'author'}},head={commit:'b'.repeat(40)};
 const body={reviewers:['reviewer'],revision:2,commit:head.commit,anchor:'a'.repeat(40)};
 const invoke=(method='GET',extra={})=>reviewRequestRoute(env,new Request('https://nanohub.invalid/api/trunks/fixture/pulls/1/requested-reviewers',{method,headers:{Origin:'https://nanohub.invalid','If-Match':'"review-requests-2"'},...(method==='GET'?{}:{body:JSON.stringify({...body,...extra})})}),'fixture',pull,head,user,true);
 return{seq,calls,invoke};
}
test('read and edit routes refuse older receivers without stored tracking before any mutation',async()=>{
 for(const capabilities of [{protocol:1},{protocol:1,revisionTracking:'storage'},{protocol:1,answerTracking:'storage-v2'},{protocol:1,revisionTracking:'storage',answerTracking:'storage-v2'},{protocol:2,revisionTracking:'storage',answerTracking:'storage-v2',readerFeedback:'v1'}])for(const method of ['GET','POST','DELETE']){const f=fixture(capabilities);const response=await f.invoke(method);assert.equal(response.status,503);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(f.calls.length,0);}
});
test('a compatible receiver receives only authenticated intent and exact observed identity',async()=>{
 const f=fixture();assert.equal((await f.invoke('POST')).status,200);assert.deepEqual(f.calls,[{number:1,operation:'request',reviewers:['reviewer'],revision:2,commit:'b'.repeat(40),anchor:'a'.repeat(40),actor:{id:'writer',name:'Writer'},origin:'https://nanohub.invalid',credentialId:'scoped-cli'}]);assert.equal((await f.invoke('POST',{answerTracking:'storage-v2',actor:'spoof'})).status,400);assert.equal(f.calls.length,1);
});
test('missing stored-tracking RPC never downgrades to a browser or legacy writer',async()=>{
 const f=fixture();f.seq.requestedReviews=async()=>{throw Error('The RPC receiver does not implement the method "requestedReviews".');};assert.equal((await f.invoke('POST')).status,503);assert.equal(f.calls.length,0);
});
