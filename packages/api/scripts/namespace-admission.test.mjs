import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
const compiled=await build({stdin:{contents:"export * from './src/hub/admission';export * from './src/hub/repository-admission';export * from './src/namespaces/store';",resolveDir:new URL('..',import.meta.url).pathname},bundle:true,platform:'node',format:'esm',write:false});
const {Admission,Namespaces,reserveNamedRepository}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
function fixture(){
 const db=new DatabaseSync(':memory:'),sql={exec(query,...values){const rows=db.prepare(query).all(...values);return {toArray:()=>rows,one:()=>rows[0]};}},storage={transactionSync(action){db.exec('BEGIN');try{const value=action();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}}};
 sql.exec('CREATE TABLE trunks(name TEXT PRIMARY KEY,created INTEGER NOT NULL,source TEXT NOT NULL,owner TEXT)');
 const admission=new Admission(storage,sql),names=new Namespaces(sql);names.claim('alice','owner');names.claim('bob','other');
 const limits={total:10,owner:10,ip:10,creations:100,control:100,agent:100,bodyBytes:4096,seedBytes:4096};
 return {db,sql,storage,admission,names,limits,reserve:(name,policy={creator:'test-ip',limits},namespace='alice',actor='owner')=>reserveNamedRepository(storage,sql,admission,namespace,name,actor,policy)};
}

test('owner, address and deployment quota refusals roll back the name and leave only the original admission',()=>{
 for(const [field,status]of [['owner',429],['ip',429],['total',503]]){
  const f=fixture();try{
   f.limits[field]=1;const first=f.reserve('first');assert.equal(first.ok,true);
   const refused=f.reserve('retryable');assert.equal(refused.ok,false);assert.equal(refused.status,status);assert.equal(f.names.resolve('alice','retryable'),null);
   assert.equal(f.sql.exec('SELECT count(*) AS n FROM repository_addresses').one().n,1);assert.equal(f.sql.exec('SELECT count(*) AS n FROM admissions').one().n,1);
   f.admission.release(first.repository.id,first.ticket);const retry=f.reserve('retryable');assert.equal(retry.ok,true);assert.equal(f.names.resolve('alice','retryable').id,retry.repository.id);
  }finally{f.db.close();}
 }
});

test('a late SQL failure rolls back both records; successful and uncertain reservations keep the same identity and quota',()=>{
 const f=fixture();try{
  f.db.exec("CREATE TRIGGER fail_admission BEFORE INSERT ON admissions BEGIN SELECT RAISE(ABORT,'fixture write failed'); END");assert.throws(()=>f.reserve('late-failure'),/fixture write failed/);assert.equal(f.names.resolve('alice','late-failure'),null);assert.equal(f.sql.exec('SELECT count(*) AS n FROM admissions').one().n,0);
  f.db.exec('DROP TRIGGER fail_admission');const success=f.reserve('retained');assert.equal(success.ok,true);assert.throws(()=>f.reserve('retained'),/already reserved/);assert.equal(f.names.resolve('alice','retained').id,success.repository.id);assert.equal(f.admission.reserve(success.repository.id,'owner','test-ip',f.limits).status,409);
  assert.equal(f.sql.exec('SELECT ticket FROM admissions WHERE name=?',success.repository.id).one().ticket,success.ticket);
 }finally{f.db.close();}
});

test('owner authorization, existing addresses and rename aliases cannot be replaced or consume additional admission',()=>{
 const f=fixture();try{
  assert.throws(()=>f.reserve('denied',undefined,'bob','owner'),/namespace.*owner/);assert.equal(f.names.resolve('bob','denied'),null);
  const first=f.reserve('before');f.names.rename(first.repository.id,'after','owner');assert.throws(()=>f.reserve('before'),/already reserved/);assert.equal(f.names.resolve('alice','before').id,first.repository.id);assert.equal(f.names.resolve('alice','after').id,first.repository.id);
  assert.equal(f.sql.exec('SELECT count(*) AS n FROM admissions').one().n,1);
 }finally{f.db.close();}
});

test('local quota opt-out reserves only the address and does not fabricate a capacity ticket',()=>{
 const f=fixture();try{const result=f.reserve('local',null);assert.equal(result.ok,true);assert.equal(result.ticket,null);assert.equal(f.names.resolve('alice','local').id,result.repository.id);assert.equal(f.sql.exec('SELECT count(*) AS n FROM admissions').one().n,0);}finally{f.db.close();}
});
