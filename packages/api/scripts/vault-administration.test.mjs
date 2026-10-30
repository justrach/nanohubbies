import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
const built=await build({entryPoints:[new URL('../../vault/src/administration.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false});
const {VaultAdministration}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const now=1700000000000,scope={repository:'repo',environment:'staging',actor:'owner'},credentialId='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
function fixture(){
 const db=new DatabaseSync(':memory:'),sql={exec(query,...args){const rows=db.prepare(query).all(...args);return{toArray:()=>rows};}};
 sql.exec('CREATE TABLE secret_references(name TEXT PRIMARY KEY,binding TEXT NOT NULL,version INTEGER NOT NULL,updated INTEGER,actor TEXT)');
 sql.exec('CREATE TABLE managed_grants(id TEXT PRIMARY KEY,hash TEXT UNIQUE,names TEXT,expires INTEGER,actor TEXT,uses INTEGER DEFAULT 0)');
 sql.exec('CREATE TABLE audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT,action TEXT,target TEXT,at INTEGER)');
 const store=new VaultAdministration(sql),validate=(name,binding)=>{assert.ok(['TOKEN','OTHER'].includes(name)&&binding==='CF_'+name,'provider scope unavailable');};
 const edit=(input,actor=scope,at=now)=>{db.exec('BEGIN');try{const result=store.edit(actor,{credentialId,...input},validate,at);db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
 const connect=(name='TOKEN')=>edit({operation:'connect',name,binding:'CF_'+name,revision:store.revision()});
 const grant=(extra={})=>edit({operation:'grant',revision:store.revision(),id,hash:'a'.repeat(64),names:['TOKEN'],expires:now+900000,...extra});
 return{db,sql,store,edit,connect,grant};
}
test('reference revisions observe legacy inserts, replacements, updates, deletes and transaction rollback',()=>{
 const f=fixture();try{
  assert.equal(f.store.revision(),0);f.sql.exec('INSERT INTO secret_references VALUES(?,?,?,?,?)','TOKEN','CF_TOKEN',1,now,'owner');assert.equal(f.store.revision(),1);
  f.sql.exec('INSERT OR REPLACE INTO secret_references VALUES(?,?,?,?,?)','TOKEN','CF_TOKEN',2,now,'owner');const replaced=f.store.revision();assert.ok(replaced>1);
  f.sql.exec('UPDATE secret_references SET version=3 WHERE name=?','TOKEN');assert.equal(f.store.revision(),replaced+1);
  f.db.exec('BEGIN');f.sql.exec('DELETE FROM secret_references');assert.equal(f.store.revision(),replaced+2);f.db.exec('ROLLBACK');assert.equal(f.store.revision(),replaced+1);
  f.sql.exec('DELETE FROM secret_references');assert.equal(f.store.revision(),replaced+2);
 }finally{f.db.close();}
});
test('metadata migration is repeatable and preserves legacy references, grants and audit',()=>{
 const f=fixture();try{f.connect();f.sql.exec('INSERT INTO managed_grants VALUES(?,?,?,?,?,?)','legacy','b'.repeat(64),'["TOKEN"]',now+60000,'owner',2);const before=f.db.prepare('SELECT * FROM secret_references').all();new VaultAdministration(f.sql);new VaultAdministration(f.sql);assert.deepEqual(f.db.prepare('SELECT * FROM secret_references').all(),before);assert.equal(f.db.prepare('SELECT uses FROM managed_grants').get().uses,2);assert.equal(f.db.prepare('SELECT credential_id FROM audit').get().credential_id,credentialId);}finally{f.db.close();}
});
test('conditional reference writes reject stale revisions without changing references or audit',()=>{
 const f=fixture();try{const first=f.connect();assert.equal(first.revision,1);const stale=f.edit({operation:'connect',revision:0,name:'TOKEN',binding:'CF_TOKEN'});assert.equal(stale.conflict,true);assert.equal(stale.revision,1);assert.equal(f.db.prepare('SELECT count(*) AS n FROM audit').get().n,1);const removed=f.edit({operation:'disconnect',revision:1,name:'TOKEN'});assert.equal(removed.valueRetainedByCloudflare,true);assert.equal(removed.revision,2);assert.equal(f.db.prepare('SELECT count(*) AS n FROM secret_references').get().n,0);}finally{f.db.close();}
});
test('provider scope failures, plaintext values and unknown input fields cannot mutate metadata',()=>{
 const f=fixture();try{for(const change of [{name:'TOKEN',binding:'WRONG'},{name:'OTHER',binding:'CF_TOKEN'},{name:'bad',binding:'CF_TOKEN'},{name:'TOKEN',binding:'CF_TOKEN',value:'must-never-be-stored'},{name:'TOKEN',binding:'CF_TOKEN',token:'must-never-be-stored'}])assert.throws(()=>f.edit({operation:'connect',revision:0,...change}));assert.equal(f.store.revision(),0);assert.equal(f.db.prepare('SELECT count(*) AS n FROM audit').get().n,0);}finally{f.db.close();}
});
test('fixed-expiry grant recovery is idempotent across a lost acknowledgement and preserves used budget',()=>{
 const f=fixture();try{f.connect();const first=f.grant();assert.equal(first.grant.created,true);f.sql.exec('UPDATE managed_grants SET uses=97 WHERE id=?',id);const second=f.grant({revision:0});assert.equal(second.grant.created,false);assert.equal(second.grant.expires,first.grant.expires);assert.equal(f.db.prepare('SELECT uses FROM managed_grants').get().uses,97);assert.equal(f.db.prepare('SELECT count(*) AS n FROM managed_grants').get().n,1);assert.equal(f.db.prepare("SELECT count(*) AS n FROM audit WHERE action='cli-grant'").get().n,1);assert.ok(!('hash'in second.grant)&&!('token'in second.grant));}finally{f.db.close();}
});
test('recovery binds immutable grant ID, issuer, names, hash and expiry',()=>{
 const f=fixture();try{f.connect();f.connect('OTHER');f.grant();for(const update of [{hash:'c'.repeat(64)},{names:['OTHER']},{expires:now+901000},{credentialId:'33333333-3333-4333-8333-333333333333'}])assert.throws(()=>f.grant(update),/Conflicting/);assert.throws(()=>f.edit({operation:'grant',revision:2,id,hash:'a'.repeat(64),names:['TOKEN'],expires:now+900000},{...scope,actor:'other-admin'}),/Conflicting/);assert.equal(f.db.prepare('SELECT count(*) AS n FROM managed_grants').get().n,1);}finally{f.db.close();}
});
test('revocation leaves a bounded recovery tombstone and cannot be undone by the saved credential file',()=>{
 const f=fixture();try{f.connect();f.grant();const revoked=f.edit({operation:'revoke',id});assert.equal(revoked.revoked,true);assert.equal(f.db.prepare('SELECT count(*) AS n FROM managed_grants').get().n,0);assert.equal(f.db.prepare('SELECT count(*) AS n FROM cli_grant_receipts').get().n,1);assert.throws(()=>f.grant(),/no longer available/);assert.equal(f.edit({operation:'revoke',id}).revoked,true);}finally{f.db.close();}
});
test('expiry and exhausted use budgets prevent recovery; pruning never permits expiry extension',()=>{
 for(const exhausted of [false,true]){const f=fixture();try{f.connect();f.grant();if(exhausted){f.sql.exec('UPDATE managed_grants SET uses=100');assert.throws(()=>f.grant(),/no longer available/);}else{assert.throws(()=>f.edit({operation:'grant',revision:1,id,hash:'a'.repeat(64),names:['TOKEN'],expires:now+900000},scope,now+900001),/expiry/);assert.equal(f.db.prepare('SELECT count(*) AS n FROM cli_grant_receipts').get().n,1);f.store.prune(now+900001);assert.equal(f.db.prepare('SELECT count(*) AS n FROM cli_grant_receipts').get().n,0);}}finally{f.db.close();}}
});
test('disconnect invalidates client and legacy grants for that name while retaining unrelated grants',()=>{
 const f=fixture();try{f.connect();f.connect('OTHER');f.grant();f.sql.exec('INSERT INTO managed_grants VALUES(?,?,?,?,?,?)','legacy','b'.repeat(64),'["TOKEN","OTHER"]',now+60000,'owner',0);f.sql.exec('INSERT INTO managed_grants VALUES(?,?,?,?,?,?)','unrelated','c'.repeat(64),'["OTHER"]',now+60000,'owner',0);f.edit({operation:'disconnect',name:'TOKEN',revision:2});assert.deepEqual(f.db.prepare('SELECT id FROM managed_grants').all().map(r=>r.id),['unrelated']);assert.throws(()=>f.grant({revision:3}),/no longer available/);assert.equal(f.db.prepare('SELECT count(*) AS n FROM cli_grant_receipts').get().n,1);}finally{f.db.close();}
});
test('grant creation validates names, metadata identity and the one-hour expiry bound atomically',()=>{
 const f=fixture();try{f.connect();for(const update of [{names:[]},{names:['TOKEN','TOKEN']},{names:['MISSING']},{names:['bad']},{names:Array(101).fill('TOKEN')},{expires:now},{expires:now+3600001},{expires:NaN},{id:'bad'},{hash:'not-a-digest'},{credentialId:'not-an-id'},{value:'never-store'},{token:'never-store'}])assert.throws(()=>f.grant(update));assert.equal(f.db.prepare('SELECT count(*) AS n FROM managed_grants').get().n,0);assert.equal(f.db.prepare('SELECT count(*) AS n FROM cli_grant_receipts').get().n,0);assert.equal(f.db.prepare('SELECT count(*) AS n FROM audit').get().n,1);}finally{f.db.close();}
});
test('active grant and recovery receipt limits fail closed and expired receipts can be pruned',()=>{
 const f=fixture();try{
  f.connect();const insert=f.db.prepare('INSERT INTO managed_grants VALUES(?,?,?,?,?,?)');for(let n=0;n<100;n++)insert.run('legacy-'+n,String(n).padStart(64,'0'),'["TOKEN"]',now+60000,'owner',0);assert.throws(()=>f.grant(),/Too many active/);assert.equal(f.db.prepare('SELECT count(*) AS n FROM cli_grant_receipts').get().n,0);f.sql.exec('DELETE FROM managed_grants');
  const ledger=f.db.prepare('INSERT INTO cli_grant_receipts VALUES(?,?,?,?,?,?)');for(let n=0;n<1000;n++)ledger.run('old-'+n,'owner','b'.repeat(64),'["TOKEN"]',now+1000,credentialId);assert.throws(()=>f.grant(),/Too many recent/);assert.equal(f.db.prepare('SELECT count(*) AS n FROM managed_grants').get().n,0);f.store.prune(now+1001);assert.equal(f.db.prepare('SELECT count(*) AS n FROM cli_grant_receipts').get().n,0);assert.equal(f.grant().grant.created,true);
 }finally{f.db.close();}
});
test('legacy ID/hash collisions cannot overwrite existing grants or create orphan receipts',()=>{
 const f=fixture();try{f.connect();f.sql.exec('INSERT INTO managed_grants VALUES(?,?,?,?,?,?)',id,'b'.repeat(64),'["TOKEN"]',now+60000,'owner',7);assert.throws(()=>f.grant());assert.equal(f.db.prepare('SELECT uses FROM managed_grants').get().uses,7);assert.equal(f.db.prepare('SELECT count(*) AS n FROM cli_grant_receipts').get().n,0);}finally{f.db.close();}
});
