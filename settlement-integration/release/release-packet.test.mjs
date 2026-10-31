import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { bcs } from '@mysten/sui/bcs';
import { buildUpgrade, verifyPacket } from './build-upgrade.mjs';
import { deriveSetupInputs, buildSetup } from './prepare-setup.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const capture = path.join(here, 'evidence/20261020-initial');
const read = name => JSON.parse(fs.readFileSync(path.join(capture, name), 'utf8'));
const inputs = read('verified-inputs.json');
const reviewed = read('unsigned-upgrade.json');
const build = JSON.parse(fs.readFileSync(path.join(here, '../../contract-payout/evidence/build-result.json'), 'utf8'));
const sha256 = value => createHash('sha256').update(value).digest('hex');

test('unsigned upgrade deterministically reproduces captured BCS with only the UpgradeCap as an object input', async () => {
  const tx = buildUpgrade(inputs, build);
  const bytes = await tx.build({onlyTransactionKind: true});
  assert.equal(sha256(bytes), reviewed.transactionKindSha256);
  const ptb = bcs.TransactionKind.parse(bytes).ProgrammableTransaction;
  assert.deepEqual(ptb.inputs.filter(input => input.Object).map(input => input.Object.ImmOrOwnedObject), [inputs.upgradeCap]);
  assert.equal(ptb.commands.length, 3);
  assert.equal(ptb.commands[0].MoveCall.function, 'authorize_upgrade');
  assert.equal(ptb.commands[2].MoveCall.function, 'commit_upgrade');
  assert.deepEqual(ptb.commands[1].Upgrade.ticket.NestedResult, [0, 0]);
  assert.deepEqual(ptb.commands[2].MoveCall.arguments[1].NestedResult, [1, 0]);
  assert.equal(ptb.commands[1].Upgrade.package, inputs.packageId);
  assert.deepEqual(ptb.commands[1].Upgrade.dependencies, inputs.dependencies);
  assert.equal(bcs.U8.parse(Buffer.from(ptb.inputs[1].Pure.bytes, 'base64')), 0);
  assert.equal(Buffer.from(bcs.vector(bcs.U8).parse(Buffer.from(ptb.inputs[2].Pure.bytes, 'base64'))).toString('hex'), inputs.packageDigestHex);
  assert.equal(tx.getData().gasData.budget, null);
  assert.equal(tx.getData().gasData.payment, null);
});

test('upgrade builder rejects tampered module bytes', () => {
  const modified = structuredClone(build);
  modified.modules[1].base64 = Buffer.from('unreviewed').toString('base64');
  assert.throws(() => buildUpgrade(inputs, modified));
});

test('a changed simulation payload is rejected even if the recorded kind hash was preserved', async () => {
  const tx = buildUpgrade(inputs, build);
  const kind = await tx.build({onlyTransactionKind: true});
  verifyPacket(reviewed, tx, kind);
  const modified = structuredClone(reviewed);
  modified.transaction.sender = '0x' + '1'.repeat(64);
  assert.throws(() => verifyPacket(modified, tx, kind), /does not encode the reviewed/);
});

function setupFixture() {
  // Synthetic actual-chain-shaped fixture used only to test the future helper.
  // It is never saved as chain evidence or passed to a network.
  const simulation = read('upgrade-simulation.json');
  const before = read('chain-inputs.json').response.data;
  const effects = simulation.response.data.simulateTransaction.effects;
  const created = effects.objectChanges.nodes.find(change => change.outputState?.asMovePackage);
  const cap = effects.objectChanges.nodes.find(change => change.address === inputs.upgradeCap.objectId).outputState;
  const confirmation = {transactionsSubmitted: 0, signaturesProduced: 0, response: {data: {
    transaction: {digest: 'synthetic-test-fixture', sender: {address: inputs.sender}, effects: {
      ...structuredClone(effects), checkpoint: {sequenceNumber: 123, timestamp: 'synthetic-test-fixture'},
    }},
    legacyAdminCap: structuredClone(before.legacyAdminCap), upgradeCap: structuredClone(cap),
  }}};
  const hashes = Object.fromEntries(created.outputState.asMovePackage.modules.nodes
    .map(module => [module.name, sha256(Buffer.from(module.bytes, 'base64'))]));
  return {confirmation, hashes};
}

test('future setup builder emits exactly one empty-registry setup call using a refreshed legacy AdminCap', async () => {
  const {confirmation, hashes} = setupFixture();
  const setup = deriveSetupInputs(confirmation, reviewed, reviewed.transactionKindSha256, hashes);
  const tx = buildSetup(setup);
  const ptb = bcs.TransactionKind.parse(await tx.build({onlyTransactionKind: true})).ProgrammableTransaction;
  assert.equal(ptb.commands.length, 1);
  assert.equal(ptb.commands[0].MoveCall.package, setup.packageId);
  assert.equal(ptb.commands[0].MoveCall.module, 'settlement');
  assert.equal(ptb.commands[0].MoveCall.function, 'create_settlement_registry');
  assert.equal(ptb.inputs.length, 1);
  assert.deepEqual(ptb.inputs[0].Object.ImmOrOwnedObject, setup.legacyAdminCap);
});

test('simulation response cannot stand in for a confirmed upgrade', () => {
  const simulation = read('upgrade-simulation.json');
  assert.throws(() => deriveSetupInputs(simulation, reviewed, reviewed.transactionKindSha256, {}), /simulation cannot/);
});

test('future setup rejects an unconfirmed or different upgrade transaction', () => {
  const {confirmation, hashes} = setupFixture();
  assert.throws(() => deriveSetupInputs(confirmation, reviewed, 'different-kind', hashes), /differs from the reviewed/);
  delete confirmation.response.data.transaction.effects.checkpoint;
  assert.throws(() => deriveSetupInputs(confirmation, reviewed, reviewed.transactionKindSha256, hashes), /real checkpoint/);
});

test('future setup rejects type origins pointing at the legacy package', () => {
  const {confirmation, hashes} = setupFixture();
  const pkg = confirmation.response.data.transaction.effects.objectChanges.nodes.find(change => change.outputState?.asMovePackage).outputState.asMovePackage;
  pkg.typeOrigins.find(origin => origin.module === 'settlement').definingId = inputs.originalPackageId;
  assert.throws(() => deriveSetupInputs(confirmation, reviewed, reviewed.transactionKindSha256, hashes));
});

test('future setup rejects a later superseding upgrade and a transferred AdminCap', () => {
  const {confirmation, hashes} = setupFixture();
  confirmation.response.data.upgradeCap.asMoveObject.contents.json.package = inputs.packageId;
  assert.throws(() => deriveSetupInputs(confirmation, reviewed, reviewed.transactionKindSha256, hashes), /superseded/);
  const fixture = setupFixture();
  fixture.confirmation.response.data.legacyAdminCap.owner.address.address = '0x' + '1'.repeat(64);
  assert.throws(() => deriveSetupInputs(fixture.confirmation, reviewed, reviewed.transactionKindSha256, fixture.hashes));
});
