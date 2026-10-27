import {resolve} from 'node:path';
import {migrate} from './migrate.mjs';
import {storedApiToken} from './api.mjs';
import {requireGitAccess} from './git-credential.mjs';
export async function importCommand({pos,opts,target,git,cwd,fetcher,environment,write,progress}){
 if(pos.length!==1||opts.web||opts.print)throw Error('Use repo import SOURCE -R owner/repository [--git]');
 let token=opts.git?null:await storedApiToken(target,git,environment);
 if(token){
  const identity=await requireGitAccess(target,git,environment,fetcher,token);
  if(!identity.credential.scopes.includes('contents:write'))throw Error('Import requires contents:read and contents:write, or --git with a repository Git token');
 }else{
  const url=new URL(target.gitUrl),input=`protocol=${url.protocol.slice(0,-1)}\nhost=${url.host}\npath=${url.pathname.slice(1)}\nusername=git\n\n`;
  const value=await git(['credential','fill'],input);
  token=value.split('\n').find(line=>line.startsWith('password='))?.slice(9);
  if(!/^nhg_[a-f0-9]{48}$/.test(token??''))throw Error('Import requires a stored repository Git token or an explicitly content-scoped CLI login');
 }
 let result;
 try{result=await migrate(resolve(cwd,pos[0]),target.gitUrl,'git',token,event=>progress(event.phase??`Imported ${event.stored}/${event.total} objects`),{fetcher,environment});}
 catch(error){throw Error(String(error.message).replaceAll(token,'[redacted]').replaceAll(Buffer.from('git:'+token).toString('base64'),'[redacted]'));}
 write(opts.json?JSON.stringify(result):`${result.resumed?'Verified existing import':'Imported'} ${result.refs} refs and ${result.objects} objects. Independent clone and strict fsck passed.`);
}
