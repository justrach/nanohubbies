import {isAbsolute,join} from 'node:path';

export const acceptanceGates = [
  ['install','bun install --frozen-lockfile --offline'],
  ['unit','bun run --filter @swarm/api test:unit'],
  ['repository','bun run test:repository'],
  ['cli','bun run test:cli'],
  ['access','bun run --filter @swarm/api test:access'],
  ['hosting','bun run --filter @swarm/api test:hosting'],
  ['fixtures','bun run test:hosted-fixture && bun run test:hosted-recovery'],
  ['build','bun run --filter @swarm/web build && bun run --filter @swarm/api test:cli-deployment-distribution && bun run --filter @swarm/api test:cli-secret-distribution'],
  ['check','bun run check'],
];
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";

/** Commands are trusted operator definitions. Group the complete command so
 * both sides of && share one log and one failure boundary. */
export function acceptanceGateScript(gates=acceptanceGates,logDirectory='/tmp') {
  if(!Array.isArray(gates)||!gates.length||gates.length>32||!isAbsolute(logDirectory)||logDirectory.includes('\0'))throw Error('Invalid acceptance gate configuration');
  const seen=new Set();
  return gates.map(entry=>{
    if(!Array.isArray(entry)||entry.length!==2)throw Error('Invalid acceptance gate');
    const [name,command]=entry;
    if(typeof name!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(name)||seen.has(name)||typeof command!=='string'||!command.trim()||command.length>8192||command.includes('\0'))throw Error('Invalid acceptance gate');
    seen.add(name);
    const log=quote(join(logDirectory,'gate-'+name+'.log'));
    return `printf '\\nNANOHUB_GATE_START ${name}\\n'
if ( ${command} ) > ${log} 2>&1; then tail -n 8 ${log}; else tail -n 35 ${log}; exit 1; fi
printf '\\nNANOHUB_GATE_PASS ${name}\\n'`;
  }).join('\n');
}
