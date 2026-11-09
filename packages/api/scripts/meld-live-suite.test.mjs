import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,chmod,rm,symlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareMeldLiveSuite,readMeldLiveSuite} from '../../../tools/meld-live-suite.mjs';

async function fixture(work){
 const dir=await mkdtemp(join(tmpdir(),'nh-trusted-suite-')),source=join(dir,'source'),output=join(dir,'prepared');await mkdir(source);
 const git=(...args)=>execFileSync('git',['-C',source,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{env:{PATH:process.env.PATH,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'},stdio:['ignore','pipe','pipe']}).toString().trim();
 const put=async(path,bytes)=>{await mkdir(join(source,path,'..'),{recursive:true});await writeFile(join(source,path),bytes);};
 const paths=['package.json','bun.lock','apps/web/playwright.live.config.ts','tools/staging/live.mjs',...['global-setup','global-teardown','session','social-speed.live.spec','social-timings','target'].map(n=>'apps/web/e2e/live/'+n+'.ts')];
 for(const path of paths)await put(path,'fixture');await put('apps/web/package.json',JSON.stringify({scripts:{'e2e:live:social':'playwright test -c playwright.live.config.ts social-speed --project=desktop'}}));await put('review/human-only.bin',Buffer.from([1,2,3]));await put('review-evidence/human-only.txt','review only');await put('asset.bin',Buffer.from([0,255,128,10]));await put('run.sh','#!/bin/sh\nexit 0\n');await chmod(join(source,'run.sh'),0o755);
 git('init','-q','-b','main');git('add','.');git('commit','-qm','Reviewed tests');
 try{await work({dir,source,output,git,put,commit:git('rev-parse','HEAD')});}finally{await rm(dir,{recursive:true,force:true});}
}

test('trusted suite uses committed bytes, binary/modes and a parentless runtime snapshot while excluding only human evidence',async()=>fixture(async f=>{
 await f.put('apps/web/e2e/live/session.ts','uncommitted replacement');await f.put('.env','untracked private configuration');
 const suite=await prepareMeldLiveSuite({source:f.source,commit:f.commit,output:f.output}),loaded=await readMeldLiveSuite(suite);assert.ok(Object.isFrozen(suite));assert.ok(loaded.bundle.length>0);assert.equal(suite.sourceCommit,f.commit);
 const clone=join(f.dir,'clone');execFileSync('git',['-c','advice.detachedHead=false','clone','-q',join(f.output,'suite.bundle'),clone],{stdio:['ignore','pipe','pipe']});const git=(...args)=>execFileSync('git',['-C',clone,...args],{stdio:['ignore','pipe','pipe']});assert.equal(git('rev-parse','HEAD').toString().trim(),suite.snapshotCommit);assert.equal(git('rev-list','--parents','-n','1','HEAD').toString().trim(),suite.snapshotCommit);
 assert.equal(git('show','HEAD:apps/web/e2e/live/session.ts').toString(),'fixture');assert.deepEqual(git('show','HEAD:asset.bin'),Buffer.from([0,255,128,10]));assert.match(git('ls-tree','HEAD','run.sh').toString(),/^100755/);for(const path of ['review/human-only.bin','review-evidence/human-only.txt','.env'])assert.throws(()=>git('cat-file','-e','HEAD:'+path));
 assert.throws(()=>Object.assign(suite,{snapshotCommit:'f'.repeat(40)}));await assert.rejects(readMeldLiveSuite({...suite}),/original prepared/);
}));

test('changed commands, linked entries, active committed environment and incomplete suites fail before producing a bundle',async()=>{
 for(const mode of ['command','link','env','incomplete'])await fixture(async f=>{
  if(mode==='command')await f.put('apps/web/package.json',JSON.stringify({scripts:{'e2e:live:social':'execute arbitrary code'}}));
  if(mode==='link')await symlink('/etc/passwd',join(f.source,'outside'));
  if(mode==='env')await f.put('.env','fixture only');
  if(mode==='incomplete')await rm(join(f.source,'apps/web/e2e/live/target.ts'));
  f.git('add','-A');f.git('commit','-qm','Changed source');await assert.rejects(prepareMeldLiveSuite({source:f.source,commit:f.git('rev-parse','HEAD'),output:f.output}),/changed social|linked|environment files|incomplete/);await assert.rejects(readFile(join(f.output,'suite.bundle')),{code:'ENOENT'});
 });
});

test('bundle/provenance edits and output paths inside source cannot become a trusted suite',async()=>fixture(async f=>{
 await assert.rejects(prepareMeldLiveSuite({source:f.source,commit:f.commit,output:join(f.source,'prepared')}),/outside/);
 const suite=await prepareMeldLiveSuite({source:f.source,commit:f.commit,output:f.output});await writeFile(join(f.output,'manifest.json'),'changed');await assert.rejects(readMeldLiveSuite(suite),/provenance changed/);
}));


test('linked or multiply linked acceptance inputs are refused even when bytes still match',async()=>{
 for(const name of ['manifest.json','suite.bundle'])for(const mode of ['symbolic','hard'])await fixture(async f=>{
  const suite=await prepareMeldLiveSuite({source:f.source,commit:f.commit,output:f.output}),path=join(f.output,name),copy=join(f.dir,'original');
  const {rename,link}=await import('node:fs/promises');await rename(path,copy);
  if(mode==='symbolic')await symlink(copy,path);else await link(copy,path);
  await assert.rejects(readMeldLiveSuite(suite),/provenance changed/);
 });
});
