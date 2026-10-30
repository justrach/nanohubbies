import {isAbsolute} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {assertFixtureBindings,fixturePlan} from '../hosted-git-fixture/config.mjs';
import {phaseDeploymentSnapshot} from './phase-deploy.mjs';

const phases=new Set(['seed','frozen','verify','reconcile']);

/** Only a held, already deployed, owned recovery app may retain its assets.
 * Wrangler has no keep-assets CLI switch. Its metadata passthrough sends the
 * documented provider keep_assets field without creating an asset upload session.
 * This never changes the initial deployment or adopts an uncertain upload. */
export function retainedAssetPhaseConfiguration(plan,previous,phase) {
 const prefix=plan?.purpose==='vault-recovery'?'nh-vault-recovery-':plan?.purpose==='repository-recovery'?'nh-repo-recovery-':null;
 if(!prefix||!/^[a-f0-9]{32}$/.test(plan.accountId??'')||!/^[a-z0-9]{8,12}-[a-f0-9]{10}$/.test(plan.runId??'')||plan.apiName!==prefix+plan.runId+'-app'||plan.api?.name!==plan.apiName||plan.api.account_id!==plan.accountId||!phases.has(phase))throw Error('Asset reuse requires an owned recovery phase');
 const api=plan.api,assets=api.assets;
 if(api.unsafe!==undefined||!assets||assets.binding!=='ASSETS'||assets.run_worker_first!==true||typeof assets.directory!=='string'||!isAbsolute(assets.directory)||Object.keys(assets).some(key=>!['binding','directory','run_worker_first'].includes(key)))throw Error('Asset reuse requires the canonical Worker-first fixture configuration');
 const suffix='/tools/hosted-recovery-fixture/app.ts';
 if(typeof api.main!=='string'||!isAbsolute(api.main)||!api.main.endsWith(suffix))throw Error('Asset reuse requires the recovery entrypoint');
 const canonical=fixturePlan({root:api.main.slice(0,-suffix.length)||'/',accountId:plan.accountId,runId:plan.runId,deadline:plan.deadline,databaseId:plan.databaseId,storeId:plan.storeId,purpose:plan.purpose}).api;
 canonical.vars.HOSTED_REPO_PHASE=api.vars?.HOSTED_REPO_PHASE;
 if(!isDeepStrictEqual(api,canonical))throw Error('Asset reuse cannot change the canonical fixture configuration');
 phaseDeploymentSnapshot(previous,api.vars?.HOSTED_REPO_PHASE);
 assertFixtureBindings(previous.metadata,plan,'api');
 const resources=previous.metadata.resources;
 if(Object.entries(api.vars).some(([name,text])=>!resources.bindings.some(binding=>binding.name===name&&binding.type==='plain_text'&&binding.text===text)))throw Error('Existing fixture variables do not match the phase configuration');
 if(resources.bindings.filter(binding=>binding.name==='ASSETS'&&binding.type==='assets').length!==1||resources.script_runtime.assets?.raw_run_worker_first!==true)throw Error('Existing Worker-first assets are not verified');
 const {assets:ignored,...retained}=structuredClone(api);
 return {...retained,vars:{...retained.vars,HOSTED_REPO_PHASE:phase},unsafe:{bindings:[{name:'ASSETS',type:'assets'}],metadata:{keep_assets:true,assets:{config:{run_worker_first:true}}}}};
}

/** A phase transition cannot silently replace code, authority or routing.
 * Normalize only the intended phase before comparing complete resources. */
export function assertRetainedAssetPhase(previous,deployed,previousPhase,phase) {
 const baseline=phaseDeploymentSnapshot(previous,previousPhase);
 phaseDeploymentSnapshot(deployed,phase);
 const normalized=structuredClone(deployed);
 normalized.metadata.resources.bindings.find(binding=>binding.name==='HOSTED_REPO_PHASE').text=previousPhase;
 const actual=phaseDeploymentSnapshot(normalized,previousPhase);
 if(actual.resourceSha256!==baseline.resourceSha256)throw Error('Phase deployment changed code, assets routing or resource bindings; keep recovery closed');
 return {previousVersion:baseline.version,version:deployed.version,resourceSha256:baseline.resourceSha256,phaseOnly:true};
}
