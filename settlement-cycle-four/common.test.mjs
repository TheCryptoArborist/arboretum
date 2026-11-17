// Protocol boundary and predecessor-proof checks use captured public reads.
// Altered timestamps below are offline fixtures; they never authorize live work.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPECTED, contents, dataOf, inspectState, SUI_TYPE } from './common.mjs';
import { prepareRollover } from './rollover-core.mjs';
import { observedRolloverInputs, observedRolloverProof } from './rollover-fixtures.mjs';

const clone = value => structuredClone(value);
const change = (proof, id) => dataOf(proof).priorClaimTransaction.effects.objectChanges.nodes.find(x => x.address === id);
const effects = proof => dataOf(proof).priorClaimTransaction.effects;
const reward = proof => effects(proof).objectChanges.nodes.find(x => x.idCreated);
const capturedNow = () => Date.parse(dataOf(observedRolloverInputs()).checkpoint.timestamp);
const inspect = (inputs = observedRolloverInputs(), proof = observedRolloverProof(), nowMs = capturedNow()) =>
  inspectState(inputs, proof, { nowMs });
const resetReadyMs = Number(BigInt(EXPECTED.previousCutoffMs) + BigInt(EXPECTED.reviewWindowMs));
function offlineSnapshotAt(chainTimeMs) {
  const inputs = observedRolloverInputs(), proof = observedRolloverProof();
  const sequenceNumber = inputs.data.checkpoint.sequenceNumber + 100;
  inputs.data.checkpoint = { sequenceNumber, timestamp: new Date(chainTimeMs).toISOString() };
  proof.data.checkpoint = { sequenceNumber: sequenceNumber - 1, timestamp: new Date(chainTimeMs).toISOString() };
  contents(inputs.data.clock).timestamp_ms = String(chainTimeMs);
  return { inputs, proof, synthetic: true };
}

test('a state before the actual claim cannot authorize rollover even when its timer says ready', async () => {
  for (const time of [resetReadyMs - 1, resetReadyMs, resetReadyMs + 10000]) {
    const f = offlineSnapshotAt(time);
    await assert.rejects(inspect(f.inputs, f.proof, time), /predates the Season 3 claim/);
  }
  const ready = await inspect();
  assert.equal(ready.status, 'rollover-ready');
  const packet = await prepareRollover(ready);
  assert.equal(packet.seasonId, '4');
  assert.deepEqual(packet.transaction.getData().commands.map(x => x.MoveCall.function), ['reset_season', 'start_season_for_duration']);
});

test('completed predecessor proof and three processed Seeds remain mandatory after the timer elapses', async () => {
  for (const id of [EXPECTED.olderSeedId, EXPECTED.secondSeedId, EXPECTED.previousSeedId]) {
    const f = offlineSnapshotAt(capturedNow());
    f.inputs.data.ownedSeeds.nodes = f.inputs.data.ownedSeeds.nodes.filter(x => x.address !== id);
    await assert.rejects(inspect(f.inputs, f.proof, capturedNow()), /Seed.*missing|Season [12] Seed/);
  }
  const f = offlineSnapshotAt(capturedNow());
  delete f.proof.data.priorClaimTransaction;
  await assert.rejects(inspect(f.inputs, f.proof, capturedNow()), /claim proof is missing/);
});

for (const [name, mutate] of [
  ['transaction bytes', p => { p.data.priorClaimTransaction.transactionBcs = p.data.upgradeTransaction.transactionBcs; }],
  ['effects transaction bytes', p => { effects(p).transaction.transactionBcs = ''; }],
  ['receipt sender', p => { p.data.priorClaimTransaction.sender.address = EXPECTED.treasuryWallet; }],
  ['effects sender', p => { effects(p).transaction.sender.address = EXPECTED.treasuryWallet; }],
  ['unsuccessful execution', p => { effects(p).status = 'FAILURE'; }],
  ['an unindexed receipt', p => { effects(p).checkpoint = null; }],
  ['the previous Registry season', p => { contents(change(p, EXPECTED.registryId).inputState).current_season_id = '1'; }],
  ['the previous Seed season', p => { contents(change(p, EXPECTED.previousSeedId).inputState).season_id = '1'; }],
  ['a different NFTree', p => { contents(change(p, EXPECTED.previousSeedId).inputState).sapling_id = EXPECTED.registryId; }],
  ['unearned watering points', p => { contents(change(p, EXPECTED.previousSeedId).inputState).cutoff_growth_points = '24'; }],
  ['a transferred Seed input', p => { change(p, EXPECTED.previousSeedId).inputState.owner.address.address = EXPECTED.treasuryWallet; }],
  ['the original reward pool', p => { contents(change(p, EXPECTED.registryId).inputState).reward_pool = '14000000'; }],
  ['a substituted owner table', p => { contents(change(p, EXPECTED.registryId).inputState).player_growth.id = EXPECTED.registryId; }],
  ['unprocessed entitlement output', p => { contents(change(p, EXPECTED.previousSeedId).outputState).reward_processed = false; }],
  ['remaining output Growth Points', p => { contents(change(p, EXPECTED.previousSeedId).outputState).growth_points = '10'; }],
  ['incomplete paid settlement', p => { contents(change(p, EXPECTED.registryId).outputState).settlement.paid_mist = '0'; }],
  ['unprocessed settlement points', p => { contents(change(p, EXPECTED.registryId).outputState).settlement.processed_growth_points = '9'; }],
  ['the reward coin recipient', p => { reward(p).outputState.owner.address.address = EXPECTED.treasuryWallet; }],
  ['the reward coin amount', p => { contents(reward(p).outputState).balance = '1'; }],
  ['an incomplete event list', p => { effects(p).events.nodes.pop(); }],
  ['the entitlement event points', p => { effects(p).events.nodes[1].contents.json.eligible_growth_points = '24'; }],
  ['a premature historical Clock', p => { contents(effects(p).unchangedConsensusObjects.nodes[0].object).timestamp_ms = String(BigInt(EXPECTED.previousCutoffMs) - 1n); }],
  ['an expired historical Clock', p => { contents(effects(p).unchangedConsensusObjects.nodes[0].object).timestamp_ms = String(BigInt(EXPECTED.previousClaimDeadlineMs) + 1n); }],
  ['an extra consensus read', p => { effects(p).unchangedConsensusObjects.nodes.push(clone(effects(p).unchangedConsensusObjects.nodes[0])); }],
  ['a different output version', p => { effects(p).lamportVersion++; }],
  ['a missing historical input', p => { change(p, EXPECTED.previousSeedId).inputState = null; }],
  ['duplicate changes', p => { effects(p).objectChanges.nodes.push(clone(change(p, EXPECTED.previousSeedId))); }],
  ['an incomplete change inventory', p => { effects(p).objectChanges.pageInfo.hasNextPage = true; }],
  ['a different payout currency', p => { effects(p).balanceChangesJson[0].coinType = SUI_TYPE.replace('sui::SUI', 'other::COIN'); }],
  ['a different network fee', p => { effects(p).gasEffects.gasSummary.storageRebate++; }],
]) test(`exact captured Season 3 claim rejects tampering with ${name}`, async () => {
  const proof = observedRolloverProof(); mutate(proof);
  await assert.rejects(inspect(observedRolloverInputs(), proof));
});
