import { readTree, isDir } from "../git";
import { entryAt, type Objects } from "../trees";
import type { Branch } from "../review/types";
import type { CodeOwnerEvidence, CodeOwnerGroup, CodeOwnerStatus } from "./codeowner-types";

type Token = string | { kind: "star" | "deep" | "dirs" | "one" };
export interface CodeOwnerRule { line: number; pattern: string; owners: string[] }
const ownerToken = /^(?:@[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?(?:\/[a-z0-9._-]+)?|[^\s@]+@[^\s@]+\.[^\s@]+)$/i;

function compile(raw: string) {
  if (!raw || raw.length > 4096 || raw.startsWith("!") || raw.startsWith("\\#") || /[\0\r\n]/.test(raw)) throw Error("Invalid CODEOWNERS pattern");
  const anchored = raw.startsWith("/"), directory = raw.endsWith("/");
  const pattern = raw.slice(anchored ? 1 : 0, directory ? -1 : undefined);
  if (!pattern) throw Error("Empty CODEOWNERS pattern");
  const tokens: Token[] = [], chars = Array.from(pattern);
  let literalLast = true;
  for (let i=0;i<chars.length;i++) {
    const c=chars[i];
    if(c==="/") { tokens.push(c);literalLast=true; }
    else if(c==="\\") { if(!chars[i+1])throw Error("Incomplete pattern escape");tokens.push(chars[++i]); }
    else if(c==="["||c==="]") throw Error("Character ranges are not supported in CODEOWNERS");
    else if(c==="*") {
      literalLast=false;
      let end=i;while(chars[end+1]==="*")end++;
      const deep=end===i+1 && (i===0||chars[i-1]==="/") && (end===chars.length-1||chars[end+1]==="/");
      i=end;
      if(deep&&chars[i+1]==="/") { i++;tokens.push({kind:"dirs"});literalLast=true; }
      else tokens.push({kind:deep?"deep":"star"});
    } else if(c==="?") { literalLast=false;tokens.push({kind:"one"}); }
    else tokens.push(c);
  }
  const slash=pattern.includes("/");
  return {tokens,anchored,directory,slash,literalLast};
}
function glob(tokens: Token[], value: string) {
  const chars=Array.from(value);let prev=new Uint8Array(chars.length+1);prev[0]=1;
  for(const token of tokens) {
    const row=new Uint8Array(chars.length+1);
    if(typeof token!=="string"&&token.kind!=="one") {
      row[0]=prev[0];let prefix=!!prev[0];
      for(let j=1;j<=chars.length;j++) {
        row[j]=Number(!!prev[j]||(token.kind==="dirs"?prefix&&chars[j-1]==="/":!!row[j-1]&&(token.kind==="deep"||chars[j-1]!=="/")));
        prefix ||= !!prev[j];
      }
    } else for(let j=1;j<=chars.length;j++)row[j]=Number(!!prev[j-1]&&(typeof token==="string"?token===chars[j-1]:chars[j-1]!=="/"));
    prev=row;
  }
  return !!prev[chars.length];
}
export function codeOwnerPattern(pattern: string, path: string, charge: (work:number)=>void = ()=>{}) {
  const p=compile(pattern),parts=path.split("/");
  const match=(value:string)=>{charge(pattern.length*value.length);return glob(p.tokens,value);};
  if(!p.slash&&!p.anchored) {
    if(!p.directory&&match(parts.at(-1)!))return true;
    return (p.directory||p.literalLast)&&parts.slice(0,-1).some(match);
  }
  if(!p.directory&&match(path))return true;
  if(p.directory||p.literalLast)for(let i=1;i<parts.length;i++)if(match(parts.slice(0,i).join("/")))return true;
  return false;
}

export function parseCodeOwners(text: string) {
  const rules: CodeOwnerRule[]=[],warnings: CodeOwnerEvidence["warnings"]=[];
  for(const [index,line] of text.split(/\r?\n/).entries()) {
    const value=line.trim();if(!value||value.startsWith("#"))continue;
    try {
      let end=0;
      while(end<value.length) { if(value[end]==="\\") {end+=2;continue;}if(/\s/.test(value[end]))break;end++; }
      const pattern=value.slice(0,end);compile(pattern);
      const owners:string[]=[];
      for(const token of value.slice(end).trim().split(/\s+/).filter(Boolean)) {
        if(token.startsWith("#"))break;
        if(!ownerToken.test(token))throw Error("Invalid owner; use @handle, @organization/team or an email address");
        owners.push(token);
      }
      if(owners.length>100)throw Error("At most 100 owners on one pattern");
      rules.push({line:index+1,pattern,owners:[...new Set(owners)]});
    } catch(error) { if(warnings.length<50)warnings.push({line:index+1,message:(error as Error).message}); }
  }
  return {rules,warnings};
}

/** Evaluate the full changed-path set, not the truncated UI diff. Renames,
 * deletions, binary files and mode changes all retain ownership requirements. */
export async function codeOwnerEvidence(objects: Objects, base: Branch, head: Branch): Promise<CodeOwnerEvidence> {
  const result: CodeOwnerEvidence={base:base.commit,head:head.commit,file:null,groups:[],warnings:[]};
  try {
    let content: Uint8Array | null=null;
    for(const path of [".github/CODEOWNERS","CODEOWNERS","docs/CODEOWNERS"]) {
      const entry=await entryAt(objects,base.tree,path);
      if(!entry)continue;
      result.file=path;
      if(!["100644","100755"].includes(entry.mode))throw Error("CODEOWNERS must be a regular file");
      content=await objects.body(entry.sha,"blob");break;
    }
    if(!content)return result;
    if(content.length>=3*1024*1024) {result.warnings.push({line:0,message:"CODEOWNERS is 3 MiB or larger and is not loaded"});return result;}
    if(content.includes(0))throw Error("CODEOWNERS contains binary data");
    const parsed=parseCodeOwners(new TextDecoder("utf-8",{fatal:true,ignoreBOM:false}).decode(content));result.warnings=parsed.warnings;
    if(!parsed.rules.length)return result;
    let entries=0,work=0;
    const groups=new Map<number,CodeOwnerGroup>();
    const inspect=(path:string)=>{
      for(let i=parsed.rules.length-1;i>=0;i--) {
        const rule=parsed.rules[i];
        // Charge unmatched rules too, so a very large file cannot evade limits.
        if((work+=rule.pattern.length)>20_000_000)throw Error("CODEOWNERS pattern evaluation limit exceeded");
        if(!codeOwnerPattern(rule.pattern,path,n=>{if((work+=n)>20_000_000)throw Error("CODEOWNERS pattern evaluation limit exceeded");}))continue;
        if(!rule.owners.length)return;
        let group=groups.get(rule.line);
        if(!group) {
          if(groups.size>=1000)throw Error("CODEOWNERS matched-pattern limit exceeded");
          group={...rule,paths:[],files:0};groups.set(rule.line,group);
        }
        group.files++;if(group.paths.length<3)group.paths.push(path);
        return;
      }
    };
    const diff=async(a:string|null,b:string|null,prefix="",depth=0):Promise<void>=>{
      if(a===b)return;
      if(depth>100)throw Error("CODEOWNERS tree depth limit exceeded");
      const tree=async(sha:string|null)=>new Map(sha?readTree(await objects.body(sha,"tree")).map(e=>[e.name,e]):[]);
      const left=await tree(a),right=await tree(b);
      for(const name of new Set([...left.keys(),...right.keys()])) {
        if(++entries>200_000)throw Error("CODEOWNERS changed-path traversal limit exceeded");
        const x=left.get(name),y=right.get(name);
        if(x?.sha===y?.sha&&x?.mode===y?.mode)continue;
        const xd=!!x&&isDir(x),yd=!!y&&isDir(y),path=prefix+name;
        if(xd||yd)await diff(xd?x!.sha:null,yd?y!.sha:null,path+"/",depth+1);
        if(x&&!xd||y&&!yd)inspect(path);
      }
    };
    await diff(base.tree,head.tree);result.groups=[...groups.values()];
  } catch(error) {result.error=(error as Error).message;result.groups=[];}
  return result;
}

export function codeOwnerDecision(evidence: CodeOwnerEvidence, accounts: Record<string,string|null>, approvals: string[], required: boolean): CodeOwnerStatus {
  const warnings=[...evidence.warnings];let missing=0;
  const groups=evidence.groups.map(group=>{
    const eligibleOwners=group.owners.filter(owner=>!!accounts[owner]);
    const unsupported=group.owners.filter(owner=>!/^@[a-z0-9-]+$/i.test(owner));
    const approved=eligibleOwners.some(owner=>approvals.includes(accounts[owner]!));
    for(const owner of group.owners.filter(owner=>!accounts[owner]))if(warnings.length<50)
      warnings.push({line:group.line,message:unsupported.includes(owner)?`${owner}: team/email ownership is not mapped on this host`:`${owner}: no account with current repository write access`});
    // Unknown individual handles are unassigned, as on GitHub. An unsupported
    // owner kind must not silently turn an otherwise-owned path into no gate.
    const satisfied=approved||(!eligibleOwners.length&&!unsupported.length);
    if(!satisfied)missing++;
    return {...group,eligibleOwners,approved:satisfied};
  });
  return {...evidence,required,groups,warnings,missing};
}
