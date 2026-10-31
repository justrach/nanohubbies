import {assertRepositoryWritable} from '../repository/archive';
import {Repository} from '../repository/store';
import type {Pull,Review} from './types';
import type {ReviewRequest,ReviewRequests,ReviewRequestEdit} from './request-types';
export const reviewerId=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\s\u0000-\u001f\u007f]/.test(value);

/** Request metadata is advisory. It never supplies approvals or changes policy.
 * The caller wraps edits and review answers in the serialized transaction. */
export class RequestedReviews {
  constructor(private sql:SqlStorage){
    sql.exec('CREATE TABLE IF NOT EXISTS review_requests (pull INTEGER NOT NULL, reviewer TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(pull,reviewer))');
    sql.exec('CREATE TABLE IF NOT EXISTS review_request_revisions (pull INTEGER PRIMARY KEY, revision INTEGER NOT NULL)');
  }
  list(number:number):ReviewRequests {
    const revision=this.sql.exec<{revision:number}>('SELECT revision FROM review_request_revisions WHERE pull=?',number).toArray()[0]?.revision??0;
    const requests=this.sql.exec<{data:string}>('SELECT data FROM review_requests WHERE pull=? ORDER BY reviewer',number).toArray().map(row=>JSON.parse(row.data) as ReviewRequest);
    return {protocol:1,revision,requests};
  }
  private bump(number:number){this.sql.exec('INSERT INTO review_request_revisions VALUES(?,1) ON CONFLICT(pull) DO UPDATE SET revision=revision+1',number);}
  private save(number:number,request:ReviewRequest){this.sql.exec('INSERT INTO review_requests VALUES(?,?,?) ON CONFLICT(pull,reviewer) DO UPDATE SET data=excluded.data',number,request.reviewer,JSON.stringify(request));}
  edit(input:ReviewRequestEdit,pull:Pull,head:string){
    assertRepositoryWritable(this.sql);
    if(pull.state!=='open')throw Error('Review requests require an open pull request');
    if(head!==input.commit||pull.anchor!==input.anchor)throw Error('Pull request changed; inspect its latest diff');
    if(!['request','remove'].includes(input.operation)||!Array.isArray(input.reviewers)||!input.reviewers.length||input.reviewers.length>15||!input.reviewers.every(reviewerId)||new Set(input.reviewers).size!==input.reviewers.length||!Number.isSafeInteger(input.revision)||input.revision<0)throw Error('Choose 1–15 distinct reviewer account IDs and a current revision');
    const before=this.list(pull.number);
    if(before.revision!==input.revision)return {conflict:true as const,...before};
    if(input.operation==='request'&&input.reviewers.includes(pull.author.id))throw Error('Pull request authors cannot review their own pull request');
    const existing=new Map(before.requests.map(request=>[request.reviewer,request]));
    const active=new Set(before.requests.filter(request=>request.state==='requested').map(request=>request.reviewer));
    for(const id of input.reviewers)if(input.operation==='request')active.add(id);else active.delete(id);
    if(active.size>15)throw Error('At most 15 outstanding reviewers are allowed');
    if(new Set([...existing.keys(),...(input.operation==='request'?input.reviewers:[])]).size>100)throw Error('This pull request has reached its 100 distinct reviewer limit');
    const now=Date.now(),changed:string[]=[];
    for(const id of input.reviewers){
      const previous=existing.get(id);
      if(input.operation==='request'){
        if(previous?.state==='requested')continue;
        this.save(pull.number,{reviewer:id,requestedBy:input.actor,requestedAt:now,state:'requested',...(input.credentialId?{via:{kind:'cli',credentialId:input.credentialId}}:{})});
      }else{
        if(!previous||previous.state!=='requested')continue;
        this.save(pull.number,{...previous,state:'removed',removedBy:input.actor,removedAt:now});
      }
      changed.push(id);
    }
    if(changed.length){
      this.bump(pull.number);
      new Repository(this.sql).audit({actor:input.actor.id,...(input.credentialId?{via:{kind:'cli',credentialId:input.credentialId}}:{}),reviewRequest:{pull:pull.number,operation:input.operation,reviewers:changed}});
    }
    return this.list(pull.number);
  }
  answer(review:Review){
    if(!review.independent)return;
    const request=this.list(review.pull).requests.find(row=>row.reviewer===review.author.id&&row.state==='requested');
    if(!request)return;
    this.save(review.pull,{...request,state:'reviewed',reviewId:review.id,answeredAt:review.at});
    this.bump(review.pull);
    new Repository(this.sql).audit({actor:review.author.id,...(review.via?{via:review.via}:{}),reviewRequest:{pull:review.pull,operation:'answer',reviewers:[review.author.id],reviewId:review.id}});
  }
}
