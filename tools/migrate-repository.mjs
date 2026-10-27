/** Lossless committed Git import, using a repository Git credential. */
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {migrate} from '../packages/cli/src/migrate.mjs';
export {migrate};
if(resolve(process.argv[1]??'')===fileURLToPath(import.meta.url)){
 const [source,remote,handle='git']=process.argv.slice(2);
 if(!source||!remote||!process.env.NANOHUB_TOKEN)throw Error('Usage: NANOHUB_TOKEN=... node tools/migrate-repository.mjs SOURCE REMOTE [HANDLE]');
 console.log(JSON.stringify(await migrate(source,remote,handle,process.env.NANOHUB_TOKEN),null,2));
}
