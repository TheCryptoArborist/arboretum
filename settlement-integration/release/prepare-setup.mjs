// Prepare a setup transaction ONLY after observing the exact reviewed upgrade on-chain.
// This helper can query and build unsigned bytes. It contains no execution or signing path.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Transaction } from '@mysten/sui/transactions';
import { transactionToGrpcJson } from '../../node_modules/@mysten/sui/dist/client/transaction-resolver.mjs';
import { buildCapture } from './build-upgrade.mjs';

const ENDPOINT = 'https://graphql.mainnet.sui.io/graphql';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const contents = object => object.asMoveObject.contents;
const objectOwner = object => object.owner?.__typename === 'AddressOwner' ? object.owner.address.address : null;
const reference = object => ({objectId: object.address, version: String(object.version), digest: object.digest});
const OBJECT = `address version digest owner { __typename ... on AddressOwner { address { address } } }
  asMoveObject { contents { type { repr } json } }`;
const CONFIRM = `query ConfirmActualReviewedUpgrade($digest: String!, $adminCap: SuiAddress!, $upgradeCap: SuiAddress!) {
  checkpoint { sequenceNumber timestamp digest }
  transaction(digest: $digest) { digest sender { address } transactionBcs
    effects { status executionError { message } checkpoint { sequenceNumber timestamp }
      objectChanges(first: 50) { nodes { address idCreated idDeleted
        outputState { address version digest
          asMovePackage { address version typeOrigins { module struct definingId }
            modules(first: 50) { nodes { name bytes } pageInfo { hasNextPage endCursor } } }
        }
      } pageInfo { hasNextPage endCursor } }
    }
  }
  legacyAdminCap: object(address: $adminCap) { ${OBJECT} }
  upgradeCap: object(address: $upgradeCap) { ${OBJECT} }
}`;

async function readQuery(query, variables) {
  assert.ok(query.trimStart().startsWith('query '));
  assert.ok(!query.includes('mutation') && !query.includes('executeTransaction'));
  const response = await fetch(ENDPOINT, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({query, variables}), signal: AbortSignal.timeout(45000)});
  if (!response.ok) throw new Error(`GraphQL HTTP ${response.status}`);
  const result = await response.json();
  if (result.errors?.length) throw new Error(JSON.stringify(result.errors));
  assert.ok(result.data);
  return {retrievedAt: new Date().toISOString(), endpoint: ENDPOINT, query, variables,
    response: result, transactionsSubmitted: 0, signaturesProduced: 0};
}

export function deriveSetupInputs(confirmation, reviewed, kindHash, publishedModuleHashes) {
  assert.equal(confirmation.transactionsSubmitted, 0);
  assert.equal(confirmation.signaturesProduced, 0);
  const data = confirmation.response.data;
  assert.ok(!data.simulateTransaction, 'A simulation cannot supply a deployed package ID');
  const transaction = data.transaction;
  assert.ok(transaction?.effects?.checkpoint, 'Upgrade must be confirmed at a real checkpoint');
  assert.equal(transaction.effects.status, 'SUCCESS');
  assert.ok(!transaction.effects.executionError);
  assert.equal(transaction.sender.address, reviewed.sender);
  assert.equal(kindHash, reviewed.transactionKindSha256, 'On-chain upgrade differs from the reviewed transaction kind');
  assert.equal(transaction.effects.objectChanges.pageInfo.hasNextPage, false);
  const packages = transaction.effects.objectChanges.nodes.filter(change => change.outputState?.asMovePackage);
  assert.equal(packages.length, 1);
  assert.equal(packages[0].idCreated, true);
  const deployed = packages[0].outputState.asMovePackage;
  assert.equal(deployed.version, 12);
  assert.equal(deployed.modules.pageInfo.hasNextPage, false);
  assert.deepEqual(deployed.modules.nodes.map(module => module.name).sort(), ['arboretum', 'settlement']);
  for (const module of deployed.modules.nodes) {
    assert.equal(sha256(Buffer.from(module.bytes, 'base64')), publishedModuleHashes[module.name]);
  }
  const newOrigins = deployed.typeOrigins.filter(origin => origin.module === 'settlement');
  assert.equal(newOrigins.length, 39);
  assert.ok(newOrigins.every(origin => origin.definingId === deployed.address));
  assert.equal(data.upgradeCap.address, reviewed.upgradeCap.objectId);
  assert.equal(objectOwner(data.upgradeCap), reviewed.sender);
  assert.equal(contents(data.upgradeCap).json.package, deployed.address, 'A newer upgrade superseded this one');
  assert.equal(contents(data.upgradeCap).json.version, '12');
  assert.equal(contents(data.upgradeCap).json.policy, 0);
  assert.equal(data.legacyAdminCap.address, '0x74b2e28a362a148c1a0c0a8da8519966ba19c3cec82148028b3019d30829f3b3');
  assert.equal(objectOwner(data.legacyAdminCap), reviewed.sender);
  assert.equal(contents(data.legacyAdminCap).type.repr,
    '0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b::arboretum::AdminCap');
  return {packageId: deployed.address, typeOrigin: deployed.address, sender: reviewed.sender,
    legacyAdminCap: reference(data.legacyAdminCap), actualUpgradeDigest: transaction.digest,
    actualUpgradeCheckpoint: transaction.effects.checkpoint};
}

export function buildSetup(inputs) {
  assert.match(inputs.packageId, /^0x[0-9a-f]{64}$/);
  assert.equal(inputs.typeOrigin, inputs.packageId);
  assert.ok(inputs.actualUpgradeCheckpoint?.sequenceNumber != null);
  const tx = new Transaction();
  tx.setSender(inputs.sender);
  tx.moveCall({target: `${inputs.packageId}::settlement::create_settlement_registry`,
    arguments: [tx.objectRef(inputs.legacyAdminCap)]});
  return tx;
}

async function main() {
  assert.equal(process.argv.length, 5,
    'Usage: node --use-env-proxy prepare-setup.mjs <reviewed-capture> <actual-upgrade-digest> <new-output-directory>');
  const [, , captureName, digest, outputName] = process.argv;
  assert.match(digest, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  const capture = path.resolve(captureName);
  const output = path.resolve(outputName);
  assert.ok(!fs.existsSync(output), 'Choose a new output directory; previous evidence must remain intact');
  // Recheck source bytes, the installed serializer, and the exact saved unsigned kind.
  await buildCapture(capture, {verifyOnly: true});
  const reviewed = JSON.parse(fs.readFileSync(path.join(capture, 'unsigned-upgrade.json'), 'utf8'));
  const summary = JSON.parse(fs.readFileSync(path.join(capture, 'simulation-summary.json'), 'utf8'));
  assert.equal(summary.status, 'UNSIGNED_MAINNET_UPGRADE_SIMULATION_VERIFIED');
  assert.equal(summary.transactionKindSha256, reviewed.transactionKindSha256);
  const simulation = JSON.parse(fs.readFileSync(path.join(capture, 'upgrade-simulation.json'), 'utf8'));
  const simulatedPackage = simulation.response.data.simulateTransaction.effects.objectChanges.nodes
    .find(change => change.outputState?.asMovePackage).outputState.asMovePackage;
  const publishedModuleHashes = Object.fromEntries(simulatedPackage.modules.nodes
    .map(module => [module.name, sha256(Buffer.from(module.bytes, 'base64'))]));
  const confirmation = await readQuery(CONFIRM, {digest,
    adminCap: '0x74b2e28a362a148c1a0c0a8da8519966ba19c3cec82148028b3019d30829f3b3',
    upgradeCap: reviewed.upgradeCap.objectId});
  const actual = confirmation.response.data.transaction;
  assert.ok(actual?.transactionBcs, 'The upgrade is not visible as a confirmed on-chain transaction');
  const confirmedTransaction = Transaction.from(actual.transactionBcs);
  const confirmedKindHash = sha256(await confirmedTransaction.build({onlyTransactionKind: true}));
  const inputs = deriveSetupInputs(confirmation, reviewed, confirmedKindHash, publishedModuleHashes);
  const existing = await readQuery(`query ExistingSettlementRegistries($type: String!) {
    checkpoint { sequenceNumber timestamp }
    objects(first: 1, filter: {type: $type}) { nodes { address } pageInfo { hasNextPage endCursor } }
  }`, {type: `${inputs.typeOrigin}::settlement::Registry`});
  assert.equal(existing.response.data.objects.nodes.length, 0,
    'A settlement Registry already exists. Inspect and reuse it before proposing another setup.');
  const tx = buildSetup(inputs);
  const kind = await tx.build({onlyTransactionKind: true});
  fs.mkdirSync(output, {recursive: true});
  fs.writeFileSync(path.join(output, 'actual-upgrade-confirmation.json'), JSON.stringify(confirmation, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'existing-registry-check.json'), JSON.stringify(existing, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'setup-kind.b64'), Buffer.from(kind).toString('base64') + '\n');
  fs.writeFileSync(path.join(output, 'unsigned-setup.json'), JSON.stringify({
    purpose: 'Unsigned empty settlement Registry setup for review only', ...inputs,
    transaction: transactionToGrpcJson(tx), transactionKindSha256: sha256(kind),
    checksEnabled: true, doGasSelection: true,
    startsSeason: false, fundsPool: false, importsLegacyState: false,
    newRegistryId: null, newAdminCapId: null, transactionsSubmitted: 0, signaturesProduced: 0,
  }, null, 2) + '\n');
  console.log(JSON.stringify({output, packageId: inputs.packageId,
    command: 'settlement::create_settlement_registry', startsSeason: false, transactionsSubmitted: 0}));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
