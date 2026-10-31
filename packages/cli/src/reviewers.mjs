export async function reviewerCommand({action,pos,opts,base,token,request,output}){
  if(pos.length!==1||!/^[1-9]\d{0,8}$/.test(pos[0]))throw Error('Choose one positive pull request number');
  const path=`${base}/pulls/${pos[0]}/requested-reviewers`;
  const current=await request(path,token);
  if(current.protocol!==1||!Number.isSafeInteger(current.revision)||!Array.isArray(current.requests))throw Error('This server does not support revision-checked review requests');
  if(action==='reviewers'){
    if(opts.reviewer!==undefined||opts.revision!==undefined)throw Error('Use pr reviewers NUMBER without edit options');
    output(current,`Review request revision: ${current.revision}\n`+(current.requests.filter(row=>row.state!=='removed').map(row=>`${row.reviewer}\t${row.state}\trequested by ${row.requestedBy.name}`).join('\n')||'No review requested.'));return;
  }
  if(typeof opts.reviewer!=='string'||!/^(0|[1-9]\d{0,15})$/.test(opts.revision??'')||!Number.isSafeInteger(Number(opts.revision)))throw Error('Use --reviewer ACCOUNT[,ACCOUNT] --revision N from pr reviewers');
  const reviewers=opts.reviewer.split(',');
  if(!reviewers.length||reviewers.length>15||reviewers.some(id=>!id||id.length>256||/[\s\u0000-\u001f\u007f]/.test(id))||new Set(reviewers).size!==reviewers.length)throw Error('Choose 1–15 distinct reviewer account IDs');
  const pull=await request(`${base}/pulls/${pos[0]}`,token);
  const revision=Number(opts.revision),result=await request(path,token,{method:action==='request-review'?'POST':'DELETE',revision,revisionType:'review-requests',body:{reviewers,revision,commit:pull.head.commit,anchor:pull.pull.anchor}});
  output(result,`${action==='request-review'?'Requested review from':'Removed review request for'} ${reviewers.join(', ')}. Revision: ${result.revision}.`);
}
