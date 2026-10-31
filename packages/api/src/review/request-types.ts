import type {Owner} from '../types';
import type {Review} from './types';

export interface ReviewRequest {
  reviewer:string;
  requestedBy:Owner;
  requestedAt:number;
  state:'requested'|'reviewed'|'removed';
  /** Opaque generation identity; callers cannot supply it in an edit. */
  generation?:string;
  via?:Review['via'];
  reviewId?:number;
  answeredAt?:number;
  removedBy?:Owner;
  removedAt?:number;
}
export interface ReviewRequests {
  protocol:1;
  revision:number;
  revisionTracking?:'storage';
  answerTracking?:'storage-v2';
  requests:ReviewRequest[];
  access?:Record<string,import('./reviewer-types').ReviewerStatus>;
  canManage?:boolean;
  candidates?:{id:string;role:string}[];
  directoryComplete?:boolean;
  readOnly?:boolean;
}
export interface ReviewRequestEdit {
  number:number;
  operation:'request'|'remove';
  reviewers:string[];
  revision:number;
  commit:string;
  anchor:string;
  actor:Owner;
  origin:string;
  credentialId?:string;
}
