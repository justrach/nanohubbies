import {Namespaces,type RepositoryAddress} from '../namespaces/store';
import {assertRepositoryWritable} from '../repository/archive';
import {Admission,type AdmissionResult} from './admission';
import type {AbuseLimits} from '../abuse';

type Refused=Extract<AdmissionResult,{ok:false}>;
class Rejected extends Error {
 constructor(readonly result:Refused){super('Repository admission refused');}
}
export type NamedAdmission={creator:string;limits:AbuseLimits}|null;
export type NamedAdmissionResult=Refused|{ok:true;repository:RepositoryAddress;ticket:string|null};

/** Known quota refusals roll back the new address in the same transaction.
 * After a success or an unknown RPC outcome, retain both reservations: later
 * initialization may still complete, and a clone URL must never change IDs. */
export function reserveNamedRepository(storage:DurableObjectStorage,sql:SqlStorage,admission:Admission,namespace:string,name:string,actor:string,policy:NamedAdmission):NamedAdmissionResult {
 try{return storage.transactionSync(()=>{
  const repository=new Namespaces(sql).reserve(namespace,name,actor);
  assertRepositoryWritable(sql,repository.id);
  let ticket:string|null=null;
  if(policy){const reserved=admission.reserveInTransaction(repository.id,actor,policy.creator,policy.limits);if(!reserved.ok)throw new Rejected(reserved);ticket=reserved.ticket;}
  return {ok:true as const,repository,ticket};
 });}catch(error){if(error instanceof Rejected)return error.result;throw error;}
}
