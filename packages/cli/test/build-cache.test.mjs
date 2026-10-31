import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

const root=resolve(import.meta.dirname,'../../..'),turbo=join(root,'node_modules/.bin/turbo');
async function run(command,cwd,environment={}){
 const child=Bun.spawn(command,{cwd,env:{...process.env,...environment,TURBO_TELEMETRY_DISABLED:'1'},stdout:'pipe',stderr:'pipe'});
 const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
 return {code,output:stdout+stderr};
}
async function fixture(config,environment){
 const directory=await mkdtemp(join(tmpdir(),"nh cache's "));
 try{
  for(const path of ['packages/cli/scripts','packages/cli/bin','apps/web'])await mkdir(join(directory,path),{recursive:true});
  const json=(path,value)=>writeFile(join(directory,path),JSON.stringify(value,null,2)+'\n');
  await json('package.json',{name:'nanohub-build-cache-fixture',private:true,packageManager:'bun@1.4.4',workspaces:['apps/*','packages/*']});
  await json('turbo.json',config);
  await json('packages/cli/package.json',{name:'@nanohub/cli',version:'1.0.0',type:'module',scripts:{build:'bun scripts/build.mjs'}});
  await json('packages/cli/release-lock.json',{format:1,releases:{}});
  await json('apps/web/package.json',{name:'@swarm/web',private:true,type:'module',scripts:{build:'bun ../../packages/cli/scripts/build.mjs && bun build-web.mjs'}});
  for(const file of ['build.mjs','publish.mjs'])await copyFile(join(root,'packages/cli/scripts',file),join(directory,'packages/cli/scripts',file));
  await writeFile(join(directory,'packages/cli/bin/nh.mjs'),"console.log('first module');\n");
  await writeFile(join(directory,'packages/cli/install.mjs'),"console.log('fixture installer');\n");
  await writeFile(join(directory,'apps/web/build-web.mjs'),`import {mkdir,readFile,writeFile} from 'node:fs/promises';\nconst manifest=JSON.parse(await readFile('public/nh/latest.json','utf8'));await mkdir('.next',{recursive:true});await writeFile('.next/cli.mjs',await readFile('public'+manifest.path));\n`);
  await writeFile(join(directory,'.gitignore'),'.turbo/\napps/web/.next/\napps/web/public/nh/\n');
  for(const command of [[Bun.which('bun'),'install','--offline','--ignore-scripts'],['git','-c','core.hooksPath=/dev/null','init','--quiet'],['git','add','.']]){
   const result=await run(command,directory);expect(result.code,result.output).toBe(0);
  }
  const build=async()=>{
   // Remove only run reports, retaining the real cache. Human logs use grouped
   // output under Actions, so inspect the actual run's machine-readable result.
   const reports=join(directory,'.turbo/runs');await rm(reports,{recursive:true,force:true});
   const result=await run([turbo,'run','build','--filter=@swarm/web','--cache=local:rw','--no-daemon','--summarize'],directory,environment);
   if(result.code!==0)return result;
   const names=(await readdir(reports)).filter(name=>name.endsWith('.json'));expect(names).toHaveLength(1);
   const summary=JSON.parse(await readFile(join(reports,names[0]),'utf8'));
   return {...result,summary};
  };
  return {directory,json,build,read:path=>readFile(join(directory,path),'utf8'),remove:()=>rm(directory,{recursive:true,force:true})};
 }catch(error){await rm(directory,{recursive:true,force:true});throw error;}
}

for(const [renderer,environment]of [['terminal',{CI:'',GITHUB_ACTIONS:''}],['Actions',{CI:'true',GITHUB_ACTIONS:'true'}]]){
test(`workspace cache invalidates for CLI changes, restores missing downloads and refuses corrupt releases before a cached web build (${renderer})`,async()=>{
 const config=JSON.parse(await readFile(join(root,'turbo.json'),'utf8')),f=await fixture(config,environment);
 try{
  let result=await f.build();expect(result.code,result.output).toBe(0);
  expect(result.summary.tasks.find(task=>task.taskId==='@swarm/web#build').cache.status).toBe('MISS');
  const first=await f.read('apps/web/.next/cli.mjs'),firstManifest=JSON.parse(await f.read('apps/web/public/nh/latest.json'));
  await f.json('packages/cli/package.json',{name:'@nanohub/cli',version:'1.0.1',type:'module',scripts:{build:'bun scripts/build.mjs'}});
  await writeFile(join(f.directory,'packages/cli/bin/nh.mjs'),"console.log('second module');\n");
  result=await f.build();expect(result.code,result.output).toBe(0);
  expect(result.summary.tasks.find(task=>task.taskId==='@swarm/web#build').cache.status).toBe('MISS');
  const second=await f.read('apps/web/.next/cli.mjs'),manifest=JSON.parse(await f.read('apps/web/public/nh/latest.json'));
  expect(second).not.toBe(first);expect(second).toContain('second module');expect(manifest.version).toBe('1.0.1');
  expect(await f.read('apps/web/public'+firstManifest.path)).toBe(first);
  await rm(join(f.directory,'apps/web/public/nh'),{recursive:true});
  await rm(join(f.directory,'apps/web/.next'),{recursive:true});
  result=await f.build();expect(result.code,result.output).toBe(0);
  expect(result.summary.tasks.find(task=>task.taskId==='@swarm/web#build').cache).toMatchObject({status:'HIT',local:true});
  expect(await f.read('apps/web/.next/cli.mjs')).toBe(second);
  expect(await f.read('apps/web/public'+manifest.path)).toBe(second);
  const corrupt='corrupt published module\n';await writeFile(join(f.directory,'apps/web/public'+manifest.path),corrupt);
  result=await f.build();expect(result.code).not.toBe(0);expect(result.output).toContain('bump the package version');
  expect(await f.read('apps/web/public'+manifest.path)).toBe(corrupt);
  expect(await f.read('apps/web/.next/cli.mjs')).toBe(second);
 }finally{await f.remove();}
},60000);

test(`the former task graph reproduces stale web output after a CLI-only change (${renderer})`,async()=>{
 const config=JSON.parse(await readFile(join(root,'turbo.json'),'utf8'));
 delete config.tasks['@nanohub/cli#build'];delete config.tasks['@swarm/web#build'];
 const f=await fixture(config,environment);
 try{
  let result=await f.build();expect(result.code,result.output).toBe(0);
  expect(result.summary.tasks.find(task=>task.taskId==='@swarm/web#build').cache.status).toBe('MISS');
  const first=await f.read('apps/web/.next/cli.mjs');
  await writeFile(join(f.directory,'packages/cli/bin/nh.mjs'),"console.log('changed without a version bump');\n");
  result=await f.build();expect(result.code,result.output).toBe(0);expect(result.summary.tasks.find(task=>task.taskId==='@swarm/web#build').cache).toMatchObject({status:'HIT',local:true});
  expect(await f.read('apps/web/.next/cli.mjs')).toBe(first);
 }finally{await f.remove();}
},60000);
}
