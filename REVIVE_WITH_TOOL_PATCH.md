# Arboretum Revival Kit Contract Patch

Status: included in the current callable package `0xee2cb50c675bb47de4612e713b2101b3b6a5f66620f146ff57858efc39dd689b`. This file is kept as reference/background only.

## Why this was needed

The previous contract supported Revival Kits only as a stored Seed charge:

1. `open_crate` can mint a `Tool` whose `kind` is `revival_kit`.
2. `apply_tool` consumes that Tool and increments `seed.revival_charges`.
3. `revive_seed` can revive only when `seed.revival_charges > 0`.

However, `apply_tool` rejects Seeds whose on-chain `state` is dead. That means a player whose Seed is already dead and has no stored revival charges cannot use a newly purchased Revival Kit to continue.

## Published entry function

This is the entry-function shape the live package now exposes for dead Seeds that receive a newly purchased Revival Kit Tool.

```move
const E_NOT_REVIVAL_KIT: u64 = 19;

entry fun revive_seed_with_tool(
    registry: &Registry,
    seed: &mut Seed,
    tool: Tool,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(!registry.paused, E_PAUSED);
    assert_seed_owner(seed, ctx);
    assert_seed_current(registry, seed);
    let now_ms = assert_season_active(registry, clock);

    assert!(seed.state == STATE_DEAD, E_NOT_DEAD);

    let Tool { id, kind, charges: _, rarity: _ } = tool;
    let kind_bytes = *string::as_bytes(&kind);
    assert!(kind_bytes == b"revival_kit", E_NOT_REVIVAL_KIT);
    object::delete(id);

    seed.state = STATE_ALIVE;
    seed.last_watered_ms = now_ms;
    seed.watering_streak = 1;

    event::emit(SeedRevived {
        seed_id: object::id(seed),
        owner: tx_context::sender(ctx),
    });
}
```

## Front-end support included

This package already includes a front-end path for `revive_seed_with_tool`:

- `wallet.js` exports `reviveSeedWithTool(seedObjectId, toolObjectId)`.
- Dead Seed cards show `Use Revival Kit` when the Seed has no stored revival charge.
- If the Seed is only UI-dead from drought but not yet on-chain-dead, the front end attempts a current-contract recovery sequence: apply Revival Kit, mark the Seed dead, then revive it.
- If the Seed is already dead on-chain, the new `revive_seed_with_tool` function is required.

## Testing checklist

1. Open a crate until a `revival_kit` Tool NFT is minted.
2. Confirm the dead Seed card shows `Use Revival Kit`.
3. For a Seed already dead on-chain, confirm the transaction calls `revive_seed_with_tool` and consumes the Revival Kit Tool.
4. Confirm the Seed returns to alive, `last_watered_ms` updates, `watering_streak` is `1`, and the Revival Kit Tool is gone.
5. Confirm using a non-Revival-Kit Tool with `revive_seed_with_tool` aborts.
