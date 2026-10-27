import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
const output=await build({entryPoints:['review/pull-comments','review/comments','repository/policy'].map(n=>new URL(`../src/${n}.ts`,import.meta.url).pathname),bundle:true,platform:'node',format:'esm',write:false,outdir:'/virtual'});
const [{PullComments},{anchorInPatch},{Policies}]=await Promise.all(output.outputFiles.map(o=>import('data:text/javascript;base64,'+Buffer.from(o.text).toString('base64'))));
const sha=c=>c.repeat(40),pull={number:1,state:'open',head:'feature',base:'main',headCommit:sha('a'),anchor:sha('b'),anchorTree:sha('2'),author:{id:'author'},createdAt:0};
const head={name:'feature',commit:sha('a'),tree:sha('1')},actor={id:'writer',origin:'http://localhost'},root={id:'root-comment',pull:1,path:'src/main.ts',side:'RIGHT',startLine:2,line:3,commit:head.commit,anchor:pull.anchor,author:{id:'writer',name:'Writer'},body:'Handle empty input',at:1,replyTo:null,resolved:false,excerpt:'@@ -2 +2 @@\n-old\n+new'};
function fixture(){const db=new DatabaseSync(':memory:'),sql={exec(q,...a){const rows=db.prepare(q).all(...a);return {toArray:()=>rows};}};return {db,sql,store:new PullComments(sql)};}
const command=(comment=root,extra={})=>({number:1,op:'add',commit:head.commit,anchor:pull.anchor,actor,comment,...extra});
test('PR comments isolate identical commits and preserve idempotency without resurrecting resolved threads',()=>{
 const {db,sql,store}=fixture();try{
  assert.equal(store.run(command(),pull,head).comments.length,1);assert.equal(store.run(command(),pull,head).comments.length,1);
  assert.throws(()=>store.run(command({...root,body:'Different'}),pull,head),/already used/);
  assert.throws(()=>store.run(command({...root,author:{id:'another'}}),pull,head),/Invalid/);
  store.run({op:'resolve',number:1,commit:head.commit,anchor:pull.anchor,actor,id:root.id,resolved:true},pull,head);
  assert.equal(store.run(command(),pull,head).comments[0].resolved,true);
  assert.equal(new PullComments(sql).run({op:'list',number:2},{...pull,number:2},head).comments.length,0);
  assert.throws(()=>store.run(command({...root,pull:2},{number:2}),{...pull,number:2},head),/already used/);
 }finally{db.close();}
});
test('head and comparison CAS reject stale adds and resolution; closed PRs retain read-only discussions',()=>{
 const {db,store}=fixture();try{
  for(const [p,h] of [[pull,{...head,commit:sha('c')}],[{...pull,anchor:sha('c')},head]])assert.throws(()=>store.run(command(),p,h),/changed/);
  store.run(command(),pull,head);
  assert.throws(()=>store.run({op:'resolve',number:1,commit:head.commit,anchor:pull.anchor,actor,id:root.id,resolved:true},pull,{...head,commit:sha('c')}),/changed/);
  for(const state of ['closed','merged']){assert.equal(store.run({op:'list',number:1},{...pull,state}).comments.length,1);assert.throws(()=>store.run(command(),{...pull,state},head),/no longer open/);}
 }finally{db.close();}
});
test('outdated replies retain original anchors and cannot cross PRs, threads, sides or revisions',()=>{
 const {db,store}=fixture();try{
  store.run(command(),pull,head);const moved={...head,commit:sha('c')},reply={...root,id:'reply-comment',replyTo:root.id,body:'Added the guard'};
  assert.equal(store.run(command(reply,{commit:moved.commit}),pull,moved).comments.length,2);
  for(const change of [{commit:moved.commit},{anchor:sha('d')},{path:'other.ts'},{side:'LEFT'},{startLine:1},{line:4},{replyTo:reply.id}])assert.throws(()=>store.run(command({...reply,...change,id:crypto.randomUUID()},{commit:moved.commit}),pull,moved),/original code selection/);
  assert.throws(()=>store.run(command({...reply,pull:2,id:'other-reply'},{number:2}),{...pull,number:2},head),/original code selection/);
 }finally{db.close();}
});
test('all unresolved PR threads block the final review gate across revisions, including deleted files',()=>{
 const {db,sql,store}=fixture();try{
  const policies=new Policies(sql);policies.set({branch:'main',pullRequest:true,approvals:0,checks:[],beforeOpen:[],preventForce:true,preventDelete:true,requireConversationResolution:true});
  store.run(command(),pull,head);assert.match(policies.reviewGate(pull,[],head.commit).error,/Resolve all review conversations/);
  assert.equal(policies.reviewGate({...pull,number:2},[],head.commit).ready,true);
  const moved={...head,commit:sha('c')};assert.equal(policies.reviewGate(pull,[],moved.commit).ready,false);
  const resolve=resolved=>store.run({op:'resolve',number:1,commit:moved.commit,anchor:pull.anchor,actor,id:root.id,resolved},pull,moved);
  resolve(true);assert.equal(policies.reviewGate(pull,[],moved.commit).ready,true);resolve(false);assert.equal(policies.reviewGate(pull,[],moved.commit).ready,false);
 }finally{db.close();}
});
test('hunk selection rejects disjoint hunks, absent sides and overlong ranges',()=>{
 const patch='@@ -1,3 +1,3 @@\n one\n-old\n+new\n three\n@@ -10 +10 @@\n-old\n+new\n';
 assert.equal(anchorInPatch(patch,root),true);
 for(const change of [{startLine:1,line:10},{line:204},{side:'BOTH'},{startLine:-1},{line:2.3}])assert.equal(anchorInPatch(patch,{...root,...change}),false);
 assert.equal(anchorInPatch('@@ -0,0 +1 @@\n+new\n',{...root,side:'LEFT',startLine:1,line:1}),false);
});
