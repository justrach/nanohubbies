import {test,expect} from 'bun:test';
import {mkdtemp,rm,readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {install,parseInstallOptions} from '../src/install.mjs';
import {buildDistribution} from '../scripts/build.mjs';
const bundle=Buffer.from("console.log('fixture');"),digest=createHash('sha256').update(bundle).digest('hex');
const manifest={format:1,version:'0.4.1',path:'/nh/releases/0.4.1/nh.mjs',bytes:bundle.length,sha256:digest};
const fixtureFetch=(m=manifest,bytes=bundle)=>async url=>url.endsWith('latest.json')?Response.json(m):new Response(bytes);
test('installer rejects malformed options, remote HTTP, unsupported runtimes and hostile manifests before installation',async()=>{
 expect(()=>parseInstallOptions(['--prefix'])).toThrow('Usage');expect(()=>parseInstallOptions(['--prefix','a','--prefix','b'])).toThrow('Duplicate');
 const dir=await mkdtemp(join(tmpdir(),'nh-install-'));try{
  for(const m of [{...manifest,path:'https://other.invalid/evil.mjs'},{...manifest,path:'/nh/releases/0.4.1/../evil.mjs'},{...manifest,version:'../../evil'},{...manifest,bytes:3e6},{...manifest,sha256:'bad'}])await expect(install({prefix:join(dir,'absent'),fetcher:fixtureFetch(m)})).rejects.toThrow('Invalid CLI release manifest');
  await expect(install({origin:'http://example.com',prefix:dir})).rejects.toThrow('HTTPS');await expect(install({prefix:dir,bunVersion:'1.3.9'})).rejects.toThrow('Bun 1.4');await expect(install({prefix:dir,platform:'win32'})).rejects.toThrow('macOS and Linux');
  expect(await lstat(join(dir,'absent')).catch(()=>null)).toBeNull();
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('installer preserves unrelated commands and refuses checksum mismatch without creating launchers',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nh-install-'));try{
  await mkdir(join(dir,'bin'));await writeFile(join(dir,'bin/nanohub'),'existing swarm command');let requests=0;
  await expect(install({prefix:dir,fetcher:async()=>{requests++;throw Error('Unexpected request');}})).rejects.toThrow('Refusing to replace');expect(requests).toBe(0);expect(await readFile(join(dir,'bin/nanohub'),'utf8')).toBe('existing swarm command');expect(await lstat(join(dir,'bin/nh')).catch(()=>null)).toBeNull();
  await expect(install({prefix:join(dir,'new'),fetcher:fixtureFetch(manifest,Buffer.from('altered'))})).rejects.toThrow('integrity');expect(await lstat(join(dir,'new')).catch(()=>null)).toBeNull();
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('installer downloads through bounded cookie-free redirect-refusing requests and only updates managed launchers',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nh-install-')),prefix=join(dir,"Owner's CLI path");try{
  const requests=[],fetcher=async(url,options)=>{requests.push({url,...options});return fixtureFetch()(url);};
  await install({prefix,fetcher});await install({prefix,fetcher});expect(requests).toHaveLength(4);expect(requests.every(r=>r.redirect==='error'&&r.credentials==='omit'&&!r.headers.Authorization)).toBe(true);
  const launcher=await readFile(join(prefix,'bin/nh'),'utf8');expect(launcher).toContain("Owner'\\''s CLI path");expect(launcher).toContain('"$@"');expect(await readFile(join(prefix,'bin/nanohub'),'utf8')).toBe(launcher);expect((await lstat(join(prefix,'bin/nh'))).mode&0o777).toBe(0o755);
  const path=join(prefix,'share/nanohub-cli',`0.4.1-${digest}`,'nh.mjs');await writeFile(path,'tampered');await expect(install({prefix,fetcher})).rejects.toThrow('Installed release differs');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('real installer fetch refuses HTTP redirects and oversized manifests without any installed files',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nh-installer-boundaries-'));let followed=0;
 const target=Bun.serve({port:0,hostname:'127.0.0.1',fetch:()=>{followed++;return Response.json(manifest);}});
 const redirect=Bun.serve({port:0,hostname:'127.0.0.1',fetch:()=>new Response(null,{status:302,headers:{Location:`http://127.0.0.1:${target.port}/nh/latest.json`}})});
 const oversized=Bun.serve({port:0,hostname:'127.0.0.1',fetch:()=>new Response(' '.repeat(8193))});
 try{
  await expect(install({prefix:join(dir,'redirect'),origin:`http://127.0.0.1:${redirect.port}`})).rejects.toThrow('Could not read');expect(followed).toBe(0);
  await expect(install({prefix:join(dir,'oversized'),origin:`http://127.0.0.1:${oversized.port}`})).rejects.toThrow('size limit');
  expect(await lstat(join(dir,'redirect')).catch(()=>null)).toBeNull();expect(await lstat(join(dir,'oversized')).catch(()=>null)).toBeNull();
 }finally{target.stop(true);redirect.stop(true);oversized.stop(true);await rm(dir,{recursive:true,force:true});}
});
test('real HTTP installer and bundled commands run outside the checkout from a quoted path',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nh-portable-')),assets=join(dir,'assets'),prefix=join(dir,"User's CLI directory");let server;
 try{
  const release=await buildDistribution(assets);const again=await buildDistribution(assets);expect(again).toEqual(release);
  server=Bun.serve({port:0,hostname:'127.0.0.1',fetch:request=>{const path=new URL(request.url).pathname;if(path==='/nh/latest.json')return new Response(Bun.file(join(assets,'latest.json')));if(path===release.path)return new Response(Bun.file(join(assets,'releases',release.version,'nh.mjs')));return new Response('Missing',{status:404});}});
  const run=async(cmd,args=[],environment={})=>{const child=Bun.spawn([cmd,...args],{cwd:dir,env:{...process.env,...environment},stdout:'pipe',stderr:'pipe'});const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);expect(code,stderr).toBe(0);return stdout;};
  await run(process.execPath,[join(assets,'install.mjs'),'--prefix',prefix,'--origin',`http://127.0.0.1:${server.port}`]);await rm(assets,{recursive:true,force:true});
  for(const name of ['nh','nanohub'])expect((await run(join(prefix,'bin',name),['--version'])).trim()).toBe('nh '+release.version);
  expect(await run(join(prefix,'bin/nh'),['--help'])).toContain('auth setup-git');
  const token='nhc_'+'e'.repeat(64),context='protocol=https\nhost=nanohub.sh\npath=git/team/project.git\nusername=git\n\n';
  const helper=Bun.spawn([join(prefix,'bin/nh'),'auth','git-credential','get','-R','team/project','--credential-helper','cache'],{cwd:dir,env:{...process.env,NANOHUB_API_TOKEN:token},stdin:new Response(context),stdout:'pipe',stderr:'pipe'});
  const privateOutput=await new Response(helper.stdout).text();expect(await helper.exited).toBe(0);expect(privateOutput).toBe(`username=git\npassword=${token}\n\n`);
 }finally{server?.stop(true);await rm(dir,{recursive:true,force:true});}
});
