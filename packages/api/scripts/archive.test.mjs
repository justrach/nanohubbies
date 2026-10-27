import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:`export * from './src/repository/archive';export * from './src/repository/store';export * from './src/repository/policy';export * from './src/repository/rulesets';export * from './src/ci/store';export * from './src/review/store';export * from './src/review/comments';export * from './src/deployments/store';export * from './src/deployments/requests';`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,platform:'node',format:'esm',write:false});
const {ArchiveStore,Repository,Policies,Rulesets,CIStore,ReviewStore,CodeComments,Environments,DeploymentRequests}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const sha=c=>c.repeat(40),change=(archived,revision)=>({id:crypto.randomUUID(),archived,revision,actor:'owner',at:Date.now()});
function fixture(){const db=new DatabaseSync(':memory:'),sql={exec(query,...args){const rows=db.prepare(query).all(...args);return{toArray:()=>rows};}};sql.exec('CREATE TABLE versions(version INTEGER PRIMARY KEY,commit_sha TEXT,tree_sha TEXT)');return{db,sql,archive:new ArchiveStore(sql)};}
test('archive transitions fence writes, preserve revision checks and resume idempotently after lost replies',()=>{
 const f=fixture();try{
  assert.equal(f.archive.state().archived,false);f.archive.writable();const pending=f.archive.prepare(true,0,'owner');assert.equal(pending.archived,false);assert.ok(pending.transition);assert.throws(()=>f.archive.writable(),/archived/);assert.deepEqual(f.archive.prepare(true,0,'other'),pending);assert.throws(()=>f.archive.prepare(false,0,'owner'),/pending/);
  const mirror=new ArchiveStore(f.sql,'mirror'),applied=mirror.apply(pending.transition);assert.equal(applied.changed,true);assert.equal(mirror.apply(pending.transition).changed,false);
  const archived=f.archive.complete(pending.transition);assert.equal(archived.archived,true);assert.equal(archived.revision,1);assert.deepEqual(f.archive.complete(pending.transition),archived);assert.deepEqual(f.archive.prepare(true,0,'owner'),archived);
  assert.throws(()=>f.archive.prepare(false,0,'owner'),/changed/);const reopening=f.archive.prepare(false,1,'owner');assert.throws(()=>f.archive.writable(),/archived/);f.archive.complete(reopening.transition);f.archive.writable();assert.equal(f.archive.state().revision,2);
 }finally{f.db.close();}
});
test('replica revisions never regress when an old archive or unarchive RPC arrives late',()=>{
 const f=fixture();try{
  const locked=change(true,1),open=change(false,2);f.archive.apply(locked);f.archive.apply(open);assert.equal(f.archive.apply(locked).state.archived,false);f.archive.apply(change(true,3));assert.equal(f.archive.apply(open).state.archived,true);assert.throws(()=>f.archive.apply(change(false,3)),/Conflicting/);
 }finally{f.db.close();}
});
test('repository scope is isolated and invalid optimistic archive requests do not change state',()=>{
 const f=fixture();try{
  new ArchiveStore(f.sql,'one').prepare(true,0,'owner');new ArchiveStore(f.sql,'two').writable();
  for(const [value,revision] of [['true',0],[true,-1],[true,1.5]])assert.throws(()=>f.archive.prepare(value,revision,'owner'));
  assert.equal(f.archive.state().revision,0);assert.equal(f.archive.state().transition,null);
 }finally{f.db.close();}
});
test('archive is a final ref writer gate for all users, branches and tags while reads stay intact',()=>{
 const f=fixture();try{
  const repo=new Repository(f.sql);repo.initialize();repo.update('refs/heads/main',null,{commit:sha('a'),tree:sha('1')},true,'owner');repo.update('refs/heads/topic',null,{commit:sha('b'),tree:sha('2')},true,'writer');const before=repo.refs(),archive=change(true,1);f.archive.apply(archive);
  for(const actor of ['owner','admin','writer','agent'])for(const [name,old,next] of [['refs/heads/main',sha('a'),{commit:sha('b'),tree:sha('2')}],['refs/heads/topic',sha('b'),null],['refs/tags/release',null,{commit:sha('a'),tree:sha('1')}],['refs/heads/new',null,{commit:sha('a'),tree:sha('1')}]])assert.throws(()=>repo.update(name,old,next,true,actor),/archived/);
  assert.deepEqual(repo.refs(),before);assert.equal(repo.main().commit,sha('a'));f.archive.apply(change(false,2));repo.update('refs/heads/new',null,{commit:sha('a'),tree:sha('1')},true,'owner');assert.ok(repo.refs().some(ref=>ref.name==='refs/heads/new'));
 }finally{f.db.close();}
});
test('archival blocks settings, review and deployment store mutations without deleting readable history',()=>{
 const f=fixture();try{
  const repo=new Repository(f.sql);repo.initialize();repo.update('refs/heads/main',null,{commit:sha('a'),tree:sha('1')},true,'owner');const envs=new Environments(f.sql),env=envs.set({name:'staging'}),policies=new Policies(f.sql),policy={branch:'main',pullRequest:false,approvals:0,checks:[],beforeOpen:[],preventForce:true,preventDelete:true};policies.set(policy);
  const rules=new Rulesets(f.sql),rule=rules.set({name:'Protect tags',target:'tag',enforcement:'active',rules:[{type:'deletion'}],conditions:{ref_name:{include:['~ALL'],exclude:[]}}}),reviews=new ReviewStore(f.sql,()=>repo.main(),true),comments=new CodeComments(f.sql);f.archive.apply(change(true,1));
  for(const run of [()=>envs.set({name:'other'}),()=>envs.remove(env.id),()=>policies.set({...policy,locked:false}),()=>policies.remove('main'),()=>rules.remove(rule.id),()=>reviews.run({op:'close',number:1}),()=>comments.run({op:'resolve',commit:sha('a'),id:'not-a-comment',resolved:true}),()=>new DeploymentRequests(f.sql).request({state:'running'},'staging','owner')])assert.throws(run,/archived/);
  assert.equal(envs.list()[0].name,'staging');assert.equal(rules.plan().rulesets.length,1);assert.equal(policies.list().length,1);assert.equal(reviews.snapshot().archive.archived,true);assert.deepEqual(comments.run({op:'list',commit:sha('a')}).comments,[]);
 }finally{f.db.close();}
});
test('archival cancels queued/running/waiting CI, removes read leases and invalidates all prior attempt authorizations',()=>{
 const f=fixture();try{
  const ci=new CIStore(f.sql),runner=ci.runner('primary');ci.enqueue('running',sha('a'),sha('b'),'owner');const leased=ci.claim(runner.token);ci.enqueue('waiting',sha('c'),sha('b'),'owner');const waiting=ci.claim(runner.token);ci.defer(runner.token,waiting.id,waiting.attempt,'request-1',[]);ci.enqueue('queued',sha('d'),sha('b'),'owner');assert.equal(ci.readable(leased.readToken),true);
  f.archive.apply(change(true,1));ci.cancelForArchive();assert.equal(ci.claim(runner.token),null);assert.deepEqual(ci.waiting(runner.token),[]);assert.equal(ci.readable(leased.readToken),false);assert.equal(ci.registrations()[0].active,0);assert.ok(ci.list().every(run=>run.state==='complete'&&run.results[0].state==='cancelled'&&run.leaseUntil===0));assert.ok(ci.list().every(run=>run.generation===2));
  assert.throws(()=>ci.complete(runner.token,leased.id,leased.attempt,[],null),/archived/);assert.throws(()=>ci.runner('new'),/archived/);assert.throws(()=>ci.retry(leased.id,leased.head,leased.base,'owner'),/archived/);
  f.archive.apply(change(false,2));assert.equal(ci.claim(runner.token),null);ci.retry(leased.id,leased.head,leased.base,'owner');const resumed=ci.claim(runner.token);assert.ok(resumed.generation>leased.generation);assert.ok(resumed.attempt>leased.attempt);assert.throws(()=>ci.complete(runner.token,leased.id,leased.attempt,[],null),/Stale/);
 }finally{f.db.close();}
});

test('reopening commits at the metadata boundary before writer activation; an interrupted reopen can resume or be superseded by an emergency archive',()=>{
 const f=fixture();try{
  f.archive.apply(change(true,1));let opening=f.archive.prepare(false,1,'owner');assert.throws(()=>f.archive.writable(),/archived/);opening=f.archive.beginOpening(opening.transition);assert.equal(opening.archived,false);assert.equal(opening.transition.committed,true);f.archive.writable();assert.equal(f.archive.prepare(false,1,'owner').transition.id,opening.transition.id);
  const closing=f.archive.prepare(true,2,'owner');assert.throws(()=>f.archive.writable(),/archived/);assert.notEqual(closing.transition.id,opening.transition.id);assert.equal(closing.transition.revision,3);assert.throws(()=>f.archive.complete(opening.transition),/changed/);f.archive.complete(closing.transition);assert.equal(f.archive.state().archived,true);
 }finally{f.db.close();}
});
