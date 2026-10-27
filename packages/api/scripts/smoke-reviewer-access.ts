import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {teamFixture,ROOM} from './team/fixture.ts';
const f=await teamFixture(),exec=promisify(execFile),issued:{id:string;cookie:Record<string,string>}[]=[];
try{
 const author=await f.login('author','101'),reviewer=await f.login('reviewer','202'),backup=await f.login('backup','303');
 async function prepare(trunk:string,external=false){
  const base=`/api/trunks/${trunk}`;await f.json('POST',base,{mode:'git'},author);
  if(external)await f.json('POST',`${base}/team`,{roomId:ROOM},author);
  else for(const [id,who] of [['reviewer',reviewer],['backup',backup]] as const){const invite=await f.json('POST',`${base}/collaborators`,{userId:`codegraff:${id}`,role:'writer'},author);await f.json('POST','/api/invitations/accept',{trunk,token:invite.token},who);}
  const token=await f.json('POST',`${base}/git-tokens`,{label:'Reviewer access fixture'},author);issued.push({id:token.id,cookie:author});
  const dir=join(f.dir,trunk);await mkdir(dir);const git=async(...args:string[])=>(await exec('git',['-C',dir,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args])).stdout.trim();
  await git('init','-b','main');await writeFile(join(dir,'README.md'),'Base\n');await git('add','.');await git('commit','-m','Base');const anchor=await git('rev-parse','HEAD'),remote=`${f.origin}/git/${trunk}.git`;
  const transport=async(...args:string[])=>exec('git',['-C',dir,...args],{env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:`http.${remote}.extraHeader`,GIT_CONFIG_VALUE_0:`Authorization: Basic ${btoa(`git:${token.token}`)}`}});
  await transport('push',remote,'main');await git('checkout','-b','feature');await writeFile(join(dir,'README.md'),'Candidate\n');await git('add','.');await git('commit','-m','Candidate');await transport('push',remote,'feature');const commit=await git('rev-parse','HEAD');
  const policy={branch:'main',pullRequest:true,approvals:1,checks:[],beforeOpen:[],preventForce:true,preventDelete:true,dismissStaleReviews:false};await f.json('PUT',`${base}/protection`,policy,author);await f.json('POST',`${base}/pulls`,{title:'Current reviewer access',head:'feature'},author);
  const observed={commit,anchor},view=()=>f.json('GET',`${base}/pulls/1`,undefined,author),review=async(who=reviewer,verdict='APPROVE')=>f.json('POST',`${base}/pulls/1/reviews`,{...observed,verdict,body:'Original reviewer feedback'},who),merge=()=>f.request('POST',`${base}/pulls/1/merge`,{...observed,reviewerAccess:{'codegraff:reviewer':'writer'},membership:{accounts:{'codegraff:reviewer':'writer'}}},author);
  const unchanged=async()=>assert.equal((await f.json('GET',`${base}/repository`,undefined,author)).refs.find((r:any)=>r.name==='refs/heads/main').commit,anchor);
  return{base,dir,commit,anchor,policy,observed,view,review,merge,unchanged,transport,git,remote};
 }
 const native=await prepare('reviewer-native');const calls=f.provider.calls;f.provider.down=true;
 await native.review();assert.equal((await native.view()).reviewGate.approvals,1);
 await f.json('PATCH',`${native.base}/collaborators`,{userId:'codegraff:reviewer',role:'reader'},author);let v=await native.view();assert.equal(v.reviewGate.approvals,0);assert.equal(v.reviewGate.reviewerAccess['codegraff:reviewer'],'no_write');assert.equal(v.reviews[0].body,'Original reviewer feedback');assert.equal(v.reviews[0].dismissed,undefined);assert.equal((await native.merge()).status,400);await native.unchanged();
 assert.equal((await f.request('POST',`${native.base}/pulls/1/reviews`,{...native.observed,verdict:'APPROVE'},reviewer)).status,403);
 await native.review(backup);assert.equal((await native.view()).reviewGate.ready,true);await f.json('PATCH',`${native.base}/collaborators`,{userId:'codegraff:backup',role:null},author);assert.equal((await native.view()).reviewGate.approvals,0);assert.equal((await native.merge()).status,400);await native.unchanged();
 await f.json('PATCH',`${native.base}/collaborators`,{userId:'codegraff:reviewer',role:'writer'},author);await native.review(reviewer,'REQUEST_CHANGES');await f.json('PATCH',`${native.base}/collaborators`,{userId:'codegraff:reviewer',role:'reader'},author);v=await native.view();assert.match(v.reviewGate.error,/requested changes/);const change=v.reviews.at(-1);await f.json('PUT',`${native.base}/pulls/1/reviews/${change.id}/dismissals`,{message:'Explicitly dismiss the synthetic change request after access loss'},author);
 await f.json('PATCH',`${native.base}/collaborators`,{userId:'codegraff:reviewer',role:'writer'},author);await native.review();await f.json('PUT',`${native.base}/protection`,{...native.policy,approvals:0,requireLastPushApproval:true},author);assert.equal((await native.view()).reviewGate.ready,true);await f.json('PATCH',`${native.base}/collaborators`,{userId:'codegraff:reviewer',role:'reader'},author);assert.equal((await native.view()).reviewGate.ready,false);assert.equal((await native.merge()).status,400);
 await f.json('PATCH',`${native.base}/collaborators`,{userId:'codegraff:reviewer',role:'writer'},author);await native.review();assert.equal((await native.merge()).status,200);assert.equal(f.provider.calls,calls,'Native reviewer eligibility is independent of Codegraff availability');
 f.provider.down=false;const team=await prepare('reviewer-team',true);await team.review();assert.equal((await team.view()).reviewGate.ready,true);
 f.provider.blockedSubjects.add('202');v=await team.view();assert.equal(v.reviewGate.approvals,0);assert.equal(v.reviewGate.reviewerAccess['codegraff:reviewer'],'unavailable');assert.match(v.reviewGate.error,/write access could not be verified/);assert.equal((await team.merge()).status,400);await team.unchanged();
 f.provider.blockedSubjects.delete('202');f.members.delete('202');v=await team.view();assert.equal(v.reviewGate.approvals,0);assert.equal(v.reviewGate.reviewerAccess['codegraff:reviewer'],'no_write');assert.equal((await team.merge()).status,400);await team.unchanged();
 f.members.set('202','member');await team.review();assert.equal((await team.view()).reviewGate.ready,true);assert.equal((await team.merge()).status,200);
 const clone=join(f.dir,'clone');await team.transport('clone',team.remote,clone);assert.equal((await exec('git',['-C',clone,'rev-parse','HEAD'])).stdout.trim(),team.commit);await exec('git',['-C',clone,'fsck','--strict']);
 console.log('PASS: current reviewer write membership, native demotion/removal, retained/latest-push approvals, unchanged rejected refs, preserved change requests, external per-reviewer outage/revocation, protected merge and clone/fsck');
}finally{for(const token of issued)await f.json('DELETE',`/api/tokens/${token.id}`,undefined,token.cookie).catch(()=>{});await f.close();}
