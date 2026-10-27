import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
const built=await build({stdin:{contents:`export * from './src/ci/store';export * from './src/ci/check-gate';export * from './src/ci/validation';export * from './src/ci/conclusions';export * from './src/repository/store';export * from './src/repository/policy';export * from './src/review/store';export * from './src/deployments/store';`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,platform:'node',format:'esm',write:false});
const {CIStore,checkFailure,validCheckResults,checkConclusions,passingConclusion,runConclusion,conclusionLabel,Repository,Policies,ReviewStore,Environments}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const sha=c=>c.repeat(40),result=state=>({name:'test',state,command:'Trusted check report',log:'',artifacts:[]});
function fixture(){const db=new DatabaseSync(':memory:'),sql={exec(q,...args){const rows=db.prepare(q).all(...args);return {toArray:()=>rows};}};sql.exec('CREATE TABLE versions(version INTEGER PRIMARY KEY,commit_sha TEXT,tree_sha TEXT)');const ci=new CIStore(sql),runner=ci.runner('trusted'),other=ci.runner('other');return{db,sql,ci,runner,other};}
const pin=f=>[{name:'test',runner:f.runner.id}];
const policy=f=>({branch:'main',pullRequest:true,approvals:0,checks:['test'],beforeOpen:['test'],checkSources:pin(f),preventForce:true,preventDelete:true});
test('only known terminal conclusions are accepted; lifecycle, unknown, duplicate and asserted-source reports fail closed',()=>{
 for(const state of checkConclusions)assert.equal(validCheckResults([result(state)]),true);
 for(const state of ['queued','running','waiting','complete','startup_failure','passed','SUCCESS','',null,{},true]){assert.equal(validCheckResults([result(state)]),false);assert.equal(passingConclusion(state),false);}
 assert.equal(validCheckResults([result('neutral'),result('success')]),false);assert.equal(validCheckResults([{...result('skipped'),runner:'asserted-source'}]),false);
 assert.equal(runConclusion([{state:'invented'},{state:'success'}]),'unknown');assert.equal(runConclusion([]),null);assert.equal(runConclusion([result('success'),result('neutral')]),'neutral');assert.equal(runConclusion([result('skipped')]),'skipped');assert.equal(runConclusion([result('skipped'),result('failure')]),'failure');assert.equal(conclusionLabel('timed_out'),'Timed out');
});
test('success, neutral and skipped satisfy required checks; all blocking conclusions and missing names do not',()=>{
 for(const state of checkConclusions){const f=fixture();try{
  const run=f.ci.enqueue('feature',sha('b'),sha('a')),lease=f.ci.claim(f.runner.token);assert.match(checkFailure(lease,'test',pin(f),f.ci.sources()),/has not succeeded/);
  const complete=f.ci.complete(f.runner.token,run.id,lease.attempt,[result(state)],null);assert.deepEqual(f.ci.complete(f.runner.token,run.id,lease.attempt,[result(state)],null),complete);assert.equal(complete.results[0].state,state);
  if(['success','neutral','skipped'].includes(state))assert.equal(f.ci.require('feature',sha('b'),sha('a'),['test'],pin(f)).id,run.id);else assert.throws(()=>f.ci.require('feature',sha('b'),sha('a'),['test'],pin(f)),new RegExp(state));
  assert.throws(()=>f.ci.require('feature',sha('c'),sha('a'),['test'],pin(f)),/Required check/);assert.throws(()=>f.ci.require('feature',sha('b'),sha('c'),['test'],pin(f)),/Required check/);assert.throws(()=>f.ci.require('feature',sha('b'),sha('a'),['missing']),/Required check/);
  f.ci.revoke(f.runner.id);assert.throws(()=>f.ci.require('feature',sha('b'),sha('a'),['test'],pin(f)),/revoked runner source/);
 }finally{f.db.close();}}
});
test('non-blocking conclusions cannot override source restrictions, conflicts or missing/duplicate results',()=>{const f=fixture();try{
 const run=f.ci.enqueue('feature',sha('b'),sha('a')),lease=f.ci.claim(f.other.token);f.ci.complete(f.other.token,run.id,lease.attempt,[result('neutral')],null);assert.throws(()=>f.ci.require('feature',sha('b'),sha('a'),['test'],pin(f)),/must be reported by/);
 const completed=f.ci.get(run.id);assert.match(checkFailure(completed,'test',[...pin(f),{name:'test',runner:f.other.id}],f.ci.sources()),/conflicting/);assert.match(checkFailure({...completed,results:[]},'test'),/has not succeeded/);assert.match(checkFailure({...completed,results:[result('failure'),result('skipped')]},'test'),/has not succeeded/);
}finally{f.db.close();}});
test('pre-open and final serialized PR merge use the same conclusion policy and preserve exact candidate IDs',()=>{
 for(const state of ['neutral','skipped','timed_out','cancelled','failure','action_required','stale']){const f=fixture();try{
  const repo=new Repository(f.sql);repo.initialize();repo.update('refs/heads/main',null,{commit:sha('a'),tree:sha('1')},true,'owner');repo.update('refs/heads/feature',null,{commit:sha('b'),tree:sha('2')},true,'author');
  new Policies(f.sql).set(policy(f));const reviews=new ReviewStore(f.sql,()=>repo.main(),true,{accounts:{},checkedAt:Date.now(),expiresAt:Date.now()+30000}),s=reviews.snapshot(),head=s.branches.find(b=>b.name==='feature'),base=s.branches.find(b=>b.name==='main'),open=()=>reviews.run({op:'open',title:'Conclusion gate',body:'',head,base,anchor:base.commit,anchorTree:base.tree,author:{id:'author',name:'Author'}},()=>{}),merge=()=>reviews.run({op:'merge',number:1,head,base:repo.main(),anchor:base.commit,candidate:{commit:head.commit,tree:head.tree,base:base.commit},request:{owner:{id:'owner'}}},()=>{throw Error('Unexpected generated commit');});
  let run=f.ci.claim(f.runner.token);while(run.branch!=='feature'){f.ci.complete(f.runner.token,run.id,run.attempt,[],null);run=f.ci.claim(f.runner.token);}f.ci.complete(f.runner.token,run.id,run.attempt,[result(state)],null);
  if(['neutral','skipped'].includes(state)){open();merge();assert.equal(repo.main().commit,sha('b'));assert.equal(reviews.snapshot().pulls[0].state,'merged');}
  else{assert.throws(open,/Required check/);new Policies(f.sql).set({...policy(f),beforeOpen:[]});open();assert.throws(merge,/Required check/);assert.equal(repo.main().commit,sha('a'));assert.equal(reviews.snapshot().pulls[0].state,'open');}
 }finally{f.db.close();}}
});
test('neutral/skipped may wait for deployment, but cannot stand in for verified staging or a successful environment',()=>{
 for(const state of ['neutral','skipped']){const f=fixture();try{
  const run=f.ci.enqueue('feature',sha('b'),sha('a')),lease=f.ci.claim(f.runner.token);assert.equal(f.ci.defer(f.runner.token,run.id,lease.attempt,'request',[result(state)]).state,'waiting');
  f.ci.retry(run.id,sha('b'),sha('a'));const fresh=f.ci.claim(f.runner.token);assert.throws(()=>f.ci.defer(f.runner.token,run.id,fresh.attempt,'request',[{...result(state),name:'staging'}]),/Only passing/);
  new Environments(f.sql).set({name:'production'});assert.throws(()=>f.ci.complete(f.runner.token,run.id,fresh.attempt,[result(state)],null,Date.now(),[{environment:'production',head:sha('b'),base:sha('a'),state,deploymentId:'synthetic',url:'https://fixture.invalid/deploy',verifiedAt:Date.now()}]),/Deployment report/);assert.equal(f.ci.get(run.id).state,'running');
  f.ci.complete(f.runner.token,run.id,fresh.attempt,[{...result(state),name:'staging'}],null);assert.throws(()=>f.ci.require('feature',sha('b'),sha('a'),['staging']),/has not succeeded/);
  assert.match(checkFailure({...f.ci.get(run.id),results:[{...result('success'),name:'staging'}]},'staging'),/verified deployment/);
 }finally{f.db.close();}}
});
