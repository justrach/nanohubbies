import {open,constants,realpath,lstat} from 'node:fs/promises';
import {dirname,join,basename} from 'node:path';
export async function outsideCheckout(path,kind='credential') {
 let at=await realpath(dirname(path));
 for(;;){
  let marker=false;try{await lstat(join(at,'.git'));marker=true;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(marker||basename(at)==='.git')throw Error(`Keep ${kind} files outside Git checkouts`);
  const parent=dirname(at);if(parent===at)return;at=parent;
 }
}
export async function readPrivateJson(path,kind,validate,{maxBytes=4096}={}) {
 let handle;
 try {
  await outsideCheckout(path,kind);handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  const stat=await handle.stat();
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>32768||!stat.isFile()||stat.size>maxBytes||(stat.mode&0o077)!==0||typeof process.getuid==='function'&&stat.uid!==process.getuid())throw Error('Private file required');
  const bytes=Buffer.alloc(maxBytes+1),{bytesRead}=await handle.read(bytes,0,bytes.length,0);if(bytesRead>maxBytes)throw Error('Oversized private file');
  return validate(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,bytesRead))));
 }catch{throw Error(`Cannot read this private ${kind} file; require an owner-only regular JSON file for the selected host/repository`);}
 finally{await handle?.close();}
}
export async function createPrivateJson(path,record,kind,operation) {
 let handle;
 try{await outsideCheckout(path,kind);handle=await open(path,'wx',0o600);await handle.writeFile(JSON.stringify(record,null,2)+'\n');await handle.sync();}
 catch{throw Error(`Could not exclusively save the ${kind} file; ${operation} was not requested. Existing files are never overwritten`);}
 finally{await handle?.close();}
}
