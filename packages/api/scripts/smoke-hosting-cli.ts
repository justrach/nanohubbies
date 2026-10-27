import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {teamFixture} from './team/fixture.ts';
const f=await teamFixture(),exec=promisify(execFile),trunk='hosting-cli',base=`/api/trunks/${trunk}`,bin=resolve(import.meta.dirname,'../../cli/bin/nh.mjs');
const home=join(f.dir,'home'),cache=join(f.dir,'cache');await mkdir(home,{mode:0o700});await mkdir(cache,{mode:0o700});const env={...process.env,HOME:home,XDG_CACHE_HOME:cache,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'};
let cookie:any,issued:any;
const cli=(args:string[],input='')=>new Promise<{code:number|null;stdout:string;stderr:string}>((done,reject)=>{const child=spawn('bun',[bin,...args,'--host',f.origin,'--trunk',trunk,'--credential-helper','cache','--json'],{cwd:f.dir,env,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);child.on('error',reject);child.on('close',code=>done({code,stdout,stderr}));child.stdin.end(input);});
try{
 cookie=await f.login('owner','101');await f.json('POST',base,{mode:'git'},cookie);issued=await f.json('POST',`${base}/git-tokens`,{label:'Disposable CLI test'},cookie);
 const source=join(f.dir,'source');await mkdir(source);const git=async(...args:string[])=>(await exec('git',['-C',source,'-c','user.name=CLI fixture','-c','user.email=fixture@example.invalid',...args],{env})).stdout.trim();
 await git('init','-b','main');await writeFile(join(source,'README.md'),'CLI fixture\n');await git('add','.');await git('commit','-m','Initial');const head=await git('rev-parse','HEAD');
 await exec('git',['-C',source,'push',`${f.origin}/git/${trunk}.git`,'main'],{env:{...env,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.extraHeader',GIT_CONFIG_VALUE_0:`Authorization: Basic ${btoa('git:'+issued.token)}`}});
 let result=await cli(['auth','login','--with-token'],issued.token+'\n');assert.equal(result.code,0,result.stderr);assert.ok(!JSON.stringify(result).includes(issued.token));assert.equal(JSON.parse(result.stdout).trunk,trunk);
 result=await cli(['auth','status','--git']);assert.equal(result.code,0,result.stderr);assert.equal(JSON.parse(result.stdout).authenticated,true);
 result=await cli(['repo','clone','checkout']);assert.equal(result.code,0,result.stderr);const clone=join(f.dir,'checkout');assert.equal((await exec('git',['-C',clone,'rev-parse','HEAD'],{env})).stdout.trim(),head);await exec('git',['-C',clone,'fsck','--strict'],{env});assert.ok(!(await exec('git',['-C',clone,'config','--local','--list'],{env})).stdout.includes(issued.token));
 await f.json('PUT',`${base}/protection`,{branch:'main',pullRequest:false,approvals:0,checks:[],beforeOpen:[],preventForce:true,preventDelete:true,locked:true},cookie);
 await writeFile(join(clone,'README.md'),'Must not bypass lock\n');await exec('git',['-C',clone,'-c','user.name=CLI fixture','-c','user.email=fixture@example.invalid','commit','-am','Blocked push'],{env});await assert.rejects(exec('git',['-C',clone,'push','origin','main'],{env}),error=>/locked/.test(String((error as any).stderr)));
 await f.json('POST',`${base}/archive`,{archived:true,revision:0,confirmation:trunk},cookie);result=await cli(['auth','status','--git']);assert.equal(result.code,0,result.stderr);result=await cli(['repo','clone','archived-checkout']);assert.equal(result.code,0,result.stderr);await exec('git',['-C',join(f.dir,'archived-checkout'),'fsck','--strict'],{env});
 await assert.rejects(exec('git',['-C',clone,'push','origin','HEAD:refs/heads/archive-blocked'],{env}),error=>/403|archived/.test(String((error as any).stderr)));await f.json('POST',`${base}/archive`,{archived:false,revision:1,confirmation:trunk},cookie);
 result=await cli(['pr','view','1','--print']);assert.equal(result.code,0,result.stderr);assert.equal(JSON.parse(result.stdout).url,`${f.origin}/t/${trunk}/pulls/1`);
 result=await cli(['auth','logout','--git']);assert.equal(result.code,0,result.stderr);result=await cli(['auth','status','--git']);assert.equal(result.code,1);assert.ok(!JSON.stringify(result).includes(issued.token));
 await f.json('DELETE',`/api/tokens/${issued.id}`,undefined,cookie);assert.equal((await f.request('GET',`${base}/repository`,undefined,cookie)).status,200);
 console.log('PASS: actual Bun nh CLI stdin login into isolated memory credential helper, repository-scoped Git status/clone/fsck, no token in args/output/remote/config, protected and archived push refusal, archived clone access, review URL and logout rejection');
}finally{if(issued&&cookie)await f.request('DELETE',`/api/tokens/${issued.id}`,undefined,cookie).catch(()=>{});await exec('git',['credential-cache','exit'],{env}).catch(()=>{});await f.close();}
