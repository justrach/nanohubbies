import {assertRepositoryWritable} from "../repository/archive";
import type {RulesetActor} from '../repository/bypass';
import type { RuleObserver } from "../repository/insight-types";
import { ReviewStore } from "./store";
import type { PullComment } from "./pull-comment-types";
import type { SuggestionApplication } from "./suggestion-types";
import type { RefProof } from "../repository/types";
import type { Head,Owner } from "../types";
import { suggestionText } from "./suggestion-text";

export interface ApplySuggestions {
  id:string; number:number; commit:string; anchor:string; commentIds:string[]; message:string;
  actor:Owner; origin:string; comments:PullComment[]; next:{commit:string;tree:string}; proof?:RefProof;
}
export class SuggestionApplications {
  constructor(private sql:SqlStorage,private observe?:RuleObserver,private authority?:RulesetActor) {sql.exec("CREATE TABLE IF NOT EXISTS review_suggestion_applications (id TEXT PRIMARY KEY, pull INTEGER NOT NULL, data TEXT NOT NULL)");}
  existing(c:Pick<ApplySuggestions,"id"|"number"|"commit"|"anchor"|"commentIds"|"message"|"actor">):SuggestionApplication|null {
    const row=this.sql.exec<{pull:number;data:string}>("SELECT pull,data FROM review_suggestion_applications WHERE id = ?",c.id).toArray()[0];
    if(!row)return null;
    const saved:SuggestionApplication=JSON.parse(row.data);
    if(row.pull!==c.number||saved.actor.id!==c.actor.id||saved.previousCommit!==c.commit||saved.anchor!==c.anchor||saved.message!==c.message||JSON.stringify(saved.commentIds)!==JSON.stringify([...c.commentIds].sort()))throw Error("Suggestion request id already used");
    return saved;
  }
  run(c:ApplySuggestions,main:()=>Head,git:boolean):SuggestionApplication {
    assertRepositoryWritable(this.sql);
    const prior=this.existing(c);if(prior)return prior;
    if(!/^[a-zA-Z0-9-]{8,80}$/.test(c.id)||![c.commit,c.anchor,c.next.commit,c.next.tree].every(value=>/^[a-f0-9]{40}$/.test(value))||c.next.commit===c.commit||!c.message.trim()||c.message.length>200||/[\r\n\0]/.test(c.message))throw Error("Invalid suggestion application");
    if(!git)throw Error("Applying suggestions requires a Git repository");
    const store=new ReviewStore(this.sql,main,git,undefined,this.observe,this.authority),snapshot=store.snapshot(),pull=snapshot.pulls.find(p=>p.number===c.number),head=pull&&snapshot.branches.find(b=>b.name===pull.head);
    if(!pull||pull.state!=="open")throw Error("This pull request is no longer open");
    if(!head||head.commit!==c.commit||pull.anchor!==c.anchor)throw Error("PR changed; review its latest diff before applying suggestions");
    if(!c.commentIds.length||c.commentIds.length>50||new Set(c.commentIds).size!==c.commentIds.length||c.comments.length!==c.commentIds.length)throw Error("Select 1–50 different suggestions");
    const roots:PullComment[]=[];
    for(const id of c.commentIds) {
      const row=this.sql.exec<{data:string}>("SELECT data FROM pull_comments WHERE id = ? AND pull = ?",id,c.number).toArray()[0],root:PullComment|undefined=row&&JSON.parse(row.data),observed=c.comments.find(comment=>comment.id===id);
      if(!root||!observed||root.replyTo||root.applied||root.commit!==c.commit||root.anchor!==c.anchor||root.side!=="RIGHT"||!suggestionText(root.body))throw Error("Suggestion changed, was applied, or belongs to an earlier diff");
      for(const key of ["body","path","side","startLine","line"] as const)if(root[key]!==observed[key])throw Error("Suggestion changed; refresh before applying it");
      roots.push(root);
    }
    store.run({op:"branch",name:pull.head,old:c.commit,next:c.next,fastForward:true,actor:c.actor.id,human:true,proof:c.proof},()=>{throw Error("Unexpected suggestion landing");});
    const application:SuggestionApplication={id:c.id,pull:c.number,previousCommit:c.commit,anchor:c.anchor,commit:c.next.commit,commentIds:[...c.commentIds].sort(),message:c.message,actor:c.actor,at:Date.now()};
    for(const root of roots)this.sql.exec("UPDATE pull_comments SET data = ? WHERE id = ? AND pull = ?",JSON.stringify({...root,resolved:true,applied:{applicationId:c.id,commit:c.next.commit,actor:c.actor,at:application.at}}),root.id,c.number);
    this.sql.exec("INSERT INTO review_suggestion_applications VALUES (?, ?, ?)",c.id,c.number,JSON.stringify(application));
    return application;
  }
}
