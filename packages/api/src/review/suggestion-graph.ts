import { blobText } from "../browse/objects";
import { changesBetween } from "../browse/history";
import { encode,isDir,readTree,tree,commit,type GitObject,type TreeEntry } from "../git";
import { entryAt,type Objects } from "../trees";
import type { Owner } from "../types";
import type { Branch,Pull } from "./types";
import type { PullComment } from "./pull-comment-types";
import { anchorInPatch } from "./comments";
import { replaceSuggestion,suggestionText } from "./suggestion-text";

export async function suggestionCommit(objects:Objects,pull:Pull,head:Branch,comments:PullComment[],actor:Owner,message:string) {
  const diff=await changesBetween(objects,pull.anchorTree,head.tree),byPath=new Map<string,PullComment[]>(),made:GitObject[]=[],patches=new Map<string,TreeEntry>();
  for(const comment of comments) {
    if(comment.pull!==pull.number||comment.replyTo||comment.applied||comment.commit!==head.commit||comment.anchor!==pull.anchor||comment.side!=="RIGHT"||!suggestionText(comment.body))throw Error("Suggestion must use the current after-side diff");
    if(!anchorInPatch(diff.files.find(file=>file.path===comment.path)?.patch??null,comment))throw Error("Suggestion selection is no longer in the visible diff");
    byPath.set(comment.path,[...(byPath.get(comment.path)??[]),comment]);
  }
  for(const [path,selected] of byPath) {
    selected.sort((a,b)=>a.startLine-b.startLine);
    for(let i=1;i<selected.length;i++)if(selected[i].startLine<=selected[i-1].line)throw Error(`Suggestions overlap in ${path}`);
    const entry=await entryAt(objects,head.tree,path);
    if(!entry||!["100644","100755"].includes(entry.mode))throw Error(`${path}: suggestions require a regular text file`);
    const bytes=await objects.body(entry.sha,"blob");
    if(bytes.length>1024*1024)throw Error(`${path}: suggestion file exceeds 1 MiB`);
    let text=blobText(bytes);if(text===null)throw Error(`${path}: binary or invalid UTF-8 content`);
    for(const comment of [...selected].reverse())text=replaceSuggestion(text,comment.startLine,comment.line,suggestionText(comment.body)!.lines);
    const body=new TextEncoder().encode(text);if(body.length>1024*1024)throw Error(`${path}: suggested result exceeds 1 MiB`);
    const blob=encode("blob",body);made.push(blob);patches.set(path,{...entry,sha:blob.sha});
  }
  async function rebuild(root:string,prefix:string,depth=0):Promise<string> {
    if(depth>100)throw Error("Suggestion tree depth limit exceeded");
    const entries=readTree(await objects.body(root,"tree"));
    for(let i=0;i<entries.length;i++) {
      const path=prefix+entries[i].name,replace=patches.get(path);
      if(replace)entries[i]=replace;
      else if(isDir(entries[i])&&[...patches.keys()].some(changed=>changed.startsWith(path+"/")))entries[i]={...entries[i],sha:await rebuild(entries[i].sha,path+"/",depth+1)};
    }
    const result=tree(entries);made.push(result);return result.sha;
  }
  const root=await rebuild(head.tree,"");
  const signature=(person:Owner)=>({name:person.name.replace(/[\r\n<>]/g," "),email:`${person.id.replace(/[^a-zA-Z0-9.-]/g,"-")}@nanohub.invalid`,time:Math.floor(Date.now()/1000)});
  const coauthors=[...new Map(comments.map(comment=>[comment.author.id,comment.author])).values()].filter(person=>person.id!==actor.id);
  const trailers=coauthors.map(person=>{const identity=signature(person);return `Co-authored-by: ${identity.name} <${identity.email}>`;});
  const result=commit({tree:root,parents:[head.commit],author:signature(actor),committer:signature(actor),message:message+(trailers.length?"\n\n"+trailers.join("\n"):"")});made.push(result);
  return {commit:result.sha,tree:root,objects:made};
}
