import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
const output=await build({entryPoints:['review/pending','review/store','repository/store','repository/policy'].map(n=>new URL(`../src/${n}.ts`,import.meta.url).pathname),bundle:true,platform:'node',format:'esm',write:false,outdir:'/virtual'});
const [{PendingReviews},{ReviewStore},{Repository},{Policies}]=await Promise.all(output.outputFiles.map(o=>import('data:text/javascript;base64,'+Buffer.from(o.text).toString('base64'))));
const sha=c=>c.repeat(40),actor={id:'writer',origin:'http://localhost'},author={id:'writer',name:'Writer'};
function fixture(){
 const db=new DatabaseSync(':memory:'),sql={exec(q,...a){const rows=db.prepare(q).all(...a);return {toArray:()=>rows};}};
 sql.exec('CREATE TABLE versions(version INTEGER PRIMARY KEY,commit_sha TEXT,tree_sha TEXT)');
 const repo=new Repository(sql);repo.initialize();repo.update('refs/heads/main',null,{commit:sha('a'),tree:sha('1')},false,'author');repo.update('refs/heads/feature',null,{commit:sha('b'),tree:sha('2')},true,'author');
 const reviews=new ReviewStore(sql,()=>repo.main(),true),run=c=>reviews.run(c,()=>{throw Error('Unexpected landing');}),state=()=>reviews.snapshot(),branch=name=>state().branches.find(b=>b.name===name);
 run({op:'open',title:'Batch review',body:'',head:branch('feature'),base:branch('main'),anchor:sha('a'),anchorTree:sha('1'),author:{id:'author',name:'Author'}});
 const store=new PendingReviews(sql),pull=()=>state().pulls[0],head=()=>branch('feature'),get=(person=actor)=>store.run({op:'get',number:1,actor:person},pull(),head()).pending;
 const comment=(id='pending-comment-1')=>({id,pull:1,author,commit:head().commit,anchor:pull().anchor,path:'code.ts',side:'RIGHT',startLine:2,line:3,body:'Guard empty input',at:1,excerpt:'Original code',replyTo:null,resolved:false});
 const add=(id='pending-comment-1',extra={})=>store.run({op:'add',number:1,actor,author,reviewId:'pending-review-1',revision:get()?.revision??0,commit:head().commit,anchor:pull().anchor,comment:comment(id),...extra},pull(),head());
 const command=()=>({number:1,actor,reviewId:'pending-review-1',revision:get().revision,commit:head().commit,anchor:pull().anchor,verdict:'REQUEST_CHANGES',body:'Please address these issues'});
 const publish=draft=>run({op:'review',number:1,author:draft.author,commit:head().commit,anchor:pull().anchor,verdict:'REQUEST_CHANGES',body:'Please address these issues',independent:true,batch:{id:draft.id,comments:draft.comments.map(c=>c.id)}}).reviews.at(-1);
 const submit=(c=command())=>{db.exec('BEGIN');try{const result=store.submit(c,pull(),head(),publish);db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
 return {db,sql,repo,store,reviews,state,run,branch,pull,head,get,add,comment,command,publish,submit};
}
test('pending feedback stays private, does not affect gates and is isolated by immutable account and PR',()=>{
 const f=fixture();try{
  f.add();assert.equal(f.get().comments.length,1);assert.equal(f.get({id:'other',origin:actor.origin}),null);
  assert.equal(f.store.run({op:'get',number:2,actor},{...f.pull(),number:2},f.head()).pending,null);
  assert.ok(!JSON.stringify(f.state()).includes('Guard empty input'));assert.equal(f.state().reviews.length,0);assert.equal(f.sql.exec('SELECT * FROM pull_comments').toArray().length,0);
  const policy=new Policies(f.sql);policy.set({branch:'main',pullRequest:true,approvals:0,checks:[],beforeOpen:[],preventForce:true,preventDelete:true,requireConversationResolution:true});assert.equal(policy.reviewGate(f.pull(),[],f.head().commit).ready,true);
  assert.throws(()=>f.add('another-id',{actor:{...actor,id:'other'}}),/Invalid pending comment/);
 }finally{f.db.close();}
});
test('draft revision prevents lost updates; comment retries cannot duplicate or change existing feedback',()=>{
 const f=fixture();try{
  f.add();assert.equal(f.add('pending-comment-1',{revision:0}).pending.revision,1);
  assert.throws(()=>f.add('pending-comment-2',{revision:0}),/changed/);
  assert.throws(()=>f.add('pending-comment-1',{comment:{...f.comment(),body:'Different'}}),/already used/);
  f.store.run({op:'edit',number:1,actor,reviewId:'pending-review-1',revision:1,commentId:'pending-comment-1',body:'Updated private feedback'},f.pull(),f.head());
  assert.throws(()=>f.store.run({op:'remove',number:1,actor,reviewId:'pending-review-1',revision:1,commentId:'pending-comment-1'},f.pull(),f.head()),/changed/);
  assert.equal(f.get().comments[0].body,'Updated private feedback');
 }finally{f.db.close();}
});
test('publishes verdict and all threads atomically, associates review IDs and retries exactly once even after head moves',()=>{
 const f=fixture();try{
  f.add();f.add('pending-comment-2');const c=f.command(),saved=f.submit(c);
  assert.equal(f.get(),null);assert.equal(f.state().reviews.length,1);assert.deepEqual(f.state().reviews[0].commentIds,['pending-comment-1','pending-comment-2']);
  const rows=f.sql.exec('SELECT data FROM pull_comments').toArray().map(r=>JSON.parse(r.data));assert.equal(rows.length,2);assert.ok(rows.every(r=>r.reviewId===saved.reviewId));
  f.repo.update('refs/heads/feature',sha('b'),{commit:sha('c'),tree:sha('3')},true,'author');assert.equal(f.submit(c).reviewId,saved.reviewId);assert.equal(f.state().reviews.length,1);
  assert.throws(()=>f.submit({...c,verdict:'APPROVE'}),/already used/);
 }finally{f.db.close();}
});
test('failure on a later comment rolls back verdict, earlier threads and draft removal together',()=>{
 const f=fixture();try{
  f.add();f.add('pending-comment-2');
  for(let i=0;i<999;i++)f.sql.exec('INSERT INTO pull_comments VALUES (?,1,?)',`existing-${i}`,JSON.stringify({...f.comment(`existing-${i}`),body:'Published'}));
  assert.throws(()=>f.submit(),/comment limit/);assert.equal(f.state().reviews.length,0);assert.equal(f.sql.exec("SELECT * FROM pull_comments WHERE id LIKE 'pending-%'").toArray().length,0);assert.equal(f.get().comments.length,2);
 }finally{f.db.close();}
});
test('a push or comparison change leaves stale drafts private; edit/remove/discard retain exact original anchors',()=>{
 const f=fixture();try{
  f.add();const c=f.command();f.repo.update('refs/heads/feature',sha('b'),{commit:sha('c'),tree:sha('3')},true,'author');
  assert.throws(()=>f.submit(c),/PR changed/);assert.throws(()=>f.add('pending-comment-2'),/earlier diff/);assert.equal(f.get().comments[0].commit,sha('b'));
  assert.throws(()=>f.store.submit({...c,commit:sha('c')},{...f.pull(),anchor:sha('d')},f.head(),f.publish),/PR changed/);
  const edited=f.store.run({op:'edit',number:1,actor,reviewId:c.reviewId,revision:1,commentId:'pending-comment-1',body:'Keep this original reference'},f.pull(),f.head());assert.equal(edited.pending.commit,sha('b'));
  f.store.run({op:'remove',number:1,actor,reviewId:c.reviewId,revision:2,commentId:'pending-comment-1'},f.pull(),f.head());assert.equal(f.get().comments.length,0);
  const discard={op:'discard',number:1,actor,reviewId:c.reviewId,revision:3};
  f.store.run(discard,f.pull(),f.head());assert.equal(f.store.run(discard,f.pull(),f.head()).pending,null);assert.equal(f.get(),null);assert.equal(f.state().reviews.length,0);
  assert.throws(()=>f.add('late-retry',{revision:0}),/already used/,'A discarded review cannot be recreated by an old tab');
 }finally{f.db.close();}
});
test('pending feedback limits and closed-review checks fail without publishing or losing drafts',()=>{
 const f=fixture();try{
  for(let i=0;i<100;i++)f.add(`pending-comment-${i}`);assert.throws(()=>f.add('pending-comment-overflow'),/at most 100/);
  assert.throws(()=>f.store.submit(f.command(),{...f.pull(),state:'closed'},f.head(),f.publish),/no longer open/);assert.equal(f.get().comments.length,100);
  const oversized=f.comment('huge-excerpt');assert.throws(()=>f.store.run({op:'add',number:2,actor,author,reviewId:'oversize-review',revision:0,commit:f.head().commit,anchor:f.pull().anchor,comment:{...oversized,pull:2,excerpt:'a'.repeat(1024*1024)}},{...f.pull(),number:2},f.head()),/1 MiB/);
  assert.equal(f.state().reviews.length,0);
 }finally{f.db.close();}
});
test('CLI private workspaces and submission receipts are isolated from browser and sibling credentials',()=>{
 const f=fixture();try{
  f.add();
  const cli={...actor,via:{kind:'cli',credentialId:'11111111-1111-4111-8111-111111111111'}},other={...actor,via:{kind:'cli',credentialId:'22222222-2222-4222-8222-222222222222'}};
  assert.equal(f.get(cli),null);assert.equal(f.get(other),null);
  const command={op:'add',number:1,actor:cli,author,reviewId:'cli-pending-review',revision:0,commit:f.head().commit,anchor:f.pull().anchor,comment:{...f.comment('cli-pending-comment'),via:cli.via}};
  f.store.run(command,f.pull(),f.head());assert.equal(f.get(cli).id,command.reviewId);assert.equal(f.get().id,'pending-review-1');assert.equal(f.get(other),null);
  for(const person of [actor,other])assert.throws(()=>f.store.run({op:'discard',number:1,actor:person,reviewId:command.reviewId,revision:1},f.pull(),f.head()),/changed|No pending/);
  assert.throws(()=>f.store.run({...command,reviewId:'wrong-cli-provenance',comment:{...command.comment,via:other.via}},f.pull(),f.head()),/changed|Invalid pending/);
  const submit={number:1,actor:cli,reviewId:command.reviewId,revision:1,commit:f.head().commit,anchor:f.pull().anchor,verdict:'REQUEST_CHANGES',body:'Reviewed privately'};
  const result=f.submit(submit);assert.equal(f.get(cli),null);assert.equal(f.get().comments.length,1);
  assert.deepEqual(f.submit(submit),result);assert.equal(f.state().reviews.length,1);
  for(const person of [actor,other])assert.throws(()=>f.submit({...submit,actor:person}),/already used/);
  const comment=f.sql.exec('SELECT data FROM pull_comments WHERE id = ?',command.comment.id).toArray()[0];assert.equal(JSON.parse(comment.data).via.credentialId,cli.via.credentialId);
 }finally{f.db.close();}
});
test('delegated draft routes never fall back to browser RPCs on an older receiver',async()=>{
 const built=await build({entryPoints:[new URL('../src/review/pending-route.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false});
 const {pendingReviewRoute}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 let browserCalls=0;const legacy={pendingReview(){browserCalls++;return {pending:{id:'browser-private-review'}};},submitPendingReview(){browserCalls++;throw Error('Must never publish a browser draft');}};
 const env={SEQUENCER:{idFromName:name=>name,get:()=>legacy}},user={id:'codegraff:writer',name:'Writer',cli:{credentialId:'11111111-1111-4111-8111-111111111111',scopes:['read','reviews:write']}};
 const pull={number:1,anchor:sha('a')},head={commit:sha('b')},identity={reviewId:'cli-private-review',revision:1};
 for(const[method,body,submit]of [
  ['GET',undefined,false],['PATCH',{...identity,commentId:'private-comment',body:'Edit'},false],['DELETE',identity,false],
  ['POST',{...identity,commit:head.commit,anchor:pull.anchor,verdict:'APPROVE',body:'Private'},true]
 ]) {
  const request=new Request('http://localhost/api/trunks/fixture/pulls/1/pending-review',{method,headers:{Origin:'http://localhost','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const response=await pendingReviewRoute(env,request,'fixture',pull,head,{},user,true,submit);assert.equal(response.status,503);assert.ok(!(await response.text()).includes('browser-private-review'));
 }
 assert.equal(browserCalls,0);
 const response=await pendingReviewRoute(env,new Request('http://localhost/api/trunks/fixture/pulls/1/pending-review'),'fixture',pull,head,{}, {...user,cli:undefined},true,false);
 assert.equal((await response.json()).pending.id,'browser-private-review');assert.equal(browserCalls,1,'Old browser drafts remain readable by their browser owner');
});
