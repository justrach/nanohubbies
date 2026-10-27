import type { Owner } from "../types";
export interface SuggestionApplication {
  id:string; pull:number; previousCommit:string; anchor:string; commit:string;
  commentIds:string[]; message:string; actor:Owner; at:number;
}
