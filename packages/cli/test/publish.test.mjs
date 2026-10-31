import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,readFile,writeFile,readdir,lstat,rm,rmdir,rename,symlink,readlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {publishRelease} from '../scripts/publish.mjs';

const bytes=value=>Buffer.from(value),hash=value=>createHash('sha256').update(value).digest('hex');
const present=path=>lstat(path).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
async function snapshot(directory){
 const files={};for(const name of (await readdir(directory,{recursive:true})).sort()){
  const path=join(directory,name),stat=await lstat(path);
  files[name]=stat.isSymbolicLink()?{link:await readlink(path)}:stat.isDirectory()?{directory:true}:{sha256:hash(await readFile(path))};
 }return files;
}
const temporary=()=>mkdtemp(join(tmpdir(),"nh publication's "));
const catalog={format:1,releases:{}};
const publish=(output,version='0.4.19',module='module A',installer='installer A',options)=>publishRelease(output,version,bytes(module),bytes(installer),{catalog,...options});

test('an identical legacy-layout release is preserved and unversioned installer updates do not replace version bytes',async()=>{
 const dir=await temporary();try{
  const first=await publish(dir),module=join(dir,'releases',first.version,'nh.mjs'),checksum=join(dir,'releases',first.version,'SHA256SUMS');
  const before=await snapshot(dir),moduleTime=(await lstat(module)).mtimeMs,checksumTime=(await lstat(checksum)).mtimeMs;
  expect(await publish(dir)).toEqual(first);expect(await snapshot(dir)).toEqual(before);
  await publish(dir,'0.4.19','module A','updated installer');expect(await readFile(join(dir,'install.mjs'),'utf8')).toBe('updated installer');
  expect(await readFile(module,'utf8')).toBe('module A');expect((await lstat(module)).mtimeMs).toBe(moduleTime);expect((await lstat(checksum)).mtimeMs).toBe(checksumTime);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('a different build of an existing version changes neither downloads, installer nor current manifest',async()=>{
 const dir=await temporary();try{
  await publish(dir);const before=await snapshot(dir);
  await expect(publish(dir,'0.4.19','different module','different installer')).rejects.toThrow('bump the package version');
  expect(await snapshot(dir)).toEqual(before);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('missing or changed version checksums require explicit recovery instead of rewriting existing evidence',async()=>{
 for(const operation of ['missing','changed']){const dir=await temporary();try{
  await publish(dir);const checksum=join(dir,'releases/0.4.19/SHA256SUMS');
  if(operation==='missing')await rm(checksum);else await writeFile(checksum,'unverified checksum\n');
  const before=await snapshot(dir);await expect(publish(dir)).rejects.toThrow('bump the package version');expect(await snapshot(dir)).toEqual(before);
 }finally{await rm(dir,{recursive:true,force:true});}}
});
test('a malformed current manifest, partial release or non-file head fails before publication',async()=>{
 for(const operation of ['manifest','partial','installer']){const dir=await temporary();try{
  await publish(dir);
  if(operation==='manifest')await writeFile(join(dir,'latest.json'),'{invalid');
  else if(operation==='partial')await mkdir(join(dir,'releases/0.4.20'));
  else{await rm(join(dir,'install.mjs'));await mkdir(join(dir,'install.mjs'));}
  const before=await snapshot(dir);await expect(publish(dir,'0.4.20','new module','new installer')).rejects.toThrow();expect(await snapshot(dir)).toEqual(before);
 }finally{await rm(dir,{recursive:true,force:true});}}
});
test('release, file and alias symlinks never redirect publishing into unrelated paths',async()=>{
 for(const part of ['releases','releases/0.4.19','releases/0.4.19/nh.mjs','releases/0.4.19/SHA256SUMS','latest.json','install.mjs']){
  const dir=await temporary(),output=join(dir,'output'),outside=join(dir,'unrelated');try{
   await publish(output);const target=join(output,part);await rename(target,outside);await symlink(outside,target);
   const before=await snapshot(dir);await expect(publish(output)).rejects.toThrow();expect(await snapshot(dir)).toEqual(before);expect((await lstat(target)).isSymbolicLink()).toBe(true);
  }finally{await rm(dir,{recursive:true,force:true});}
 }
});
test('new versions retain earlier artifacts and latest cannot regress, including above numeric precision limits',async()=>{
 const dir=await temporary();try{
  const older='9007199254740992.0.0',newer='9007199254740993.0.0';await publish(dir,older);await publish(dir,newer,'new module','new installer');const before=await snapshot(dir);
  await expect(publish(dir,older)).rejects.toThrow('Refusing to move latest');expect(await snapshot(dir)).toEqual(before);
  expect(JSON.parse(await readFile(join(dir,'latest.json'),'utf8')).version).toBe(newer);expect(await readFile(join(dir,'releases',older,'nh.mjs'),'utf8')).toBe('module A');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('unknown versions and oversized artifacts fail before creating an output directory',async()=>{
 const dir=await temporary(),output=join(dir,'untouched');try{
  for(const version of ['01.0.0','1.0','1.0.0-rc.1','../1.0.0','1'.repeat(65)+'.0.0'])await expect(publish(output,version)).rejects.toThrow('stable CLI version');
  await expect(publishRelease(output,'0.4.19',Buffer.alloc(2*1024*1024+1),bytes('installer'))).rejects.toThrow('2097152 bytes');
  expect(await present(output)).toBeNull();
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('an unresolved publisher lock is retained; explicit fixture reconciliation allows a clean retry',async()=>{
 const dir=await temporary();try{
  await publish(dir);const lock=join(dir,'.release-publication-lock');await mkdir(lock);const before=await snapshot(dir);
  await expect(publish(dir,'0.4.20','new module','new installer',{lockTimeoutMs:60})).rejects.toThrow('verify active builds');expect(await snapshot(dir)).toEqual(before);
  await rmdir(lock);expect((await publish(dir,'0.4.20','new module','new installer')).version).toBe('0.4.20');expect(await present(lock)).toBeNull();
 }finally{await rm(dir,{recursive:true,force:true});}
});

async function childPublisher(dir){
 const path=join(dir,'publisher.mjs'),source=new URL('../scripts/publish.mjs',import.meta.url).href;
 await writeFile(path,`import {publishRelease} from ${JSON.stringify(source)};\nconst [output,version,label]=process.argv.slice(2);console.log(JSON.stringify(await publishRelease(output,version,Buffer.from('module '+label),Buffer.from('installer '+label),{catalog:{format:1,releases:{}}})));\n`);
 return (output,version,label)=>{
  const child=Bun.spawn([Bun.which('bun'),path,output,version,label],{stdout:'pipe',stderr:'pipe'});
  return Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]).then(([exit,stdout,stderr])=>({exit,stdout,stderr}));
 };
}
test('competing processes publish one complete first release and the losing bytes cannot alter either head',async()=>{
 const dir=await temporary(),output=join(dir,'output');try{
  const child=await childPublisher(dir);let remaining=2;
  const pending=['A','B'].map(label=>child(output,'0.4.19',label).finally(()=>remaining--));
  while(remaining){
   if(await present(join(output,'releases/0.4.19'))){const module=await readFile(join(output,'releases/0.4.19/nh.mjs'));expect(['module A','module B']).toContain(module.toString());expect(await readFile(join(output,'releases/0.4.19/SHA256SUMS'),'utf8')).toBe(hash(module)+'  nh.mjs\n');}
   await Bun.sleep(1);
  }
  const results=await Promise.all(pending),winner=results.find(result=>result.exit===0),loser=results.find(result=>result.exit!==0);expect(winner).toBeDefined();expect(loser).toBeDefined();expect(loser.stderr).toContain('bump the package version');
  const manifest=JSON.parse(winner.stdout),module=await readFile(join(output,'releases/0.4.19/nh.mjs'));expect(hash(module)).toBe(manifest.sha256);expect(JSON.parse(await readFile(join(output,'latest.json'),'utf8'))).toEqual(manifest);
  expect(await readFile(join(output,'install.mjs'),'utf8')).toBe(module.toString().replace('module','installer'));expect(await present(join(output,'.release-publication-lock'))).toBeNull();
  expect((await readdir(output,{recursive:true})).some(name=>name.includes('.stage-')||name.endsWith('.tmp'))).toBe(false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('concurrent processes cannot move latest backward when publishing different versions',async()=>{
 const dir=await temporary(),output=join(dir,'output');try{
  const child=await childPublisher(dir),results=await Promise.all([child(output,'0.4.19','old'),child(output,'0.4.20','new')]);
  expect(results[1].exit).toBe(0);if(results[0].exit!==0)expect(results[0].stderr).toContain('Refusing to move latest');
  expect(JSON.parse(await readFile(join(output,'latest.json'),'utf8')).version).toBe('0.4.20');expect(await readFile(join(output,'install.mjs'),'utf8')).toBe('installer new');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('a real installer bundle failure exposes no new version and preserves the existing distribution',async()=>{
 const dir=await temporary(),output=join(dir,'output'),project=join(dir,'project');try{
  await publish(output);const before=await snapshot(output);await mkdir(join(project,'scripts'),{recursive:true});await mkdir(join(project,'bin'));
  for(const name of ['build.mjs','publish.mjs'])await writeFile(join(project,'scripts',name),await readFile(new URL('../scripts/'+name,import.meta.url)));
  await writeFile(join(project,'package.json'),JSON.stringify({version:'0.4.20'}));await writeFile(join(project,'bin/nh.mjs'),"console.log('CLI fixture');\n");await writeFile(join(project,'install.mjs'),'const = invalid;\n');
  await writeFile(join(project,'release-lock.json'),JSON.stringify(catalog));
  const child=Bun.spawn([Bun.which('bun'),join(project,'scripts/build.mjs'),output],{stdout:'pipe',stderr:'pipe'}),[exit,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
  expect(exit).not.toBe(0);expect(stderr).toContain('install.mjs');expect(stderr).toContain('error:');expect(stdout).toBe('');expect(await snapshot(output)).toEqual(before);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('a published catalog enforces exact bytes and prevents stale first publication in a clean directory',async()=>{
 const dir=await temporary(),output=join(dir,'fresh'),lock={format:1,releases:{'0.4.19':{bytes:8,sha256:hash(bytes('module A'))}}};try{
  await expect(publish(output,'0.4.19','module B','installer B',{catalog:lock})).rejects.toThrow('does not match its recorded bytes');expect(await present(output)).toBeNull();
  await expect(publish(output,'0.4.18','old module','old installer',{catalog:lock})).rejects.toThrow('catalog records');expect(await present(output)).toBeNull();
  expect((await publish(output,'0.4.19','module A','installer A',{catalog:lock})).version).toBe('0.4.19');
  expect((await publish(output,'0.4.20','new module','new installer',{catalog:lock})).version).toBe('0.4.20');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('a missing or malformed catalog fails closed before publishing files',async()=>{
 const dir=await temporary(),output=join(dir,'fresh');try{
  for(const catalog of [undefined,{}, {format:2,releases:{}},{format:1,releases:[]},{format:1,releases:{'0.4.19':{bytes:8,sha256:'invalid'}}}])await expect(publish(output,'0.4.19','module A','installer A',{catalog})).rejects.toThrow('catalog');
  expect(await present(output)).toBeNull();
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('the real builder checks its committed catalog when no output files exist',async()=>{
 const dir=await temporary(),output=join(dir,'fresh'),project=join(dir,'project');try{
  await mkdir(join(project,'scripts'),{recursive:true});await mkdir(join(project,'bin'));
  for(const name of ['build.mjs','publish.mjs'])await writeFile(join(project,'scripts',name),await readFile(new URL('../scripts/'+name,import.meta.url)));
  await writeFile(join(project,'package.json'),JSON.stringify({version:'0.4.19'}));await writeFile(join(project,'release-lock.json'),await readFile(new URL('../release-lock.json',import.meta.url)));
  await writeFile(join(project,'bin/nh.mjs'),"console.log('Changed CLI fixture');\n");await writeFile(join(project,'install.mjs'),"console.log('Installer fixture');\n");
  const child=Bun.spawn([Bun.which('bun'),join(project,'scripts/build.mjs'),output],{stdout:'pipe',stderr:'pipe'}),[exit,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
  expect(exit).not.toBe(0);expect(stderr).toContain('does not match its recorded bytes');expect(stdout).toBe('');expect(await present(output)).toBeNull();
 }finally{await rm(dir,{recursive:true,force:true});}
});
