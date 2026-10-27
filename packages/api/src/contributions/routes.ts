import {pusher} from '../tokens';
import {sameOrigin,canWrite,requireTeam,type TeamAccess} from '../team/access';
import {createMcpHandler,McpServer} from '@modelcontextprotocol/server';
import {CfWorkerJsonSchemaValidator} from '@modelcontextprotocol/server/validators/cf-worker';
import * as z from 'zod/v4';
import {verifyWorkLinks} from './links';
import type {ContributionAgent,ContributionFilter,WorkLink} from './types';
import {archiveLocked} from '../repository/archive';
const privateHeaders={'Cache-Control':'private, no-store','Vary':'Cookie, Authorization'};
export function contributionFilter(value:URLSearchParams):ContributionFilter {
 if([...value.keys()].some(key=>!['before','limit','pull','commit'].includes(key)))throw Error('Unknown contribution filter');
 const number=(key:string)=>{const raw=value.get(key);if(raw===null)return;if(!/^[1-9]\d{0,15}$/.test(raw)||!Number.isSafeInteger(Number(raw)))throw Error('Invalid contribution filter');return Number(raw);};
 return{before:number('before'),limit:number('limit'),pull:number('pull'),commit:value.get('commit')??undefined};
}
export async function contributionRoute(env:Env,request:Request,trunk:string,access:TeamAccess|null) {
 if(!access)return Response.json({error:'Repository membership is required'},{status:404,headers:privateHeaders});
 if(request.method!=='GET')return Response.json({error:'Use GET'},{status:405,headers:privateHeaders});
 try{return Response.json(await env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk)).contributions(contributionFilter(new URL(request.url).searchParams)),{headers:privateHeaders});}
 catch(error){return Response.json({error:(error as Error).message},{status:400,headers:privateHeaders});}
}
const id=z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
const linkSchema=z.discriminatedUnion('kind',[z.object({kind:z.literal('commit'),sha:z.string().regex(/^[a-f0-9]{40}$/)}).strict(),z.object({kind:z.literal('pull'),number:z.number().int().min(1).max(1e9)}).strict()]);
const filterSchema=z.object({before:z.number().int().positive().optional(),limit:z.number().int().min(1).max(50).optional(),pull:z.number().int().positive().optional(),commit:z.string().regex(/^[a-f0-9]{40}$/).optional()}).strict();
const read={readOnlyHint:true,openWorldHint:false},write={readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false};
export async function agentMcpRoute(env:Env,request:Request,trunk:string,handle:string,access:TeamAccess|null) {
 const credential=await pusher(env,request,trunk),headers={...privateHeaders,'WWW-Authenticate':'Bearer realm="nanohub-agent-mcp"'};
 if(!access||!credential?.agentId||credential.agent!==handle)return Response.json({error:'Use this repository agent’s scoped credential'},{status:401,headers});
 if(request.headers.has('origin')&&!sameOrigin(env,request))return Response.json({error:'Untrusted MCP request origin'},{status:403,headers:privateHeaders});
 const agent:ContributionAgent={id:credential.agentId,handle,type:credential.agentType??'Agent',owner:credential.owner},seq=env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk)),origin=new URL(request.url).origin;
 const authorizeWrite=async()=>{
  const current=await requireTeam(env,request,trunk);if(!canWrite(current))throw Error('Current repository write access is required to record agent work');
  await env.HUB.get(env.HUB.idFromName('hub')).assertRepositoryWritable(trunk);
 };
 const response=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value)}],structuredContent:value as Record<string,unknown>});
 const tool=async(work:()=>Promise<unknown>)=>{try{return response(await work());}catch(error){return{isError:true,content:[{type:'text' as const,text:(error as Error).message}]};}};
 // Auth is fresh for every transport request. No initialized client session,
 // clientInfo label or model name can replace this registered principal.
 const handler=createMcpHandler(()=>{
  const server=new McpServer({name:'nanohub-agent-work',version:'1.0.0'},{jsonSchemaValidator:new CfWorkerJsonSchemaValidator(),capabilities:{resources:{subscribe:false,listChanged:false},tools:{listChanged:false}}});
  server.registerTool('nanohub_context',{description:'Read the authenticated repository and registered agent identity. Client/model labels are reported metadata, not vendor attestation.',inputSchema:z.object({}).strict(),annotations:read},()=>tool(async()=>{const archived=archiveLocked(await env.HUB.get(env.HUB.idFromName('hub')).repositoryArchive(trunk));return{repository:trunk,agent,repositoryUrl:`${origin}/t/${trunk}`,activityUrl:`${origin}/t/${trunk}/room#contributions`,canRecord:canWrite(access)&&!archived,archived,scope:'Work tracking only; these tools do not approve, merge, change settings or read secrets.'};}));
  server.registerTool('nanohub_start_work',{description:'Start an owned work record visible to repository members. Reuse the same lowercase UUID sessionId when retrying. Client/model fields are explicitly self-reported.',inputSchema:z.object({sessionId:id,title:z.string().min(1).max(160),client:z.object({name:z.string().min(1).max(80),version:z.string().min(1).max(80).optional(),model:z.string().min(1).max(120).optional()}).strict().optional()}).strict(),annotations:write},input=>tool(async()=>{await authorizeWrite();return seq.startAgentWork(agent,input);}));
  server.registerTool('nanohub_report_work',{description:'Record progress, a blocker or completion in your own work session. Reuse eventId on retry. Commit/PR links must belong to this repository; links describe reported work, not authorship or review approval.',inputSchema:z.object({sessionId:id,eventId:id,state:z.enum(['working','blocked','completed']),summary:z.string().min(1).max(4000),links:z.array(linkSchema).max(20).default([])}).strict(),annotations:write},input=>tool(async()=>{await verifyWorkLinks(env,trunk,input.links as WorkLink[]);await authorizeWrite();return seq.reportAgentWork(agent,input);}));
  server.registerTool('nanohub_get_work',{description:'Read one of this authenticated agent’s work sessions.',inputSchema:z.object({sessionId:id}).strict(),annotations:read},input=>tool(()=>seq.agentWork(input.sessionId,agent.id)));
  server.registerTool('nanohub_list_activity',{description:'Read recorded agent work and credential-attributed Git ref updates in this repository. Optional pull/commit filters match explicit links.',inputSchema:filterSchema,annotations:read},input=>tool(()=>seq.contributions(input)));
  const uri=`nanohub://repository/${trunk}/agent-activity`;
  server.registerResource('Agent activity',uri,{description:'Authenticated repository agent work; client/model metadata and work links are self-reported.',mimeType:'application/json'},async()=>({contents:[{uri,mimeType:'application/json',text:JSON.stringify(await seq.contributions())}]}));
  return server;
 },{legacy:'stateless',keepAliveMs:0,maxSubscriptions:0,maxRequestBodySize:64*1024});
 const result=await handler.fetch(request);const resultHeaders=new Headers(result.headers);for(const[key,value]of Object.entries(privateHeaders))resultHeaders.set(key,value);
 return new Response(result.body,{status:result.status,statusText:result.statusText,headers:resultHeaders});
}
