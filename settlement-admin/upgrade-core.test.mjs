import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { toBase64 } from '@mysten/bcs';
import { Transaction } from '@mysten/sui/transactions';
import {
  EXPECTED, loadReviewedUpgrade, validateWalletTransaction, validatePreflight,
  validateSimulation, validateConfirmedUpgrade, assertAdministrator, assertExpectedOrigin,
  TIP_QUERY, INPUTS_QUERY, SIMULATION_QUERY, CONFIRM_QUERY,
} from './upgrade-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const capture = path.join(here, '../settlement-integration/release/evidence/20261031-review');
const read = name => JSON.parse(fs.readFileSync(path.join(capture, name), 'utf8'));
const kind = fs.readFileSync(path.join(capture, 'upgrade-kind.b64'), 'utf8');
const json = value => structuredClone(value);
const snapshot = () => read('chain-inputs.json');
const tip = () => read('checkpoint.json');
const sim = () => read('upgrade-simulation.json');
const fresh = response => ({ now: Date.parse(response.response.data.checkpoint.timestamp) });
const effects = response => response.response.data.simulateTransaction.effects;
const outputPackage = response => effects(response).objectChanges.nodes.find(c => c.outputState?.asMovePackage).outputState.asMovePackage;
const capChange = response => effects(response).objectChanges.nodes.find(c => c.address === EXPECTED.upgradeCap.objectId);
const elsewhere = '0x' + '1'.repeat(64);

test('exact approved kind reconstructs the independent captured simulation payload and leaves gas to the wallet', async () => {
  const loaded = await loadReviewedUpgrade(kind);
  assert.deepEqual(loaded.simulationTransaction, read('unsigned-upgrade.json').transaction);
  assert.equal(loaded.kindSha256, EXPECTED.kindSha256);
  assert.equal(await validateWalletTransaction(loaded.transaction), true);
  assert.equal(loaded.transaction.getData().commands.length, 3);
  assert.ok(Object.values(loaded.transaction.getData().gasData).every(x => x === null));
});

test('tampered or appended packet bytes fail before a wallet request can be built', async () => {
  const bytes = Buffer.from(kind, 'base64');
  bytes[50] ^= 1;
  await assert.rejects(loadReviewedUpgrade(bytes.toString('base64')), /differs from the transaction/);
  await assert.rejects(loadReviewedUpgrade(Buffer.concat([Buffer.from(kind, 'base64'), Buffer.from([0])]).toString('base64')),
    /differs from the transaction/);
  await assert.rejects(loadReviewedUpgrade('https://example.com/packet'), /not valid base64/);
});

test('wallet request rejects changed sender, added command, or pre-fixed gas', async () => {
  let { transaction } = await loadReviewedUpgrade(kind);
  transaction.setSender(elsewhere);
  await assert.rejects(validateWalletTransaction(transaction), /administrator account/);
  ({ transaction } = await loadReviewedUpgrade(kind));
  transaction.transferObjects([transaction.gas], elsewhere);
  await assert.rejects(validateWalletTransaction(transaction), /differs from the approved/);
  ({ transaction } = await loadReviewedUpgrade(kind));
  transaction.setGasBudget(500000000);
  await assert.rejects(validateWalletTransaction(transaction), /selected by the wallet/);
});

test('administrator, chain, and origin gates reject any other signing context', () => {
  assertAdministrator(EXPECTED.sender, 'sui:mainnet');
  assertExpectedOrigin('https://www.treegrow.xyz');
  assert.throws(() => assertAdministrator(elsewhere), /administrator account/);
  assert.throws(() => assertAdministrator(EXPECTED.sender, 'sui:testnet'), /mainnet/);
  for (const origin of ['https://treegrow.xyz', 'http://localhost:8000', 'https://www.treegrow.xyz.example.com']) {
    assert.throws(() => assertExpectedOrigin(origin), /only at/);
  }
});

test('fresh independently captured preflight is accepted without network access', async () => {
  const result = await validatePreflight(snapshot(), tip(), fresh(tip()));
  assert.equal(result.status, 'ready');
  assert.equal(result.packageVersion, 11);
  assert.deepEqual(result.upgradeCap, EXPECTED.upgradeCap);
});

test('preflight rejects stale, future, mixed-checkpoint, incomplete and failed RPC responses', async () => {
  await assert.rejects(validatePreflight(snapshot(), tip(), { now: fresh(tip()).now + 120001 }), /too old/);
  await assert.rejects(validatePreflight(snapshot(), tip(), { now: fresh(tip()).now - 30001 }), /too old/);
  const changed = snapshot();
  changed.response.data.checkpoint.sequenceNumber++;
  await assert.rejects(validatePreflight(changed, tip(), fresh(tip())), /one checkpoint/);
  const incomplete = snapshot();
  incomplete.response.data.deployed.asMovePackage.modules.pageInfo.hasNextPage = true;
  await assert.rejects(validatePreflight(incomplete, tip(), fresh(tip())), /incomplete/);
  const failed = snapshot();
  failed.response.errors = [{ message: 'partial result' }];
  await assert.rejects(validatePreflight(failed, tip(), fresh(tip())), /response contains an error/);
});

test('preflight rejects wrong network, owner, policy, object reference or package version', async () => {
  const mutations = [
    d => { d.upgradeCap.owner.address.address = elsewhere; },
    d => { d.upgradeCap.asMoveObject.contents.json.policy = 128; },
    d => { d.upgradeCap.version++; },
    d => { d.upgradeCap.digest = 'wrong'; },
    d => { d.upgradeCap.asMoveObject.contents.json.package = elsewhere; },
    d => { d.upgradeCap.asMoveObject.contents.json.version = '13'; },
    d => { d.legacyAdminCap.owner.address.address = elsewhere; },
    d => { d.registry.asMoveObject.contents.json.admin = elsewhere; },
  ];
  for (const mutate of mutations) {
    const changed = snapshot(); mutate(changed.response.data);
    await assert.rejects(validatePreflight(changed, tip(), fresh(tip())));
  }
  const wrong = tip();
  wrong.response.data.genesis.digest = '11111111111111111111111111111111';
  await assert.rejects(validatePreflight(snapshot(), wrong, fresh(tip())), /not Sui mainnet/);
});

test('preflight rejects altered legacy code or anchored asset types', async () => {
  const changed = snapshot();
  changed.response.data.deployed.asMovePackage.modules.nodes[0].bytes = 'AA==';
  await assert.rejects(validatePreflight(changed, tip(), fresh(tip())), /legacy module differs/);
  const alteredType = snapshot();
  alteredType.response.data.deployed.asMovePackage.typeOrigins[0].definingId = elsewhere;
  await assert.rejects(validatePreflight(alteredType, tip(), fresh(tip())), /legacy asset type origins/);
});

test('an observed version-12 cap produces a disabled already-upgraded state and actual receipt digest', async () => {
  const changed = snapshot();
  changed.response.data.upgradeCap.asMoveObject.contents.json.version = '12';
  changed.response.data.upgradeCap.asMoveObject.contents.json.package = elsewhere;
  const result = await validatePreflight(changed, tip(), fresh(tip()));
  assert.equal(result.status, 'already-upgraded');
  assert.equal(result.packageId, elsewhere);
  assert.equal(result.digest, changed.response.data.upgradeCap.previousTransaction.digest);
});

test('checked simulation accepts exact candidate bytes, both type sets and the sole gas debit', async () => {
  const result = await validateSimulation(sim(), fresh(sim()));
  assert.equal(result.status, 'simulated');
  assert.equal(result.gasEstimateMist, '337998763');
  assert.equal(result.gasEstimateSui, '0.337998763');
  assert.equal(result.packageId, undefined, 'Simulation must not return a deployment configuration ID');
});

test('simulation rejects failed status, incomplete effects, a transfer, capability reassignment and excessive fee', async () => {
  const mutations = [
    d => { d.status = 'FAILURE'; },
    d => { d.executionError = { message: 'aborted' }; },
    d => { d.objectChanges.pageInfo.hasNextPage = true; },
    d => { d.balanceChangesJson.push({ address: elsewhere, amount: '1', coinType: d.balanceChangesJson[0].coinType }); },
    d => { d.balanceChangesJson[0].coinType = '0x2::fake::FAKE'; },
    d => { d.balanceChangesJson[0].amount = '-1'; },
    d => { d.objectChanges.nodes.find(c => c.address === EXPECTED.upgradeCap.objectId).outputState.owner.address.address = elsewhere; },
  ];
  for (const mutate of mutations) {
    const changed = sim(); mutate(effects(changed));
    await assert.rejects(validateSimulation(changed, fresh(changed)));
  }
  const costly = sim();
  const gas = effects(costly).gasEffects.gasSummary;
  gas.computationCost = String(BigInt(gas.computationCost) + 100000000n);
  effects(costly).balanceChangesJson[0].amount = '-437998763';
  await assert.rejects(validateSimulation(costly, fresh(costly)), /exceeds 0.400000000 SUI/);
});

test('simulation rejects mutated module bytes, wrong origins, duplicate type names or extra object changes', async () => {
  let changed = sim();
  outputPackage(changed).modules.nodes[1].bytes = 'AA==';
  await assert.rejects(validateSimulation(changed, fresh(changed)), /bytecode differs/);
  changed = sim();
  outputPackage(changed).typeOrigins.find(x => x.module === 'settlement').definingId = EXPECTED.originalPackageId;
  await assert.rejects(validateSimulation(changed, fresh(changed)), /do not originate/);
  changed = sim();
  const types = outputPackage(changed).typeOrigins.filter(x => x.module === 'settlement');
  types[1].struct = types[0].struct;
  await assert.rejects(validateSimulation(changed, fresh(changed)), /Duplicate/);
  changed = sim();
  effects(changed).objectChanges.nodes.push({ address: elsewhere, idCreated: true, idDeleted: false, inputState: null, outputState: null });
  await assert.rejects(validateSimulation(changed, fresh(changed)), /unexpected object/);
});

async function syntheticConfirmation({ gasObjects = false } = {}) {
  // Strictly local synthetic fixture: this is not on-chain evidence and no keys
  // or signatures are created. It exercises full TransactionData validation.
  const { transaction } = await loadReviewedUpgrade(kind);
  transaction.setGasOwner(EXPECTED.sender);
  transaction.setGasPrice(1000);
  transaction.setGasBudget(500000000);
  const gasId = '0x' + 'a'.repeat(64);
  transaction.setGasPayment(gasObjects ? [{ objectId: gasId, version: '123', digest: EXPECTED.upgradeCap.digest }] : []);
  if (!gasObjects) transaction.setExpiration({ Epoch: 9999 });
  const transactionBcs = toBase64(await transaction.build());
  const digest = await transaction.getDigest();
  const simulation = sim();
  const fx = json(effects(simulation));
  fx.checkpoint = { ...simulation.response.data.checkpoint };
  if (gasObjects) {
    const gasState = { address: gasId, version: 123, digest: EXPECTED.upgradeCap.digest,
      owner: { __typename: 'AddressOwner', address: { address: EXPECTED.sender } },
      asMoveObject: { contents: { type: { repr: '0x' + '0'.repeat(63) + '2::coin::Coin<0x' + '0'.repeat(63) + '2::sui::SUI>' }, json: {} } } };
    fx.objectChanges.nodes.push({ address: gasId, idCreated: false, idDeleted: false, inputState: gasState,
      outputState: { ...json(gasState), version: 124 } });
  }
  const before = snapshot().response.data;
  return { response: { data: { checkpoint: simulation.response.data.checkpoint,
    transaction: { digest, sender: { address: EXPECTED.sender }, transactionBcs, effects: fx },
    upgradeCap: json(capChange(simulation).outputState), legacyAdminCap: before.legacyAdminCap,
    registry: before.registry,
  } }, digest };
}

test('confirmed receipt checks full transaction digest, sender, exact kind and published package effects', async () => {
  const fixture = await syntheticConfirmation();
  const result = await validateConfirmedUpgrade(fixture.response, fixture.digest);
  assert.equal(result.status, 'confirmed');
  assert.equal(result.digest, fixture.digest);
  assert.equal(result.packageId, result.typeOrigin);
  assert.equal(result.gasEstimateMist, '337998763');
});

test('real-receipt validator rejects simulation and checkpoint-free effects', async () => {
  await assert.rejects(validateConfirmedUpgrade(sim(), 'unused'), /Simulation data cannot/);
  const fixture = await syntheticConfirmation();
  delete fixture.response.data.transaction.effects.checkpoint;
  await assert.rejects(validateConfirmedUpgrade(fixture.response, fixture.digest), /not yet visible/);
});

test('real-receipt validator rejects substituted digest, sender, bytes or newly published code', async () => {
  let fixture = await syntheticConfirmation();
  await assert.rejects(validateConfirmedUpgrade(fixture.response, EXPECTED.upgradeCap.digest), /different transaction/);
  fixture = await syntheticConfirmation();
  fixture.response.data.transaction.sender.address = elsewhere;
  await assert.rejects(validateConfirmedUpgrade(fixture.response, fixture.digest), /wrong sender/);
  fixture = await syntheticConfirmation();
  fixture.response.data.transaction.transactionBcs = toBase64(new Uint8Array(10));
  await assert.rejects(validateConfirmedUpgrade(fixture.response, fixture.digest));
  fixture = await syntheticConfirmation();
  fixture.response.data.transaction.effects.objectChanges.nodes.find(c => c.outputState?.asMovePackage)
    .outputState.asMovePackage.modules.nodes[1].bytes = 'AA==';
  await assert.rejects(validateConfirmedUpgrade(fixture.response, fixture.digest), /bytecode differs/);
});

test('receipt permits only gas-payment object effects named in its exact full transaction', async () => {
  const fixture = await syntheticConfirmation({ gasObjects: true });
  assert.equal((await validateConfirmedUpgrade(fixture.response, fixture.digest)).status, 'confirmed');
  const changed = json(fixture.response);
  changed.data.transaction.effects.objectChanges.nodes.at(-1).address = elsewhere;
  await assert.rejects(validateConfirmedUpgrade(changed, fixture.digest), /unexpected object/);
});

test('exported network operations remain read queries and simulation retains validation and gas selection', () => {
  for (const query of [TIP_QUERY, INPUTS_QUERY, SIMULATION_QUERY, CONFIRM_QUERY]) {
    assert.match(query, /^query /);
    assert.doesNotMatch(query, /mutation|executeTransaction/);
  }
  assert.match(SIMULATION_QUERY, /checksEnabled: true, doGasSelection: true/);
});

test('confirmed TransactionData digest calculation agrees with the independently captured historical upgrade', async () => {
  const historical = JSON.parse(fs.readFileSync(path.join(capture, '../20261020-initial/historical-upgrade-bcs-control.json'), 'utf8'));
  const actual = historical.response.data.transaction;
  assert.equal(await Transaction.from(actual.transactionBcs).getDigest(), actual.digest);
});
