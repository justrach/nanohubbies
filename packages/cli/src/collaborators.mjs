import {resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {outsideCheckout,readPrivateJson,createPrivateJson} from './private-file.mjs';
const account=value=>typeof value==='string'&&/^(codegraff|dev):[^\s]{1,200}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const role=value=>['reader','writer','admin'].includes(value);
const acceptUrl=(origin,trunk,token)=>origin+'/invite#'+new URLSearchParams({trunk,token}).toString();
function document(value,target) {
 if(!value||Array.isArray(value)||Object.keys(value).some(key=>!['format','origin','repository','trunk','repositoryId','acceptUrl','id','userId','role','token'].includes(key))||value.format!==1||value.origin!==target.origin||value.repository!==target.repository||value.trunk!==target.trunk||typeof value.repositoryId!=='string'||!/^[a-z0-9][a-z0-9-]{0,62}$/.test(value.repositoryId)||!uuid(value.id)||!account(value.userId)||!role(value.role)||typeof value.token!=='string'||!/^nhi_[a-f0-9]{64}$/.test(value.token)||value.acceptUrl!==acceptUrl(value.origin,value.repositoryId,value.token))throw Error('Use an invitation for this exact host and repository');
 return value;
}
export async function collaboratorCommand({action,pos,opts,target,base,token,request,output,cwd=process.cwd()}) {
 const file=opts['invite-file']?resolve(cwd,opts['invite-file']):undefined;
 if(action==='list'&&(pos.length||file||opts.role!==undefined||opts.revision!==undefined||opts.confirm!==undefined))throw Error('Use access list');
 if(action==='invite'&&(pos.length!==1||!account(pos[0])||!role(opts.role)||!file||opts.confirm!==undefined))throw Error('Use access invite ACCOUNT --role reader|writer|admin --invite-file FILE --revision N');
 if(action==='recover'&&(pos.length||!file||opts.role!==undefined||opts.revision!==undefined||opts.confirm!==undefined))throw Error('Use access recover --invite-file FILE');
 if(action==='role'&&(pos.length!==1||!account(pos[0])||!role(opts.role)||file||opts.confirm!==undefined))throw Error('Use access role ACCOUNT --role reader|writer|admin --revision N');
 if(action==='remove'&&(pos.length!==1||!account(pos[0])||opts.confirm!==pos[0]||file||opts.role!==undefined))throw Error('Use access remove ACCOUNT --revision N --confirm ACCOUNT');
 if(action==='cancel'&&(pos.length!==1||!uuid(pos[0])||opts.confirm!==pos[0]||file||opts.role!==undefined))throw Error('Use access cancel INVITATION_ID --revision N --confirm INVITATION_ID');
 if(!['list','recover'].includes(action)&&!/^(0|[1-9]\d{0,15})$/.test(opts.revision??''))throw Error('Use the --revision from access list');
 if(file)await outsideCheckout(file,'invitation');
 const saved=action==='recover'?await readPrivateJson(file,'invitation',value=>document(value,target)):null;
 const path=base+'/collaborators',state=await request(path,token);
 if(state.conditionalWrites!==true||state.clientInvitations!=='v1'||state.revisionTracking!=='storage')throw Error('Collaborator administration is updating; inspect access list again shortly');
 if(saved&&saved.repositoryId!==state.trunk)throw Error('Invitation belongs to a different immutable repository');
 if(action==='list') {
  output(state,`Access revision: ${state.revision}\n`+state.members.map(member=>`${member.userId}\t${member.role}`).join('\n')+'\n'+state.invitations.map(invitation=>`${invitation.id}\t${invitation.userId}\t${invitation.role}\tpending`).join('\n'));return;
 }
 if(state.readOnly||!state.canManage)throw Error('Collaborator administration requires an active repository and your current admin role');
 const revision=action==='recover'?state.revision:Number(opts.revision);
 if(!Number.isSafeInteger(revision)||revision<0||revision!==state.revision)throw Error('Repository access changed; inspect access list before editing');
 if(['invite','recover'].includes(action)) {
  const selected=saved??{format:1,origin:target.origin,repository:target.repository,trunk:target.trunk,repositoryId:state.trunk,id:randomUUID(),userId:pos[0],role:opts.role,token:'nhi_'+randomBytes(32).toString('hex')};
  if(!saved)selected.acceptUrl=acceptUrl(target.origin,state.trunk,selected.token);
  if(selected.role==='admin'&&state.currentRole!=='owner')throw Error('Only the repository owner can invite admins');
  if(!saved)await createPrivateJson(file,selected,'invitation','invitation');
  let result;
  try{result=await request(path,token,{method:'POST',revision,revisionType:'collaborators',body:{id:selected.id,userId:selected.userId,role:selected.role,token:selected.token,revision}});}
  catch(error){throw Error(`${error.message}. Keep the private invitation file; inspect access list or use access recover --invite-file FILE for this same invitation.`);}
  const invitation=result.invitation;
  if(invitation?.id!==selected.id||invitation.userId!==selected.userId||invitation.role!==selected.role)throw Error('Invitation was not confirmed; keep the private file and inspect access list');
  // Never print the token/link. The recipient must accept with their own
  // signed-in account through the existing browser invitation page.
  output({invitation:{id:invitation.id,userId:invitation.userId,role:invitation.role,expires:invitation.expires},revision:result.revision,inviteFile:file},`Invitation ${invitation.id} saved in ${file}. Share it privately with ${invitation.userId}; acceptance requires their signed-in account.`);return;
 }
 const method=action==='cancel'?'DELETE':'PATCH',body=action==='cancel'?{id:pos[0],revision}:{userId:pos[0],role:action==='remove'?null:opts.role,revision};
 const result=await request(path,token,{method,body,revision,revisionType:'collaborators'});
 output(result,`Saved repository access. Revision: ${result.revision}.`);
}
