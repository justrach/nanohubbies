import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
const names=['repository/ruleset-history','repository/store','repository/rulesets'];
const built=await build({entryPoints:names.map(n=>new URL(`../src/${n}.ts`,import.meta.url).pathname),bundle:true,platform:'node',format:'esm',write:false,outdir:'/virtual'});
const [{RulesetHistory},{Repository},{Rulesets}]=await Promise.all(built.outputFiles.map(o=>import('data:text/javascript;base64,'+Buffer.from(o.text).toString('base64'))));
const input={name:'Release tags',target:'tag',enforcement:'active',conditions:{ref_name:{include:['refs/tags/v*'],exclude:[]}},bypass_actors:[],rules:[{type:'creation'},{type:'deletion'}]};
function fixture(){
 const db=new DatabaseSync(':memory:');
 const sql={exec(q,...args){const rows=db.prepare(q).all(...args);return{toArray:()=>rows};}};
 sql.exec('CREATE TABLE versions(version INTEGER PRIMARY KEY,commit_sha TEXT,tree_sha TEXT)');
 const repo=new Repository(sql);repo.initialize();
 const rules=new Rulesets(sql),history=new RulesetHistory(sql);
 const audit=event=>{repo.audit({actor:'owner',...event});return sql.exec('SELECT last_insert_rowid() AS id').toArray()[0].id;};
 const restore=(...args)=>{db.exec('BEGIN');try{const r=history.restore(...args);db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
 return{db,sql,repo,rules,history,audit,restore};
}
test('restoring a saved version reinstates enforcement and audits source/current/new configurations',()=>{
 const f=fixture();try{
  const original=f.rules.set(input),eventId=f.audit({ruleset:original,previousRuleset:null});
  const changed=f.rules.set({...input,enforcement:'disabled'},original.id);f.audit({ruleset:changed,previousRuleset:original});
  f.repo.update('refs/tags/v1',null,{commit:'a'.repeat(40),tree:''},false,'writer');
  const preview=f.history.preview(original.id,eventId);
  assert.equal(preview.current.enforcement,'disabled');assert.equal(preview.selected.enforcement,'active');
  const result=f.restore(original.id,eventId,preview.revision,'admin');
  assert.equal(result.ruleset.id,original.id);assert.equal(result.revision,preview.revision+1);
  assert.throws(()=>f.repo.update('refs/tags/v2',null,{commit:'a'.repeat(40),tree:''},false,'writer'),/creation is restricted/);
  const event=f.repo.activity({ruleset:original.id}).events[0];
  assert.equal(event.actor,'admin');assert.deepEqual(event.previousRuleset,changed);assert.deepEqual(event.ruleset,original);
  assert.deepEqual(event.restoredFrom,{rulesetId:original.id,eventId});
 }finally{f.db.close();}
});
test('any intervening rules change rejects a stale comparison without mutating rules or history',()=>{
 const f=fixture();try{
  const rule=f.rules.set(input),eventId=f.audit({ruleset:rule,previousRuleset:null});
  const preview=f.history.preview(rule.id,eventId);
  f.rules.set({...input,name:'Concurrent policy'});
  const before=f.rules.plan(),events=f.repo.activity();
  const result=f.restore(rule.id,eventId,preview.revision,'admin');
  assert.equal(result.conflict,true);assert.deepEqual(f.rules.plan(),before);assert.deepEqual(f.repo.activity(),events);
  for(const revision of [undefined,-1,'1',1.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>f.restore(rule.id,eventId,revision,'admin'),/revision/);
 }finally{f.db.close();}
});
test('deleted rulesets recreate with a new ID and preserve their original history link and bypass configuration',()=>{
 const f=fixture();try{
  const old=f.rules.set({...input,bypass_actors:[{actor_type:'User',actor_id:'owner',bypass_mode:'always'}]});
  f.audit({ruleset:old,previousRuleset:null});f.rules.remove(old.id);
  const deletion=f.audit({removedRuleset:old.id,previousRuleset:old});
  const preview=f.history.preview(old.id,deletion);assert.equal(preview.current,null);
  const result=f.restore(old.id,deletion,preview.revision,'admin');
  assert.ok(result.ruleset.id>old.id);assert.deepEqual(result.ruleset.bypass_actors,old.bypass_actors);
  const linked=f.repo.activity({kind:'rulesets',ruleset:old.id}).events[0];
  assert.equal(linked.ruleset.id,result.ruleset.id);assert.equal(linked.previousRuleset,null);
  assert.deepEqual(linked.restoredFrom,{rulesetId:old.id,eventId:deletion});
  assert.equal(f.rules.plan().rulesets.some(r=>r.id===old.id),false);
 }finally{f.db.close();}
});
test('unrelated, missing and unsupported historical snapshots fail closed; recreation obeys the ruleset limit',()=>{
 const f=fixture();try{
  const r=f.rules.set(input),eventId=f.audit({ruleset:r,previousRuleset:null});
  const unrelated=f.audit({ref:'refs/tags/test',old:null,next:'a'.repeat(40)});
  for(const [id,event] of [[r.id,unrelated],[r.id+1,eventId],[r.id,99999],[0,eventId],[r.id,NaN]])assert.throws(()=>f.history.preview(id,event));
  const unsupported=f.audit({ruleset:{...r,rules:[{type:'unsupported_future_restriction'}]}});
  const before=f.rules.plan(),auditCount=f.repo.activity().events.length;
  assert.throws(()=>f.restore(r.id,unsupported,before.revision,'admin'),/Unsupported/);
  assert.deepEqual(f.rules.plan(),before);assert.equal(f.repo.activity().events.length,auditCount);
  f.rules.remove(r.id);
  for(let n=0;n<100;n++)f.rules.set({...input,name:`Other ${n}`});
  assert.throws(()=>f.restore(r.id,eventId,f.rules.plan().revision,'admin'),/At most 100/);
  assert.equal(f.rules.plan().rulesets.length,100);
 }finally{f.db.close();}
});
