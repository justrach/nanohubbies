import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
const directory=await mkdtemp(join(tmpdir(),'nh-branch-rename-'));after(()=>rm(directory,{recursive:true,force:true}));
await build({entryPoints:['repository/branch-rename','repository/store','repository/policy','repository/rulesets','repository/archive','review/store','ci/store'].map(path=>new URL('../src/'+path+'.ts',import.meta.url).pathname),bundle:true,platform:'node',format:'esm',outdir:directory,outExtension:{'.js':'.mjs'}});
const load=path=>import(pathToFileURL(join(directory,path+'.mjs')));
const {BranchRenames}=await load('repository/branch-rename'),{Repository}=await load('repository/store'),{Policies}=await load('repository/policy'),{Rulesets,applies}=await load('repository/rulesets'),{ArchiveStore}=await load('repository/archive'),{ReviewStore}=await load('review/store'),{CIStore}=await load('ci/store');
const sha=c=>c.repeat(40),a={commit:sha('a'),tree:sha('1')},b={commit:sha('b'),tree:sha('2')};
const policy=(branch,extra={})=>({branch,pullRequest:false,approvals:0,checks:[],beforeOpen:[],preventForce:true,preventDelete:true,...extra});
const ruleset=(include,rules,extra={})=>({name:'Branch policy',target:'branch',enforcement:'active',conditions:{ref_name:{include,exclude:[]}},rules,...extra});
const authority=(actor='owner',role='owner')=>({actor,role,checkedAt:Date.now(),expiresAt:Date.now()+30000});
function fixture(){
 const db=new DatabaseSync(':memory:'),sql={exec(q,...args){const rows=db.prepare(q).all(...args);return {toArray:()=>rows};}};
 sql.exec('CREATE TABLE versions (version INTEGER PRIMARY KEY,commit_sha TEXT,tree_sha TEXT)');
 const repo=new Repository(sql);repo.initialize();repo.update('refs/heads/main',null,a,true,'owner');repo.update('refs/heads/feature',null,b,true,'writer');
 const rename=new BranchRenames(sql),policies=new Policies(sql),rules=new Rulesets(sql),ci=new CIStore(sql),reviews=new ReviewStore(sql,()=>repo.main(),true);
 const transaction=fn=>{db.exec('BEGIN');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
 const input=(from='feature',to='renamed')=>({from,to,commit:repo.refs().find(ref=>ref.name==='refs/heads/'+from)?.commit??b.commit,revision:rename.configuration().revision});
 const perform=(change=input(),identity=authority(),human=true)=>transaction(()=>rename.rename(change,identity.actor,identity,{old:null,next:change.commit,linear:true,rules:{revision:rules.plan().revision,ref:'refs/heads/'+change.to,fileTransitions:true,violations:[]}},{old:change.commit,next:change.commit,linear:true,rules:{revision:rules.plan().revision,ref:'refs/heads/'+change.from,violations:[]},signatures:{verified:true,checked:0}},human));
 const snapshot=()=>({refs:repo.refs(),configuration:repo.configuration(),head:repo.main(),policies:policies.list(),rules:rules.plan(),pulls:sql.exec('SELECT * FROM review_pulls').toArray(),runs:ci.list(),audit:sql.exec('SELECT * FROM repository_audit').toArray(),aliases:sql.exec('SELECT * FROM repository_branch_renames').toArray(),revision:rename.configuration().revision});
 return {db,sql,repo,rename,policies,rules,ci,reviews,transaction,input,perform,snapshot};
}

test('writer rename retains exact objects and the default, invalidates old CI and resolves redirects without alias loops',()=>{
 const f=fixture();try{
  const oldRuns=f.ci.list().filter(run=>run.branch==='feature');
  const runner=f.ci.runner('rename-in-flight');let lease;
  for(;;){lease=f.ci.claim(runner.token);assert.ok(lease);if(lease.branch==='feature')break;f.ci.complete(runner.token,lease.id,lease.attempt,[{name:'test',state:'success',command:'fixture',log:'',artifacts:[]}],null);}
  assert.equal(f.ci.readable(lease.readToken),true);
  const result=f.perform(f.input('feature',"日本語/'-feature"),authority('writer','writer'));
  assert.equal(result.defaultBranch,'main');assert.equal(result.renamed.commit,b.commit);assert.equal(f.repo.main().commit,a.commit);
  assert.equal(f.repo.refs().find(ref=>ref.name==="refs/heads/日本語/'-feature").tree,b.tree);assert.equal(f.rename.resolve('feature'),"日本語/'-feature");
  for(const run of oldRuns)assert.equal(f.ci.get(run.id).state,'superseded');
  assert.equal(f.ci.readable(lease.readToken),false);
  assert.throws(()=>f.ci.complete(runner.token,lease.id,lease.attempt,[{name:'test',state:'success',command:'stale delivery',log:'',artifacts:[]}],null),/superseded/);
  assert.equal(f.ci.list().find(run=>run.branch==="日本語/'-feature").state,'queued');
  f.perform(f.input("日本語/'-feature",'feature/subbranch'),authority('writer','writer'));assert.equal(f.rename.resolve('feature'),'feature/subbranch');
  f.perform(f.input('feature/subbranch','feature'),authority('writer','writer'));assert.equal(f.rename.resolve('feature'),'feature');assert.equal(f.rename.resolve("日本語/'-feature"),'feature');
  assert.equal(f.sql.exec('SELECT * FROM repository_branch_renames WHERE old_name=?','feature').toArray().length,0);
 }finally{f.db.close();}
});
test('renaming the default retains classic requirements, source pins and the moving default rule, without changing any object ID',()=>{
 const f=fixture();try{
  const runner=f.ci.runner('source-pin');f.policies.set(policy('main',{pullRequest:true,approvals:2,checks:['test'],checkSources:[{name:'test',runner:runner.id}],requireConversationResolution:true,requireLastPushApproval:true}));
  const rule=f.rules.set(ruleset(['~DEFAULT_BRANCH'],[{type:'update'}]));
  const before=f.repo.refs(),result=f.perform(f.input('main','trunk'));
  assert.equal(result.defaultBranch,'trunk');assert.equal(f.repo.main().commit,a.commit);assert.equal(f.repo.refs().length,before.length);
  assert.equal(f.policies.get('main'),undefined);const protection=f.policies.get('trunk');assert.equal(protection.approvals,2);assert.equal(protection.pullRequest,true);assert.equal(protection.preventDelete,true);assert.deepEqual(protection.checkSources,[{name:'test',runner:runner.id}]);
  assert.ok(applies(f.rules.plan().rulesets.find(r=>r.id===rule.id),'refs/heads/trunk','trunk'));
  assert.throws(()=>f.repo.update('refs/heads/trunk',a.commit,b,true,'owner'),/updates are restricted/);
  assert.equal(f.repo.activity({kind:'settings'}).events.filter(event=>event.branchRename).length,1);
 }finally{f.db.close();}
});
test('base PRs follow the new name and head PRs close with their exact old diff retained',()=>{
 const f=fixture();try{
  f.repo.update('refs/heads/topic',null,b,true,'writer');
  const open=(head,base,title)=>{const branches=f.reviews.branches();f.reviews.run({op:'open',head:branches.find(b=>b.name===head),base:branches.find(b=>b.name===base),title,body:'',anchor:a.commit,anchorTree:a.tree,author:{id:'author',name:'Author'}},()=>{});};
  open('feature','main','Head closes');open('topic','feature','Base follows');
  const preview=f.rename.preview('feature','new-feature');assert.deepEqual(preview.closedPulls,[1]);assert.deepEqual(preview.retargetedPulls,[2]);
  f.perform(f.input('feature','new-feature'));const pulls=f.reviews.snapshot().pulls;
  assert.equal(pulls.find(p=>p.number===1).state,'closed');assert.equal(pulls.find(p=>p.number===1).headCommit,b.commit);assert.equal(pulls.find(p=>p.number===1).headTree,b.tree);
  assert.equal(pulls.find(p=>p.number===2).state,'open');assert.equal(pulls.find(p=>p.number===2).base,'new-feature');assert.equal(pulls.find(p=>p.number===2).anchor,a.commit);
 }finally{f.db.close();}
});
test('renaming cannot change the last reviewable pusher into the rename administrator',()=>{
 const f=fixture();try{
  f.perform();const pushId=f.policies.pushEvent('renamed'),push=JSON.parse(f.sql.exec('SELECT data FROM repository_audit WHERE id=?',pushId).toArray()[0].data);
  assert.equal(push.actor,'writer');assert.equal(push.forwardedPush.renamedBy,'owner');assert.equal(push.forwardedPush.sourceRef,'refs/heads/feature');
  f.policies.set(policy('main',{pullRequest:true,approvals:1,requireLastPushApproval:true}));
  const membership={accounts:{writer:'writer',owner:'writer',opener:'writer'},checkedAt:Date.now(),expiresAt:Date.now()+30000},store=new ReviewStore(f.sql,()=>f.repo.main(),true,membership),branches=store.branches();
  store.run({op:'open',head:branches.find(b=>b.name==='renamed'),base:branches.find(b=>b.name==='main'),title:'Renamed head',body:'',anchor:a.commit,anchorTree:a.tree,author:{id:'opener',name:'Opener'}},()=>{});
  const review=author=>store.run({op:'review',number:1,author:{id:author,name:author},body:'',verdict:'APPROVE',commit:b.commit,anchor:a.commit,independent:true},()=>{});
  review('writer');let snapshot=store.snapshot(),pull=snapshot.pulls[0];assert.equal(new Policies(f.sql,membership).reviewGate(pull,snapshot.reviews,b.commit).ready,false);
  review('owner');snapshot=store.snapshot();assert.equal(new Policies(f.sql,membership).reviewGate(pull,snapshot.reviews,b.commit).ready,true);
 }finally{f.db.close();}
});
test('default/protected branches need current admins; locks and destination protections cannot be bypassed by rename',()=>{
 for(const kind of ['reader','expired','default-writer','source-lock','destination-lock','destination-pr','source-pusher']){
  const f=fixture();try{
   let from='feature',identity=authority();
   if(kind==='reader')identity=authority('reader','reader');
   if(kind==='expired')identity={...authority(),expiresAt:Date.now()-1};
   if(kind==='default-writer'){from='main';identity=authority('writer','writer');}
   if(kind==='source-lock')f.policies.set(policy(from,{locked:true}));
   if(kind==='destination-lock')f.policies.set(policy('renamed',{locked:true}));
   if(kind==='destination-pr')f.policies.set(policy('renamed',{pullRequest:true}));
   if(kind==='source-pusher')f.policies.set(policy(from,{allowPush:['someone-else']}));
   const input=f.input(from),before=f.snapshot();assert.throws(()=>f.perform(input,identity),/membership|admin|locked|pull request|not allowed/);assert.deepEqual(f.snapshot(),before,kind);
  }finally{f.db.close();}
 }
});
test('ruleset patterns follow rename without changing IDs or weakening deliberate exclusions and name restrictions',()=>{
 const f=fixture();try{
  const rule=f.rules.set(ruleset(['refs/heads/feature*'],[{type:'non_fast_forward'}]));
  f.perform();const changed=f.rules.plan().rulesets.find(r=>r.id===rule.id);assert.deepEqual(changed.conditions.ref_name.include,['refs/heads/feature*','refs/heads/renamed']);
  assert.ok(applies(changed,'refs/heads/renamed'));assert.ok(applies(changed,'refs/heads/feature-other'));
 }finally{f.db.close();}
 for(const kind of ['exclude','name','creation','deletion']){const f=fixture();try{
  const value=ruleset(['refs/heads/feature'],kind==='name'?[{type:'branch_name_pattern',parameters:{operator:'starts_with',pattern:'feature'}}]:kind==='exclude'?[]:[{type:kind}]);
  if(kind==='exclude')value.conditions.ref_name.exclude=['refs/heads/renamed'];f.rules.set(value);const before=f.snapshot();assert.throws(()=>f.perform(),/excluded|new name|creation|deletion/i);assert.deepEqual(f.snapshot(),before);
 }finally{f.db.close();}}
});
test('explicit human ruleset bypass is attributed and never inherited by a CLI rename',()=>{
 const f=fixture();try{
  f.rules.set(ruleset(['refs/heads/feature'],[{type:'creation'},{type:'deletion'}],{bypass_actors:[{actor_type:'User',actor_id:'owner',bypass_mode:'always'}]}));
  assert.throws(()=>f.perform(f.input(),authority(),false),/explicit bypass/);
  f.perform();const event=f.repo.activity({kind:'bypasses'}).events.find(event=>event.branchRename);assert.ok(event);assert.deepEqual(event.bypassedRulesets,[1]);assert.equal(event.actor,'owner');
 }finally{f.db.close();}
});
test('legacy SQL ref ABA, PR changes, policies and settings invalidate a prepared rename',()=>{
 for(const kind of ['ref-aba','pull','policy','rules','default']){const f=fixture();try{
  const input=f.input();
  if(kind==='ref-aba'){f.sql.exec("UPDATE repository_refs SET commit_sha=? WHERE name='refs/heads/feature'",a.commit);f.sql.exec("UPDATE repository_refs SET commit_sha=? WHERE name='refs/heads/feature'",b.commit);}
  if(kind==='pull')f.sql.exec('INSERT INTO review_pulls(data) VALUES(?)',JSON.stringify({state:'closed'}));
  if(kind==='policy')f.policies.set(policy('unrelated'));
  if(kind==='rules')f.rules.set(ruleset(['~ALL'],[]));
  if(kind==='default')f.repo.selectDefault('feature',b.commit,f.repo.configuration().revision,'owner');
  const before=f.snapshot();assert.equal(f.perform(input).conflict,true);assert.deepEqual(f.snapshot(),before);
 }finally{f.db.close();}}
});
test('lost revision authority creates a new generation instead of accepting an old export',()=>{
 const f=fixture();try{
  const input=f.input();f.sql.exec('DELETE FROM branch_rename_revision');const repaired=new BranchRenames(f.sql);assert.notEqual(repaired.configuration().revision,input.revision);assert.equal(f.perform(input).conflict,true);
  const next=f.input();f.sql.exec('DROP TABLE branch_rename_revision');const rebuilt=new BranchRenames(f.sql);assert.notEqual(rebuilt.configuration().revision,next.revision);assert.equal(f.perform(next).conflict,true);
 }finally{f.db.close();}
});
test('a late SQL failure rolls back refs, default, policy, PRs, CI, redirects, revisions and audit together',()=>{
 const f=fixture();try{
  f.policies.set(policy('main',{pullRequest:true}));
  const before=f.snapshot();f.sql.exec("CREATE TRIGGER test_late_failure BEFORE INSERT ON repository_branch_renames BEGIN SELECT RAISE(ABORT,'late rename fault'); END");
  assert.throws(()=>f.perform(f.input('main','trunk')),/late rename fault/);assert.deepEqual(f.snapshot(),before);
 }finally{f.db.close();}
});
test('source-prefix conflicts, duplicate names, archive and stale replay are handled without partial renames',()=>{
 const f=fixture();try{
  assert.throws(()=>f.perform(f.input('feature','main')),/already exists/);assert.throws(()=>f.perform(f.input('feature','bad..name')),/Invalid/);
  const input=f.input('feature','feature/child');f.perform(input);assert.equal(f.rename.resolve('feature'),'feature/child');assert.equal(f.perform(input).conflict,true);
  new ArchiveStore(f.sql).apply({archived:true,revision:1,actor:'owner',phase:'archived'});
  assert.throws(()=>f.perform(f.input('feature/child','another')),/archiv/i);
 }finally{f.db.close();}
});
