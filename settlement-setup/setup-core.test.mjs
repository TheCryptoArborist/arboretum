import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { fromBase58, toBase58, toBase64 } from '@mysten/bcs';
import { Transaction } from '@mysten/sui/transactions';
import {
  SETUP_EXPECTED as EXPECTED, loadReviewedSetup, validateWalletTransaction, validateSetupPreflight,
  validateSetupSimulation, validateConfirmedSetup, assertExpectedOrigin, assertAdministrator,
  TIP_QUERY, INPUTS_QUERY, INPUT_VARIABLES, SIMULATION_QUERY, CONFIRM_QUERY, CONFIRM_VARIABLES,
} from './setup-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.join(here, '../settlement-integration/release/evidence');
const review = path.join(evidence, '20261031-empty-registry-review');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const kind = fs.readFileSync(path.join(review, 'setup-kind.b64'), 'utf8');
const clone = value => structuredClone(value);
const empty = () => ({ nodes: [], pageInfo: { hasNextPage: false, endCursor: null } });
const elsewhere = '0x' + '1'.repeat(64);
const otherDigest = '11111111111111111111111111111111';
const SUI = '0x' + '0'.repeat(63) + '2';
const fee = '5632932';
const dataOf = value => (value.response ?? value).data;
const fresh = value => ({ now: Date.parse(dataOf(value).checkpoint.timestamp) });

function simulation() {
  const raw = clone(read(path.join(review, 'setup-simulation.json')).response);
  raw.data.registry = raw.data.legacyRegistry;
  raw.data.registries = raw.data.existingRegistries;
  raw.data.adminCaps = empty();
  delete raw.data.legacyRegistry;
  delete raw.data.existingRegistries;
  return raw;
}
function inputs() {
  const sim = simulation().data;
  const upgrade = read(path.join(evidence, '20261031-confirmed-upgrade/receipt.json')).response.data;
  return { data: { checkpoint: clone(sim.checkpoint), reviewCheckpoint: clone(sim.checkpoint), genesis: clone(sim.genesis),
    upgradeTransaction: clone(upgrade.transaction), upgradeCap: clone(sim.upgradeCap), legacyAdminCap: clone(sim.legacyAdminCap),
    registry: clone(sim.registry), registries: empty(), adminCaps: empty() } };
}
function tip() {
  const { checkpoint, genesis } = simulation().data;
  return { data: { checkpoint, genesis } };
}
const effects = raw => dataOf(raw).simulateTransaction?.effects ?? dataOf(raw).transaction.effects;
const change = (raw, type) => effects(raw).objectChanges.nodes.find(node => node.outputState?.asMoveObject?.contents?.type?.repr === type);
const registry = raw => change(raw, EXPECTED.registryType).outputState;
const admin = raw => change(raw, EXPECTED.adminCapType).outputState;
const legacy = raw => effects(raw).objectChanges.nodes.find(node => node.address === EXPECTED.legacyAdminCap.objectId);
const content = object => object.asMoveObject.contents.json;

// These fixtures are intentionally local and synthetic: no network, signatures,
// private keys or submitted transactions. The recorded mainnet simulation gives
// the semantic effects; fresh local TransactionData exercises digest, gas input,
// version and receipt validation without treating simulation IDs as deployed.
async function syntheticConfirmation({ gasObjects = false, actualFee = fee } = {}) {
  const { transaction } = await loadReviewedSetup(kind);
  transaction.setGasOwner(EXPECTED.sender);
  transaction.setGasPrice(1000);
  transaction.setGasBudget(50000000);
  const gasId = '0x' + 'a'.repeat(64);
  const gasVersion = '1100000000';
  transaction.setGasPayment(gasObjects ? [{ objectId: gasId, version: gasVersion, digest: EXPECTED.upgradeCap.digest }] : []);
  if (!gasObjects) transaction.setExpiration({ Epoch: 9999 });
  const transactionBcs = toBase64(await transaction.build()), txDigest = await transaction.getDigest();
  const sim = simulation(), fx = clone(effects(sim));
  const remap = new Map(fx.objectChanges.nodes.filter(node => node.idCreated).map((node, index) =>
    [node.address, '0x' + String(index + 21).padStart(64, '0')]));
  function replace(value) {
    if (typeof value === 'string') return remap.get(value) ?? value;
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
    return value;
  }
  const actualEffects = replace(fx);
  actualEffects.checkpoint = { sequenceNumber: sim.data.checkpoint.sequenceNumber, timestamp: sim.data.checkpoint.timestamp };
  const version = Number(BigInt(gasObjects ? gasVersion : EXPECTED.legacyAdminCap.version) + 1n);
  for (const node of actualEffects.objectChanges.nodes) {
    if (!node.outputState) continue;
    node.outputState.version = version;
    delete node.outputState.previousTransaction;
    if (node.outputState.owner?.__typename === 'Shared') node.outputState.owner.initialSharedVersion = version;
  }
  const gasSummary = actualEffects.gasEffects.gasSummary;
  gasSummary.computationCost = String(BigInt(gasSummary.computationCost) + BigInt(actualFee) - BigInt(fee));
  actualEffects.balanceChangesJson[0].amount = String(-BigInt(actualFee));
  if (gasObjects) {
    const gasState = { address: gasId, version: Number(gasVersion), digest: EXPECTED.upgradeCap.digest,
      owner: { __typename: 'AddressOwner', address: { address: EXPECTED.sender } },
      asMoveObject: { contents: { type: { repr: `${SUI}::coin::Coin<${SUI}::sui::SUI>` },
        json: { id: gasId, balance: '100000000' } } } };
    actualEffects.objectChanges.nodes.push({ address: gasId, idCreated: false, idDeleted: false,
      inputState: gasState, outputState: { ...clone(gasState), version, digest: otherDigest,
        asMoveObject: { contents: { type: clone(gasState.asMoveObject.contents.type),
          json: { id: gasId, balance: String(100000000n - BigInt(actualFee)) } } } } });
  }
  const response = inputs();
  response.data.transaction = { digest: txDigest, sender: { address: EXPECTED.sender }, transactionBcs, effects: actualEffects };
  function live(object) {
    return { ...clone(object), previousTransaction: { digest: txDigest,
      effects: { status: 'SUCCESS', checkpoint: clone(actualEffects.checkpoint) } } };
  }
  response.data.registries.nodes = [live(registry(response))];
  response.data.adminCaps.nodes = [live(admin(response))];
  response.data.legacyAdminCap = live(legacy(response).outputState);
  return { response, digest: txDigest };
}

test('exact reviewed 154-byte kind independently rebuilds the captured single setup call with wallet-selected gas', async () => {
  const loaded = await loadReviewedSetup(kind);
  assert.equal(loaded.kindSha256, EXPECTED.kindSha256);
  assert.deepEqual(loaded.simulationTransaction, read(path.join(review, 'unsigned-setup.json')).transaction);
  assert.equal(await validateWalletTransaction(loaded.transaction), true);
  const data = loaded.transaction.getData();
  assert.equal(data.commands.length, 1);
  assert.equal(data.inputs.length, 1);
  assert.ok(Object.values(data.gasData).every(value => value === null));
  assert.equal(data.expiration, null);
});

test('tampered bytes, extra commands, sender, gas, expiration and signing origins fail closed', async () => {
  const bytes = Buffer.from(kind, 'base64'); bytes[10] ^= 1;
  await assert.rejects(loadReviewedSetup(bytes.toString('base64')), { code: 'PACKET_MISMATCH' });
  await assert.rejects(loadReviewedSetup(Buffer.concat([bytes, Buffer.of(0)]).toString('base64')), { code: 'PACKET_MISMATCH' });
  await assert.rejects(loadReviewedSetup('https://invalid.example/setup'), { code: 'PACKET_MISMATCH' });
  for (const mutate of [
    tx => tx.setSender(elsewhere), tx => tx.setGasBudget(10000000), tx => tx.setGasOwner(EXPECTED.sender),
    tx => tx.setExpiration({ Epoch: 10 }), tx => tx.transferObjects([tx.gas], elsewhere),
  ]) {
    const { transaction } = await loadReviewedSetup(kind); mutate(transaction);
    await assert.rejects(validateWalletTransaction(transaction));
  }
  assertAdministrator(EXPECTED.sender); assertExpectedOrigin(EXPECTED.origin);
  assert.throws(() => assertAdministrator(elsewhere), { code: 'WRONG_ACCOUNT' });
  assert.throws(() => assertAdministrator(EXPECTED.sender, 'sui:testnet'), { code: 'WRONG_NETWORK' });
  for (const origin of ['http://localhost:8000', 'https://treegrow.xyz', 'https://www.treegrow.xyz.evil.example']) {
    assert.throws(() => assertExpectedOrigin(origin), { code: 'WRONG_ORIGIN' });
  }
});

test('preflight requires the real confirmed v12 upgrade, exact authority reference and complete empty global inventories', async () => {
  const result = await validateSetupPreflight(inputs(), tip(), fresh(tip()));
  assert.equal(result.status, 'ready');
  assert.equal(result.packageId, EXPECTED.packageId);
  assert.deepEqual(result.legacyAdminCap, EXPECTED.legacyAdminCap);
});

test('preflight rejects stale or mixed snapshots, wrong network and partial RPC responses', async () => {
  const badInputs = [
    d => { d.reviewCheckpoint.sequenceNumber++; }, d => { d.checkpoint.sequenceNumber--; },
    d => { d.genesis.digest = otherDigest; }, d => { delete d.genesis; },
    d => { d.checkpoint.timestamp = 'invalid'; },
  ];
  for (const mutate of badInputs) {
    const value = inputs(); mutate(value.data);
    await assert.rejects(validateSetupPreflight(value, tip(), fresh(tip())));
  }
  await assert.rejects(validateSetupPreflight(inputs(), tip(), { now: fresh(tip()).now + 120001 }), { code: 'STALE_REVIEW' });
  await assert.rejects(validateSetupPreflight(inputs(), tip(), { now: fresh(tip()).now - 30001 }), { code: 'STALE_REVIEW' });
  const partial = inputs(); partial.errors = [{ message: 'partial response' }];
  await assert.rejects(validateSetupPreflight(partial, tip(), fresh(tip())), { code: 'RPC_RESPONSE_ERROR' });
  const collision = inputs(), genesis = fromBase58(EXPECTED.genesisDigest);
  genesis[31] ^= 1; // Same four-byte chain identifier, different full genesis.
  collision.data.genesis.digest = toBase58(genesis);
  await assert.rejects(validateSetupPreflight(collision, tip(), fresh(tip())), { code: 'WRONG_NETWORK' });
});

test('preflight rejects superseded contract, wrong administrator, changed capability ref, bytecode or anchored type origins', async () => {
  const mutations = [
    d => { d.upgradeCap.version++; }, d => { content(d.upgradeCap).package = elsewhere; },
    d => { content(d.upgradeCap).policy = 128; }, d => { d.upgradeCap.owner.address.address = elsewhere; },
    d => { d.legacyAdminCap.version++; }, d => { d.legacyAdminCap.digest = otherDigest; },
    d => { content(d.legacyAdminCap).extra = 'changed'; }, d => { d.legacyAdminCap.owner.address.address = elsewhere; },
    d => { content(d.registry).admin = elsewhere; },
    d => { d.upgradeTransaction.digest = otherDigest; }, d => { d.upgradeTransaction.effects.checkpoint = null; },
    d => { d.upgradeTransaction.effects.objectChanges.nodes.find(x => x.outputState?.asMovePackage)
      .outputState.asMovePackage.modules.nodes[1].bytes = 'AA=='; },
    d => { d.upgradeTransaction.effects.objectChanges.nodes.find(x => x.outputState?.asMovePackage)
      .outputState.asMovePackage.typeOrigins[0].definingId = elsewhere; },
  ];
  for (const mutate of mutations) {
    const value = inputs(); mutate(value.data);
    await assert.rejects(validateSetupPreflight(value, tip(), fresh(tip())));
  }
});

test('an existing Registry blocks creation across browsers and exposes only an unverified recovery candidate', async () => {
  const value = await syntheticConfirmation();
  const result = await validateSetupPreflight(value.response, tip(), fresh(tip()));
  assert.equal(result.status, 'already-created');
  assert.equal(result.digest, value.digest);
  assert.equal(result.registryId, registry(value.response).address);
  delete value.response.data.registries.nodes[0].previousTransaction;
  assert.equal((await validateSetupPreflight(value.response, tip(), fresh(tip()))).digest, null);
});

test('multiple, incomplete, missing, malformed or misbound inventories always disable creation', async () => {
  const mutations = [
    d => { d.registries.nodes.push(clone(d.registries.nodes[0])); },
    d => { d.adminCaps.nodes.push(clone(d.adminCaps.nodes[0])); },
    d => { d.registries.pageInfo.hasNextPage = true; }, d => { d.adminCaps.pageInfo.hasNextPage = true; },
    d => { d.registries.nodes = []; }, d => { d.adminCaps.nodes = []; },
    d => { d.registries.nodes = [null]; }, d => { content(d.adminCaps.nodes[0]).registry_id = elsewhere; },
    d => { delete content(d.registries.nodes[0]).player_growth; },
    d => { d.registries.nodes[0].owner = { __typename: 'Immutable' }; },
  ];
  for (const mutate of mutations) {
    const value = await syntheticConfirmation(); mutate(value.response.data);
    await assert.rejects(validateSetupPreflight(value.response, tip(), fresh(tip())), { code: 'EXISTING_SETUP_CONFLICT' });
  }
});

test('checked simulation validates all nine changes, one event, empty tables and legitimate legacy-cap version advance', async () => {
  const value = simulation();
  const result = await validateSetupSimulation(value, fresh(value));
  assert.equal(result.status, 'simulated');
  assert.equal(result.gasEstimateMist, fee);
  assert.equal(result.gasEstimateSui, '0.005632932');
  assert.equal(result.registryId, undefined, 'Simulated IDs never become deployed IDs');
  assert.equal(result.adminCapId, undefined);
  assert.equal(result.simulationOnly.registryId, registry(value).address);
  assert.notEqual(legacy(value).inputState.version, legacy(value).outputState.version);
  assert.deepEqual(content(legacy(value).inputState), content(legacy(value).outputState));
});

test('simulation rejects extra effects, changed legacy authority, bad Lamport versions and malformed tables', async () => {
  const mutations = [
    x => { effects(x).status = 'FAILURE'; }, x => { effects(x).executionError = { message: 'Move abort' }; },
    x => { effects(x).objectChanges.pageInfo.hasNextPage = true; },
    x => { effects(x).objectChanges.nodes.push(clone(effects(x).objectChanges.nodes[0])); },
    x => { effects(x).objectChanges.nodes.push({ address: elsewhere, idCreated: true, idDeleted: false, inputState: null, outputState: null }); },
    x => { legacy(x).inputState.version++; }, x => { legacy(x).outputState.version--; },
    x => { legacy(x).outputState.digest = legacy(x).inputState.digest; },
    x => { content(legacy(x).outputState).extra = true; }, x => { legacy(x).outputState.owner.address.address = elsewhere; },
    x => { registry(x).owner.initialSharedVersion++; }, x => { admin(x).version++; },
    x => { content(registry(x)).player_growth.id = content(registry(x)).seeds_by_owner.id; },
    x => { effects(x).objectChanges.nodes.find(node => node.idCreated && node.outputState === null).address = elsewhere; },
    x => { effects(x).objectChanges.nodes.find(node => node.idCreated && node.outputState === null).idDeleted = true; },
  ];
  for (const mutate of mutations) {
    const value = simulation(); mutate(value);
    await assert.rejects(validateSetupSimulation(value, fresh(value)));
  }
});

test('simulation rejects season start, funding, imported state, different event or extra balance transfer', async () => {
  const mutations = [
    x => { content(registry(x)).current_season_id = '1'; }, x => { content(registry(x)).season_start_ms = '1'; },
    x => { content(registry(x)).reward_pool = '1'; }, x => { content(registry(x)).treasury = '1'; },
    x => { content(registry(x)).total_seeds = '1'; }, x => { content(registry(x)).seeds_by_owner.size = '1'; },
    x => { content(registry(x)).paused = true; }, x => { content(registry(x)).settlement = {}; },
    x => { content(admin(x)).registry_id = elsewhere; },
    x => { effects(x).events.nodes[0].contents.json.legacy_cap_id = elsewhere; },
    x => { effects(x).events.nodes.push(clone(effects(x).events.nodes[0])); },
    x => { effects(x).events.pageInfo.hasNextPage = true; },
    x => { effects(x).balanceChangesJson.push({ address: elsewhere, coinType: `${SUI}::sui::SUI`, amount: '1' }); },
    x => { effects(x).balanceChangesJson[0].amount = '-1'; },
  ];
  for (const mutate of mutations) {
    const value = simulation(); mutate(value);
    await assert.rejects(validateSetupSimulation(value, fresh(value)));
  }
});

test('simulation rechecks current inventory and rejects stale, wrong-network or over-ceiling review', async () => {
  let value = simulation();
  value.data.registries.nodes.push(clone(registry(value))); value.data.adminCaps.nodes.push(clone(admin(value)));
  await assert.rejects(validateSetupSimulation(value, fresh(value)), { code: 'EXISTING_SETUP_CONFLICT' });
  value = simulation(); value.data.genesis.digest = otherDigest;
  await assert.rejects(validateSetupSimulation(value, fresh(value)), { code: 'WRONG_NETWORK' });
  value = simulation();
  await assert.rejects(validateSetupSimulation(value, { now: fresh(value).now + 120001 }), { code: 'STALE_REVIEW' });
  const gas = effects(value).gasEffects.gasSummary;
  gas.computationCost = String(BigInt(gas.computationCost) + 10000001n - BigInt(fee));
  effects(value).balanceChangesJson[0].amount = '-10000001';
  await assert.rejects(validateSetupSimulation(value, fresh(value)), { code: 'GAS_INCREASED' });
  await assert.rejects(validateSetupSimulation(value, { ...fresh(value), maxGasMist: '10000001' }), /cannot exceed/);
});

test('actual receipt validates exact kind/full digest and returns independently derived real object IDs and actual fee', async () => {
  const { response, digest } = await syntheticConfirmation({ actualFee: '6000000' });
  const result = await validateConfirmedSetup(response, digest, fresh(response));
  assert.equal(result.status, 'confirmed'); assert.equal(result.digest, digest);
  assert.notEqual(result.registryId, registry(simulation()).address);
  assert.notEqual(result.adminCapId, admin(simulation()).address);
  assert.equal(result.packageId, EXPECTED.packageId);
  assert.equal(result.gasEstimateMist, '6000000');
  assert.equal(result.currentEmpty, true); assert.equal(result.hasAdvanced, false);
});

test('actual receipt allows exact gas-payment refs and their higher Lamport version, without pinning simulated gas', async () => {
  const { response, digest } = await syntheticConfirmation({ gasObjects: true, actualFee: '12000000' });
  const result = await validateConfirmedSetup(response, digest, fresh(response));
  assert.equal(result.status, 'confirmed'); assert.equal(result.gasAboveReviewCeiling, true);
  assert.equal(result.gasEstimateMist, '12000000');
  assert.equal(registry(response).version, 1100000001);
});

test('receipt rejects simulated/checkpoint-free data, substituted digest, sender, gas owner, bytes or kind', async () => {
  await assert.rejects(validateConfirmedSetup(simulation(), EXPECTED.upgradeDigest, fresh(simulation())), { code: 'CONFIRMATION_MISMATCH' });
  const mutations = [
    x => { x.response.data.transaction.effects.checkpoint = null; },
    x => { x.response.data.transaction.digest = otherDigest; },
    x => { x.response.data.transaction.sender.address = elsewhere; },
    x => { x.response.data.transaction.transactionBcs = 'AAAA'; },
    x => { x.response.simulatedIdsAreNotDeployedIds = true; },
  ];
  for (const mutate of mutations) {
    const fixture = await syntheticConfirmation(); mutate(fixture);
    await assert.rejects(validateConfirmedSetup(fixture.response, fixture.digest, fresh(fixture.response)));
  }
  for (const mutate of [tx => tx.setGasOwner(elsewhere), tx => tx.setSender(elsewhere),
    tx => tx.transferObjects([tx.gas], elsewhere)]) {
    const fixture = await syntheticConfirmation();
    const tx = Transaction.from(fixture.response.data.transaction.transactionBcs); mutate(tx);
    fixture.response.data.transaction.transactionBcs = toBase64(await tx.build());
    fixture.digest = await tx.getDigest(); fixture.response.data.transaction.digest = fixture.digest;
    await assert.rejects(validateConfirmedSetup(fixture.response, fixture.digest, fresh(fixture.response)));
  }
});

test('receipt rejects unauthorized gas effects, wrong payment refs, gas-owner changes or version rollback', async () => {
  const mutations = [
    d => { d.transaction.effects.objectChanges.nodes.at(-1).address = elsewhere; },
    d => { d.transaction.effects.objectChanges.nodes.at(-1).inputState.version--; },
    d => { d.transaction.effects.objectChanges.nodes.at(-1).inputState.digest = otherDigest; },
    d => { d.transaction.effects.objectChanges.nodes.at(-1).outputState.owner.address.address = elsewhere; },
    d => { d.transaction.effects.objectChanges.nodes.at(-1).outputState.version--; },
    d => { d.transaction.effects.objectChanges.nodes.pop(); },
    d => { d.registries.nodes[0].version--; },
    d => { d.adminCaps.nodes[0].digest = otherDigest; },
    d => { d.legacyAdminCap.version--; },
    d => { d.registries.nodes[0].owner.initialSharedVersion++; },
  ];
  for (const mutate of mutations) {
    const fixture = await syntheticConfirmation({ gasObjects: true }); mutate(fixture.response.data);
    await assert.rejects(validateConfirmedSetup(fixture.response, fixture.digest, fresh(fixture.response)));
  }
});

test('historical empty creation remains confirmed after legitimate later Registry activity and capability metadata advancement', async () => {
  const fixture = await syntheticConfirmation(), data = fixture.response.data;
  for (const object of [data.registries.nodes[0], data.adminCaps.nodes[0], data.legacyAdminCap]) {
    object.version += 10; object.digest = otherDigest;
    object.previousTransaction.digest = otherDigest;
  }
  content(data.registries.nodes[0]).current_season_id = '1';
  content(data.registries.nodes[0]).season_start_ms = '1000';
  const result = await validateConfirmedSetup(fixture.response, fixture.digest, fresh(fixture.response));
  assert.equal(result.status, 'confirmed'); assert.equal(result.currentEmpty, false); assert.equal(result.hasAdvanced, true);
  assert.equal((await validateSetupPreflight(fixture.response, tip(), fresh(tip()))).status, 'already-created');
});

test('later state cannot contradict authority, capability binding, shared version, known schema or same-version receipt', async () => {
  const mutations = [
    d => { content(d.registries.nodes[0]).current_season_id = '1'; },
    d => { d.adminCaps.nodes[0].version++; content(d.adminCaps.nodes[0]).registry_id = elsewhere; },
    d => { d.registries.nodes[0].version++; content(d.registries.nodes[0]).admin = elsewhere; },
    d => { d.registries.nodes[0].version++; delete content(d.registries.nodes[0]).total_seeds; },
    d => { d.legacyAdminCap.version++; content(d.legacyAdminCap).extra = 'changed'; },
  ];
  for (const mutate of mutations) {
    const fixture = await syntheticConfirmation(); mutate(fixture.response.data);
    await assert.rejects(validateConfirmedSetup(fixture.response, fixture.digest, fresh(fixture.response)));
  }
});

test('exported operations are read-only, checked simulation, exact type inventories and one current snapshot', () => {
  for (const query of [TIP_QUERY, INPUTS_QUERY, SIMULATION_QUERY, CONFIRM_QUERY]) {
    assert.match(query, /^query Setup/); assert.doesNotMatch(query, /\bmutation\b|executeTransaction/);
  }
  assert.match(SIMULATION_QUERY, /checksEnabled: true, doGasSelection: true/);
  assert.match(INPUTS_QUERY, /reviewCheckpoint: checkpoint\(sequenceNumber: \$checkpoint\)/);
  assert.match(INPUTS_QUERY, /registries: objects\(first: 2, filter: \{ type: \$registryType \}\)/);
  assert.match(INPUTS_QUERY, /adminCaps: objects\(first: 2, filter: \{ type: \$adminCapType \}\)/);
  assert.doesNotMatch(INPUTS_QUERY, /atCheckpoint/);
  assert.equal(INPUT_VARIABLES.registryType, EXPECTED.registryType);
  assert.equal(CONFIRM_VARIABLES.upgradeDigest, EXPECTED.upgradeDigest);
});
