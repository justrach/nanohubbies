import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {teamFixture} from './team/fixture.ts';
const f=await teamFixture({}, {vault:true}),trunk='vault-administration',base='/api/trunks/'+trunk,scope={repository:trunk,environment:'staging',actor:'codegraff:owner'};let credentialId='';
try{
 const owner=await f.login('owner','101');await f.json('POST',base,{mode:'git'},owner);
 const delegation=await f.json('POST',base+'/cli-credentials',{label:'Vault administration fixture',scopes:['read','secrets:read','secrets:grant'],days:1},owner);credentialId=delegation.id;
 const provider=await f.provisionSecret(trunk,'staging','TOKEN','synthetic-cloudflare-only-value');
 const metadata=()=>f.json('GET',base+'/secrets',undefined,owner);
 let state=await metadata();assert.equal(state.revision,0);assert.equal(state.clientGrants,'v1');assert.equal(state.nextCleanupAt,null);
 // A legacy UI write participates in the same conditional revision counter.
 await f.json('PUT',base+'/secrets',{name:'TOKEN',binding:provider.binding},owner);state=await metadata();assert.equal(state.revision,1);
 const edit=async(input:Record<string,unknown>,extra:Record<string,unknown>={})=>f.request('POST','/fixture/vault-administration',{scope,input:{credentialId,...input},...extra});
 const connect={operation:'connect',name:'TOKEN',binding:provider.binding,revision:1};
 for(const authority of [{denied:true},{ttl:0},{ttl:60000}]){const response=await edit(connect,authority);assert.equal(response.status,400);assert.equal((await response.json() as {authorityCalls:number}).authorityCalls,1);assert.equal((await metadata()).revision,1);}
 const deniedValue=await edit({...connect,value:'must-not-be-stored'});assert.equal(deniedValue.status,400);
 const stale=await(await edit({...connect,revision:0})).json() as {result:{conflict:boolean}};assert.equal(stale.result.conflict,true);assert.equal((await metadata()).revision,1);
 const changed=await(await edit(connect)).json() as {result:{revision:number};authorityCalls:number};assert.equal(changed.result.revision,2);assert.equal(changed.authorityCalls,1);
 for(const wrongScope of [{...scope,repository:'other'},{...scope,environment:'production'}]){const response=await f.request('POST','/fixture/vault-administration',{scope:wrongScope,input:{credentialId,...connect,revision:0}});assert.equal(response.status,400);}
 const token='nhw_'+randomBytes(32).toString('hex'),grant={operation:'grant',revision:2,id:randomUUID(),hash:createHash('sha256').update(token).digest('hex'),names:['TOKEN'],expires:Date.now()+900000};
 const created=await(await edit(grant)).json() as {result:{grant:{id:string;created:boolean;expires:number}}};assert.equal(created.result.grant.created,true);assert.equal(created.result.grant.expires,grant.expires);
 const values=await f.json('POST',base+'/secrets/read',{}, {Authorization:'Bearer '+token});assert.deepEqual(values.values,{TOKEN:'synthetic-cloudflare-only-value'});
 const recovered=await(await edit({...grant,revision:0})).json() as {result:{grant:{created:boolean;expires:number}}};assert.equal(recovered.result.grant.created,false);assert.equal(recovered.result.grant.expires,grant.expires);
 state=await metadata();assert.equal(state.grants.length,1);assert.equal(state.grants[0].uses,1);assert.ok(state.nextCleanupAt);assert.equal(JSON.stringify(state).includes(token),false);assert.equal(JSON.stringify(state).includes('synthetic-cloudflare-only-value'),false);assert.equal(state.audit.filter((row:any)=>row.action==='cli-grant').length,1);assert.equal(state.audit.find((row:any)=>row.action==='cli-grant').credentialId,credentialId);
 await f.json('DELETE','/api/cli/credentials/'+credentialId,undefined,owner);assert.equal((await f.request('POST',base+'/secrets/read',{}, {Authorization:'Bearer '+token})).status,403,'a child workload grant stops when its issuing CLI delegation is revoked');
 const revoked=await edit({operation:'revoke',id:grant.id});assert.equal(revoked.status,200);assert.equal((await f.request('POST',base+'/secrets/read',{}, {Authorization:'Bearer '+token})).status,403);
 state=await metadata();assert.equal(state.grants.length,0);assert.equal(state.nextCleanupAt,null);assert.equal((await edit(grant)).status,400);assert.equal(await provider.read(),'synthetic-cloudflare-only-value');
 await f.restart();assert.equal((await edit(grant)).status,400,'restart cannot resurrect a revoked saved grant');assert.equal((await metadata()).nextCleanupAt,null);
 const disconnected=await(await edit({operation:'disconnect',revision:2,name:'TOKEN'})).json() as {result:{disconnected:boolean;valueRetainedByCloudflare:boolean;revision:number}};assert.equal(disconnected.result.disconnected,true);assert.equal(disconnected.result.valueRetainedByCloudflare,true);assert.equal(disconnected.result.revision,3);assert.equal((await metadata()).secrets.length,0);assert.equal((await metadata()).nextCleanupAt,null);assert.equal(await provider.read(),'synthetic-cloudflare-only-value');
 console.log('PASS: actual API -> private Vault Worker -> Durable Object authorization callback; conditional legacy/CLI references, provider scope, fixed-expiry recovery, revocation across restart, Cloudflare value retention and no idle alarm');
}finally{await f.close();}
