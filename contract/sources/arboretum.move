module arboretum::arboretum {
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::event;
    use sui::clock::{Self, Clock};
    use sui::table::{Self, Table};
    use sui::random::{Self, Random, RandomGenerator};
    use std::string::{Self, String};

    // =========================================================
    //  Error codes
    // =========================================================
    const E_NOT_ADMIN:              u64 = 0;
    const E_SEED_DEAD:              u64 = 2;
    const E_SEED_NOT_FOUND:         u64 = 3;
    const E_WRONG_PAYMENT:          u64 = 4;
    const E_ALREADY_WATERED_TODAY:  u64 = 5;
    const E_SEASON_ENDED:           u64 = 6;
    const E_NO_SEEDS:               u64 = 7;
    const E_INVALID_CRATE_TIER:     u64 = 8;
    const E_SEED_ALIVE:             u64 = 10;
    const E_NO_REVIVAL_CHARGES:     u64 = 11;
    const E_PAUSED:                 u64 = 12;
    const E_SEASON_NOT_STARTED:     u64 = 13;
    const E_SAPLING_ALREADY_USED:   u64 = 14;
    const E_WRONG_SEASON:           u64 = 15;
    const E_SEASON_ACTIVE:          u64 = 17;
    const E_NOT_REVIVAL_KIT:        u64 = 18;
    const E_NO_TOOL_CHARGES:        u64 = 19;
    const E_INVALID_TOOL_KIND:      u64 = 20;
    const E_CLAIM_WINDOW_ACTIVE:    u64 = 21;
    const E_INVALID_SUPPLY_DROP:    u64 = 22;
    const E_INVALID_SEASON_DURATION:u64 = 23;
    const E_CHALLENGE_ACTIVE:       u64 = 24;
    const E_CHALLENGE_NOT_ACTIVE:   u64 = 25;
    const E_CHALLENGE_NOT_OPEN:     u64 = 26;
    const E_CHALLENGE_ALREADY_ENTERED: u64 = 27;
    const E_CHALLENGE_NOT_ENTERED:  u64 = 28;
    const E_CHALLENGE_NOT_ENDED:    u64 = 29;
    const E_CHALLENGE_SETTLED:      u64 = 30;
    const E_CHALLENGE_CANCELED:     u64 = 31;
    const E_CHALLENGE_MIN_ENTRIES:  u64 = 32;
    const E_INVALID_WINNERS:        u64 = 33;
    const E_INVALID_SCORE_ORDER:    u64 = 34;
    const E_ALREADY_REFUNDED:       u64 = 35;
    const E_ARCHIVE_CLAIM_ENDED:    u64 = 36;
    const E_ARCHIVE_SWEPT:          u64 = 37;

    // =========================================================
    //  Constants
    // =========================================================
    const GROWTH_DEPOSIT_MIST:      u64 = 10_000_000;       // 0.01  SUI plant fee
    const REFERRAL_SHARE_MIST:      u64 =  1_000_000;       // 0.001 SUI referrer share

    // Crate prices (5 tiers)
    const CRATE_PRICE_0: u64 = 10_000_000; // 0.01 SUI
    const CRATE_PRICE_1: u64 = 10_000_000; // 0.01 SUI
    const CRATE_PRICE_2: u64 = 10_000_000; // 0.01 SUI
    const CRATE_PRICE_3: u64 = 10_000_000; // 0.01 SUI
    const CRATE_PRICE_4: u64 = 10_000_000; // 0.01 SUI

    // Rotating one-off Supply Drops. These are test-economy prices.
    // Original economy targets: watering boost 5 SUI, mulch 8 SUI,
    // rain barrel 10 SUI, drought shield 15 SUI, revival kit 25 SUI.
    const SUPPLY_DROP_REVIVAL_KIT:    u8 = 0;
    const SUPPLY_DROP_DROUGHT_SHIELD: u8 = 1;
    const SUPPLY_DROP_RAIN_BARREL:    u8 = 2;
    const SUPPLY_DROP_MULCH:          u8 = 3;
    const SUPPLY_DROP_WATERING_BOOST: u8 = 4;
    const SUPPLY_PRICE_REVIVAL_KIT:    u64 = 50_000_000; // 0.05 SUI
    const SUPPLY_PRICE_DROUGHT_SHIELD: u64 = 40_000_000; // 0.04 SUI
    const SUPPLY_PRICE_RAIN_BARREL:    u64 = 30_000_000; // 0.03 SUI
    const SUPPLY_PRICE_MULCH:          u64 = 25_000_000; // 0.025 SUI
    const SUPPLY_PRICE_WATERING_BOOST: u64 = 20_000_000; // 0.02 SUI

    const SEASON_DURATION_MS:       u64 = 2_592_000_000;     // 30 days
    const ONE_DAY_MS:               u64 =        86_400_000;
    const CLAIM_GRACE_MS:           u64 =       604_800_000; // 7 days
    const REVIEW_WINDOW_MS:         u64 =        86_400_000; // 24 hours
    const WILT_DAYS:                u64 = 7;
    const DEATH_DAYS:               u64 = 10;
    const BOTTOMLESS_DURATION_MS:   u64 = 259_200_000;       // 3 days
    const CANOPY_CHALLENGE_DURATION_MS: u64 = ONE_DAY_MS;     // 24 hours
    const CANOPY_CHALLENGE_UNLOCK_MS:   u64 = ONE_DAY_MS * 14; // mid-cycle launch
    const CANOPY_CHALLENGE_ENTRY_MIST:  u64 = 250_000_000;    // 0.25 SUI
    const CANOPY_CHALLENGE_MIN_ENTRIES: u64 = 3;
    const STREAK_BONUS_PER_DAY:     u64 = 2;
    const BASE_WATER_POINTS:        u64 = 10;
    const REWARD_POOL_BPS:          u64 = 70;
    const DEV_FEE_BPS:              u64 = 2;
    const DIRECT_INVITE_SHOP_BPS:   u64 = 1;
    const CHALLENGE_PRIZE_BPS:      u64 = 90;
    const CHALLENGE_TREASURY_BPS:   u64 = 8;
    const CHALLENGE_FIRST_BPS:      u64 = 70;
    const CHALLENGE_SECOND_BPS:     u64 = 20;
    const BPS_DENOMINATOR:          u64 = 100;
    const TREASURY_WALLET: address = @0x6f1020c2fd6c91129f7cb5e0d651295e87f7245f96b7d090715c89b38197e77f;
    const DEV_FEE_WALLET: address = @0x485953e2eadf4aa02af950cf8e914fbd2b67523385e73c36118341459d8d45c4;

    // Crate tier IDs
    const CRATE_SEEDLING: u8 = 0;
    const CRATE_GROVE:    u8 = 1;
    const CRATE_CANOPY:   u8 = 2;
    const CRATE_ANCIENT:  u8 = 3;
    const CRATE_MYTHIC:   u8 = 4;

    // Seed state
    const STATE_ALIVE:    u8 = 0;
    const STATE_WILTING:  u8 = 1;
    const STATE_DEAD:     u8 = 2;

    // =========================================================
    //  Item kind byte-strings  (20 unique items)
    // =========================================================
    // COMMON (4)
    const ITEM_FERTILIZER:          vector<u8> = b"fertilizer";
    const ITEM_WATERING_BOOST:      vector<u8> = b"watering_boost";
    const ITEM_COMPOST:             vector<u8> = b"compost";
    const ITEM_GROWTH_TONIC:        vector<u8> = b"growth_tonic";

    // UNCOMMON (5)
    const ITEM_MIRACLE_GROW:        vector<u8> = b"miracle_grow";
    const ITEM_MULCH:               vector<u8> = b"mulch";
    const ITEM_RAIN_BARREL:         vector<u8> = b"rain_barrel";
    const ITEM_SUPER_SOIL:          vector<u8> = b"super_soil";
    const ITEM_SUNSTONE:            vector<u8> = b"sunstone";

    // RARE (6)
    const ITEM_REVIVAL_KIT:         vector<u8> = b"revival_kit";
    const ITEM_DOUBLE_DOSE:         vector<u8> = b"double_dose";
    const ITEM_DROUGHT_SHIELD:      vector<u8> = b"drought_shield";
    const ITEM_ANCIENT_BARK:        vector<u8> = b"ancient_bark";
    const ITEM_MOON_WATER:          vector<u8> = b"moon_water";
    const ITEM_EARTH_CORE:          vector<u8> = b"earth_core";

    // LEGENDARY (5)
    const ITEM_BOTTOMLESS_CAN:      vector<u8> = b"bottomless_can";
    const ITEM_PHILOSOPHERS_SOIL:   vector<u8> = b"philosophers_soil";
    const ITEM_TIMELESS_SEED:       vector<u8> = b"timeless_seed";
    const ITEM_CRYSTAL_WATER:       vector<u8> = b"crystal_water";
    const ITEM_FOREST_HEART:        vector<u8> = b"forest_heart";

    // =========================================================
    //  Shared / owned objects
    // =========================================================
    public struct Registry has key {
        id: UID,
        admin: address,
        current_season_id: u64,
        season_start_ms: u64,
        reward_pool: Balance<SUI>,
        treasury: Balance<SUI>,
        total_seeds: u64,
        total_growth_points: u64,
        paused: bool,
        seeds_by_owner:    Table<address, vector<ID>>,
        referrers:         Table<address, address>,
        referral_earnings: Table<address, u64>,
        player_growth:        Table<address, u64>,
        player_growth_season: Table<address, u64>,
        planted_saplings:     Table<ID, u64>,
    }

    public struct Sapling has key {
        id: UID,
        name: String,
        cycle_count: u64,
        total_sui_harvested: u64,
    }

    public struct Seed has key {
        id: UID,
        sapling_id: ID,
        season_id: u64,
        owner: address,
        planted_at_ms: u64,
        last_watered_ms: u64,
        watering_streak: u64,
        growth_points: u64,
        state: u8,
        fertilizer_charges: u8,
        miracle_grow_applied: bool,
        revival_charges: u8,
        bottomless_can_expiry_ms: u64,
        // optional: permanent GP bonus from certain tools
        permanent_gp_bonus: u64,
    }

    /// Tool NFT – one item per object, transferred to player on crate open.
    public struct Tool has key, store {
        id: UID,
        kind: String,
        charges: u8,
        rarity: u8,     // 0=common 1=uncommon 2=rare 3=legendary
    }

    public struct Crate has key, store {
        id: UID,
        tier: u8,   // 0–4
    }

    public struct AdminCap has key { id: UID }

    public struct SeasonArchive has key {
        id: UID,
        admin: address,
        season_id: u64,
        season_start_ms: u64,
        season_end_ms: u64,
        finalized_at_ms: u64,
        claim_deadline_ms: u64,
        total_growth_points: u64,
        total_seeds: u64,
        reward_pool: Balance<SUI>,
        swept: bool,
    }

    public struct ChallengeBook has key {
        id: UID,
        admin: address,
        current_challenge_id: u64,
        active_challenge_id: u64,
        active_end_ms: u64,
    }

    public struct CanopyChallenge has key {
        id: UID,
        challenge_id: u64,
        season_id: u64,
        start_ms: u64,
        end_ms: u64,
        entry_fee_mist: u64,
        entry_count: u64,
        settled: bool,
        canceled: bool,
        pot: Balance<SUI>,
        entries: Table<address, ChallengeEntry>,
    }

    public struct ChallengeEntry has store {
        player: address,
        season_id: u64,
        baseline_growth_points: u64,
        entered_at_ms: u64,
        refunded: bool,
    }

    // =========================================================
    //  Events
    // =========================================================
    public struct SeedPlanted    has copy, drop { seed_id: ID, owner: address, sapling_id: ID }
    public struct SeedWatered    has copy, drop { seed_id: ID, owner: address, streak: u64, growth_points: u64 }
    public struct SeedDied       has copy, drop { seed_id: ID, owner: address }
    public struct SeedRevived    has copy, drop { seed_id: ID, owner: address }
    public struct SeedAbandoned  has copy, drop { seed_id: ID, owner: address, sapling_id: ID }
    public struct CratePurchased has copy, drop { crate_id: ID, buyer: address, tier: u8 }
    public struct CrateOpened    has copy, drop { crate_id: ID, opener: address, tool_kind: String, rarity: u8 }
    public struct SupplyDropPurchased has copy, drop { tool_id: ID, buyer: address, drop: u8, tool_kind: String, price_mist: u64 }
    public struct RewardClaimed  has copy, drop { owner: address, amount_mist: u64 }
    public struct ReferralPaid   has copy, drop { referrer: address, referee: address, amount_mist: u64 }
    public struct SaplingMinted  has copy, drop { sapling_id: ID, owner: address }
    public struct SeasonStarted  has copy, drop { season_id: u64, start_ms: u64 }
    public struct SeasonReset    has copy, drop { season_id: u64 }
    public struct SeasonArchived has copy, drop {
        archive_id: ID,
        season_id: u64,
        finalized_at_ms: u64,
        claim_deadline_ms: u64,
        reward_pool_mist: u64,
        total_growth_points: u64,
        total_seeds: u64,
    }
    public struct ArchivedRewardClaimed has copy, drop {
        archive_id: ID,
        season_id: u64,
        owner: address,
        seed_id: ID,
        amount_mist: u64,
    }
    public struct ArchivedRewardsSwept has copy, drop {
        archive_id: ID,
        season_id: u64,
        amount_mist: u64,
    }
    public struct ChallengeBookCreated has copy, drop { book_id: ID, admin: address }
    public struct ChallengeOpened has copy, drop {
        challenge_id: u64,
        challenge_object_id: ID,
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
    public struct ChallengeCanceled has copy, drop { challenge_id: u64, entry_count: u64 }
    public struct ChallengeEntryRefunded has copy, drop { challenge_id: u64, player: address, refund_mist: u64 }

    // =========================================================
    //  Helpers
    // =========================================================
    fun assert_admin(registry: &Registry, ctx: &TxContext) {
        assert!(tx_context::sender(ctx) == registry.admin, E_NOT_ADMIN);
    }

    fun assert_challenge_admin(book: &ChallengeBook, ctx: &TxContext) {
        assert!(tx_context::sender(ctx) == book.admin, E_NOT_ADMIN);
    }

    fun assert_seed_owner(seed: &Seed, ctx: &TxContext) {
        let sender = tx_context::sender(ctx);
        assert!(seed.owner == sender, E_SEED_NOT_FOUND);
    }

    fun assert_season_active(registry: &Registry, clock: &Clock): u64 {
        let now_ms = clock::timestamp_ms(clock);
        assert!(registry.season_start_ms > 0, E_SEASON_NOT_STARTED);
        let elapsed = now_ms - registry.season_start_ms;
        assert!(elapsed < SEASON_DURATION_MS, E_SEASON_ENDED);
        now_ms
    }

    fun assert_seed_current(registry: &Registry, seed: &Seed) {
        assert!(seed.season_id == registry.current_season_id, E_WRONG_SEASON);
    }

    fun add_growth_points(registry: &mut Registry, seed: &mut Seed, owner: address, points: u64) {
        seed.growth_points = seed.growth_points + points;
        if (table::contains(&registry.player_growth, owner)) {
            let player_season = *table::borrow(&registry.player_growth_season, owner);
            if (player_season == registry.current_season_id) {
                let prev = *table::borrow(&registry.player_growth, owner);
                *table::borrow_mut(&mut registry.player_growth, owner) = prev + points;
            } else {
                *table::borrow_mut(&mut registry.player_growth, owner) = points;
                *table::borrow_mut(&mut registry.player_growth_season, owner) = registry.current_season_id;
            };
        } else {
            table::add(&mut registry.player_growth, owner, points);
            table::add(&mut registry.player_growth_season, owner, registry.current_season_id);
        };
        registry.total_growth_points = registry.total_growth_points + points;
    }

    fun route_paid_action(registry: &mut Registry, mut paid_coin: Coin<SUI>, ctx: &mut TxContext) {
        let total = coin::value(&paid_coin);
        let reward_share = total * REWARD_POOL_BPS / BPS_DENOMINATOR;
        let dev_share = total * DEV_FEE_BPS / BPS_DENOMINATOR;
        let treasury_share = total - reward_share - dev_share;

        if (reward_share > 0) {
            let reward_coin = coin::split(&mut paid_coin, reward_share, ctx);
            balance::join(&mut registry.reward_pool, coin::into_balance(reward_coin));
        };

        if (dev_share > 0) {
            let dev_coin = coin::split(&mut paid_coin, dev_share, ctx);
            transfer::public_transfer(dev_coin, DEV_FEE_WALLET);
        };

        if (treasury_share > 0) {
            let treasury_coin = coin::split(&mut paid_coin, treasury_share, ctx);
            transfer::public_transfer(treasury_coin, TREASURY_WALLET);
        };

        coin::destroy_zero(paid_coin);
    }

    fun payout_from_challenge_pot(challenge: &mut CanopyChallenge, recipient: address, amount: u64, ctx: &mut TxContext) {
        if (amount > 0) {
            let coin_out = coin::from_balance(balance::split(&mut challenge.pot, amount), ctx);
            transfer::public_transfer(coin_out, recipient);
        };
    }

    fun player_challenge_score(registry: &Registry, challenge: &CanopyChallenge, player: address): u64 {
        assert!(table::contains(&challenge.entries, player), E_CHALLENGE_NOT_ENTERED);
        let entry = table::borrow(&challenge.entries, player);
        assert!(entry.season_id == registry.current_season_id, E_WRONG_SEASON);
        let current_points = player_growth_points(registry, player);
        if (current_points > entry.baseline_growth_points) current_points - entry.baseline_growth_points else 0
    }

    fun pay_direct_invite_shop_bonus(registry: &mut Registry, buyer: address, paid_coin: &mut Coin<SUI>, ctx: &mut TxContext) {
        if (!table::contains(&registry.referrers, buyer)) {
            return
        };

        let referrer = *table::borrow(&registry.referrers, buyer);
        if (referrer == buyer) {
            return
        };

        let bonus = coin::value(paid_coin) * DIRECT_INVITE_SHOP_BPS / BPS_DENOMINATOR;
        if (bonus == 0) {
            return
        };

        let ref_coin = coin::split(paid_coin, bonus, ctx);
        transfer::public_transfer(ref_coin, referrer);
        if (table::contains(&registry.referral_earnings, referrer)) {
            let prev = *table::borrow(&registry.referral_earnings, referrer);
            *table::borrow_mut(&mut registry.referral_earnings, referrer) = prev + bonus;
        } else {
            table::add(&mut registry.referral_earnings, referrer, bonus);
        };
        event::emit(ReferralPaid { referrer, referee: buyer, amount_mist: bonus });
    }

    fun remove_seed_growth_points(registry: &mut Registry, seed: &mut Seed, owner: address) {
        let points = seed.growth_points;
        if (points == 0) {
            return
        };

        if (
            table::contains(&registry.player_growth, owner) &&
            *table::borrow(&registry.player_growth_season, owner) == registry.current_season_id
        ) {
            let player_points = *table::borrow(&registry.player_growth, owner);
            *table::borrow_mut(&mut registry.player_growth, owner) =
                if (player_points > points) player_points - points else 0;
        };

        registry.total_growth_points =
            if (registry.total_growth_points > points) registry.total_growth_points - points else 0;
        seed.growth_points = 0;
    }

    fun mark_seed_dead(registry: &mut Registry, seed: &mut Seed, owner: address) {
        seed.state = STATE_DEAD;
        seed.watering_streak = 0;
        remove_seed_growth_points(registry, seed, owner);
        event::emit(SeedDied { seed_id: object::id(seed), owner });
    }

    fun seed_is_dead_by_time(seed: &Seed, now_ms: u64): bool {
        let drought_ms = now_ms - seed.last_watered_ms;
        let drought_days = drought_ms / ONE_DAY_MS;
        drought_days >= DEATH_DAYS && seed.bottomless_can_expiry_ms < now_ms
    }

    fun remove_seed_from_owner(registry: &mut Registry, owner: address, seed_id: ID) {
        if (!table::contains(&registry.seeds_by_owner, owner)) {
            return
        };

        let seeds = table::borrow_mut(&mut registry.seeds_by_owner, owner);
        let mut i = 0;
        let len = vector::length(seeds);
        while (i < len) {
            if (*vector::borrow(seeds, i) == seed_id) {
                vector::remove(seeds, i);
                return
            };
            i = i + 1;
        };
    }

    fun return_or_delete_tool(tool: Tool, owner: address) {
        if (tool.charges > 0) {
            transfer::public_transfer(tool, owner);
        } else {
            let Tool { id, kind: _, charges: _, rarity: _ } = tool;
            object::delete(id);
        };
    }

    fun mint_crate_tool(
        crate_id: ID,
        opener: address,
        kind_bytes: vector<u8>,
        charges: u8,
        rarity: u8,
        ctx: &mut TxContext,
    ) {
        event::emit(CrateOpened {
            crate_id,
            opener,
            tool_kind: string::utf8(copy kind_bytes),
            rarity,
        });
        transfer::transfer(
            Tool { id: object::new(ctx), kind: string::utf8(kind_bytes), charges, rarity },
            opener
        );
    }

    fun supply_drop_details(drop: u8): (vector<u8>, u8, u8, u64) {
        if (drop == SUPPLY_DROP_REVIVAL_KIT) {
            (ITEM_REVIVAL_KIT, 1, 2, SUPPLY_PRICE_REVIVAL_KIT)
        } else if (drop == SUPPLY_DROP_DROUGHT_SHIELD) {
            (ITEM_DROUGHT_SHIELD, 1, 2, SUPPLY_PRICE_DROUGHT_SHIELD)
        } else if (drop == SUPPLY_DROP_RAIN_BARREL) {
            (ITEM_RAIN_BARREL, 1, 1, SUPPLY_PRICE_RAIN_BARREL)
        } else if (drop == SUPPLY_DROP_MULCH) {
            (ITEM_MULCH, 1, 1, SUPPLY_PRICE_MULCH)
        } else if (drop == SUPPLY_DROP_WATERING_BOOST) {
            (ITEM_WATERING_BOOST, 1, 0, SUPPLY_PRICE_WATERING_BOOST)
        } else {
            assert!(false, E_INVALID_SUPPLY_DROP);
            (b"", 0, 0, 0)
        }
    }

    // =========================================================
    //  init
    // =========================================================
    fun init(ctx: &mut TxContext) {
        let admin = tx_context::sender(ctx);
        let registry = Registry {
            id: object::new(ctx),
            admin,
            current_season_id: 0,
            season_start_ms: 0,
            reward_pool: balance::zero<SUI>(),
            treasury: balance::zero<SUI>(),
            total_seeds: 0,
            total_growth_points: 0,
            paused: false,
            seeds_by_owner:    table::new<address, vector<ID>>(ctx),
            referrers:         table::new<address, address>(ctx),
            referral_earnings: table::new<address, u64>(ctx),
            player_growth:        table::new<address, u64>(ctx),
            player_growth_season: table::new<address, u64>(ctx),
            planted_saplings:     table::new<ID, u64>(ctx),
        };
        transfer::share_object(registry);
        transfer::transfer(AdminCap { id: object::new(ctx) }, admin);
    }

    // =========================================================
    //  Season admin
    // =========================================================
    entry fun start_season(_cap: &AdminCap, registry: &mut Registry, clock: &Clock, ctx: &TxContext) {
        assert_admin(registry, ctx);
        assert!(registry.season_start_ms == 0, E_SEASON_ACTIVE);
        let now = clock::timestamp_ms(clock);
        registry.current_season_id = registry.current_season_id + 1;
        registry.season_start_ms = now;
        event::emit(SeasonStarted { season_id: registry.current_season_id, start_ms: now });
    }

    entry fun start_season_for_duration(
        _cap: &AdminCap,
        registry: &mut Registry,
        clock: &Clock,
        duration_ms: u64,
        ctx: &TxContext,
    ) {
        assert_admin(registry, ctx);
        assert!(registry.season_start_ms == 0, E_SEASON_ACTIVE);
        assert!(duration_ms > 0 && duration_ms <= SEASON_DURATION_MS, E_INVALID_SEASON_DURATION);
        let now = clock::timestamp_ms(clock);
        registry.current_season_id = registry.current_season_id + 1;
        registry.season_start_ms = now - (SEASON_DURATION_MS - duration_ms);
        event::emit(SeasonStarted { season_id: registry.current_season_id, start_ms: now });
    }

    entry fun reset_season(_cap: &AdminCap, registry: &mut Registry, clock: &Clock, ctx: &mut TxContext) {
        assert_admin(registry, ctx);
        let now = clock::timestamp_ms(clock);
        assert!(registry.season_start_ms > 0, E_SEASON_NOT_STARTED);
        let elapsed = now - registry.season_start_ms;
        assert!(elapsed >= SEASON_DURATION_MS + REVIEW_WINDOW_MS, E_CLAIM_WINDOW_ACTIVE);
        archive_current_season(registry, now, ctx);
    }

    entry fun finalize_season_archive_now(_cap: &AdminCap, registry: &mut Registry, clock: &Clock, ctx: &mut TxContext) {
        assert_admin(registry, ctx);
        let now = clock::timestamp_ms(clock);
        assert!(registry.season_start_ms > 0, E_SEASON_NOT_STARTED);
        archive_current_season(registry, now, ctx);
    }

    fun archive_current_season(registry: &mut Registry, now: u64, ctx: &mut TxContext) {
        let unclaimed_rewards = balance::value(&registry.reward_pool);
        let archived_pool = if (unclaimed_rewards > 0) {
            balance::split(&mut registry.reward_pool, unclaimed_rewards)
        } else {
            balance::zero<SUI>()
        };
        let season_id = registry.current_season_id;
        let season_start_ms = registry.season_start_ms;
        let season_end_ms = season_start_ms + SEASON_DURATION_MS;
        let claim_deadline_ms = now + CLAIM_GRACE_MS;
        let archive = SeasonArchive {
            id: object::new(ctx),
            admin: registry.admin,
            season_id,
            season_start_ms,
            season_end_ms,
            finalized_at_ms: now,
            claim_deadline_ms,
            total_growth_points: registry.total_growth_points,
            total_seeds: registry.total_seeds,
            reward_pool: archived_pool,
            swept: false,
        };
        let archive_id = object::id(&archive);
        event::emit(SeasonArchived {
            archive_id,
            season_id,
            finalized_at_ms: now,
            claim_deadline_ms,
            reward_pool_mist: unclaimed_rewards,
            total_growth_points: registry.total_growth_points,
            total_seeds: registry.total_seeds,
        });
        registry.total_growth_points = 0;
        registry.season_start_ms = 0;
        registry.total_seeds = 0;
        event::emit(SeasonReset { season_id });
        transfer::share_object(archive);
    }

    entry fun set_paused(_cap: &AdminCap, registry: &mut Registry, paused: bool, ctx: &TxContext) {
        assert_admin(registry, ctx);
        registry.paused = paused;
    }

    // =========================================================
    //  Daily Canopy Challenges
    // =========================================================
    entry fun create_challenge_book(_cap: &AdminCap, registry: &Registry, ctx: &mut TxContext) {
        assert_admin(registry, ctx);
        let book = ChallengeBook {
            id: object::new(ctx),
            admin: tx_context::sender(ctx),
            current_challenge_id: 0,
            active_challenge_id: 0,
            active_end_ms: 0,
        };
        let book_id = object::id(&book);
        event::emit(ChallengeBookCreated { book_id, admin: tx_context::sender(ctx) });
        transfer::share_object(book);
    }

    entry fun open_canopy_sprint(
        _cap: &AdminCap,
        book: &mut ChallengeBook,
        registry: &Registry,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert_challenge_admin(book, ctx);
        assert!(!registry.paused, E_PAUSED);
        assert!(book.active_challenge_id == 0, E_CHALLENGE_ACTIVE);
        let now = assert_season_active(registry, clock);
        assert!(now >= registry.season_start_ms + CANOPY_CHALLENGE_UNLOCK_MS, E_CHALLENGE_NOT_OPEN);
        let end_ms = now + CANOPY_CHALLENGE_DURATION_MS;
        assert!(end_ms <= registry.season_start_ms + SEASON_DURATION_MS, E_SEASON_ENDED);

        book.current_challenge_id = book.current_challenge_id + 1;
        book.active_challenge_id = book.current_challenge_id;
        book.active_end_ms = end_ms;

        let challenge = CanopyChallenge {
            id: object::new(ctx),
            challenge_id: book.current_challenge_id,
            season_id: registry.current_season_id,
            start_ms: now,
            end_ms,
            entry_fee_mist: CANOPY_CHALLENGE_ENTRY_MIST,
            entry_count: 0,
            settled: false,
            canceled: false,
            pot: balance::zero<SUI>(),
            entries: table::new<address, ChallengeEntry>(ctx),
        };
        let challenge_object_id = object::id(&challenge);
        event::emit(ChallengeOpened {
            challenge_id: book.current_challenge_id,
            challenge_object_id,
            start_ms: now,
            end_ms,
            entry_fee_mist: CANOPY_CHALLENGE_ENTRY_MIST,
        });
        transfer::share_object(challenge);
    }

    entry fun enter_canopy_sprint(
        challenge: &mut CanopyChallenge,
        registry: &Registry,
        mut payment: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(!registry.paused, E_PAUSED);
        assert!(!challenge.settled, E_CHALLENGE_SETTLED);
        assert!(!challenge.canceled, E_CHALLENGE_CANCELED);
        assert!(challenge.season_id == registry.current_season_id, E_WRONG_SEASON);
        let now = assert_season_active(registry, clock);
        assert!(now >= challenge.start_ms && now < challenge.end_ms, E_CHALLENGE_NOT_OPEN);

        let player = tx_context::sender(ctx);
        assert!(!table::contains(&challenge.entries, player), E_CHALLENGE_ALREADY_ENTERED);
        assert!(coin::value(&payment) >= challenge.entry_fee_mist, E_WRONG_PAYMENT);

        let baseline_growth_points = player_growth_points(registry, player);
        table::add(&mut challenge.entries, player, ChallengeEntry {
            player,
            season_id: registry.current_season_id,
            baseline_growth_points,
            entered_at_ms: now,
            refunded: false,
        });
        challenge.entry_count = challenge.entry_count + 1;

        if (coin::value(&payment) > challenge.entry_fee_mist) {
            let entry_coin = coin::split(&mut payment, challenge.entry_fee_mist, ctx);
            balance::join(&mut challenge.pot, coin::into_balance(entry_coin));
            transfer::public_transfer(payment, player);
        } else {
            balance::join(&mut challenge.pot, coin::into_balance(payment));
        };

        event::emit(ChallengeEntered {
            challenge_id: challenge.challenge_id,
            player,
            season_id: registry.current_season_id,
            baseline_growth_points,
            entry_fee_mist: challenge.entry_fee_mist,
        });
    }

    entry fun finalize_canopy_sprint(
        _cap: &AdminCap,
        book: &mut ChallengeBook,
        challenge: &mut CanopyChallenge,
        registry: &Registry,
        first: address,
        second: address,
        third: address,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert_challenge_admin(book, ctx);
        assert!(!challenge.settled, E_CHALLENGE_SETTLED);
        assert!(!challenge.canceled, E_CHALLENGE_CANCELED);
        assert!(challenge.season_id == registry.current_season_id, E_WRONG_SEASON);
        assert!(clock::timestamp_ms(clock) >= challenge.end_ms, E_CHALLENGE_NOT_ENDED);
        assert!(challenge.entry_count >= CANOPY_CHALLENGE_MIN_ENTRIES, E_CHALLENGE_MIN_ENTRIES);
        assert!(first != second && first != third && second != third, E_INVALID_WINNERS);

        let first_score = player_challenge_score(registry, challenge, first);
        let second_score = player_challenge_score(registry, challenge, second);
        let third_score = player_challenge_score(registry, challenge, third);
        assert!(first_score >= second_score && second_score >= third_score, E_INVALID_SCORE_ORDER);

        let gross = balance::value(&challenge.pot);
        let prize_pool = gross * CHALLENGE_PRIZE_BPS / BPS_DENOMINATOR;
        let treasury_mist = gross * CHALLENGE_TREASURY_BPS / BPS_DENOMINATOR;
        let dev_fee_mist = gross - prize_pool - treasury_mist;
        let first_payout_mist = prize_pool * CHALLENGE_FIRST_BPS / BPS_DENOMINATOR;
        let second_payout_mist = prize_pool * CHALLENGE_SECOND_BPS / BPS_DENOMINATOR;
        let third_payout_mist = prize_pool - first_payout_mist - second_payout_mist;

        payout_from_challenge_pot(challenge, TREASURY_WALLET, treasury_mist, ctx);
        payout_from_challenge_pot(challenge, DEV_FEE_WALLET, dev_fee_mist, ctx);
        payout_from_challenge_pot(challenge, first, first_payout_mist, ctx);
        payout_from_challenge_pot(challenge, second, second_payout_mist, ctx);
        payout_from_challenge_pot(challenge, third, third_payout_mist, ctx);

        challenge.settled = true;
        if (book.active_challenge_id == challenge.challenge_id) {
            book.active_challenge_id = 0;
            book.active_end_ms = 0;
        };

        event::emit(ChallengeFinalized {
            challenge_id: challenge.challenge_id,
            first,
            first_score,
            first_payout_mist,
            second,
            second_score,
            second_payout_mist,
            third,
            third_score,
            third_payout_mist,
            treasury_mist,
            dev_fee_mist,
        });
    }

    entry fun cancel_canopy_sprint(
        _cap: &AdminCap,
        book: &mut ChallengeBook,
        challenge: &mut CanopyChallenge,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert_challenge_admin(book, ctx);
        assert!(!challenge.settled, E_CHALLENGE_SETTLED);
        assert!(!challenge.canceled, E_CHALLENGE_CANCELED);
        assert!(clock::timestamp_ms(clock) >= challenge.end_ms, E_CHALLENGE_NOT_ENDED);
        assert!(challenge.entry_count < CANOPY_CHALLENGE_MIN_ENTRIES, E_CHALLENGE_MIN_ENTRIES);

        challenge.canceled = true;
        if (book.active_challenge_id == challenge.challenge_id) {
            book.active_challenge_id = 0;
            book.active_end_ms = 0;
        };
        event::emit(ChallengeCanceled { challenge_id: challenge.challenge_id, entry_count: challenge.entry_count });
    }

    entry fun refund_canceled_canopy_sprint_entry(
        challenge: &mut CanopyChallenge,
        ctx: &mut TxContext,
    ) {
        assert!(challenge.canceled, E_CHALLENGE_NOT_ACTIVE);
        let player = tx_context::sender(ctx);
        assert!(table::contains(&challenge.entries, player), E_CHALLENGE_NOT_ENTERED);
        let entry = table::borrow_mut(&mut challenge.entries, player);
        assert!(!entry.refunded, E_ALREADY_REFUNDED);
        entry.refunded = true;
        let refund_mist = challenge.entry_fee_mist;
        payout_from_challenge_pot(challenge, player, refund_mist, ctx);
        event::emit(ChallengeEntryRefunded { challenge_id: challenge.challenge_id, player, refund_mist });
    }

    // =========================================================
    //  Mint Sapling
    // =========================================================
    entry fun mint_sapling(name_bytes: vector<u8>, ctx: &mut TxContext) {
        let owner = tx_context::sender(ctx);
        let sapling = Sapling {
            id: object::new(ctx),
            name: string::utf8(name_bytes),
            cycle_count: 0,
            total_sui_harvested: 0
        };
        let sapling_id = object::id(&sapling);
        event::emit(SaplingMinted { sapling_id, owner });
        transfer::transfer(sapling, owner);
    }

    // =========================================================
    //  Plant Seed
    // =========================================================
    entry fun plant_seed(
        registry: &mut Registry,
        mut sapling: Sapling,
        mut payment: Coin<SUI>,
        referrer_opt: Option<address>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(!registry.paused, E_PAUSED);
        let owner = tx_context::sender(ctx);
        let now_ms = assert_season_active(registry, clock);
        assert!(coin::value(&payment) >= GROWTH_DEPOSIT_MIST, E_WRONG_PAYMENT);

        let sapling_id = object::id(&sapling);
        if (table::contains(&registry.planted_saplings, sapling_id)) {
            let planted_season = *table::borrow(&registry.planted_saplings, sapling_id);
            assert!(planted_season != registry.current_season_id, E_SAPLING_ALREADY_USED);
            *table::borrow_mut(&mut registry.planted_saplings, sapling_id) = registry.current_season_id;
        } else {
            table::add(&mut registry.planted_saplings, sapling_id, registry.current_season_id);
        };
        sapling.cycle_count = sapling.cycle_count + 1;

        let mut deposit_coin = coin::split(&mut payment, GROWTH_DEPOSIT_MIST, ctx);
        if (coin::value(&payment) > 0) {
            transfer::public_transfer(payment, owner);
        } else {
            coin::destroy_zero(payment);
        };

        if (option::is_some(&referrer_opt)) {
            let referrer = *option::borrow(&referrer_opt);
            if (referrer != owner && !table::contains(&registry.referrers, owner)) {
                table::add(&mut registry.referrers, owner, referrer);
                let ref_coin = coin::split(&mut deposit_coin, REFERRAL_SHARE_MIST, ctx);
                transfer::public_transfer(ref_coin, referrer);
                if (table::contains(&registry.referral_earnings, referrer)) {
                    let prev = *table::borrow(&registry.referral_earnings, referrer);
                    *table::borrow_mut(&mut registry.referral_earnings, referrer) = prev + REFERRAL_SHARE_MIST;
                } else {
                    table::add(&mut registry.referral_earnings, referrer, REFERRAL_SHARE_MIST);
                };
                event::emit(ReferralPaid { referrer, referee: owner, amount_mist: REFERRAL_SHARE_MIST });
            }
        };

        route_paid_action(registry, deposit_coin, ctx);

        let mut seed = Seed {
            id: object::new(ctx),
            sapling_id,
            season_id: registry.current_season_id,
            owner,
            planted_at_ms: now_ms,
            last_watered_ms: now_ms,
            watering_streak: 1,
            growth_points: 0,
            state: STATE_ALIVE,
            fertilizer_charges: 0,
            miracle_grow_applied: false,
            revival_charges: 0,
            bottomless_can_expiry_ms: 0,
            permanent_gp_bonus: 0,
        };
        let seed_id = object::id(&seed);
        registry.total_seeds = registry.total_seeds + 1;
        if (!table::contains(&registry.seeds_by_owner, owner)) {
            table::add(&mut registry.seeds_by_owner, owner, vector[]);
        };
        vector::push_back(table::borrow_mut(&mut registry.seeds_by_owner, owner), seed_id);
        add_growth_points(registry, &mut seed, owner, BASE_WATER_POINTS);

        event::emit(SeedPlanted { seed_id, owner, sapling_id });
        transfer::transfer(sapling, owner);
        transfer::transfer(seed, owner);
    }

    // =========================================================
    //  Plant Seed with an external NFTree NFT
    // =========================================================
    entry fun plant_seed_with_nftree<NFTree: key>(
        registry: &mut Registry,
        nftree: &NFTree,
        mut payment: Coin<SUI>,
        referrer_opt: Option<address>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(!registry.paused, E_PAUSED);
        let owner = tx_context::sender(ctx);
        let now_ms = assert_season_active(registry, clock);
        assert!(coin::value(&payment) >= GROWTH_DEPOSIT_MIST, E_WRONG_PAYMENT);

        let sapling_id = object::id(nftree);
        if (table::contains(&registry.planted_saplings, sapling_id)) {
            let planted_season = *table::borrow(&registry.planted_saplings, sapling_id);
            assert!(planted_season != registry.current_season_id, E_SAPLING_ALREADY_USED);
            *table::borrow_mut(&mut registry.planted_saplings, sapling_id) = registry.current_season_id;
        } else {
            table::add(&mut registry.planted_saplings, sapling_id, registry.current_season_id);
        };

        let mut deposit_coin = coin::split(&mut payment, GROWTH_DEPOSIT_MIST, ctx);
        if (coin::value(&payment) > 0) {
            transfer::public_transfer(payment, owner);
        } else {
            coin::destroy_zero(payment);
        };

        if (option::is_some(&referrer_opt)) {
            let referrer = *option::borrow(&referrer_opt);
            if (referrer != owner && !table::contains(&registry.referrers, owner)) {
                table::add(&mut registry.referrers, owner, referrer);
                let ref_coin = coin::split(&mut deposit_coin, REFERRAL_SHARE_MIST, ctx);
                transfer::public_transfer(ref_coin, referrer);
                if (table::contains(&registry.referral_earnings, referrer)) {
                    let prev = *table::borrow(&registry.referral_earnings, referrer);
                    *table::borrow_mut(&mut registry.referral_earnings, referrer) = prev + REFERRAL_SHARE_MIST;
                } else {
                    table::add(&mut registry.referral_earnings, referrer, REFERRAL_SHARE_MIST);
                };
                event::emit(ReferralPaid { referrer, referee: owner, amount_mist: REFERRAL_SHARE_MIST });
            }
        };

        route_paid_action(registry, deposit_coin, ctx);

        let mut seed = Seed {
            id: object::new(ctx),
            sapling_id,
            season_id: registry.current_season_id,
            owner,
            planted_at_ms: now_ms,
            last_watered_ms: now_ms,
            watering_streak: 1,
            growth_points: 0,
            state: STATE_ALIVE,
            fertilizer_charges: 0,
            miracle_grow_applied: false,
            revival_charges: 0,
            bottomless_can_expiry_ms: 0,
            permanent_gp_bonus: 0,
        };
        let seed_id = object::id(&seed);
        registry.total_seeds = registry.total_seeds + 1;
        if (!table::contains(&registry.seeds_by_owner, owner)) {
            table::add(&mut registry.seeds_by_owner, owner, vector[]);
        };
        vector::push_back(table::borrow_mut(&mut registry.seeds_by_owner, owner), seed_id);
        add_growth_points(registry, &mut seed, owner, BASE_WATER_POINTS);

        event::emit(SeedPlanted { seed_id, owner, sapling_id });
        transfer::transfer(seed, owner);
    }

    // =========================================================
    //  Water Seed
    // =========================================================
    entry fun water_seed(
        registry: &mut Registry,
        seed: &mut Seed,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(!registry.paused, E_PAUSED);
        assert_seed_owner(seed, ctx);
        assert_seed_current(registry, seed);

        let owner = tx_context::sender(ctx);
        let now_ms = assert_season_active(registry, clock);
        assert!(seed.state != STATE_DEAD, E_SEED_DEAD);

        let drought_ms = now_ms - seed.last_watered_ms;
        let drought_days = drought_ms / ONE_DAY_MS;

        // Die check
        if (drought_days >= DEATH_DAYS && seed.bottomless_can_expiry_ms < now_ms) {
            mark_seed_dead(registry, seed, owner);
            return
        };

        // Min interval: ~21.6h
        let min_interval = ONE_DAY_MS - ONE_DAY_MS / 10;
        assert!(drought_ms >= min_interval || seed.bottomless_can_expiry_ms >= now_ms, E_ALREADY_WATERED_TODAY);

        // Wilt state update
        seed.state = if (drought_days >= WILT_DAYS) STATE_WILTING else STATE_ALIVE;

        // Streak
        if (drought_days >= 2) {
            seed.watering_streak = 1;
        } else {
            seed.watering_streak = seed.watering_streak + 1;
        };

        // GP calculation
        let streak_bonus = if (seed.watering_streak > 25) 50 else seed.watering_streak * STREAK_BONUS_PER_DAY;
        let mut gp = BASE_WATER_POINTS + seed.permanent_gp_bonus + streak_bonus;

        if (seed.miracle_grow_applied) {
            gp = gp * 2;
            seed.miracle_grow_applied = false;
        };
        if (seed.fertilizer_charges > 0) {
            gp = gp + gp / 2;  // +50%
            seed.fertilizer_charges = seed.fertilizer_charges - 1;
        };

        add_growth_points(registry, seed, owner, gp);
        seed.last_watered_ms = now_ms;

        event::emit(SeedWatered { seed_id: object::id(seed), owner, streak: seed.watering_streak, growth_points: seed.growth_points });
    }

    // =========================================================
    //  Apply Tool to Seed
    // =========================================================
    entry fun apply_tool(
        registry: &mut Registry,
        seed: &mut Seed,
        mut tool: Tool,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(!registry.paused, E_PAUSED);
        assert_seed_owner(seed, ctx);
        assert_seed_current(registry, seed);

        let owner = tx_context::sender(ctx);
        let now_ms = assert_season_active(registry, clock);
        assert!(seed.state != STATE_DEAD, E_SEED_DEAD);
        assert!(!seed_is_dead_by_time(seed, now_ms), E_SEED_DEAD);

        assert!(tool.charges > 0, E_NO_TOOL_CHARGES);

        let kind_bytes = *std::string::as_bytes(&tool.kind);

        if (kind_bytes == b"fertilizer") {
            seed.fertilizer_charges = seed.fertilizer_charges + 3;
        } else if (kind_bytes == b"watering_boost") {
            seed.fertilizer_charges = seed.fertilizer_charges + 1;
        } else if (kind_bytes == b"compost") {
            seed.watering_streak = seed.watering_streak + 1;
        } else if (kind_bytes == b"growth_tonic") {
            add_growth_points(registry, seed, owner, 20);
        } else if (kind_bytes == b"miracle_grow") {
            seed.miracle_grow_applied = true;
        } else if (kind_bytes == b"mulch") {
            seed.bottomless_can_expiry_ms = now_ms + 3 * ONE_DAY_MS;
        } else if (kind_bytes == b"rain_barrel") {
            seed.last_watered_ms = now_ms;
        } else if (kind_bytes == b"super_soil") {
            seed.watering_streak = seed.watering_streak + 3;
        } else if (kind_bytes == b"sunstone") {
            add_growth_points(registry, seed, owner, 30);
        } else if (kind_bytes == b"revival_kit") {
            seed.revival_charges = seed.revival_charges + 1;
        } else if (kind_bytes == b"double_dose") {
            seed.miracle_grow_applied = true;
            seed.fertilizer_charges = seed.fertilizer_charges + 2;
        } else if (kind_bytes == b"drought_shield") {
            seed.bottomless_can_expiry_ms = now_ms + 7 * ONE_DAY_MS;
        } else if (kind_bytes == b"ancient_bark") {
            add_growth_points(registry, seed, owner, 50);
        } else if (kind_bytes == b"moon_water") {
            seed.fertilizer_charges = seed.fertilizer_charges + 5;
        } else if (kind_bytes == b"earth_core") {
            seed.fertilizer_charges = seed.fertilizer_charges + 5;
        } else if (kind_bytes == b"bottomless_can") {
            seed.bottomless_can_expiry_ms = now_ms + BOTTOMLESS_DURATION_MS;
        } else if (kind_bytes == b"philosophers_soil") {
            seed.fertilizer_charges = seed.fertilizer_charges + 10;
        } else if (kind_bytes == b"timeless_seed") {
            seed.watering_streak = seed.watering_streak + 5;
            seed.last_watered_ms = now_ms;
        } else if (kind_bytes == b"crystal_water") {
            seed.miracle_grow_applied = true;
            seed.fertilizer_charges = seed.fertilizer_charges + 9;
        } else if (kind_bytes == b"forest_heart") {
            seed.permanent_gp_bonus = seed.permanent_gp_bonus + 5;
        } else {
            assert!(false, E_INVALID_TOOL_KIND);
        };

        tool.charges = tool.charges - 1;
        return_or_delete_tool(tool, owner);
    }

    // =========================================================
    //  Revive Seed
    // =========================================================
    entry fun revive_seed(registry: &Registry, seed: &mut Seed, clock: &Clock, ctx: &TxContext) {
        assert!(!registry.paused, E_PAUSED);
        assert_seed_owner(seed, ctx);
        assert_seed_current(registry, seed);
        let now_ms = assert_season_active(registry, clock);

        assert!(seed.state == STATE_DEAD, E_SEED_ALIVE);
        assert!(seed.revival_charges > 0, E_NO_REVIVAL_CHARGES);
        seed.revival_charges = seed.revival_charges - 1;
        seed.state = STATE_ALIVE;
        seed.last_watered_ms = now_ms;
        seed.watering_streak = 1;
        event::emit(SeedRevived { seed_id: object::id(seed), owner: tx_context::sender(ctx) });
    }

    // =========================================================
    //  Revive Seed with a purchased Revival Kit tool
    // =========================================================
    entry fun revive_seed_with_tool(
        registry: &mut Registry,
        seed: &mut Seed,
        mut tool: Tool,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(!registry.paused, E_PAUSED);
        assert_seed_owner(seed, ctx);
        assert_seed_current(registry, seed);

        let owner = tx_context::sender(ctx);
        assert!(tool.charges > 0, E_NO_TOOL_CHARGES);
        let kind_bytes = *std::string::as_bytes(&tool.kind);
        assert!(kind_bytes == b"revival_kit", E_NOT_REVIVAL_KIT);

        let now_ms = assert_season_active(registry, clock);
        if (seed.state != STATE_DEAD && seed_is_dead_by_time(seed, now_ms)) {
            mark_seed_dead(registry, seed, owner);
        };

        assert!(seed.state == STATE_DEAD, E_SEED_ALIVE);

        seed.state = STATE_ALIVE;
        seed.last_watered_ms = now_ms;
        seed.watering_streak = 1;
        event::emit(SeedRevived { seed_id: object::id(seed), owner });
        tool.charges = tool.charges - 1;
        return_or_delete_tool(tool, owner);
    }

    // =========================================================
    //  Abandon dead Seed and free the planting slot
    // =========================================================
    entry fun abandon_seed(
        registry: &mut Registry,
        mut seed: Seed,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(!registry.paused, E_PAUSED);
        assert_seed_owner(&seed, ctx);
        assert_seed_current(registry, &seed);

        let owner = tx_context::sender(ctx);
        let now_ms = assert_season_active(registry, clock);
        if (seed.state != STATE_DEAD && seed_is_dead_by_time(&seed, now_ms)) {
            mark_seed_dead(registry, &mut seed, owner);
        };
        assert!(seed.state == STATE_DEAD, E_SEED_ALIVE);

        let seed_id = object::id(&seed);
        let sapling_id = seed.sapling_id;
        remove_seed_growth_points(registry, &mut seed, owner);
        remove_seed_from_owner(registry, owner, seed_id);
        if (
            table::contains(&registry.planted_saplings, sapling_id) &&
            *table::borrow(&registry.planted_saplings, sapling_id) == registry.current_season_id
        ) {
            table::remove(&mut registry.planted_saplings, sapling_id);
        };
        registry.total_seeds = if (registry.total_seeds > 0) registry.total_seeds - 1 else 0;
        event::emit(SeedAbandoned { seed_id, owner, sapling_id });

        let Seed {
            id,
            sapling_id: _,
            season_id: _,
            owner: _,
            planted_at_ms: _,
            last_watered_ms: _,
            watering_streak: _,
            growth_points: _,
            state: _,
            fertilizer_charges: _,
            miracle_grow_applied: _,
            revival_charges: _,
            bottomless_can_expiry_ms: _,
            permanent_gp_bonus: _,
        } = seed;
        object::delete(id);
    }

    // =========================================================
    //  Buy Crate
    // =========================================================
    entry fun buy_crate(
        registry: &mut Registry,
        tier: u8,
        mut payment: Coin<SUI>,
        ctx: &mut TxContext,
    ) {
        assert!(!registry.paused, E_PAUSED);
        assert!(tier <= CRATE_MYTHIC, E_INVALID_CRATE_TIER);

        let required =
            if      (tier == CRATE_SEEDLING) CRATE_PRICE_0
            else if (tier == CRATE_GROVE)    CRATE_PRICE_1
            else if (tier == CRATE_CANOPY)   CRATE_PRICE_2
            else if (tier == CRATE_ANCIENT)  CRATE_PRICE_3
            else                             CRATE_PRICE_4;

        assert!(coin::value(&payment) >= required, E_WRONG_PAYMENT);
        let buyer = tx_context::sender(ctx);
        let mut exact_coin = coin::split(&mut payment, required, ctx);
        pay_direct_invite_shop_bonus(registry, buyer, &mut exact_coin, ctx);
        route_paid_action(registry, exact_coin, ctx);

        if (coin::value(&payment) > 0) {
            transfer::public_transfer(payment, buyer);
        } else {
            coin::destroy_zero(payment);
        };

        let crate_obj = Crate { id: object::new(ctx), tier };
        let crate_id = object::id(&crate_obj);
        event::emit(CratePurchased { crate_id, buyer, tier });
        transfer::transfer(crate_obj, buyer);
    }

    entry fun send_promo_crate(
        _cap: &AdminCap,
        registry: &Registry,
        recipient: address,
        tier: u8,
        ctx: &mut TxContext,
    ) {
        assert_admin(registry, ctx);
        assert!(!registry.paused, E_PAUSED);
        assert!(tier <= CRATE_MYTHIC, E_INVALID_CRATE_TIER);

        let crate_obj = Crate { id: object::new(ctx), tier };
        let crate_id = object::id(&crate_obj);
        event::emit(CratePurchased { crate_id, buyer: recipient, tier });
        transfer::transfer(crate_obj, recipient);
    }

    // =========================================================
    //  Buy rotating one-off Supply Drop tool
    // =========================================================
    entry fun buy_supply_drop(
        registry: &mut Registry,
        drop: u8,
        mut payment: Coin<SUI>,
        ctx: &mut TxContext,
    ) {
        assert!(!registry.paused, E_PAUSED);

        let (kind_bytes, charges, rarity, required) = supply_drop_details(drop);
        assert!(coin::value(&payment) >= required, E_WRONG_PAYMENT);

        let buyer = tx_context::sender(ctx);
        let mut exact_coin = coin::split(&mut payment, required, ctx);
        pay_direct_invite_shop_bonus(registry, buyer, &mut exact_coin, ctx);
        route_paid_action(registry, exact_coin, ctx);

        if (coin::value(&payment) > 0) {
            transfer::public_transfer(payment, buyer);
        } else {
            coin::destroy_zero(payment);
        };

        let tool = Tool {
            id: object::new(ctx),
            kind: string::utf8(copy kind_bytes),
            charges,
            rarity,
        };
        let tool_id = object::id(&tool);
        event::emit(SupplyDropPurchased {
            tool_id,
            buyer,
            drop,
            tool_kind: string::utf8(kind_bytes),
            price_mist: required,
        });
        transfer::transfer(tool, buyer);
    }

    // =========================================================
    //  Open Crate
    // =========================================================
    entry fun open_crate(
        registry: &Registry,
        crate_obj: Crate,
        rng: &Random,
        ctx: &mut TxContext,
    ) {
        assert!(!registry.paused, E_PAUSED);
        let opener = tx_context::sender(ctx);
        let crate_id_val = object::id(&crate_obj);
        let Crate { id, tier } = crate_obj;
        object::delete(id);

        let mut rng_gen = random::new_generator(rng, ctx);

        if (tier == CRATE_SEEDLING) {
            // Seedling crate: 1 common item
            let kind = roll_common(&mut rng_gen);
            mint_crate_tool(crate_id_val, opener, kind, 2, 0, ctx);

        } else if (tier == CRATE_GROVE) {
            // Grove crate: 2 commons guaranteed, 0.01% legendary
            let r1 = roll_common(&mut rng_gen);
            let r2 = roll_common(&mut rng_gen);
            let leg_roll: u64 = random::generate_u64_in_range(&mut rng_gen, 0, 9_999);

            mint_crate_tool(crate_id_val, opener, r1, 2, 0, ctx);
            mint_crate_tool(crate_id_val, opener, r2, 2, 0, ctx);

            if (leg_roll == 0) {
                let leg = roll_legendary(&mut rng_gen);
                mint_crate_tool(crate_id_val, opener, leg, 1, 3, ctx);
            };

        } else if (tier == CRATE_CANOPY) {
            // Canopy crate: 3 items + 5% legendary chance
            let r1 = roll_uncommon(&mut rng_gen);
            let r2 = roll_common(&mut rng_gen);
            let r3 = roll_common(&mut rng_gen);

            mint_crate_tool(crate_id_val, opener, r1, 3, 1, ctx);
            mint_crate_tool(crate_id_val, opener, r2, 2, 0, ctx);
            mint_crate_tool(crate_id_val, opener, r3, 2, 0, ctx);

            let leg_roll: u8 = random::generate_u8_in_range(&mut rng_gen, 0, 99);
            if (leg_roll < 5) {
                let leg = roll_legendary(&mut rng_gen);
                mint_crate_tool(crate_id_val, opener, leg, 1, 3, ctx);
            };

        } else if (tier == CRATE_ANCIENT) {
            // Ancient crate: 5 items + 50% legendary
            let ra1 = roll_rare(&mut rng_gen);
            let ra2 = roll_rare(&mut rng_gen);
            let uc1 = roll_uncommon(&mut rng_gen);
            let uc2 = roll_uncommon(&mut rng_gen);
            let cm1 = roll_common(&mut rng_gen);

            mint_crate_tool(crate_id_val, opener, ra1, 3, 2, ctx);
            mint_crate_tool(crate_id_val, opener, ra2, 3, 2, ctx);
            mint_crate_tool(crate_id_val, opener, uc1, 3, 1, ctx);
            mint_crate_tool(crate_id_val, opener, uc2, 3, 1, ctx);
            mint_crate_tool(crate_id_val, opener, cm1, 2, 0, ctx);

            let leg_roll: u8 = random::generate_u8_in_range(&mut rng_gen, 0, 1);
            if (leg_roll == 0) {
                let leg = roll_legendary(&mut rng_gen);
                mint_crate_tool(crate_id_val, opener, leg, 1, 3, ctx);
            };

        } else {
            // Mythic crate: 9 items + 1 guaranteed legendary + 30% second legendary
            let le1 = roll_legendary(&mut rng_gen);
            let ra1 = roll_rare(&mut rng_gen);
            let ra2 = roll_rare(&mut rng_gen);
            let ra3 = roll_rare(&mut rng_gen);
            let uc1 = roll_uncommon(&mut rng_gen);
            let uc2 = roll_uncommon(&mut rng_gen);
            let uc3 = roll_uncommon(&mut rng_gen);
            let cm1 = roll_common(&mut rng_gen);
            let cm2 = roll_common(&mut rng_gen);

            mint_crate_tool(crate_id_val, opener, le1, 1, 3, ctx);
            mint_crate_tool(crate_id_val, opener, ra1, 3, 2, ctx);
            mint_crate_tool(crate_id_val, opener, ra2, 3, 2, ctx);
            mint_crate_tool(crate_id_val, opener, ra3, 3, 2, ctx);
            mint_crate_tool(crate_id_val, opener, uc1, 3, 1, ctx);
            mint_crate_tool(crate_id_val, opener, uc2, 3, 1, ctx);
            mint_crate_tool(crate_id_val, opener, uc3, 3, 1, ctx);
            mint_crate_tool(crate_id_val, opener, cm1, 2, 0, ctx);
            mint_crate_tool(crate_id_val, opener, cm2, 2, 0, ctx);

            let bonus_roll: u8 = random::generate_u8_in_range(&mut rng_gen, 0, 9);
            if (bonus_roll < 3) {
                let le2 = roll_legendary(&mut rng_gen);
                mint_crate_tool(crate_id_val, opener, le2, 1, 3, ctx);
            };
        };
    }

    // =========================================================
    //  Rarity roll helpers
    // =========================================================
    fun roll_common(rng: &mut RandomGenerator): vector<u8> {
        let r: u8 = random::generate_u8_in_range(rng, 0, 3);
        if      (r == 0) ITEM_FERTILIZER
        else if (r == 1) ITEM_WATERING_BOOST
        else if (r == 2) ITEM_COMPOST
        else             ITEM_GROWTH_TONIC
    }

    fun roll_uncommon(rng: &mut RandomGenerator): vector<u8> {
        let r: u8 = random::generate_u8_in_range(rng, 0, 4);
        if      (r == 0) ITEM_MIRACLE_GROW
        else if (r == 1) ITEM_MULCH
        else if (r == 2) ITEM_RAIN_BARREL
        else if (r == 3) ITEM_SUPER_SOIL
        else             ITEM_SUNSTONE
    }

    fun roll_rare(rng: &mut RandomGenerator): vector<u8> {
        let r: u8 = random::generate_u8_in_range(rng, 0, 5);
        if      (r == 0) ITEM_REVIVAL_KIT
        else if (r == 1) ITEM_DOUBLE_DOSE
        else if (r == 2) ITEM_DROUGHT_SHIELD
        else if (r == 3) ITEM_ANCIENT_BARK
        else if (r == 4) ITEM_MOON_WATER
        else             ITEM_EARTH_CORE
    }

    fun roll_legendary(rng: &mut RandomGenerator): vector<u8> {
        let r: u8 = random::generate_u8_in_range(rng, 0, 4);
        if      (r == 0) ITEM_BOTTOMLESS_CAN
        else if (r == 1) ITEM_PHILOSOPHERS_SOIL
        else if (r == 2) ITEM_TIMELESS_SEED
        else if (r == 3) ITEM_CRYSTAL_WATER
        else             ITEM_FOREST_HEART
    }

    // =========================================================
    //  Claim Reward
    // =========================================================
    entry fun claim_reward(
        registry: &mut Registry,
        seed: &mut Seed,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(!registry.paused, E_PAUSED);
        let caller = tx_context::sender(ctx);
        assert_seed_owner(seed, ctx);
        assert_seed_current(registry, seed);

        let now_ms = clock::timestamp_ms(clock);
        assert!(registry.season_start_ms > 0, E_SEASON_NOT_STARTED);
        let elapsed = now_ms - registry.season_start_ms;
        assert!(elapsed >= SEASON_DURATION_MS, E_SEASON_ENDED);

        if (seed.state == STATE_DEAD) {
            remove_seed_growth_points(registry, seed, caller);
            return
        };

        let drought_ms = now_ms - seed.last_watered_ms;
        let drought_days = drought_ms / ONE_DAY_MS;
        if (drought_days >= DEATH_DAYS && seed.bottomless_can_expiry_ms < now_ms) {
            mark_seed_dead(registry, seed, caller);
            return
        };

        seed.state = if (drought_days >= WILT_DAYS) STATE_WILTING else STATE_ALIVE;
        let seed_pts = seed.growth_points;
        assert!(seed_pts > 0, E_NO_SEEDS);

        let total_pts = registry.total_growth_points;
        let pool_size = balance::value(&registry.reward_pool);
        if (pool_size == 0 || total_pts == 0) {
            remove_seed_growth_points(registry, seed, caller);
            return
        };

        let share = (seed_pts * pool_size) / total_pts;
        remove_seed_growth_points(registry, seed, caller);

        let reward_coin = coin::from_balance(balance::split(&mut registry.reward_pool, share), ctx);
        event::emit(RewardClaimed { owner: caller, amount_mist: share });
        transfer::public_transfer(reward_coin, caller);
    }

    entry fun claim_archived_reward(
        archive: &mut SeasonArchive,
        seed: &mut Seed,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let caller = tx_context::sender(ctx);
        assert!(seed.owner == caller, E_SEED_NOT_FOUND);
        assert!(seed.season_id == archive.season_id, E_WRONG_SEASON);
        assert!(!archive.swept, E_ARCHIVE_SWEPT);

        let now_ms = clock::timestamp_ms(clock);
        assert!(now_ms <= archive.claim_deadline_ms, E_ARCHIVE_CLAIM_ENDED);
        assert!(seed.state != STATE_DEAD, E_SEED_DEAD);

        let seed_pts = seed.growth_points;
        assert!(seed_pts > 0, E_NO_SEEDS);

        let total_pts = archive.total_growth_points;
        let pool_size = balance::value(&archive.reward_pool);
        assert!(total_pts >= seed_pts, E_NO_SEEDS);
        if (pool_size == 0 || total_pts == 0) {
            archive.total_growth_points = total_pts - seed_pts;
            seed.growth_points = 0;
            return
        };

        let share = (seed_pts * pool_size) / total_pts;
        archive.total_growth_points = total_pts - seed_pts;
        seed.growth_points = 0;
        if (share == 0) {
            return
        };

        let reward_coin = coin::from_balance(balance::split(&mut archive.reward_pool, share), ctx);
        event::emit(ArchivedRewardClaimed {
            archive_id: object::id(archive),
            season_id: archive.season_id,
            owner: caller,
            seed_id: object::id(seed),
            amount_mist: share,
        });
        transfer::public_transfer(reward_coin, caller);
    }

    // =========================================================
    //  Admin: pool / treasury
    // =========================================================
    entry fun deposit_to_pool(_cap: &AdminCap, registry: &mut Registry, coin_in: Coin<SUI>, ctx: &TxContext) {
        assert_admin(registry, ctx);
        balance::join(&mut registry.reward_pool, coin::into_balance(coin_in));
    }

    entry fun withdraw_treasury(_cap: &AdminCap, registry: &mut Registry, amount: u64, ctx: &mut TxContext) {
        assert_admin(registry, ctx);
        let coin_out = coin::from_balance(balance::split(&mut registry.treasury, amount), ctx);
        transfer::public_transfer(coin_out, tx_context::sender(ctx));
    }

    entry fun sweep_archived_rewards(_cap: &AdminCap, archive: &mut SeasonArchive, clock: &Clock, ctx: &mut TxContext) {
        assert!(tx_context::sender(ctx) == archive.admin, E_NOT_ADMIN);
        assert!(!archive.swept, E_ARCHIVE_SWEPT);
        let now_ms = clock::timestamp_ms(clock);
        assert!(now_ms > archive.claim_deadline_ms, E_CLAIM_WINDOW_ACTIVE);
        let amount = balance::value(&archive.reward_pool);
        archive.swept = true;
        if (amount > 0) {
            let coin_out = coin::from_balance(balance::split(&mut archive.reward_pool, amount), ctx);
            transfer::public_transfer(coin_out, TREASURY_WALLET);
        };
        event::emit(ArchivedRewardsSwept { archive_id: object::id(archive), season_id: archive.season_id, amount_mist: amount });
    }

    entry fun transfer_admin(cap: AdminCap, new_admin: address, registry: &mut Registry, ctx: &TxContext) {
        assert_admin(registry, ctx);
        registry.admin = new_admin;
        transfer::transfer(cap, new_admin);
    }

    // =========================================================
    //  View helpers
    // =========================================================
    public fun seed_state_live(seed: &Seed, clock: &Clock): u8 {
        if (seed.state == STATE_DEAD) {
            return STATE_DEAD
        };
        let now_ms = clock::timestamp_ms(clock);
        let drought_days = (now_ms - seed.last_watered_ms) / ONE_DAY_MS;
        if (seed.bottomless_can_expiry_ms >= now_ms) STATE_ALIVE
        else if (drought_days >= DEATH_DAYS) STATE_DEAD
        else if (drought_days >= WILT_DAYS) STATE_WILTING
        else STATE_ALIVE
    }

    public fun seed_growth_points(seed: &Seed): u64          { seed.growth_points }
    public fun seed_streak(seed: &Seed): u64                 { seed.watering_streak }
    public fun seed_fertilizer_charges(seed: &Seed): u8      { seed.fertilizer_charges }
    public fun seed_revival_charges(seed: &Seed): u8         { seed.revival_charges }
    public fun seed_bottomless_expiry(seed: &Seed): u64      { seed.bottomless_can_expiry_ms }
    public fun registry_pool_size(r: &Registry): u64         { balance::value(&r.reward_pool) }
    public fun registry_total_seeds(r: &Registry): u64       { r.total_seeds }
    public fun registry_total_gp(r: &Registry): u64          { r.total_growth_points }
    public fun registry_is_paused(r: &Registry): bool        { r.paused }
    public fun registry_season_end_ms(r: &Registry): u64 {
        if (r.season_start_ms == 0) 0 else r.season_start_ms + SEASON_DURATION_MS
    }
    public fun registry_claim_deadline_ms(r: &Registry): u64 {
        if (r.season_start_ms == 0) 0 else r.season_start_ms + SEASON_DURATION_MS + CLAIM_GRACE_MS
    }
    public fun registry_review_ready_ms(r: &Registry): u64 {
        if (r.season_start_ms == 0) 0 else r.season_start_ms + SEASON_DURATION_MS + REVIEW_WINDOW_MS
    }
    public fun archive_season_id(a: &SeasonArchive): u64 { a.season_id }
    public fun archive_season_start_ms(a: &SeasonArchive): u64 { a.season_start_ms }
    public fun archive_season_end_ms(a: &SeasonArchive): u64 { a.season_end_ms }
    public fun archive_finalized_at_ms(a: &SeasonArchive): u64 { a.finalized_at_ms }
    public fun archive_claim_deadline_ms(a: &SeasonArchive): u64 { a.claim_deadline_ms }
    public fun archive_total_gp(a: &SeasonArchive): u64 { a.total_growth_points }
    public fun archive_total_seeds(a: &SeasonArchive): u64 { a.total_seeds }
    public fun archive_pool_size(a: &SeasonArchive): u64 { balance::value(&a.reward_pool) }
    public fun archive_is_swept(a: &SeasonArchive): bool { a.swept }

    public fun challenge_book_admin(book: &ChallengeBook): address { book.admin }
    public fun challenge_book_current_id(book: &ChallengeBook): u64 { book.current_challenge_id }
    public fun challenge_book_active_id(book: &ChallengeBook): u64 { book.active_challenge_id }
    public fun challenge_book_active_end_ms(book: &ChallengeBook): u64 { book.active_end_ms }
    public fun canopy_challenge_id(challenge: &CanopyChallenge): u64 { challenge.challenge_id }
    public fun canopy_challenge_season_id(challenge: &CanopyChallenge): u64 { challenge.season_id }
    public fun canopy_challenge_start_ms(challenge: &CanopyChallenge): u64 { challenge.start_ms }
    public fun canopy_challenge_end_ms(challenge: &CanopyChallenge): u64 { challenge.end_ms }
    public fun canopy_challenge_entry_fee(challenge: &CanopyChallenge): u64 { challenge.entry_fee_mist }
    public fun canopy_challenge_entry_count(challenge: &CanopyChallenge): u64 { challenge.entry_count }
    public fun canopy_challenge_pot_size(challenge: &CanopyChallenge): u64 { balance::value(&challenge.pot) }
    public fun canopy_challenge_is_settled(challenge: &CanopyChallenge): bool { challenge.settled }
    public fun canopy_challenge_is_canceled(challenge: &CanopyChallenge): bool { challenge.canceled }
    public fun canopy_challenge_has_entry(challenge: &CanopyChallenge, player: address): bool {
        table::contains(&challenge.entries, player)
    }
    public fun canopy_challenge_entry_baseline(challenge: &CanopyChallenge, player: address): u64 {
        if (table::contains(&challenge.entries, player)) {
            table::borrow(&challenge.entries, player).baseline_growth_points
        } else {
            0
        }
    }
    public fun canopy_challenge_entry_refunded(challenge: &CanopyChallenge, player: address): bool {
        if (table::contains(&challenge.entries, player)) {
            table::borrow(&challenge.entries, player).refunded
        } else {
            false
        }
    }
    public fun canopy_challenge_player_score(registry: &Registry, challenge: &CanopyChallenge, player: address): u64 {
        if (table::contains(&challenge.entries, player)) {
            player_challenge_score(registry, challenge, player)
        } else {
            0
        }
    }

    public fun player_growth_points(r: &Registry, addr: address): u64 {
        if (
            table::contains(&r.player_growth, addr) &&
            *table::borrow(&r.player_growth_season, addr) == r.current_season_id
        ) *table::borrow(&r.player_growth, addr) else 0
    }

    public fun player_referral_earnings(r: &Registry, addr: address): u64 {
        if (table::contains(&r.referral_earnings, addr)) *table::borrow(&r.referral_earnings, addr) else 0
    }

    public fun sapling_is_planted(r: &Registry, sapling_id: ID): bool {
        table::contains(&r.planted_saplings, sapling_id) &&
            *table::borrow(&r.planted_saplings, sapling_id) == r.current_season_id
    }

    #[test_only]
    fun test_enter_canopy_sprint_as(
        player: address,
        challenge: &mut CanopyChallenge,
        registry: &Registry,
        payment: Coin<SUI>,
        clock: &Clock,
    ) {
        assert!(!registry.paused, E_PAUSED);
        assert!(!challenge.settled, E_CHALLENGE_SETTLED);
        assert!(!challenge.canceled, E_CHALLENGE_CANCELED);
        assert!(challenge.season_id == registry.current_season_id, E_WRONG_SEASON);
        let now = assert_season_active(registry, clock);
        assert!(now >= challenge.start_ms && now < challenge.end_ms, E_CHALLENGE_NOT_OPEN);
        assert!(!table::contains(&challenge.entries, player), E_CHALLENGE_ALREADY_ENTERED);
        assert!(coin::value(&payment) == challenge.entry_fee_mist, E_WRONG_PAYMENT);

        let baseline_growth_points = player_growth_points(registry, player);
        table::add(&mut challenge.entries, player, ChallengeEntry {
            player,
            season_id: registry.current_season_id,
            baseline_growth_points,
            entered_at_ms: now,
            refunded: false,
        });
        challenge.entry_count = challenge.entry_count + 1;
        balance::join(&mut challenge.pot, coin::into_balance(payment));
    }

    #[test_only]
    fun test_cancel_canopy_sprint(book: &mut ChallengeBook, challenge: &mut CanopyChallenge, clock: &Clock) {
        assert!(!challenge.settled, E_CHALLENGE_SETTLED);
        assert!(!challenge.canceled, E_CHALLENGE_CANCELED);
        assert!(clock::timestamp_ms(clock) >= challenge.end_ms, E_CHALLENGE_NOT_ENDED);
        assert!(challenge.entry_count < CANOPY_CHALLENGE_MIN_ENTRIES, E_CHALLENGE_MIN_ENTRIES);

        challenge.canceled = true;
        if (book.active_challenge_id == challenge.challenge_id) {
            book.active_challenge_id = 0;
            book.active_end_ms = 0;
        };
    }

    #[test_only]
    fun test_refund_canceled_canopy_sprint_entry_as(
        player: address,
        challenge: &mut CanopyChallenge,
        ctx: &mut TxContext,
    ) {
        assert!(challenge.canceled, E_CHALLENGE_NOT_ACTIVE);
        assert!(table::contains(&challenge.entries, player), E_CHALLENGE_NOT_ENTERED);
        let entry = table::borrow_mut(&mut challenge.entries, player);
        assert!(!entry.refunded, E_ALREADY_REFUNDED);
        entry.refunded = true;
        let refund_mist = challenge.entry_fee_mist;
        payout_from_challenge_pot(challenge, player, refund_mist, ctx);
    }

    #[test_only]
    fun test_finalize_canopy_sprint(
        book: &mut ChallengeBook,
        challenge: &mut CanopyChallenge,
        registry: &Registry,
        first: address,
        second: address,
        third: address,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(!challenge.settled, E_CHALLENGE_SETTLED);
        assert!(!challenge.canceled, E_CHALLENGE_CANCELED);
        assert!(challenge.season_id == registry.current_season_id, E_WRONG_SEASON);
        assert!(clock::timestamp_ms(clock) >= challenge.end_ms, E_CHALLENGE_NOT_ENDED);
        assert!(challenge.entry_count >= CANOPY_CHALLENGE_MIN_ENTRIES, E_CHALLENGE_MIN_ENTRIES);
        assert!(first != second && first != third && second != third, E_INVALID_WINNERS);

        let first_score = player_challenge_score(registry, challenge, first);
        let second_score = player_challenge_score(registry, challenge, second);
        let third_score = player_challenge_score(registry, challenge, third);
        assert!(first_score >= second_score && second_score >= third_score, E_INVALID_SCORE_ORDER);

        let gross = balance::value(&challenge.pot);
        let prize_pool = gross * CHALLENGE_PRIZE_BPS / BPS_DENOMINATOR;
        let treasury_mist = gross * CHALLENGE_TREASURY_BPS / BPS_DENOMINATOR;
        let dev_fee_mist = gross - prize_pool - treasury_mist;
        let first_payout_mist = prize_pool * CHALLENGE_FIRST_BPS / BPS_DENOMINATOR;
        let second_payout_mist = prize_pool * CHALLENGE_SECOND_BPS / BPS_DENOMINATOR;
        let third_payout_mist = prize_pool - first_payout_mist - second_payout_mist;

        payout_from_challenge_pot(challenge, TREASURY_WALLET, treasury_mist, ctx);
        payout_from_challenge_pot(challenge, DEV_FEE_WALLET, dev_fee_mist, ctx);
        payout_from_challenge_pot(challenge, first, first_payout_mist, ctx);
        payout_from_challenge_pot(challenge, second, second_payout_mist, ctx);
        payout_from_challenge_pot(challenge, third, third_payout_mist, ctx);

        challenge.settled = true;
        if (book.active_challenge_id == challenge.challenge_id) {
            book.active_challenge_id = 0;
            book.active_end_ms = 0;
        };
    }

    #[test_only]
    fun test_registry(admin: address, season_start_ms: u64, ctx: &mut TxContext): Registry {
        Registry {
            id: object::new(ctx),
            admin,
            current_season_id: 1,
            season_start_ms,
            reward_pool: balance::create_for_testing<SUI>(123_456_789),
            treasury: balance::zero<SUI>(),
            total_seeds: 0,
            total_growth_points: 0,
            paused: false,
            seeds_by_owner:    table::new<address, vector<ID>>(ctx),
            referrers:         table::new<address, address>(ctx),
            referral_earnings: table::new<address, u64>(ctx),
            player_growth:        table::new<address, u64>(ctx),
            player_growth_season: table::new<address, u64>(ctx),
            planted_saplings:     table::new<ID, u64>(ctx),
        }
    }

    #[test_only]
    fun destroy_test_registry(registry: Registry): (u64, u64) {
        let Registry {
            id,
            admin: _,
            current_season_id: _,
            season_start_ms: _,
            reward_pool,
            treasury,
            total_seeds: _,
            total_growth_points: _,
            paused: _,
            seeds_by_owner,
            referrers,
            referral_earnings,
            player_growth,
            player_growth_season,
            planted_saplings,
        } = registry;
        object::delete(id);
        table::drop(seeds_by_owner);
        table::drop(referrers);
        table::drop(referral_earnings);
        table::drop(player_growth);
        table::drop(player_growth_season);
        table::drop(planted_saplings);
        (balance::destroy_for_testing(reward_pool), balance::destroy_for_testing(treasury))
    }

    #[test_only]
    fun test_admin_cap(ctx: &mut TxContext): AdminCap {
        AdminCap { id: object::new(ctx) }
    }

    #[test_only]
    fun destroy_test_admin_cap(cap: AdminCap) {
        let AdminCap { id } = cap;
        object::delete(id);
    }

    #[test_only]
    fun test_challenge_book(admin: address, challenge_id: u64, end_ms: u64, ctx: &mut TxContext): ChallengeBook {
        ChallengeBook {
            id: object::new(ctx),
            admin,
            current_challenge_id: challenge_id,
            active_challenge_id: challenge_id,
            active_end_ms: end_ms,
        }
    }

    #[test_only]
    fun destroy_test_challenge_book(book: ChallengeBook) {
        let ChallengeBook { id, admin: _, current_challenge_id: _, active_challenge_id: _, active_end_ms: _ } = book;
        object::delete(id);
    }

    #[test_only]
    fun test_canopy_challenge(season_id: u64, start_ms: u64, end_ms: u64, ctx: &mut TxContext): CanopyChallenge {
        CanopyChallenge {
            id: object::new(ctx),
            challenge_id: 1,
            season_id,
            start_ms,
            end_ms,
            entry_fee_mist: CANOPY_CHALLENGE_ENTRY_MIST,
            entry_count: 0,
            settled: false,
            canceled: false,
            pot: balance::zero<SUI>(),
            entries: table::new<address, ChallengeEntry>(ctx),
        }
    }

    #[test_only]
    fun remove_test_entry(challenge: &mut CanopyChallenge, player: address) {
        if (table::contains(&challenge.entries, player)) {
            let ChallengeEntry { player: _, season_id: _, baseline_growth_points: _, entered_at_ms: _, refunded: _ } =
                table::remove(&mut challenge.entries, player);
        };
    }

    #[test_only]
    fun destroy_test_canopy_challenge(challenge: CanopyChallenge): u64 {
        let CanopyChallenge {
            id,
            challenge_id: _,
            season_id: _,
            start_ms: _,
            end_ms: _,
            entry_fee_mist: _,
            entry_count: _,
            settled: _,
            canceled: _,
            pot,
            entries,
        } = challenge;
        object::delete(id);
        table::destroy_empty(entries);
        balance::destroy_for_testing(pot)
    }

    #[test_only]
    fun set_player_gp(registry: &mut Registry, player: address, points: u64) {
        if (table::contains(&registry.player_growth, player)) {
            *table::borrow_mut(&mut registry.player_growth, player) = points;
        } else {
            table::add(&mut registry.player_growth, player, points);
            table::add(&mut registry.player_growth_season, player, registry.current_season_id);
        };
    }

    #[test]
    fun canopy_entry_records_baseline_and_pot() {
        let admin = @0xA;
        let player = @0xB;
        let start_ms = 1;
        let now_ms = start_ms + CANOPY_CHALLENGE_UNLOCK_MS + 1;
        let mut ctx = tx_context::new_from_hint(player, 1, 0, 0, 0);
        let mut clock = clock::create_for_testing(&mut ctx);
        clock::set_for_testing(&mut clock, now_ms);
        let mut registry = test_registry(admin, start_ms, &mut ctx);
        set_player_gp(&mut registry, player, 120);
        let mut challenge = test_canopy_challenge(registry.current_season_id, now_ms, now_ms + CANOPY_CHALLENGE_DURATION_MS, &mut ctx);
        let payment = coin::mint_for_testing<SUI>(CANOPY_CHALLENGE_ENTRY_MIST, &mut ctx);

        test_enter_canopy_sprint_as(player, &mut challenge, &registry, payment, &clock);
        assert!(challenge.entry_count == 1, 0);
        assert!(balance::value(&challenge.pot) == CANOPY_CHALLENGE_ENTRY_MIST, 0);
        assert!(canopy_challenge_entry_baseline(&challenge, player) == 120, 0);
        assert!(canopy_challenge_player_score(&registry, &challenge, player) == 0, 0);

        set_player_gp(&mut registry, player, 155);
        assert!(canopy_challenge_player_score(&registry, &challenge, player) == 35, 0);

        remove_test_entry(&mut challenge, player);
        assert!(destroy_test_canopy_challenge(challenge) == CANOPY_CHALLENGE_ENTRY_MIST, 0);
        let (_, treasury) = destroy_test_registry(registry);
        assert!(treasury == 0, 0);
        clock::destroy_for_testing(clock);
    }

    #[test, expected_failure(abort_code = E_CHALLENGE_ALREADY_ENTERED)]
    fun canopy_entry_rejects_double_entry() {
        let admin = @0xA;
        let player = @0xB;
        let start_ms = 1;
        let now_ms = start_ms + CANOPY_CHALLENGE_UNLOCK_MS + 1;
        let mut ctx = tx_context::new_from_hint(player, 2, 0, 0, 0);
        let mut clock = clock::create_for_testing(&mut ctx);
        clock::set_for_testing(&mut clock, now_ms);
        let registry = test_registry(admin, start_ms, &mut ctx);
        let mut challenge = test_canopy_challenge(registry.current_season_id, now_ms, now_ms + CANOPY_CHALLENGE_DURATION_MS, &mut ctx);
        let payment_one = coin::mint_for_testing<SUI>(CANOPY_CHALLENGE_ENTRY_MIST, &mut ctx);
        let payment_two = coin::mint_for_testing<SUI>(CANOPY_CHALLENGE_ENTRY_MIST, &mut ctx);

        test_enter_canopy_sprint_as(player, &mut challenge, &registry, payment_one, &clock);
        test_enter_canopy_sprint_as(player, &mut challenge, &registry, payment_two, &clock);
        abort 999
    }

    #[test]
    fun canopy_underfilled_challenge_can_cancel_and_refund() {
        let admin = @0xA;
        let player_one = @0xB;
        let player_two = @0xC;
        let start_ms = 1;
        let now_ms = start_ms + CANOPY_CHALLENGE_UNLOCK_MS + 1;
        let end_ms = now_ms + CANOPY_CHALLENGE_DURATION_MS;
        let mut admin_ctx = tx_context::new_from_hint(admin, 3, 0, 0, 0);
        let mut clock = clock::create_for_testing(&mut admin_ctx);
        clock::set_for_testing(&mut clock, now_ms);
        let registry = test_registry(admin, start_ms, &mut admin_ctx);
        let cap = test_admin_cap(&mut admin_ctx);
        let mut book = test_challenge_book(admin, 1, end_ms, &mut admin_ctx);
        let mut challenge = test_canopy_challenge(registry.current_season_id, now_ms, end_ms, &mut admin_ctx);

        let mut player_one_ctx = tx_context::new_from_hint(player_one, 4, 0, 0, 0);
        test_enter_canopy_sprint_as(player_one, &mut challenge, &registry, coin::mint_for_testing<SUI>(CANOPY_CHALLENGE_ENTRY_MIST, &mut player_one_ctx), &clock);
        let mut player_two_ctx = tx_context::new_from_hint(player_two, 5, 0, 0, 0);
        test_enter_canopy_sprint_as(player_two, &mut challenge, &registry, coin::mint_for_testing<SUI>(CANOPY_CHALLENGE_ENTRY_MIST, &mut player_two_ctx), &clock);
        assert!(balance::value(&challenge.pot) == CANOPY_CHALLENGE_ENTRY_MIST * 2, 0);

        clock::set_for_testing(&mut clock, end_ms);
        test_cancel_canopy_sprint(&mut book, &mut challenge, &clock);
        assert!(challenge.canceled, 0);
        assert!(book.active_challenge_id == 0, 0);

        test_refund_canceled_canopy_sprint_entry_as(player_one, &mut challenge, &mut player_one_ctx);
        assert!(canopy_challenge_entry_refunded(&challenge, player_one), 0);
        assert!(balance::value(&challenge.pot) == CANOPY_CHALLENGE_ENTRY_MIST, 0);
        test_refund_canceled_canopy_sprint_entry_as(player_two, &mut challenge, &mut player_two_ctx);
        assert!(balance::value(&challenge.pot) == 0, 0);

        remove_test_entry(&mut challenge, player_one);
        remove_test_entry(&mut challenge, player_two);
        assert!(destroy_test_canopy_challenge(challenge) == 0, 0);
        destroy_test_challenge_book(book);
        destroy_test_admin_cap(cap);
        let (reward_pool, treasury) = destroy_test_registry(registry);
        assert!(reward_pool == 123_456_789, 0);
        assert!(treasury == 0, 0);
        clock::destroy_for_testing(clock);
    }

    #[test]
    fun canopy_finalize_splits_side_pot_without_touching_growth_pool() {
        let admin = @0xA;
        let first = @0xB;
        let second = @0xC;
        let third = @0xD;
        let start_ms = 1;
        let now_ms = start_ms + CANOPY_CHALLENGE_UNLOCK_MS + 1;
        let end_ms = now_ms + CANOPY_CHALLENGE_DURATION_MS;
        let mut admin_ctx = tx_context::new_from_hint(admin, 6, 0, 0, 0);
        let mut clock = clock::create_for_testing(&mut admin_ctx);
        clock::set_for_testing(&mut clock, now_ms);
        let mut registry = test_registry(admin, start_ms, &mut admin_ctx);
        let cap = test_admin_cap(&mut admin_ctx);
        let mut book = test_challenge_book(admin, 1, end_ms, &mut admin_ctx);
        let mut challenge = test_canopy_challenge(registry.current_season_id, now_ms, end_ms, &mut admin_ctx);

        let mut first_ctx = tx_context::new_from_hint(first, 7, 0, 0, 0);
        let mut second_ctx = tx_context::new_from_hint(second, 8, 0, 0, 0);
        let mut third_ctx = tx_context::new_from_hint(third, 9, 0, 0, 0);
        test_enter_canopy_sprint_as(first, &mut challenge, &registry, coin::mint_for_testing<SUI>(CANOPY_CHALLENGE_ENTRY_MIST, &mut first_ctx), &clock);
        test_enter_canopy_sprint_as(second, &mut challenge, &registry, coin::mint_for_testing<SUI>(CANOPY_CHALLENGE_ENTRY_MIST, &mut second_ctx), &clock);
        test_enter_canopy_sprint_as(third, &mut challenge, &registry, coin::mint_for_testing<SUI>(CANOPY_CHALLENGE_ENTRY_MIST, &mut third_ctx), &clock);

        set_player_gp(&mut registry, first, 90);
        set_player_gp(&mut registry, second, 60);
        set_player_gp(&mut registry, third, 30);
        let pool_before = registry_pool_size(&registry);
        let gross = balance::value(&challenge.pot);
        let prize_pool = gross * CHALLENGE_PRIZE_BPS / BPS_DENOMINATOR;
        let first_payout = prize_pool * CHALLENGE_FIRST_BPS / BPS_DENOMINATOR;
        let second_payout = prize_pool * CHALLENGE_SECOND_BPS / BPS_DENOMINATOR;
        let third_payout = prize_pool - first_payout - second_payout;
        assert!(first_payout == 472_500_000, 0);
        assert!(second_payout == 135_000_000, 0);
        assert!(third_payout == 67_500_000, 0);

        clock::set_for_testing(&mut clock, end_ms);
        test_finalize_canopy_sprint(&mut book, &mut challenge, &registry, first, second, third, &clock, &mut admin_ctx);
        assert!(challenge.settled, 0);
        assert!(book.active_challenge_id == 0, 0);
        assert!(balance::value(&challenge.pot) == 0, 0);
        assert!(registry_pool_size(&registry) == pool_before, 0);

        remove_test_entry(&mut challenge, first);
        remove_test_entry(&mut challenge, second);
        remove_test_entry(&mut challenge, third);
        assert!(destroy_test_canopy_challenge(challenge) == 0, 0);
        destroy_test_challenge_book(book);
        destroy_test_admin_cap(cap);
        let (reward_pool, treasury) = destroy_test_registry(registry);
        assert!(reward_pool == pool_before, 0);
        assert!(treasury == 0, 0);
        clock::destroy_for_testing(clock);
    }
}
