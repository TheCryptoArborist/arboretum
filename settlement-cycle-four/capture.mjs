// Read-only evidence capture. No wallet, signing, simulation or submission.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'graphql';
import { EXPECTED, PROOF_QUERY, PROOF_VARIABLES, INPUTS_QUERY, INPUT_VARIABLES, inspectState, contents } from './common.mjs';
import { PLANT_FIELDS_QUERY, plantFieldVariables, attachPlantFields } from './care-core.mjs';
import { prepareRollover } from './rollover-core.mjs';
const directory = new URL('./verification/mainnet/', import.meta.url);
fs.mkdirSync(directory, { recursive: true });
const save = (name, value) => fs.writeFileSync(new URL(name + '.json', directory), JSON.stringify(value, (_,v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n');
async function read(name, query, variables) {
  assert(parse(query).definitions.filter(d => d.kind === 'OperationDefinition').every(d => d.operation === 'query'));
  assert(!/\b(executeTransaction|simulateTransaction)\b/.test(query));
  save(name + '-request', {query, variables});
  const response = await fetch(EXPECTED.endpoint, {method: 'POST', headers: {'Content-Type': 'application/json','Cache-Control':'no-store'}, body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(45000)});
  assert.equal(response.status,200);
  const result=await response.json();
  save(name,{capturedAt:new Date().toISOString(),response:result});
  assert(!result.errors?.length,JSON.stringify(result.errors));
  return result;
}
const proof=await read('previous-claim-proof',PROOF_QUERY,PROOF_VARIABLES);
const inputs=await read('inputs',INPUTS_QUERY,INPUT_VARIABLES);
const nowMs=Date.now();
const state=await inspectState(inputs,proof,{nowMs});
assert.equal(state.status,'rollover-ready');
assert.equal(state.ownedSeeds.length,3);
assert.equal(contents(state.registry).current_season_id,'3');
assert.equal(state.confirmedPreviousClaim.digest,EXPECTED.previousClaimDigest);
const fields=await read('fields',PLANT_FIELDS_QUERY,plantFieldVariables(state,EXPECTED.previousNftId));
attachPlantFields(state,fields,EXPECTED.previousNftId);
const packet=await prepareRollover(state);
const summary={capturedAt:new Date().toISOString(),readOnly:true,checkpoint:state.checkpoint,status:state.status,
  previousClaim:state.confirmedPreviousClaim,processedSeeds:state.ownedSeeds.map(x=>({id:x.address,seasonId:contents(x).season_id,processed:contents(x).reward_processed})),
  nextSeason:packet.seasonId,kindSha256:packet.kindSha256,simulations:0,signatures:0,submittedTransactions:0};
save('summary',summary);console.log(JSON.stringify(summary,null,2));
