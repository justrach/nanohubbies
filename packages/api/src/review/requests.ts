import {assertRepositoryWritable} from '../repository/archive';
import {Repository} from '../repository/store';
import type {Pull} from './types';
import type {ReviewRequest,ReviewRequests,ReviewRequestEdit} from './request-types';
import {requestStorage} from './request-storage';
export const reviewerId=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\s\u0000-\u001f\u007f]/.test(value);

/** Request metadata is advisory. It never supplies approvals or changes policy.
 * The caller wraps edits and review answers in the serialized transaction. */
export class RequestedReviews {
  constructor(private sql:SqlStorage){
    requestStorage(sql);
  }
  list(number:number):ReviewRequests {
    const stored=this.sql.exec<{revision:number}>('SELECT revision FROM review_request_revisions WHERE pull=?',number).toArray()[0]?.revision;
    const requests=this.sql.exec<{data:string}>('SELECT data FROM review_requests WHERE pull=? ORDER BY reviewer',number).toArray().map(row=>JSON.parse(row.data) as ReviewRequest);
    if(stored===undefined&&requests.length||stored!==undefined&&(!Number.isSafeInteger(stored)||stored<0))throw Error('Review request revision is unavailable; keep edits closed');
    return {protocol:1,revision:stored??0,requests,revisionTracking:'storage',answerTracking:'storage-v2',readerFeedback:'v1'};
  }
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
        this.save(pull.number,{reviewer:id,requestedBy:input.actor,requestedAt:now,state:'requested',generation:crypto.randomUUID(),...(input.credentialId?{via:{kind:'cli',credentialId:input.credentialId}}:{})});
      }else{
        if(!previous||previous.state!=='requested')continue;
        this.save(pull.number,{...previous,state:'removed',removedBy:input.actor,removedAt:now});
      }
      changed.push(id);
    }
    if(changed.length){
      new Repository(this.sql).audit({actor:input.actor.id,...(input.credentialId?{via:{kind:'cli',credentialId:input.credentialId}}:{}),reviewRequest:{pull:pull.number,operation:input.operation,reviewers:changed}});
    }
    return this.list(pull.number);
  }
}
