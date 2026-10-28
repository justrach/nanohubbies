import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
const output=await build({entryPoints:['review/store','repository/store','repository/policy','review/pending','review/shared-head'].map(n=>new URL(`../src/${n}.ts`,import.meta.url).pathname),bundle:true,platform:'node',format:'esm',write:false,outdir:'/virtual'});
const [{ReviewStore},{Repository},{Policies},{PendingReviews},{sharedHeadReviewBlockers}]=await Promise.all(output.outputFiles.map(o=>import('data:text/javascript;base64,'+Buffer.from(o.text).toString('base64'))));
const sha=c=>c.repeat(40),author={id:'author',name:'Author'},reviewer={id:'reviewer',name:'Reviewer'},policy={branch:'main',pullRequest:true,approvals:1,checks:[],beforeOpen:[],preventForce:true,preventDelete:true};
function fixture(){
 const db=new DatabaseSync(':memory:'),sql={exec(q,...args){const rows=db.prepare(q).all(...args);return {toArray:()=>rows};}};
 sql.exec('CREATE TABLE versions(version INTEGER PRIMARY KEY,commit_sha TEXT,tree_sha TEXT)');
 const repo=new Repository(sql);repo.initialize();repo.update('refs/heads/main',null,{commit:sha('a'),tree:sha('1')},false,'author');
 for(const name of ['feature','alias'])repo.update('refs/heads/'+name,null,{commit:sha('b'),tree:sha('2')},true,'author');
 const membership={accounts:{author:'writer',reviewer:'writer',other:'writer'},checkedAt:Date.now(),expiresAt:Date.now()+30000};
 const store=new ReviewStore(sql,()=>repo.main(),true,membership),policies=new Policies(sql),state=()=>store.snapshot(),branch=name=>state().branches.find(b=>b.name===name),run=c=>store.run(c,()=>{throw Error('Unexpected landing');});
 for(const name of ['feature','alias'])run({op:'open',head:branch(name),base:branch('main'),title:name,body:'',anchor:sha('a'),anchorTree:sha('1'),author});
 policies.set(policy);
 const review=(number,verdict='APPROVE',person=reviewer)=>run({op:'review',number,author:person,body:'Published feedback',verdict,commit:branch(number===1?'feature':'alias').commit,anchor:sha('a'),independent:true}).reviews.at(-1);
 const merge=()=>run({op:'merge',number:1,head:branch('feature'),base:repo.main(),anchor:sha('a'),candidate:{commit:branch('feature').commit,tree:branch('feature').tree,base:repo.main().commit},request:{owner:author}});
 const pending=new PendingReviews(sql),actor={id:reviewer.id,origin:'http://localhost'};
 const draft=(via=undefined)=>pending.run({op:'add',number:2,actor:{...actor,...(via?{via}:{})},author:reviewer,reviewId:via?'cli-private-review':'browser-private-review',revision:0,commit:sha('b'),anchor:sha('a'),comment:{id:via?'cli-private-comment':'browser-private-comment',pull:2,author:reviewer,path:'README.md',side:'RIGHT',startLine:1,line:1,commit:sha('b'),anchor:sha('a'),body:'PRIVATE feedback which must not be exposed',excerpt:'PRIVATE excerpt',replyTo:null,resolved:false,at:1,...(via?{via}:{})}},state().pulls.find(p=>p.number===2),branch('alias')).pending;
 const blockers=()=>{const s=state();return sharedHeadReviewBlockers(sql,s.pulls.find(p=>p.number===1),branch('feature').commit,s);};
 return {db,sql,repo,store,state,branch,run,policies,review,merge,pending,actor,draft,blockers};
}
test('a second open PR at the exact same head cannot evade requested changes through the first PR',()=>{
 const f=fixture();try{
  f.review(1);f.review(2,'REQUEST_CHANGES');
  assert.throws(f.merge,/pull request #2.*same head/);
  assert.equal(f.branch('main').commit,sha('a'));assert.equal(f.state().pulls.find(p=>p.number===1).state,'open');
 }finally{f.db.close();}
});
test('peer review state uses each account latest verdict without resurrecting a dismissed earlier review',()=>{
 const f=fixture();try{
  f.review(1);f.review(2,'REQUEST_CHANGES');f.review(2,'COMMENT');assert.equal(f.blockers()[0].changesRequested,true,'A comment does not clear a requested change');
  const approval=f.review(2,'APPROVE');assert.deepEqual(f.blockers(),[]);
  f.run({op:'dismiss',number:2,reviewId:approval.id,actor:author,reason:'Dismiss latest decision',human:true,origin:'http://localhost'});assert.deepEqual(f.blockers(),[],'Dismissing the latest approval does not resurrect an older requested change');
  const blocking=f.review(2,'REQUEST_CHANGES');assert.throws(f.merge,/requested changes.*#2/);
  f.run({op:'dismiss',number:2,reviewId:blocking.id,actor:author,reason:'Resolve peer feedback',human:true,origin:'http://localhost'});assert.deepEqual(f.blockers(),[]);assert.equal(f.merge().pulls.find(p=>p.number===1).state,'merged');
 }finally{f.db.close();}
});
test('only live exact head refs of other open PRs block, not trees or historical opening heads',()=>{
 const f=fixture();try{
  f.review(1);f.review(2,'REQUEST_CHANGES');assert.equal(f.blockers().length,1);
  f.repo.update('refs/heads/alias',sha('b'),{commit:sha('c'),tree:sha('2')},true,'author');assert.deepEqual(f.blockers(),[],'Same tree under a different commit is unrelated');
  f.repo.update('refs/heads/alias',sha('c'),{commit:sha('b'),tree:sha('2')},false,'author');assert.equal(f.blockers().length,1);
  f.run({op:'close',number:2});assert.deepEqual(f.blockers(),[]);assert.equal(f.merge().pulls.find(p=>p.number===1).state,'merged');
 }finally{f.db.close();}
});
test('browser and CLI pending drafts block without exposing private identity, body, excerpts or comment IDs',()=>{
 const f=fixture();try{
  f.review(1);assert.deepEqual(f.blockers(),[]);
  const browser=f.draft(),via={kind:'cli',credentialId:'11111111-1111-4111-8111-111111111111'},cli=f.draft(via);
  const expected=[{number:2,changesRequested:false,pendingReview:true}];assert.deepEqual(f.blockers(),expected);assert.throws(f.merge,/pending review.*#2/);
  for(const value of ['PRIVATE',reviewer.id,via.credentialId,browser.id,cli.id])assert.ok(!JSON.stringify(f.blockers()).includes(value));
  f.pending.run({op:'discard',number:2,actor:f.actor,reviewId:browser.id,revision:browser.revision},f.state().pulls.find(p=>p.number===2),f.branch('alias'));assert.deepEqual(f.blockers(),expected);
  f.pending.run({op:'discard',number:2,actor:{...f.actor,via},reviewId:cli.id,revision:cli.revision},f.state().pulls.find(p=>p.number===2),f.branch('alias'));assert.deepEqual(f.blockers(),[]);assert.equal(f.merge().pulls.find(p=>p.number===1).state,'merged');
 }finally{f.db.close();}
});
test('stale and empty peer drafts remain pending until discarded, published or their PR closes',()=>{
 const f=fixture();try{
  const draft=f.draft();f.pending.run({op:'remove',number:2,actor:f.actor,reviewId:draft.id,revision:1,commentId:draft.comments[0].id},f.state().pulls.find(p=>p.number===2),f.branch('alias'));
  assert.equal(f.blockers()[0].pendingReview,true);
  for(const name of ['feature','alias'])f.repo.update('refs/heads/'+name,sha('b'),{commit:sha('c'),tree:sha('3')},true,'author');
  f.review(1);assert.equal(f.blockers()[0].pendingReview,true);assert.throws(f.merge,/pending review/);
  f.run({op:'close',number:2});assert.deepEqual(f.blockers(),[]);f.merge();
 }finally{f.db.close();}
});
test('a peer draft arriving after a clean preview is re-read by the final merge writer',()=>{
 const f=fixture();try{
  f.review(1);const before=f.blockers();assert.deepEqual(before,[]);f.draft();assert.throws(f.merge,/pending review.*same head/);assert.equal(f.branch('main').commit,sha('a'));
 }finally{f.db.close();}
});
test('peer restrictions follow current required-review policy and cannot supply approvals to the target PR',()=>{
 const f=fixture();try{
  f.review(2);assert.throws(f.merge,/independent approval/,'An approval on the peer cannot satisfy this PR');
  f.review(2,'REQUEST_CHANGES');f.policies.set({...policy,pullRequest:false,approvals:0});assert.deepEqual(f.blockers(),[]);
  f.policies.set({...policy,pullRequest:false});assert.equal(f.blockers().length,1,'Required approvals still enable the guard');
  f.policies.set({...policy,pullRequest:false,approvals:0});assert.equal(f.merge().pulls.find(p=>p.number===1).state,'merged');
 }finally{f.db.close();}
});
