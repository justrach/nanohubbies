import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {teamFixture} from './team/fixture.ts';

const f=await teamFixture(),exec=promisify(execFile),trunk='shared-head-reviews',base=`/api/trunks/${trunk}`;
const environment={...process.env,NANOHUB_API_TOKEN:'',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'};
const issued:{id:string;cookie:any}[]=[],auth=(credential:any)=>({Authorization:'Bearer '+credential.token});
let owner:any,key:any,bin=resolve(import.meta.dirname,'../../cli/bin/nh.mjs');
const cli=async(args:string[],credential:any)=>{try{return {code:0,...await exec('bun',[bin,'pr',...args,'--host',f.origin,'--trunk',trunk,'--json'],{cwd:f.dir,env:{...environment,NANOHUB_API_TOKEN:credential.token}})};}catch(error){const e=error as Error&{code:number;stdout:string;stderr:string};return {code:e.code,stdout:e.stdout,stderr:e.stderr};}};
try {
 if(process.argv.includes('--bundle')){const output=join(f.dir,"Related review CLI's distribution"),manifest=JSON.parse((await exec('bun',[resolve(import.meta.dirname,'../../cli/scripts/build.mjs'),output],{env:environment})).stdout);bin=join(output,'releases',manifest.version,'nh.mjs');}
 owner=await f.login('owner','101');const reviewer=await f.login('reviewer','202'),other=await f.login('other','303'),reader=await f.login('reader','404');
 await f.json('POST',base,{mode:'git'},owner);
 for(const[id,cookie,role]of [['reviewer',reviewer,'writer'],['other',other,'writer'],['reader',reader,'reader']]as const){const invitation=await f.json('POST',base+'/collaborators',{userId:'codegraff:'+id,role},owner);await f.json('POST','/api/invitations/accept',{trunk,token:invitation.token},cookie);}
 const make=async(cookie:any,scopes:string[])=>{const grant=await f.json('POST',base+'/cli-credentials',{label:'Related review fixture',scopes,days:1},cookie);issued.push({id:grant.id,cookie});return grant;};
 const ownerGrant=await make(owner,['read','pulls:merge']),reviewerGrant=await make(reviewer,['read','reviews:write']);
 key=await f.json('POST',base+'/git-tokens',{label:'Related review Git fixture'},owner);
 const source=join(f.dir,'source');await mkdir(source);const remote=f.origin+'/git/'+trunk+'.git';
 const git=async(...args:string[])=>(await exec('git',['-C',source,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{env:environment})).stdout.trim();
 const transport=(...args:string[])=>exec('git',['-C',source,...args],{env:{...environment,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:`http.${remote}.extraHeader`,GIT_CONFIG_VALUE_0:'Authorization: Basic '+btoa('git:'+key.token)}});
 await git('init','-b','main');await writeFile(join(source,'README.md'),'Base\n');await git('add','.');await git('commit','-m','Base');const anchor=await git('rev-parse','HEAD');await transport('push',remote,'main','main:release');
 await git('checkout','-b','feature');await writeFile(join(source,'README.md'),'Candidate\nSecond line\n');await git('add','.');await git('commit','-m','Candidate');const commit=await git('rev-parse','HEAD');await transport('push',remote,'feature','feature:alias');
 const policy={branch:'main',pullRequest:true,approvals:1,checks:[],beforeOpen:[],preventForce:true,preventDelete:true,requireConversationResolution:true};await f.json('PUT',base+'/protection',policy,owner);
 await f.json('POST',base+'/pulls',{title:'Protected destination',head:'feature'},owner);await f.json('POST',base+'/pulls',{title:'Same commit, different target',head:'alias',base:'release'},owner);
 const observed={commit,anchor},view=(who=owner)=>f.json('GET',base+'/pulls/1',undefined,who),peer=()=>f.json('GET',base+'/pulls/2',undefined,owner),review=(number:number,who:any,verdict:string)=>f.json('POST',base+`/pulls/${number}/reviews`,{...observed,verdict,body:'Synthetic shared-head decision'},who);
 const unchanged=async()=>assert.equal((await f.json('GET',base+'/repository',undefined,owner)).refs.find((ref:any)=>ref.name==='refs/heads/main').commit,anchor);
 const denied=async(reason:RegExp)=>{const response=await f.request('POST',base+'/pulls/1/merge',{...observed,sharedHeadBlockers:[],reviewerAccess:{}},owner);assert.equal(response.status,400);assert.match(await response.text(),reason);await unchanged();};
 await review(1,reviewer,'APPROVE');await review(2,other,'REQUEST_CHANGES');let v=await view();
 assert.equal(v.reviewGate.approvals,1);assert.equal(v.reviewGate.ready,false);assert.deepEqual(v.reviewGate.sharedHeadBlockers,[{number:2,changesRequested:true,pendingReview:false}]);await denied(/requested changes.*pull request #2.*same head/);
  const direct=await f.request('POST','/fixture/direct-reviewed-merge',{trunk,number:1,actor:'codegraff:owner'});assert.equal(direct.status,400);assert.match(await direct.text(),/requested changes.*#2/);await unchanged();
 let result=await cli(['merge','1'],ownerGrant);assert.notEqual(result.code,0);assert.match(result.stdout,/#2.*same head/);await unchanged();
 // Losing access does not silently erase submitted blocking feedback.
 await f.json('PATCH',base+'/collaborators',{userId:'codegraff:other',role:'reader'},owner);await denied(/requested changes/);await f.json('PATCH',base+'/collaborators',{userId:'codegraff:other',role:'writer'},owner);
 await review(2,other,'COMMENT');await denied(/requested changes/);await review(2,other,'APPROVE');assert.equal((await view()).reviewGate.ready,true);
 const browserPath=base+'/pulls/2/pending-review',browser={reviewId:'peer-browser-private-review',revision:0,...observed,comment:{id:'peer-browser-private-comment',path:'README.md',side:'RIGHT',line:1,startLine:1,body:'PRIVATE BROWSER FEEDBACK'}};
 let draft=(await f.json('POST',browserPath,browser,reviewer)).pending;
 result=await cli(['comment','2','--draft','--revision','0','--path','README.md','--line','1','--body','PRIVATE CLI FEEDBACK'],reviewerGrant);assert.equal(result.code,0,result.stdout);const cliDraft=JSON.parse(result.stdout).pending;
 for(const who of [owner,reviewer,reader]){v=await view(who);assert.deepEqual(v.reviewGate.sharedHeadBlockers,[{number:2,changesRequested:false,pendingReview:true}]);assert.ok(!JSON.stringify(v).includes('PRIVATE'));assert.ok(!JSON.stringify(v.reviewGate).includes(reviewerGrant.id));}
 v=await f.json('GET',`/api/cli/trunks/${trunk}/pulls/1`,undefined,auth(ownerGrant));assert.ok(!JSON.stringify(v).includes('PRIVATE'));await denied(/pending review.*#2/);
 await f.json('DELETE',browserPath,{reviewId:draft.id,revision:1},reviewer);assert.equal((await view()).reviewGate.ready,false,'The independent CLI draft still blocks');
 result=await cli(['draft','2','--discard','--revision',String(cliDraft.revision)],reviewerGrant);assert.equal(result.code,0,result.stdout);assert.equal((await view()).reviewGate.ready,true);
 // A private review added after a successful preview is observed at final merge.
 draft=(await f.json('POST',browserPath,{...browser,reviewId:'peer-racing-private-review',comment:{...browser.comment,id:'peer-racing-private-comment'}},reviewer)).pending;await denied(/pending review/);
 await git('commit','--allow-empty','-m','Same tree, different commit');const otherHead=await git('rev-parse','HEAD');await transport('push',remote,'HEAD:alias');v=await view();assert.equal(v.reviewGate.ready,true);assert.deepEqual(v.reviewGate.sharedHeadBlockers,[]);assert.notEqual(otherHead,commit);
 await transport('push','--force',remote,commit+':alias');await denied(/pending review/);
 await f.json('POST',base+'/archive',{archived:true,revision:0,confirmation:trunk},owner);v=await view();assert.equal(v.reviewGate.sharedHeadBlockers[0].number,2);assert.equal((await f.request('POST',base+'/pulls/1/merge',observed,owner)).status,403);
 await f.json('POST',base+'/archive',{archived:false,revision:1,confirmation:trunk},owner);await f.restart();await denied(/pending review/);
 // Publication removes the pending flag, but does not import peer approvals or
 // unrelated peer conversations into the current PR's review counts/threads.
 await f.json('POST',browserPath+'/submit',{reviewId:draft.id,revision:draft.revision,...observed,verdict:'COMMENT',body:'Completed peer review'},reviewer);
 assert.equal((await peer()).discussion.comments.length,1);v=await view();assert.equal(v.reviewGate.ready,true);assert.equal(v.reviewGate.approvals,1);assert.equal(v.discussion.comments.length,0);
 result=await cli(['comment','2','--draft','--revision','0','--path','README.md','--line','1','--body','PRIVATE REVOKED-CREDENTIAL FEEDBACK'],reviewerGrant);assert.equal(result.code,0,result.stdout);
 await f.json('DELETE','/api/cli/credentials/'+reviewerGrant.id,undefined,reviewer);assert.equal((await f.request('GET',`/api/cli/trunks/${trunk}/pulls/2/pending-review`,undefined,auth(reviewerGrant))).status,401);await denied(/pending review/);
 await f.json('POST',base+'/pulls/2/close',observed,owner);assert.equal((await view()).reviewGate.ready,true,'Closing a peer clears its pending blocker, even if its CLI credential was revoked');
 await f.json('POST',base+'/pulls',{title:'New peer without feedback',head:'alias',base:'release'},owner);assert.equal((await view()).reviewGate.ready,true,'Closed PR history never blocks its replacement');
 await f.json('PUT',base+'/protection',{...policy,locked:true},owner);await denied(/locked/);await f.json('PUT',base+'/protection',policy,owner);
  await f.json('POST','/fixture/shared-head-receiver',{trunk,missing:true});const updating=await f.request('POST',base+'/pulls/1/merge',observed,owner);assert.equal(updating.status,503);assert.equal(updating.headers.get('Retry-After'),'5');await unchanged();
  result=await cli(['merge','1'],ownerGrant);assert.notEqual(result.code,0);assert.match(result.stdout,/review checks are updating/);await unchanged();await f.json('POST','/fixture/shared-head-receiver',{trunk,missing:false});
 result=await cli(['merge','1'],ownerGrant);assert.equal(result.code,0,result.stdout);assert.equal(JSON.parse(result.stdout).pull.state,'merged');
 const clone=join(f.dir,'clone');await transport('clone',remote,clone);await exec('git',['-C',clone,'fsck','--strict']);assert.equal((await exec('git',['-C',clone,'rev-parse','HEAD'])).stdout.trim(),commit);
  console.log('PASS: '+(process.argv.includes('--bundle')?'bundled':'source')+' CLI/Worker shared-head review enforcement; exact live refs across different PR targets, latest decisions/demotion, browser and CLI draft privacy, post-preview race, publication/discard/close, metadata-only different SHA, archive/restart, current locks, direct final RPC enforcement, older receiver 503 without fallback, denied refs unchanged and protected merge/clone/fsck');
} finally {
 for(const grant of issued)await f.request('DELETE','/api/cli/credentials/'+grant.id,undefined,grant.cookie).catch(()=>{});
 if(owner&&key)await f.request('DELETE','/api/tokens/'+key.id,undefined,owner).catch(()=>{});
 await f.close();
}
