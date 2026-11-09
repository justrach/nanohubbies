/** Read only committed Git objects; never run candidate code or Git hooks. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat} from 'node:fs/promises';
import {isAbsolute,resolve} from 'node:path';

const exec=promisify(execFile),commit=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);

export async function verifyMeldStagingAncestry(source,stagingCommit,head) {
 if(!isAbsolute(source??'')||!commit(stagingCommit)||!commit(head))throw Error('A full inspected staging commit and candidate Git source are required');
 const git=async(...args)=>(await exec('git',['--no-replace-objects','-C',source,...args],{env:{PATH:process.env.PATH,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_NO_REPLACE_OBJECTS:'1'},timeout:30000,maxBuffer:65536})).stdout.trim();
 try {
  const grafts=resolve(source,await git('rev-parse','--git-path','info/grafts'));
  let present=false;try{await lstat(grafts);present=true;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(present)throw Error('grafts');
  const types=await Promise.all([git('cat-file','-t',stagingCommit),git('cat-file','-t',head)]);
  if(types.some(type=>type!=='commit'))throw Error('not a commit');
 }catch{throw Error('Cannot verify staging ancestry from immutable Git commits; grafts and missing objects are refused');}
 try{await git('merge-base','--is-ancestor',stagingCommit,head);}
 catch(error){if(error.code===1)throw Error('The candidate omits current staging history; prepare a reviewed integration candidate and refresh its checks');throw Error('Cannot verify the current staging ancestry');}
 return Object.freeze({stagingCommit,head});
}
