# NFTree Plant Fix

This package adds `plant_seed_with_nftree<NFTree: key>`.

The live front end uses held NFTree NFTs as planting access, but the original `plant_seed` function accepts the package's internal `Sapling` object by value. Passing an external NFTree NFT into that function causes a transaction resolution/deserialization failure in the wallet.

Use the new entry function for NFTree planting:

```text
plant_seed_with_nftree<NFTree>(
  registry: &mut Registry,
  nftree: &NFTree,
  payment: Coin<SUI>,
  referrer_opt: Option<address>,
  clock: &Clock,
)
```

The original `plant_seed` remains for compatibility with internal `Sapling` objects.
