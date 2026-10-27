import {test,expect} from 'bun:test';
import {run} from '../src/main.mjs';
import {gitHelperCommand,gitCredentialHelper} from '../src/git-credential.mjs';
const token='nhc_'+'a'.repeat(64),target={origin:'https://nanohub.sh',repository:'team/project',trunk:null,gitUrl:'https://nanohub.sh/git/team/project.git'};
const input='protocol=https\nhost=nanohub.sh\npath=git/team/project.git\nusername=git\n\n';
test('Git helper validates exact origin/path/user before reading a credential and never serves ambiguous contexts',async()=>{
 for(const context of [input.replace('https','http'),input.replace('nanohub.sh','other.invalid'),input.replace('project.git','other.git'),input.replace('username=git','username=agent'),input.replace('\n\n','\nhost=nanohub.sh\n\n'),input.replace('path=git/team/project.git\n','')]){
  let reads=0;const output=[];await gitCredentialHelper({target,git:async()=>{reads++;return 'password='+token;},environment:{},readCredential:async()=>context,write:v=>output.push(v),operation:'get'});expect(reads).toBe(0);expect(output).toEqual([]);
 }
 const output=[];await gitCredentialHelper({target,git:async()=>{throw Error('No helper expected');},environment:{NANOHUB_API_TOKEN:token},readCredential:async()=>input,write:v=>output.push(v),operation:'get'});expect(output).toEqual([`username=git\npassword=${token}\n`]);
 for(const operation of ['store','erase'])await gitCredentialHelper({target,git:async()=>{throw Error('No lookup');},environment:{},readCredential:async()=>{throw Error('No input needed');},write:()=>{throw Error('No output');},operation});
});
test('helper commands quote executable paths without embedding credentials and bind the selected repository',()=>{
 const command=gitHelperCommand(target,'cache',{executable:"/tmp/Bun's directory/bun",bin:'/tmp/source path/nh.mjs'});
 expect(command).toStartWith("!'/tmp/Bun'\\''s directory/bun'");expect(command).toContain("'--repo' 'team/project'");expect(command).toContain("'--host' 'https://nanohub.sh'");expect(command).not.toContain(token);
});
test('CLI clone uses the bound helper and blocks redirects, while API-only logins require a separate Git choice',async()=>{
 const calls=[],output=[],requests=[];let scopes=['read','contents:read'];
 const io={platform:'darwin',cwd:'/fixture',environment:{NANOHUB_API_TOKEN:token},write:v=>output.push(v),execute:async(command,args,options)=>{calls.push({command,args,...options});return{code:0,stdout:'',stderr:''};},fetcher:async(url)=>{requests.push(url);return Response.json(url.endsWith('/whoami')?{credential:{scopes}}:{branches:[]});}};
 await run(['repo','clone','team/project','checkout','--json'],io);const clone=calls.find(c=>c.args.includes('clone'));expect(clone.args).toContain('http.followRedirects=false');expect(clone.args.some(a=>a.startsWith('credential.helper=!'))).toBe(true);expect(calls.some(c=>c.args.includes('--global'))).toBe(false);expect(JSON.stringify(calls.map(c=>({args:c.args,input:c.input})))).not.toContain(token);
 expect(calls.some(c=>c.args.includes('http.followRedirects'))).toBe(true);expect(requests).toContain('https://nanohub.sh/api/cli/repos/team/project/branches');
 scopes=['read'];calls.length=0;await expect(run(['repo','clone','team/project','other'],io)).rejects.toThrow('contents:read');expect(calls.some(c=>c.args.includes('clone'))).toBe(false);
 await run(['repo','clone','team/project','separate','--git'],io);expect(calls.at(-1).args.at(-1)).toBe('osxkeychain');
});
test('setup-git refuses another checkout before configuration and logout clears already-invalid local API entries',async()=>{
 const calls=[],output=[];const io={platform:'darwin',cwd:'/fixture',environment:{NANOHUB_API_TOKEN:token},write:v=>output.push(v),execute:async(command,args,options)=>{calls.push({command,args,...options});return{code:0,stdout:args.includes('get-url')?'https://nanohub.sh/git/other/repo.git':'',stderr:''};},fetcher:async()=>Response.json({error:'Invalid or expired CLI credential'},{status:401})};
 await expect(run(['auth','setup-git','-R','team/project'],io)).rejects.toThrow('Origin must match');expect(calls.some(c=>c.args.includes('config'))).toBe(false);
 await run(['auth','logout','-R','team/project','--json'],io);expect(JSON.parse(output[0])).toEqual({revoked:false,inactive:true});expect(calls.at(-1).args.at(-1)).toBe('reject');
 io.fetcher=async()=>Response.json({error:'Wrong repository'},{status:404});calls.length=0;await expect(run(['auth','logout','-R','team/project'],io)).rejects.toThrow('Wrong repository');expect(calls.length).toBe(0);
});
