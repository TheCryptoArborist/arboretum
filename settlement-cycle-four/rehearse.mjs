// One checked, unsigned mainnet simulation; no signing or execution path.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parse} from 'graphql';
import {EXPECTED,INPUTS_QUERY,INPUT_VARIABLES,SIMULATION_QUERY,inspectState,contents,reference,dataOf} from './common.mjs';
import {prepareRollover,validateRolloverSimulation} from './rollover-core.mjs';
const directory=new URL('./verification/mainnet/',import.meta.url);
const load=name=>JSON.parse(fs.readFileSync(new URL(name+'.json',directory),'utf8'));
const save=(name,value)=>fs.writeFileSync(new URL(name+'.json',directory),JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');
const proof=load('previous-claim-proof'),inputs=load('inputs');
const state=await inspectState(inputs,proof,{nowMs:Date.now()});
assert.equal(state.status,'rollover-ready');
const packet=await prepareRollover(state);
async function read(name,query,variables){
  assert(parse(query).definitions.filter(d=>d.kind==='OperationDefinition').every(d=>d.operation==='query'));
  assert(!/\bexecuteTransaction\b/.test(query));
  save(name+'-request',{query,variables});
  const response=await fetch(EXPECTED.endpoint,{method:'POST',headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(45000)});
  assert.equal(response.status,200);const result=await response.json();
  save(name,{capturedAt:new Date().toISOString(),response:result});
  assert(!result.errors?.length,JSON.stringify(result.errors));return result;
}
const simulated=await read('rollover-simulation',SIMULATION_QUERY,{...INPUT_VARIABLES,transaction:packet.simulationTransaction});
const checked=await validateRolloverSimulation(simulated,packet,state,proof,{nowMs:Date.now()});
assert.equal(checked.status,'simulated');assert.equal(checked.seasonId,'4');
const after=await read('after-simulation',INPUTS_QUERY,INPUT_VARIABLES);
const actual=await inspectState(after,proof,{nowMs:Date.now()});
assert.equal(actual.status,'rollover-ready');
assert.deepEqual(reference(actual.registry),reference(state.registry));
assert.deepEqual(reference(actual.adminCap),reference(state.adminCap));
assert.deepEqual(actual.ownedSeeds.map(reference),state.ownedSeeds.map(reference));
assert.equal(contents(actual.registry).current_season_id,'3');
const result={capturedAt:new Date().toISOString(),status:'checked unsigned simulation passed',simulatedResult:checked,
  actualAfterCheckpoint:actual.checkpoint,actualSeasonId:'3',actualStateUnchanged:true,
  simulationCount:1,signatures:0,submittedTransactions:0};
save('rehearsal-summary',result);console.log(JSON.stringify({...result,simulatedResult:{status:checked.status,seasonId:checked.seasonId,gasEstimateMist:checked.gasEstimateMist}},null,2));
