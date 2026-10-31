import {ArchiveStore,assertRepositoryWritable,type ArchiveChange} from "./repository/archive";
import {rulesetActor} from './repository/actor';
import {MergeSettingsStore,type MergeSettingsInput} from './repository/merge-settings';
import type {RulesetActor} from './repository/bypass';
import {currentRulesetActor} from './repository/bypass';
import {DeploymentRequests} from "./deployments/requests";
import {currentCliGrant} from './cli/credentials';
import type {CliDeploymentMutation} from './deployments/cli';
import {Contributions} from './contributions/store';
import type {ContributionAgent,WorkStart,WorkReport,ContributionFilter} from './contributions/types';
import {runRef,runRefTarget} from './ci/ref';
import {deploymentMembership} from "./deployments/membership";
import type {DeploymentMembership} from "./deployments/approval-types";
import {Environments} from "./deployments/store";
import {deploymentGate} from "./deployments/requirements";
import { RuleInsights, ruleTransaction } from "./repository/insights";
import { Repository } from "./repository/store";
import {assertRefBatch,INITIAL_IMPORT_MAX_REFS} from './repository/ref-batch';
import { Rulesets } from "./repository/rulesets";
import { RulesetHistory } from "./repository/ruleset-history";
import { exportRuleset } from "./repository/ruleset-transfer";
import { codeOwnerAccounts } from "./repository/codeowner-access";
import { codeOwnerDecision } from "./repository/codeowners";
import type { CodeOwnerEvidence } from "./repository/codeowner-types";
import { Policies, type BranchPolicy } from "./repository/policy";
import { CIStore, type CheckResult, type StagingEvidence } from "./ci/store";
import { DurableObject } from "cloudflare:workers";
import { ReviewStore } from "./review/store";
import {sharedHeadReviewBlockers,sharedHeadReviewMessage} from "./review/shared-head";
import { reviewWriter } from "./review/access";
import { reviewerMembership } from "./review/reviewer-access";
import {RequestedReviews,reviewerId} from './review/requests';
import type {ReviewRequestEdit} from './review/request-types';
import type { ReviewerMembership } from "./review/reviewer-types";
import { CodeComments, type CommentCommand } from "./review/comments";
import { PullComments, type PullCommentCommand } from "./review/pull-comments";
import { PendingReviews, type PendingCommand, type SubmitPending } from "./review/pending";
import { SuggestionApplications,type ApplySuggestions } from "./review/suggestion-store";
import {branchFingerprint} from "./signing/ref-proof";
import type { ReviewCommand, ReviewSnapshot } from "./review/types";
import { listTargets } from "./sequencer/queries";
import { applyEdits, EditError, isCode, symbols, targets, type Applied } from "./footprint";
import { objectKey, type GitObject } from "./git";
import type { Landed, Started } from "./lane";
import { backToBack, dataCenter, repeat } from "./sequencer/bench";
import { landingCommit, type Landing } from "./sequencer/commit";
import { forgetLeases, forgive, leased, starve } from "./sequencer/leases";
import { MirrorPusher, repoToken, type Mirror } from "./sequencer/mirror";
import { add, beginBatch, beginLanding, endBatch, endLanding, held as heldRow, heldBytes, put } from "./sequencer/held";
import { Initializer, recordSeed } from "./sequencer/initialize";
import { Publisher } from "./sequencer/publish";
import { Backlog, backlogLimits } from "./sequencer/backlog";
import { Feed } from "./sequencer/feed";
import { decideOnce } from "./sequencer/receipts";
import { changeById, forget, getMeta, lastWrites, LAST_WRITE, migrate, OUTBOX, PENDING, PUSHED, putFile, rebuildTrees, recentChanges, record, setMeta, tipText, unseen, versionAt, versionsFrom, VERSIONS } from "./sequencer/store";
import type { ChangeRecord, ChangeRequest, Head, Made, Overlap, SubmitResult, Submitted } from "./types";

/** The trunk's only writer. It does the cheap part of landing a change:
 *  look up each footprint key's last write, apply the edits, commit. Reading,
 *  planning and testing happen in sessions and agents, never in here. Its
 *  tables live in ./sequencer/store, the writes a batch holds in
 *  ./sequencer/held, its commits in ./sequencer/commit, leases in
 *  ./sequencer/leases, the hand-off to the trunk's packer in
 *  ./sequencer/publish, and the Artifacts mirror in ./sequencer/mirror. */
export class Sequencer extends DurableObject<Env> {
  private sql: SqlStorage;
  private uploading: Promise<void> | null = null;
  private mirroring: Promise<void> | null = null;
  private pusher: MirrorPusher;
  private publisher: Publisher;
  private initializer: Initializer;
  /** Settles, and is replaced, each time the published head moves. */
  private moved = signal();
  /** Events for the room (./sequencer/feed). */
  private feed: Feed;
  /** How far publishing is behind, and whether new changes are decided (./sequencer/backlog). */
  private backlog: Backlog;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    migrate(this.sql);
    // Install the persistent policy revision fence before serving any RPC.
    // SQL triggers continue to invalidate exports if an older build writes.
    ctx.storage.transactionSync(()=>{new Policies(this.sql);new Rulesets(this.sql);});
    this.pusher = new MirrorPusher(this.sql, () => this.env.ARTIFACTS);
    this.feed = new Feed(async (events) => {
      const trunk = this.meta<string>("trunk");
      if (trunk) await this.env.ROOM.get(this.env.ROOM.idFromName(trunk)).publish(events);
    });
    this.backlog = new Backlog(this.sql, backlogLimits(env));
    this.publisher = new Publisher(
      this.sql,
      this.backlog,
      () => this.packer(),
      () => {
        this.moved.fire();
        this.moved = signal();
      },
    );
    this.initializer = new Initializer(ctx, env, (objects, root) => {
      const head = this.commitTip(1, objects, root, { id: "seed", agent: "seed", intent: "Seed the trunk", base: 0 }, [], null);
      recordSeed(this.sql, head);
      return head;
    }, async () => { this.backlog.recount(); void this.mirrorPush(); await this.publishedThrough(1); });
    // Finish publishing objects that an eviction interrupted.
    void this.upload().catch(() => {});
  }

  repositoryArchive() { return new ArchiveStore(this.sql).state(); }
  archiveConfiguration() {return {cliAudit:true as const};}
  applyRepositoryArchive(change:ArchiveChange) {
    return this.ctx.storage.transactionSync(()=>{
      if(!this.meta<string>("trunk"))throw Error("Repository initialization must complete before archival");
      const result=new ArchiveStore(this.sql).apply(change);
      if(result.changed){if(change.archived)new CIStore(this.sql).cancelForArchive();new Repository(this.sql).audit({actor:change.actor,archive:{archived:change.archived,revision:change.revision},...(change.via?{via:change.via}:{})});}
      return result.state;
    });
  }
  repositoryMode() { return new Repository(this.sql).mode(); }
  repositoryRefs() { return new Repository(this.sql).refs(); }
  repositoryImportLimit(){return INITIAL_IMPORT_MAX_REFS;}
  repositoryConfiguration(){const repo=new Repository(this.sql);return {mode:repo.mode()?"git" as const:"snapshot" as const,...repo.configuration(),branches:repo.refs().filter(ref=>ref.name.startsWith("refs/heads/")).map(ref=>({...ref,name:ref.name.slice(11)}))};}
  defaultBranchConfiguration(){return {...this.repositoryConfiguration(),conditionalWrites:true as const,cliAudit:true as const,revisionTracking:"storage" as const};}
  mergeSettingsConfiguration(){const repo=new Repository(this.sql),configuration=new MergeSettingsStore(this.sql).get();return {mode:repo.mode()?"git" as const:"snapshot" as const,...configuration,...(!repo.mode()?{allowedMethods:["fast-forward" as const],defaultMethod:"fast-forward" as const}:{}),conditionalWrites:true as const,cliAudit:true as const,revisionTracking:"storage" as const};}
  async configureMergeSettings(input:MergeSettingsInput&{revision:number;origin:string;credentialId?:string},actor:string) {
    const trunk=this.meta<string>("trunk");if(!trunk)throw Error("Repository identity unavailable");
    const authority=await rulesetActor(this.env,trunk,actor,input.origin);
    return this.ctx.storage.transactionSync(()=>{
      if(!currentRulesetActor(authority,actor)||!['owner','admin'].includes(authority?.role??''))throw Error('Current repository admin access required to change merge settings');
      return new MergeSettingsStore(this.sql).set(input,input.revision,actor,input.credentialId?{kind:'cli',credentialId:input.credentialId}:undefined);
    });
  }
  async configureRepositoryDefault(input:{branch:string;commit:string;revision:number;credentialId:string;origin:string},actor:string){
    const trunk=this.meta<string>("trunk");if(!trunk)throw Error("Repository identity unavailable");
    const authority=await rulesetActor(this.env,trunk,actor,input.origin);
    return this.selectRepositoryDefault(input,actor,{kind:"cli",credentialId:input.credentialId},authority);
  }
  selectRepositoryDefault(input:{branch:string;commit:string;revision:number},actor:string,via?:{kind:"cli";credentialId:string},authority?:RulesetActor){
    return this.ctx.storage.transactionSync(()=>{
      if(via&&(!currentRulesetActor(authority,actor)||!['owner','admin'].includes(authority?.role??'')))throw Error("Current repository admin access required to change the default branch");
      const repo=new Repository(this.sql),before=repo.defaultBranch(),result=repo.selectDefault(input.branch,input.commit,input.revision,actor,via);
      if(!("conflict" in result)&&before!==result.defaultBranch){const base=repo.main(),ci=new CIStore(this.sql);for(const ref of repo.refs().filter(ref=>ref.name.startsWith("refs/heads/")))ci.enqueue(ref.name.slice(11),ref.commit,base.commit,actor);}
      return result;
    });
  }
  initRepository(trunk: string,defaultBranch="main") {
    return this.ctx.storage.transactionSync(() => {
      new Repository(this.sql).initialize(defaultBranch);
      setMeta(this.sql, "trunk", trunk);
      return { mode: "git", refs: [],defaultBranch };
    });
  }
  updateRepository(updates: { name: string; old: string | null; next: { commit: string; tree: string } | null; fastForward: boolean; actor: string; proof?:import("./repository/types").RefProof }[],agent?:ContributionAgent) {
    return ruleTransaction(this.sql,run=>this.ctx.storage.transactionSync(run),"git",observe => {
      const repo = new Repository(this.sql,observe);
      const defaultRef=`refs/heads/${repo.defaultBranch()}`,before=repo.refs(),branchContext=branchFingerprint(before),deploymentBase=before.find(ref=>ref.name===defaultRef)?.commit??null;
      assertRefBatch(updates.length,!before.length&&updates.every(u=>u.old===null&&u.next!==null));
      if(agent&&updates.some(update=>update.actor!==agent.owner.id))throw Error('Agent contribution principal does not match the ref writer');
      for (const u of updates) {
        repo.update(u.name, u.old, u.next, u.fastForward, u.actor, false, u.proof,false,branchContext,deploymentBase);
        if(agent&&u.old!==(u.next?.commit??null))new Contributions(this.sql).push(agent,u.name,u.old,u.next?.commit??null,u.next?(u.name.startsWith('refs/heads/')?u.next.commit:u.proof?.peeledCommit):undefined);
      }
      const finalRefs=repo.refs(),main=finalRefs.find(r=>r.name===defaultRef);
      // A mirror may send feature refs before main; schedule against the
      // final atomic ref set rather than silently missing those import events.
      if (main) for (const u of updates) if (u.next && finalRefs.find(ref=>ref.name===u.name)?.commit===u.next.commit && u.name.startsWith("refs/heads/") && u.name !== defaultRef) new CIStore(this.sql).enqueue(u.name.slice(11), u.next.commit, main.commit);
      if(main)for(const u of updates)if(u.next&&finalRefs.find(ref=>ref.name===u.name)?.commit===u.next.commit&&u.name.startsWith('refs/tags/')&&u.proof?.old===u.old&&u.proof.next===u.next.commit&&/^[a-f0-9]{40}$/.test(u.proof.peeledCommit??''))new CIStore(this.sql).enqueue(u.name.slice(10),u.proof.peeledCommit!,main.commit,u.actor,{ref:u.name,target:u.next.commit});
      return repo.refs();
    });
  }
  ciSources(){return new CIStore(this.sql).sources();}
  contributions(filter:ContributionFilter={}){return new Contributions(this.sql).page(filter);}
  agentWork(id:string,agent:string){return new Contributions(this.sql).get(id,agent);}
  startAgentWork(agent:ContributionAgent,input:WorkStart){return this.ctx.storage.transactionSync(()=>new Contributions(this.sql).start(agent,input));}
  reportAgentWork(agent:ContributionAgent,input:WorkReport){return this.ctx.storage.transactionSync(()=>new Contributions(this.sql).report(agent,input));}
  contributionLinkKnown(sha:string){return !!this.sql.exec("SELECT 1 FROM repository_refs WHERE commit_sha=? UNION ALL SELECT 1 FROM versions WHERE commit_sha=? UNION ALL SELECT 1 FROM repository_audit WHERE json_extract(data,'$.next')=? LIMIT 1",sha,sha,sha).toArray().length;}
  contributionPullExists(number:number){return !!this.sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='review_pulls'").toArray().length&&!!this.sql.exec("SELECT 1 FROM review_pulls WHERE number=?",number).toArray().length;}
  environments(){return new Environments(this.sql).list();}
  environmentConfiguration(){return {...new Environments(this.sql).configuration(),sources:new CIStore(this.sql).sources()};}
  async configureEnvironment(input:{revision:number;credentialId:string;origin:string;id?:string;configuration?:import('./deployments/types').EnvironmentInput},actor:string){
    if(!Number.isSafeInteger(input.revision)||input.revision<0||typeof input.credentialId!=='string'||!input.credentialId||input.id!==undefined&&!/^[a-zA-Z0-9-]{8,80}$/.test(input.id)||!input.id&&!input.configuration)throw Error('Choose the observed environment revision and configuration');
    const trunk=this.meta<string>('trunk');if(!trunk)throw Error('Repository identity unavailable');
    const reviewers=input.configuration?.reviewers??[];
    if(!Array.isArray(reviewers)||reviewers.length>6||reviewers.some(id=>typeof id!=='string'||!id||id.length>256||/[\0\r\n]/.test(id)))throw Error('Choose up to six current repository reviewers');
    const membership=reviewers.length?await this.deploymentMembers(reviewers,input.origin):undefined;
    const authority=await rulesetActor(this.env,trunk,actor,input.origin);
    return this.ctx.storage.transactionSync(()=>{
      if(!currentRulesetActor(authority,actor)||!['owner','admin'].includes(authority?.role??''))throw Error('Current repository admin access required for deployment environments');
      if(!this.repositoryMode())throw Error('Deployment environments require Git repository mode');
      if(membership&&(membership.expiresAt<=Date.now()||membership.checkedAt>Date.now()+1000||Date.now()-membership.checkedAt>30000||reviewers.some(id=>membership.accounts[id]!=='member')))throw Error('Deployment reviewers must have current repository read access');
      const store=new Environments(this.sql),current=store.configuration();
      if(current.revision!==input.revision)return {conflict:true as const,...current};
      const previous=input.id?current.environments.find(e=>e.id===input.id):undefined;
      const environment=input.configuration?store.set(input.configuration,input.id):undefined;
      if(!input.configuration)store.remove(input.id!);
      if(!environment||environment!==previous&&JSON.stringify(environment)!==JSON.stringify(previous))new Repository(this.sql).audit({actor,...(environment?{environment,previousEnvironment:previous??null}:{removedEnvironment:input.id,previousEnvironment:previous}),via:{kind:'cli',credentialId:input.credentialId}});
      return {...store.configuration(),...(environment?{environment}:{deleted:true as const})};
    });
  }
  async setEnvironment(input:import("./deployments/types").EnvironmentInput,actor:string,id?:string,origin=""){if(input.reviewers?.length){const membership=await this.deploymentMembers(input.reviewers,origin);if(input.reviewers.some(id=>membership.accounts[id]!=="member"))throw Error("Deployment reviewers must have current repository read access");}return this.ctx.storage.transactionSync(()=>{if(!this.repositoryMode())throw Error("Deployment environments require Git repository mode");const store=new Environments(this.sql),previous=id?store.list().find(e=>e.id===id):null,environment=store.set(input,id);new Repository(this.sql).audit({actor,environment,previousEnvironment:previous});return environment;});}
  removeEnvironment(id:string,actor:string){return this.ctx.storage.transactionSync(()=>{const store=new Environments(this.sql),previous=store.list().find(e=>e.id===id);store.remove(id);new Repository(this.sql).audit({actor,removedEnvironment:id,previousEnvironment:previous});});}
  async deploymentGate(branch:string,head:string,base:string,actor:string,human:boolean,headBranch?:string,origin=""){const authority=human?await this.currentRulesetActor(actor,origin):undefined;const repo=new Repository(this.sql),gate=deploymentGate(this.sql,branch,head,repo.main().commit,actor,human,authority),refs=repo.refs();if(refs.find(ref=>ref.name===`refs/heads/${branch}`)?.commit!==base||headBranch&&refs.find(ref=>ref.name===`refs/heads/${headBranch}`)?.commit!==head)return {...gate,ready:false,environments:gate.environments.map(environment=>({...environment,ready:false,error:"PR changed while checking deployments; refresh and retry"}))};return gate;}
  policies() { return new Policies(this.sql).list(); }
  async rulesetPlan():Promise<import('./repository/ruleset-types').RulesetPlan> {
    const plan=new Rulesets(this.sql).plan();
    try{if(await this.env.HUB.get(this.env.HUB.idFromName('hub')).rulesetRoleSupport()===true)return plan;}
    catch(error){if(!(error instanceof Error)||!error.message.includes('does not implement the method "rulesetRoleSupport"'))throw error;}
    const {roleBypass:_role,...legacy}=plan;return legacy;
  }
  graphPlan() {return {...new Rulesets(this.sql).plan(),signing:{branches:new Repository(this.sql).refs().filter(ref=>ref.name.startsWith("refs/heads/")).map(({name,commit})=>({name,commit})),policies:new Policies(this.sql).list().filter(policy=>policy.requireSignedCommits)}};}
  ruleSuites(query?:import("./repository/insight-types").RuleSuiteQuery){return new RuleInsights(this.sql).list(query);}
  ruleSuite(id:number){return new RuleInsights(this.sql).get(id);}
  repositoryActivity(query: import("./repository/activity-types").ActivityQuery) { return new Repository(this.sql).activity(query); }
  rulesetRestorePreview(id: number, eventId: number) { return new RulesetHistory(this.sql).preview(id, eventId); }
  rulesetExport(id: number, eventId?: number) {
    const value = eventId === undefined ? new Rulesets(this.sql).plan().rulesets.find(r => r.id === id)
      : new RulesetHistory(this.sql).preview(id, eventId).selected;
    if (!value) throw Error("Ruleset version unavailable");
    return exportRuleset(value);
  }
  restoreRuleset(id: number, eventId: number, revision: number, actor: string) {
    return this.ctx.storage.transactionSync(() => {
      if (!this.repositoryMode()) throw Error("Rulesets require Git repository mode");
      return new RulesetHistory(this.sql).restore(id, eventId, revision, actor);
    });
  }
  configureRuleset(change:{id?:number;configuration?:import("./repository/rulesets").RulesetInput;revision:number;credentialId:string},actor:string) {
    return this.ctx.storage.transactionSync(()=>{
      if(!this.repositoryMode())throw Error("Rulesets require Git repository mode");
      const rules=new Rulesets(this.sql),plan=rules.plan();
      if(!Number.isSafeInteger(change.revision)||change.revision<0)throw Error("Invalid ruleset revision");
      if(plan.revision!==change.revision)return {conflict:true as const,revision:plan.revision};
      const previousRuleset=change.id===undefined?null:plan.rulesets.find(rule=>rule.id===change.id);
      let ruleset;
      if(change.configuration)ruleset=rules.set(change.configuration,change.id);
      else{if(change.id===undefined)throw Error("Choose a ruleset to remove");rules.remove(change.id);}
      new Repository(this.sql).audit({actor,...(ruleset?{ruleset}:{removedRuleset:change.id}),previousRuleset,via:{kind:"cli",credentialId:change.credentialId}});
      return {...rules.plan(),...(ruleset?{ruleset}:{deleted:true})};
    });
  }
  setRuleset(input: import("./repository/rulesets").RulesetInput, actor: string, id?: number) {
    return this.ctx.storage.transactionSync(() => {
      if (!this.repositoryMode()) throw Error("Rulesets require Git repository mode");
      const rules = new Rulesets(this.sql), previousRuleset = id === undefined ? null : rules.plan().rulesets.find(r => r.id === id);
      const ruleset = rules.set(input,id);
      new Repository(this.sql).audit({actor,ruleset,previousRuleset});
      return ruleset;
    });
  }
  removeRuleset(id: number, actor: string) {
    return this.ctx.storage.transactionSync(() => {
      const rules = new Rulesets(this.sql), previousRuleset = rules.plan().rulesets.find(r => r.id === id);
      rules.remove(id);
      new Repository(this.sql).audit({actor,removedRuleset:id,previousRuleset});
    });
  }
  setPolicy(policy: BranchPolicy, actor: string) {
    return this.ctx.storage.transactionSync(() => this.writePolicy(policy,actor));
  }
  private writePolicy(policy:BranchPolicy,actor:string,credentialId?:string) {
      if(policy.environments?.length&&!this.repositoryMode())throw Error("Required deployments require Git repository mode");
      if(policy.allowForcePush!==undefined&&!this.repositoryMode())throw Error("Selected force-push permissions require Git repository mode");
      if(policy.requireLinearHistory&&!this.repositoryMode())throw Error("Linear history rules require Git repository mode");
      if(policy.requireCodeOwnerReview&&!this.repositoryMode())throw Error("Code owner review requires Git repository mode");
      if(policy.requireSignedCommits&&!this.repositoryMode())throw Error("Signed commit rules require Git repository mode");
      const policies = new Policies(this.sql), previousPolicy = policies.list().find(p => p.branch === policy.branch) ?? null;
      const result = policies.set(policy);
      new Repository(this.sql).audit({ actor, policy:result.find(p=>p.branch===policy.branch), previousPolicy,...(credentialId?{via:{kind:"cli",credentialId}}:{}) });
      return result;
  }
  protectionConfiguration(){const p=new Policies(this.sql);return {policies:p.list(),revision:p.revision(),revisionTracking:"storage" as const,forcePushActors:true as const,successOnlyCheckConclusions:true as const};}
  configureProtection(change:{policy?:BranchPolicy;branch:string;revision:number;credentialId:string},actor:string) {
    return this.ctx.storage.transactionSync(()=>{
      const policies=new Policies(this.sql);
      if(policies.revision()!==change.revision)return {conflict:true as const,revision:policies.revision()};
      if(change.policy)this.writePolicy(change.policy,actor,change.credentialId);
      else {
        const previousPolicy=policies.list().find(p=>p.branch===change.branch)??null;
        if(!previousPolicy)throw Error("No branch protection rule with that exact pattern");
        policies.remove(change.branch);
        new Repository(this.sql).audit({actor,removedPolicy:change.branch,previousPolicy,via:{kind:"cli",credentialId:change.credentialId}});
      }
      return {policies:policies.list(),revision:policies.revision()};
    });
  }
  removePolicy(pattern:string,actor:string){return this.ctx.storage.transactionSync(()=>{
    const policies=new Policies(this.sql),previousPolicy=policies.list().find(p=>p.branch===pattern);
    const result=policies.remove(pattern);new Repository(this.sql).audit({actor,removedPolicy:pattern,previousPolicy});return result;
  });}
  ciAuthenticate(token:string){return new CIStore(this.sql).authenticate(token);}
  ciRuns() { return new CIStore(this.sql).list(); }
  ciRunners() { return new CIStore(this.sql).registrations(); }
  cliRunnerConfiguration(){return {registrations:new CIStore(this.sql).registrations(),clientCredentials:'v1' as const,cliAudit:true as const,ownerOnly:true as const};}
  async configureCliRunner(input:{credentialId:string;origin:string;registration?:{id:string;name:string;token:string};revoke?:string},actor:string){
    const trunk=this.meta<string>('trunk');if(!trunk)throw Error('Repository identity unavailable');
    if(typeof input.credentialId!=='string'||!input.credentialId||!!input.registration===!!input.revoke||input.revoke!==undefined&&!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.revoke))throw Error('Choose one runner registration operation');
    const authority=await rulesetActor(this.env,trunk,actor,input.origin);
    return this.ctx.storage.transactionSync(()=>{
      if(!currentRulesetActor(authority,actor)||authority?.role!=='owner')throw Error('Current repository owner access required for runner administration');
      const ci=new CIStore(this.sql);let registration;
      if(input.registration){registration=ci.provisionRunner(input.registration);if(!registration.created)return {registration};}
      else {
        const existing=ci.registrations().find(r=>r.id===input.revoke);if(!existing)throw Error('Runner registration not found');
        ci.revoke(existing.id);registration={id:existing.id,name:existing.name,revoked:true};
        if(existing.revoked)return {registration};
      }
      new Repository(this.sql).audit({actor,runnerRegistration:{id:registration.id,name:registration.name,revoked:registration.revoked},via:{kind:'cli',credentialId:input.credentialId}});
      return {registration};
    });
  }
  ciRunner(name: string) { return new CIStore(this.sql).runner(name); }
  ciApprove(id: string, actor: string) {
    return this.ctx.storage.transactionSync(() => {
      const repo=new Repository(this.sql),refs = repo.refs(), ci = new CIStore(this.sql);
      let run=ci.get(id);
      const main=refs.find(r=>r.name===`refs/heads/${repo.defaultBranch()}`);
      if(runRef(run).startsWith('refs/tags/')&&main&&main.commit!==run.base&&refs.find(r=>r.name===runRef(run))?.commit===runRefTarget(run))run=ci.enqueue(run.branch,run.head,main.commit,actor,{ref:runRef(run),target:runRefTarget(run)});
      const approved = ci.approveDeployment(run.id, actor, refs.find(r => r.name === runRef(run))?.commit===runRefTarget(run)?run.head:undefined, main?.commit);
      new Repository(this.sql).audit({ actor, stagingApproval: id, head: run.head, base: run.base });
      return approved;
    });
  }
  ciRetry(id:string,actor:string) {
    return this.ctx.storage.transactionSync(()=>{
      const repo=new Repository(this.sql),refs=repo.refs(),ci=new CIStore(this.sql);let run=ci.get(id);
      const main=refs.find(r=>r.name===`refs/heads/${repo.defaultBranch()}`);
      if(runRef(run).startsWith('refs/tags/')&&main&&main.commit!==run.base&&refs.find(r=>r.name===runRef(run))?.commit===runRefTarget(run))run=ci.enqueue(run.branch,run.head,main.commit,actor,{ref:runRef(run),target:runRefTarget(run)});
      const result=ci.retry(run.id,refs.find(r=>r.name===runRef(run))?.commit===runRefTarget(run)?run.head:undefined,main?.commit,actor);
      new Repository(this.sql).audit({actor,retry:id});return result;
    });
  }
  ciRevoke(id: string) { return this.ctx.storage.transactionSync(()=>new CIStore(this.sql).revoke(id)); }
  async ciClaim(token:string,origin="") {
    const ci=new CIStore(this.sql),waiting=ci.waiting(token),requests=new DeploymentRequests(this.sql);
    const proof=await this.deploymentMembers(waiting.flatMap(run=>run.environmentWait?requests.get(run.environmentWait).reviews.map(review=>review.actor):[]),origin);
    const ready=(run:import("./ci/types").Run)=>!!run.environmentWait&&requests.status(requests.get(run.environmentWait),run,proof).state==="ready";
    return this.ctx.storage.transactionSync(()=>new CIStore(this.sql).claim(token,Date.now(),waiting.filter(ready).map(run=>run.id),ready));
  }
  ciLogAccess(token:string,id:string,attempt:number) { return new CIStore(this.sql).logAccess(token,id,attempt); }
  ciReadable(token: string) { return new CIStore(this.sql).readable(token); }
  async ciComplete(token:string,id:string,attempt:number,results:CheckResult[],staging:StagingEvidence|null,deployments:import("./deployments/types").DeploymentReport[]=[],origin="") {
    new CIStore(this.sql).authenticate(token);const requests=new DeploymentRequests(this.sql);
    const proof=await this.deploymentMembers(Array.isArray(deployments)?deployments.flatMap(report=>{try{return report?.authorizationId?requests.get(this.sql.exec<{data:string}>("SELECT data FROM deployment_authorizations WHERE id=?",report.authorizationId).toArray().map(row=>JSON.parse(row.data))[0]?.request??"").reviews.map(review=>review.actor):[];}catch{return [];}}):[],origin);
    return this.ctx.storage.transactionSync(()=>new CIStore(this.sql).complete(token,id,attempt,results,staging,Date.now(),deployments,proof));
  }
  private async deploymentMembers(accounts:string[],origin:string):Promise<DeploymentMembership> {
    const ids=[...new Set(accounts)],now=Date.now(),proof:DeploymentMembership={accounts:{},checkedAt:now,expiresAt:now+30000};if(ids.length>1000)throw Error("Deployment reviewer lookup limit exceeded");
    for(let i=0;i<ids.length;i+=64){const part=ids.slice(i,i+64);try{const value=await deploymentMembership(this.env,this.meta<string>("trunk")!,origin,part);Object.assign(proof.accounts,value.accounts);proof.checkedAt=Math.min(proof.checkedAt,value.checkedAt);proof.expiresAt=Math.min(proof.expiresAt,value.expiresAt);}catch{for(const id of part)proof.accounts[id]="unavailable";}}
    return proof;
  }
  async deploymentRequests(actor:string,origin:string,before?:number,limit=25) {
    const store=new DeploymentRequests(this.sql),page=store.list(before,limit),proof=await this.deploymentMembers([...page.requests.flatMap(request=>request.reviews.map(review=>review.actor)),actor],origin),ci=new CIStore(this.sql);
    return {requests:page.requests.map(request=>store.status(store.get(request.id),ci.get(request.run),proof,actor)),nextCursor:page.nextCursor};
  }
  deploymentCliCapabilities(){return {version:1 as const,conditionalReviews:true as const,cliAudit:true as const,finalGrantCheck:true as const};}
  async deploymentRequest(id:string,actor:string,origin:string){
    const store=new DeploymentRequests(this.sql),request=store.get(id),proof=await this.deploymentMembers([...request.reviews.map(review=>review.actor),actor],origin);
    const current=store.get(id);return store.status(current,new CIStore(this.sql).get(current.run),proof,actor);
  }
  async mutateCliDeployment(input:CliDeploymentMutation,actor:string){
    const trunk=this.meta<string>('trunk');if(!trunk||!input||!['request','review'].includes(input.operation)||typeof input.credentialId!=='string'||typeof input.origin!=='string')throw Error('Invalid deployment CLI command');
    const authority=await rulesetActor(this.env,trunk,actor,input.origin),proof=await this.deploymentMembers([actor],input.origin);
    const scope=input.operation==='request'?'deployments:write':'deployments:review',grant=await currentCliGrant(this.env,input.credentialId,actor,trunk,input.origin,scope);
    return this.ctx.storage.transactionSync(()=>{
      if(!grant||grant.expiresAt<=Date.now())throw Error('CLI credential is revoked, expired or lacks the deployment permission');
      const roles=input.operation==='request'?['owner','admin','writer']:['owner','admin','writer','reader'];
      if(!currentRulesetActor(authority,actor)||!roles.includes(authority.role??''))throw Error('Current repository access required for this deployment operation');
      assertRepositoryWritable(this.sql);if(!this.repositoryMode())throw Error('Deployments require Git repository mode');
      const store=new DeploymentRequests(this.sql),ci=new CIStore(this.sql),via={kind:'cli' as const,credentialId:input.credentialId};
      if(input.operation==='request')return store.request(ci.get(input.runId),input.environment,actor,Date.now(),request=>new Repository(this.sql).audit({actor,deploymentRequest:{id:request.id,environment:request.environment},head:request.head,base:request.base,via}));
      const request=store.get(input.id),result=store.review(input.id,ci.get(request.run),actor,input.decision,input.comment,input.revision,proof);
      if(input.decision==='reject')ci.rejectEnvironment(request.run,input.id,request.environmentId);
      if(result.reviews.length>request.reviews.length)new Repository(this.sql).audit({actor,deploymentReview:{request:input.id,decision:input.decision,comment:input.comment,environment:request.environment},via});
      return result;
    });
  }
  requestDeployment(runId:string,environment:string,actor:string) {return this.ctx.storage.transactionSync(()=>{return new DeploymentRequests(this.sql).request(new CIStore(this.sql).get(runId),environment,actor,Date.now(),request=>new Repository(this.sql).audit({actor,deploymentRequest:{id:request.id,environment:request.environment},head:request.head,base:request.base}));});}
  async reviewDeployment(id:string,actor:string,decision:"approve"|"reject",comment:string,revision:number,origin:string) {
    const proof=await this.deploymentMembers([actor],origin);return this.ctx.storage.transactionSync(()=>{const requests=new DeploymentRequests(this.sql),request=requests.get(id),result=requests.review(id,new CIStore(this.sql).get(request.run),actor,decision,comment,revision,proof);if(decision==="reject")new CIStore(this.sql).rejectEnvironment(request.run,id,request.environmentId);if(result.reviews.length>request.reviews.length)new Repository(this.sql).audit({actor,deploymentReview:{request:id,decision,comment,environment:request.environment}});return result;});
  }
  async runnerDeployment(token:string,runId:string,attempt:number,environment:string,origin:string,optional=false) {
    const ci=new CIStore(this.sql);ci.logAccess(token,runId,attempt);if(optional&&!new Environments(this.sql).find(environment))return {configured:false as const};const request=this.requestDeployment(runId,environment,ci.authenticate(token)),proof=await this.deploymentMembers(request.reviews.map(review=>review.actor),origin);
    return this.ctx.storage.transactionSync(()=>{const current=new CIStore(this.sql);current.logAccess(token,runId,attempt);return new DeploymentRequests(this.sql).status(new DeploymentRequests(this.sql).get(request.id),current.get(runId),proof);});
  }
  async authorizeDeployment(token:string,id:string,attempt:number,origin:string) {
    const ci=new CIStore(this.sql),requests=new DeploymentRequests(this.sql),request=requests.get(id);ci.logAccess(token,request.run,attempt);const proof=await this.deploymentMembers(request.reviews.map(review=>review.actor),origin);
    return this.ctx.storage.transactionSync(()=>{const current=new CIStore(this.sql);current.logAccess(token,request.run,attempt);const authorization=new DeploymentRequests(this.sql).authorize(id,current.get(request.run),current.authenticate(token),proof,Date.now(),authorization=>new Repository(this.sql).audit({actor:authorization.runner,deploymentAuthorization:{id:authorization.id,request:id,environment:request.environment}}));return authorization;});
  }
  async deferDeployment(token:string,id:string,attempt:number,results:CheckResult[],origin:string) {
    const ci=new CIStore(this.sql),requests=new DeploymentRequests(this.sql),request=requests.get(id);ci.logAccess(token,request.run,attempt);const proof=await this.deploymentMembers(request.reviews.map(review=>review.actor),origin);
    return this.ctx.storage.transactionSync(()=>{const current=new CIStore(this.sql),run=current.get(request.run),status=new DeploymentRequests(this.sql).status(new DeploymentRequests(this.sql).get(id),run,proof);if(status.state==="ready")return {ready:true as const};if(status.state!=="waiting")throw Error(status.reason??"Deployment is not waiting");return current.defer(token,run.id,attempt,id,results);});
  }

  init(trunk: string, files: { path: string; text: string }[]): Promise<Head> {
    assertRepositoryWritable(this.sql);return this.initializer.initialize(trunk, files);
  }
  beginImport(trunk: string, id: string) { assertRepositoryWritable(this.sql);return this.initializer.begin(trunk, id); }
  appendImport(id: string, batch: number, files: { path: string; text: string }[]) { assertRepositoryWritable(this.sql);return this.initializer.append(id, batch, files); }
  finishImport(id: string) { assertRepositoryWritable(this.sql);return this.initializer.finish(id); }

  /** The newest version whose objects are all in R2. Sessions read from it and
   *  clones fetch it, so it never names an object that is not there yet. */
  head(): Head {
    if (this.repositoryMode()) return new Repository(this.sql).main();
    const head = this.meta<Head>("published");
    if (!head) throw new Error("no such trunk");
    return head;
  }

  /** A lane's batch in one call: each change landed in order, as `submit`
   *  lands it, and the lives the lane started, for the room. Returns where the
   *  trunk got to, so the lane can start lives without asking again. */
  async land(reqs: ChangeRequest[], lives: Started[]): Promise<Landed> {
    for (const life of lives) this.feed.emit({ t: "life", ...life });
    const results = this.landAll(reqs);
    return { results, tip: this.meta<Head>("tip")!, published: this.head() };
  }

  /** The heads, the mirror, and the publishing backlog, from this object's own state. */
  info(): { head: Head; tip: Head; mirror: Mirror | null; backlog: ReturnType<Backlog["snapshot"]> } {
    if (this.repositoryMode()) return { head: this.head(), tip: this.head(), mirror: null, backlog: this.backlog.snapshot() };
    return { head: this.head(), tip: this.meta<Head>("tip")!, mirror: this.meta<Mirror>("mirror") ?? null, backlog: this.backlog.snapshot() };
  }

  /** The ref list for git's dumb HTTP protocol. */
  refs(): string {
    if (this.repositoryMode()) return this.repositoryRefs().map(r => `${r.commit}\t${r.name}\n`).join("");
    return new ReviewStore(this.sql, () => this.head(), this.repositoryMode()).branches().map((b) => `${b.commit}\trefs/heads/${b.name}\n`).join("");
  }

  async codeOwnersStatus(number: number, evidence: CodeOwnerEvidence, origin: string) {
    let accounts: Record<string,string|null>={};
    try {if(evidence.groups.length)accounts=await codeOwnerAccounts(this.env,this.meta<string>("trunk")!,origin,evidence);}
    catch(error) {evidence={...evidence,error:(error as Error).message};}
    const s=new ReviewStore(this.sql,()=>this.head(),this.repositoryMode()).snapshot(),p=s.pulls.find(p=>p.number===number);
    const base=p&&s.branches.find(b=>b.name===p.base),head=p&&s.branches.find(b=>b.name===p.head);
    if(!p||base?.commit!==evidence.base||head?.commit!==evidence.head)
      return codeOwnerDecision({...evidence,error:"PR changed while checking code owners; refresh"},{},[],true);
    const membership=await this.currentReviewers(s,number,origin);
    const latest=new ReviewStore(this.sql,()=>this.head(),this.repositoryMode()).snapshot(),current=latest.pulls.find(row=>row.number===number),currentHead=latest.branches.find(row=>row.name===p.head),currentBase=latest.branches.find(row=>row.name===p.base);
    if(!current||current.anchor!==p.anchor||currentHead?.commit!==evidence.head||currentBase?.commit!==evidence.base)return codeOwnerDecision({...evidence,error:"PR changed while checking reviewers; refresh"},{},[],true);
    return codeOwnerDecision(evidence,accounts,new Policies(this.sql,membership).eligibleApprovals(current,latest.reviews,currentHead.commit).map(r=>r.author.id),!!new Policies(this.sql).get(current.base)?.requireCodeOwnerReview);
  }
  async review(command: ReviewCommand) {
    const refActor=command.op==='merge'&&command.human?command.request.owner?.id:(command.op==='branch'||command.op==='restack')&&command.human?command.actor:undefined;
    const authority=refActor?await this.currentRulesetActor(refActor,'origin' in command?command.origin??'':''):undefined;
    if(command.op==="review"&&command.independent&&(!command.origin||!await reviewWriter(this.env,this.meta<string>("trunk")!,command.origin,command.author.id)))throw Error("Review requires a signed-in current repository writer");
    if (command.op === "dismiss" && (!command.human || !await reviewWriter(this.env,this.meta<string>("trunk")!,command.origin,command.actor.id)))
      throw Error("Review dismissal requires a signed-in repository writer");
    const mergeNumber=command.op==="merge"?command.number:undefined,mergeTarget=mergeNumber?new ReviewStore(this.sql,()=>this.head(),this.repositoryMode()).snapshot().pulls.find(p=>p.number===mergeNumber)?.base:undefined;
    if(command.op==="merge"&&(this.repositoryMode()?new Repository(this.sql).refs().find(ref=>ref.name===`refs/heads/${mergeTarget}`)?.commit:this.info().tip.commit)!==command.base.commit)throw Error("Base changed; refresh and retry");
    if(command.op==="merge"&&mergeTarget&&new Policies(this.sql).get(mergeTarget)?.requireCodeOwnerReview&&command.codeOwners) {
      if(!command.origin)throw Error("Code owner identity verification needs the request origin");
      command={...command,codeOwnerAccounts:await codeOwnerAccounts(this.env,this.meta<string>("trunk")!,command.origin,command.codeOwners)};
    }
    const membership=command.op==="merge"?await this.currentReviewers(new ReviewStore(this.sql,()=>this.head(),this.repositoryMode()).snapshot(),command.number,command.origin??""):undefined;
    const mark = this.feed.mark();
    try {
      const source=command.op==="merge"?"merge":command.op==="restack"?"restack":"branch";
      const result = ruleTransaction(this.sql,run=>this.ctx.storage.transactionSync(run),source,observe=>new ReviewStore(this.sql, () => this.head(), this.repositoryMode(),membership,observe,authority).run(command, (req) => this.landAll([req], false, true)[0]));
      if (command.op === "merge" && !this.repositoryMode()) { void this.mirrorPush(); void this.upload().catch(() => {}); }
      return result;
    } catch (error) {
      forget(this.sql); forgetLeases(this.sql);
      this.feed.back(mark); this.backlog.recount();
      throw error;
    }
  }

  /** New routes never downgrade to a receiver without shared-head review checks. */
  async mergeReviewedPull(command:Extract<ReviewCommand,{op:"merge"}>) {
    if(command.op!=="merge")throw Error("Expected a protected pull request merge");
    return this.review(command);
  }

  async mergePullWithMethod(command:Extract<ReviewCommand,{op:"merge"}>) {
    if(command.op!=="merge"||!command.candidate?.method||command.candidate.method==="fast-forward"||!command.proof?.merge)throw Error("Generated merge requires its method and object-derived evidence");
    return this.review(command);
  }

  /** New routes require a receiver that enforces repository merge settings. */
  async mergePullWithSettings(command:Extract<ReviewCommand,{op:"merge"}>) {
    if(command.op!=="merge"||!Number.isSafeInteger(command.mergeSettingsRevision)||(command.mergeSettingsRevision??-1)<0)
      throw Error('Current merge settings revision is required');
    return this.review(command);
  }

  async requestedReviews(number:number,origin:string){
    const before=new RequestedReviews(this.sql).list(number);
    const ids=before.requests.filter(row=>row.state==='requested').map(row=>row.reviewer);
    const membership=await reviewerMembership(this.env,this.meta<string>('trunk')!,origin,ids);
    const after=new RequestedReviews(this.sql).list(number);
    if(after.revision!==before.revision||membership.expiresAt<=Date.now())throw Error('Review requests changed while checking membership; refresh');
    return {...after,access:membership.accounts};
  }

  async editRequestedReviews(input:ReviewRequestEdit){
    if(!input.actor||!reviewerId(input.actor.id)||!Array.isArray(input.reviewers)||!input.reviewers.length||input.reviewers.length>15||!input.reviewers.every(reviewerId)||!['request','remove'].includes(input.operation))throw Error('Choose 1–15 reviewer account IDs');
    const trunk=this.meta<string>('trunk')!;
    const membership=await reviewerMembership(this.env,trunk,input.origin,[input.actor.id,...(input.operation==='request'?input.reviewers:[])]);
    if(membership.accounts[input.actor.id]!=='writer')throw Error('Current repository writer access required to manage review requests');
    if(input.operation==='request'&&input.reviewers.some(id=>membership.accounts[id]!=='writer'))throw Error('Requested reviewers must have current repository write access');
    const grant=input.credentialId?await currentCliGrant(this.env,input.credentialId,input.actor.id,trunk,input.origin,'pulls:write'):null;
    if(input.credentialId&&!grant)throw Error('CLI pull request permission expired or was revoked');
    return this.ctx.storage.transactionSync(()=>{
      if(membership.expiresAt<=Date.now()||grant&&grant.expiresAt<=Date.now())throw Error('Review request authorization expired; refresh');
      const s=new ReviewStore(this.sql,()=>this.head(),this.repositoryMode()).snapshot(),pull=s.pulls.find(row=>row.number===input.number);
      if(!pull)throw Error('No such pull request');
      const head=s.branches.find(row=>row.name===pull.head);
      return new RequestedReviews(this.sql).edit(input,pull,head?.commit??pull.headCommit);
    });
  }

  async reviewGate(number: number, head: string, anchor: string,origin:string) {
    const before=new ReviewStore(this.sql,()=>this.head(),this.repositoryMode()).snapshot(),membership=await this.currentReviewers(before,number,origin);
    const s=new ReviewStore(this.sql,()=>this.head(),this.repositoryMode()).snapshot(),p=s.pulls.find(p=>p.number===number);
    if (!p || p.anchor!==anchor || (p.state==="open"?s.branches.find(b=>b.name===p.head)?.commit:p.headCommit)!==head)
      return {ready:false,error:"PR changed while checking reviews; refresh",approvals:0,required:0};
    if(membership.expiresAt<=Date.now())return {ready:false,error:"Reviewer membership verification expired; refresh",approvals:0,required:0,reviewerAccess:membership.accounts};
    const gate=new Policies(this.sql,membership).reviewGate(p,s.reviews,head),sharedHeadBlockers=sharedHeadReviewBlockers(this.sql,p,head,s),error=gate.error??sharedHeadReviewMessage(sharedHeadBlockers);
    return {...gate,ready:gate.ready&&!error,error,sharedHeadBlockers,reviewerAccess:membership.accounts};
  }

  private async currentRulesetActor(actor:string,origin:string):Promise<RulesetActor|undefined> {
    if(!new Rulesets(this.sql).plan().rulesets.some(rule=>rule.enforcement!=="disabled"&&rule.bypass_actors?.some(a=>a.actor_type==='RepositoryRole')))return;
    return rulesetActor(this.env,this.meta<string>("trunk")!,actor,origin);
  }

  private async currentReviewers(snapshot:ReviewSnapshot,number:number,origin:string):Promise<ReviewerMembership> {
    const pull=snapshot.pulls.find(p=>p.number===number),head=pull&&(pull.state==="open"?snapshot.branches.find(b=>b.name===pull.head)?.commit:pull.headCommit);
    const ids=pull&&head?[...new Set(new Policies(this.sql).eligibleApprovals(pull,snapshot.reviews,head).map(r=>r.author.id))]:[];
    try{return await reviewerMembership(this.env,this.meta<string>("trunk")!,origin,ids);}
    catch{return {accounts:Object.fromEntries(ids.map(id=>[id,"unavailable" as const])),checkedAt:Date.now(),expiresAt:Date.now()+30000};}
  }

  codeComments(command: CommentCommand) {
    return this.ctx.storage.transactionSync(() => new CodeComments(this.sql).run(command));
  }

  async pullComments(command: PullCommentCommand) {
    if (command.op !== "list" && !await reviewWriter(this.env, this.meta<string>("trunk")!, command.actor.origin, command.actor.id))
      throw Error("Inline review requires a signed-in repository writer");
    return this.ctx.storage.transactionSync(() => {
      const s = new ReviewStore(this.sql, () => this.head(), this.repositoryMode()).snapshot();
      const pull = s.pulls.find(p => p.number === command.number);
      if (!pull) throw Error("No such pull request");
      return new PullComments(this.sql).run(command, pull, s.branches.find(b => b.name === pull.head));
    });
  }

  // Distinct entrypoints fail closed on older deployed receivers, which know
  // only account-scoped browser drafts and would ignore a new optional field.
  async cliPendingReview(command:PendingCommand) {
    if(!command.actor.via)throw Error("CLI credential identity required");
    return this.pendingReview(command);
  }

  async cliSubmitPendingReview(command:SubmitPending) {
    if(!command.actor.via)throw Error("CLI credential identity required");
    return this.submitPendingReview(command);
  }

  async pendingReview(command:PendingCommand) {
    if(!await reviewWriter(this.env,this.meta<string>("trunk")!,command.actor.origin,command.actor.id))throw Error("Pending review requires a signed-in repository writer");
    return this.ctx.storage.transactionSync(()=>{
      const s=new ReviewStore(this.sql,()=>this.head(),this.repositoryMode()).snapshot(),pull=s.pulls.find(p=>p.number===command.number);
      if(!pull)throw Error("No such pull request");
      return new PendingReviews(this.sql).run(command,pull,s.branches.find(b=>b.name===pull.head));
    });
  }

  async submitPendingReview(command:SubmitPending) {
    if(!await reviewWriter(this.env,this.meta<string>("trunk")!,command.actor.origin,command.actor.id))throw Error("Pending review requires a signed-in repository writer");
    return this.ctx.storage.transactionSync(()=>{
      const reviews=new ReviewStore(this.sql,()=>this.head(),this.repositoryMode()),s=reviews.snapshot(),pull=s.pulls.find(p=>p.number===command.number);
      if(!pull)throw Error("No such pull request");
      return new PendingReviews(this.sql).submit(command,pull,s.branches.find(b=>b.name===pull.head),draft=>{
        const next=reviews.run({op:"review",number:pull.number,author:draft.author,commit:command.commit,anchor:command.anchor,verdict:command.verdict,body:command.body,independent:true,origin:command.actor.origin,...(command.actor.via?{via:command.actor.via}:{}),batch:{id:draft.id,comments:draft.comments.map(c=>c.id)}},()=>{throw Error("Unexpected review landing");});
        return next.reviews.at(-1)!;
      });
    });
  }

  suggestionApplication(command:Pick<ApplySuggestions,"id"|"number"|"commit"|"anchor"|"commentIds"|"message"|"actor">) {
    return new SuggestionApplications(this.sql).existing(command);
  }

  async applySuggestions(command:ApplySuggestions) {
    if(!await reviewWriter(this.env,this.meta<string>("trunk")!,command.origin,command.actor.id))throw Error("Applying suggestions requires a signed-in repository writer");
    const authority=await this.currentRulesetActor(command.actor.id,command.origin);
    const mark=this.feed.mark();
    try {return ruleTransaction(this.sql,run=>this.ctx.storage.transactionSync(run),"suggestions",observe=>new SuggestionApplications(this.sql,observe,authority).run(command,()=>this.head(),this.repositoryMode()));}
    catch(error){forget(this.sql);forgetLeases(this.sql);this.feed.back(mark);this.backlog.recount();throw error;}
  }

  /** Commits a pushing client may already have: the newest 32 versions, then
   *  every power of two further back, so even an agent far behind finds one
   *  near what it cloned and sends only what is new. */
  haves(): string[] {
    if (this.repositoryMode()) return this.repositoryRefs().filter(r => r.name.startsWith("refs/heads/")).map(r => r.commit);
    const tip = this.head().version;
    const wanted = new Set<number>();
    for (let v = tip; v > 0 && v > tip - 32; v--) wanted.add(v);
    for (let back = 64; tip - back > 0; back *= 2) wanted.add(tip - back);
    wanted.add(1);
    return [...wanted].flatMap((v) => versionAt(this.sql, v)?.commit ?? []);
  }

  /** For each sha, the published version it is the commit of, or the version
   *  an earlier push of it landed as. A push is diffed against the newest
   *  version among its commits' ancestors. */
  versionsOf(shas: string[]): Record<string, { head: Head } | { pushedAs: number }> {
    const out: Record<string, { head: Head } | { pushedAs: number }> = {};
    const published = this.head().version;
    for (const sha of shas.slice(0, 500)) {
      const row = this.sql.exec<{ version: number }>("SELECT version FROM versions WHERE commit_sha = ?", sha).toArray()[0];
      const head = row && row.version <= published ? versionAt(this.sql, row.version) : undefined;
      if (head) out[sha] = { head };
      else {
        const pushed = this.sql.exec<{ version: number }>("SELECT version FROM pushed WHERE sha = ?", sha).toArray()[0];
        if (pushed) out[sha] = { pushedAs: pushed.version };
      }
    }
    return out;
  }

  log(limit = 50): ChangeRecord[] {
    return recentChanges(this.sql, limit);
  }

  /** Published versions from `from` down, newest first: the trunk's history. */
  heads(from: number, limit: number): Head[] {
    return versionsFrom(this.sql, Math.min(from, this.head().version), Math.min(Math.max(1, limit), 101));
  }

  /** Top-level symbols at the tip that scripted agents can share edits on,
   *  leaving out imports and the swarm's own per-agent files. */
  targets(limit = 200): { path: string; name: string }[] {
    return listTargets(this.sql, limit);
  }

  /** The tip's files, for browsing. */
  files(limit = 5000): { path: string; size: number }[] {
    return this.sql.exec<{ path: string; size: number }>("SELECT path, length(text) AS size FROM files ORDER BY path LIMIT ?", limit).toArray();
  }

  /** One file at the tip, for browsing. */
  read(path: string): { path: string; text: string } {
    const text = tipText(this.sql, path);
    if (text === undefined) throw new Error(`no such file: ${path}`);
    return { path, text };
  }

  /** A short-lived read token for cloning the Artifacts mirror with plain git. */
  async cloneToken(): Promise<{ remote: string; token: string; expiresAt: string }> {
    const mirror = this.meta<Mirror>("mirror");
    if (!mirror || !this.env.ARTIFACTS) throw new Error("this trunk has no Artifacts mirror");
    const t = await repoToken(this.env.ARTIFACTS, mirror.repo, "read", 600);
    return { remote: mirror.remote, token: t.plaintext, expiresAt: t.expiresAt };
  }

  /** Deletes the trunk: its Artifacts repo, its objects in R2, and its state. */
  async destroy(): Promise<{ deleted: string }> {
    const trunk = this.meta<string>("trunk");
    if (!trunk) throw new Error("no such trunk");
    const mirror = this.meta<Mirror>("mirror");
    if (mirror && this.env.ARTIFACTS) await this.env.ARTIFACTS.delete(mirror.repo);
    // Publishing stops and the packer forgets the trunk before its objects go,
    // so no pack is written after them; a merge that finishes later finds the
    // trunk gone and deletes its own pack.
    this.publisher.stop();
    await this.uploading?.catch(() => {});
    await this.packer().destroy();
    for (let cursor: string | undefined; ; ) {
      const page = await this.env.OBJECTS.list({ prefix: objectKey(trunk, ""), cursor, limit: 1000 });
      if (page.objects.length) await this.env.OBJECTS.delete(page.objects.map((o) => o.key));
      if (!page.truncated) break;
      cursor = page.cursor;
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    forget(this.sql);
    forgetLeases(this.sql);
    this.pusher.forget();
    this.publisher.forget();
    migrate(this.sql);
    this.backlog.recount();
    return { deleted: trunk };
  }

  /** Retries publication or a mirror push without needing another landing. */
  async alarm() {
    await Promise.all([this.mirrorPush(), this.upload()]);
  }

  async submit(req: ChangeRequest): Promise<Submitted> {
    return this.landAll([req])[0];
  }

  /** Lands changes one after another in this turn, each decided once
   *  (./sequencer/receipts). Their writes, receipts with them, are held and go
   *  in together, in one transaction, once the last is decided
   *  (./sequencer/held). Until then they are provisional: nothing that
   *  answers for a change, publishes it or mirrors it runs before. A change
   *  that throws leaves no writes and no events, and the batch's earlier
   *  changes still go in; if the batch's write fails, none of it goes in and
   *  none of its events go out. Either way the caches are read again from the
   *  tables, and the error reaches the caller, whose retries replay receipts. */
  private landAll(reqs: ChangeRequest[], publish = true, approved = false): Submitted[] {
    assertRepositoryWritable(this.sql);
    const results: Submitted[] = [];
    const queued = this.feed.mark();
    const started = Date.now();
    let failed = false;
    beginBatch(this.sql);
    try {
      for (const req of reqs) {
        const before = this.feed.mark();
        beginLanding(this.sql);
        try {
          results.push(decideOnce(this.ctx.storage, req, () => this.decide(req, approved), () => this.backlog.admits(heldBytes(this.sql, PENDING, 2))));
        } catch (e) {
          this.feed.back(before);
          failed = true;
          throw e;
        } finally {
          endLanding(this.sql, !failed);
        }
      }
    } finally {
      const bytes = heldBytes(this.sql, PENDING, 2);
      try {
        this.ctx.storage.transactionSync(() => endBatch(this.sql));
        this.backlog.added(bytes, started);
      } catch (e) {
        this.feed.back(queued);
        failed = true;
        throw e;
      } finally {
        if (failed) {
          forget(this.sql);
          forgetLeases(this.sql);
        }
      }
    }
    if (publish && results.some((r) => r.status === "landed")) {
      void this.mirrorPush();
      // Landed is landed once it is in this object's storage: packing its git
      // objects into R2 goes on in the background, and the published head follows.
      void this.upload().catch(() => {});
    }
    return results;
  }

  private decide(req: ChangeRequest, approved = false): Submitted {
    if (this.repositoryMode()) return this.reject(req, "Git repository mode requires feature-branch pushes and pull requests; text submissions cannot rewrite its assets or history");
    try {
      const policies=new Policies(this.sql);
      if(approved)policies.restrictions("main",req.owner?.id??"",false,null,null);
      else policies.direct("main",false,true,req.owner?.id??"");
    } catch(error){return this.reject(req,(error as Error).message);}

    const tip = this.meta<Head>("tip");
    if (!tip) throw new Error("no such trunk");
    if (req.base > tip.version) return this.reject(req, `base v${req.base} is ahead of the trunk (v${tip.version})`);
    const strong = new Set(req.reads.strong);
    const weak = new Set(req.reads.weak);

    const named = targets(req.edits);
    const held = leased(this.sql, req.agent, named.writes, tip.version);
    if (held.length) return this.conflict(req, held);
    // Keys looked up for the first check are not looked up again for the second.
    const known = new Map<string, { version: number; change_id: string } | null>();
    const early = this.overlaps(req.base, named.writes, union(strong, named.reads), weak, known);
    if (early.hard.length) return this.conflict(req, early.hard);

    let applied: Applied;
    try {
      applied = applyEdits(req.edits, (path) => tipText(this.sql, path));
    } catch (e) {
      if (e instanceof EditError) return this.reject(req, e.message);
      throw e;
    }
    const late = leased(this.sql, req.agent, applied.writes, tip.version);
    if (late.length) return this.conflict(req, late);
    const { hard, soft } = this.overlaps(req.base, applied.writes, union(strong, applied.reads), weak, known);
    if (hard.length) return this.conflict(req, hard);
    if (applied.collisions.length) return this.reject(req, `already defined: ${applied.collisions.join(", ")}`);
    const size = [...applied.files.values()].reduce((n, text) => n + (text?.length ?? 0), 0);
    if (size > this.backlog.limits.changeBytes) return this.reject(req, `the change writes ${size} bytes of files; at most ${this.backlog.limits.changeBytes} land at once`);

    // Land. Nothing from the first check to here awaits, so changes land one
    // at a time and every check sees the tip it lands on.
    const version = tip.version + 1;
    const blobs = [...applied.files].flatMap(([path, text]) => putFile(this.sql, path, text) ?? []);
    const trees = rebuildTrees(this.sql, applied.files.keys());
    for (const k of applied.writes) put(this.sql, LAST_WRITE, k, [k, version, req.id]);
    const head = this.commitTip(version, [...blobs, ...trees.objects], trees.root, req, soft, tip.commit);
    if (req.pushed && heldRow(this.sql, PUSHED, req.pushed.sha) === undefined) put(this.sql, PUSHED, req.pushed.sha, [req.pushed.sha, version]);
    forgive(this.sql, req.agent);
    const at = Date.now();
    record(this.sql, { ...about(req), status: "landed", version, commit: head.commit, overlaps: soft, at });
    this.feed.emit({
      t: "landed",
      agent: req.agent,
      kind: req.kind,
      owner: req.owner ?? null,
      life: req.life,
      change: req.id,
      intent: req.intent,
      base: req.base,
      version,
      revalidate: soft.map((o) => o.key),
      issue: req.issue ?? null,
      closes: !!req.closes,
      at,
    });
    return { status: "landed", id: req.id, version, commit: head.commit, revalidate: soft, made: handBack(head.tree, [...blobs, ...trees.objects]) };
  }

  /** Changes landed back to back, for benchmarks (./sequencer/bench). */
  benchmark(n: number, prefix: string, apart = false, shape = "files", bots = 1000, batch = 1): Promise<number> {
    return backToBack(this, n, prefix, apart, shape, bots, batch);
  }

  /** The data center this object runs in. */
  colo(): Promise<string | null> {
    return dataCenter();
  }

  /** One kind of operation, `n` times, for timing (./sequencer/bench). */
  repeat(op: string, n: number): number {
    assertRepositoryWritable(this.sql);return repeat(this.sql, op, n);
  }

  /** Waits until `version`'s objects are in R2, for a client that reads it or
   *  builds on it next: a git push, or a life about to read. */
  async whenPublished(version: number): Promise<void> {
    if (this.repositoryMode()) return;
    await this.publishedThrough(version);
  }

  /** Every key the change touched that a later-landed change wrote. Writes and
   *  strong reads are hard: the change was planned on something that is gone.
   *  Weak reads are soft: the agent saw the symbol but may not depend on it. */
  private overlaps(base: number, writes: Set<string>, strong: Set<string>, weak: Set<string>, known: Map<string, { version: number; change_id: string } | null>) {
    const hard: Overlap[] = [];
    const soft: Overlap[] = [];
    const last = lastWrites(this.sql, new Set([...writes, ...strong, ...weak]), known);
    const check = (k: string, kind: Overlap["kind"], into: Overlap[]) => {
      const row = last.get(k);
      if (row && row.version > base) into.push({ key: k, kind, by: row.change_id, version: row.version });
    };
    for (const k of writes) check(k, "write", hard);
    for (const k of strong) if (!writes.has(k)) check(k, "read", hard);
    for (const k of weak) if (!writes.has(k) && !strong.has(k)) check(k, "weak", soft);
    return { hard, soft };
  }

  private conflict(req: ChangeRequest, conflicts: Overlap[]): SubmitResult {
    const at = Date.now();
    record(this.sql, { ...about(req), status: "conflict", version: null, commit: null, overlaps: conflicts, at });
    const winners = [...new Set(conflicts.filter((c) => c.kind !== "leased").map((c) => c.by))].flatMap((id) => changeById(this.sql, id) ?? []);
    const holders = [...new Set(conflicts.filter((c) => c.kind === "leased").map((c) => c.by))];
    const granted = starve(this.sql, req, conflicts, at);
    this.feed.emit({
      t: "conflict",
      agent: req.agent,
      kind: req.kind,
      owner: req.owner ?? null,
      life: req.life,
      change: req.id,
      intent: req.intent,
      base: req.base,
      keys: conflicts.map((c) => c.key),
      winners: [
        ...winners.map((w) => ({ agent: w.agent, change: w.id, intent: w.intent, version: w.version })),
        ...holders.map((agent) => ({ agent, change: "", intent: "", version: null })),
      ],
      ...(granted.length ? { leased: granted } : {}),
      issue: req.issue ?? null,
      at,
    });
    return { status: "conflict", id: req.id, conflicts, winners };
  }

  private reject(req: ChangeRequest, error: string): SubmitResult {
    const at = Date.now();
    record(this.sql, { ...about(req), status: "rejected", version: null, commit: null, overlaps: [], at });
    this.feed.emit({ t: "rejected", agent: req.agent, kind: req.kind, owner: req.owner ?? null, life: req.life, change: req.id, error, issue: req.issue ?? null, at });
    return { status: "rejected", id: req.id, error };
  }

  /** Builds the commit for the tip and queues its new objects for R2 and,
   *  when there is one, the Artifacts mirror. */
  private commitTip(version: number, objects: GitObject[], root: string, c: Landing, soft: Overlap[], parent: string | null): Head {
    assertRepositoryWritable(this.sql);
    const made = landingCommit(version, root, c, soft, parent);
    // Objects a recent version already made are published already.
    const all = [...new Map([...objects, made].map((o) => [o.sha, o])).values()];
    const fresh = unseen(this.sql, all.map((o) => o.sha));
    const rows = all.filter((o) => fresh.has(o.sha)).map((o) => [version, o.sha, buffer(o.raw)]);
    const at = Date.now();
    add(this.sql, PENDING, rows.map((r) => [...r, at]));
    if (this.meta<Mirror>("mirror") !== undefined) add(this.sql, OUTBOX, rows);
    put(this.sql, VERSIONS, String(version), [version, made.sha, root]);
    const head = { version, commit: made.sha, tree: root };
    setMeta(this.sql, "tip", head);
    return head;
  }

  /** Publishes pending objects to R2, one pack per batch, one drain at a time. */
  private upload(): Promise<void> {
    const trunk = this.meta<string>("trunk");
    if (!trunk) return Promise.resolve();
    this.uploading ??= this.publisher.drain(trunk).catch(async (error) => {
      await this.wake(Date.now() + 5_000);
      throw error;
    }).finally(() => {
      this.uploading = null;
    });
    return this.uploading;
  }

  /** Waits until `version` is published, and no longer: under a steady load
   *  the publisher never runs dry, so waiting for it to finish could take as
   *  long as the load lasts. */
  private async publishedThrough(version: number) {
    for (let i = 0; (this.meta<Head>("published")?.version ?? 0) < version; i++) {
      if (i > 1000) throw new Error(`v${version} landed but could not be published`);
      await Promise.race([this.upload(), this.moved.settled]);
    }
  }

  /** Pushes landed commits to the Artifacts mirror, one push at a time; a
   *  failed push is retried from an alarm. */
  private mirrorPush(): Promise<void> {
    this.mirroring ??= this.pusher
      .pushOutbox()
      .catch(async (e) => {
        console.error(`Artifacts push failed; retrying in 5s: ${e instanceof Error ? e.message : String(e)}`);
        await this.wake(Date.now() + 5_000);
      })
      .finally(() => {
        this.mirroring = null;
      });
    return this.mirroring;
  }

  /** Sets the alarm for `at`, unless it is already set for sooner. */
  private async wake(at: number) {
    const set = await this.ctx.storage.getAlarm();
    if (set === null || set <= Date.now() || at < set) await this.ctx.storage.setAlarm(at);
  }

  private meta<T>(k: string): T | undefined {
    return getMeta<T>(this.sql, k);
  }

  private packer() {
    return this.env.PACKER.get(this.env.PACKER.idFromName(this.meta<string>("trunk") ?? ""));
  }
}

const about = (req: ChangeRequest) => ({ id: req.id, agent: req.agent, intent: req.intent, base: req.base });

/** The most bytes of objects handed back with one landing. A change in a
 *  very big directory hands back none, and its agent reads them from R2. */
const MADE_BYTES = 64 * 1024;

function handBack(tree: string, objects: { sha: string; raw: Uint8Array }[]): Made {
  let bytes = 0;
  for (const o of objects) bytes += o.raw.length;
  return { tree, objects: bytes <= MADE_BYTES ? objects.map((o) => ({ sha: o.sha, raw: o.raw })) : [] };
}
const union = (a: Set<string>, b: Set<string>) => new Set([...a, ...b]);
const buffer = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

/** A promise settled from outside, once. */
function signal() {
  let fire!: () => void;
  const settled = new Promise<void>((resolve) => (fire = resolve));
  return { settled, fire };
}
