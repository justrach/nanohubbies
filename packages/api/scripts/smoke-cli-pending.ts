import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {teamFixture} from './team/fixture.ts';

const f=await teamFixture(),exec=promisify(execFile),trunk='cli-pending',base=`/api/trunks/${trunk}`,gateway=`/api/cli/trunks/${trunk}`,path=gateway+'/pulls/1/pending-review';
const environment={...process.env,NANOHUB_API_TOKEN:'',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'};
let owner:any,key:any,bin=resolve(import.meta.dirname,'../../cli/bin/nh.mjs');
const issued:{id:string;cookie:any}[]=[],auth=(c:any)=>({Authorization:`Bearer ${c.token}`});
const cli=async(args:string[],credential:any)=>{try{return {code:0,...await exec('bun',[bin,'pr',...args,'--host',f.origin,'--trunk',trunk,'--json'],{cwd:f.dir,env:{...environment,NANOHUB_API_TOKEN:credential.token}})};}catch(error){const e=error as Error&{code:number;stdout:string;stderr:string};return {code:e.code,stdout:e.stdout,stderr:e.stderr};}};
const success=async(args:string[],credential:any)=>{const result=await cli(args,credential);assert.equal(result.code,0,result.stdout+result.stderr);assert.ok(!result.stdout.includes(credential.token));return JSON.parse(result.stdout);};
try {
 if(process.argv.includes('--bundle')){
  const distribution=join(f.dir,"Pending CLI's distribution"),manifest=JSON.parse((await exec('bun',[resolve(import.meta.dirname,'../../cli/scripts/build.mjs'),distribution],{env:environment})).stdout);
  bin=join(distribution,'releases',manifest.version,'nh.mjs');const bytes=await readFile(bin);assert.equal(bytes.length,manifest.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.sha256);
  assert.equal((await exec('bun',[bin,'--version'],{env:environment})).stdout.trim(),'nh '+manifest.version);
  console.log('Packaged CLI:',JSON.stringify(manifest));
 }
 owner=await f.login('owner','101');const writer=await f.login('writer','202'),reader=await f.login('reader','303');
 await f.json('POST',base,{mode:'git'},owner);await f.json('POST','/api/trunks/other-pending',{mode:'git'},owner);
 for(const[id,cookie,role]of [['writer',writer,'writer'],['reader',reader,'reader']]as const){const invitation=await f.json('POST',base+'/collaborators',{userId:'codegraff:'+id,role},owner);await f.json('POST','/api/invitations/accept',{trunk,token:invitation.token},cookie);}
 const make=async(cookie:any,scopes=['read','reviews:write'])=>{const value=await f.json('POST',base+'/cli-credentials',{label:'Pending CLI fixture',scopes,days:1},cookie);issued.push({id:value.id,cookie});return value;};
 const grant=await make(writer),sibling=await make(writer),ownerGrant=await make(owner),read=await make(reader,['read']),ownerRead=await make(owner,['read']);
 key=await f.json('POST',base+'/git-tokens',{label:'Pending CLI Git fixture'},owner);
 const source=join(f.dir,'source');await mkdir(source);const remote=f.origin+'/git/'+trunk+'.git';
 const git=async(...args:string[])=>(await exec('git',['-C',source,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{env:environment})).stdout.trim();
 const transport=(...args:string[])=>exec('git',['-C',source,...args],{env:{...environment,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:`http.${remote}.extraHeader`,GIT_CONFIG_VALUE_0:'Authorization: Basic '+btoa('git:'+key.token)}});
 await git('init','-b','main');await writeFile(join(source,'README.md'),'Base\n');await writeFile(join(source,'other.txt'),'Before\n');await git('add','.');await git('commit','-m','Base');const anchor=await git('rev-parse','HEAD');await transport('push',remote,'main');
 await git('checkout','-b','feature');await writeFile(join(source,'README.md'),'Candidate\nSecond line\n');await writeFile(join(source,'other.txt'),'After\n');await git('add','.');await git('commit','-m','Candidate');let commit=await git('rev-parse','HEAD');await transport('push',remote,'feature');
 await f.json('PUT',base+'/protection',{branch:'main',pullRequest:true,approvals:1,checks:[],beforeOpen:[],preventForce:true,preventDelete:true,requireConversationResolution:true},owner);
 await f.json('POST',base+'/pulls',{title:'Private CLI batch',head:'feature'},owner);
 const view=()=>f.json('GET',base+'/pulls/1',undefined,owner),get=(c=grant)=>f.json('GET',path,undefined,auth(c));
 for(const c of [read,ownerRead])assert.equal((await f.request('GET',path,undefined,auth(c))).status,403);
 assert.equal((await f.request('GET','/api/cli/trunks/other-pending/pulls/1/pending-review',undefined,auth(grant))).status,404);
 for(const suffix of ['/submit/extra','/other'])assert.equal((await f.request('POST',path+suffix,{},auth(grant))).status,404);
 assert.equal((await f.request('GET',path+'/submit',undefined,auth(grant))).status,404);
 const browser={reviewId:'browser-private-review',revision:0,commit,anchor,comment:{id:'browser-private-comment',path:'README.md',side:'RIGHT',line:1,startLine:1,body:'BROWSER PRIVATE'}},browserPath=base+'/pulls/1/pending-review';
 await f.json('POST',browserPath,browser,writer);
 assert.equal((await success(['draft','1'],grant)).pending,null);assert.equal((await get(sibling)).pending,null);
 let draft=(await success(['comment','1','--draft','--revision','0','--path','README.md','--line','1','--body','CLI PRIVATE A'],grant)).pending;
 const first=draft.comments[0].id;assert.equal(draft.revision,1);assert.equal(draft.comments[0].via.credentialId,grant.id);assert.match(draft.comments[0].excerpt,/Candidate/);
 draft=(await success(['comment','1','--draft','--revision','1','--path','other.txt','--line','1','--body','CLI PRIVATE B'],grant)).pending;const second=draft.comments[1].id;
 assert.equal((await get(sibling)).pending,null);assert.equal((await f.json('GET',browserPath,undefined,writer)).pending.comments[0].body,'BROWSER PRIVATE');
 let v=await view();assert.equal(v.discussion.comments.length,0);assert.equal(v.reviews.length,0);assert.equal(v.pendingReview,null);
 for(const c of [grant,sibling,ownerGrant,ownerRead,read]){const publicView=await f.json('GET',gateway+'/pulls/1',undefined,auth(c));assert.equal(publicView.pendingReview,null);assert.ok(!JSON.stringify(publicView).includes('PRIVATE'));}
 assert.ok(!JSON.stringify(await f.json('GET',gateway+'/pulls',undefined,auth(grant))).includes('PRIVATE'));
 const stolen={reviewId:draft.id,revision:draft.revision,commentId:first,body:'Stolen draft'};
 for(const c of [sibling,ownerGrant])assert.equal((await f.request('PATCH',path,stolen,auth(c))).status,404);
 assert.equal((await f.request('PATCH',browserPath,stolen,writer)).status,409);
 assert.equal((await f.request('PATCH',path,{...stolen,actor:{id:'codegraff:owner'}},auth(grant))).status,400);
 assert.equal((await f.request('POST',path,{reviewId:draft.id,revision:draft.revision,commit,anchor,comment:{...browser.comment,id:'bad-cli-hunk',line:999}},auth(grant))).status,400);
 assert.equal((await f.request('POST',path,{reviewId:draft.id,revision:draft.revision,commit,anchor,comment:{...browser.comment,id:'spoofed-provenance',via:{kind:'cli',credentialId:sibling.id}}},auth(grant))).status,400);
 let failed=await cli(['draft','1','--edit',first,'--body','Stale edit','--revision','1'],grant);assert.notEqual(failed.code,0);assert.match(failed.stdout,/changed/);
 assert.equal((await f.request('PATCH',path,{...stolen,revision:1},auth(grant))).status,409);
 draft=(await success(['draft','1','--edit',first,'--body','CLI PRIVATE EDITED','--revision','2'],grant)).pending;assert.equal(draft.revision,3);
 draft=(await success(['draft','1','--remove',second,'--revision','3'],grant)).pending;assert.equal(draft.comments.length,1);
 draft=(await success(['comment','1','--draft','--revision','4','--path','other.txt','--line','1','--body','CLI PRIVATE REPLACEMENT'],grant)).pending;
 await f.restart();assert.equal((await success(['draft','1'],grant)).pending.comments.length,2);assert.equal((await get(sibling)).pending,null);
 const submit={reviewId:draft.id,revision:draft.revision,commit:draft.commit,anchor:draft.anchor,verdict:'REQUEST_CHANGES',body:'Batch findings'};
 const receipt=await success(['review','1','--pending','--revision',String(draft.revision),'--verdict','request-changes','--body','Batch findings'],grant);
 assert.equal((await get()).pending,null);v=await view();assert.equal(v.reviews.length,1);assert.equal(v.discussion.comments.length,2);assert.match(v.reviewGate.error,/requested changes/);
 assert.equal(v.reviews[0].via.credentialId,grant.id);assert.equal(v.reviews[0].author.id,'codegraff:writer');assert.ok(v.discussion.comments.every((c:any)=>c.reviewId===receipt.reviewId&&c.via.credentialId===grant.id));
 assert.equal((await f.json('POST',path+'/submit',submit,auth(grant))).reviewId,receipt.reviewId);assert.equal((await view()).reviews.length,1);
 assert.equal((await f.request('POST',path+'/submit',submit,auth(sibling))).status,409);assert.equal((await f.request('POST',path+'/submit',{...submit,verdict:'APPROVE'},auth(grant))).status,409);
 draft=(await success(['comment','1','--draft','--revision','0','--path','README.md','--line','1','--body','Keep this stale feedback private'],grant)).pending;
 await writeFile(join(source,'README.md'),'Updated candidate\nSecond line\n');await git('add','.');await git('commit','-m','Push during private review');commit=await git('rev-parse','HEAD');await transport('push',remote,'feature');
 failed=await cli(['review','1','--pending','--revision','1','--verdict','approve'],grant);assert.notEqual(failed.code,0);assert.match(failed.stdout,/PR changed/);assert.equal((await get()).pending.comments.length,1);assert.equal((await view()).reviews.length,1);
 assert.equal((await f.request('POST',path+'/submit',{reviewId:draft.id,revision:1,commit,anchor,verdict:'APPROVE',body:'Forged refresh'},auth(grant))).status,409);
 failed=await cli(['comment','1','--draft','--revision','1','--path','README.md','--line','1','--body','New diff'],grant);assert.notEqual(failed.code,0);assert.match(failed.stdout,/earlier diff/);
 await f.json('PATCH',base+'/collaborators',{userId:'codegraff:writer',role:'reader'},owner);assert.equal((await f.request('GET',path,undefined,auth(grant))).status,403);assert.equal((await f.request('DELETE',path,{reviewId:draft.id,revision:1},auth(grant))).status,403);
 await f.json('PATCH',base+'/collaborators',{userId:'codegraff:writer',role:'writer'},owner);
 await f.json('POST',base+'/archive',{archived:true,revision:0,confirmation:trunk},owner);assert.equal((await success(['draft','1'],grant)).pending.id,draft.id);failed=await cli(['draft','1','--discard','--revision','1'],grant);assert.notEqual(failed.code,0);assert.match(failed.stdout,/archived/);
 await f.json('POST',base+'/archive',{archived:false,revision:1,confirmation:trunk},owner);assert.equal((await success(['draft','1','--discard','--revision','1'],grant)).pending,null);
 assert.equal((await f.json('GET',browserPath,undefined,writer)).pending.id,browser.reviewId);
 // Self approval still cannot count, including publication of an entire batch.
 let own=(await success(['comment','1','--draft','--revision','0','--path','README.md','--line','1','--body','Author review'],ownerGrant)).pending;
 await success(['review','1','--pending','--revision',String(own.revision),'--verdict','approve'],ownerGrant);assert.equal((await view()).reviewGate.approvals,0);
 await f.json('PUT',base+`/pulls/1/reviews/${receipt.reviewId}/dismissals`,{message:'Complete synthetic batch lifecycle'},owner);
 for(const c of (await view()).discussion.comments)await f.json('PATCH',base+'/pulls/1/comments',{id:c.id,commit,anchor,resolved:true},writer);
 draft=(await success(['comment','1','--draft','--revision','0','--path','other.txt','--line','1','--body','Reviewed exact updated diff'],grant)).pending;
 await success(['review','1','--pending','--revision','1','--verdict','approve'],grant);v=await view();assert.match(v.reviewGate.error,/Resolve all review conversations/);
 const finalThread=v.discussion.comments.find((c:any)=>c.id===draft.comments[0].id);await f.json('PATCH',base+'/pulls/1/comments',{id:finalThread.id,commit,anchor,resolved:true},writer);assert.equal((await view()).reviewGate.ready,true);
 await f.json('POST',base+'/pulls/1/merge',{commit,anchor},owner);const clone=join(f.dir,'clone');await transport('clone',remote,clone);await exec('git',['-C',clone,'fsck','--strict']);assert.equal((await exec('git',['-C',clone,'rev-parse','HEAD'])).stdout.trim(),commit);
 await f.json('DELETE','/api/cli/credentials/'+grant.id,undefined,writer);assert.equal((await f.request('GET',path,undefined,auth(grant))).status,401);
 await (await f.mf.getD1Database('AUTH_DB')).prepare('UPDATE cli_credentials SET expiresAt=? WHERE id=?').bind(Date.now()-1,sibling.id).run();assert.equal((await f.request('GET',path,undefined,auth(sibling))).status,401);
 console.log('PASS: '+(process.argv.includes('--bundle')?'bundled':'source')+' private CLI batch review; credential/browser isolation, exact revisions and hunk anchors, edits/removal/discard, restart, atomic verdict/comments and provenance, replay isolation, stale push rejection, current roles/scopes/revocation, archive, self-approval/conversation gates, protected merge and clone/fsck');
} finally {
 for(const c of issued)await f.request('DELETE','/api/cli/credentials/'+c.id,undefined,c.cookie).catch(()=>{});
 if(owner&&key)await f.request('DELETE','/api/tokens/'+key.id,undefined,owner).catch(()=>{});
 await f.close();
}
