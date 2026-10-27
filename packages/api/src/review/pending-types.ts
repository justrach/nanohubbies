import type { Owner } from "../types";
import type { PullComment } from "./pull-comment-types";

export interface PendingReview {
  id: string; pull: number; author: Owner; commit: string; anchor: string;
  revision: number; comments: PullComment[]; createdAt: number; updatedAt: number;
}
export type PendingResult = { pending: PendingReview | null };
