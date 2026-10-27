import type { CodeComment } from "./comment-types";

export interface PullComment extends CodeComment {
  pull: number;
  anchor: string;
  /** Server-derived excerpt from the original reviewed diff. */
  excerpt: string;
  reviewId?: number;
  via?: {kind:"cli";credentialId:string};
}
export interface PullDiscussion { comments: PullComment[]; truncated: boolean; canComment?: boolean }
