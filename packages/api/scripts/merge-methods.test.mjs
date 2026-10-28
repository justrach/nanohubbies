import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({entryPoints:['review/merge-methods','review/merge-evidence','git','browse/objects'].map(n=>new URL('../src/'+n+'.ts',import.meta.url).pathname),bundle:true,platform:'node',format:'esm',write:false,outdir:'/virtual'});
const [{buildMerge},{reviewedMergeHead},{commit,encode},{parseCommit}]=await Promise.all(built.outputFiles.map(f=>import('data:text/javascript;base64,'+Buffer.from(f.text).toString('base64'))));
const owner={id:'codegraff:maintainer',name:'Maintainer'},author={id:'codegraff:author',name:'Author'},sha=c=>c.repeat(40),text=new TextEncoder();
function fixture(){
 const objects=new Map(),put=object=>{const split=object.raw.indexOf(0);objects.set(object.sha,{type:Buffer.from(object.raw.subarray(0,split)).toString().split(' ')[0],body:object.raw.slice(split+1)});return object.sha;},get=async sha=>objects.get(sha)??null;
 const source=(tree,parents,message='Change',time=1)=>put(commit({tree,parents,message,author:{name:'Original author',email:'author@example.invalid',time},committer:{name:'Original committer',email:'committer@example.invalid',time}}));
 const base=source(sha('1'),[],'Base'),first=source(sha('2'),[base],'First\n\nPreserved body\n\nSigned-off-by: Original author <author@example.invalid>'),head=source(sha('3'),[first],'Second');
 const make=extra=>buildMerge(get,{method:'merge',base,head,tree:sha('3'),owner,author,message:'Merge change',time:10,...extra});
 const info=object=>parseCommit(object.sha,object.raw.slice(object.raw.indexOf(0)+1));
 return {objects,put,get,source,base,first,head,make,info};
}
test('merge commits retain both parents and squash retains only target, preserving the reviewed tree',async()=>{
 const f=fixture();for(const method of ['merge','squash']){const made=await f.make({method});const info=f.info(made.objects[0]);assert.equal(info.tree,sha('3'));assert.deepEqual(info.parents,method==='merge'?[f.base,f.head]:[f.base]);assert.equal(info.author.name,method==='squash'?author.name:owner.name);assert.equal(info.committer.email,'codegraff-maintainer@nanohub.invalid');assert.equal(made.evidence.head,f.head);assert.equal(made.evidence.result,made.candidate.commit);assert.notEqual(made.candidate.commit,f.head);}
});
test('rebase rewrites every linear commit, preserves raw authors/messages/timezones and strips stale signatures',async()=>{
 const f=fixture(),raw=Buffer.from(`tree ${sha('4')}\nparent ${f.head}\nauthor Byte author <byte@example.invalid> 123 +0930\ncommitter Old <old@example.invalid> 124 -0700\nencoding ISO-8859-1\ngpgsig invalid-on-rewritten-commit\n continued signature\n\nRaw message: caf\xe9\n\nTrailer: exact\n`,'latin1');
 const head=f.put(encode('commit',raw)),made=await f.make({method:'rebase',head,tree:sha('4')});assert.equal(made.objects.length,3);assert.equal(made.evidence.rewritten.length,3);
 let parent=f.base;for(const object of made.objects){const info=f.info(object);assert.deepEqual(info.parents,[parent]);assert.equal(info.committer.name,owner.name);parent=object.sha;}
 const result=made.objects.at(-1).raw.slice(made.objects.at(-1).raw.indexOf(0)+1),string=Buffer.from(result).toString('latin1');assert.ok(string.includes('author Byte author <byte@example.invalid> 123 +0930\n'));assert.ok(string.includes('encoding ISO-8859-1\n'));assert.ok(!string.includes('gpgsig'));assert.deepEqual(result.slice(result.indexOf(10,result.indexOf(10)+1)).includes(0),false);assert.ok(string.endsWith('Raw message: caf\xe9\n\nTrailer: exact\n'));assert.equal(made.candidate.tree,sha('4'));
});
test('originally empty commits are dropped without losing later tree changes',async()=>{
 const f=fixture(),empty=f.source(sha('2'),[f.first],'Empty'),head=f.source(sha('3'),[empty],'After empty');const made=await f.make({method:'rebase',head});assert.equal(made.objects.length,2);assert.deepEqual(made.evidence.rewritten.map(r=>r.original),[f.first,head]);assert.equal(f.info(made.objects.at(-1)).tree,sha('3'));
});
test('automatic rebase refuses nonlinear history and all-empty histories rather than flattening silently',async()=>{
 const f=fixture(),fork=f.source(sha('4'),[f.base],'Fork'),head=f.source(sha('5'),[f.head,fork],'Join');await assert.rejects(f.make({method:'rebase',head,tree:sha('5')}),/linear feature history/);
 const empty=f.source(sha('1'),[f.base],'Empty');await assert.rejects(f.make({method:'rebase',head:empty,tree:sha('1')}),/No nonempty commits/);
});
test('stale/unrelated bases, wrong trees, missing history, invalid methods/messages and unsafe timestamps fail',async()=>{
 const f=fixture(),other=f.source(sha('4'),[],'Unrelated');
 for(const input of [{method:'unknown'},{base:other},{head:f.base,tree:sha('1')},{tree:sha('9')},{message:''},{message:'NUL\0'},{message:'x'.repeat(65537)},{time:-1},{time:1.5}])await assert.rejects(f.make(input));
 f.objects.delete(f.first);await assert.rejects(f.make(),/Missing|missing|history|commit/);
});
test('generated squash/rebase always create a new SHA even with identical identities and one-commit content',async()=>{
 const f=fixture(),person={name:owner.name,email:'codegraff-maintainer@nanohub.invalid',time:10},head=f.put(commit({tree:sha('2'),parents:[f.base],author:person,committer:person,message:'Same'}));
 for(const method of ['squash','rebase']){const made=await f.make({method,head,tree:sha('2'),author:owner,message:'Same'});assert.notEqual(made.candidate.commit,head);assert.equal(f.info(made.objects.at(-1)).tree,sha('2'));}
});
test('deployment identity bridge accepts only old/new-bound generated merge evidence',async()=>{
 const f=fixture(),made=await f.make({method:'squash'}),proof={old:f.base,next:made.candidate.commit,linear:true,merge:made.evidence};assert.equal(reviewedMergeHead(proof,f.base,made.candidate.commit),f.head);assert.equal(reviewedMergeHead(undefined,f.base,f.head),f.head);
 for(const merge of [{...made.evidence,version:2},{...made.evidence,base:f.head},{...made.evidence,head:made.candidate.commit},{...made.evidence,result:f.head},{...made.evidence,method:'unknown'}])assert.throws(()=>reviewedMergeHead({...proof,merge},f.base,made.candidate.commit),/Invalid generated/);
 assert.throws(()=>reviewedMergeHead({...proof,old:null},f.base,made.candidate.commit),/Invalid generated/);
});
