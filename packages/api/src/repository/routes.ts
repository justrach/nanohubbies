import {cliRulesets} from "./cli-rulesets";
import {cliEnvironments} from './cli-environments';
import {cliRunners} from './cli-runners';
import {defaultBranchRoute} from './default-route';
import {branchRenameRoute} from './branch-rename-route';
import {mergeSettingsRoute} from './merge-settings-route';
import {archiveLocked,archiveMessage} from "./archive";
import { creationBody } from "../abuse";
import { readGitBody } from "./bytes";
import { unpack } from "../unpack";
import { repositoryLimits } from "./validate";
import { encode } from "../git";
import { pusher } from "../tokens";
import { settings, type User } from "../auth";
import {canAdmin,canWrite,sameOrigin,type TeamAccess} from "../team/access";
import { branchPattern } from "./pattern";
import type { BranchPolicy } from "./policy";
import type { RulesetInput } from "./rulesets";
import { visibleRuleset } from "./ruleset-view";
import { importRuleset } from "./ruleset-transfer";
import {missingProtectionMethod,protectionUpdating} from "./protection-rpc";
import {capacityRoute} from '../ci/capacity-route';

export async function repositoryRoute(env: Env, request: Request, trunk: string, action: string, id: string | undefined, user: User | null, access: TeamAccess | null, operation?: string) {
  const seq = env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk));
  if (action === "repository" && id === "objects" && request.method === "POST") {
    const credential = await pusher(env, request, trunk);
    if (!credential || !(await seq.repositoryMode())) return Response.json({ error: "Use a workspace push credential for a Git repository" }, { status: 403 });
    const size = Number(request.headers.get("content-length"));
    if (size > 32 << 20) return Response.json({ error: "Object batch exceeds 32 MiB" }, { status: 413 });
    const data = await readGitBody(request);
    if (data.length > 32 << 20) return Response.json({ error: "Object batch exceeds 32 MiB" }, { status: 413 });
    const objects = unpack(data, repositoryLimits(env));
    await env.PACKER.get(env.PACKER.idFromName(trunk)).publishGit(trunk, [...objects.values()].map(o => encode(o.type, o.body)));
    return Response.json({ stored: objects.size, refsPublished: false });
  }
  const entry = await env.HUB.get(env.HUB.idFromName("hub")).find(trunk);
  const canConfigure=!!user && !request.headers.has("authorization") && (access ? access.proof.role === "owner" && !access.proof.agentId : entry?.owner === user.id);
  const canProtect=!!user && (!user.cli||user.cli.scopes.includes("protections:write")) && !request.headers.has("authorization") && (access?canAdmin(access):entry?.owner===user.id);
  if(action==="rulesets"&&user?.cli)return cliRulesets(env,request,trunk,id,operation,user,access);
  if(action==="default-branch")return defaultBranchRoute(env,request,trunk,user,access,id,operation);
  if(action==='branch-rename')return branchRenameRoute(env,request,trunk,user,access,id,operation);
  if(action==='merge-settings')return mergeSettingsRoute(env,request,trunk,user,access,id,operation);
  if(action==='environments'&&user?.cli)return cliEnvironments(env,request,trunk,id,operation,user,access);
  if(action==='ci'&&user?.cli)return cliRunners(env,request,trunk,id,operation,user,access);
  if(action==="environments") {
    if(!canProtect)return Response.json({error:"A signed-in repository admin is required for deployment environments"},{status:403});
    const headers={"Cache-Control":"private, no-store"};
    if(operation)return Response.json({error:"Environment operation not found"},{status:404,headers});
    try {
      if(request.method==="GET"){const environments=await seq.environments();if(id){const environment=environments.find(e=>e.id===id);return environment?Response.json(environment,{headers}):Response.json({error:"Environment not found"},{status:404,headers});}return Response.json({environments,sources:await seq.ciSources()},{headers});}
      if(!sameOrigin(env,request))return Response.json({error:"Same-origin request required"},{status:403,headers});
      if(id&&!/^[a-zA-Z0-9-]{8,80}$/.test(id))throw Error("Invalid environment ID");
      if(request.method==="POST"&&!id||request.method==="PUT"&&id) {
        const input=await creationBody<import("../deployments/types").EnvironmentInput>(request,2048);
        return Response.json(await seq.setEnvironment(input,user!.id,id,new URL(request.url).origin),{status:id?200:201,headers});
      }
      if(request.method==="DELETE"&&id){await seq.removeEnvironment(id,user!.id);return Response.json({deleted:true},{headers});}
      return Response.json({error:"Method not supported"},{status:405,headers});
    }catch(error){return Response.json({error:(error as Error).message},{status:400,headers});}
  }
  if(action==="rulesets"&&id==="rule-suites") {
    if(!canProtect)return Response.json({error:"A signed-in repository admin is required for rule insights"},{status:403});
    if(request.method!=="GET")return Response.json({error:"Rule insights are read-only"},{status:405});
    const headers={"Cache-Control":"private, no-store"};
    try {
      if(operation!==undefined) {
        if(!/^[1-9]\d*$/.test(operation)||!Number.isSafeInteger(Number(operation)))throw Error("Invalid rule suite ID");
        const suite=await seq.ruleSuite(Number(operation));
        return suite?Response.json(suite,{headers}):Response.json({error:"Rule suite unavailable or expired"},{status:404,headers});
      }
      const params=new URL(request.url).searchParams;
      if([...params.keys()].some(key=>!["before","limit","ref","actor","ruleset","result","from","to"].includes(key)))throw Error("Unknown rule insight filter");
      const integer=(key:string)=>{const v=params.get(key);if(v===null)return undefined;if(!/^[1-9]\d{0,15}$/.test(v)||!Number.isSafeInteger(Number(v)))throw Error("Invalid rule insight filter");return Number(v);};
      return Response.json(await seq.ruleSuites({before:integer("before"),limit:integer("limit"),ruleset:integer("ruleset"),from:integer("from"),to:integer("to"),
        ...(params.has("ref")?{ref:params.get("ref")!}:{}),...(params.has("actor")?{actor:params.get("actor")!}:{}),...(params.has("result")?{result:params.get("result")! as import("./insight-types").RuleOutcome}:{})}),{headers});
    }catch(error){return Response.json({error:(error as Error).message},{status:400,headers});}
  }
  if (action === "rulesets" && operation === "export") {
    if (request.method !== "GET") return Response.json({error:"Use GET to download ruleset JSON"},{status:405});
    try {
      if (!id || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw Error("Invalid ruleset ID");
      const event = new URL(request.url).searchParams.get("event");
      if (event !== null && !canProtect) return Response.json({error:"A signed-in repository admin is required for historical exports"},{status:403});
      if (event !== null && (!/^[1-9]\d*$/.test(event) || !Number.isSafeInteger(Number(event)))) throw Error("Invalid history event");
      const configuration = await seq.rulesetExport(Number(id),event === null ? undefined : Number(event));
      return new Response(JSON.stringify(configuration,null,2)+"\n",{headers:{
        "Content-Type":"application/json; charset=utf-8", "Content-Disposition":`attachment; filename="ruleset-${id}${event === null ? "" : `-event-${event}`}.json"`,
        "Cache-Control":"private, no-store", "X-Content-Type-Options":"nosniff",
      }});
    } catch(error) { return Response.json({error:(error as Error).message},{status:400}); }
  }
  if (action === "rulesets" && id === "import" && (!operation || operation === "preview")) {
    if (!canProtect) return Response.json({error:"A signed-in repository admin is required to import rulesets"},{status:403});
    if (request.method !== "POST") return Response.json({error:"Use POST to preview or import ruleset JSON"},{status:405});
  }
  if (action === "rulesets" && operation) {
    if (id === "import" && operation === "preview") { /* Validated below after the origin check. */ }
    else if (operation !== "restore" || !id || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))
      return Response.json({error:"Ruleset operation not found"},{status:404});
    if (!canProtect) return Response.json({error:"A signed-in repository admin is required to restore rulesets"},{status:403});
    if (request.method === "GET") {
      try {
        const event = new URL(request.url).searchParams.get("event") ?? "";
        if (!/^[1-9]\d*$/.test(event) || !Number.isSafeInteger(Number(event))) throw Error("Invalid history event");
        return Response.json(await seq.rulesetRestorePreview(Number(id),Number(event)),{headers:{"Cache-Control":"private, no-store"}});
      } catch(error) { return Response.json({error:(error as Error).message},{status:400}); }
    }
  }
  if (request.method === "GET") {
    if (action === "repository" && id === "audit") {
      if (!canProtect) return Response.json({error:"A signed-in repository admin is required for activity"},{status:403});
      const params = new URL(request.url).searchParams;
      const integer = (key: string) => {
        const value=params.get(key);
        if(value===null)return undefined;
        if(!/^[1-9]\d{0,15}$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error("Invalid activity filter");
        return Number(value);
      };
      try {
        return Response.json(await seq.repositoryActivity({before:integer("before"),limit:integer("limit"),ruleset:integer("ruleset"),
          kind:(params.get("kind")??"all") as import("./activity-types").ActivityKind,ref:params.has("ref")?params.get("ref")!:undefined}),{headers:{"Cache-Control":"private, no-store"}});
      } catch(error) { return Response.json({error:(error as Error).message},{status:400}); }
    }
    if (action === "ci" && id === "runners") return canConfigure?Response.json({registrations:await seq.ciRunners()}):Response.json({error:"Repository owner required"},{status:403});
    if (action === "rulesets") {
      const plan = await seq.rulesetPlan();
      if (!id) return Response.json({...plan,rulesets:plan.rulesets.map(r=>visibleRuleset(r,canProtect))});
      const rule = plan.rulesets.find(r => String(r.id) === id);
      return rule ? Response.json(visibleRuleset(rule,canProtect)) : Response.json({error:"No such ruleset"},{status:404});
    }
    const archive=await env.HUB.get(env.HUB.idFromName("hub")).repositoryArchive(trunk);
    if(action==="protection") {
      let configuration;
      try{configuration=await seq.protectionConfiguration();}
      catch(error){
        if(!missingProtectionMethod(error,"protectionConfiguration"))throw error;
        return user?.cli?protectionUpdating():Response.json({policies:await seq.policies(),revision:null,updating:true},{headers:{"Cache-Control":"private, no-store"}});
      }
      if(user?.cli&&configuration.revisionTracking!=="storage")return protectionUpdating();
      return Response.json(configuration,{headers:{"Cache-Control":"private, no-store",ETag:`"protection-${configuration.revision}"`}});
    }
    let configuration;
    try{configuration=await seq.repositoryConfiguration();}
    catch(error){if(!(error instanceof Error)||!error.message.includes('does not implement the method "repositoryConfiguration"'))throw error;configuration={mode:await seq.repositoryMode()?"git":"snapshot",defaultBranch:"main",revision:null};}
    let initialImportMaxRefs=100;
    try{initialImportMaxRefs=await seq.repositoryImportLimit();}
    catch(error){if(!(error instanceof Error)||!error.message.includes('does not implement the method "repositoryImportLimit"'))throw error;}
    return Response.json({ archive, canConfigure, canRequestDeployment:!archiveLocked(archive)&&!!user&&!request.headers.has("authorization")&&canWrite(access), environments:await seq.environments(), ...configuration, initialImportMaxRefs, refs: await seq.repositoryRefs(), runs: await seq.ciRuns() });
  }
  if (!(["protection","rulesets"].includes(action) ? canProtect : canConfigure)) return Response.json({ error: "A signed-in repository admin is required for protection; CI administration requires the owner" }, { status: 403 });
  const url = new URL(request.url), origin = request.headers.get("origin");
  const localPreview = origin && settings(env, url).dev && ["localhost", "127.0.0.1"].includes(url.hostname) && new URL(origin).hostname === url.hostname;
  if (origin !== url.origin && !localPreview) return Response.json({ error: "Same-origin request required" }, { status: 403 });
  if(action==="protection"&&user?.cli) {
    if(!["PUT","DELETE"].includes(request.method))return Response.json({error:"Use PUT or DELETE"},{status:405});
    const condition=request.headers.get("if-match");
    if(!condition)return Response.json({error:"Protection edits require the revision from rules get or rules list"},{status:428});
    const match=/^"protection-(0|[1-9]\d{0,15})"$/.exec(condition),revision=match?Number(match[1]):NaN;
    if(!Number.isSafeInteger(revision))return Response.json({error:"Invalid protection revision"},{status:400});
    const body=await creationBody<BranchPolicy>(request,32*1024),branch=branchPattern(body.branch);
    if(request.method==="PUT"&&Object.keys(body).some(k=>!["branch","pullRequest","approvals","checks","successOnlyChecks","beforeOpen","checkSources","environments","preventForce","preventDelete","locked","requireLastPushApproval","requireConversationResolution","requireLinearHistory","requireCodeOwnerReview","requireSignedCommits","dismissStaleReviews","allowPush","allowDismiss","allowForcePush"].includes(k)))return Response.json({error:"Unknown branch protection field"},{status:400});
    if(request.method==="DELETE"&&Object.keys(body).some(k=>k!=="branch"))return Response.json({error:"Deletion accepts only the exact branch pattern"},{status:400});
    let result;
    try{
      const configuration=await seq.protectionConfiguration();
      if(request.method==="PUT"&&body.successOnlyChecks===undefined&&configuration.policies.find(policy=>policy.branch===branch)?.successOnlyChecks===true)return Response.json({error:"Include successOnlyChecks explicitly when replacing a success-only policy"},{status:400});
      if(configuration.revisionTracking!=="storage"||body.allowForcePush!==undefined&&!configuration.forcePushActors||body.successOnlyChecks!==undefined&&!configuration.successOnlyCheckConclusions)return protectionUpdating();
      result=await seq.configureProtection({branch,revision,credentialId:user.cli.credentialId,...(request.method==="PUT"?{policy:body}:{})},user.id);
    }
    catch(error){if(missingProtectionMethod(error,"configureProtection")||missingProtectionMethod(error,"protectionConfiguration"))return protectionUpdating();throw error;}
    return "conflict" in result?Response.json({error:"Protection rules changed; inspect them again before editing",revision:result.revision},{status:412}):Response.json(result);
  }
  if (action === "rulesets") {
    if (id === "import") {
      try {
        const body = await creationBody<{configuration:unknown}>(request,128*1024);
        if (Object.keys(body).some(k=>k!=="configuration")) throw Error("Import accepts one configuration object");
        const preview = importRuleset(body.configuration);
        return operation === "preview" ? Response.json(preview,{headers:{"Cache-Control":"private, no-store"}})
          : Response.json(await seq.setRuleset(preview.configuration,user!.id),{status:201});
      } catch(error) { return Response.json({error:(error as Error).message},{status:400}); }
    }
    const ruleId = id === undefined ? undefined : Number(id);
    if (id !== undefined && (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(ruleId))) throw Error("Invalid ruleset ID");
    if (operation === "restore") {
      if (request.method !== "POST") return Response.json({error:"Use POST to restore a ruleset"},{status:405});
      try {
        const body = await creationBody<{eventId:number;revision:number}>(request,1024);
        if (Object.keys(body).some(k=>!["eventId","revision"].includes(k))) throw Error("Restore accepts a history event and comparison revision only");
        const result = await seq.restoreRuleset(ruleId!,body.eventId,body.revision,user!.id);
        return "conflict" in result
          ? Response.json({error:"Rules changed since this comparison. Compare again before restoring.",revision:result.revision},{status:409})
          : Response.json(result);
      } catch(error) { return Response.json({error:(error as Error).message},{status:400}); }
    }
    if ((request.method === "POST" && !id) || (request.method === "PUT" && id)) {
      const value = await creationBody<RulesetInput>(request,128*1024);
      if(value.bypass_actors?.some(a=>a.actor_type==='RepositoryRole')&&!(await seq.rulesetPlan()).roleBypass)return Response.json({error:'Ruleset role permissions are updating; retry shortly'},{status:503,headers:{'Retry-After':'5'}});
      return Response.json(await seq.setRuleset(value,user!.id,ruleId),{status:request.method === "POST"?201:200});
    }
    if (request.method === "DELETE" && ruleId) {
      await seq.removeRuleset(ruleId,user!.id); return Response.json({deleted:true});
    }
  }
  if (action === "protection" && request.method === "PUT") {
    const policy = await creationBody<BranchPolicy>(request,32*1024); branchPattern(policy.branch);
    try{
      const configuration=await seq.protectionConfiguration();
      if(policy.successOnlyChecks===undefined&&configuration.policies.find(existing=>existing.branch===policy.branch)?.successOnlyChecks===true)return Response.json({error:"Include successOnlyChecks explicitly when replacing a success-only policy"},{status:400});
      if(policy.allowForcePush!==undefined&&!configuration.forcePushActors||policy.successOnlyChecks!==undefined&&!configuration.successOnlyCheckConclusions)return protectionUpdating();
    }catch(error){
      if(!missingProtectionMethod(error,"protectionConfiguration"))throw error;
      if(policy.allowForcePush!==undefined||policy.successOnlyChecks!==undefined)return protectionUpdating();
      if((await seq.policies()).some(existing=>existing.branch===policy.branch&&existing.successOnlyChecks===true))return protectionUpdating();
    }
    return Response.json({ policies: await seq.setPolicy(policy, user!.id) });
  }
  if(action === "protection" && request.method === "DELETE") {
    const {branch}=await creationBody<{branch:string}>(request,1024);
    return Response.json({policies:await seq.removePolicy(branchPattern(branch),user!.id)});
  }
  if (action === "ci" && request.method === "POST" && id === "retry") {
    const {runId}=await request.json<{runId:string}>();return Response.json(await seq.ciRetry(runId,user!.id));
  }
  if (action === "ci" && request.method === "POST" && id === "approve") {
    const { runId } = await request.json<{ runId: string }>();
    return Response.json(await seq.ciApprove(runId, user!.id));
  }
  if (action === "ci" && request.method === "POST" && id === "runners") {
    const { name } = await request.json<{ name: string }>();
    return Response.json(await seq.ciRunner(name), { status: 201 });
  }
  if (action === "ci" && request.method === "DELETE" && id) { await seq.ciRevoke(id); return Response.json({ revoked: true }); }
  return Response.json({ error: "Method not supported" }, { status: 405 });
}

/** CI identities are separate from human/agent identities. They can lease
 * checks and read Git objects, and have no repository/policy write access. */
export async function runnerRoute(env: Env, request: Request, trunk: string, id: string | undefined, operation: string | undefined) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const seq = env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk));
  if (!token.startsWith("nhci_")) return null;
  if (request.method !== "POST") return Response.json({ error: "Method not supported" }, { status: 405 });
  if(id==='capacity')return capacityRoute(env,request,trunk,token,operation);
  try {
    await seq.ciAuthenticate(token);
    const archive=await env.HUB.get(env.HUB.idFromName("hub")).repositoryArchive(trunk);
    if(archiveLocked(archive))return id==="claim"?Response.json({run:null}):Response.json({error:archiveMessage},{status:403});
    if (id === "claim") {
      const run = await seq.ciClaim(token,new URL(request.url).origin);
      const address=await env.HUB.get(env.HUB.idFromName("hub")).repositoryAddress(trunk);
      return Response.json({run,cloneUrl:`${new URL(request.url).origin}/git/${address?`${address.namespace}/${address.name}`:trunk}.git`});
    }
    if(id==="deployments") {
      if(operation==="revalidate") {
        const body=await creationBody<{requestId:string;authorizationId:string;attempt:number}>(request,2048);
        if(Object.keys(body).some(key=>!["requestId","authorizationId","attempt"].includes(key))||typeof body.requestId!=="string"||typeof body.authorizationId!=="string"||!Number.isSafeInteger(body.attempt))throw Error("Invalid deployment revalidation");
        return Response.json(await seq.revalidateDeployment(token,body.requestId,body.authorizationId,body.attempt,new URL(request.url).origin),{headers:{"Cache-Control":"private, no-store"}});
      }
      if(operation==="request") {
        const body=await creationBody<{runId:string;attempt:number;environment:string;optional?:boolean}>(request,2048);if(Object.keys(body).some(key=>!["runId","attempt","environment","optional"].includes(key))||typeof body.runId!=="string"||!Number.isSafeInteger(body.attempt)||typeof body.environment!=="string"||body.optional!==undefined&&typeof body.optional!=="boolean")throw Error("Invalid deployment request");
        return Response.json(await seq.runnerDeployment(token,body.runId,body.attempt,body.environment,new URL(request.url).origin,body.optional));
      }
      if(operation==="authorize"||operation==="defer") {
        const body=await creationBody<{requestId:string;attempt:number;results:import("../ci/types").CheckResult[]}>(request,100000);if(Object.keys(body).some(key=>!(operation==="defer"?["requestId","attempt","results"]:["requestId","attempt"]).includes(key))||typeof body.requestId!=="string"||!Number.isSafeInteger(body.attempt))throw Error("Invalid deployment authorization");
        return Response.json(operation==="authorize"?await seq.authorizeDeployment(token,body.requestId,body.attempt,new URL(request.url).origin):await seq.deferDeployment(token,body.requestId,body.attempt,body.results,new URL(request.url).origin));
      }
    }
    if(id === "logs" && operation) {
      const body=await creationBody<{attempt:number;name:string;content:string}>(request,2*1024*1024);
      if(!/^[a-zA-Z0-9_-]{1,80}$/.test(operation) || !Number.isInteger(body.attempt) || !/^[a-zA-Z0-9_.-]{1,220}\.log$/.test(body.name) || typeof body.content!=="string" || new TextEncoder().encode(body.content).length>1024*1024)throw new Error("Invalid CI log");
      await seq.ciLogAccess(token,operation,body.attempt);
      await env.OBJECTS.put(`ci/${trunk}/${operation}/${body.attempt}/${body.name}`,body.content,{httpMetadata:{contentType:"text/plain; charset=utf-8"}});
      return Response.json({stored:true});
    }
    if (id === "runs" && operation) {
      const body = await request.json<{ attempt: number; results: import("../ci/store").CheckResult[]; staging: import("../ci/store").StagingEvidence | null; deployments?:import("../deployments/types").DeploymentReport[] }>();
      if(Object.keys(body).some(key=>!["attempt","results","staging","deployments"].includes(key)))throw Error("Unknown CI completion field");
      return Response.json(await seq.ciComplete(token, operation, body.attempt, body.results, body.staging ?? null,body.deployments===undefined?[]:body.deployments,new URL(request.url).origin));
    }
    return Response.json({ error: "CI runner cannot write this resource" }, { status: 403 });
  } catch (error) { return Response.json({ error: (error as Error).message }, { status: 403 }); }
}
