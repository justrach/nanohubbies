import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
const built=await build({stdin:{contents:`export * from './src/contributions/store';export * from './src/repository/archive';`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,platform:'node',format:'esm',write:false});
const {Contributions,ArchiveStore}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const a={id:'agent-a',handle:'builder',type:'Codex',owner:{id:'owner-a',name:'Alice'}},b={id:'agent-b',handle:'builder',type:'Custom agent',owner:{id:'owner-b',name:'Bob'}};
function fixture(){const db=new DatabaseSync(':memory:'),sql={exec(query,...args){const rows=db.prepare(query).all(...args);return{toArray:()=>rows};}},store=new Contributions(sql);const tx=fn=>{db.exec('BEGIN');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};return{db,sql,store,tx};}
const start=(extra={})=>({sessionId:crypto.randomUUID(),title:'Review parser edge cases',...extra});
const report=(sessionId,extra={})=>({sessionId,eventId:crypto.randomUUID(),state:'working',summary:'Checked the empty input path',links:[],...extra});
test('start/report retries are idempotent and immutable profile attribution does not follow a reused handle',()=>{
 const f=fixture();try{const input=start({client:{name:'Generic MCP client',model:'Reported model'}}),work=f.tx(()=>f.store.start(a,input));assert.deepEqual(f.store.start(a,input),work);assert.throws(()=>f.store.start(a,{...input,title:'Different'}),/different work/);assert.throws(()=>f.store.start(b,input),/not found/);
  const update=report(work.id,{state:'completed'}),done=f.tx(()=>f.store.report(a,update));assert.deepEqual(f.store.report(a,update),done);assert.throws(()=>f.store.report(a,{...update,summary:'Different'}),/different update/);assert.throws(()=>f.store.report(a,report(work.id)),/complete/);assert.throws(()=>f.store.report(b,report(work.id)),/not found/);assert.throws(()=>f.store.get(work.id,b.id),/not found/);
  f.store.start(b,start());const page=f.store.page();assert.equal(page.events.length,3);assert.equal(page.agentCount,2);assert.equal(page.agents.find(row=>row.agent.id===a.id).sessions,1);assert.equal(page.events.find(row=>row.kind==='work_reported').agent.owner.name,'Alice');assert.equal(page.events.find(row=>row.kind==='work_reported').client.model,'Reported model');
 }finally{f.db.close();}
});
test('owned reports preserve profile snapshots, normalize duplicate links, and bound cumulative artifacts',()=>{
 const f=fixture();try{const work=f.store.start(a,start()),links=Array.from({length:20},(_,i)=>({kind:'commit',sha:i.toString(16).padStart(40,'0')}));f.store.report(a,report(work.id,{links}));const again=f.store.report({...a,type:'Changed label'},report(work.id,{links}));assert.equal(again.links.length,20);assert.equal(again.agent.type,'Codex');assert.equal(f.store.page().events[0].agent.type,'Codex');assert.throws(()=>f.store.report(a,report(work.id,{links:[{kind:'pull',number:1}]})),/20/);assert.equal(f.store.get(work.id).links.length,20);
 }finally{f.db.close();}
});
test('invalid identity fields, states, event data and artifacts cannot become work records',()=>{
 const f=fixture();try{for(const input of [start({sessionId:'not-a-uuid'}),start({title:' '}),start({title:'x'.repeat(161)}),start({agent:b}),start({client:{name:'client',verified:true}}),start({client:{name:'client',model:'x'.repeat(121)}})])assert.throws(()=>f.store.start(a,input));assert.equal(f.store.page().events.length,0);
  const work=f.store.start(a,start());for(const extra of [{eventId:'bad'},{state:'approved'},{summary:' '},{summary:'x'.repeat(4001)},{agent:b},{links:[{kind:'commit',sha:'bad'}]},{links:[{kind:'pull',number:-1}]},{links:[{kind:'pull',number:1,verified:true}]}])assert.throws(()=>f.store.report(a,report(work.id,extra)));assert.equal(f.store.page().events.length,1);
 }finally{f.db.close();}
});
test('artifact filters compose with stable cursors and count only linked agent activity',()=>{
 const f=fixture();try{const work=f.store.start(a,start()),sha='a'.repeat(40);f.store.report(a,report(work.id,{links:[{kind:'pull',number:4}]}));f.store.push(a,'refs/heads/feature',null,sha,sha);f.store.start(b,start());f.store.report(b,report(f.store.page().events[0].sessionId,{links:[{kind:'pull',number:9}]}));
  const page=f.store.page({limit:2});assert.equal(page.events.length,2);assert.ok(page.nextCursor);const older=f.store.page({before:page.nextCursor,limit:2});assert.ok(older.events.every(event=>event.seq<page.nextCursor));
  const linked=f.store.page({pull:4,commit:sha,limit:1});assert.equal(linked.events.length,1);assert.equal(linked.agentCount,1);assert.equal(linked.agents[0].agent.id,a.id);assert.equal(linked.agents[0].sessions,1);assert.equal(linked.agents[0].pushes,1);assert.equal(f.store.page({pull:4,commit:sha,before:linked.nextCursor}).events.length,1);assert.equal(f.store.page({pull:500}).agentCount,0);
  for(const filter of [{limit:0},{limit:51},{before:-1},{commit:'bad'},{pull:1.5}])assert.throws(()=>f.store.page(filter));
 }finally{f.db.close();}
});
test('a late event failure rolls back session state, links and contributor totals together',()=>{
 const f=fixture();try{const work=f.tx(()=>f.store.start(a,start()));f.sql.exec("CREATE TRIGGER reject_work BEFORE INSERT ON agent_work_events WHEN json_extract(NEW.data,'$.kind')='work_reported' BEGIN SELECT RAISE(ABORT,'synthetic event failure'); END");assert.throws(()=>f.tx(()=>f.store.report(a,report(work.id,{state:'completed',links:[{kind:'pull',number:1}]}))),/synthetic event failure/);assert.equal(f.store.get(work.id).state,'working');assert.equal(f.store.page().events.length,1);assert.equal(f.store.page().agents[0].sessions,1);assert.equal(f.sql.exec('SELECT COUNT(*) AS n FROM agent_work_links').toArray()[0].n,0);
 }finally{f.db.close();}
});
test('archive freezes work mutations while preserving completed history and reads',()=>{
 const f=fixture();try{const work=f.store.start(a,start());f.store.report(a,report(work.id,{state:'completed'}));const before=f.store.page();new ArchiveStore(f.sql).prepare(true,0,'owner-a');assert.throws(()=>f.store.start(a,start()),/archived/);assert.throws(()=>f.store.report(a,report(work.id)),/archived/);assert.deepEqual(f.store.page(),before);assert.equal(f.store.get(work.id,a.id).state,'completed');
 }finally{f.db.close();}
});
