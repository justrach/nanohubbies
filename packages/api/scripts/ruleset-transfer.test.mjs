import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const built=await build({entryPoints:[new URL('../src/repository/ruleset-transfer.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false});
const {importRuleset,exportRuleset}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const ref={name:'Tag protection',target:'tag',enforcement:'active',conditions:{ref_name:{include:['~ALL'],exclude:[]}},rules:[{type:'deletion'},{type:'non_fast_forward'}]};
test('portable configurations preserve all supported restrictions and exceptions without IDs or bypass accounts',()=>{
 for(const input of [ref,{...ref,target:'branch',conditions:{ref_name:{include:['~DEFAULT_BRANCH'],exclude:[]}},rules:[{type:'required_linear_history'},{type:'creation'}]},
  {name:'File restrictions',target:'push',enforcement:'active',rules:[{type:'file_path_restriction',parameters:{restricted_file_paths:['private/**'],allowed_file_paths:['private/public.md']}},{type:'max_file_size',parameters:{max_file_size:1,allowed_file_paths:['**/wrapper/*.jar']}},{type:'file_extension_restriction',parameters:{restricted_file_extensions:['.key']}},{type:'max_file_path_length',parameters:{max_file_path_length:255}}]}]){
  const stored={...input,id:41,bypass_actors:[{actor_type:'User',actor_id:'private-account-id',bypass_mode:'always'}]};
  const portable=exportRuleset(stored),before=structuredClone(portable);
  assert.equal('id' in portable,false);assert.equal('bypass_actors' in portable,false);assert.equal(JSON.stringify(portable).includes('private-account-id'),false);
  const imported=importRuleset(JSON.parse(JSON.stringify(portable)));
  assert.deepEqual(imported.configuration.bypass_actors,[]);assert.deepEqual(exportRuleset(imported.configuration),portable);
  assert.deepEqual(portable,before,'Preview does not mutate source configuration');
 }
});
test('GitHub all-repositories recipe selectors map explicitly to one repository and source metadata is identified',()=>{
 // https://github.com/github/ruleset-recipes/blob/a1f8e53ec12857637e8762e689a3abc255ff2c2f/tag-rulesets/prevent-tag-delete.json
 const source={...ref,id:123,source:'source/repository',source_type:'Repository',conditions:{...ref.conditions,repository_name:{include:['~ALL'],exclude:[]}}};
 const before=structuredClone(source),preview=importRuleset(source);
 assert.deepEqual(exportRuleset(preview.configuration),ref);assert.equal(preview.notes.length,2);
 assert.match(preview.notes[0],/id, source, source_type/);assert.match(preview.notes[1],/this repository only/);assert.deepEqual(source,before);
 const push=importRuleset({name:'All-repository file rule',target:'push',enforcement:'active',conditions:{repository_name:{include:['~ALL'],exclude:[]}},rules:[{type:'max_file_size',parameters:{max_file_size:1}}]});
 assert.equal(push.configuration.conditions,undefined);assert.equal(push.configuration.rules.length,1);
});
test('unsupported policy, selective repository conditions and imported bypass authority are never discarded',()=>{
 for(const bad of [null,[],42,'{}',{...ref,unexpected_restriction:true},{...ref,enforcement:'unsupported'},
  {...ref,rules:[...ref.rules,{type:'required_code_scanning'}]},
  {...ref,conditions:{...ref.conditions,repository_id:{repository_ids:[123]}}},
  {...ref,conditions:{...ref.conditions,repository_name:{include:['protected-*'],exclude:[]}}},
  {...ref,conditions:{...ref.conditions,repository_name:{include:['~ALL'],exclude:['private']}}},
  {...ref,bypass_actors:[{actor_type:'User',actor_id:'owner',bypass_mode:'always'}]},
  {...ref,bypass_actors:null}, {...ref,rules:[{type:'deletion',parameters:{unknown:true}}]}])assert.throws(()=>importRuleset(bad));
 assert.deepEqual(importRuleset({...ref,bypass_actors:[]}).configuration.bypass_actors,[]);
});
