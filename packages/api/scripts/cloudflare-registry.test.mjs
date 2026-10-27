import test from 'node:test';
import assert from 'node:assert/strict';
import {access,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {toolchain} from '../../../tools/toolchain.mjs';
import {cloudflarePullCredentials} from '../../../tools/cloudflare-registry.mjs';
const image='registry.cloudflare.com/'+'a'.repeat(32)+'/nanohub-ci@sha256:'+'b'.repeat(64);
const config={provider:'cloudflare',config:'/etc/nanohub/wrangler.jsonc'};
test('private toolchains require the Cloudflare account namespace, a digest and trusted configuration, with no mixed delivery modes',()=>{
 assert.deepEqual(toolchain(image,undefined,undefined,undefined,config),{image,snapshot:false,registry:config});
 for(const candidate of [image.replace('registry.cloudflare.com','registry.invalid'),image.replace('@sha256:',':latest@sha256:'),image.replace('/nanohub-ci','/../nanohub-ci'),image.replace('@sha256:'+'b'.repeat(64),':latest')])assert.throws(()=>toolchain(candidate,undefined,undefined,undefined,config),/Cloudflare registry/);
 for(const value of [null,[],{...config,config:'relative.json'},{...config,provider:'other'},{...config,config:'/etc/bad\nfile'},{...config,password:'do-not-store'}])assert.throws(()=>toolchain(image,undefined,undefined,undefined,value),/Cloudflare registry/);
 for(const mixed of [['snp_fixture',undefined,undefined],[undefined,'/workspace/nanohub-toolchain/image.tar',undefined],[undefined,undefined,{}]])assert.throws(()=>toolchain(image,...mixed,config),/cannot be combined/);
});
test('each job issues fresh short-lived pull-only credentials, keeps controls host-side and removes Wrangler credential logs',async()=>{
 let issuance=0;const logs=[];
 const processRunner=async(command,args,{env,timeoutMs})=>{
   assert.equal(command,process.execPath);assert.equal(timeoutMs,60000);assert.ok(args.includes('--pull'));assert.ok(!args.includes('--push'));assert.equal(args[args.indexOf('--expiration-minutes')+1],'15');assert.equal(args.at(-1),config.config);
   assert.equal(env.CLOUDFLARE_API_TOKEN,'synthetic-cf-control');assert.equal(env.CODEGRAFF_API_KEY,undefined);assert.equal(env.NANOHUB_CI_TOKEN,undefined);assert.equal(env.GITHUB_TOKEN,undefined);assert.equal(env.NODE_OPTIONS,undefined);
   assert.equal(env.WRANGLER_LOG_SANITIZE,'true');logs.push(dirname(env.WRANGLER_LOG_PATH));await writeFile(env.WRANGLER_LOG_PATH,'synthetic-registry-secret');
   return {code:0,output:JSON.stringify({username:'v1',password:'synthetic-pull-'+ ++issuance})};
 };
 const options={processRunner,now:()=>100000,env:{PATH:process.env.PATH,HOME:'/operator',CLOUDFLARE_API_TOKEN:'synthetic-cf-control',CODEGRAFF_API_KEY:'synthetic-gateway',NANOHUB_CI_TOKEN:'synthetic-ci',GITHUB_TOKEN:'synthetic-gh',NODE_OPTIONS:'untrusted-preload'}};
 const first=await cloudflarePullCredentials(image,config,options),second=await cloudflarePullCredentials(image,config,options);
 assert.notEqual(first.password,second.password);assert.equal(first.expiresAt,100000+15*60000);assert.notEqual(logs[0],logs[1]);for(const path of logs)await assert.rejects(access(path));
});
test('provider errors and malformed credentials fail generically without disclosing output; temporary logs are removed on failure',async()=>{
 for(const mode of ['throw','exit','json','username','password','expired']){
   let path,clock=0;
   const options={now:()=>clock,processRunner:async(_command,_args,{env})=>{
     path=dirname(env.WRANGLER_LOG_PATH);await writeFile(join(path,'wrangler.log'),'synthetic-secret');
     if(mode==='throw')throw Error('synthetic-secret');if(mode==='expired')clock=61000;
     return {code:mode==='exit'?1:0,output:mode==='json'?'synthetic-secret':JSON.stringify({username:mode==='username'?'bad':'v1',password:mode==='password'?'synthetic-secret\n':'synthetic-secret'})};
   }};
   await assert.rejects(cloudflarePullCredentials(image,config,options),error=>!String(error).includes('synthetic-secret'));
   await assert.rejects(access(path));
 }
});
