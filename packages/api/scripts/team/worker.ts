/** Test-only entrypoint. It is never referenced by either Wrangler config. */
import api,{Sequencer as ProductionSequencer,Room as ProductionRoom} from "../../src/index";
import type {ArchiveChange} from "../../src/repository/archive-types";
import {MergeSettingsStore,type MergeSettingsInput} from '../../src/repository/merge-settings';
import { sessionCookie, settings, type User } from "../../src/auth";
import {RpcTarget} from 'cloudflare:workers';
import {revokeCliCredential} from '../../src/cli/credentials';
export * from "../../src/index";
let dropNextRunnerAcknowledgement=false;
let dropNextCollaboratorAcknowledgement=false;
let dropNextDeploymentAcknowledgement=false;
let dropImportAcknowledgement:string|null=null;
let dropNextSecretGrantAcknowledgement=false;
let dropNextBranchRenameAcknowledgement=false;
let repositoryCreationFault:string|null=null;
let vaultAuthorityRace:{trunk:string;actor:string;owner:string;credentialId?:string;role?:'reader'|'writer'}|null=null;
let workloadAuthorityRace:{trunk:string;actor:string;owner:string}|null=null;
const importPosts={objects:0,refs:0};
class FixtureVaultAuthority extends RpcTarget {
  calls=0;
  constructor(private ttl:number,private denied:boolean){super();}
  async authorize(){this.calls++;if(this.denied)throw Error('Synthetic current-authority denial');return Date.now()+this.ttl;}
}

/** Test-only lost-RPC injection; neither Wrangler entrypoint exports this class. */
export class Sequencer extends ProductionSequencer {
  pullReadinessFault(mode:string){
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS fixture_pull_readiness_fault (id INTEGER PRIMARY KEY,mode TEXT)');
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO fixture_pull_readiness_fault VALUES(1,?)',mode);
  }
  private missingPullReadiness(mode:string){
    const sql=this.ctx.storage.sql;
    return sql.exec("SELECT 1 FROM sqlite_master WHERE name='fixture_pull_readiness_fault'").toArray().length>0&&sql.exec<{mode:string}>('SELECT mode FROM fixture_pull_readiness_fault WHERE id=1').toArray()[0]?.mode===mode;
  }
  pullReadinessConfiguration(){
    if(this.missingPullReadiness('read'))throw Error('The RPC receiver does not implement the method "pullReadinessConfiguration".');
    return super.pullReadinessConfiguration();
  }
  async openDraftPull(...args:Parameters<ProductionSequencer['openDraftPull']>){
    if(this.missingPullReadiness('open'))throw Error('The RPC receiver does not implement the method "openDraftPull".');
    return super.openDraftPull(...args);
  }
  async editPullReadiness(...args:Parameters<ProductionSequencer['editPullReadiness']>){
    if(this.missingPullReadiness('edit'))throw Error('The RPC receiver does not implement the method "editPullReadiness".');
    return super.editPullReadiness(...args);
  }
  branchRenameFault(input:{missingRead?:boolean;missingWrite?:boolean;late?:boolean;legacy?:{branch:string;commit:string;tree:string}}){
    return this.ctx.storage.transactionSync(()=>{
      const sql=this.ctx.storage.sql;
      sql.exec('CREATE TABLE IF NOT EXISTS fixture_branch_rename_receiver (id INTEGER PRIMARY KEY,missing_read INTEGER NOT NULL,missing_write INTEGER NOT NULL)');
      sql.exec('INSERT OR REPLACE INTO fixture_branch_rename_receiver VALUES (1,?,?)',Number(input.missingRead===true),Number(input.missingWrite===true));
      sql.exec('DROP TRIGGER IF EXISTS fixture_branch_rename_late');
      if(input.late)sql.exec("CREATE TRIGGER fixture_branch_rename_late BEFORE INSERT ON repository_branch_renames BEGIN SELECT RAISE(ABORT,'synthetic late rename failure'); END");
      if(input.legacy)sql.exec('UPDATE repository_refs SET commit_sha=?,tree_sha=? WHERE name=?',input.legacy.commit,input.legacy.tree,'refs/heads/'+input.legacy.branch);
      return {armed:true};
    });
  }
  private branchRenameMissing(kind:'missing_read'|'missing_write'){
    const sql=this.ctx.storage.sql;
    return !!sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fixture_branch_rename_receiver'").toArray().length&&!!sql.exec<{missing:number}>('SELECT '+kind+' AS missing FROM fixture_branch_rename_receiver WHERE id=1').toArray()[0]?.missing;
  }
  branchRenameConfiguration(){
    if(this.branchRenameMissing('missing_read'))throw Error('The RPC receiver does not implement the method "branchRenameConfiguration".');
    return super.branchRenameConfiguration();
  }
  resolveRenamedBranch(name:string){
    if(this.branchRenameMissing('missing_read'))throw Error('The RPC receiver does not implement the method "resolveRenamedBranch".');
    return super.resolveRenamedBranch(name);
  }
  async renameRepositoryBranch(...args:Parameters<ProductionSequencer['renameRepositoryBranch']>){
    if(this.branchRenameMissing('missing_write'))throw Error('The RPC receiver does not implement the method "renameRepositoryBranch".');
    return super.renameRepositoryBranch(...args);
  }
  legacyRequestStorage(input:{operation:'review'|'request'|'drop-answer'|'audit-failure'|'audit-recover';number:number;data?:Record<string,unknown>}){
    return this.ctx.storage.transactionSync(()=>{
      const sql=this.ctx.storage.sql;
      if(input.operation==='drop-answer')sql.exec('DROP TRIGGER review_request_answer_v2');
      else if(input.operation==='audit-failure')sql.exec("CREATE TRIGGER fixture_request_audit_failure BEFORE INSERT ON repository_audit WHEN json_extract(NEW.data,'$.reviewRequest.operation')='answer' BEGIN SELECT RAISE(ABORT,'synthetic answer audit failure'); END");
      else if(input.operation==='audit-recover')sql.exec('DROP TRIGGER fixture_request_audit_failure');
      else if(input.operation==='review'){
        // Exact storage statement from the pre-request ReviewStore. This path
        // deliberately never constructs RequestedReviews or calls answer().
        sql.exec('INSERT INTO review_reviews(pull,data) VALUES(?,?)',input.number,JSON.stringify(input.data));
      }else if(input.operation==='request'){
        const id=String(input.data?.reviewer);
        sql.exec('INSERT INTO review_requests VALUES(?,?,?) ON CONFLICT(pull,reviewer) DO UPDATE SET data=excluded.data',input.number,id,JSON.stringify(input.data));
        // v1 performed its own increment, in addition to retained v2 hooks.
        sql.exec('INSERT INTO review_request_revisions VALUES(?,1) ON CONFLICT(pull) DO UPDATE SET revision=revision+1',input.number);
      }else throw Error('Unknown synthetic legacy operation');
      return {ok:true};
    });
  }
  missingSharedHeadReceiver(missing:boolean) {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS fixture_merge_receiver (id INTEGER PRIMARY KEY, missing INTEGER NOT NULL)");
    this.ctx.storage.sql.exec("INSERT INTO fixture_merge_receiver VALUES (1,?) ON CONFLICT(id) DO UPDATE SET missing=excluded.missing",Number(missing));
  }
  async mergeReviewedPull(command:Parameters<ProductionSequencer['mergeReviewedPull']>[0]) {
    const sql=this.ctx.storage.sql;
    if(sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fixture_merge_receiver'").toArray().length&&sql.exec<{missing:number}>("SELECT missing FROM fixture_merge_receiver WHERE id=1").toArray()[0]?.missing)
      throw Error('The RPC receiver does not implement the method "mergeReviewedPull".');
    return super.mergeReviewedPull(command);
  }
  async mergePullWithMethod(command:Parameters<ProductionSequencer['mergePullWithMethod']>[0]) {
    const sql=this.ctx.storage.sql;
    if(sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fixture_merge_receiver'").toArray().length&&sql.exec<{missing:number}>("SELECT missing FROM fixture_merge_receiver WHERE id=1").toArray()[0]?.missing)
      throw Error('The RPC receiver does not implement the method "mergePullWithMethod".');
    return super.mergePullWithMethod(command);
  }
  async mergePullWithSettings(command:Parameters<ProductionSequencer['mergePullWithSettings']>[0]) {
    const sql=this.ctx.storage.sql;
    if(sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fixture_merge_receiver'").toArray().length&&sql.exec<{missing:number}>("SELECT missing FROM fixture_merge_receiver WHERE id=1").toArray()[0]?.missing)
      throw Error('The RPC receiver does not implement the method "mergePullWithSettings".');
    if(sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fixture_merge_settings_race'").toArray().length){
      const pending=sql.exec<{data:string}>('SELECT data FROM fixture_merge_settings_race WHERE id=1').toArray()[0];
      if(pending)this.ctx.storage.transactionSync(()=>{sql.exec('DELETE FROM fixture_merge_settings_race');const store=new MergeSettingsStore(sql);store.set(JSON.parse(pending.data),store.get().revision,'race-fixture');});
    }
    return super.mergePullWithSettings(command);
  }
  mergeSettingsBeforeMerge(input:MergeSettingsInput) {
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS fixture_merge_settings_race (id INTEGER PRIMARY KEY, data TEXT NOT NULL)');
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO fixture_merge_settings_race VALUES (1,?)',JSON.stringify(input));
  }
  legacyDefault(change:{branch:string;manualCounter?:boolean;rollback?:boolean}) {
    return this.ctx.storage.transactionSync(()=>{
      this.ctx.storage.sql.exec("UPDATE repository_config SET default_branch=? WHERE id=1",change.branch);
      if(change.manualCounter)this.ctx.storage.sql.exec("UPDATE repository_settings_revision SET revision=revision+1 WHERE id=1");
      if(change.rollback)throw Error("Synthetic legacy default rollback");
    });
  }
  legacyRuleset(change:{id:number;configuration?:import("../../src/repository/ruleset-types").RulesetInput;manualCounter?:boolean;rollback?:boolean}) {
    return this.ctx.storage.transactionSync(()=>{
      const sql=this.ctx.storage.sql;
      if(change.configuration)sql.exec("UPDATE repository_rulesets SET data=? WHERE id=?",JSON.stringify(change.configuration),change.id);
      else sql.exec("DELETE FROM repository_rulesets WHERE id=?",change.id);
      if(change.manualCounter)sql.exec("UPDATE repository_rules_revision SET revision=revision+1 WHERE id=1");
      if(change.rollback)throw Error("Synthetic legacy ruleset rollback");
    });
  }
  legacyProtection(change:{branch:string;policy?:import("../../src/repository/types").BranchPolicy;manualCounter?:boolean;rollback?:boolean}) {
    return this.ctx.storage.transactionSync(()=>{
      const sql=this.ctx.storage.sql;
      if(change.policy)sql.exec("INSERT INTO branch_policies VALUES (?,?) ON CONFLICT(branch) DO UPDATE SET data=excluded.data",change.branch,JSON.stringify(change.policy));
      else sql.exec("DELETE FROM branch_policies WHERE branch=?",change.branch);
      // The first CLI protection release incremented in application code;
      // older builds did not. Neither path invokes the current policy store.
      if(change.manualCounter)sql.exec("UPDATE branch_policy_revision SET revision=revision+1 WHERE id=1");
      if(change.rollback)throw Error("Synthetic legacy writer transaction rollback");
    });
  }
  applyRepositoryArchive(change:ArchiveChange) {
    const failure=(this.env as Env&{ARCHIVE_TEST_FAILURE?:string}).ARCHIVE_TEST_FAILURE;
    if(failure&&["before","after","unarchive-before","unarchive-after"].includes(failure)&&(failure.startsWith("unarchive")?!change.archived:change.archived)) {
      const sql=this.ctx.storage.sql;sql.exec("CREATE TABLE IF NOT EXISTS archive_test_fault (id INTEGER PRIMARY KEY)");
      if(!sql.exec("SELECT 1 FROM archive_test_fault").toArray().length) {
        sql.exec("INSERT INTO archive_test_fault VALUES (1)");
        if(failure.endsWith("after"))super.applyRepositoryArchive(change);
        throw Error("Synthetic archive RPC interruption");
      }
    }
    return super.applyRepositoryArchive(change);
  }
}

export class Room extends ProductionRoom {
  async applyRepositoryArchive(trunk:string,change:ArchiveChange) {
    if((this.env as Env&{ARCHIVE_TEST_FAILURE?:string}).ARCHIVE_TEST_FAILURE==="room-before"&&change.archived) {
      const sql=this.ctx.storage.sql;sql.exec("CREATE TABLE IF NOT EXISTS archive_test_fault (id INTEGER PRIMARY KEY)");
      if(!sql.exec("SELECT 1 FROM archive_test_fault").toArray().length){sql.exec("INSERT INTO archive_test_fault VALUES (1)");throw Error("Synthetic Room archive interruption");}
    }
    return super.applyRepositoryArchive(trunk,change);
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if(url.pathname==='/fixture/repository-creation-fault'){
      const {mode}=await request.json<{mode:string|null}>();if(mode!==null&&!['old','missing','malformed','malformed-success','lost-admission','lost-init','lost-http'].includes(mode))return new Response('Unknown fixture mode',{status:400});repositoryCreationFault=mode;return Response.json({armed:mode});
    }
    if(repositoryCreationFault&&request.method==='POST'&&/^\/api\/repos\/[^/]+\/[^/]+$/.test(url.pathname)){
      const mode=repositoryCreationFault;
      const wrap=(binding:any,method:string,override:any)=>new Proxy(binding,{get(target,key){
        if(key==='get')return(...ids:any[])=>{const stub=target.get(...ids);return new Proxy(stub,{get(object,member){if(member===method)return(...args:any[])=>override((...values:any[])=>object[member](...values),args);const value=Reflect.get(object,member);return typeof value==='function'? (...values:any[])=>object[member](...values):value;}});};
        const value=Reflect.get(target,key);return typeof value==='function'? (...values:any[])=>target[key](...values):value;
      }});
      const wrapped=new Proxy(env,{get(target,key){
        if(key==='HUB'&&['old','missing'].includes(mode))return wrap(env.HUB,'repositoryCreationConfiguration',async()=>{if(mode==='missing')throw Error('Synthetic missing receiver');return {namedAdmission:'legacy'};});
        if(key==='HUB'&&['malformed','malformed-success'].includes(mode))return wrap(env.HUB,'reserveRepositoryCreation',async()=>mode==='malformed'?{}:{ok:true,repository:{id:'wrong'},ticket:null});
        if(key==='HUB'&&mode==='lost-admission')return wrap(env.HUB,'reserveRepositoryCreation',async(invoke:any,args:any[])=>{const result=await invoke(...args);if(result.ok)throw Error('Synthetic lost admission acknowledgement');return result;});
        if(key==='SEQUENCER'&&mode==='lost-init')return wrap(env.SEQUENCER,'initRepository',async(invoke:any,args:any[])=>{await invoke(...args);throw Error('Synthetic lost initialization acknowledgement');});
        return Reflect.get(target,key);
      }});
      const response=await api.fetch(request,wrapped);
      if(mode==='lost-http'&&response.ok){await response.body?.cancel();return Response.json({error:'Synthetic lost repository acknowledgement'},{status:503});}return response;
    }
    if(url.pathname==='/fixture/branch-rename-fault'){
      const body=await request.json<{trunk:string;missingRead?:boolean;missingWrite?:boolean;late?:boolean;legacy?:{branch:string;commit:string;tree:string}}>();
      return Response.json(await (env.SEQUENCER.get(env.SEQUENCER.idFromName(body.trunk)) as unknown as {branchRenameFault:(input:typeof body)=>Promise<unknown>}).branchRenameFault(body));
    }
    if(url.pathname==='/fixture/conditional-branch-rename'){
      const body=await request.json<import('../../src/repository/branch-rename-types').BranchRenameInput&{trunk:string;actor:string;credentialId?:string}>();
      const seq=env.SEQUENCER.get(env.SEQUENCER.idFromName(body.trunk)),plan=await seq.graphPlan();
      try{return Response.json(await seq.renameRepositoryBranch(body,body.actor,url.origin,
        {old:null,next:body.commit,linear:true,rules:{revision:plan.revision,ref:'refs/heads/'+body.to,fileTransitions:true,violations:[]}},
        {old:body.commit,next:body.commit,linear:true,rules:{revision:plan.revision,ref:'refs/heads/'+body.from,violations:[]}},body.credentialId));
      }catch(error){return Response.json({error:(error as Error).message},{status:400});}
    }
    if(url.pathname==='/fixture/drop-branch-rename-acknowledgement'){dropNextBranchRenameAcknowledgement=true;return Response.json({armed:true});}
    if(dropNextBranchRenameAcknowledgement&&request.method==='POST'&&/^\/api\/cli\/(trunks|repos)\/.+\/branch-rename$/.test(url.pathname)){
      dropNextBranchRenameAcknowledgement=false;const response=await api.fetch(request,env);if(!response.ok)return response;await response.body?.cancel();return Response.json({error:'Synthetic lost branch rename acknowledgement'},{status:503});
    }
    if(url.pathname==='/fixture/vault-legacy-read'){
      const body=await request.json<{scope:import('../../../vault/src/provider').VaultScope;token:string;method:'principal'|'redeem'}>();
      const vault=env.VAULT as unknown as import('../../../vault/src/index').VaultService;
      try{const value=await vault[body.method](body.scope,body.token);try{return Response.json(value);}finally{(value as unknown as {[Symbol.dispose]?:()=>void})[Symbol.dispose]?.();}}catch{return Response.json({error:'Legacy redemption denied'},{status:403});}
    }
    if(url.pathname==='/fixture/workload-authority-race'){workloadAuthorityRace=await request.json();return Response.json({armed:true});}
    if(workloadAuthorityRace&&request.method==='POST'&&url.pathname==='/api/trunks/'+workloadAuthorityRace.trunk+'/secrets/read'){
      const race=workloadAuthorityRace;workloadAuthorityRace=null;const service=env.VAULT as unknown as import('../../../vault/src/index').VaultService;
      const vault={principalInfo:(...args:Parameters<typeof service.principalInfo>)=>service.principalInfo(...args),redeemAuthorized:async(...args:Parameters<typeof service.redeemAuthorized>)=>{
        await env.HUB.get(env.HUB.idFromName('hub')).changeCollaborator(race.trunk,race.owner,race.actor,'writer');return service.redeemAuthorized(...args);
      }};
      return api.fetch(request,new Proxy(env,{get(target,key){return key==='VAULT'?vault:Reflect.get(target,key);}}));
    }
    if(url.pathname==='/fixture/drop-secret-grant-acknowledgement'){dropNextSecretGrantAcknowledgement=true;return Response.json({armed:true});}
    if(url.pathname==='/fixture/vault-authority-race'){vaultAuthorityRace=await request.json();return Response.json({armed:true});}
    if(vaultAuthorityRace&&request.method!=='GET'&&url.pathname.includes('/api/cli/trunks/'+vaultAuthorityRace.trunk+'/secrets/')){
      const race=vaultAuthorityRace;vaultAuthorityRace=null;const service=env.VAULT as unknown as import('../../../vault/src/index').VaultService;
      const vault={administer:async(...args:Parameters<typeof service.administer>)=>{
        if(race.credentialId)await revokeCliCredential(env,race.actor,race.credentialId);
        if(race.role)await env.HUB.get(env.HUB.idFromName('hub')).changeCollaborator(race.trunk,race.owner,race.actor,race.role);
        return service.administer(...args);
      }};
      return api.fetch(request,new Proxy(env,{get(target,key){return key==='VAULT'?vault:Reflect.get(target,key);}}));
    }
    if(dropNextSecretGrantAcknowledgement&&request.method==='POST'&&/^\/api\/cli\/(trunks|repos)\/.+\/secrets\/grants$/.test(url.pathname)){
      dropNextSecretGrantAcknowledgement=false;const response=await api.fetch(request,env);if(!response.ok)return response;await response.body?.cancel();return Response.json({error:'Synthetic lost workload grant acknowledgement'},{status:503});
    }
    if(url.pathname==='/fixture/vault-administration'){
      const body=await request.json<{scope:import('../../../vault/src/provider').VaultScope;input:import('../../../vault/src/administration').VaultEdit;ttl?:number;denied?:boolean}>();
      const authority=new FixtureVaultAuthority(body.ttl??10000,body.denied===true);
      try{
        const result=await (env.VAULT as unknown as import('../../../vault/src/index').VaultService).administer(body.scope,body.input,authority);
        const response=Response.json({result,authorityCalls:authority.calls});
        (result as unknown as {[Symbol.dispose]?:()=>void})[Symbol.dispose]?.();
        return response;
      }catch(error){return Response.json({error:(error as Error).message,authorityCalls:authority.calls},{status:400});}
    }
    if(url.pathname==='/fixture/import-transport'){
      if(request.method==='POST'){const body=await request.json<{drop:string}>();dropImportAcknowledgement=body.drop;}
      return Response.json(importPosts);
    }
    if(request.method==='POST'&&/^\/git\/.+\.git\/(nanohub-import\/objects|git-receive-pack)$/.test(url.pathname)){
      const stage=url.pathname.endsWith('/objects')?'objects':'refs';importPosts[stage]++;
      const response=await api.fetch(request,env);
      if(response.ok&&dropImportAcknowledgement===stage){dropImportAcknowledgement=null;await response.body?.cancel();return Response.json({error:'Synthetic lost import acknowledgement'},{status:stage==='objects'?503:502,headers:{'Retry-After':'0.001'}});}
      return response;
    }
    if(url.pathname==='/fixture/direct-ref-batch'){
      const body=await request.json() as {trunk:string;updates:Parameters<Sequencer['updateRepository']>[0]};
      try{return Response.json(await env.SEQUENCER.get(env.SEQUENCER.idFromName(body.trunk)).updateRepository(body.updates));}
      catch(error){return Response.json({error:(error as Error).message},{status:400});}
    }
    if(url.pathname==='/fixture/shared-head-receiver') {
      const body=await request.json<{trunk:string;missing:boolean}>();
      await (env.SEQUENCER.get(env.SEQUENCER.idFromName(body.trunk)) as unknown as {missingSharedHeadReceiver:(missing:boolean)=>Promise<void>}).missingSharedHeadReceiver(body.missing);
      return Response.json({configured:true});
    }
    if(url.pathname==='/fixture/pull-readiness'){
      const body=await request.json<{trunk:string;mode?:string;input?:Parameters<ProductionSequencer['editPullReadiness']>[0]}>(),seq=env.SEQUENCER.get(env.SEQUENCER.idFromName(body.trunk));
      try{
        if(body.mode!==undefined){await (seq as unknown as {pullReadinessFault:(mode:string)=>Promise<void>}).pullReadinessFault(body.mode);return Response.json({configured:true});}
        return Response.json(await seq.editPullReadiness({...body.input!,actor:{...body.input!.actor,origin:url.origin}}));
      }catch(error){return Response.json({error:(error as Error).message},{status:400});}
    }
    if(url.pathname==='/fixture/direct-reviewed-merge') {
      const body=await request.json<{trunk:string;number:number;actor:string}>(),seq=env.SEQUENCER.get(env.SEQUENCER.idFromName(body.trunk));
      try {
        const state=await seq.review({op:'snapshot'}),pull=state.pulls.find(pull=>pull.number===body.number)!,head=state.branches.find(branch=>branch.name===pull.head)!,base=state.branches.find(branch=>branch.name===pull.base)!,main=await seq.head();
        return Response.json(await seq.review({op:'merge',number:pull.number,head,base:{...base,version:main.version},anchor:pull.anchor,human:true,origin:url.origin,candidate:{commit:head.commit,tree:head.tree,base:base.commit},request:{id:'fixture-direct-merge-'+pull.number,agent:'review',owner:{id:body.actor,name:'Fixture actor'},kind:'agent',life:0,intent:pull.title,base:main.version,reads:{strong:[],weak:[]},edits:[],issue:null,closes:false}}));
      } catch(error) {return Response.json({error:(error as Error).message},{status:400});}
    }
    if(url.pathname==='/fixture/merge-settings-before-merge'){
      const body=await request.json<{trunk:string;settings:MergeSettingsInput}>();
      await (env.SEQUENCER.get(env.SEQUENCER.idFromName(body.trunk)) as unknown as {mergeSettingsBeforeMerge:(input:MergeSettingsInput)=>Promise<void>}).mergeSettingsBeforeMerge(body.settings);
      return Response.json({configured:true});
    }
    if(url.pathname==='/fixture/conditional-merge-settings'){
      const body=await request.json<MergeSettingsInput&{trunk:string;revision:number;actor:string}>();
      try{return Response.json(await env.SEQUENCER.get(env.SEQUENCER.idFromName(body.trunk)).configureMergeSettings({...body,origin:url.origin,credentialId:'fixture-direct'},body.actor));}
      catch(error){return Response.json({error:String(error)},{status:400});}
    }
    if(url.pathname==='/fixture/drop-runner-acknowledgement'){dropNextRunnerAcknowledgement=true;return Response.json({armed:true});}
    if(url.pathname==='/fixture/drop-collaborator-acknowledgement'){dropNextCollaboratorAcknowledgement=true;return Response.json({armed:true});}
    if(url.pathname==='/fixture/conditional-collaborator'){
      const body=await request.json<{trunk:string;actor:string;input:Parameters<import('../../src/hub').Hub['configureCollaborators']>[2]}>();
      try{return Response.json(await env.HUB.get(env.HUB.idFromName('hub')).configureCollaborators(body.trunk,body.actor,body.input));}
      catch(error){return Response.json({error:(error as Error).message},{status:400});}
    }
    if(dropNextCollaboratorAcknowledgement&&request.method==='POST'&&/^\/api\/cli\/(trunks|repos)\/.+\/collaborators$/.test(url.pathname)){
      dropNextCollaboratorAcknowledgement=false;const response=await api.fetch(request,env);if(!response.ok)return response;await response.body?.cancel();return Response.json({error:'Synthetic lost collaborator acknowledgement'},{status:503});
    }
    if(url.pathname==='/fixture/conditional-runner'){
      const body=await request.json<{trunk:string;actor:string;registration?:{id:string;name:string;token:string};revoke?:string}>();
      try{return Response.json(await env.SEQUENCER.get(env.SEQUENCER.idFromName(body.trunk)).configureCliRunner({credentialId:'fixture-direct-runner',origin:url.origin,...(body.registration?{registration:body.registration}:{revoke:body.revoke})},body.actor));}
      catch(error){return Response.json({error:String(error)},{status:400});}
    }
    if(dropNextRunnerAcknowledgement&&request.method==='POST'&&/^\/api\/cli\/(trunks|repos)\/.+\/ci\/runners$/.test(url.pathname)){
      dropNextRunnerAcknowledgement=false;const response=await api.fetch(request,env);
      return response.ok?Response.json({error:'Synthetic acknowledgement loss after registration'},{status:502}):response;
    }
    if(url.pathname==='/fixture/conditional-environment'){
      const body=await request.json<{trunk:string;actor:string;revision:number;id?:string;configuration?:import('../../src/deployments/types').EnvironmentInput}>();
      try{return Response.json(await env.SEQUENCER.get(env.SEQUENCER.idFromName(body.trunk)).configureEnvironment({...body,credentialId:'fixture-direct-environment',origin:url.origin},body.actor));}
      catch(error){return Response.json({error:String(error)},{status:400});}
    }
    if(url.pathname==='/fixture/legacy-request-storage'){
      const body=await request.json<{trunk:string;input:Parameters<Sequencer['legacyRequestStorage']>[0]}>();
      try{return Response.json(await (env.SEQUENCER.get(env.SEQUENCER.idFromName(body.trunk)) as unknown as {legacyRequestStorage:Sequencer['legacyRequestStorage']}).legacyRequestStorage(body.input));}
      catch(error){return Response.json({error:(error as Error).message},{status:400});}
    }
    if(url.pathname==='/fixture/conditional-human-review'){
      const body=await request.json<{trunk:string;input:Parameters<ProductionSequencer['submitHumanReview']>[0]}>();
      try{return Response.json(await env.SEQUENCER.get(env.SEQUENCER.idFromName(body.trunk)).submitHumanReview({...body.input,origin:url.origin}));}
      catch(error){return Response.json({error:(error as Error).message},{status:400});}
    }
    if(url.pathname==='/fixture/conditional-review-request'){
      const body=await request.json<{trunk:string;input:Parameters<ProductionSequencer['editRequestedReviews']>[0]}>();
      try{return Response.json(await env.SEQUENCER.get(env.SEQUENCER.idFromName(body.trunk)).editRequestedReviews({...body.input,origin:url.origin}));}
      catch(error){return Response.json({error:(error as Error).message},{status:400});}
    }
    if(url.pathname==='/fixture/conditional-deployment'){
      const body=await request.json<{trunk:string;actor:string;command:import('../../src/deployments/cli').CliDeploymentMutation}>();
      try{return Response.json(await env.SEQUENCER.get(env.SEQUENCER.idFromName(body.trunk)).mutateCliDeployment({...body.command,origin:url.origin},body.actor));}
      catch(error){return Response.json({error:String(error)},{status:400});}
    }
    if(url.pathname==='/fixture/drop-deployment-acknowledgement'){dropNextDeploymentAcknowledgement=true;return Response.json({armed:true});}
    if(url.pathname==='/fixture/expire-deployment-cli-grant'){
      const body=await request.json<{id:string}>();await env.AUTH_DB.prepare('UPDATE cli_credentials SET expiresAt=? WHERE id=?').bind(Date.now()-1,body.id).run();return Response.json({expired:true});
    }
    if(dropNextDeploymentAcknowledgement&&request.method==='POST'&&/^\/api\/cli\/(trunks|repos)\/.+\/deployment-requests\/[a-zA-Z0-9-]+\/reviews$/.test(url.pathname)){
      dropNextDeploymentAcknowledgement=false;const response=await api.fetch(request,env);if(!response.ok)return response;await response.body?.cancel();return Response.json({error:'Synthetic lost deployment acknowledgement'},{status:503});
    }
    if(url.pathname==="/fixture/conditional-archive") {
      const body=await request.json<{trunk:string;actor:string;archived:boolean;revision:number;confirmation:string}>();
      try{return Response.json(await env.HUB.get(env.HUB.idFromName("hub")).configureRepositoryArchive(body.trunk,body.actor,body.archived,body.revision,"fixture-direct",undefined,body.confirmation));}
      catch(error){return Response.json({error:(error as Error).message},{status:400});}
    }
    if(url.pathname==="/fixture/legacy-ruleset") {
      const body=await request.json<{trunk:string;id:number;configuration?:import("../../src/repository/ruleset-types").RulesetInput;manualCounter?:boolean;rollback?:boolean}>();
      try{await (env.SEQUENCER.get(env.SEQUENCER.idFromName(body.trunk)) as unknown as {legacyRuleset:(input:typeof body)=>Promise<void>}).legacyRuleset(body);return Response.json({wrote:true});}
      catch(error){return Response.json({error:String(error)},{status:400});}
    }
    if(url.pathname==="/fixture/legacy-default"||url.pathname==="/fixture/conditional-default") {
      const body=await request.json<{trunk:string;branch:string;commit:string;revision:number;actor:string;manualCounter?:boolean;rollback?:boolean}>(),seq=env.SEQUENCER.get(env.SEQUENCER.idFromName(body.trunk));
      try{
        if(url.pathname.endsWith('legacy-default'))await (seq as unknown as {legacyDefault:(input:typeof body)=>Promise<void>}).legacyDefault(body);
        else await seq.configureRepositoryDefault({branch:body.branch,commit:body.commit,revision:body.revision,credentialId:'fixture-direct-rpc',origin:url.origin},body.actor);
        return Response.json({wrote:true});
      }catch(error){return Response.json({error:String(error)},{status:400});}
    }
    if(url.pathname==="/fixture/legacy-protection") {
      const body=await request.json<{trunk:string;branch:string;policy?:import("../../src/repository/types").BranchPolicy;manualCounter?:boolean;rollback?:boolean}>();
      // Test entrypoint only; no production Worker exports this hook.
      try{await (env.SEQUENCER.get(env.SEQUENCER.idFromName(body.trunk)) as unknown as {legacyProtection:(input:typeof body)=>Promise<void>}).legacyProtection(body);return Response.json({wrote:true});}
      catch(error){return Response.json({error:String(error)},{status:400});}
    }
    if (url.pathname === "/fixture/session") {
      const {
        localId,
        subject,
        name = "Same display name",
        emailVerified = false,
      } = await request.json<{
        localId: string;
        subject: string;
        name?: string;
        emailVerified?: boolean;
      }>();
      await env.AUTH_DB.prepare(
        'CREATE TABLE IF NOT EXISTS "account" ("userId" TEXT PRIMARY KEY, "providerId" TEXT, "accountId" TEXT)',
      ).run();
      await env.AUTH_DB.prepare(
        'INSERT OR REPLACE INTO "account" ("userId", "providerId", "accountId") VALUES (?, ?, ?)',
      )
        .bind(localId, "codegraff", subject)
        .run();
      const user: User = {
        id: `codegraff:${localId}`,
        name,
        email: `${subject}@example.invalid`,
        provider: "codegraff",
        ...(emailVerified===true?{emailVerified:true}:{}),
      };
      await env.ACCOUNT.get(env.ACCOUNT.idFromName(user.id)).save({
        access: `fixture-${subject}`,
        refresh: null,
        expires: Date.now() + 3600000,
        scope: "openid rooms:read",
      });
      return Response.json(
        { user },
        {
          headers: {
            "Set-Cookie": await sessionCookie(user, settings(env, url), url),
          },
        },
      );
    }
    if(url.pathname==="/fixture/archive-state") {
      const trunk=url.searchParams.get("trunk")!;
      return Response.json({hub:await env.HUB.get(env.HUB.idFromName("hub")).repositoryArchive(trunk),sequencer:await env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk)).repositoryArchive(),room:await env.ROOM.get(env.ROOM.idFromName(trunk)).repositoryArchive()});
    }
    if(url.pathname==="/fixture/archive-write") {
      const body=await request.json<{trunk:string;kind:string;head:string;base:string}>(),seq=env.SEQUENCER.get(env.SEQUENCER.idFromName(body.trunk)),room=env.ROOM.get(env.ROOM.idFromName(body.trunk));
      try{
        if(body.kind==="land") {
          const head=await seq.head();return Response.json(await seq.submit({id:"archive-text-test-write",agent:"archive-fixture",kind:"agent",owner:{id:"codegraff:owner",name:"owner"},life:1,intent:"Archive text writer validation",base:head.version,reads:{strong:[],weak:[]},edits:[{op:"create",path:"after-archive.txt",text:"Writable only after unarchive\n"}],issue:null,closes:false}));
        }
        if(body.kind==="room")await room.openIssue("Late issue","Must not land after the archive barrier","owner");
        else if(body.kind==="review")await seq.review({op:"close",number:1});
        else if(body.kind==="policy")await seq.setPolicy({branch:"main",pullRequest:false,approvals:0,checks:[],beforeOpen:[],preventForce:false,preventDelete:false},"owner");
        else await seq.updateRepository([{name:"refs/heads/late-write",old:null,next:{commit:body.head,tree:body.base},fastForward:true,actor:"owner"}]);
        return Response.json({wrote:true});
      }catch(error){return Response.json({error:String(error)},{status:403});}
    }
    if (url.pathname === "/fixture/proof")
      return Response.json(
        await env.HUB.get(env.HUB.idFromName("hub")).teamProof(
          "private-team",
          url.searchParams.get("principal")!,
        ),
      );
    return api.fetch(request, env);
  },
};
