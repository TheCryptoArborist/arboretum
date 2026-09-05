# Arboretum Dead Seed Reset Patch

Status: included in the current callable package `0xee2cb50c675bb47de4612e713b2101b3b6a5f66620f146ff57858efc39dd689b`. This file is kept as reference/background only.

## Why this was needed

The previous Arboretum contract let a Seed die, but did not give the player a way to abandon that dead Seed and free the garden slot.

This matters because `plant_seed` records the attached NFTree in `registry.planted_nfts` for the current season. If a Seed dies and the player simply wants to start over, the old dead Seed still blocks that NFTree from planting a fresh Seed.

## Published behavior

The live package now includes a player-facing `abandon_seed` entry function:

- Only the Seed owner can call it.
- The Seed must be current-season.
- The Seed must be dead on-chain, or dead by drought timing when checked against the Clock.
- It removes any remaining growth points from registry totals.
- It frees the attached NFTree in `registry.planted_nfts`.
- It removes the abandoned Seed ID from `registry.seeds_by_owner` if that table is still used by the source.
- It deletes the Seed object.
- It emits a reset/abandon event for indexers and the front end.
- It should not refund the original Seed deposit and should not pay rewards.

## Suggested Move source shape

Adapt names/constants to the real source file.

```move
struct SeedAbandoned has copy, drop {
    seed_id: ID,
    owner: address,
    nft_id: ID,
}

entry fun abandon_seed(
    registry: &mut Registry,
    seed: Seed,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(!registry.paused, E_PAUSED);

    let Seed {
        id,
        nft_id,
        season_id,
        owner,
        planted_at_ms: _,
        last_watered_ms,
        watering_streak: _,
        growth_points,
        state,
        fertilizer_charges: _,
        miracle_grow_applied: _,
        revival_charges: _,
        bottomless_can_expiry_ms,
        permanent_gp_bonus: _,
    } = seed;

    assert!(owner == tx_context::sender(ctx), E_NOT_OWNER);
    assert!(season_id == registry.current_season_id, E_NOT_CURRENT_SEASON);

    let now_ms = clock::timestamp_ms(clock);
    let drought_days = (now_ms - last_watered_ms) / ONE_DAY_MS;
    let dead_by_time = drought_days >= DEATH_DAYS && bottomless_can_expiry_ms < now_ms;
    assert!(state == STATE_DEAD || dead_by_time, E_NOT_DEAD);

    if (growth_points > 0) {
        // If the real source exposes remove_seed_growth_points, prefer reusing it
        // before unpacking/deleting the Seed. Otherwise subtract safely here.
        let current_total = registry.total_growth_points;
        registry.total_growth_points = if (current_total > growth_points) {
            current_total - growth_points
        } else {
            0
        };

        if (
            table::contains(&registry.player_growth, owner) &&
            *table::borrow(&registry.player_growth_season, owner) == registry.current_season_id
        ) {
            let player_total = table::borrow_mut(&mut registry.player_growth, owner);
            *player_total = if (*player_total > growth_points) {
                *player_total - growth_points
            } else {
                0
            };
        };
    };

    let seed_id = object::uid_to_inner(&id);

    if (table::contains(&registry.planted_nfts, nft_id)) {
        table::remove(&mut registry.planted_nfts, nft_id);
    };

    if (table::contains(&registry.seeds_by_owner, owner)) {
        let ids = table::borrow_mut(&mut registry.seeds_by_owner, owner);
        let len = vector::length(ids);
        let mut i = 0;
        while (i < len) {
            if (*vector::borrow(ids, i) == seed_id) {
                vector::remove(ids, i);
                break
            };
            i = i + 1;
        };
    };

    if (registry.total_seeds > 0) {
        registry.total_seeds = registry.total_seeds - 1;
    };

    event::emit(SeedAbandoned {
        seed_id,
        owner,
        nft_id,
    });

    object::delete(id);
}
```

## Front-end support included

This package already includes front-end support for this recommended entry function:

- Dead Seed cards show `Reset Slot`.
- `wallet.js` exports `abandonSeed(seedObjectId)`.
- The UI explains that reset abandons the dead Seed and does not refund deposits or rewards.

## Testing checklist

1. Plant a Seed and let it become dead.
2. Confirm the dead Seed card shows `Reset Slot`.
3. Call `abandon_seed`.
4. Confirm the dead Seed object is deleted or no longer owned by the player.
5. Confirm the attached NFTree can plant a new Seed in the same season.
6. Confirm the old Seed does not receive rewards and no deposit is refunded.
7. Confirm a live Seed cannot be abandoned unless intentionally allowed by game design.
