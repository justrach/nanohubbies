const methods=['fast-forward','merge','squash','rebase'];
const usage='Use repo edit --allow-merge-methods fast-forward,squash --default-merge-method squash --revision N';
export async function mergeSettingsCommand({action,pos,opts,base,token,request,output}) {
 if(pos.length||opts.file!==undefined||opts.confirm!==undefined||opts['default-branch']!==undefined)throw Error(usage);
 let allowedMethods,defaultMethod,revision;
 if(action==='merge-settings') {
  if([opts.revision,opts['allow-merge-methods'],opts['default-merge-method']].some(value=>value!==undefined))throw Error('repo merge-settings reads the current configuration; use repo edit to change it');
 } else {
  if(typeof opts['allow-merge-methods']!=='string'||typeof opts['default-merge-method']!=='string'||!/^(0|[1-9]\d{0,15})$/.test(opts.revision??''))throw Error(usage);
  const chosen=opts['allow-merge-methods'].split(',');defaultMethod=opts['default-merge-method'];revision=Number(opts.revision);
  if(!Number.isSafeInteger(revision)||!chosen.length||new Set(chosen).size!==chosen.length||chosen.some(method=>!methods.includes(method))||!chosen.includes(defaultMethod))throw Error('Choose one or more distinct allowed merge methods and an allowed default method');
  allowedMethods=methods.filter(method=>chosen.includes(method));
 }
 const path=base+'/merge-settings',data=await request(path,token);
 if(action==='merge-settings'){
  output(data,`Allowed merge methods: ${(data.allowedMethods??[]).join(', ')}\nDefault merge method: ${data.defaultMethod}\nMerge settings revision: ${data.revision}`);return;
 }
 if(data.conditionalWrites!==true||data.cliAudit!==true||data.revisionTracking!=='storage')throw Error('Merge settings administration is updating; inspect repo merge-settings again shortly');
 if(data.mode!=='git'||data.readOnly||!data.canManage)throw Error('Editing merge methods requires an active Git repository, repository:merge permission and your current admin role');
 if(!Number.isSafeInteger(data.revision)||data.revision!==revision)throw Error('Merge settings changed; inspect repo merge-settings before editing');
 const result=await request(path,token,{method:'PUT',revision,revisionType:'merge-settings',body:{allowedMethods,defaultMethod,revision}});
 if(result.defaultMethod!==defaultMethod||JSON.stringify(result.allowedMethods)!==JSON.stringify(allowedMethods)||!Number.isSafeInteger(result.revision)||result.revision<revision)
  throw Error('Merge settings edit was not confirmed; inspect repo merge-settings');
 output(result,`Allowed merge methods: ${result.allowedMethods.join(', ')}. Default: ${result.defaultMethod}. Revision: ${result.revision}.`);
}
