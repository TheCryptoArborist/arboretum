// Offline construction only. No signer, wallet, client, or submission is used.
import fs from 'node:fs';
import { Transaction, Inputs } from '@mysten/sui/transactions';
import { transactionToGrpcJson } from '../../node_modules/@mysten/sui/dist/client/transaction-resolver.mjs';

const here = new URL('.', import.meta.url);
const evidence = JSON.parse(fs.readFileSync(new URL('owned-seeds-20261019.json', here), 'utf8'));
const data = evidence.response.data;
const currentSeason = data.registry.asMoveObject.contents.json.current_season_id;
const seed = data.objects.nodes.find(object => {
  const fields = object.asMoveObject.contents.json;
  return fields.season_id === currentSeason && BigInt(fields.growth_points) > 0n;
});
if (!seed) throw new Error('No bounded-query Seed is suitable for current-season simulation');
const owner = seed.owner.address.address;
if (owner !== seed.asMoveObject.contents.json.owner) throw new Error('Seed ownership disagrees');
const packageId = '0xdfcde7bc9271a7952dcb1c4ddd199c7d526bb286e09c6d1f528fec8e1ecf6724';

for (const fn of ['water_seed', 'claim_reward']) {
  const tx = new Transaction();
  tx.setSender(owner);
  tx.moveCall({
    target: `${packageId}::arboretum::${fn}`,
    arguments: [
      tx.object(Inputs.SharedObjectRef({
        objectId: data.registry.address,
        initialSharedVersion: data.registry.owner.initialSharedVersion,
        mutable: true,
      })),
      tx.object(Inputs.ObjectRef({objectId: seed.address, version: seed.version, digest: seed.digest})),
      tx.object(Inputs.SharedObjectRef({
        objectId: data.clock.address,
        initialSharedVersion: data.clock.owner.initialSharedVersion,
        mutable: false,
      })),
    ],
  });
  const payload = {
    purpose: `Unsigned simulation of ${fn}; no on-chain submission`,
    sourceEvidence: 'owned-seeds-20261019.json',
    seed: seed.address,
    sender: owner,
    sdkVersion: JSON.parse(fs.readFileSync(new URL('../../node_modules/@mysten/sui/package.json', import.meta.url))).version,
    transaction: transactionToGrpcJson(tx),
    checksEnabled: true,
    doGasSelection: true,
    transactionsSubmitted: 0,
  };
  fs.writeFileSync(new URL(`${fn}-unsigned-input-20261019.json`, here), JSON.stringify(payload, null, 2) + '\n');
  console.log(JSON.stringify({fn, seed: seed.address, owner, commands: tx.getData().commands.length, signed: false}));
}
