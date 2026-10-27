/** Lifecycle writes always use an explicitly observed revision. A lost answer
 * never causes a retry: reopening can enable content writes immediately. */
export async function archiveCommand({action,pos,opts,base,token,request,output}) {
 const path=base+'/archive';
 if(pos.length||opts.file!==undefined)throw Error('Use repo archive-status, repo archive or repo unarchive with -R OWNER/REPO');
 if(action==='archive-status') {
  if(opts.revision!==undefined||opts.confirm!==undefined)throw Error('repo archive-status does not accept --revision or --confirm');
  const data=await request(path,token);
  const state=data.transition?(data.transition.archived?'Archiving':'Reopening'):data.archived?'Archived':'Active';
  output(data,`${state}: ${data.confirmation}\nArchive revision: ${data.revision}\n${data.canManage?'Archive administration available.':'Archive administration requires an explicit repository:archive grant and your current admin role.'}`);return;
 }
 if(!['archive','unarchive'].includes(action)||!/^(0|[1-9]\d{0,15})$/.test(opts.revision??'')||!Number.isSafeInteger(Number(opts.revision))||!opts.confirm||opts.confirm.length>100||/[\r\n\0]/.test(opts.confirm))throw Error('Use repo archive or repo unarchive --revision N --confirm CURRENT_REPOSITORY_NAME; inspect repo archive-status first');
 const revision=Number(opts.revision),archived=action==='archive';
 const data=await request(path,token,{method:'POST',body:{archived,revision,confirmation:opts.confirm},revision,revisionType:'archive'});
 if(data.archived!==archived||data.transition)throw Error('Archive operation is not complete. Inspect repo archive-status before continuing.');
 output(data,`${archived?'Archived':'Unarchived'} ${data.confirmation}. Revision: ${data.revision}.`);
}
