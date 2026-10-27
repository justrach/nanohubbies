import {creationBody} from "../abuse";
import type {User} from "../auth";
import {canAdmin,type TeamAccess} from "../team/access";
import {visibleRuleset} from "./ruleset-view";
import type {RulesetInput} from "./ruleset-types";
const headers={"Cache-Control":"private, no-store"};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers});
const updating=()=>Response.json({error:"Ruleset administration is updating; retry shortly"},{status:503,headers:{...headers,"Retry-After":"5"}});
export async function cliRulesets(env:Env,request:Request,trunk:string,id:string|undefined,operation:string|undefined,user:User,access:TeamAccess|null) {
  const seq=env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk)),method=request.method;
  const editor=!!user.cli?.scopes.includes("rulesets:write")&&canAdmin(access);
  if(id!==undefined&&(!/^[1-9]\d{0,8}$/.test(id)||!Number.isSafeInteger(Number(id))))return json({error:"Invalid ruleset ID"},400);
  if(operation!==undefined&&!(method==="GET"&&id&&operation==="configuration"))return json({error:"CLI ruleset operation not supported"},404);
  if((method!=="GET"||operation==="configuration")&&!editor)return json({error:"Ruleset administration requires rulesets:write and a current repository admin role"},403);
  try{
    if(method==="GET") {
      const plan=await seq.rulesetPlan(),ruleset=id===undefined?null:plan.rulesets.find(rule=>rule.id===Number(id));
      if(id&&!ruleset)return json({error:"No such ruleset"},404);
      if(operation==="configuration"){
        if(plan.revisionTracking!=="storage")return updating();
        const {id:_id,...configuration}=ruleset!;
        return json({revision:plan.revision,configuration});
      }
      return json(id?{revision:plan.revision,ruleset:visibleRuleset(ruleset!,editor)}:{...plan,rulesets:plan.rulesets.map(rule=>visibleRuleset(rule,editor))});
    }
    if(!(method==="POST"&&!id||["PUT","DELETE"].includes(method)&&id))return json({error:"Use POST to create or PUT/DELETE with a ruleset ID"},405);
    const condition=request.headers.get("if-match");if(!condition)return json({error:"Ruleset edits require an observed revision"},428);
    const match=/^"ruleset-(0|[1-9]\d{0,15})"$/.exec(condition),revision=match?Number(match[1]):NaN;
    if(!Number.isSafeInteger(revision))return json({error:"Invalid ruleset revision"},400);
    const body=await creationBody<{configuration?:RulesetInput}>(request,128*1024);
    if(!body||Array.isArray(body)||typeof body!=="object"||Object.keys(body).some(key=>key!=="configuration")||(method==="DELETE"?Object.keys(body).length>0:!body.configuration||!Array.isArray(body.configuration.bypass_actors)))return json({error:"Provide a complete configuration with explicit bypass_actors; deletion accepts an empty object"},400);
    const plan=await seq.rulesetPlan();
    if(plan.revisionTracking!=="storage"||body.configuration?.bypass_actors?.some(a=>a.actor_type==='RepositoryRole')&&!plan.roleBypass)return updating();
    const result=await seq.configureRuleset({...(id?{id:Number(id)}:{}),...(method==="DELETE"?{}:{configuration:body.configuration}),revision,credentialId:user.cli!.credentialId},user.id);
    return "conflict" in result?json({error:"Rulesets changed; export or list again before editing",revision:result.revision},412):json(result,method==="POST"?201:200);
  }catch(error){
    const message=(error as Error).message;
    if(message.includes('does not implement the method "configureRuleset"')||message.includes('does not implement the method "rulesetPlan"'))return updating();
    return json({error:message},400);
  }
}
