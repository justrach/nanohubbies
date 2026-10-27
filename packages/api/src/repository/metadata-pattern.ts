import { RE2JS, RE2Set } from "re2js";
import type { MetadataParameters, MetadataRule, MetadataRuleType } from "./ruleset-types";

export const metadataRuleTypes: readonly MetadataRuleType[] = ["commit_message_pattern","commit_author_email_pattern","committer_email_pattern","branch_name_pattern","tag_name_pattern"];
export function isMetadataRule(rule: {type:string}): rule is MetadataRule { return metadataRuleTypes.includes(rule.type as MetadataRuleType); }

/** Bound counted-repeat expansion before RE2 compilation allocates a program.
 * This estimates an upper bound; RE2 remains the authority for syntax. */
function regexBudget(pattern: string) {
  let cost=0,last=0;const stack:{cost:number;last:number}[]=[];
  const atom=(size:number)=>{last=size;cost+=size;};
  for(let at=0;at<pattern.length;at++) {
    const c=pattern[at];
    if(c==="\\") {at++;atom(2);}
    else if(c==="[") {
      const start=at;
      for(at++;at<pattern.length;at++){if(pattern[at]==="\\")at++;else if(pattern[at]==="]")break;}
      atom(Math.max(2,at-start));
    } else if(c==="(") {if(stack.length>=64)throw Error("Metadata regex nesting exceeds 64 groups");stack.push({cost,last});cost=0;last=0;}
    else if(c===")"&&stack.length){const group=cost+4,parent=stack.pop()!;cost=parent.cost;last=parent.last;atom(group);}
    else if(c==="{") {
      const match=/^\{(\d+)(?:,(\d*))?\}/.exec(pattern.slice(at));
      if(!match)atom(1);
      else {
        const repeats=Number(match[2]===undefined?match[1]:match[2]||match[1]);
        if(repeats>1000)throw Error("Metadata regex repetitions must be at most 1000");
        cost+=last*Math.max(0,repeats-1)+4;last=last*Math.max(1,repeats)+4;at+=match[0].length-1;
      }
    } else if(c==="*"||c==="+"||c==="?"){cost+=4;last+=4;}
    else if(c==="|"){cost+=2;last=0;}
    else atom(1);
    if(cost+stack.reduce((sum,s)=>sum+s.cost,0)>16384)throw Error("Metadata regex exceeds the compilation budget");
  }
}

export function validateMetadataParameters(value: MetadataParameters): MetadataParameters {
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(k=>!["name","negate","operator","pattern"].includes(k))||
    !["starts_with","ends_with","contains","regex"].includes(value.operator)||typeof value.pattern!=="string"||!value.pattern.length||value.pattern.length>512||value.pattern.includes("\0")||
    value.negate!==undefined&&typeof value.negate!=="boolean"||value.name!==undefined&&(typeof value.name!=="string"||!value.name.trim()||value.name.length>100||/[\0\r\n]/.test(value.name)))
    throw Error("Metadata patterns require a supported operator and 1–512 characters");
  if(value.operator==="regex") {
    regexBudget(value.pattern);
    try {if(RE2JS.compile(value.pattern).programSize()>4096)throw Error("Compiled metadata regex exceeds 4096 instructions");}
    catch(error){throw Error(`Invalid or oversized RE2 pattern: ${(error as Error).message.slice(0,200)}`);}
  }
  return {operator:value.operator,pattern:value.pattern,...(value.name===undefined?{}:{name:value.name.trim()}),...(value.negate===undefined?{}:{negate:value.negate})};
}

/** Per-proof bounded cache: no user pattern creates an unbounded isolate cache. */
export function metadataMatcher() {
  const regexes=new Map<string,{set:RE2Set;cost:number}>();let work=0;
  return (parameters: MetadataParameters, input: string) => {
    const {operator,pattern,negate}=parameters;let matched=false,cost=pattern.length;
    if(operator==="regex") {
      let compiled=regexes.get(pattern);
      if(!compiled) {
        validateMetadataParameters(parameters);
        const set=new RE2Set(RE2Set.UNANCHORED,0,256*1024);set.add(pattern);set.compile();
        compiled={set,cost:RE2JS.compile(pattern).programSize()};regexes.set(pattern,compiled);
        if(regexes.size>8)regexes.delete(regexes.keys().next().value!);
      }
      cost=compiled.cost;
      if((work+=Math.max(1,cost)*Math.max(1,input.length))>20_000_000)throw Error("Metadata pattern evaluation limit exceeded");
      matched=compiled.set.match(input).length>0;
    } else {
      if((work+=Math.max(1,cost)*Math.max(1,input.length))>20_000_000)throw Error("Metadata pattern evaluation limit exceeded");
      matched=operator==="starts_with"?input.startsWith(pattern):operator==="ends_with"?input.endsWith(pattern):input.includes(pattern);
    }
    return negate ? !matched : matched;
  };
}
