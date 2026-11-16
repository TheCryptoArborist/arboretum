// Read-only capture of the real Season 3 predecessor. No signing or execution.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as prior from '../settlement-cycle-three/common.mjs';
import { PLANT_FIELDS_QUERY, plantFieldVariables } from '../settlement-cycle-three/care-core.mjs';
const folder = fileURLToPath(new URL('./verification/mainnet/', import.meta.url));
assert(!fs.existsSync(folder), 'Preserve existing evidence; do not overwrite a capture.');
fs.mkdirSync(folder, { recursive: true });
const claimDigest = '7MLWVofmU1wnoNjqVwYEm3WxRpjMF8AddqojX48YYFKL';
const seedId = '0x949d45fc9e2861ec3c75d46ff2e6b277c9692470ab5b929fc76d6dffe5b9ed1b';
function save(name, value) { fs.writeFileSync(folder + name + '.json', JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
async function read(name, query, variables) {
  assert(!/\b(mutation|executeTransaction|simulateTransaction)\b/.test(query));
  const request = { query, variables };
  save(name + '-request', request);
  const response = await fetch(prior.EXPECTED.endpoint, { method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(request), signal: AbortSignal.timeout(45000) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert(!result.errors?.length, JSON.stringify(result.errors)); assert(result.data);
  save(name, result); return result;
}
assert.equal(prior.PROOF_QUERY.split(prior.EXPECTED.previousClaimDigest).length, 2);
const proofQuery = prior.PROOF_QUERY.replace(prior.EXPECTED.previousClaimDigest, claimDigest).replace('ThirdSeasonProof', 'FourthSeasonProof');
const proof = await read('previous-claim-proof', proofQuery, prior.PROOF_VARIABLES);
const inputs = await read('inputs', prior.INPUTS_QUERY, prior.INPUT_VARIABLES);
const data = prior.dataOf(inputs);
assert.equal(data.registries.nodes.length, 1);
const registry = data.registries.nodes[0], r = prior.contents(registry);
assert.equal(r.current_season_id, '3'); assert.equal(r.reward_pool, '0');
assert.equal(r.settlement.paid_mist, '7000000'); assert.equal(r.settlement.processed_growth_points, '10');
const seed = data.ownedSeeds.nodes.find(item => item.address === seedId), s = prior.contents(seed);
assert(seed); assert.equal(s.season_id, '3'); assert.equal(s.reward_processed, true);
assert.equal(s.watering_streak, '1'); assert.equal(s.last_watered_ms, s.planted_at_ms);
assert.equal(data.ownedSeeds.pageInfo.hasNextPage, false); assert.equal(data.ownedSeeds.nodes.length, 3);
const vars = plantFieldVariables({ registry, checkpoint: data.checkpoint }, prior.EXPECTED.previousNftId);
await read('fields', PLANT_FIELDS_QUERY, vars);
const summary = { capturedAt: new Date().toISOString(), readOnly: true, submittedTransactions: 0,
  previousClaimDigest: claimDigest, previousSeedId: seedId, currentSeason: r.current_season_id,
  previousStoredStartMs: r.season_start_ms, previousCutoffMs: r.settlement.season_end_ms,
  previousClaimDeadlineMs: r.settlement.claim_deadline_ms, previousPlantedAtMs: s.planted_at_ms,
  processedSeeds: data.ownedSeeds.nodes.length, checkpoint: data.checkpoint,
  priorClaimStatus: proof.data.priorClaimTransaction.effects.status,
  wateringRecorded: s.last_watered_ms !== s.planted_at_ms };
save('summary', summary); console.log(JSON.stringify(summary, null, 2));
