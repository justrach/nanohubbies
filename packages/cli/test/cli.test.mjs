import {test,expect} from 'bun:test';
import {run,address,hostOrigin} from '../src/main.mjs';
function fixture({remote='https://nanohub.sh/git/team/project.git',fail=false}={}){const calls=[],output=[];let stored='';return{calls,output,io:{platform:'darwin',cwd:'/fixture',write:value=>output.push(value),execute:async(command,args,options)=>{calls.push({command,args,...options});if(args.includes('approve'))stored=options.input;return{code:fail?128:0,stdout:args.includes('get-url')?remote+'\n':args.includes('fill')?stored:'',stderr:''};}}};}
test('repository addresses and origins reject credentials, insecure remote HTTP and path injection',()=>{
 for(const host of ['http://example.com','https://user:password@example.com','https://nanohub.sh/path','file:///tmp/repo','https://nanohub.sh/?token=x'])expect(()=>hostOrigin(host)).toThrow();
 expect(hostOrigin('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
 for(const repo of ['--upload-pack=evil','owner/../secret','owner/repo/extra','Owner/repo'])expect(()=>address(repo,'https://nanohub.sh')).toThrow();
});
test('browser workflows infer only this host remote, open exact PR hunk review, and support JSON without launching',async()=>{
 const f=fixture();await run(['pr','view','12','--web','--json'],f.io);expect(JSON.parse(f.output[0]).url).toBe('https://nanohub.sh/team/project/pulls/12');expect(f.calls.length).toBe(1);
 await run(['rules','view','-R','team/project'],f.io);expect(f.calls.at(-1).command).toBe('open');expect(f.calls.at(-1).args).toEqual(['https://nanohub.sh/team/project/settings/rules']);
 await expect(run(['repo','view'],fixture({remote:'https://github.com/team/project.git'}).io)).rejects.toThrow('Origin');
 await expect(run(['pr','view','-1','-R','team/project'],f.io)).rejects.toThrow();
});
test('clone uses ordinary Git, repository credential path, and local helper config without a global write',async()=>{
 const f=fixture();await run(['repo','clone','team/project','checkout','--json'],f.io);const clone=f.calls.find(c=>c.args.includes('clone'));expect(clone.args.slice(-4)).toEqual(['clone','--','https://nanohub.sh/git/team/project.git','checkout']);const config=f.calls.filter(c=>c.args.includes('config'));expect(config[0].args.slice(-3)).toEqual(['config','credential.useHttpPath','true']);expect(config.every(c=>c.cwd==='/fixture/checkout')).toBe(true);expect(f.calls.some(c=>c.args.includes('--global'))).toBe(false);
});
test('stdin Git tokens are verified before OS storage, bound to exact host/path, never printed, and cannot grant API access',async()=>{
 const f=fixture(),token='nhg_'+'a'.repeat(48);await run(['auth','login','-R','team/project','--with-token','--json'],{...f.io,readToken:async()=>token+'\n'});
 expect(f.calls.length).toBe(3);expect(f.calls[0].env.NANOHUB_VERIFY_TOKEN).toBe(token);expect(f.calls[0].env.NANOHUB_VERIFY_HOST).toBe('nanohub.sh');expect(f.calls[0].env.NANOHUB_VERIFY_PATH).toBe('git/team/project.git');expect(f.calls[0].args.some(arg=>arg.includes(token))).toBe(false);expect(f.calls[1].input).toContain('path=git/team/project.git\nusername=git\npassword='+token);expect(f.output.join('')).not.toContain(token);
 const bad=fixture({fail:true});await expect(run(['auth','login','-R','team/project','--with-token'],{...bad.io,readToken:async()=>token})).rejects.toThrow('nothing was stored');expect(bad.calls.length).toBe(1);
 await expect(run(['auth','login','-R','team/project','--with-token'],{...f.io,readToken:async()=>'nhci_not-a-git-token'})).rejects.toThrow('nhg_');await expect(run(['auth','login','-R','team/project','--credential-helper','store'],f.io)).rejects.toThrow('plaintext');
});
test('logout rejects only this repository credential and does not claim server revocation',async()=>{
 const f=fixture();await run(['auth','logout','--git','-R','team/project'],f.io);expect(f.calls[0].args.slice(-2)).toEqual(['credential','reject']);expect(f.calls[0].input).toContain('path=git/team/project.git');expect(f.output[0]).toContain('Revoke the server token');
});
