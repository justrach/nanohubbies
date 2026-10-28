/** Test-only entrypoint. It is never referenced by either Wrangler config. */
import api,{Sequencer as ProductionSequencer,Room as ProductionRoom} from "../../src/index";
import type {ArchiveChange} from "../../src/repository/archive-types";
import { sessionCookie, settings, type User } from "../../src/auth";
export * from "../../src/index";
let dropNextRunnerAcknowledgement=false;
let dropImportAcknowledgement:string|null=null;
const importPosts={objects:0,refs:0};

/** Test-only lost-RPC injection; neither Wrangler entrypoint exports this class. */
export class Sequencer extends ProductionSequencer {
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
    if(url.pathname==='/fixture/direct-reviewed-merge') {
      const body=await request.json<{trunk:string;number:number;actor:string}>(),seq=env.SEQUENCER.get(env.SEQUENCER.idFromName(body.trunk));
      try {
        const state=await seq.review({op:'snapshot'}),pull=state.pulls.find(pull=>pull.number===body.number)!,head=state.branches.find(branch=>branch.name===pull.head)!,base=state.branches.find(branch=>branch.name===pull.base)!,main=await seq.head();
        return Response.json(await seq.review({op:'merge',number:pull.number,head,base:{...base,version:main.version},anchor:pull.anchor,human:true,origin:url.origin,candidate:{commit:head.commit,tree:head.tree,base:base.commit},request:{id:'fixture-direct-merge-'+pull.number,agent:'review',owner:{id:body.actor,name:'Fixture actor'},kind:'agent',life:0,intent:pull.title,base:main.version,reads:{strong:[],weak:[]},edits:[],issue:null,closes:false}}));
      } catch(error) {return Response.json({error:(error as Error).message},{status:400});}
    }
    if(url.pathname==='/fixture/drop-runner-acknowledgement'){dropNextRunnerAcknowledgement=true;return Response.json({armed:true});}
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
