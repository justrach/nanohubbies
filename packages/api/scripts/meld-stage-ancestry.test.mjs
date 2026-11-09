import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyMeldStagingAncestry} from '../../../tools/meld-stage-ancestry.mjs';

test('staging ancestry uses real commit parents and refuses divergence, replacements, grafts and missing commits',async()=>{
 const source=await mkdtemp(join(tmpdir(),'nh-staging-ancestry-'));
 const git=(...args)=>execFileSync('git',['-C',source,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{env:{PATH:process.env.PATH,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'},stdio:['ignore','pipe','pipe']}).toString().trim();
 try{
  git('init','-q','-b','main');await writeFile(join(source,'base'),'base');git('add','.');git('commit','-qm','Base');const base=git('rev-parse','HEAD');
  await writeFile(join(source,'feature'),'feature');git('add','.');git('commit','-qm','Feature');const head=git('rev-parse','HEAD');
  assert.deepEqual(await verifyMeldStagingAncestry(source,base,head),{stagingCommit:base,head});await verifyMeldStagingAncestry(source,head,head);
  git('checkout','-qb','staging',base);await writeFile(join(source,'staging'),'staging');git('add','.');git('commit','-qm','Shared staging');const staging=git('rev-parse','HEAD');
  await assert.rejects(verifyMeldStagingAncestry(source,staging,head),/omits current staging history/);
  git('replace','--graft',head,staging);git('merge-base','--is-ancestor',staging,head);
  await assert.rejects(verifyMeldStagingAncestry(source,staging,head),/omits current staging history/);git('replace','-d',head);
  await writeFile(join(source,'.git/info/grafts'),head+' '+staging+'\n');await assert.rejects(verifyMeldStagingAncestry(source,base,head),/grafts/);await rm(join(source,'.git/info/grafts'));
  await assert.rejects(verifyMeldStagingAncestry(source,'f'.repeat(40),head),/missing objects/);
  git('tag','-a','tag-object','-m','Tag',base);await assert.rejects(verifyMeldStagingAncestry(source,git('rev-parse','tag-object'),head),/immutable Git commits/);
  git('checkout','-q','main');git('merge','--no-ff','--no-edit','staging');const integration=git('rev-parse','HEAD');assert.deepEqual(await verifyMeldStagingAncestry(source,staging,integration),{stagingCommit:staging,head:integration});
 }finally{await rm(source,{recursive:true,force:true});}
});
