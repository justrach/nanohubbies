import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
const output = await build({ entryPoints: [new URL('../src/review/store.ts', import.meta.url).pathname, new URL('../src/repository/store.ts', import.meta.url).pathname, new URL('../src/ci/store.ts', import.meta.url).pathname, new URL('../src/repository/policy.ts', import.meta.url).pathname, new URL('../src/repository/validate.ts', import.meta.url).pathname, new URL('../src/repository/pattern.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false, outdir: '/virtual' });
const modules = await Promise.all(output.outputFiles.map(o => import('data:text/javascript;base64,' + Buffer.from(o.text).toString('base64'))));
const { ReviewStore } = modules[0], { Repository } = modules[1], { CIStore } = modules[2];
const {Policies}=modules[3],{refProof}=modules[4],{matchesBranch}=modules[5];
const sha = c => c.repeat(40);
function fixture() {
  const db = new DatabaseSync(':memory:');
  const sql = { exec(q, ...args) { const rows = db.prepare(q).all(...args); return { toArray: () => rows }; } };
  sql.exec('CREATE TABLE versions (version INTEGER PRIMARY KEY, commit_sha TEXT, tree_sha TEXT)');
  const repo = new Repository(sql); repo.initialize(); repo.update('refs/heads/main', null, { commit: sha('a'), tree: sha('1') }, false, 'owner');
  const ci = new CIStore(sql), runner = ci.runner('trusted');
  const initial=ci.claim(runner.token);if(initial)ci.complete(runner.token,initial.id,initial.attempt,[],null);
  const reviews = new ReviewStore(sql, () => repo.main(), true,{accounts:{reviewer:"writer",author:"writer",agent:"writer",other:"writer",another:"writer"},checkedAt:Date.now(),expiresAt:Date.now()+30000});
  return { db, sql, repo, ci, runner, reviews };
}
const policy = { branch: 'main', pullRequest: true, approvals: 1, checks: ['test'], beforeOpen: [], preventForce: true, preventDelete: true };
function setPolicy(f, p=policy) { f.sql.exec('CREATE TABLE IF NOT EXISTS branch_policies (branch TEXT PRIMARY KEY,data TEXT NOT NULL)'); f.sql.exec('INSERT OR REPLACE INTO branch_policies VALUES (?,?)', p.branch, JSON.stringify(p)); }
function open(f) {
  f.repo.update('refs/heads/feature', null, { commit: sha('b'), tree: sha('2') }, true, 'author');
  const branches = f.reviews.snapshot().branches;
  f.reviews.run({ op:'open', title:'Change', body:'', head:branches[0].name === 'feature' ? branches[0] : branches[1], base:branches.find(b=>b.name==='main'), anchor:sha('a'), anchorTree:sha('1'), author:{id:'author',name:'Author'} }, () => { throw Error('unexpected landing'); });
}
function approve(f, author='reviewer', independent=true, commit=sha('b')) { f.reviews.run({op:'review',number:1,author:{id:author,name:author},verdict:'APPROVE',body:'',commit,anchor:sha('a'),independent},()=>{}); }
function complete(f) { const run=f.ci.claim(f.runner.token); f.ci.complete(f.runner.token,run.id,run.attempt,[{name:'test',state:'success',command:'bun run test',log:'https://logs.invalid/run',artifacts:[]}],null); return run; }
function merge(f) { const s=f.reviews.snapshot(); return f.reviews.run({op:'merge',number:1,head:s.branches.find(b=>b.name==='feature'),base:f.repo.main(),anchor:sha('a'),candidate:{commit:s.branches.find(b=>b.name==='feature').commit,tree:s.branches.find(b=>b.name==='feature').tree,base:sha('a')},request:{owner:{id:'owner'}}},()=>{ throw Error('must preserve Git candidate'); }); }
test('protection rejects direct writes, self/agent approvals and missing checks; exact candidate merges',()=>{
  const f=fixture(); try {
    open(f); setPolicy(f);
    assert.throws(()=>f.repo.update('refs/heads/main',sha('a'),{commit:sha('c'),tree:sha('3')},true,'agent'),/protected/);
    assert.throws(()=>merge(f),/independent/); approve(f,'author'); approve(f,'agent',false); assert.throws(()=>merge(f),/independent/);
    approve(f); assert.throws(()=>merge(f),/Required check/); complete(f);
    const s=merge(f); assert.equal(s.pulls[0].mergedCommit,sha('b')); assert.equal(f.repo.main().commit,sha('b'));
  } finally { f.db.close(); }
});
test('leases retry idempotently, reject forged/stale completion, and revoke read access',()=>{
  const f=fixture(); try {
    open(f); const first=f.ci.claim(f.runner.token,1000); assert.ok(first.readToken); assert.equal(f.ci.readable(first.readToken,1001),true);
    const next=f.ci.claim(f.runner.token,first.leaseUntil+1); assert.equal(next.id,first.id); assert.equal(next.attempt,2); assert.equal(f.ci.readable(first.readToken,1001),false);
    assert.throws(()=>f.ci.complete('ordinary-agent',next.id,2,[],null),/credential/);
    assert.throws(()=>f.ci.complete(f.runner.token,next.id,1,[],null),/Stale/);
    const now=first.leaseUntil+2;
    const result=f.ci.complete(f.runner.token,next.id,2,[],null,now); assert.equal(result.state,'complete');
    assert.equal(f.ci.complete(f.runner.token,next.id,2,[],null,now).state,'complete');
    assert.equal(f.ci.readable(next.readToken,now),false);
  } finally { f.db.close(); }
});
test('new head, anchor, change request, and base movement invalidate review/check gates',()=>{
  const f=fixture(); try {
    open(f); setPolicy(f); approve(f); complete(f);
    f.repo.update('refs/heads/feature',sha('b'),{commit:sha('c'),tree:sha('3')},true,'author');
    assert.throws(()=>merge(f),/independent/);
    f.repo.update('refs/heads/feature',sha('c'),{commit:sha('b'),tree:sha('2')},true,'author');
    assert.throws(()=>merge(f),/independent/); approve(f); assert.throws(()=>merge(f),/Required check/);
    f.reviews.run({op:'review',number:1,author:{id:'reviewer',name:'R'},verdict:'REQUEST_CHANGES',body:'fix',commit:sha('b'),anchor:sha('a'),independent:true},()=>{});
    assert.throws(()=>merge(f),/requested changes/);
  } finally { f.db.close(); }
});
test('staging requires exact version, real acceptance and an actual deployment run',()=>{
  const f=fixture(); try {
    open(f); const run=f.ci.claim(f.runner.token), result=[{name:'staging',state:'success',command:'deploy and verify',log:'https://logs.invalid',artifacts:[]}];
    assert.throws(()=>f.ci.complete(f.runner.token,run.id,1,result,null),/staging requires/);
    const evidence={runId:'deploy-1',head:run.head,candidate:run.head,base:run.base,version:sha('c'),verifiedAt:Date.now(),acceptance:[{url:'https://evidence.invalid',realService:true}]};
    assert.throws(()=>f.ci.complete(f.runner.token,run.id,1,result,evidence),/exact candidate/);
    evidence.version=run.head; f.ci.complete(f.runner.token,run.id,1,result,evidence);
    assert.equal(f.ci.require('feature',run.head,run.base,['staging']).staging.runId,'deploy-1');
    assert.throws(()=>f.ci.require('feature',run.head,sha('d'),['staging']),/Required check/);
  } finally { f.db.close(); }
});

test('policy changes and concurrent ref updates are rechecked at the final write',()=>{
  const f=fixture();try {
    open(f);setPolicy(f);approve(f);complete(f);
    setPolicy(f,{...policy,approvals:2});assert.throws(()=>merge(f),/2 independent/);
    assert.throws(()=>f.repo.update('refs/heads/feature',sha('c'),{commit:sha('d'),tree:sha('4')},true,'author'),/Ref changed/);
    setPolicy(f,{...policy,branch:'feature',pullRequest:false,approvals:0,checks:[]});
    assert.throws(()=>f.repo.update('refs/heads/feature',sha('b'),null,false,'author'),/cannot be deleted/);
    assert.throws(()=>f.repo.update('refs/heads/feature',sha('b'),{commit:sha('d'),tree:sha('4')},false,'author'),/fast-forward/);
  }finally {f.db.close();}
});
test('pre-PR gate runs from branch events and applies before opening a pull request',()=>{
 const f=fixture();try {
   setPolicy(f,{...policy,beforeOpen:['test']});
   assert.throws(()=>open(f),/Required check/);
   complete(f); const b=f.reviews.snapshot().branches;
   f.reviews.run({op:'open',title:'Verified before PR',body:'',head:b.find(r=>r.name==='feature'),base:b.find(r=>r.name==='main'),anchor:sha('a'),anchorTree:sha('1'),author:{id:'author',name:'A'}},()=>{});
   assert.equal(f.reviews.snapshot().pulls.length,1);
 }finally {f.db.close();}
});

test('staging approval is pinned to the current head and base and invalidates prior leases',()=>{
 const f=fixture();try {
   open(f);const run=f.ci.list()[0];
   assert.throws(()=>f.ci.approveDeployment(run.id,'owner',sha('c'),run.base),/Candidate changed/);
   assert.throws(()=>f.ci.approveDeployment(run.id,'owner',run.head,sha('d')),/Candidate changed/);
   const approved=f.ci.approveDeployment(run.id,'owner',run.head,run.base);assert.equal(approved.deploymentApprovedBy,'owner');
   const lease=f.ci.claim(f.runner.token);assert.equal(lease.deploymentApprovedBy,'owner');
   assert.throws(()=>f.ci.approveDeployment(run.id,'owner',run.head,run.base),/Wait for current/);
 }finally {f.db.close();}
});

test('overlapping branch patterns cannot weaken requirements, and slash matching is explicit',()=>{
  const f=fixture();try{
    assert.equal(matchesBranch('release/*','release/v1'),true);
    assert.equal(matchesBranch('release/*','release/v1/patch'),false);
    assert.equal(matchesBranch('release/**','release/v1/patch'),true);
    assert.equal(matchesBranch('**/stable','stable'),true);
    assert.equal(matchesBranch('**/stable','release/v1/stable'),true);
    assert.equal(matchesBranch('fix/?','fix/ab'),false);
    const policies=new Policies(f.sql);
    policies.set({...policy,branch:'release/**',allowPush:['owner','reviewer']});
    policies.set({...policy,branch:'release/v1',approvals:2,checks:['build'],allowPush:['owner']});
    const effective=policies.get('release/v1');
    assert.equal(effective.approvals,2);assert.deepEqual(effective.checks,['test','build']);assert.deepEqual(effective.allowPush,['owner']);
    assert.throws(()=>policies.set({...policy,branch:'bad[^pattern]'}),/pattern|branch|glob/);
    policies.remove('release/v1');assert.equal(policies.get('release/v1').approvals,1);
  }finally{f.db.close();}
});
test('branch locks and allowed pushers apply to direct writes and approved PR merges',()=>{
  const f=fixture();try{
    open(f);setPolicy(f,{...policy,approvals:0,checks:[],locked:true});
    assert.throws(()=>merge(f),/locked/);
    assert.throws(()=>f.repo.update('refs/heads/main',sha('a'),{commit:sha('c'),tree:sha('3')},true,'owner'),/locked/);
    setPolicy(f,{...policy,approvals:0,checks:[],allowPush:['reviewer']});assert.throws(()=>merge(f),/not allowed/);
    setPolicy(f,{...policy,approvals:0,checks:[],allowPush:['owner']});assert.equal(merge(f).pulls[0].state,'merged');
  }finally{f.db.close();}
});
test('latest-push approval excludes its pusher and invalidates a review after the same SHA is repushed',()=>{
  const f=fixture();try{
    open(f);setPolicy(f,{...policy,checks:[],approvals:0,requireLastPushApproval:true});
    approve(f);f.repo.update('refs/heads/feature',sha('b'),{commit:sha('c'),tree:sha('3')},true,'reviewer');
    approve(f,'reviewer',true,sha('c'));assert.throws(()=>merge(f),/other than its pusher/);
    f.repo.update('refs/heads/feature',sha('c'),{commit:sha('b'),tree:sha('2')},false,'author');
    assert.throws(()=>merge(f),/other than its pusher/);
    approve(f);assert.equal(merge(f).pulls[0].state,'merged');
  }finally{f.db.close();}
});
test('new pushes cannot hide unresolved conversations or outstanding change requests',()=>{
  const f=fixture();try{
    open(f);setPolicy(f,{...policy,checks:[],approvals:0,requireConversationResolution:true});
    f.sql.exec('CREATE TABLE code_comments(id TEXT PRIMARY KEY,commit_sha TEXT,data TEXT)');
    f.sql.exec('INSERT INTO code_comments VALUES(?,?,?)','thread',sha('b'),JSON.stringify({replyTo:null,resolved:false}));
    f.repo.update('refs/heads/feature',sha('b'),{commit:sha('c'),tree:sha('3')},true,'author');
    assert.throws(()=>merge(f),/outdated threads/);
    f.sql.exec('UPDATE code_comments SET data=?',JSON.stringify({replyTo:null,resolved:true}));
    f.reviews.run({op:'review',number:1,author:{id:'reviewer',name:'R'},verdict:'REQUEST_CHANGES',body:'fix',commit:sha('c'),anchor:sha('a'),independent:true},()=>{});
    f.repo.update('refs/heads/feature',sha('c'),{commit:sha('d'),tree:sha('4')},true,'author');
    assert.throws(()=>merge(f),/requested changes/);
    approve(f,'reviewer',true,sha('d'));assert.equal(merge(f).pulls[0].state,'merged');
  }finally{f.db.close();}
});
test('linear-history evidence checks all introduced commits and is bound to both ref ends',async()=>{
  const object=(parents=[])=>({type:'commit',body:new TextEncoder().encode(`tree ${sha('1')}\n${parents.map(p=>`parent ${p}\n`).join('')}author Fixture <f@example.invalid> 1 +0000\ncommitter Fixture <f@example.invalid> 1 +0000\n\nSynthetic\n`)});
  const graph=new Map([[sha('a'),object()],[sha('b'),object([sha('a')])],[sha('c'),object([sha('a'),sha('b')])],[sha('d'),object([sha('c')])],[sha('e'),object([sha('d')])]]);
  const get=async sha=>graph.get(sha)??null;
  assert.equal((await refProof(get,sha('a'),sha('d'))).linear,false,'merge below tip is still introduced');
  assert.equal((await refProof(get,sha('d'),sha('e'))).linear,true,'pre-existing merge ancestry is excluded');
  const f=fixture();try{
    setPolicy(f,{...policy,pullRequest:false,approvals:0,checks:[],requireLinearHistory:true});
    assert.throws(()=>f.repo.update('refs/heads/main',sha('a'),{commit:sha('d'),tree:sha('1')},true,'owner',false),/linear history/);
    assert.throws(()=>f.repo.update('refs/heads/main',sha('a'),{commit:sha('d'),tree:sha('1')},true,'owner',false,{old:sha('b'),next:sha('d'),linear:true}),/linear history/);
    const proof=await refProof(get,sha('a'),sha('d'));
    assert.throws(()=>f.repo.update('refs/heads/main',sha('a'),{commit:sha('d'),tree:sha('1')},true,'owner',false,proof),/linear history/);
  }finally{f.db.close();}
});

test('the latest pusher never satisfies the independent approval count',()=>{
 const f=fixture();try{
   open(f);setPolicy(f,{...policy,checks:[]});
   f.repo.update('refs/heads/feature',sha('b'),{commit:sha('c'),tree:sha('3')},true,'reviewer');
   approve(f,'reviewer',true,sha('c'));assert.throws(()=>merge(f),/independent approval/);
   approve(f,'another',true,sha('c'));assert.equal(merge(f).pulls[0].state,'merged');
 }finally{f.db.close();}
});

test('runner pool claims every queued candidate beyond the 200-run UI window without duplicates',()=>{
 const f=fixture();try{
  const base=sha('a');
  for(let i=0;i<260;i++)f.ci.enqueue(`pool-${i}`,i.toString(16).padStart(40,'0'),base);
  const tokens=Array.from({length:8},(_,i)=>f.ci.runner(`pool-worker-${i}`).token),claimed=[];
  for(let i=0;i<260;i++)claimed.push(f.ci.claim(tokens[i%tokens.length]));
  assert.equal(new Set(claimed.map(r=>r.id)).size,260);assert.equal(claimed[0].branch,'pool-0');
  assert.equal(f.ci.claim(tokens[0]),null);
  const first=claimed[0];f.ci.complete(tokens[0],first.id,first.attempt,[{name:'test',state:'success',command:'bun run test',log:'https://logs.invalid',artifacts:[]}],null);
  assert.equal(f.ci.require(first.branch,first.head,base,['test']).id,first.id,'required checks are not limited to the UI history window');
  f.ci.baseMoved(sha('b'));
  assert.equal(f.ci.readable(claimed[1].readToken),false);assert.equal(f.ci.claim(tokens[1]),null,'old candidates outside history window are superseded too');
 }finally{f.db.close();}
});
test('revoking one runner immediately releases leases to another without accepting stale attempts',()=>{
 const f=fixture();try{
  const a=f.ci.runner('worker-a'),b=f.ci.runner('worker-b');
  const queued=f.ci.enqueue('topic',sha('b'),sha('a')),first=f.ci.claim(a.token);
  assert.equal(first.id,queued.id);f.ci.revoke(a.id);assert.equal(f.ci.readable(first.readToken),false);
  const next=f.ci.claim(b.token);assert.equal(next.id,first.id);assert.equal(next.attempt,first.attempt+1);
  assert.throws(()=>f.ci.complete(a.token,first.id,first.attempt,[],null),/credential/);
  assert.throws(()=>f.ci.complete(b.token,next.id,first.attempt,[],null),/Stale/);
 }finally{f.db.close();}
});
