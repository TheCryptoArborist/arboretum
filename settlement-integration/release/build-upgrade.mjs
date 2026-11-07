// Deterministic offline construction. This module never imports a signer or network client.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
// This matches the existing probe and the installed, version-checked SDK implementation.
import { transactionToGrpcJson } from '../../node_modules/@mysten/sui/dist/client/transaction-resolver.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readJSON = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));

export function buildUpgrade(inputs, build) {
  assert.equal(inputs.status, 'VERIFIED_UNSIGNED_RELEASE_INPUTS');
  assert.equal(inputs.network, 'mainnet');
  assert.equal(inputs.chainIdentifier, '35834a8a');
  assert.equal(inputs.upgradePolicy, 0);
  assert.equal(inputs.transactionsSubmitted, 0);
  assert.equal(inputs.signaturesProduced, 0);
  assert.match(inputs.packageDigestHex, /^[a-f0-9]{64}$/);
  assert.deepEqual(build.modules.map(module => module.name), ['arboretum', 'settlement']);
  assert.equal(build.modules.length, inputs.modules.length);
  const modules = build.modules.map((module, index) => {
    const bytes = Buffer.from(module.base64, 'base64');
    assert.equal(sha256(bytes), inputs.modules[index].sha256);
    assert.equal(bytes.length, inputs.modules[index].size);
    return module.base64;
  });
  const tx = new Transaction();
  tx.setSender(inputs.sender);
  const cap = tx.objectRef(inputs.upgradeCap);
  const [ticket] = tx.moveCall({
    target: '0x2::package::authorize_upgrade',
    arguments: [cap, tx.pure.u8(inputs.upgradePolicy),
      tx.pure.vector('u8', Array.from(Buffer.from(inputs.packageDigestHex, 'hex')))],
  });
  const [receipt] = tx.upgrade({
    modules, dependencies: inputs.dependencies, package: inputs.packageId, ticket,
  });
  tx.moveCall({target: '0x2::package::commit_upgrade', arguments: [cap, receipt]});
  return tx;
}

export function verifyPacket(packet, tx, kindBytes) {
  assert.equal(packet.transactionKindSha256, sha256(kindBytes));
  assert.equal(packet.transactionKindBytes, kindBytes.length);
  assert.deepEqual(packet.transaction, transactionToGrpcJson(tx),
    'Simulation JSON does not encode the reviewed transaction kind');
  assert.equal(packet.sender, tx.getData().sender);
  assert.equal(packet.checksEnabled, true);
  assert.equal(packet.doGasSelection, true);
  assert.equal(packet.transactionsSubmitted, 0);
  assert.equal(packet.signaturesProduced, 0);
}

export async function buildCapture(capture, {verifyOnly = false} = {}) {
  const inputs = readJSON(path.join(capture, 'verified-inputs.json'));
  const buildPath = path.join(repo, inputs.sourceEvidence.candidateBuild.path);
  assert.equal(sha256(fs.readFileSync(buildPath)), inputs.sourceEvidence.candidateBuild.sha256);
  assert.equal(sha256(fs.readFileSync(path.join(capture, 'chain-inputs.json'))),
    inputs.sourceEvidence['chain-inputs.json']);
  for (const [source, expectedHash] of Object.entries(inputs.sourceEvidence.sources)) {
    assert.equal(sha256(fs.readFileSync(path.join(repo, source))), expectedHash, `Source changed: ${source}`);
  }
  const sdkVersion = readJSON(path.join(repo, 'node_modules/@mysten/sui/package.json')).version;
  assert.equal(sdkVersion, '2.19.0', 'Review the transaction serializer before changing SDK versions');
  const tx = buildUpgrade(inputs, readJSON(buildPath));
  const kindBytes = await tx.build({onlyTransactionKind: true});
  const decoded = bcs.TransactionKind.parse(kindBytes);
  assert.equal(decoded.$kind, 'ProgrammableTransaction');
  assert.equal(decoded.ProgrammableTransaction.commands.length, 3);
  const kindFile = 'upgrade-kind.b64';
  if (verifyOnly) {
    const packet = readJSON(path.join(capture, 'unsigned-upgrade.json'));
    assert.equal(packet.sourceEvidenceSha256, sha256(fs.readFileSync(path.join(capture, 'verified-inputs.json'))));
    assert.deepEqual(Buffer.from(fs.readFileSync(path.join(capture, kindFile), 'utf8').trim(), 'base64'), Buffer.from(kindBytes));
    verifyPacket(packet, tx, kindBytes);
    console.log(JSON.stringify({status: 'UNSIGNED_PACKET_MATCHES_REVIEWED_BYTES', transactionsSubmitted: 0}));
    return {tx, packet, kindBytes};
  }
  fs.writeFileSync(path.join(capture, kindFile), Buffer.from(kindBytes).toString('base64') + '\n');
  const packet = {
    schemaVersion: 1,
    purpose: 'Unsigned mainnet upgrade review and simulation only; no transaction submitted',
    sourceEvidence: 'verified-inputs.json', sourceEvidenceSha256: sha256(fs.readFileSync(path.join(capture, 'verified-inputs.json'))),
    checkpoint: inputs.checkpoint, sdkVersion,
    sender: inputs.sender, upgradeCap: inputs.upgradeCap,
    upgradePackage: inputs.packageId, packageDigestHex: inputs.packageDigestHex,
    kindFile, transactionKindSha256: sha256(kindBytes), transactionKindBytes: kindBytes.length,
    transaction: transactionToGrpcJson(tx), checksEnabled: true, doGasSelection: true,
    commands: ['0x2::package::authorize_upgrade', 'Upgrade: byte-exact legacy plus settlement', '0x2::package::commit_upgrade'],
    gasDataFixed: false, startsSeason: false, fundsPool: false, touchesLegacyRegistry: false,
    createsSettlementRegistry: false, changesUpgradeCapPolicy: false,
    signaturesProduced: 0, transactionsSubmitted: 0,
  };
  fs.writeFileSync(path.join(capture, 'unsigned-upgrade.json'), JSON.stringify(packet, null, 2) + '\n');
  console.log(JSON.stringify({purpose: packet.purpose, kindBytes: kindBytes.length,
    transactionKindSha256: packet.transactionKindSha256, commands: packet.commands,
    transactionsSubmitted: 0}));
  return {tx, packet, kindBytes};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const verifyOnly = process.argv[2] === '--verify';
  assert.equal(process.argv.length, verifyOnly ? 4 : 3,
    'Usage: node build-upgrade.mjs [--verify] <capture-directory>');
  await buildCapture(path.resolve(process.argv[verifyOnly ? 3 : 2]), {verifyOnly});
}
