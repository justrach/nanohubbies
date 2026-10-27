import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
const directory=await mkdtemp(join(tmpdir(),'nh-default-unit-'));after(()=>rm(directory,{recursive:true,force:true}));
await build({entryPoints:['repository/store','repository/rulesets','repository/policy','review/store','ci/store','connect'].map(path=>new URL('../src/'+path+'.ts',import.meta.url).pathname),bundle:true,platform:'node',format:'esm',outdir:directory,outExtension:{'.js':'.mjs'}});
const load=path=>import(pathToFileURL(join(directory,path+'.mjs')));
const {Repository}=await load('repository/store'),{Rulesets,applies}=await load('repository/rulesets'),{Policies}=await load('repository/policy'),{ReviewStore}=await load('review/store'),{CIStore}=await load('ci/store'),{firstPushCommand}=await load('connect');
const sha=c=>c.repeat(40),a={commit:sha('a'),tree:sha('1')},b={commit:sha('b'),tree:sha('2')},c={commit:sha('c'),tree:sha('3')};
function fixture(branch='main') {const db=new DatabaseSync(':memory:'),sql={exec(q,...args){const rows=db.prepare(q).all(...args);return {toArray:()=>rows};}};sql.exec('CREATE TABLE versions (version INTEGER PRIMARY KEY,commit_sha TEXT,tree_sha TEXT)');const repo=new Repository(sql);repo.initialize(branch);repo.update('refs/heads/'+branch,null,a,true,'owner');return {db,sql,repo};}
test('initial default and selected default retain every Git ref and history, with CAS and no-op protection',()=>{
 const f=fixture('trunk/日本語');try {
  f.repo.update('refs/heads/release',null,b,true,'owner');const before=f.repo.refs(),revision=f.repo.configuration().revision,rules=new Rulesets(f.sql).plan().revision;
  const result=f.repo.selectDefault('release',b.commit,revision,'owner');assert.equal(result.defaultBranch,'release');assert.equal(result.revision,revision+1);assert.deepEqual(f.repo.refs(),before);assert.equal(f.repo.main().commit,b.commit);assert.equal(new Rulesets(f.sql).plan().revision,rules+1);
  const version=f.repo.main().version;assert.deepEqual(f.repo.selectDefault('release',b.commit,result.revision,'owner'),result);assert.equal(f.repo.main().version,version);
  assert.equal(f.repo.selectDefault('trunk/日本語',a.commit,revision,'owner').conflict,true);assert.equal(f.repo.defaultBranch(),'release');
  assert.throws(()=>f.repo.selectDefault('missing',a.commit,result.revision,'owner'),/unavailable/);assert.throws(()=>f.repo.selectDefault('trunk/日本語',b.commit,result.revision,'owner'),/changed/);
  assert.throws(()=>f.repo.update('refs/heads/release',b.commit,null,false,'owner'),/default branch/);f.repo.update('refs/heads/trunk/日本語',a.commit,null,false,'owner');assert.equal(f.repo.refs().length,1);
 }finally{f.db.close();}
});
test('DEFAULT_BRANCH rules follow the pointer and invalidate earlier graph proofs; exact protections retain their branch',()=>{
 const f=fixture();try {
  f.repo.update('refs/heads/develop',null,b,true,'owner');const rules=new Rulesets(f.sql),rule=rules.set({name:'Default lock',target:'branch',enforcement:'active',conditions:{ref_name:{include:['~DEFAULT_BRANCH'],exclude:[]}},rules:[{type:'update'}]});
  new Policies(f.sql).set({branch:'main',locked:true,pullRequest:false,approvals:0,checks:[],beforeOpen:[],preventForce:true,preventDelete:true});
  rules.remove(rule.id);const metadata=rules.set({name:'Default metadata',target:'branch',enforcement:'active',conditions:{ref_name:{include:['~DEFAULT_BRANCH'],exclude:[]}},rules:[{type:'commit_message_pattern',parameters:{operator:'starts_with',pattern:'feat:'}}]});
  const plan=rules.plan();f.repo.selectDefault('develop',b.commit,f.repo.configuration().revision,'owner');assert.equal(rules.plan().defaultBranch,'develop');assert.ok(rules.plan().revision>plan.revision);
  assert.equal(applies(rule,'refs/heads/main',f.repo.defaultBranch()),false);assert.equal(applies(rule,'refs/heads/develop',f.repo.defaultBranch()),true);
  const oldProof={old:b.commit,next:c.commit,rules:{revision:plan.revision,ref:'refs/heads/develop',violations:[]}};assert.throws(()=>f.repo.update('refs/heads/develop',b.commit,c,true,'owner',false,oldProof),/evidence/);rules.remove(metadata.id);rules.set({name:'Default lock',target:'branch',enforcement:'active',conditions:rule.conditions,rules:rule.rules});
  assert.throws(()=>f.repo.update('refs/heads/develop',b.commit,c,true,'owner'),/updates are restricted/);assert.throws(()=>f.repo.update('refs/heads/main',a.commit,c,true,'owner'),/locked/);
 }finally{f.db.close();}
});
test('existing PR targets survive selection and merge into their own branch using the current trusted workflow base',()=>{
 const f=fixture();try {
  f.repo.update('refs/heads/develop',null,b,true,'owner');f.repo.update('refs/heads/feature',null,c,true,'author');
  const membership={accounts:{owner:'writer',author:'writer'},checkedAt:Date.now(),expiresAt:Date.now()+30000},store=new ReviewStore(f.sql,()=>f.repo.main(),true,membership);
  const branches=store.branches(),head=branches.find(x=>x.name==='feature'),base=branches.find(x=>x.name==='main');
  store.run({op:'open',title:'Keep original target',body:'',head,base,anchor:a.commit,anchorTree:a.tree,author:{id:'author',name:'author'}},()=>{});
  new Policies(f.sql).set({branch:'main',pullRequest:true,approvals:0,checks:['test'],beforeOpen:[],preventForce:true,preventDelete:true});
  f.repo.selectDefault('develop',b.commit,0,'owner');assert.equal(store.snapshot().pulls[0].base,'main');assert.equal(store.snapshot().ciBase,b.commit);
  const merge=()=>store.run({op:'merge',number:1,head,base:{...a,version:1},anchor:a.commit,candidate:{...c,base:a.commit},request:{owner:{id:'owner'}},human:true},()=>{throw Error('Git merge cannot rewrite the candidate');});
  assert.throws(merge,/Required check/);const ci=new CIStore(f.sql),runner=ci.runner('current-default');ci.enqueue('feature',c.commit,b.commit);
  let run;for(;;){run=ci.claim(runner.token);assert.ok(run);ci.complete(runner.token,run.id,run.attempt,[{name:'test',state:'success',command:'test',log:'',artifacts:[]}],null);if(run.head===c.commit&&run.base===b.commit)break;}
  const merged=merge().pulls[0];assert.equal(merged.state,'merged');assert.equal(merged.base,'main');assert.equal(merged.mergedBase,a.commit);assert.equal(merged.mergedCIBase,b.commit);assert.equal(merged.mergedVersion,null);assert.equal(f.repo.main().commit,b.commit);assert.equal(f.repo.refs().find(x=>x.name==='refs/heads/main').commit,c.commit);
 }finally{f.db.close();}
});
test('first-push instructions quote literal default names as full refspecs',()=>{
 for(const branch of ['trunk',"日本語/'-$USER;$(touch-SENTINEL)"]){const command=firstPushCommand(branch);assert.ok(command.startsWith("git push --set-upstream origin 'HEAD:refs/heads/"));assert.ok(command.endsWith("'"));if(branch.includes("'"))assert.ok(command.includes("'\\''"));}
});
