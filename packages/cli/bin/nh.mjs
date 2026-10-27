#!/usr/bin/env bun
import {run} from '../src/main.mjs';
try { await run(process.argv.slice(2)); }
catch(error) { const message=String(error.message).replace(/nh(?:g|c|d)_[a-f0-9]+/gi,'[redacted]');if(process.argv.includes('--json'))console.log(JSON.stringify({error:message}));else console.error(`nh: ${message}`);process.exitCode=1; }
