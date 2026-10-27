export interface CodeAnchor {
  path: string;
  side: "LEFT" | "RIGHT";
  startLine: number;
  line: number;
}
export interface CodeComment extends CodeAnchor {
  id: string;
  commit: string;
  author: { id: string; name: string };
  body: string;
  at: number;
  replyTo: string | null;
  resolved: boolean;
  via?:{kind:"cli";credentialId:string};
  applied?:{applicationId:string;commit:string;actor:{id:string;name:string};at:number};
}
export interface CommentList {
  comments: CodeComment[];
  truncated: boolean;
}
export interface IssueWork {
  agent: string;
  owner: string | null;
  change: string;
  version: number | null;
  outcome: string;
  at: number;
}
