// SPDX-License-Identifier: MIT
import {verifySourceGraph} from './inputs.mjs';
if(process.argv.length!==2)throw Error('Usage: check-source.mjs');
await verifySourceGraph();
console.log('Pinned fork/source inputs passed. No distribution or game validation is implied.');
