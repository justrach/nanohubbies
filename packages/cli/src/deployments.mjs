const validId=value=>/^[a-zA-Z0-9-]{8,80}$/.test(value??'');
const integer=value=>/^(0|[1-9]\d{0,15})$/.test(value??'')&&Number.isSafeInteger(Number(value));
export async function deploymentCommand({action,pos,opts,base,token,request,output}){
 const path=base+'/deployment-requests',common=['repo','trunk','host','json','helper','positionals'];
 const specific=action==='list'?['before','limit']:action==='request'?['environment']:['approve','reject'].includes(action)?['revision','body']:[];
 if(Object.keys(opts).some(key=>![...common,...specific].includes(key)))throw Error('Use deployment list, view, request, approve or reject with their documented options');
 if(action==='list'){
  if(pos.length||[opts.before,opts.limit].some(value=>value!==undefined&&(!integer(value)||Number(value)<1))||opts.limit!==undefined&&Number(opts.limit)>50)throw Error('Use deployment list [--before N] [--limit 1..50]');
  const query=new URLSearchParams();for(const key of ['before','limit'])if(opts[key]!==undefined)query.set(key,opts[key]);
  const page=await request(path+(query.size?'?'+query:''),token);
  output(page,page.requests.map(row=>`${row.id}\t${row.environment}\t${row.state}\t${row.head}\trevision ${row.revision}${row.reason?'\t'+row.reason:''}`).join('\n')||'No deployment requests.');return;
 }
 if(action==='view'){
  if(pos.length!==1||!validId(pos[0]))throw Error('Use deployment view REQUEST_ID');
  const data=await request(path+'/'+pos[0],token);output(data,JSON.stringify(data,null,2));return;
 }
 if(action==='request'){
  if(pos.length!==1||!validId(pos[0])||typeof opts.environment!=='string'||!opts.environment.trim()||opts.environment!==opts.environment.trim()||opts.environment.length>255||/[\x00-\x1f\x7f]/.test(opts.environment))throw Error('Use deployment request RUN_ID --environment NAME');
  const data=await request(path,token,{method:'POST',body:{runId:pos[0],environment:opts.environment}});
  output(data,`Requested deployment ${data.request.id} to ${data.request.environment}. Inspect deployment view before reviewing.`);return;
 }
 if(!['approve','reject'].includes(action)||pos.length!==1||!validId(pos[0])||!integer(opts.revision)||opts.body!==undefined&&(typeof opts.body!=='string'||opts.body.length>16000))throw Error('Use deployment approve|reject REQUEST_ID --revision N [--body COMMENT]');
 const data=await request(path+'/'+pos[0]+'/reviews',token,{method:'POST',body:{decision:action==='approve'?'approve':'reject',comment:opts.body??''},revision:Number(opts.revision),revisionType:'deployment-request'});
 output(data,`${action==='approve'?'Approved':'Rejected'} deployment ${pos[0]}. Request revision: ${data.request.revision}. Environment gates still apply.`);
}
