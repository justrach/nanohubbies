import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
const output=await build({entryPoints:['review/store','review/readiness','repository/store','repository/policy'].map(n=>new URL(`../src/${n}.ts`,import.meta.url).pathname),bundle:true,platform:'node',format:'esm',write:false,outdir:'/virtual'});
const [{ReviewStore},{PullReadiness},{Repository},{Policies}]=await Promise.all(output.outputFiles.map(o=>import('data:text/javascript;base64,'+Buffer.from(o.text).toString('base64'))));
const sha=c=>c.repeat(40),actor={id:'author',name:'Author',origin:'https://fixture.invalid'};
const policy={branch:'main',pullRequest:true,approvals:0,checks:[],beforeOpen:[],preventForce:true,preventDelete:true};
function fixture(draft=true){
  const db=new DatabaseSync(':memory:'),sql={exec(q,...args){return {toArray:()=>db.prepare(q).all(...args)};}};
  // SqlStorage executes immediately, rather than lazily when toArray is called.
  sql.exec=(q,...args)=>{const rows=db.prepare(q).all(...args);return {toArray:()=>rows};};
  const tx=fn=>{db.exec('BEGIN');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
  sql.exec('CREATE TABLE versions(version INTEGER PRIMARY KEY,commit_sha TEXT,tree_sha TEXT)');
  const repo=new Repository(sql);repo.initialize();repo.update('refs/heads/main',null,{commit:sha('a'),tree:sha('1')},false,actor.id);repo.update('refs/heads/topic',null,{commit:sha('b'),tree:sha('2')},true,actor.id);
  const store=new ReviewStore(sql,()=>repo.main(),true),snapshot=()=>store.snapshot(),branch=name=>snapshot().branches.find(b=>b.name===name),run=command=>tx(()=>store.run(command,()=>{throw Error('Unexpected landing');}));
  const open=extra=>run({op:'open',title:'Work in progress',body:'',head:branch('topic'),base:branch('main'),anchor:sha('a'),anchorTree:sha('1'),author:actor,...(draft===undefined?{}:{draft}),...extra});
  open();
  const readiness=new PullReadiness(sql),pull=()=>snapshot().pulls[0],edit=extra=>tx(()=>readiness.edit({number:1,draft:false,revision:pull().draftRevision,commit:branch('topic').commit,anchor:pull().anchor,actor,...extra},pull(),branch('topic').commit));
  const merge=method=>tx(()=>new ReviewStore(sql,()=>repo.main(),true,{accounts:{},checkedAt:Date.now(),expiresAt:Date.now()+30000}).run({op:'merge',number:1,head:branch('topic'),base:repo.main(),anchor:pull().anchor,candidate:{commit:branch('topic').commit,tree:branch('topic').tree,base:repo.main().commit,method},request:{owner:actor}},()=>{throw Error('Unexpected landing');}));
  return {db,sql,repo,tx,store,snapshot,branch,run,open,readiness,pull,edit,merge};
}
test('drafts remain open, keep their live head and block every merge shape even without branch policy',()=>{
  const f=fixture();try{
    assert.equal(f.snapshot().pullReadiness,'storage-v1');assert.equal(f.pull().state,'open');assert.equal(f.pull().draft,true);assert.equal(f.pull().draftRevision,0);
    for(const method of ['fast-forward','merge','squash','rebase'])assert.throws(()=>f.merge(method),/Draft pull requests cannot be merged/);
    const gate=new Policies(f.sql).reviewGate(f.pull(),[],sha('b'));assert.equal(gate.ready,false);assert.match(gate.error,/mark ready/);assert.equal(f.repo.main().commit,sha('a'));
    f.repo.update('refs/heads/topic',sha('b'),{commit:sha('c'),tree:sha('3')},true,actor.id);assert.equal(f.pull().draft,true);assert.equal(f.branch('topic').commit,sha('c'));
  }finally{f.db.close();}
});
test('ready transitions are revision checked, idempotent at the current revision and preserve reviews and refs',()=>{
  const f=fixture();try{
    f.run({op:'review',number:1,author:{id:'reviewer',name:'Reviewer'},body:'Feedback while draft',verdict:'APPROVE',commit:sha('b'),anchor:sha('a'),independent:true});
    const reviews=f.snapshot().reviews,refs=f.repo.refs();assert.deepEqual(f.edit(),{draft:false,draftRevision:1});assert.equal(f.edit({revision:0}).conflict,true);
    assert.deepEqual(f.edit(),{draft:false,draftRevision:1});assert.deepEqual(f.snapshot().reviews,reviews);assert.deepEqual(f.repo.refs(),refs);
    assert.deepEqual(f.edit({draft:true}),{draft:true,draftRevision:2});assert.equal(f.edit({revision:0}).conflict,true);assert.equal(f.edit({revision:1}).conflict,true);
    f.edit();assert.equal(f.pull().draftRevision,3);assert.equal(f.merge('fast-forward').pulls[0].state,'merged');
  }finally{f.db.close();}
});
test('draft and ordinary creation both enforce the original before-open CI requirement',()=>{
  for(const draft of [true,false]){const f=fixture(draft);try{
    f.run({op:'close',number:1});new Policies(f.sql).set({...policy,beforeOpen:['staging']});
    assert.throws(()=>f.open(),/staging|CI|check/);assert.equal(f.snapshot().pulls.length,1);
  }finally{f.db.close();}}
});
test('unknown draft types and stale or closed transitions cannot change stored authority',()=>{
  const f=fixture();try{
    for(const extra of [{draft:'false'},{revision:-1},{revision:1.1},{commit:sha('c')},{anchor:sha('d')}])assert.throws(()=>f.edit(extra));
    assert.equal(f.pull().draft,true);assert.equal(f.pull().draftRevision,0);
    f.run({op:'close',number:1});assert.equal(f.pull().draft,true);assert.throws(()=>f.edit(),/Only open/);assert.equal(f.pull().draftRevision,0);
  }finally{f.db.close();}
});
test('legacy JSON rewrites cannot clear draft authority or reset its revision, under either trigger mode',()=>{
  for(const recursive of [0,1]){const f=fixture();try{
    f.sql.exec('PRAGMA recursive_triggers='+recursive);f.edit();f.edit({draft:true});
    for(const expression of ["json_set(data,'$.draft',json('false'),'$.draftRevision',0)","json_remove(data,'$.draft','$.draftRevision')"]){
      f.sql.exec(`UPDATE review_pulls SET data=${expression} WHERE number=1`);
      const row=JSON.parse(f.sql.exec('SELECT data FROM review_pulls WHERE number=1').toArray()[0].data);assert.equal(row.draft,true);assert.equal(row.draftRevision,2);assert.equal(f.pull().draft,true);
    }
  }finally{f.db.close();}}
});
test('persisted draft fence aborts an older merge transaction and rolls its ref write back',()=>{
  const f=fixture();try{
    const before=f.repo.refs();assert.throws(()=>f.tx(()=>{
      f.repo.update('refs/heads/main',sha('a'),{commit:sha('b'),tree:sha('2')},true,'legacy-merger',true);
      f.sql.exec("UPDATE review_pulls SET data=json_set(data,'$.state','merged','$.draft',json('false')) WHERE number=1");
    }),/Draft pull requests cannot be merged/);assert.deepEqual(f.repo.refs(),before);assert.equal(f.pull().state,'open');assert.equal(f.pull().draft,true);
  }finally{f.db.close();}
});
test('a late audit failure rolls back readiness, revision, mirrored metadata and audit together',()=>{
  const f=fixture();try{
    const before=f.pull();f.sql.exec("CREATE TRIGGER fail_readiness_audit BEFORE INSERT ON repository_audit WHEN json_type(NEW.data,'$.pullReadiness') IS NOT NULL BEGIN SELECT RAISE(ABORT,'injected readiness audit failure'); END");
    assert.throws(()=>f.edit(),/injected readiness audit/);assert.deepEqual(f.pull(),before);assert.equal(f.readiness.state(1).draftRevision,0);
    f.sql.exec('DROP TRIGGER fail_readiness_audit');f.edit();const event=JSON.parse(f.sql.exec("SELECT data FROM repository_audit WHERE json_type(data,'$.pullReadiness') IS NOT NULL").toArray()[0].data);assert.deepEqual(event.pullReadiness,{pull:1,draft:false,revision:1});assert.equal(event.actor,actor.id);
  }finally{f.db.close();}
});
test('missing draft authority is not silently reconstructed after installation and blocks legacy merging',()=>{
  const f=fixture();try{
    f.sql.exec('DELETE FROM review_pull_readiness WHERE pull=1');assert.throws(()=>new ReviewStore(f.sql,()=>f.repo.main(),true).snapshot(),/authority is unavailable/);
    assert.throws(()=>f.sql.exec("UPDATE review_pulls SET data=json_set(data,'$.state','merged') WHERE number=1"),/Draft pull requests cannot be merged/);
  }finally{f.db.close();}
});
test('repair restores missing storage hooks without resetting the authoritative draft or revision',()=>{
  const f=fixture();try{
    f.edit();f.edit({draft:true});f.sql.exec('DROP TRIGGER review_pull_readiness_json');f.sql.exec('DROP TRIGGER review_pull_readiness_merge');
    f.sql.exec("UPDATE review_pulls SET data=json_remove(data,'$.draft','$.draftRevision') WHERE number=1");
    const current=new ReviewStore(f.sql,()=>f.repo.main(),true).snapshot().pulls[0];assert.equal(current.draft,true);assert.equal(current.draftRevision,2);
    assert.throws(()=>f.sql.exec("UPDATE review_pulls SET data=json_set(data,'$.state','merged') WHERE number=1"),/Draft pull requests cannot be merged/);
    assert.equal(f.edit({revision:0}).conflict,true);
  }finally{f.db.close();}
});
test('first installation preserves old ready PRs, while interrupted installation preserves already-authoritative rows',()=>{
  const f=fixture();try{
    for(const name of ['insert','merge','revision','mirror','json','delete'])f.sql.exec('DROP TRIGGER review_pull_readiness_'+name);
    f.sql.exec('DROP TABLE review_pull_readiness_schema');f.sql.exec('DROP TABLE review_pull_readiness');f.sql.exec("UPDATE review_pulls SET data=json_remove(data,'$.draft','$.draftRevision')");
    const first=new ReviewStore(f.sql,()=>f.repo.main(),true).snapshot().pulls[0];assert.equal(first.draft,false);assert.equal(first.draftRevision,0);assert.equal(first.title,'Work in progress');
    f.edit({draft:true});f.sql.exec('DELETE FROM review_pull_readiness_schema');
    const resumed=new ReviewStore(f.sql,()=>f.repo.main(),true).snapshot().pulls[0];assert.equal(resumed.draft,true);assert.equal(resumed.draftRevision,1);
  }finally{f.db.close();}
});
test('legacy snapshot PRs also retain draft authority and cannot enter the main landing callback',()=>{
  const db=new DatabaseSync(':memory:'),sql={exec(q,...args){const rows=db.prepare(q).all(...args);return {toArray:()=>rows};}},main={commit:sha('a'),tree:sha('1'),version:1};
  try{
    const store=new ReviewStore(sql,()=>main,false),land=()=>{throw Error('Draft reached main landing');};
    store.run({op:'branch',name:'topic',old:null,next:{commit:sha('b'),tree:sha('2')},source:{name:'main',...main,updatedAt:0},actor:actor.id},land);
    const head=store.branches().find(b=>b.name==='topic'),base=store.branches().find(b=>b.name==='main');
    store.run({op:'open',title:'Snapshot draft',body:'',head,base,anchor:main.commit,anchorTree:main.tree,author:actor,draft:true},land);
    assert.equal(store.snapshot().repositoryMode,false);assert.equal(store.snapshot().pulls[0].draft,true);
    assert.throws(()=>store.run({op:'merge',number:1,head,base:main,anchor:main.commit,request:{owner:actor}},land),/Draft pull requests cannot be merged/);
    assert.equal(store.snapshot().pulls[0].state,'open');assert.equal(main.commit,sha('a'));
  }finally{db.close();}
});
