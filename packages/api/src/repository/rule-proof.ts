import { readTree, isDir } from "../git";
import type { StoredObject } from "../objects";
import { commitAt } from "../review/graph";
import { refProof } from "./validate";
import { matchesGlob } from "./pattern";
import { applies } from "./rulesets";
import { isMetadataRule, metadataMatcher } from "./metadata-pattern";
import type { RefProof } from "./types";
import type { RulesetPlan, PushRule } from "./rulesets";
import {signedHistory,type GraphPlan} from "../signing/ref-proof";
import type {SignatureResult} from "../signing/types";
import {matchesBranch} from "./pattern";

/** Trusted object-derived evidence. Every introduced commit is inspected,
 * including intermediate add/delete pairs and side parents of merges.
 * No caller-supplied verdicts are accepted by the HTTP routes. */
async function graphProof(get: (sha: string) => Promise<StoredObject | null>, old: string | null, next: string, plan: GraphPlan, ref?: string,verifySignature?:(sha:string,raw:Uint8Array)=>Promise<SignatureResult>): Promise<RefProof> {
  let reads = 0, bytes = 0, entries = 0, matchWork = 0;
  const match = (pattern: string, path: string) => {
    matchWork += pattern.length * path.length;
    if (matchWork > 20_000_000) throw Error("Push-rule pattern evaluation limit exceeded");
    return matchesGlob(pattern,path);
  };
  const body = async (sha: string) => {
    const obj = await get(sha);
    if (!obj) throw Error("Missing object while checking push rules");
    if (++reads > 200_000 || (bytes += obj.body.length) > 2 ** 31) throw Error("Push-rule graph traversal limit exceeded");
    return obj;
  };
  const peel = async (sha: string) => {
    const seen = new Set<string>();
    for (;;) {
      if (seen.has(sha) || seen.size >= 100) throw Error("Tag traversal limit exceeded");
      seen.add(sha);
      const obj = await body(sha);
      if (obj.type !== "tag") return { sha, obj };
      const target = /^object ([a-f0-9]{40})$/m.exec(new TextDecoder().decode(obj.body).split("\n\n")[0])?.[1];
      if (!target) throw Error("Malformed annotated tag");
      sha = target;
    }
  };
  const root = await peel(next), previous = old ? await peel(old) : null;
  const proof: RefProof = root.obj.type === "commit" ?
    { ...await refProof(body, previous?.obj.type === "commit" ? previous.sha : null, root.sha), old, next } : { old, next, linear: true };
  if(ref?.startsWith('refs/tags/')&&root.obj.type==='commit')proof.peeledCommit=root.sha;
  const pushSets = plan.rulesets.filter(r => r.enforcement === "active" && r.target === "push" && r.rules.length);
  const metadataSets=plan.rulesets.filter(r=>r.enforcement==="active"&&r.target!=="push"&&(!ref||applies(r,ref,plan.defaultBranch))&&r.rules.some(rule=>isMetadataRule(rule)&&rule.type!=="branch_name_pattern"&&rule.type!=="tag_name_pattern"));
  const sets=[...pushSets,...metadataSets],metadataMatches=metadataMatcher();
  proof.rules = { fileTransitions:true,revision: plan.revision, ...(ref?{ref}:{}), violations: [] };
  const signatureRules=plan.rulesets.some(rule=>rule.enforcement==="active"&&rule.target!=="push"&&(!ref||applies(rule,ref,plan.defaultBranch))&&rule.rules.some(r=>r.type==="required_signatures"));
  const classicSignatures=!!old&&ref?.startsWith("refs/heads/")&&plan.signing?.policies.some(policy=>policy.requireSignedCommits&&matchesBranch(policy.branch,ref.slice(11)));
  if(signatureRules||classicSignatures) {
    proof.signatures=root.obj.type!=="commit"?{verified:false,checked:0,reason:"signature rules require a ref pointing to a commit"}:await signedHistory(body,previous?.obj.type==="commit"?previous.sha:null,root.sha,!old&&ref?.startsWith("refs/heads/")?plan.signing?.branches:undefined,verifySignature??(async()=>({verified:false,reason:"Account signing-key verification is unavailable"})));
  }
  if (!sets.length) return proof;
  const failed = new Set<number>(), sizes = new Map<string, number>();
  const file = async (path: string | null, sha: string | null) => {
    if (++entries > 200_000) throw Error("Push-rule path traversal limit exceeded");
    for (const set of pushSets) {
      if (failed.has(set.id)) continue;
      let reason: string | undefined;
      for (const rule of set.rules as PushRule[]) {
        // An exception is local to this rule. It cannot waive another file
        // rule or an overlapping ruleset, and a raw blob has no allowed path.
        if (path !== null && (rule.type === "file_path_restriction" || rule.type === "max_file_size") &&
          rule.parameters.allowed_file_paths?.some(p => match(p,path))) continue;
        if (path === null && rule.type !== "max_file_size") reason = "path rules cannot verify a tag pointing directly to a blob";
        else if (rule.type === "file_path_restriction" && rule.parameters.restricted_file_paths.some(p => match(p, path!))) reason = `restricted file path: ${path}`;
        else if (rule.type === "file_extension_restriction" && rule.parameters.restricted_file_extensions.some(e => path!.endsWith(e))) reason = `restricted file extension: ${path}`;
        else if (rule.type === "max_file_path_length" && Array.from(path!).length > rule.parameters.max_file_path_length) reason = `file path exceeds ${rule.parameters.max_file_path_length} characters: ${path}`;
        else if (rule.type === "max_file_size" && sha) {
          let size = sizes.get(sha);
          if (size === undefined) {
            const obj = await body(sha);
            if (obj.type !== "blob") throw Error("Expected file blob while checking push rules");
            size = obj.body.length; sizes.set(sha, size);
          }
          if (size > rule.parameters.max_file_size * 1024 * 1024) reason = `file exceeds ${rule.parameters.max_file_size} MiB: ${path ?? sha}`;
        }
        if (reason) break;
      }
      if (reason) { failed.add(set.id); proof.rules!.violations.push({ rulesetId: set.id, message: reason }); }
    }
  };
  const diff = async (a: string | null, b: string | null, prefix = "", depth = 0): Promise<void> => {
    if (a === b || pushSets.every(set=>failed.has(set.id))) return;
    if (depth > 100) throw Error("Push-rule directory depth exceeded");
    const tree = async (sha: string | null) => {
      if (!sha) return new Map();
      const obj = await body(sha);
      if (obj.type !== "tree") throw Error("Expected tree while checking push rules");
      return new Map(readTree(obj.body).map(e => [e.name, e]));
    };
    const left = await tree(a), right = await tree(b);
    for (const name of new Set<string>([...left.keys(), ...right.keys()])) {
      if (++entries > 200_000) throw Error("Push-rule path traversal limit exceeded");
      const x = left.get(name), y = right.get(name);
      if (x?.sha === y?.sha && x?.mode === y?.mode) continue;
      const path = prefix + name, xDir = !!x && isDir(x), yDir = !!y && isDir(y);
      if (xDir || yDir) await diff(xDir ? x.sha : null, yDir ? y.sha : null, path + "/", depth + 1);
      if ((x && !xDir) || (y && !yDir)) await file(path, y && !yDir ? y.sha : null);
    }
  };
  if(root.obj.type!=="commit")for(const set of metadataSets){failed.add(set.id);proof.rules.violations.push({rulesetId:set.id,message:"commit metadata requires a tag pointing to a commit"});}
  if (root.obj.type === "tree") await diff(previous?.obj.type === "tree" ? previous.sha : null, root.sha);
  else if (root.obj.type === "blob") {if(pushSets.length)await file(null, root.sha);}
  else {
    const known = new Set<string>(), before = previous?.obj.type === "commit" ? [previous.sha] : [];
    const commit = async (sha: string) => {
      const obj = await body(sha);
      if (obj.type !== "commit") throw Error("Missing commit while checking push rules");
      return {...await commitAt({ body: async () => obj.body }, sha),raw:obj.body};
    };
    // A rewind or a descendant of an older ancestor can restore a restricted
    // file without introducing a commit that changes it. Inspect the actual
    // ref tree transition as well as every introduced commit below.
    if(pushSets.length&&previous?.obj.type==="commit")await diff((await commit(previous.sha)).tree,(await commit(root.sha)).tree);
    for (let i = 0; i < before.length; i++) {
      const sha = before[i];
      if (known.has(sha)) continue;
      if (known.size >= 100_000) throw Error("Push-rule commit limit exceeded");
      known.add(sha); before.push(...(await commit(sha)).parents);
    }
    const seen = new Set<string>(), queue = [root.sha];
    for (let i = 0; i < queue.length && failed.size < sets.length; i++) {
      const sha = queue[i];
      if (known.has(sha) || seen.has(sha)) continue;
      if (seen.size >= 100_000) throw Error("Push-rule commit limit exceeded");
      seen.add(sha);
      const c = await commit(sha);
      if(metadataSets.some(set=>!failed.has(set.id))) {
        let raw: string|null=null;
        try{raw=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(c.raw);}catch{/* Required metadata fails explicitly below. */}
        const split=raw?.indexOf("\n\n")??-1,header=raw?.slice(0,split).split("\n")??[];
        const email=(field:string)=>{
          const lines=header.filter(line=>line.startsWith(field+" "));
          return lines.length===1?/^[^<>\n]* <([^<>\n]+)> -?\d+ [+-]\d{4}$/.exec(lines[0].slice(field.length+1))?.[1]??null:null;
        };
        for(const set of metadataSets) {
          if(failed.has(set.id))continue;
          for(const rule of set.rules) {
            if(!isMetadataRule(rule)||rule.type==="branch_name_pattern"||rule.type==="tag_name_pattern")continue;
            const value=raw===null||split<0?null:rule.type==="commit_message_pattern"?raw.slice(split+2):email(rule.type==="commit_author_email_pattern"?"author":"committer");
            if(value===null||!metadataMatches(rule.parameters,value)) {
              failed.add(set.id);proof.rules.violations.push({rulesetId:set.id,message:`${rule.parameters.name??rule.type}: commit ${sha.slice(0,12)} ${value===null?"has unverifiable metadata":"does not satisfy the pattern"}`});break;
            }
          }
        }
      }
      if(pushSets.some(set=>!failed.has(set.id))) {
        if (!c.parents.length) await diff(null, c.tree);
        for (const p of c.parents) await diff((await commit(p)).tree, c.tree);
      }
      queue.push(...c.parents);
    }
  }
  return proof;
}

/** Active policy evidence is computed first. Observation-only policies have a
 * separate work budget and cannot supply evidence for an active restriction. */
export async function repositoryProof(get:(sha:string)=>Promise<StoredObject|null>,old:string|null,next:string,plan:GraphPlan,ref?:string,verifySignature?:(sha:string,raw:Uint8Array)=>Promise<SignatureResult>):Promise<RefProof> {
  const proof=await graphProof(get,old,next,{...plan,rulesets:plan.rulesets.filter(r=>r.enforcement==="active")},ref,verifySignature);
  const evaluating=plan.rulesets.filter(r=>r.enforcement==="evaluate");
  if(evaluating.length) {
    try {
      const observation=await graphProof(get,old,next,{...plan,rulesets:evaluating.map(r=>({...r,enforcement:"active"})),signing:plan.signing?{...plan.signing,policies:[]}:undefined},ref,verifySignature);
      proof.evaluation={rules:observation.rules!,signatures:observation.signatures};
    }catch(error){proof.evaluation={rules:{revision:plan.revision,...(ref?{ref}:{}),violations:[]},error:((error as Error).message||"Evaluation unavailable").slice(0,256)};}
  }
  return proof;
}
