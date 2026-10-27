import type { RuleAttempt, RuleSource, RuleSuite, RuleSuitePage, RuleSuiteQuery, RuleOutcome } from "./insight-types";
import { refName } from "./store";

const outcome=(attempt:RuleAttempt):RuleOutcome =>
  ["error","fail","bypass","pass"].find(result=>attempt.evaluations.some(r=>r.result===result)) as RuleOutcome ?? "pass";

/** Separate from accepted-write audit: rejected transaction observations are
 * persisted only after its rollback. No ref or review is committed with them. */
export class RuleInsights {
  constructor(private sql:SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS repository_rule_suites (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, data TEXT NOT NULL)");
  }
  record(attempts:RuleAttempt[],source:RuleSource,accepted:boolean,rejection?:string) {
    const applicable=attempts.filter(attempt=>attempt.evaluations.length);
    if(!applicable.length)return;
    const batch=crypto.randomUUID(),at=Date.now();
    for(const attempt of applicable) {
      const value={...attempt,batch,at,source,accepted,result:outcome(attempt),...(!accepted?{rejection:(rejection??"Ref transaction rejected").slice(0,512)}:{})};
      this.sql.exec("INSERT INTO repository_rule_suites(at,data) VALUES (?,?)",at,JSON.stringify(value));
    }
    // Retain at most 30 days, 2000 observations and 32 MiB. The largest newest
    // observation is under 2 MiB under the rule/ref batch bounds.
    this.sql.exec("DELETE FROM repository_rule_suites WHERE at < ?",at-30*24*60*60*1000);
    this.sql.exec("DELETE FROM repository_rule_suites WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY id DESC) AS n, SUM(length(CAST(data AS BLOB))) OVER (ORDER BY id DESC) AS bytes FROM repository_rule_suites) WHERE n > 2000 OR bytes > 33554432)");
  }
  list(query:RuleSuiteQuery={}):RuleSuitePage {
    const {before,limit=25,ref,actor,ruleset,result,from,to}=query;
    const positive=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>0;
    if(!positive(limit)||limit>100||[before,ruleset,from,to].some(v=>v!==undefined&&!positive(v))||
      from!==undefined&&to!==undefined&&from>to||result!==undefined&&!["pass","fail","bypass","error"].includes(result)||
      actor!==undefined&&(typeof actor!=="string"||!actor||actor.length>256||/[\0\r\n]/.test(actor)))throw Error("Invalid rule insight filter");
    if(ref!==undefined)refName(ref);
    const clauses:string[]=["at >= ?"],values:(string|number)[]=[Date.now()-30*24*60*60*1000];
    if(before!==undefined){clauses.push("id < ?");values.push(before);}
    if(from!==undefined){clauses.push("at >= ?");values.push(from);}
    if(to!==undefined){clauses.push("at <= ?");values.push(to);}
    for(const [key,value] of [["ref",ref],["actor",actor],["result",result]] as const)if(value!==undefined){clauses.push(`json_extract(data, '$.${key}') = ?`);values.push(value);}
    if(ruleset!==undefined){clauses.push("EXISTS (SELECT 1 FROM json_each(data, '$.evaluations') WHERE json_extract(value, '$.id') = ?)");values.push(ruleset);}
    const rows=this.sql.exec<{id:number;data:string}>(`SELECT id,data FROM repository_rule_suites${clauses.length?` WHERE ${clauses.join(" AND ")}`:""} ORDER BY id DESC LIMIT ?`,...values,limit+1).toArray();
    const suites=rows.slice(0,limit).map(row=>({...JSON.parse(row.data),id:row.id})) as RuleSuite[];
    return {suites,nextCursor:rows.length>limit?suites.at(-1)!.id:null};
  }
  get(id:number):RuleSuite|null {
    if(!Number.isSafeInteger(id)||id<1)throw Error("Invalid rule suite ID");
    const row=this.sql.exec<{data:string}>("SELECT data FROM repository_rule_suites WHERE id = ? AND at >= ?",id,Date.now()-30*24*60*60*1000).toArray()[0];
    return row?{...JSON.parse(row.data),id}:null;
  }
}

/** Every caller supplies an isolated collector: no module-global request state.
 * Success is atomic with the ref mutation; failure evidence survives rollback. */
export function ruleTransaction<T>(sql:SqlStorage,transaction:<R>(run:()=>R)=>R,source:RuleSource,run:(observe:(attempt:RuleAttempt)=>void)=>T):T {
  const attempts:RuleAttempt[]=[];
  // Construct the table before a transaction that may roll its DDL back.
  const insights=new RuleInsights(sql);
  try {
    return transaction(()=>{
      const result=run(attempt=>attempts.push(attempt));
      insights.record(attempts,source,true);
      return result;
    });
  }catch(error){
    transaction(()=>insights.record(attempts,source,false,(error as Error).message));
    throw error;
  }
}
