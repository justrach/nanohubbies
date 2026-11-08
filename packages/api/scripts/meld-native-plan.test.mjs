import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,stat,rm,symlink,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {parseDocument} from 'yaml';
import {parseWorkflow} from '../../../tools/actions-workflow.mjs';
import {prepareMeldNativePlan,meldNativeWorkflow,meldNativeToolchains,meldPipelineBlob,meldReviewedPipelineBlobs} from '../../../tools/meld-native-plan.mjs';
const base='a'.repeat(40),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(work){
 const dir=await mkdtemp(join(tmpdir(),'nh-meld-native-')),source=join(dir,'source'),output=join(dir,'plan');await mkdir(source);
 const root={private:true,workspaces:['apps/*','packages/*'],devDependencies:{tsrs:'0.18.0-ts7.1.0-dev.20260929'},patchedDependencies:{'fixture@1.0.0':'patches/fixture@1.0.0.patch'}};
 const files=new Map([['package.json',Buffer.from(JSON.stringify(root))],['bun.lock',Buffer.from('locked-fixture-dependencies')],...['apps/api/package.json','apps/web/package.json','packages/db/package.json'].map(path=>[path,Buffer.from(JSON.stringify({name:path,private:true}))]),['patches/fixture@1.0.0.patch',Buffer.from('synthetic patch content')]]);
 const modes=new Map(),blobs=new Map();let pipeline=meldPipelineBlob,extra=[],objectType='commit';
 const entries=()=>[...files].map(([path,bytes])=>{const blob=createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])).digest('hex');blobs.set(blob,bytes);return`${modes.get(path)??'100644'} blob ${blob}\t${path}`;});
 const readGit=async(...args)=>{
  assert.ok(!args.some(arg=>/\.env|\.npmrc/.test(arg)),'Never read credential files');
  if(args[0]==='cat-file'&&args[1]==='-t')return Buffer.from(objectType);
  if(args[0]==='ls-tree'&&args[2]==='--name-only')return Buffer.from([...files.keys(),...extra].filter(path=>path.endsWith('/package.json')).join('\n'));
  if(args[0]==='ls-tree')return Buffer.from([...entries(),`100644 blob ${pipeline}\ttools/staging/run.mjs`].join('\n'));
  if(args[0]==='cat-file')return blobs.get(args[2]);
  assert.fail('Unexpected Git operation');
 };
 const options={source,base,output};
 try{await work({dir,source,output,root,files,modes,options,readGit,pipeline:value=>{pipeline=value;},workspace:path=>{extra.push(path);},objectType:value=>{objectType=value;}});}finally{await rm(dir,{recursive:true,force:true});}
}
test('native workflow preserves all Meld checks with inert build configuration and explicit offline installation',()=>{
 const text=meldNativeWorkflow(),workflow=parseDocument(text).toJS(),[job]=parseWorkflow(text,'.github/workflows/meld.yml','feature');
 assert.equal(job.name,'meld/check');assert.deepEqual(workflow.permissions,{contents:'read'});
 assert.equal(job.timeoutMs,45*60000);assert.equal(workflow.jobs.check.steps.length,8);
 for(const command of ['bun install --frozen-lockfile --offline','node --test tools/staging/policy.test.mjs tools/staging/controller.test.mjs tools/git-safety.test.mjs','bun run check','bun run test','google-chrome --version','bun run --cwd apps/web e2e --workers=2','bun run build'])assert.ok(job.script.includes(command));
 const steps=workflow.jobs.check.steps;
 assert.equal(steps[1].env.NODE_ENV,'development');assert.equal(steps[3].env.NODE_ENV,'production');
 for(const key of ['NODE_ENV','MELD_ENV','BETTER_AUTH_URL','NEXT_PUBLIC_APP_URL'])assert.equal(workflow.env[key],undefined,'Unit checks must not inherit build-only mode');
 assert.equal(steps[4].env,undefined);assert.ok(!job.script.includes('node tools/staging/run.mjs'));
 assert.ok(!job.script.includes('deploy.mjs'));assert.ok(!job.script.includes('curl '));
 assert.ok(job.script.includes('test ! -w /job.sh'));assert.ok(job.script.includes('test ! -w /source'));
 assert.equal(parseWorkflow(text,'.github/workflows/meld.yml','v1','refs/tags/v1').length,0);
});
test('context contains only committed dependency inputs; source files, Git config and local secrets stay excluded',async()=>fixture(async f=>{
 await writeFile(join(f.source,'.env'),'private-local-value-must-not-copy');
 await writeFile(join(f.source,'application.ts'),'private-app-source-must-not-copy');
 const plan=await prepareMeldNativePlan(f.options,{readGit:f.readGit});
 assert.equal(plan.inputs.length,6);assert.equal(plan.sourceCommit,base);assert.equal(plan.pipelineBlob,meldPipelineBlob);
 for(const input of plan.inputs){const bytes=await readFile(join(f.output,'context',input.path));assert.equal(hash(bytes),input.sha256);assert.equal(bytes.length,input.bytes);}
 const dockerfile=await readFile(join(f.output,'context/Dockerfile'),'utf8');
 for(const image of Object.values(meldNativeToolchains))assert.ok(dockerfile.includes(image));
 assert.ok(dockerfile.includes('install --with-deps chrome'));assert.ok(!dockerfile.includes('COPY . '));
 assert.ok(dockerfile.includes('USER node'));assert.ok(dockerfile.includes('/usr/local/bin/npm /usr/local/bin/npx'));
 const ignore=await readFile(join(f.output,'context/.dockerignore'),'utf8');assert.ok(ignore.startsWith('**\n'));
 assert.ok(!ignore.includes('!.env'));assert.ok(!ignore.includes('!application.ts'));
 for(const path of ['.env','application.ts','tools/staging/run.mjs','.git/config'])await assert.rejects(stat(join(f.output,'context',path)),{code:'ENOENT'});
 assert.equal((await stat(f.output)).mode&0o777,0o700);assert.equal((await stat(join(f.output,'context/bun.lock'))).mode&0o777,0o600);
 assert.equal(hash(await readFile(join(f.output,'meld.yml'))),plan.workflowSha256);
}));
test('pipeline drift, extra workspaces, symlink inputs, credentials and unsafe patch paths fail before producing a context',async()=>{
 for(const kind of ['pipeline','workspace','symlink','patch','toolchain','credentials','object-type'])await fixture(async f=>{
  if(kind==='pipeline')f.pipeline('b'.repeat(40));
  if(kind==='workspace')f.workspace('packages/new-workspace/package.json');
  if(kind==='symlink')f.modes.set('apps/api/package.json','120000');
  if(kind==='patch')f.root.patchedDependencies={fixture:'patches/../secret.patch'};
  if(kind==='toolchain')f.root.devDependencies.tsrs='latest';
  if(kind==='credentials')f.root.dependencies={private:'https://synthetic-token@packages.invalid/private.tgz'};
  if(kind==='object-type')f.objectType('tree');
  f.files.set('package.json',Buffer.from(JSON.stringify(f.root)));
  await assert.rejects(prepareMeldNativePlan(f.options,{readGit:f.readGit}),/changed|gained|regular|Patch paths|credential-bearing|identify a commit/);
  await assert.rejects(stat(f.output),{code:'ENOENT'});
 });
});
test('existing output and paths resolving inside candidate source are preserved and rejected',async()=>fixture(async f=>{
 await mkdir(f.output);await writeFile(join(f.output,'receipt.json'),'prior operator receipt');
 await assert.rejects(prepareMeldNativePlan(f.options,{readGit:f.readGit}),{code:'EEXIST'});
 assert.equal(await readFile(join(f.output,'receipt.json'),'utf8'),'prior operator receipt');
 await symlink(f.source,join(f.dir,'indirect'));
 for(const output of [join(f.source,'context'),join(f.dir,'indirect/context')])await assert.rejects(prepareMeldNativePlan({...f.options,output},{readGit:f.readGit}),/outside the source/);
 assert.deepEqual(await readdir(f.source),[]);
}));
test('reviewed browser-preparation revision records its actual pipeline identity without importing candidate code',async()=>fixture(async f=>{
 const latest=meldReviewedPipelineBlobs[1];assert.notEqual(latest,meldPipelineBlob);f.pipeline(latest);
 const plan=await prepareMeldNativePlan(f.options,{readGit:f.readGit});assert.equal(plan.pipelineBlob,latest);
 assert.equal(plan.workflowSha256,hash(Buffer.from(meldNativeWorkflow())));
 await assert.rejects(stat(join(f.output,'context/tools/staging/run.mjs')),{code:'ENOENT'});
}));
