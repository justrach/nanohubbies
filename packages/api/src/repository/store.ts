import {assertRepositoryWritable} from "./archive";
import {currentRulesetActor,type RulesetActor} from './bypass';
import type { RefProof } from "./types";
import type { RuleObserver } from "./insight-types";
import type { Head } from "../types";
import { branchName } from "../review/types";
import { Policies } from "./policy";
import { CIStore } from "../ci/store";
import { Rulesets } from "./rulesets";
import {branchFingerprint} from "../signing/ref-proof";
import { repositoryActivity } from "./activity";
import { refName, newRefName } from "./ref-name";
export { refName } from "./ref-name";
import { dismissAfterHeadChange } from "../review/stale";
import {defaultBranch,defaultRef} from "./default-branch";

export interface GitRef { name: string; commit: string; tree: string; updatedAt: number }
export class Repository {
  constructor(private sql: SqlStorage, private observe?:RuleObserver,private authority?:RulesetActor) {
    sql.exec("CREATE TABLE IF NOT EXISTS repository_config (id INTEGER PRIMARY KEY CHECK(id=1), default_branch TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS repository_settings_revision (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL)");
    sql.exec("INSERT OR IGNORE INTO repository_settings_revision VALUES (1,0)");
    new Rulesets(sql);
    const installed=sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name IN ('repository_default_revision_update','repository_default_revision_delete','repository_default_revision_insert')").toArray()[0].n;
    if(installed!==3){
      if(sql.exec("SELECT 1 FROM repository_config").toArray().length) {
        sql.exec("UPDATE repository_settings_revision SET revision=revision+1 WHERE id=1");
        new Rulesets(sql).invalidate();
      }
      const bump="UPDATE repository_settings_revision SET revision=revision+1 WHERE id=1; UPDATE repository_rules_revision SET revision=revision+1 WHERE id=1;";
      sql.exec(`CREATE TRIGGER IF NOT EXISTS repository_default_revision_update AFTER UPDATE OF default_branch ON repository_config WHEN OLD.default_branch IS NOT NEW.default_branch BEGIN ${bump} END`);
      sql.exec(`CREATE TRIGGER IF NOT EXISTS repository_default_revision_delete AFTER DELETE ON repository_config BEGIN ${bump} END`);
      sql.exec(`CREATE TRIGGER IF NOT EXISTS repository_default_revision_insert AFTER INSERT ON repository_config WHEN (SELECT revision FROM repository_settings_revision WHERE id=1)>0 BEGIN ${bump} END`);
    }
    sql.exec("CREATE TABLE IF NOT EXISTS repository_refs (name TEXT PRIMARY KEY, commit_sha TEXT NOT NULL, tree_sha TEXT NOT NULL, updated_at INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS repository_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)");
    sql.exec("CREATE INDEX IF NOT EXISTS repository_audit_ref ON repository_audit(json_extract(data, '$.ref'))");
  }
  mode() { return !!this.sql.exec("SELECT 1 FROM repository_config").toArray().length; }
  initialize(defaultBranch = "main") {
    branchName(defaultBranch);
    newRefName(`refs/heads/${defaultBranch}`);
    if (this.mode() || this.sql.exec("SELECT 1 FROM versions LIMIT 1").toArray().length) throw new Error("Workspace already initialized");
    this.sql.exec("INSERT INTO repository_config VALUES (1, ?)", defaultBranch);
  }
  refs(): GitRef[] { return this.sql.exec<{ name: string; commit_sha: string; tree_sha: string; updated_at: number }>("SELECT * FROM repository_refs ORDER BY name").toArray().map(r => ({ name: r.name, commit: r.commit_sha, tree: r.tree_sha, updatedAt: r.updated_at })); }
  defaultBranch(){return defaultBranch(this.sql);}
  configuration(){return {defaultBranch:this.defaultBranch(),revision:this.sql.exec<{revision:number}>("SELECT revision FROM repository_settings_revision WHERE id=1").toArray()[0].revision};}
  selectDefault(name:string,commit:string,revision:number,actor:string,via?:{kind:"cli";credentialId:string}) {
    assertRepositoryWritable(this.sql);
    if(!this.mode())throw Error("Default branch selection requires Git repository mode");
    branchName(name);
    if(!Number.isSafeInteger(revision)||revision<0||!/^[a-f0-9]{40}$/.test(commit))throw Error("Choose the observed branch commit and settings revision");
    const current=this.configuration();
    if(current.revision!==revision)return {conflict:true as const,...current};
    const ref=this.refs().find(r=>r.name===`refs/heads/${name}`);
    if(!ref||ref.commit!==commit)throw Error("Selected branch changed or is unavailable; reload before changing the default");
    if(name===current.defaultBranch)return current;
    this.sql.exec("UPDATE repository_config SET default_branch=? WHERE id=1",name);
    // ~DEFAULT_BRANCH changes rule targeting without changing any ref. Fence
    // proofs built under the previous selection before a ref can move.
    this.recordDefaultHead(ref);
    this.audit({actor,defaultBranch:{previous:current.defaultBranch,next:name,commit,revision:this.configuration().revision},...(via?{via}:{})});
    return this.configuration();
  }
  private recordDefaultHead(ref:{commit:string;tree:string}) {
    const version=(this.sql.exec<{v:number|null}>("SELECT MAX(version) AS v FROM versions").toArray()[0]?.v??0)+1;
    this.sql.exec("INSERT INTO versions VALUES (?, ?, ?)",version,ref.commit,ref.tree);
    new CIStore(this.sql).baseMoved(ref.commit);
  }
  main(): Head {
    const ref = this.refs().find(r => r.name === defaultRef(this.sql));
    if (!ref) throw new Error(`Repository is empty; push ${this.defaultBranch()} first`);
    const version = this.sql.exec<{ v: number }>("SELECT MAX(version) AS v FROM versions").toArray()[0]?.v ?? 0;
    return { version, commit: ref.commit, tree: ref.tree };
  }
  update(name: string, old: string | null, next: { commit: string; tree: string } | null, fastForward: boolean, actor: string, merge = false, proof?:RefProof, human = false,branchContext?:string,deploymentBase?:string|null) {
    if(this.authority&&(!currentRulesetActor(this.authority,actor)||!['owner','admin','writer'].includes(this.authority.role??'')))throw Error('Current repository write membership is required; refresh and retry');
    assertRepositoryWritable(this.sql);
    if (!this.mode()) throw new Error("This workspace uses text snapshot mode");
    refName(name);
    const current = this.refs().find(r => r.name === name);
    if ((current?.commit ?? null) !== old) throw new Error("Ref changed; fetch and retry");
    if (!old && next) newRefName(name);
    if (next && !old && this.refs().some(r => r.name.startsWith(name + "/") || name.startsWith(r.name + "/"))) throw new Error("Conflicting ref name");
    if (next && !old && this.refs().length >= 10_000) throw new Error("Repository ref limit reached");
    const bypassedRulesets = new Rulesets(this.sql).enforce(name,old,next?.commit??null,fastForward,actor,human,merge,proof,branchContext??branchFingerprint(this.refs()),this.observe,deploymentBase,this.authority);
    const branch = name.startsWith("refs/heads/") ? name.slice(11) : null;
    if(branch){
      const policies=new Policies(this.sql);
      if(merge)policies.restrictions(branch,actor,!next,old,next?.commit??null,proof,deploymentBase);
      else policies.direct(branch,!next,!old||fastForward,actor,old,next?.commit??null,proof,deploymentBase);
    }
    if (!next && name === defaultRef(this.sql)) throw new Error(`${this.defaultBranch()} is the default branch and cannot be deleted`);
    if (!next && branch && this.sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='review_pulls'").toArray().length) {
      const open = this.sql.exec<{ data: string }>("SELECT data FROM review_pulls").toArray().some(r => {
        const p = JSON.parse(r.data);
        return p.state === "open" && (p.head === branch || p.base === branch);
      });
      if (open) throw new Error("Close or merge open PRs before deleting their branch");
    }
    if (next) {
      this.sql.exec("INSERT INTO repository_refs VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET commit_sha=excluded.commit_sha, tree_sha=excluded.tree_sha, updated_at=excluded.updated_at", name, next.commit, next.tree, Date.now());
      if (name === defaultRef(this.sql)) this.recordDefaultHead(next);
    } else this.sql.exec("DELETE FROM repository_refs WHERE name = ?", name);
    const reviewable=!!next&&current?.tree!==next.tree;
    this.audit({ actor, ref: name, old, next: next?.commit ?? null, merge, human,...(old&&next&&old!==next.commit&&!fastForward?{force:true}:{}), ...(branch?{reviewable}:{}), ...(bypassedRulesets.length?{bypassedRulesets,...(this.authority?{bypassRole:{role:this.authority.role,checkedAt:this.authority.checkedAt}}:{})}:{}) });
    if(branch&&next&&reviewable)dismissAfterHeadChange(this.sql,branch,next,event=>this.audit(event));
    if (branch && next) {
      const base = this.refs().find(r => r.name === defaultRef(this.sql));
      if (base) new CIStore(this.sql).enqueue(branch, next.commit, base.commit,actor);
    }
    if (branch) new CIStore(this.sql).supersede(branch, next?.commit ?? null);
    else {
      const ci=new CIStore(this.sql),base=this.refs().find(r=>r.name===defaultRef(this.sql));
      if(next&&base&&proof?.old===old&&proof.next===next.commit&&/^[a-f0-9]{40}$/.test(proof.peeledCommit??''))ci.enqueue(name.slice(10),proof!.peeledCommit!,base.commit,actor,{ref:name,target:next.commit});
      ci.supersedeRef(name,next?.commit??null);
    }
    return this.refs();
  }
  audit(event: Record<string, unknown>) { this.sql.exec("INSERT INTO repository_audit (data) VALUES (?)", JSON.stringify({ ...event, at: Date.now() })); }
  activity(query?: import("./activity-types").ActivityQuery) { return repositoryActivity(this.sql, query); }
}
