const sha=/^[a-f0-9]{40}$/;
export const meldJobId=value=>typeof value==='string'&&/^[1-9]\d{12,15}-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const phases=new Set(['queued','starting','building','deploying','verifying','cleanup','reporting','passed','failed','superseded']);
export const meldRequiredSteps=['locked install','pipeline regression checks','typechecks','unit and package checks','browser installation','browser checks','production bundle'];
const branch=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,254}$/.test(value)&&!value.includes('..')&&!value.includes('//')&&value.split('/').every(p=>p&&!p.startsWith('.')&&!p.endsWith('.')&&!p.endsWith('.lock'));

/** Retain no signed source URL, arbitrary messages or unknown provider fields.
 * Active/queued state takes precedence over a stored terminal history entry. */
export function meldRuns(snapshot) {
 if(!snapshot||!Array.isArray(snapshot.queued)||snapshot.queued.length>20||!Array.isArray(snapshot.runs)||snapshot.runs.length>30||!(snapshot.active===null||snapshot.active&&typeof snapshot.active==='object'))throw Error('Invalid Meld controller snapshot');
 const selected=new Map();
 for(const [rows,pending]of [[[snapshot.active].filter(Boolean),true],[snapshot.queued,true],[snapshot.runs,false]])for(const raw of rows){
  if(!raw||!meldJobId(raw.id)||!sha.test(raw.sha??'')||typeof raw.deploy!=='boolean'||!branch(raw.ref)||!phases.has(raw.phase)||!Number.isSafeInteger(raw.queuedAt)||raw.queuedAt<1||raw.statusContext!==(raw.deploy?'Codegraff / staging':'Codegraff / CI'))throw Error('Unverifiable Meld controller job');
  const row={id:raw.id,sha:raw.sha,deploy:raw.deploy,ref:raw.ref,phase:raw.phase,queuedAt:raw.queuedAt,statusContext:raw.statusContext,pending};
  if(raw.steps!==undefined){
   if(!Array.isArray(raw.steps)||raw.steps.length>32)throw Error('Invalid Meld pipeline steps');
   row.steps=raw.steps.map(step=>{
    if(!step||typeof step.name!=='string'||step.name.length>120||!Number.isSafeInteger(step.exitCode)||step.exitCode<0||step.exitCode>255||!Number.isFinite(step.milliseconds)||step.milliseconds<0)throw Error('Invalid Meld pipeline step result');
    return {name:meldRequiredSteps.includes(step.name)?step.name:'additional check',exitCode:step.exitCode,milliseconds:step.milliseconds};
   });
  }
  const previous=selected.get(row.id);
  if(previous){for(const field of ['sha','deploy','ref','queuedAt','statusContext'])if(previous[field]!==row[field])throw Error('Conflicting Meld job identity');}
  else selected.set(row.id,row);
 }
 return [...selected.values()];
}

/** No later or ambiguously ordered attempt can be hidden by an older pass. */
export function currentMeldJob(rows,{id,sha:head,deploy,ref}) {
 const job=rows.find(row=>row.id===id);
 if(!job)return null;
 if(job.sha!==head||job.deploy!==deploy||job.ref!==ref)throw Error('Unrelated Meld pipeline result');
 if(rows.some(row=>row.id!==id&&row.sha===head&&row.deploy===deploy&&row.queuedAt>=job.queuedAt))throw Error('A newer or ambiguously ordered Meld attempt supersedes this result; request a fresh Nanohub attempt');
 return job;
}

export function verifiedMeldSteps(job) {
 if(!job?.steps||job.steps.some(step=>step.exitCode!==0)||meldRequiredSteps.some(name=>job.steps.filter(step=>step.name===name).length!==1))throw Error('Meld job lacks the complete passing committed CI suite');
 return job.steps;
}
