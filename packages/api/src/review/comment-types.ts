import type { Owner } from "../types";

export interface CodeAnchor {
  path: string;
  side: "LEFT" | "RIGHT";
  startLine: number;
  line: number;
}
export interface CodeComment extends CodeAnchor {
  id: string;
  commit: string;
  author: Owner;
  body: string;
  at: number;
  replyTo: string | null;
  resolved: boolean;
  applied?:{applicationId:string;commit:string;actor:Owner;at:number};
}
export interface CommentList {
  comments: CodeComment[];
  truncated: boolean;
}
