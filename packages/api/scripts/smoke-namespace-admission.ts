/** Real local Worker/SQLite/D1/R2 acceptance. Never uses hosted bindings. */
import assert from 'node:assert/strict';
import {teamFixture} from './team/fixture.ts';
const defaults={ABUSE_PROTECTION:'1',TRUNK_MAX_TOTAL:'100',TRUNK_MAX_PER_OWNER:'100',TRUNK_MAX_PER_IP:'100',TRUNK_CREATIONS_PER_HOUR:'100',CONTROL_REQUESTS_PER_MINUTE:'1000'};
async function fixture(overrides:Record<string,string>,work:(f:Awaited<ReturnType<typeof teamFixture>>,owner:{cookie:string},hub:any)=>Promise<void>){
 const f=await teamFixture({...defaults,...overrides});try{const owner=await f.login('owner','101');await f.json('POST','/api/namespaces',{name:'alice'},owner);const ns=await f.mf.getDurableObjectNamespace('HUB');await work(f,owner,ns.get(ns.idFromName('hub')));}finally{await f.close();}
}
for(const [limit,status,match]of [['TRUNK_MAX_PER_OWNER',429,/your trunk quota/],['TRUNK_MAX_PER_IP',429,/address.*quota/],['TRUNK_MAX_TOTAL',503,/capacity reached/]]as const)await fixture({[limit]:'1'},async(f,owner,hub)=>{
 const first=await f.json('POST','/api/repos/alice/first',{},owner);
 const refused=await f.request('POST','/api/repos/alice/retryable',{},owner);assert.equal(refused.status,status);assert.match((await refused.json()as any).error,match);assert.equal(await hub.resolveRepository('alice','retryable'),null);
 // Refusal preserves both quota policy and the ability to retry the same name.
 assert.equal((await f.request('POST','/api/repos/alice/retryable',{},owner)).status,status);
 await f.json('DELETE','/api/trunks/'+first.id,undefined,owner);
 const retried=await f.json('POST','/api/repos/alice/retryable',{},owner);assert.equal(retried.fullName,'alice/retryable');assert.notEqual(retried.id,first.id);assert.equal((await f.json('GET','/api/repos/alice/retryable',undefined,owner)).id,retried.id);
});
await fixture({TRUNK_CREATIONS_PER_HOUR:'1'},async(f,owner,hub)=>{
 await f.json('POST','/api/repos/alice/first',{},owner);const refused=await f.request('POST','/api/repos/alice/rate-refused',{},owner);assert.equal(refused.status,429);assert.match((await refused.json()as any).error,/creation rate/);assert.equal(await hub.resolveRepository('alice','rate-refused'),null);
});
await fixture({TRUNK_MAX_PER_OWNER:'1'},async(f,owner,hub)=>{
 const responses=await Promise.all(['race-a','race-b'].map(name=>f.request('POST','/api/repos/alice/'+name,{},owner)));assert.equal(responses.filter(r=>r.status===201).length,1);assert.equal(responses.filter(r=>r.status===429).length,1);
 for(let i=0;i<responses.length;i++)assert.equal(!!await hub.resolveRepository('alice',i===0?'race-a':'race-b'),responses[i].status===201);
});
for(const mode of ['old','missing','malformed','malformed-success'])await fixture({},async(f,owner,hub)=>{
 await f.json('POST','/fixture/repository-creation-fault',{mode});const refused=await f.request('POST','/api/repos/alice/rolling-upgrade',{},owner);assert.equal(refused.status,503,await refused.clone().text());assert.match((await refused.json()as any).error,/updating/);assert.equal(await hub.resolveRepository('alice','rolling-upgrade'),null);
 await f.json('POST','/fixture/repository-creation-fault',{mode:null});assert.equal((await f.request('POST','/api/repos/alice/rolling-upgrade',{},owner)).status,201);
});
for(const mode of ['lost-admission','lost-init'])await fixture({TRUNK_MAX_PER_OWNER:'1'},async(f,owner,hub)=>{
 await f.json('POST','/fixture/repository-creation-fault',{mode});const refused=await f.request('POST','/api/repos/alice/uncertain',{},owner);assert.ok(!refused.ok);const reserved=await hub.resolveRepository('alice','uncertain');assert.ok(reserved?.id);assert.equal(await hub.find(reserved.id),null);
 await f.json('POST','/fixture/repository-creation-fault',{mode:null});assert.equal((await f.request('POST','/api/repos/alice/uncertain',{},owner)).status,400);assert.equal((await f.request('POST','/api/repos/alice/other',{},owner)).status,429);assert.equal((await hub.resolveRepository('alice','uncertain')).id,reserved.id);
});
await fixture({TRUNK_MAX_PER_OWNER:'1'},async(f,owner,hub)=>{
 await f.json('POST','/fixture/repository-creation-fault',{mode:'lost-http'});assert.equal((await f.request('POST','/api/repos/alice/completed',{},owner)).status,503);await f.json('POST','/fixture/repository-creation-fault',{mode:null});
 const existing=await f.json('GET','/api/repos/alice/completed',undefined,owner);assert.ok(await hub.find(existing.id));assert.equal((await f.request('POST','/api/repos/alice/completed',{},owner)).status,400);assert.equal((await f.json('GET','/api/repos/alice/completed',undefined,owner)).id,existing.id);assert.equal((await f.request('POST','/api/repos/alice/other',{},owner)).status,429);
});
await fixture({},async(f,owner,hub)=>{
 for(const body of [{ticket:'forged'},{mode:'git'},{admission:{ticket:'forged'}},{defaultBranch:'bad..branch'}]){assert.equal((await f.request('POST','/api/repos/alice/invalid',body,owner)).status,400);assert.equal(await hub.resolveRepository('alice','invalid'),null);}
 const bob=await f.login('bob','202');assert.equal((await f.request('POST','/api/repos/alice/denied',{},bob)).status,400);assert.equal(await hub.resolveRepository('alice','denied'),null);
});
console.log('PASS: named repository admission atomically preserves quota and retryable names; owner/IP/global/rate refusals, concurrent requests, older/missing receivers, retained uncertain admission/init, lost completed acknowledgement, forged tickets and owner boundaries. No production mutations.');
