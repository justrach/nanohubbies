import {install,parseInstallOptions} from './src/install.mjs';
try {console.log(await install(parseInstallOptions(process.argv.slice(2))));}
catch(error){console.error(`nh installer: ${error.message}`);process.exitCode=1;}
