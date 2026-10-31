import {ArchiveStore,assertRepositoryWritable,type ArchiveChange} from "./repository/archive";
import { Namespaces } from "./namespaces/store";
import { Collaborators, type RepoRole } from "./collaborators/store";
import { DurableObject } from "cloudflare:workers";
import type { AbuseLimits } from "./abuse";
import { TeamStore, type TeamBinding, type IdentityProof } from "./team/store";
import { Admission } from "./hub/admission";
import { ReleaseStore } from "./releases/store";
import type { ReleaseCommand } from "./releases/types";
import {SigningKeys} from "./signing/store";
import {sshKey} from "./signing/ssh";
import {pgpKey} from "./signing/pgp";
import {verifyCommit} from "./signing/verify";
import {currentSigningEmail} from "./signing/identity";
import {ActionsCapacity,actionsLimits,type ReserveSandbox} from './ci/capacity';
import {CollaboratorAdministration,type CollaboratorEdit} from './collaborators/administration';

export interface TrunkInfo {
  name: string;
  created: number;
  /** Where the seed came from: a template name or a git URL. */
  source: string;
  owner: string | null;
}

/** The list of trunks. One instance serves the whole deployment. */
export class Hub extends DurableObject<Env> {
  private sql: SqlStorage;
  private admission: Admission;
  private teams: TeamStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS trunks (name TEXT PRIMARY KEY, created INTEGER NOT NULL, source TEXT NOT NULL, owner TEXT)");
    this.teams = new TeamStore(this.sql);
    this.admission = new Admission(ctx.storage, this.sql);
  }

  private actionsAccount(trunk:string) {
    const entry=this.find(trunk);if(!entry?.owner)throw Error('Actions capacity requires an owned repository');
    const binding=this.teams.get(trunk);
    return binding&&binding.kind!=='owner'?JSON.stringify(['team',binding.issuer,binding.roomId]):JSON.stringify(['owner',entry.owner]);
  }
  actionsCapacity(trunk:string) {
    return this.ctx.storage.transactionSync(()=>{const account=this.actionsAccount(trunk);return {limits:actionsLimits(this.env),usage:new ActionsCapacity(this.sql).usage(account),sharedReservations:'v1' as const};});
  }
  reserveActionsSandbox(trunk:string,input:ReserveSandbox) {
    return this.ctx.storage.transactionSync(()=>{assertRepositoryWritable(this.sql,trunk);return new ActionsCapacity(this.sql).reserve(trunk,this.actionsAccount(trunk),input,actionsLimits(this.env));});
  }
  inspectActionsSandbox(trunk:string,id:string) {return this.ctx.storage.transactionSync(()=>new ActionsCapacity(this.sql).inspect(trunk,id));}
  attachActionsSandbox(trunk:string,id:string,sandbox:string) {return this.ctx.storage.transactionSync(()=>new ActionsCapacity(this.sql).attach(trunk,id,sandbox));}
  releaseActionsSandbox(trunk:string,id:string,evidence:{reason:'not-created'|'destroyed';sandboxId?:string}) {return this.ctx.storage.transactionSync(()=>new ActionsCapacity(this.sql).release(trunk,id,evidence));}

  repositoryArchive(trunk:string) { return new ArchiveStore(this.sql,trunk).state(); }
  archiveConfiguration(trunk:string) {return {...this.repositoryArchive(trunk),conditionalWrites:true as const,nameConfirmation:true as const};}
  configureRepositoryArchive(trunk:string,actor:string,archived:boolean,revision:number,credentialId:string,proof?:IdentityProof,confirmation?:string) {
    return this.archiveRepository(trunk,actor,archived,revision,proof,{conditional:true,confirmation,via:{kind:"cli",credentialId}});
  }
  assertRepositoryWritable(trunk:string) { assertRepositoryWritable(this.sql,trunk); }
  async archiveRepository(trunk:string,actor:string,archived:boolean,revision:number,proof?:IdentityProof,options?:{conditional?:boolean;confirmation?:string;via?:ArchiveChange["via"]}) {
    const state=this.ctx.storage.transactionSync(()=>{
      const entry=this.find(trunk);if(!entry)throw Error("Repository not found");
      const binding=this.teams.get(trunk),role=binding?.kind==="owner"?new Collaborators(this.sql).role(trunk,actor):null;
      const external=binding&&binding.kind!=="owner"&&proof&&proof.ownerId===actor&&!proof.agentId&&proof.roomId===binding.roomId&&proof.issuer===binding.issuer&&proof.role==="owner"&&proof.verifiedAt<=Date.now()+1000&&Date.now()-proof.verifiedAt<30000;
      if(!(binding?.kind==="owner"?["owner","admin"].includes(role??""):external||entry.owner===actor&&!binding))throw Error("A current repository owner or admin is required to archive");
      if(options?.conditional&&options.confirmation!==(new Namespaces(this.sql).byId(trunk)?.name??trunk))throw Error("Repository name changed; inspect archive status before continuing");
      return new ArchiveStore(this.sql,trunk).prepare(archived,revision,actor,Date.now(),options);
    });
    if(!state.transition)return state;
    const change=state.transition;
    // A reopen commits at the Hub before either local writer is activated.
    // Partial activation is visible and resumable, never falsely "archived".
    if(!change.archived)this.ctx.storage.transactionSync(()=>new ArchiveStore(this.sql,trunk).beginOpening(change));
    // Persist the pending Hub fence before either RPC. Lost replies leave an
    // explicit resumable operation; they never reopen metadata mutation.
    await this.env.ROOM.get(this.env.ROOM.idFromName(trunk)).applyRepositoryArchive(trunk,change);
    await this.env.SEQUENCER.get(this.env.SEQUENCER.idFromName(trunk)).applyRepositoryArchive(change);
    return this.ctx.storage.transactionSync(()=>{if(!this.find(trunk))throw Error("Repository not found");return new ArchiveStore(this.sql,trunk).complete(change);});
  }
  claimNamespace(name: string, actor: string) { return this.ctx.storage.transactionSync(() => new Namespaces(this.sql).claim(name,actor)); }
  signingKeys(owner:string){return new SigningKeys(this.sql).list(owner);}
  async addSigningKey(owner:import("./types").Owner,label:string,publicKey:string,emails:string[]) {
    if(typeof publicKey!=="string"||publicKey.length>64*1024)throw Error("Provide a public signing key up to 64 KiB");
    const current=await Promise.all(emails.map(async email=>await currentSigningEmail(this.env,owner.id,email)?email:null)),allowed=current.filter((email):email is string=>!!email);
    const parsed=publicKey.trim().startsWith("-----BEGIN PGP PUBLIC KEY BLOCK-----")?await pgpKey(publicKey,allowed):sshKey(publicKey);
    return this.ctx.storage.transactionSync(()=>{new SigningKeys(this.sql).add(parsed,label,owner,allowed);return new SigningKeys(this.sql).list(owner.id);});
  }
  revokeSigningKey(owner:string,id:string){return this.ctx.storage.transactionSync(()=>new SigningKeys(this.sql).revoke(owner,id));}
  verifyCommitSignature(repository:string,commit:string,raw:Uint8Array){return verifyCommit(this.sql,repository,commit,raw,body=>this.ctx.storage.transactionSync(body),(account,email)=>currentSigningEmail(this.env,account,email));}
  commitSignature(repository:string,commit:string){return new SigningKeys(this.sql).receipt(repository,commit);}
  namespaceExists(name:string) { return new Namespaces(this.sql).exists(name); }
  namespaceFor(actor: string) { return new Namespaces(this.sql).owned(actor); }
  codeOwnerAccounts(trunk: string, tokens: string[]) {
    if(!Array.isArray(tokens)||tokens.length>1000||tokens.some(t=>typeof t!=="string"||t.length>256))throw Error("Invalid code owner lookup");
    const namespaces=new Namespaces(this.sql),binding=this.teams.get(trunk),direct=binding?.kind==="owner",members=new Collaborators(this.sql);
    return {binding,accounts:Object.fromEntries(tokens.map(token=>{
      const id=/^@[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(token)?namespaces.ownerForHandle(token.slice(1)):null;
      return [token,id&&(!direct||["owner","admin","writer"].includes(members.role(trunk,id)??""))?id:null];
    }))};
  }
  repositoryAddress(id: string) { return new Namespaces(this.sql).byId(id); }
  resolveRepository(namespace: string, name: string) { return new Namespaces(this.sql).resolve(namespace,name); }
  reserveRepository(namespace: string, name: string, actor: string, existingId?:string) { return this.ctx.storage.transactionSync(() => {if(existingId)assertRepositoryWritable(this.sql,existingId);const repo=new Namespaces(this.sql).reserve(namespace,name,actor,existingId);assertRepositoryWritable(this.sql,repo.id);return repo;}); }
  renameRepository(id:string,name:string,actor:string) { return this.ctx.storage.transactionSync(() => {assertRepositoryWritable(this.sql,id);return new Namespaces(this.sql).rename(id,name,actor);}); }
  collaboratorRole(trunk: string, userId: string) { return new Collaborators(this.sql).role(trunk,userId); }
  rulesetActor(trunk:string,actor:string) {
    const binding=this.teams.get(trunk),role=binding?.kind==='owner'?new Collaborators(this.sql).role(trunk,actor):!binding&&this.find(trunk)?.owner===actor?'owner':null;
    return {binding,role,checkedAt:Date.now()};
  }
  rulesetRoleSupport(){return true as const;}
  reviewerAccess(trunk:string,ids:string[]) {
    if(!Array.isArray(ids)||ids.length>2000||ids.some(id=>typeof id!=="string"||id.length>256))throw Error("Invalid reviewer lookup");
    const binding=this.teams.get(trunk),members=binding?.kind==="owner"?new Collaborators(this.sql):null,owner=!binding?this.find(trunk)?.owner:null;
    const accounts:Record<string,"writer"|"no_write">={};
    for(const id of ids)accounts[id]=(members?["owner","admin","writer"].includes(members.role(trunk,id)??""):!binding&&owner===id)?"writer":"no_write";
    return {binding,accounts,checkedAt:Date.now()};
  }
  /** A distinct RPC prevents a reader-aware caller from trusting old role hints. */
  reviewFeedbackAccess(trunk:string,ids:string[]) {
    if(!Array.isArray(ids)||ids.length>2000||ids.some(id=>typeof id!=='string'||!id||id.length>256))throw Error('Invalid reviewer lookup');
    const binding=this.teams.get(trunk),members=binding?.kind==='owner'?new Collaborators(this.sql):null,owner=!binding?this.find(trunk)?.owner:null;
    const accounts:Record<string,'writer'|'reader'|'no_write'>={};
    for(const id of ids){const role=members?members.role(trunk,id):!binding&&owner===id?'owner':null;accounts[id]=role==='reader'?'reader':role&&['owner','admin','writer'].includes(role)?'writer':'no_write';}
    return {binding,accounts,checkedAt:Date.now(),readerFeedback:'v1' as const};
  }
  deploymentReviewerAccess(trunk:string,ids:string[]) {
    if(!Array.isArray(ids)||ids.length>128||ids.some(id=>typeof id!=="string"||!id||id.length>256))throw Error("Invalid deployment reviewer lookup");
    const binding=this.teams.get(trunk),members=binding?.kind==="owner"?new Collaborators(this.sql):null,owner=!binding?this.find(trunk)?.owner:null;
    const accounts:Record<string,"member"|"absent">={};for(const id of ids)accounts[id]=(members?!!members.role(trunk,id):!binding&&owner===id)?"member":"absent";
    return {binding,accounts,checkedAt:Date.now()};
  }
  collaborators(trunk: string) { return new Collaborators(this.sql).list(trunk); }
  collaboratorConfiguration(trunk:string,actor:string) {return this.ctx.storage.transactionSync(()=>new CollaboratorAdministration(this.sql,trunk).configuration(actor));}
  configureCollaborators(trunk:string,actor:string,input:CollaboratorEdit) {return this.ctx.storage.transactionSync(()=>new CollaboratorAdministration(this.sql,trunk,input.credentialId).edit(actor,input));}
  inviteCollaborator(trunk: string, actor: string, userId: string, role: RepoRole, hash: string) { return this.ctx.storage.transactionSync(() => {assertRepositoryWritable(this.sql,trunk);return new Collaborators(this.sql).invite(trunk,actor,userId,role,hash);}); }
  acceptInvitation(trunk: string, userId: string, hash: string) { return this.ctx.storage.transactionSync(() => new Collaborators(this.sql).accept(trunk,userId,hash)); }
  changeCollaborator(trunk: string, actor: string, userId: string, role: RepoRole | null) { return this.ctx.storage.transactionSync(() => {assertRepositoryWritable(this.sql,trunk);return new Collaborators(this.sql).change(trunk,actor,userId,role);}); }
  cancelInvitation(trunk: string, actor: string, id: string) { assertRepositoryWritable(this.sql,trunk);return new Collaborators(this.sql).cancel(trunk,actor,id); }
  team(trunk: string) { return this.teams.get(trunk); }
  releases(command: ReleaseCommand) { return this.ctx.storage.transactionSync(() => {if(command.op!=="list")assertRepositoryWritable(this.sql,command.op==="create"?command.release.trunk:command.trunk);return new ReleaseStore(this.sql).run(command);}); }
  protectOwner(trunk: string, ownerId: string, origin: string) { assertRepositoryWritable(this.sql,trunk);return this.teams.protectOwner(trunk, ownerId, origin); }
  bindTeam(trunk: string, ownerId: string, binding: TeamBinding) { assertRepositoryWritable(this.sql,trunk);return this.teams.bind(trunk, ownerId, binding); }
  teamProof(trunk: string, principal: string) { return this.teams.proof(trunk, principal); }
  recordTeamProof(trunk: string, proof: IdentityProof) { this.teams.record(trunk, proof); }

  add(t: TrunkInfo) {
    this.sql.exec("INSERT OR REPLACE INTO trunks (name, created, source, owner) VALUES (?, ?, ?, ?)", t.name, t.created, t.source, t.owner);
  }

  /** Forgets a trunk and its releases; returns the release files' keys to delete. */
  remove(name: string): string[] {
    return this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM trunks WHERE name = ?", name);new ArchiveStore(this.sql,name).forget();
      return new ReleaseStore(this.sql).forget(name);
    });
  }

  reserve(name: string, owner: string | null, creator: string, limits: AbuseLimits) {
    return this.admission.reserve(name, owner, creator, limits);
  }

  complete(t: TrunkInfo, ticket: string) {
    this.admission.complete(t, ticket);
  }

  release(name: string, ticket: string) {
    this.admission.release(name, ticket);
  }

  // Rate-only instances use the same existing DO binding, but a separate name
  // per hashed connecting address: agent traffic never serializes on the Hub.
  takeRate(bucket: "creation" | "control" | "agent", limit: number, windowMs: number) {
    return this.admission.takeRate(bucket, limit, windowMs);
  }

  /** One trunk, or null. */
  find(name: string): TrunkInfo | null {
    return this.sql.exec<{ name: string; created: number; source: string; owner: string | null }>("SELECT name, created, source, owner FROM trunks WHERE name = ?", name).toArray()[0] ?? null;
  }

  list(): TrunkInfo[] {
    return this.sql.exec<{ name: string; created: number; source: string; owner: string | null }>("SELECT name, created, source, owner FROM trunks ORDER BY created DESC LIMIT 500").toArray();
  }
}
