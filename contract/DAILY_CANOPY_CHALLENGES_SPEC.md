# Daily Canopy Challenges Contract Spec

## Goal

Daily Canopy Challenges are optional, player-funded side contests. They create daily competition without draining the monthly Growth Pool.

The first version should be simple, auditable, and separate from season rewards.

## Recommended First Challenge: Canopy Sprint

Canopy Sprint measures how many new Growth Points a player earns during a 24-hour challenge window.

Core rule:

- A player joins before or during the challenge.
- The contract records that player's current season Growth Points as their baseline.
- Their challenge score is their current season Growth Points minus that baseline.
- More active Seeds, better item timing, and daily watering give the player more ways to score.

Player-facing message:

Join before you water. Only Growth Points earned after you enter count toward the Daily Canopy Challenge.

## Launch Timing

Recommended first live rollout:

- Days 1-14 of a monthly season: show Daily Canopy Challenges as "Opening mid-cycle."
- Day 15 onward: admin can open the first Daily Canopy Challenge.
- Each challenge runs for 24 hours.
- A challenge cannot run past the current monthly season end.

This gives players time to learn the core game before optional side contests begin.

## Entry Price

Recommended first test/live price:

- 0.25 SUI per entry
- One entry per wallet per daily challenge
- Minimum 3 entries required for the prize contest to settle

If fewer than 3 players enter, the challenge can be canceled and entrants can receive a full refund.

## Pot Split

Hold the full entry pot inside the challenge object until the challenge is finalized.

If the challenge reaches the minimum entry count:

- 90% goes to the prize pool
- 8% goes to the treasury wallet
- 2% goes to the dev fee wallet

Prize pool split:

- 1st place: 70%
- 2nd place: 20%
- 3rd place: 10%

Example:

- 10 players enter at 0.25 SUI each
- Gross pot: 2.50 SUI
- Prize pool: 2.25 SUI
- Treasury: 0.20 SUI
- Dev fee: 0.05 SUI
- 1st place: 1.575 SUI
- 2nd place: 0.45 SUI
- 3rd place: 0.225 SUI

## New Contract Object

Use a new shared object instead of adding fields to the existing Registry.

Suggested object:

```move
public struct ChallengeBook has key {
    id: UID,
    admin: address,
    current_challenge_id: u64,
    active_challenge_id: u64,
    active_start_ms: u64,
    active_end_ms: u64,
    entry_fee_mist: u64,
    challenge_type: u8,
    entry_count: u64,
    settled: bool,
    canceled: bool,
    pot: Balance<SUI>,
    entries: Table<address, ChallengeEntry>,
}
```

Suggested entry:

```move
public struct ChallengeEntry has store {
    player: address,
    season_id: u64,
    baseline_growth_points: u64,
    entered_at_ms: u64,
    refunded: bool,
}
```

Why a new object:

- It avoids risky changes to the existing Registry layout.
- It keeps side contest funds separate from the monthly Growth Pool.
- It lets us upgrade Daily Canopy Challenges independently over time.

## Entry Flow

Function:

```move
public entry fun enter_canopy_sprint(
    book: &mut ChallengeBook,
    registry: &Registry,
    payment: Coin<SUI>,
    clock: &Clock,
    ctx: &mut TxContext
)
```

Checks:

- A challenge is active.
- The current time is inside the challenge window.
- The monthly season is active.
- The challenge does not run beyond the monthly season end.
- The player has not already entered this challenge.
- Payment is at least the entry fee.

Actions:

- Record the player's current season Growth Points as the baseline.
- Add the full entry fee to the challenge pot.
- Refund any overpayment.
- Emit `ChallengeEntered`.

## Finalization Flow

Because Sui table entries are not naturally iterable on-chain, the contract cannot automatically discover the top three players by itself.

Recommended first version:

- The website/API calculates the challenge leaderboard from on-chain events and current Growth Point totals.
- Admin finalizes by submitting the top three wallet addresses.
- The contract verifies that those players entered the challenge.
- The contract calculates each submitted player's score from on-chain Growth Point totals minus their saved baseline.
- The contract verifies the submitted order is descending.
- The contract pays winners and emits a finalization event.

Function:

```move
public entry fun finalize_canopy_sprint(
    admin_cap: &AdminCap,
    book: &mut ChallengeBook,
    registry: &Registry,
    first: address,
    second: address,
    third: address,
    clock: &Clock,
    ctx: &mut TxContext
)
```

Checks:

- Caller has admin authority.
- Challenge has ended.
- Challenge is not already settled or canceled.
- Entry count is at least 3.
- All three winners entered the challenge.
- Scores are in descending order.

Actions:

- Split the gross pot into prize, treasury, and dev fee.
- Pay treasury wallet.
- Pay dev fee wallet.
- Pay 70/20/10 from the prize pool.
- Mark challenge settled.
- Emit `ChallengeFinalized`.

Important limitation:

The contract can verify the submitted winners' scores and order, but it cannot prove no omitted player had a higher score unless we build a more complex on-chain leaderboard system. For version one, transparency comes from public events, UI snapshots, and the finalization event.

## Refund Flow

If fewer than 3 players enter:

```move
public entry fun cancel_challenge(
    admin_cap: &AdminCap,
    book: &mut ChallengeBook,
    clock: &Clock
)
```

Then players can call:

```move
public entry fun refund_canceled_challenge_entry(
    book: &mut ChallengeBook,
    ctx: &mut TxContext
)
```

Rules:

- Refunds are only available after admin cancels the challenge.
- Each entered wallet can refund once.
- Refund amount equals the full entry fee.
- No treasury or dev fee is taken from canceled challenges.

## Admin Controls

Needed admin functions:

- `create_challenge_book`
- `open_canopy_sprint`
- `cancel_challenge`
- `finalize_canopy_sprint`

Recommended restrictions:

- Only admin can open, cancel, or finalize.
- Challenges cannot open during the first 14 days of a monthly season.
- Challenges cannot run beyond the monthly season end.
- Only one challenge can be active at a time.

## Events

Suggested events:

```move
public struct ChallengeOpened has copy, drop {
    challenge_id: u64,
    challenge_type: u8,
    start_ms: u64,
    end_ms: u64,
    entry_fee_mist: u64,
}

public struct ChallengeEntered has copy, drop {
    challenge_id: u64,
    player: address,
    season_id: u64,
    baseline_growth_points: u64,
    entry_fee_mist: u64,
}

public struct ChallengeFinalized has copy, drop {
    challenge_id: u64,
    first: address,
    first_score: u64,
    first_payout_mist: u64,
    second: address,
    second_score: u64,
    second_payout_mist: u64,
    third: address,
    third_score: u64,
    third_payout_mist: u64,
    treasury_mist: u64,
    dev_fee_mist: u64,
}

public struct ChallengeCanceled has copy, drop {
    challenge_id: u64,
    entry_count: u64,
}

public struct ChallengeEntryRefunded has copy, drop {
    challenge_id: u64,
    player: address,
    refund_mist: u64,
}
```

## Website Requirements

Daily Canopy Challenges should appear in:

- Overview
- My Garden
- Strategy & Items
- Item Shop
- Rewards Hub

UI states:

- Coming Soon
- Opens mid-cycle
- Entry open
- Entered
- Entry closed
- Waiting for finalization
- Winners announced
- Refund available

The My Garden message should be action-based:

Daily Canopy Challenge: enter before watering so today's new Growth Points count.

## Later Challenge Types

After Canopy Sprint is stable:

- Toolsmith Trial: rewards best item timing during a daily window.
- Canopy Guard: rewards keeping entered Seeds alive and protected.
- Forest Climb: rewards rank movement over a short window.

These should wait until Canopy Sprint proves that entry, scoring, finalization, and refunds all feel good.
