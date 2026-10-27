const validId=value=>/^[1-9]\d{0,8}$/.test(value??'');
export async function rulesetCommand({action,pos,opts,base,token,request,output,readFile}) {
 const path=base+'/rulesets';
 if(['list','view','export'].includes(action)) {
  if(pos.length!==(action==='list'?0:1)||action!=='list'&&!validId(pos[0]))throw Error('Use ruleset list, ruleset view ID or ruleset export ID');
  const data=await request(path+(action==='list'?'':'/'+pos[0]+(action==='export'?'/configuration':'')),token);
  if(action==='list')output(data,`Ruleset revision: ${data.revision}\n`+(data.rulesets.map(r=>`${r.id}\t${r.enforcement}\t${r.target}\t${r.name}`).join('\n')||'No rulesets.'));
  else output(data,JSON.stringify(data,null,2));return;
 }
 let revision,body,method,id;
 if(action==='delete'){
  if(pos.length!==1||!validId(pos[0])||opts.file!==undefined||opts.confirm!==pos[0]||!/^(0|[1-9]\d{0,15})$/.test(opts.revision??''))throw Error('Use ruleset delete ID --revision N --confirm ID');
  id=pos[0];revision=Number(opts.revision);body={};method='DELETE';
 }else {
  if(!['create','update'].includes(action)||pos.length!==(action==='create'?0:1)||action==='update'&&!validId(pos[0])||!opts.file||opts.confirm!==undefined||opts.revision!==undefined)throw Error('Use ruleset create --file FILE or ruleset update ID --file FILE with a complete exported configuration');
  let value;try{value=JSON.parse(await readFile(opts.file));}catch(error){throw Error('Cannot read ruleset export: '+error.message);}
  if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(k=>!['revision','configuration'].includes(k))||!value.configuration||typeof value.configuration!=='object'||Array.isArray(value.configuration)||!Array.isArray(value.configuration.bypass_actors))throw Error('Use an export containing only revision and configuration, with explicit bypass_actors');
  revision=value.revision;body={configuration:value.configuration};method=action==='create'?'POST':'PUT';id=pos[0];
 }
 if(!Number.isSafeInteger(revision)||revision<0)throw Error('Use the ruleset revision from the current list or complete export');
 const data=await request(path+(id?'/'+id:''),token,{method,body,revision,revisionType:'ruleset'});
 output(data,`${method==='DELETE'?'Removed':method==='POST'?'Created':'Updated'} ruleset ${data.ruleset?.id??id}. Revision: ${data.revision}.`);
}
