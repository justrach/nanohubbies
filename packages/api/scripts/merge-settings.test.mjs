import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
const directory=await mkdtemp(join(tmpdir(),'nh-merge-settings-'));after(()=>rm(directory,{recursive:true,force:true}));
await build({entryPoints:['repository/store','repository/merge-settings','repository/archive','review/store'].map(path=>new URL('../src/'+path+'.ts',import.meta.url).pathname),bundle:true,platform:'node',format:'esm',outdir:directory,outExtension:{'.js':'.mjs'}});
const load=path=>import(pathToFileURL(join(directory,path+'.mjs')));
const {Repository}=await load('repository/store'),{MergeSettingsStore}=await load('repository/merge-settings'),{ArchiveStore}=await load('repository/archive'),{ReviewStore}=await load('review/store');
const sha=c=>c.repeat(40),a={commit:sha('a'),tree:sha('1')},b={commit:sha('b'),tree:sha('2')};
function fixture(){const db=new DatabaseSync(':memory:'),sql={exec(q,...args){const rows=db.prepare(q).all(...args);return {toArray:()=>rows};}};sql.exec('CREATE TABLE versions (version INTEGER PRIMARY KEY,commit_sha TEXT,tree_sha TEXT)');const repo=new Repository(sql);repo.initialize();repo.update('refs/heads/main',null,a,true,'owner');return {db,sql,repo,settings:new MergeSettingsStore(sql)};}
const value=(allowedMethods=['fast-forward','squash'],defaultMethod='squash')=>({allowedMethods,defaultMethod});

test('existing repositories retain all merge methods and fast-forward default until an explicit revision-checked edit',()=>{
 const f=fixture();try{
  assert.deepEqual(f.settings.get(),{allowedMethods:['fast-forward','merge','squash','rebase'],defaultMethod:'fast-forward',revision:0});
  const refs=f.repo.refs(),configuration=f.repo.configuration();
  const next=f.settings.set(value(['squash','fast-forward']),0,'admin',{kind:'cli',credentialId:'credential-1'});
  assert.deepEqual(next,{...value(),revision:1});assert.deepEqual(f.repo.refs(),refs);assert.deepEqual(f.repo.configuration(),configuration);
  assert.deepEqual(f.settings.set(value(),1,'admin'),next,'No-op edits do not increment a revision');
  assert.equal(f.settings.set(value(['merge'],'merge'),0,'admin').conflict,true);assert.deepEqual(f.settings.get(),next);
  const events=f.repo.activity({kind:'settings'}).events;assert.equal(events.length,1);assert.equal(events[0].actor,'admin');assert.equal(events[0].via.credentialId,'credential-1');assert.deepEqual(events[0].mergeSettings.next,next);
 }finally{f.db.close();}
});
test('invalid or empty allowlists, duplicate methods and excluded defaults leave the settings and audit unchanged',()=>{
 const f=fixture();try{
  const before=f.settings.get(),events=f.repo.activity().events;
  for(const input of [value([]),value(['unknown'],'unknown'),value(['squash','squash']),value(['merge'],'squash'),{allowedMethods:'merge',defaultMethod:'merge'},value([null],null)])assert.throws(()=>f.settings.set(input,0,'admin'),/at least one valid/);
  for(const revision of [-1,NaN,1.5,'0'])assert.throws(()=>f.settings.set(value(),revision,'admin'),/observed/);
  assert.deepEqual(f.settings.get(),before);assert.deepEqual(f.repo.activity().events,events);
 }finally{f.db.close();}
});
test('storage revisions survive raw SQL, ABA edits, trigger repair and rollback',()=>{
 const f=fixture();try{
  f.settings.set(value(),0,'admin');
  f.sql.exec("UPDATE repository_merge_settings SET default_method='fast-forward' WHERE id=1");
  f.sql.exec("UPDATE repository_merge_settings SET default_method='squash' WHERE id=1");
  assert.equal(f.settings.get().revision,3);assert.equal(f.settings.set(value(['rebase'],'rebase'),1,'admin').conflict,true);
  f.sql.exec('BEGIN');f.sql.exec("UPDATE repository_merge_settings SET default_method='fast-forward' WHERE id=1");f.sql.exec('ROLLBACK');assert.equal(f.settings.get().revision,3);
  f.sql.exec('DROP TRIGGER repository_merge_update');const repaired=new MergeSettingsStore(f.sql);assert.equal(repaired.get().revision,4);assert.equal(repaired.set(value(),3,'admin').conflict,true);
 }finally{f.db.close();}
});
test('missing or corrupt stored settings fail closed rather than reset the allowed methods',()=>{
 const f=fixture();try{
  f.settings.set(value(['squash']),0,'admin');
  f.sql.exec('DELETE FROM repository_merge_settings');assert.throws(()=>new MergeSettingsStore(f.sql).get(),/unavailable/);
  assert.equal(f.sql.exec('SELECT 1 FROM repository_merge_settings').toArray().length,0);
  f.sql.exec('INSERT INTO repository_merge_settings VALUES (1,?,?)','["squash"]','squash');assert.equal(f.settings.get().revision,3);
  f.sql.exec("UPDATE repository_merge_settings SET allowed_methods='[]'");assert.throws(()=>f.settings.get(),/at least one valid/);
 }finally{f.db.close();}
});
test('archive fences block settings changes without blocking reads or changing prior preferences',()=>{
 const f=fixture();try{
  const before=f.settings.set(value(),0,'admin');new ArchiveStore(f.sql).apply({id:'archive',archived:true,revision:1,actor:'owner',at:Date.now()});
  assert.throws(()=>f.settings.set(value(['merge'],'merge'),1,'admin'),/archived/);assert.deepEqual(f.settings.get(),before);
 }finally{f.db.close();}
});
test('invalid stored revisions cannot become an apparently current settings observation',()=>{
 for(const revision of [-1,'invalid',Number.MAX_SAFE_INTEGER+1]){
  const f=fixture();try{f.sql.exec('UPDATE repository_merge_revision SET revision=? WHERE id=1',revision);assert.throws(()=>f.settings.get(),error=>error instanceof RangeError||/revision is unavailable/.test(error.message));}finally{f.db.close();}
 }
});
test('allowed methods are enforced again at the final review writer, including legacy and stale callers',()=>{
 const f=fixture();try{
  f.repo.update('refs/heads/feature',null,b,true,'author');
  const membership={accounts:{owner:'writer',author:'writer'},checkedAt:Date.now(),expiresAt:Date.now()+30000};
  const review=new ReviewStore(f.sql,()=>f.repo.main(),true,membership),head=review.branches().find(x=>x.name==='feature'),base=review.branches().find(x=>x.name==='main');
  review.run({op:'open',title:'Method policy',body:'',head,base,anchor:a.commit,anchorTree:a.tree,author:{id:'author',name:'Author'}},()=>{});
  const command={op:'merge',number:1,head,base:{...a,version:1},anchor:a.commit,candidate:{...b,base:a.commit},request:{owner:{id:'owner'}},human:true};
  f.settings.set(value(['squash']),0,'admin');
  assert.throws(()=>review.run(command,()=>{}),/disabled/);
  assert.deepEqual(review.snapshot().mergeMethods,['squash']);assert.equal(review.snapshot().mergeSettings.defaultMethod,'squash');
  f.settings.set(value(['fast-forward'],'fast-forward'),1,'admin');
  assert.throws(()=>review.run(command,()=>{}),/settings changed/);
  assert.throws(()=>review.run({...command,mergeSettingsRevision:0},()=>{}),/settings changed/);
  assert.equal(f.repo.main().commit,a.commit);assert.equal(review.snapshot().pulls[0].state,'open');
  const merged=review.run({...command,mergeSettingsRevision:2},()=>{});assert.equal(merged.pulls[0].state,'merged');assert.equal(f.repo.main().commit,b.commit);
 }finally{f.db.close();}
});
test('repository PR method preferences do not prohibit ordinary Git pushes, while lower-level merge writes recheck them',()=>{
 const f=fixture();try{
  f.settings.set(value(['squash']),0,'admin');
  assert.throws(()=>f.repo.update('refs/heads/main',a.commit,b,true,'owner',true),/disabled/);
  f.repo.update('refs/heads/main',a.commit,b,true,'owner');assert.equal(f.repo.main().commit,b.commit);
 }finally{f.db.close();}
});
