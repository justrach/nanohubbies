import {Collaborators,type RepoRole} from './store';
import {collaboratorRevision} from './revision';
import {ArchiveStore,archiveLocked,assertRepositoryWritable} from '../repository/archive';
export type CollaboratorEdit={revision:number;credentialId:string}&(
 {op:'invite';id:string;userId:string;role:RepoRole;tokenHash:string}|
 {op:'change';userId:string;role:RepoRole|null}|
 {op:'cancel';id:string}
);
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
export class CollaboratorAdministration {
 private store:Collaborators;
 constructor(private sql:SqlStorage,private trunk:string,credentialId?:string){
  this.store=new Collaborators(sql,credentialId);
  sql.exec('CREATE TABLE IF NOT EXISTS cli_collaborator_invitations (id TEXT PRIMARY KEY,trunk TEXT NOT NULL,actor TEXT NOT NULL,user_id TEXT NOT NULL,role TEXT NOT NULL,token_hash TEXT NOT NULL)');
 }
 configuration(actor:string) {
  const role=this.store.role(this.trunk,actor);
  if(role!=='owner'&&role!=='admin')throw Error('Current repository owner or admin access required');
  const audit=this.sql.exec<{id:number;actor:string;action:string;target:string;at:number;credentialId:string|null}>('SELECT id,actor,action,target,at,credential_id AS credentialId FROM access_audit WHERE trunk=? ORDER BY id DESC LIMIT 50',this.trunk).toArray();
  const readOnly=archiveLocked(new ArchiveStore(this.sql,this.trunk).state());
  return {...this.store.list(this.trunk),trunk:this.trunk,revision:collaboratorRevision(this.sql,this.trunk),currentRole:role,readOnly,canManage:!readOnly,conditionalWrites:true as const,revisionTracking:'storage' as const,clientInvitations:'v1' as const,audit};
 }
 edit(actor:string,input:CollaboratorEdit) {
  const state=this.configuration(actor);assertRepositoryWritable(this.sql,this.trunk);
  if(!input||!Number.isSafeInteger(input.revision)||input.revision<0||typeof input.credentialId!=='string'||!input.credentialId)throw Error('Use a current collaborator revision and CLI credential identity');
  if(input.op==='invite') {
   if(!uuid(input.id)||typeof input.userId!=='string'||!/^(codegraff|dev):[^\s]{1,200}$/.test(input.userId)||!['reader','writer','admin'].includes(input.role)||!/^[a-f0-9]{64}$/.test(input.tokenHash))throw Error('Invalid client invitation');
   if(input.role==='admin'&&state.currentRole!=='owner')throw Error('Only the owner can manage admins');
   const prior=this.sql.exec<{trunk:string;actor:string;user_id:string;role:string;token_hash:string}>('SELECT trunk,actor,user_id,role,token_hash FROM cli_collaborator_invitations WHERE id=?',input.id).toArray()[0];
   if(prior) {
    if(prior.trunk!==this.trunk||prior.actor!==actor||prior.user_id!==input.userId||prior.role!==input.role||prior.token_hash!==input.tokenHash)throw Error('Conflicting invitation recovery');
    const invitation=state.invitations.find(invitation=>invitation.id===input.id);
    if(!invitation)throw Error('Invitation is no longer available and cannot be recovered');
    return {...state,invitation,created:false};
   }
  }
  if(state.revision!==input.revision)return {conflict:true as const,revision:state.revision};
  if(input.op==='invite') {
   const invitation=this.store.invite(this.trunk,actor,input.userId,input.role,input.tokenHash,input.id);
   this.sql.exec('INSERT INTO cli_collaborator_invitations VALUES(?,?,?,?,?,?)',input.id,this.trunk,actor,input.userId,input.role,input.tokenHash);
   return {...this.configuration(actor),invitation,created:true};
  }
  if(input.op==='change') {
   if(typeof input.userId!=='string'||input.role!==null&&!['reader','writer','admin'].includes(input.role))throw Error('Invalid collaborator edit');
   this.store.change(this.trunk,actor,input.userId,input.role);
  }else if(input.op==='cancel'){
   if(!uuid(input.id))throw Error('Invalid invitation ID');this.store.cancel(this.trunk,actor,input.id);
  }else throw Error('Unknown collaborator operation');
  return this.configuration(actor);
 }
}
