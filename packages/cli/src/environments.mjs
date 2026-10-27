const validId=value=>/^[a-zA-Z0-9-]{8,80}$/.test(value??'');
export async function environmentCommand({action,pos,opts,base,token,request,output,readFile}){
 const path=base+'/environments';
 if(['list','view','export'].includes(action)){
  if(pos.length!==(action==='list'?0:1)||action!=='list'&&!validId(pos[0]))throw Error('Use env list, env view ID or env export ID');
  const data=await request(path+(action==='list'?'':'/'+pos[0]+(action==='export'?'/configuration':'')),token);
  if(action==='list')output(data,`Environment settings revision: ${data.revision}\n`+(data.environments.map(e=>`${e.id}\t${e.name}\t${e.reviewers?.length??0} reviewers\t${e.waitTimerMinutes??0} minute wait`).join('\n')||'No deployment environments.'));
  else output(data,JSON.stringify(data,null,2));return;
 }
 let revision,configuration,method,id;
 if(action==='delete'){
  if(pos.length!==1||!validId(pos[0])||opts.file!==undefined||opts.confirm!==pos[0]||!/^(0|[1-9]\d{0,15})$/.test(opts.revision??''))throw Error('Use env delete ID --revision N --confirm ID');
  id=pos[0];revision=Number(opts.revision);configuration={};method='DELETE';
 }else{
  if(!['create','update'].includes(action)||pos.length!==(action==='create'?0:1)||action==='update'&&!validId(pos[0])||!opts.file||opts.revision!==undefined||opts.confirm!==undefined)throw Error('Use env create --file FILE or env update ID --file FILE containing {revision,configuration}');
  let document;try{document=JSON.parse(await readFile(opts.file));}catch{throw Error('Cannot read environment export; use a UTF-8 JSON file');}
  if(!document||Array.isArray(document)||Object.keys(document).some(key=>!['revision','configuration'].includes(key))||!document.configuration||Array.isArray(document.configuration)||typeof document.configuration!=='object'||typeof document.configuration.name!=='string')throw Error('Use an environment export containing only revision and complete configuration');
  revision=document.revision;configuration=document.configuration;id=pos[0];method=action==='create'?'POST':'PUT';
 }
 if(!Number.isSafeInteger(revision)||revision<0)throw Error('Use the environment settings revision from env list or env export');
 const data=await request(path+(id?'/'+id:''),token,{method,body:configuration,revision,revisionType:'environments'});
 output(data,method==='DELETE'?`Removed environment ${id}. Settings revision: ${data.revision}.`:`Saved environment ${data.environment.name}. Settings revision: ${data.revision}.`);
}
