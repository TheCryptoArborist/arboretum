// Offline replay and tamper checks for the saved public upgrade rehearsal.
// These tests cannot request a fresh simulation or use a wallet/provider.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bcs } from '@mysten/sui/bcs';
import { fromBase64 } from '@mysten/bcs';
import {
  EXPECTED, validateInputs, validateCandidateBuild, buildBoundaryUpgrade,
  validateUpgradeSimulation, validateAfter,
} from './upgrade-rehearsal-core.mjs';

const fixtureRoot = new URL('../verification/inventory-boundary-20261031/', import.meta.url);
const read = name => JSON.parse(fs.readFileSync(new URL(name, fixtureRoot), 'utf8'));
const captured = {
  build: read('offline/candidate-build.json'),
  proof: read('mainnet/confirmed-proof.json'), inputs: read('mainnet/inputs.json'),
  packet: read('mainnet/unsigned-upgrade.json'), simulation: read('mainnet/simulation.json'),
  after: read('mainnet/after.json'), summary: read('mainnet/summary.json'),
};
const clone = value => structuredClone(value);
const options = Object.freeze({ now: Date.parse(captured.summary.verifiedAt) });
const OTHER = '0x' + 'a'.repeat(64);
const OTHER_DIGEST = '1'.repeat(32);
const effectsOf = response => response.response.data.simulateTransaction.effects;
const packageChange = effects => effects.objectChanges.nodes.find(item => item.outputState?.asMovePackage);
const packageOf = effects => packageChange(effects).outputState.asMovePackage;
const capChange = effects => effects.objectChanges.nodes.find(item => item.address === EXPECTED.upgradeCapId);
const fields = object => object.asMoveObject.contents.json;
const isAssertion = error => error.code === 'ERR_ASSERTION';
const originalFetch = globalThis.fetch;
let networkAttempts = 0;
before(() => {
  globalThis.fetch = async () => {
    networkAttempts += 1;
    throw new Error('Network access is disabled in upgrade rehearsal regressions');
  };
});
after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(networkAttempts, 0, 'The offline suite attempted a network request');
});

async function preflight() {
  return validateInputs(clone(captured.inputs), clone(captured.proof), options);
}
function changedBase64(value) {
  const bytes = Buffer.from(value, 'base64');
  assert.ok(bytes.length > 0);
  bytes[bytes.length - 1] ^= 1;
  return bytes.toString('base64');
}
function mutateResolved(response, mutate) {
  const effects = effectsOf(response);
  const decoded = bcs.TransactionData.parse(fromBase64(effects.transaction.transactionBcs));
  mutate(decoded.V1);
  // Valid BCS is produced before the rejection assertion, so a fixture
  // serialization failure cannot masquerade as a successful guard test.
  effects.transaction.transactionBcs = bcs.TransactionData.serialize(decoded).toBase64();
}
async function rejectSimulation(mutate, expected) {
  const previous = await preflight();
  const response = clone(captured.simulation), packet = clone(captured.packet);
  const build = clone(captured.build), proof = clone(captured.proof);
  mutate(response, packet, build, proof);
  await assert.rejects(() => validateUpgradeSimulation(response, packet, previous, build, proof, options), expected);
}
async function rejectAfter(mutate, expected) {
  const previous = await preflight(), response = clone(captured.after);
  const current = await validateInputs(response, clone(captured.proof), options);
  const simulated = clone(captured.summary.simulated);
  mutate(current, response, simulated);
  assert.throws(() => validateAfter(previous, current, response, simulated), expected);
}

test('the exact approved production build is accepted with both pinned module hashes', () => {
  const result = validateCandidateBuild(clone(captured.build));
  assert.equal(result.packageDigestHex, EXPECTED.packageDigestHex);
  assert.deepEqual(result.modules.map(item => [item.name, item.sha256]),
    Object.entries(EXPECTED.prepublicationHashes));
  assert.equal(captured.build.candidateObjectVersion, 2);
  assert.equal(captured.build.migratesExistingObjects, false);
  assert.equal(captured.build.freshProductionRegistryRequired, true);
});

test('rebuilding current v12 authority produces the exact three-command unsigned upgrade', async () => {
  const packet = await buildBoundaryUpgrade(await preflight(), clone(captured.build), clone(captured.proof));
  assert.deepEqual(packet, captured.packet);
  assert.equal(packet.kindBytes, 40647);
  assert.equal(packet.transactionData.commands.length, 3);
  assert.equal(packet.transactionData.inputs.length, 3);
  assert.equal(packet.transactionData.expiration, null);
  assert.ok(Object.values(packet.transactionData.gasData).every(value => value === null));
  assert.equal(packet.startsSeason, false);
  assert.equal(packet.fundsPool, false);
  assert.equal(packet.createsRegistry, false);
  assert.equal(packet.convertsInventory, false);
});

test('the real checked simulation validates native compatibility and all 71 retained origins', async () => {
  const result = await validateUpgradeSimulation(clone(captured.simulation), clone(captured.packet),
    await preflight(), clone(captured.build), clone(captured.proof), options);
  assert.deepEqual(result, captured.summary.simulated);
  assert.equal(result.existingTypeOriginsPreserved, 71);
  assert.equal(result.newTypeOrigins, 0);
  assert.equal(result.gasEstimateMist, '338227763');
  assert.equal(result.actualGasSpentMist, '0');
  assert.equal(result.newDeploymentPackageId, null);
  assert.equal(result.newProductionRegistryId, null);
});

test('the final captured read keeps real v12 objects unchanged and the predicted package absent', async () => {
  const before = await preflight();
  const current = await validateInputs(clone(captured.after), clone(captured.proof), options);
  const actual = validateAfter(before, current, clone(captured.after), clone(captured.summary.simulated));
  assert.deepEqual(actual, captured.summary.actualAfterRehearsal);
  assert.equal(actual.actualPackageVersion, '12');
  assert.equal(actual.actualRegistryVersion, '1');
  assert.equal(actual.actualSeasonId, '0');
  assert.equal(actual.actualRewardPoolMist, '0');
  assert.equal(actual.simulatedPackageAbsentOnChain, true);
});

test('changing candidate module bytes cannot retain the reviewed build identity', () => {
  const build = clone(captured.build);
  build.modules[1].base64 = changedBase64(build.modules[1].base64);
  assert.throws(() => validateCandidateBuild(build), /Candidate module bytes changed/i);
});

test('candidate dependencies and declared package digest must match the reviewed bytes', () => {
  const dependencies = clone(captured.build);
  dependencies.dependencies[0] = OTHER;
  assert.throws(() => validateCandidateBuild(dependencies), /Candidate dependency IDs changed/i);
  const digest = clone(captured.build);
  digest.packageDigestHex = '00'.repeat(32);
  assert.throws(() => validateCandidateBuild(digest), /Build digest differs/i);
});

test('the upgrade builder rejects foreign ownership or a different current capability version', async () => {
  const owned = await preflight();
  owned.upgradeCap.owner.address.address = OTHER;
  await assert.rejects(() => buildBoundaryUpgrade(owned, clone(captured.build), clone(captured.proof)),
    /Administrator ownership changed/i);
  const version = await preflight();
  fields(version.upgradeCap).version = '13';
  await assert.rejects(() => buildBoundaryUpgrade(version, clone(captured.build), clone(captured.proof)),
    /Current upgrade authority differs/i);
});

test('changed unsigned packet metadata or declared commands are rejected', async () => {
  await rejectSimulation((_response, packet) => { packet.kindSha256 = '00'.repeat(32); }, /Unsigned upgrade packet changed/i);
  await rejectSimulation((_response, packet) => {
    packet.transactionData.commands.push(clone(packet.transactionData.commands[0]));
  }, /Unsigned upgrade packet changed/i);
});

test('resolved BCS cannot add a command or substitute the upgrade module bytes', async () => {
  await rejectSimulation(response => mutateResolved(response, tx => {
    tx.kind.ProgrammableTransaction.commands.push(clone(tx.kind.ProgrammableTransaction.commands[0]));
  }), /Resolved transaction differs from the exact upgrade/i);
  await rejectSimulation(response => mutateResolved(response, tx => {
    const upgrade = tx.kind.ProgrammableTransaction.commands[1].Upgrade;
    upgrade.modules[1] = changedBase64(upgrade.modules[1]);
  }), /Resolved transaction differs from the exact upgrade/i);
});

test('resolved sender cannot differ from the reviewed administrator', async () => {
  await rejectSimulation(response => mutateResolved(response, tx => { tx.sender = OTHER; }), /Wrong resolved sender/i);
});

test('resolved gas owner cannot be substituted', async () => {
  await rejectSimulation(response => mutateResolved(response, tx => { tx.gasData.owner = OTHER; }), /Wrong resolved gas owner/i);
});

test('gas price must be positive and the resolved budget must cover the predicted debit', async () => {
  await rejectSimulation(response => mutateResolved(response, tx => { tx.gasData.price = '0'; }),
    /Resolved gas budget and price must be positive/i);
  await rejectSimulation(response => mutateResolved(response, tx => { tx.gasData.budget = '1'; }),
    /Gas estimate must be positive and within resolved budget/i);
});

test('address-balance gas requires the exact chain-bound current-epoch expiration', async () => {
  await rejectSimulation(response => mutateResolved(response, tx => {
    tx.expiration = { None: true, $kind: 'None' };
  }), /ValidDuring expiration/i);
  await rejectSimulation(response => mutateResolved(response, tx => {
    tx.expiration.ValidDuring.chain = OTHER_DIGEST;
  }), /Expiration has wrong chain/i);
  await rejectSimulation(response => mutateResolved(response, tx => {
    tx.expiration.ValidDuring.maxEpoch = String(BigInt(tx.expiration.ValidDuring.maxEpoch) + 1n);
  }), isAssertion);
});

test('predicted published bytes must match the exact reviewed production modules', async () => {
  await rejectSimulation(response => {
    const modules = packageOf(effectsOf(response)).modules.nodes;
    const settlement = modules.find(item => item.name === 'settlement');
    settlement.bytes = changedBase64(settlement.bytes);
  }, /Predicted package bytes differ/i);
});

test('neither candidate nor predicted package may alter an existing type origin', async () => {
  const previous = await preflight();
  const build = clone(captured.build);
  build.existingTypeOriginsToPreserve[0].definingId = OTHER;
  await assert.rejects(() => buildBoundaryUpgrade(previous, build, clone(captured.proof)),
    /Candidate origins do not match/i);
  await rejectSimulation(response => {
    packageOf(effectsOf(response)).typeOrigins[0].definingId = OTHER;
  }, /Existing type origins changed/i);
});

test('predicted dependency linkage must match the observed immutable framework', async () => {
  await rejectSimulation(response => {
    packageOf(effectsOf(response)).linkage[0].version += 1;
  }, /Predicted dependency linkage differs/i);
});

test('the consumed UpgradeCap reference cannot differ from the verified current input', async () => {
  await rejectSimulation(response => { capChange(effectsOf(response)).inputState.version += 1; },
    /UpgradeCap input reference changed/i);
});

test('upgraded capability ownership policy and committed package are preserved exactly', async () => {
  await rejectSimulation(response => { capChange(effectsOf(response)).outputState.owner.address.address = OTHER; },
    /Administrator ownership changed/i);
  await rejectSimulation(response => { fields(capChange(effectsOf(response)).outputState).policy = 128; },
    /Upgrade authority, policy or committed package changed unexpectedly/i);
  await rejectSimulation(response => { fields(capChange(effectsOf(response)).outputState).package = OTHER; },
    /Upgrade authority, policy or committed package changed unexpectedly/i);
});

test('the upgrade cannot mutate an unrelated object', async () => {
  await rejectSimulation(response => {
    const effects = effectsOf(response), extra = clone(capChange(effects));
    extra.address = OTHER;
    extra.inputState.address = OTHER;
    extra.outputState.address = OTHER;
    effects.objectChanges.nodes.push(extra);
  }, /Unexpected non-upgrade object changes/i);
});

test('gameplay events or shared gameplay inputs are not permitted in the upgrade', async () => {
  await rejectSimulation(response => {
    effectsOf(response).events.nodes.push({ sender: { address: EXPECTED.sender },
      contents: { type: { repr: `${EXPECTED.packageId}::settlement::SeasonStarted` },
        json: { season_id: '1', start_ms: '1' } } });
  }, /Upgrade must not emit gameplay or setup events/i);
  await rejectSimulation(response => {
    effectsOf(response).unchangedConsensusObjects.nodes.push({ __typename: 'ConsensusObjectRead' });
  }, /Upgrade must not consume shared gameplay objects/i);
});

test('only the exact predicted administrator gas debit is accepted', async () => {
  await rejectSimulation(response => {
    effectsOf(response).balanceChangesJson[0].amount = '-1';
  }, /Unexpected non-gas balance movement/i);
  await rejectSimulation(response => {
    const changes = effectsOf(response).balanceChangesJson;
    changes.push({ address: OTHER, coinType: changes[0].coinType, amount: '1' });
  }, /Unexpected non-gas balance movement/i);
});

test('simulated effects cannot be relabeled as a confirmed transaction receipt', async () => {
  await rejectSimulation(response => {
    effectsOf(response).checkpoint = clone(response.response.data.checkpoint);
  }, /Simulation must not be presented as a confirmed transaction/i);
});

test('simulation network identity and capture freshness are checked independently', async () => {
  await rejectSimulation(response => { response.response.data.genesis.digest = OTHER_DIGEST; }, /Wrong network/i);
  await rejectSimulation(response => {
    response.capturedAt = new Date(options.now - EXPECTED.maxAgeMs - 1).toISOString();
  }, /Missing or stale simulation capture time/i);
});

test('a predicted package found on-chain invalidates the unchanged-state conclusion', async () => {
  await rejectAfter((_current, response, simulated) => {
    response.response.data.simulatedPackage = { address: simulated.simulatedPackageIdForVerificationOnly, version: 13 };
  }, /predicted package unexpectedly exists on-chain/i);
});

test('post-read sequence timestamp and real object contents must all establish later unchanged state', async () => {
  await rejectAfter((current, _response, simulated) => {
    current.checkpoint.sequenceNumber = simulated.checkpoint.sequenceNumber - 1;
  }, /Post-read checkpoint predates simulation/i);
  await rejectAfter((current, _response, simulated) => {
    current.checkpoint.timestamp = new Date(Number(simulated.postObservationNotBeforeMs) - 1).toISOString();
  }, /Post-read checkpoint predates the completed simulation request/i);
  await rejectAfter(current => { fields(current.registry).reward_pool = '1'; }, /registry real state changed/i);
});
