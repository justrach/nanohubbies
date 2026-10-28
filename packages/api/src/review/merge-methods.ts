import {commit,encode,type GitObject} from "../git";
import type {StoredObject} from "../objects";
import {isAncestor} from "../repository/validate";
import {parseCommit} from "../browse/objects";
import type {Owner} from "../types";
import type {GeneratedMergeEvidence} from "./merge-types";

const utf8=new TextEncoder(),ascii=(bytes:Uint8Array)=>new TextDecoder().decode(bytes);
function identity(owner:Owner,time:number) {
  return {name:clean(owner.name)||"Nanohub",email:`${owner.id.replace(/[^a-zA-Z0-9.-]/g,"-")}@nanohub.invalid`,time};
}
const clean=(value:string)=>value.replace(/[<>\r\n\0]/g,"");
function message(value:string) {
  if(typeof value!=="string"||!value.trim()||value.includes("\0")||utf8.encode(value).length>65536)throw Error("Provide a nonempty merge message of at most 64 KiB without NUL bytes");
  return value;
}
/** Strict methods preserve the exact tree reviewed/tested at head. Graph/ref
 * proofs are subsequently built for the new actual landed commit as well. */
export async function buildMerge(get:(sha:string)=>Promise<StoredObject|null>,input:{method:GeneratedMergeEvidence["method"];base:string;head:string;tree:string;owner:Owner;author:Owner;message:string;time?:number}) {
  if(!["merge","squash","rebase"].includes(input.method))throw Error("Unknown merge method");
  if(![input.base,input.head,input.tree].every(sha=>/^[a-f0-9]{40}$/.test(sha))||input.base===input.head)throw Error("Choose a changed pull request head and current target");
  if(!await isAncestor(get,input.base,input.head))throw Error("Target branch moved: merge its current head into the feature branch, push and rerun CI before merging");
  const read=async(sha:string)=>{const object=await get(sha);if(!object||object.type!=="commit")throw Error("Missing commit while preparing the merge");return {raw:object.body,info:parseCommit(sha,object.body)};};
  const source=await read(input.head);if(source.info.tree!==input.tree)throw Error("Reviewed head tree changed; refresh and retry");
  const time=input.time??Math.floor(Date.now()/1000);if(!Number.isSafeInteger(time)||time<0)throw Error("Invalid merge timestamp");
  const objects:GitObject[]=[],rewritten:{original:string;commit:string}[]=[];
  if(input.method!=="rebase") {
    const value={tree:input.tree,parents:input.method==="merge"?[input.base,input.head]:[input.base],author:identity(input.method==="squash"?input.author:input.owner,time),committer:identity(input.owner,time),message:message(input.message)};
    let made=commit(value);if(made.sha===input.head)made=commit({...value,committer:{...value.committer,time:time+1}});objects.push(made);
  } else {
    const history:{sha:string;raw:Uint8Array;tree:string;parent:string}[]=[];let at=input.head,bytes=0;
    while(at!==input.base) {
      if(history.length>=200)throw Error("Automatic rebase is limited to 200 commits; rebase locally or choose squash/merge");
      const c=await read(at);if(c.info.parents.length!==1)throw Error("Rebase and merge needs a linear feature history; rebase locally or choose squash/merge");
      if((bytes+=c.raw.length)>16*1024*1024)throw Error("Rebase commit metadata exceeds 16 MiB; rebase locally");
      history.push({sha:at,raw:c.raw,tree:c.info.tree,parent:c.info.parents[0]});at=c.info.parents[0];
    }
    let parent=input.base,previousTree=(await read(input.base)).info.tree;
    for(const c of history.reverse()) {
      // GitHub-style rebase drops originally empty commits. The complete tree,
      // raw author and message are otherwise retained; old signatures are not.
      if(c.tree===previousTree)continue;
      let split=-1;for(let i=0;i<c.raw.length-1;i++)if(c.raw[i]===10&&c.raw[i+1]===10){split=i;break;}
      if(split<0)throw Error("Cannot rebase a commit without a message separator");
      const lines:Uint8Array[]=[];let start=0;for(let i=0;i<=split;i++)if(i===split||c.raw[i]===10){lines.push(c.raw.slice(start,i));start=i+1;}
      const field=(name:string)=>lines.filter(line=>ascii(line.subarray(0,name.length+1))===name+" ");
      const authors=field("author"),encodings=field("encoding");if(authors.length!==1||encodings.length>1)throw Error("Cannot rebase ambiguous commit identity/encoding metadata");
      const person=identity(input.owner,time),signature=(stamp:number)=>`${clean(person.name)} <${clean(person.email)}> ${stamp} +0000`;
      const original=field("committer");let stamp=time;if(original.length===1&&ascii(original[0])==="committer "+signature(stamp))stamp++;
      const prefix=utf8.encode(`tree ${c.tree}\nparent ${parent}\n`),suffix=utf8.encode(`\ncommitter ${signature(stamp)}\n`),encoding=encodings.length?new Uint8Array([...encodings[0],10]):new Uint8Array(),body=c.raw.slice(split+2);
      const raw=new Uint8Array(prefix.length+authors[0].length+suffix.length+encoding.length+1+body.length);let offset=0;
      for(const part of [prefix,authors[0],suffix,encoding,new Uint8Array([10]),body]){raw.set(part,offset);offset+=part.length;}
      const made=encode("commit",raw);objects.push(made);rewritten.push({original:c.sha,commit:made.sha});parent=made.sha;previousTree=c.tree;
    }
    if(!objects.length)throw Error("No nonempty commits remain to rebase; close this pull request");
    if(previousTree!==input.tree)throw Error("Rebase did not preserve the exact reviewed tree");
  }
  const result=objects.at(-1)!.sha;
  // A squash may otherwise reproduce a one-commit source byte for byte.
  if(result===input.head)throw Error("Generated merge must create a new commit; retry with another message or timestamp");
  return {objects,candidate:{commit:result,tree:input.tree,base:input.base,method:input.method},evidence:{version:1,method:input.method,base:input.base,head:input.head,result,tree:input.tree,...(rewritten.length?{rewritten}:{})} satisfies GeneratedMergeEvidence};
}
