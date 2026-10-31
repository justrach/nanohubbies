/** Prepare an offline toolchain context and native workflow from an immutable,
 * operator-reviewed Meld commit. Never execute or copy its CI entrypoint. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,realpath,rm} from 'node:fs/promises';
import {isAbsolute,join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {stringify} from 'yaml';
import {parseWorkflow} from './actions-workflow.mjs';
const exec=promisify(execFile);
export const meldNativeToolchains={
 bun:'oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895',
 node:'node:24.14.1-bookworm@sha256:80fc934952c8f1b2b4d39907af7211f8a9fff1a4c2cf673fb49099292c251cec',
};
export const meldPipelineBlob='a9f33cd3fe3f59b5db62702668e12274dfe24e8c';
const manifests=['package.json','apps/api/package.json','apps/web/package.json','packages/db/package.json'];
const inertEnvironment={
 DATABASE_URL:'postgresql://build_only:build_only@127.0.0.1:5434/build_only',
 CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE:'postgresql://build_only:build_only@127.0.0.1:5434/build_only',
 BETTER_AUTH_SECRET:'inert-build-placeholder-never-used-as-a-runtime-secret',
 GOOGLE_CLIENT_ID:'build-only',GOOGLE_CLIENT_SECRET:'build-only',
 NEXT_TELEMETRY_DISABLED:'1',WRANGLER_SEND_METRICS:'false',
};
const buildEnvironment={NODE_ENV:'production',MELD_ENV:'staging',BETTER_AUTH_URL:'https://staging.meld.space',NEXT_PUBLIC_APP_URL:'https://staging.meld.space'};
const buildId='export BUILD_ID="$(printf %.7s "$GITHUB_SHA")"\n';
export function meldNativeWorkflow(){
 const step=(name,run,env={})=>({name,run:buildId+run,...(Object.keys(env).length?{env}:{})});
 return stringify({name:'Meld isolated checks',on:{push:{branches:['**']}},permissions:{contents:'read'},env:inertEnvironment,jobs:{check:{'runs-on':'codegraff','timeout-minutes':45,steps:[
  step('Verify isolated toolchain',`test "$(git rev-parse HEAD)" = "$GITHUB_SHA"
test "$(id -u)" = 1000
test "$(bun --version)" = 1.4.2
test "$(node --version)" = v24.14.1
! command -v npm
! command -v npx
test ! -e /var/run/docker.sock
test ! -w /source
test ! -w /job.sh
for name in CODEGRAFF_API_KEY NANOHUB_CI_TOKEN NANOHUB_TOKEN GITHUB_TOKEN CLOUDFLARE_API_TOKEN CLOUDFLARE_API_KEY DOCKER_AUTH_CONFIG; do test -z "$(printenv "$name" 2>/dev/null || true)"; done`),
  step('Locked offline install','bun install --frozen-lockfile --offline',{...buildEnvironment,NODE_ENV:'development'}),
  step('Pipeline regression checks','node --test tools/staging/policy.test.mjs tools/staging/controller.test.mjs tools/git-safety.test.mjs',buildEnvironment),
  step('Typechecks','bun run check',buildEnvironment),
  step('Unit and package checks','bun run test'),
  step('Preinstalled browser availability','test -x /opt/google/chrome/chrome && google-chrome --version',buildEnvironment),
  step('Browser checks','bun run --cwd apps/web e2e --workers=2',buildEnvironment),
  step('Production bundle','bun run build',buildEnvironment),
 ]}}},{lineWidth:0,aliasDuplicateObjects:false});
}

export async function prepareMeldNativePlan({source,base,output},{readGit}={}){
 if(!isAbsolute(source??'')||!isAbsolute(output??'')||!/^[a-f0-9]{40}$/.test(base??''))throw Error('Use absolute source/new output paths and a full accepted commit SHA');
 source=await realpath(source);output=resolve(output);
 const parent=await realpath(join(output,'..'));
 const destination=join(parent,output.split('/').at(-1));
 if(destination===source||destination.startsWith(source+'/'))throw Error('Keep the toolchain context outside the source repository');
 const git=readGit??(async(...args)=>{
  try{return (await exec('git',['-C',source,...args],{env:{PATH:process.env.PATH,HOME:parent,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'},encoding:'buffer',maxBuffer:16*1024*1024,timeout:30000})).stdout;}
  catch{throw Error('Cannot verify the immutable Meld source');}
 });
 if((await git('cat-file','-t',base)).toString().trim()!=='commit')throw Error('The accepted source SHA must identify a commit');
 const entries=new Map((await git('ls-tree','-r',base,'--',...manifests,'bun.lock','patches','tools/staging/run.mjs')).toString().trim().split('\n').map(line=>{
  const match=/^(\d{6}) (\w+) ([a-f0-9]{40})\t(.+)$/.exec(line);if(!match)throw Error('Invalid source tree entry');return[match[4],{mode:match[1],type:match[2],blob:match[3]}];
 }));
 const get=async path=>{
  const entry=entries.get(path);if(entry?.type!=='blob'||entry.mode!=='100644')throw Error('Toolchain inputs must be regular committed files: '+path);
  return {path,...entry,bytes:await git('cat-file','blob',entry.blob)};
 };
 if(entries.get('tools/staging/run.mjs')?.blob!==meldPipelineBlob)throw Error('Meld pipeline changed; review its commands before updating the native plan');
 const files=[];
 for(const path of manifests)files.push(await get(path));
 const root=JSON.parse(files[0].bytes.toString());
 if(JSON.stringify(root.workspaces)!==JSON.stringify(['apps/*','packages/*'])||root.devDependencies?.tsrs!=='0.18.0-ts7.1.0-dev.20260929')throw Error('Meld workspace/toolchain changed; review the native plan');
 files.push(await get('bun.lock'));
 for(const patch of Object.values(root.patchedDependencies??{})){
  if(typeof patch!=='string'||!/^patches\/[a-zA-Z0-9@+_.-]+\.patch$/.test(patch))throw Error('Patch paths must name regular files in patches/');
  if(!files.some(file=>file.path===patch))files.push(await get(patch));
 }
 // Fail on a newly introduced workspace instead of preparing an incomplete
 // cache that looks valid. Only committed manifests are considered.
 const allManifests=(await git('ls-tree','-r','--name-only',base,'--','apps','packages')).toString().split('\n').filter(path=>/^(apps|packages)\/[^/]+\/package\.json$/.test(path));
 if(allManifests.some(path=>!manifests.includes(path)))throw Error('Meld gained a workspace; review the native toolchain inputs');
 if(files.some(file=>/https?:\/\/[^\s"'<>/]*@/i.test(file.bytes.toString())))throw Error('Dependency inputs contain credential-bearing URLs; keep credentials on the trusted host');
 const workflow=meldNativeWorkflow();parseWorkflow(workflow,'.github/workflows/meld.yml','native-check');
 const copies=files.filter(file=>!['package.json','bun.lock'].includes(file.path)).map(file=>`COPY --chown=node:node ${JSON.stringify(file.path)} ${JSON.stringify('./'+file.path)}`).join('\n');
 const dockerfile=`FROM ${meldNativeToolchains.bun} AS bun
FROM ${meldNativeToolchains.node}
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
ENV HOME=/home/node BUN_INSTALL_CACHE_DIR=/home/node/.bun/install/cache
RUN mkdir -p /home/node/prewarm && chown node:node /home/node/prewarm
WORKDIR /home/node/prewarm
COPY --chown=node:node package.json bun.lock ./
${copies}
USER node
RUN test "$(bun --version)" = 1.4.2 && test "$(node --version)" = v24.14.1 && bun install --frozen-lockfile
USER root
RUN node apps/web/node_modules/@playwright/test/cli.js install --with-deps chrome \\
    && rm -rf /var/lib/apt/lists/* /home/node/prewarm \\
    && test -x /opt/google/chrome/chrome
USER node
WORKDIR /tmp
`;
 const metadata={format:1,sourceCommit:base,pipelineBlob:meldPipelineBlob,toolchains:meldNativeToolchains,inputs:files.map(({path,blob,bytes})=>({path,blob,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})),workflowPath:'.github/workflows/meld.yml',workflowSha256:createHash('sha256').update(workflow).digest('hex'),limits:['Operator must establish accepted source authority; this generator verifies immutable inputs, not human approval','Image context contains private dependency metadata and patch content; publish only to approved private storage','No application source, Git history, runtime credentials or source CI entrypoint copied into image context','Browser and dependency downloads occur only during trusted image preparation; candidate jobs use network none','Generated workflow requires separate accepted-default bootstrap in an isolated Nanohub copy before feature checks']};
 await mkdir(destination,{mode:0o700});
 try{
  const context=join(destination,'context');await mkdir(context,{mode:0o700});
  for(const file of files){await mkdir(join(context,file.path,'..'),{recursive:true});await writeFile(join(context,file.path),file.bytes,{mode:0o600,flag:'wx'});}
  await writeFile(join(context,'Dockerfile'),dockerfile,{mode:0o600,flag:'wx'});
  await writeFile(join(context,'.dockerignore'),['**','!Dockerfile','!package.json','!bun.lock','!apps/','!apps/*/','!packages/','!packages/*/','!patches/',...files.filter(file=>!['package.json','bun.lock'].includes(file.path)).map(file=>'!'+file.path),''].join('\n'),{mode:0o600,flag:'wx'});
  await writeFile(join(destination,'meld.yml'),workflow,{mode:0o600,flag:'wx'});
  await writeFile(join(destination,'plan.json'),JSON.stringify(metadata,null,2)+'\n',{mode:0o600,flag:'wx'});
 }catch(error){await rm(destination,{recursive:true,force:true});throw error;}
 return metadata;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [source,base,output]=process.argv.slice(2);const plan=await prepareMeldNativePlan({source,base,output});
 console.log(JSON.stringify({source:plan.sourceCommit,inputs:plan.inputs.length,pipelineBlob:plan.pipelineBlob,prepared:true,liveBuild:false}));
}
