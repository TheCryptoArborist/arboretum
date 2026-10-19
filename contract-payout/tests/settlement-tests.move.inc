    // Appended only to a generated test copy of arboretum::settlement.
    // Fixtures deliberately construct small exact histories; payout assertions
    // exercise the real entry functions and inspect resulting balances/state.
    use std::unit_test::assert_eq;
    use sui::test_scenario;

    #[test_only]
    const SF_START: u64 = ONE_DAY_MS;
    #[test_only]
    const SF_END: u64 = SF_START + SEASON_DURATION_MS;
    #[test_only]
    const SF_MAX_U64: u64 = 18_446_744_073_709_551_615;

    #[test_only]
    fun sf_registry(amount: u64, ctx: &mut TxContext): Registry {
        let mut registry = test_registry(@0xA, SF_START, ctx);
        let old_amount = balance::value(&registry.reward_pool);
        let old_balance = balance::split(&mut registry.reward_pool, old_amount);
        assert_eq!(balance::destroy_for_testing(old_balance), 123_456_789);
        balance::join(&mut registry.reward_pool, balance::create_for_testing<SUI>(amount));
        assert_eq!(registry.eligible_growth_points, 0);
        assert!(option::is_none(&registry.settlement));
        registry
    }

    #[test_only]
    fun sf_seed(
        registry: &mut Registry, owner: address, last_watered: u64, points: u64,
        ctx: &mut TxContext,
    ): Seed {
        let mut seed = Seed {
            id: object::new(ctx), version: VERSION,
            registry_id: object::id(registry), cutoff_growth_points: 0,
            reward_processed: false,
            sapling_id: object::id_from_address(owner),
            season_id: registry.current_season_id, owner,
            planted_at_ms: registry.season_start_ms,
            last_watered_ms: last_watered, watering_streak: 1,
            growth_points: 0, state: STATE_ALIVE,
            fertilizer_charges: 0, miracle_grow_applied: false,
            revival_charges: 0, bottomless_can_expiry_ms: 0,
            permanent_gp_bonus: 0,
        };
        registry.total_seeds = registry.total_seeds + 1;
        if (!table::contains(&registry.seeds_by_owner, owner)) {
            table::add(&mut registry.seeds_by_owner, owner, vector[]);
        };
        vector::push_back(table::borrow_mut(&mut registry.seeds_by_owner, owner), object::id(&seed));
        add_growth_points(registry, &mut seed, owner, points);
        sync_cutoff_points(registry, &mut seed);
        seed
    }

    #[test_only]
    fun sf_clock(at: u64, ctx: &mut TxContext): Clock {
        let mut clock = clock::create_for_testing(ctx);
        clock::set_for_testing(&mut clock, at);
        clock
    }

    #[test_only]
    fun sf_tool(kind: vector<u8>, ctx: &mut TxContext): Tool {
        Tool { id: object::new(ctx), version: VERSION, kind: string::utf8(kind), charges: 1, rarity: 0 }
    }

    #[test_only]
    fun sf_sapling(ctx: &mut TxContext): Sapling {
        Sapling {
            id: object::new(ctx), version: VERSION, name: string::utf8(b"settlement fixture"),
            cycle_count: 0, total_sui_harvested: 0,
        }
    }

    // Guard/arithmetic tests use this compact fixture. Separate lifecycle tests
    // below call reset_season / finalize_season_archive_now and take the actual
    // shared archive, so archive construction is independently exercised.
    #[test_only]
    fun sf_archive(registry: &mut Registry, clock: &Clock, ctx: &mut TxContext): SeasonArchive {
        finalize_reward_settlement(registry, clock);
        let settlement = option::extract(&mut registry.settlement);
        let season_end_ms = settlement.season_end_ms;
        let claim_deadline_ms = settlement.claim_deadline_ms;
        let remaining = balance::value(&registry.reward_pool);
        SeasonArchive {
            id: object::new(ctx), version: VERSION, registry_id: object::id(registry),
            settlement,
            admin: registry.admin, season_id: registry.current_season_id,
            season_start_ms: registry.season_start_ms, season_end_ms,
            finalized_at_ms: clock::timestamp_ms(clock), claim_deadline_ms,
            total_growth_points: registry.total_growth_points,
            total_seeds: registry.total_seeds,
            reward_pool: balance::split(&mut registry.reward_pool, remaining), swept: false,
        }
    }

    #[test_only]
    fun sf_conserved(settlement: &SettlementState, remaining: u64) {
        assert_eq!(settlement.paid_mist + remaining, settlement.pool_mist);
        assert!(settlement.processed_growth_points <= settlement.eligible_growth_points);
    }

    #[test]
    fun settlement_direct_and_archive_use_same_cutoff_after_later_drought() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut direct = sf_registry(1_000, scenario.ctx());
        let mut archived = sf_registry(1_000, scenario.ctx());
        let mut direct_seed = sf_seed(&mut direct, @0xA, SF_END - 9 * ONE_DAY_MS, 100, scenario.ctx());
        let mut archived_seed = sf_seed(&mut archived, @0xA, SF_END - 9 * ONE_DAY_MS, 100, scenario.ctx());
        let mut clock = sf_clock(SF_END + REVIEW_WINDOW_MS, scenario.ctx());
        assert!(!seed_is_dead_by_time(&direct_seed, SF_END));
        assert_eq!(direct.eligible_growth_points, 100);
        assert_eq!(archived.eligible_growth_points, 100);
        let cap = test_admin_cap_for(&archived, scenario.ctx());
        reset_season(&cap, &mut archived, &clock, scenario.ctx());
        scenario.next_tx(@0xA);
        clock::set_for_testing(&mut clock, SF_END + 2 * ONE_DAY_MS);
        assert!(seed_is_dead_by_time(&direct_seed, clock::timestamp_ms(&clock)));
        claim_reward(&mut direct, &mut direct_seed, &clock, scenario.ctx());
        assert_eq!(registry_pool_size(&direct), 0);
        assert_eq!(option::borrow(&direct.settlement).paid_mist, 1_000);
        assert_eq!(option::borrow(&direct.settlement).eligible_growth_points, 100);
        assert!(direct_seed.reward_processed);
        assert!(direct_seed.state != STATE_DEAD);
        scenario.next_tx(@0xA);
        let direct_payment = scenario.take_from_sender<Coin<SUI>>();
        assert_eq!(coin::value(&direct_payment), 1_000);
        std::unit_test::destroy(direct_payment);
        let mut archive = scenario.take_shared<SeasonArchive>();
        claim_archived_reward(&mut archive, &mut archived_seed, &clock, scenario.ctx());
        assert_eq!(archive_pool_size(&archive), 0);
        assert_eq!(archive.settlement.paid_mist, 1_000);
        assert!(archived_seed.reward_processed);
        assert!(archived_seed.state != STATE_DEAD);
        assert_eq!(archive.claim_deadline_ms, SF_END + CLAIM_GRACE_MS);
        sf_conserved(&archive.settlement, 0);
        test_scenario::return_shared(archive);
        scenario.next_tx(@0xA);
        let archived_payment = scenario.take_from_sender<Coin<SUI>>();
        assert_eq!(coin::value(&archived_payment), 1_000);
        std::unit_test::destroy(archived_payment);
        std::unit_test::destroy(scenario.take_shared<SeasonArchive>());
        std::unit_test::destroy(direct);
        std::unit_test::destroy(archived);
        std::unit_test::destroy(direct_seed);
        std::unit_test::destroy(archived_seed);
        std::unit_test::destroy(cap);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    fun settlement_dead_seed_order_does_not_change_eligible_payment() {
        let mut ctx = tx_context::new_from_hint(@0xA, 100, 0, 0, 0);
        let clock = sf_clock(SF_END + 2 * ONE_DAY_MS, &mut ctx);
        let mut first = sf_registry(1_000, &mut ctx);
        let mut second = sf_registry(1_000, &mut ctx);
        let mut first_a = sf_seed(&mut first, @0xA, SF_END - ONE_DAY_MS, 40, &mut ctx);
        let mut first_b = sf_seed(&mut first, @0xA, SF_END - 11 * ONE_DAY_MS, 60, &mut ctx);
        let mut second_a = sf_seed(&mut second, @0xA, SF_END - ONE_DAY_MS, 40, &mut ctx);
        let mut second_b = sf_seed(&mut second, @0xA, SF_END - 11 * ONE_DAY_MS, 60, &mut ctx);
        assert_eq!(first.eligible_growth_points, 40);
        assert_eq!(second.eligible_growth_points, 40);
        claim_reward(&mut first, &mut first_a, &clock, &mut ctx);
        assert_eq!(registry_pool_size(&first), 0);
        claim_reward(&mut first, &mut first_b, &clock, &mut ctx);
        claim_reward(&mut second, &mut second_b, &clock, &mut ctx);
        assert_eq!(registry_pool_size(&second), 1_000);
        claim_reward(&mut second, &mut second_a, &clock, &mut ctx);
        assert_eq!(registry_pool_size(&second), 0);
        assert_eq!(option::borrow(&first.settlement).paid_mist, 1_000);
        assert_eq!(option::borrow(&second.settlement).paid_mist, 1_000);
        assert_eq!(option::borrow(&first.settlement).eligible_growth_points, 40);
        assert_eq!(option::borrow(&first.settlement).processed_growth_points, 40);
        assert_eq!(option::borrow(&first.settlement).processed_seeds, 2);
        assert_eq!(first.total_growth_points, 100);
        assert_eq!(second.total_growth_points, 100);
        assert!(first_b.reward_processed && second_b.reward_processed);
        sf_conserved(option::borrow(&first.settlement), 0);
        sf_conserved(option::borrow(&second.settlement), 0);
        std::unit_test::destroy(first);
        std::unit_test::destroy(second);
        std::unit_test::destroy(first_a);
        std::unit_test::destroy(first_b);
        std::unit_test::destroy(second_a);
        std::unit_test::destroy(second_b);
        clock::destroy_for_testing(clock);
    }

    #[test_only]
    fun sf_fractional_order(order: vector<u64>) {
        let hint = 1_000 + order[0] * 100 + order[1] * 10 + order[2];
        let mut ctx = tx_context::new_from_hint(@0xA, hint, 0, 0, 0);
        let clock = sf_clock(SF_END, &mut ctx);
        let mut registry = sf_registry(10, &mut ctx);
        let a = sf_seed(&mut registry, @0xA, SF_END - ONE_DAY_MS, 1, &mut ctx);
        let b = sf_seed(&mut registry, @0xA, SF_END - ONE_DAY_MS, 2, &mut ctx);
        let c = sf_seed(&mut registry, @0xA, SF_END - ONE_DAY_MS, 3, &mut ctx);
        let mut seeds = vector[a, b, c];
        let expected = vector[1u64, 3, 5];
        let mut i = 0;
        while (i < 3) {
            let index = order[i];
            let before = registry_pool_size(&registry);
            claim_reward(&mut registry, &mut seeds[index], &clock, &mut ctx);
            assert_eq!(before - registry_pool_size(&registry), expected[index]);
            assert!(seeds[index].reward_processed);
            assert_eq!(seeds[index].growth_points, 0);
            assert_eq!(seeds[index].cutoff_growth_points, 0);
            assert_eq!(option::borrow(&registry.settlement).pool_mist, 10);
            assert_eq!(option::borrow(&registry.settlement).eligible_growth_points, 6);
            sf_conserved(option::borrow(&registry.settlement), registry_pool_size(&registry));
            i = i + 1;
        };
        assert_eq!(registry_pool_size(&registry), 1);
        assert_eq!(option::borrow(&registry.settlement).paid_mist, 9);
        assert_eq!(option::borrow(&registry.settlement).processed_growth_points, 6);
        assert_eq!(option::borrow(&registry.settlement).processed_seeds, 3);
        std::unit_test::destroy(registry);
        std::unit_test::destroy(seeds);
        clock::destroy_for_testing(clock);
    }

    #[test]
    fun settlement_fractional_entitlements_match_in_all_six_orders() {
        sf_fractional_order(vector[0, 1, 2]);
        sf_fractional_order(vector[0, 2, 1]);
        sf_fractional_order(vector[1, 0, 2]);
        sf_fractional_order(vector[1, 2, 0]);
        sf_fractional_order(vector[2, 0, 1]);
        sf_fractional_order(vector[2, 1, 0]);
    }

    #[test]
    fun settlement_u128_product_handles_maximum_u64_pool_and_points() {
        let mut ctx = tx_context::new_from_hint(@0xA, 102, 0, 0, 0);
        let mut registry = sf_registry(SF_MAX_U64, &mut ctx);
        let mut seed = sf_seed(&mut registry, @0xA, SF_END - ONE_DAY_MS, SF_MAX_U64, &mut ctx);
        let clock = sf_clock(SF_END, &mut ctx);
        claim_reward(&mut registry, &mut seed, &clock, &mut ctx);
        assert_eq!(registry_pool_size(&registry), 0);
        assert_eq!(option::borrow(&registry.settlement).paid_mist, SF_MAX_U64);
        assert_eq!(option::borrow(&registry.settlement).processed_growth_points, SF_MAX_U64);
        sf_conserved(option::borrow(&registry.settlement), 0);
        std::unit_test::destroy(registry);
        std::unit_test::destroy(seed);
        clock::destroy_for_testing(clock);
    }

    #[test]
    fun settlement_zero_eligible_points_preserves_pool_and_marks_processed() {
        let mut ctx = tx_context::new_from_hint(@0xA, 103, 0, 0, 0);
        let mut registry = sf_registry(1_000, &mut ctx);
        let mut seed = sf_seed(&mut registry, @0xA, SF_END - 10 * ONE_DAY_MS, 100, &mut ctx);
        let clock = sf_clock(SF_END, &mut ctx);
        claim_reward(&mut registry, &mut seed, &clock, &mut ctx);
        assert!(seed.reward_processed);
        assert_eq!(seed.growth_points, 0);
        assert_eq!(registry_pool_size(&registry), 1_000);
        assert_eq!(option::borrow(&registry.settlement).eligible_growth_points, 0);
        assert_eq!(option::borrow(&registry.settlement).processed_growth_points, 0);
        assert_eq!(option::borrow(&registry.settlement).processed_seeds, 1);
        sf_conserved(option::borrow(&registry.settlement), 1_000);
        std::unit_test::destroy(registry);
        std::unit_test::destroy(seed);
        clock::destroy_for_testing(clock);
    }

    #[test]
    fun settlement_zero_pool_processes_eligible_seed_without_division_error() {
        let mut ctx = tx_context::new_from_hint(@0xA, 104, 0, 0, 0);
        let mut registry = sf_registry(0, &mut ctx);
        let mut seed = sf_seed(&mut registry, @0xA, SF_END - ONE_DAY_MS, 100, &mut ctx);
        let clock = sf_clock(SF_END, &mut ctx);
        claim_reward(&mut registry, &mut seed, &clock, &mut ctx);
        assert!(seed.reward_processed);
        assert_eq!(seed.growth_points, 0);
        assert_eq!(option::borrow(&registry.settlement).paid_mist, 0);
        assert_eq!(option::borrow(&registry.settlement).processed_growth_points, 100);
        sf_conserved(option::borrow(&registry.settlement), 0);
        std::unit_test::destroy(registry);
        std::unit_test::destroy(seed);
        clock::destroy_for_testing(clock);
    }

    #[test]
    fun settlement_zero_point_seed_is_processed_exactly_once() {
        let mut ctx = tx_context::new_from_hint(@0xA, 105, 0, 0, 0);
        let mut registry = sf_registry(1_000, &mut ctx);
        let mut seed = sf_seed(&mut registry, @0xA, SF_END - ONE_DAY_MS, 0, &mut ctx);
        let clock = sf_clock(SF_END, &mut ctx);
        claim_reward(&mut registry, &mut seed, &clock, &mut ctx);
        assert!(seed.reward_processed);
        assert_eq!(option::borrow(&registry.settlement).processed_seeds, 1);
        assert_eq!(option::borrow(&registry.settlement).paid_mist, 0);
        sf_conserved(option::borrow(&registry.settlement), 1_000);
        std::unit_test::destroy(registry);
        std::unit_test::destroy(seed);
        clock::destroy_for_testing(clock);
    }

    #[test]
    fun settlement_zero_floor_entitlement_does_not_give_last_claimant_remainder() {
        let mut ctx = tx_context::new_from_hint(@0xA, 106, 0, 0, 0);
        let mut registry = sf_registry(1, &mut ctx);
        let mut a = sf_seed(&mut registry, @0xA, SF_END - ONE_DAY_MS, 1, &mut ctx);
        let mut b = sf_seed(&mut registry, @0xA, SF_END - ONE_DAY_MS, 2, &mut ctx);
        let clock = sf_clock(SF_END, &mut ctx);
        claim_reward(&mut registry, &mut a, &clock, &mut ctx);
        claim_reward(&mut registry, &mut b, &clock, &mut ctx);
        assert!(a.reward_processed && b.reward_processed);
        assert_eq!(option::borrow(&registry.settlement).paid_mist, 0);
        assert_eq!(option::borrow(&registry.settlement).processed_growth_points, 3);
        assert_eq!(registry_pool_size(&registry), 1);
        sf_conserved(option::borrow(&registry.settlement), 1);
        std::unit_test::destroy(registry);
        std::unit_test::destroy(a);
        std::unit_test::destroy(b);
        clock::destroy_for_testing(clock);
    }

    #[test]
    fun settlement_eligibility_obeys_ten_day_and_protection_equality_boundaries() {
        let mut ctx = tx_context::new_from_hint(@0xA, 107, 0, 0, 0);
        let mut registry = sf_registry(100, &mut ctx);
        let exact = sf_seed(&mut registry, @0xA, SF_END - 10 * ONE_DAY_MS, 10, &mut ctx);
        let just_under = sf_seed(&mut registry, @0xA, SF_END - 10 * ONE_DAY_MS + 1, 20, &mut ctx);
        let mut protected = sf_seed(&mut registry, @0xA, SF_END - 15 * ONE_DAY_MS, 30, &mut ctx);
        let mut expired = sf_seed(&mut registry, @0xA, SF_END - 15 * ONE_DAY_MS, 40, &mut ctx);
        let mut explicitly_dead = sf_seed(&mut registry, @0xA, SF_END - ONE_DAY_MS, 50, &mut ctx);
        protected.bottomless_can_expiry_ms = SF_END;
        expired.bottomless_can_expiry_ms = SF_END - 1;
        explicitly_dead.state = STATE_DEAD;
        explicitly_dead.bottomless_can_expiry_ms = SF_END + ONE_DAY_MS;
        sync_cutoff_points(&mut registry, &mut protected);
        sync_cutoff_points(&mut registry, &mut expired);
        sync_cutoff_points(&mut registry, &mut explicitly_dead);
        assert_eq!(exact.cutoff_growth_points, 0);
        assert_eq!(just_under.cutoff_growth_points, 20);
        assert_eq!(protected.cutoff_growth_points, 30);
        assert_eq!(expired.cutoff_growth_points, 0);
        assert_eq!(explicitly_dead.cutoff_growth_points, 0);
        assert_eq!(registry.eligible_growth_points, 50);
        std::unit_test::destroy(registry);
        std::unit_test::destroy(exact);
        std::unit_test::destroy(just_under);
        std::unit_test::destroy(protected);
        std::unit_test::destroy(expired);
        std::unit_test::destroy(explicitly_dead);
    }

    #[test]
    fun settlement_water_updates_points_and_cutoff_eligibility_after_timestamp_change() {
        let mut ctx = tx_context::new_from_hint(@0xA, 108, 0, 0, 0);
        let mut registry = sf_registry(0, &mut ctx);
        let mut seed = sf_seed(&mut registry, @0xA, SF_END - 11 * ONE_DAY_MS, 100, &mut ctx);
        let clock = sf_clock(SF_END - 9 * ONE_DAY_MS, &mut ctx);
        assert_eq!(registry.eligible_growth_points, 0);
        water_seed(&mut registry, &mut seed, &clock, &ctx);
        assert_eq!(seed.last_watered_ms, SF_END - 9 * ONE_DAY_MS);
        assert_eq!(seed.growth_points, 112);
        assert_eq!(seed.cutoff_growth_points, 112);
        assert_eq!(registry.eligible_growth_points, 112);
        assert_eq!(registry.total_growth_points, 112);
        std::unit_test::destroy(registry);
        std::unit_test::destroy(seed);
        clock::destroy_for_testing(clock);
    }

    #[test]
    fun settlement_rain_barrel_updates_eligibility_without_changing_points() {
        let mut ctx = tx_context::new_from_hint(@0xA, 109, 0, 0, 0);
        let mut registry = sf_registry(0, &mut ctx);
        let mut seed = sf_seed(&mut registry, @0xA, SF_END - 11 * ONE_DAY_MS, 100, &mut ctx);
        let clock = sf_clock(SF_END - 9 * ONE_DAY_MS, &mut ctx);
        let tool = sf_tool(ITEM_RAIN_BARREL, &mut ctx);
        assert_eq!(registry.eligible_growth_points, 0);
        apply_tool(&mut registry, &mut seed, tool, &clock, &ctx);
        assert_eq!(seed.growth_points, 100);
        assert_eq!(seed.cutoff_growth_points, 100);
        assert_eq!(registry.eligible_growth_points, 100);
        assert_eq!(seed.last_watered_ms, SF_END - 9 * ONE_DAY_MS);
        std::unit_test::destroy(registry);
        std::unit_test::destroy(seed);
        clock::destroy_for_testing(clock);
    }

    #[test]
    fun settlement_drought_shield_covering_exact_cutoff_adds_eligibility() {
        let mut ctx = tx_context::new_from_hint(@0xA, 110, 0, 0, 0);
        let mut registry = sf_registry(0, &mut ctx);
        let mut seed = sf_seed(&mut registry, @0xA, SF_END - 13 * ONE_DAY_MS, 100, &mut ctx);
        let clock = sf_clock(SF_END - 7 * ONE_DAY_MS, &mut ctx);
        let tool = sf_tool(ITEM_DROUGHT_SHIELD, &mut ctx);
        assert_eq!(registry.eligible_growth_points, 0);
        apply_tool(&mut registry, &mut seed, tool, &clock, &ctx);
        assert_eq!(seed.bottomless_can_expiry_ms, SF_END);
        assert_eq!(seed.cutoff_growth_points, 100);
        assert_eq!(registry.eligible_growth_points, 100);
        std::unit_test::destroy(registry);
        std::unit_test::destroy(seed);
        clock::destroy_for_testing(clock);
    }

    #[test]
    fun settlement_replacing_long_protection_with_short_mulch_removes_eligibility() {
        let mut ctx = tx_context::new_from_hint(@0xA, 111, 0, 0, 0);
        let mut registry = sf_registry(0, &mut ctx);
        let mut seed = sf_seed(&mut registry, @0xA, SF_END - 12 * ONE_DAY_MS, 100, &mut ctx);
        seed.bottomless_can_expiry_ms = SF_END + ONE_DAY_MS;
        sync_cutoff_points(&mut registry, &mut seed);
        assert_eq!(registry.eligible_growth_points, 100);
        let clock = sf_clock(SF_END - 4 * ONE_DAY_MS, &mut ctx);
        let tool = sf_tool(ITEM_MULCH, &mut ctx);
        apply_tool(&mut registry, &mut seed, tool, &clock, &ctx);
        assert_eq!(seed.bottomless_can_expiry_ms, SF_END - ONE_DAY_MS);
        assert_eq!(seed.growth_points, 100);
        assert_eq!(seed.cutoff_growth_points, 0);
        assert_eq!(registry.eligible_growth_points, 0);
        std::unit_test::destroy(registry);
        std::unit_test::destroy(seed);
        clock::destroy_for_testing(clock);
    }

    #[test]
    fun settlement_gp_tool_updates_eligible_denominator_exactly_once() {
        let mut ctx = tx_context::new_from_hint(@0xA, 112, 0, 0, 0);
        let mut registry = sf_registry(0, &mut ctx);
        let mut seed = sf_seed(&mut registry, @0xA, SF_END - 2 * ONE_DAY_MS, 100, &mut ctx);
        let clock = sf_clock(SF_END - ONE_DAY_MS, &mut ctx);
        let tool = sf_tool(ITEM_GROWTH_TONIC, &mut ctx);
        apply_tool(&mut registry, &mut seed, tool, &clock, &ctx);
        assert_eq!(seed.growth_points, 120);
        assert_eq!(seed.cutoff_growth_points, 120);
        assert_eq!(registry.eligible_growth_points, 120);
        assert_eq!(registry.total_growth_points, 120);
        std::unit_test::destroy(registry);
        std::unit_test::destroy(seed);
        clock::destroy_for_testing(clock);
    }

    #[test]
    fun settlement_water_detected_death_clears_live_points_before_cutoff() {
        let mut ctx = tx_context::new_from_hint(@0xA, 113, 0, 0, 0);
        let mut registry = sf_registry(0, &mut ctx);
        let mut seed = sf_seed(&mut registry, @0xA, SF_END - 12 * ONE_DAY_MS, 100, &mut ctx);
        let clock = sf_clock(SF_END - 2 * ONE_DAY_MS, &mut ctx);
        water_seed(&mut registry, &mut seed, &clock, &ctx);
        assert_eq!(seed.state, STATE_DEAD);
        assert_eq!(seed.growth_points, 0);
        assert_eq!(seed.cutoff_growth_points, 0);
        assert_eq!(registry.eligible_growth_points, 0);
        assert_eq!(registry.total_growth_points, 0);
        assert!(!seed.reward_processed);
        std::unit_test::destroy(registry);
        std::unit_test::destroy(seed);
        clock::destroy_for_testing(clock);
    }

    #[test]
    fun settlement_revival_tool_does_not_restore_predeath_points() {
        let mut ctx = tx_context::new_from_hint(@0xA, 114, 0, 0, 0);
        let mut registry = sf_registry(0, &mut ctx);
        let mut seed = sf_seed(&mut registry, @0xA, SF_END - 12 * ONE_DAY_MS, 100, &mut ctx);
        let clock = sf_clock(SF_END - ONE_DAY_MS, &mut ctx);
        let revival = sf_tool(ITEM_REVIVAL_KIT, &mut ctx);
        revive_seed_with_tool(&mut registry, &mut seed, revival, &clock, &ctx);
        assert_eq!(seed.state, STATE_ALIVE);
        assert_eq!(seed.growth_points, 0);
        assert_eq!(seed.cutoff_growth_points, 0);
        assert_eq!(registry.total_growth_points, 0);
        let tonic = sf_tool(ITEM_GROWTH_TONIC, &mut ctx);
        apply_tool(&mut registry, &mut seed, tonic, &clock, &ctx);
        assert_eq!(seed.growth_points, 20);
        assert_eq!(seed.cutoff_growth_points, 20);
        assert_eq!(registry.eligible_growth_points, 20);
        assert_eq!(registry.total_growth_points, 20);
        std::unit_test::destroy(registry);
        std::unit_test::destroy(seed);
        clock::destroy_for_testing(clock);
    }

    #[test]
    fun settlement_stored_revival_charge_tracks_only_new_water_points() {
        let mut ctx = tx_context::new_from_hint(@0xA, 115, 0, 0, 0);
        let mut registry = sf_registry(0, &mut ctx);
        let mut seed = sf_seed(&mut registry, @0xA, SF_END - 12 * ONE_DAY_MS, 100, &mut ctx);
        seed.revival_charges = 1;
        let mut clock = sf_clock(SF_END - 2 * ONE_DAY_MS, &mut ctx);
        water_seed(&mut registry, &mut seed, &clock, &ctx);
        assert_eq!(seed.state, STATE_DEAD);
        revive_seed(&mut registry, &mut seed, &clock, &ctx);
        assert_eq!(seed.state, STATE_ALIVE);
        assert_eq!(seed.revival_charges, 0);
        assert_eq!(registry.eligible_growth_points, 0);
        clock::set_for_testing(&mut clock, SF_END - ONE_DAY_MS);
        water_seed(&mut registry, &mut seed, &clock, &ctx);
        assert_eq!(seed.growth_points, 14);
        assert_eq!(seed.cutoff_growth_points, 14);
        assert_eq!(registry.eligible_growth_points, 14);
        assert_eq!(registry.total_growth_points, 14);
        std::unit_test::destroy(registry);
        std::unit_test::destroy(seed);
        clock::destroy_for_testing(clock);
    }

    #[test]
    fun settlement_abandon_removes_dead_seed_points_and_owner_index() {
        let mut ctx = tx_context::new_from_hint(@0xA, 116, 0, 0, 0);
        let mut registry = sf_registry(0, &mut ctx);
        let seed = sf_seed(&mut registry, @0xA, SF_END - 12 * ONE_DAY_MS, 100, &mut ctx);
        let sapling_id = seed.sapling_id;
        let season_id = registry.current_season_id;
        table::add(&mut registry.planted_saplings, sapling_id, season_id);
        let clock = sf_clock(SF_END - ONE_DAY_MS, &mut ctx);
        abandon_seed(&mut registry, seed, &clock, &ctx);
        assert_eq!(registry.eligible_growth_points, 0);
        assert_eq!(registry.total_growth_points, 0);
        assert_eq!(registry.total_seeds, 0);
        assert!(vector::is_empty(table::borrow(&registry.seeds_by_owner, @0xA)));
        assert!(!table::contains(&registry.planted_saplings, sapling_id));
        std::unit_test::destroy(registry);
        clock::destroy_for_testing(clock);
    }

    #[test]
    fun settlement_both_planting_paths_bind_seed_and_count_cutoff_points() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut registry = sf_registry(0, scenario.ctx());
        let clock = sf_clock(SF_END - ONE_DAY_MS, scenario.ctx());
        let sapling = sf_sapling(scenario.ctx());
        let sapling_id = object::id(&sapling);
        let external_nft = sf_sapling(scenario.ctx());
        let payment_one = coin::mint_for_testing<SUI>(GROWTH_DEPOSIT_MIST, scenario.ctx());
        let payment_two = coin::mint_for_testing<SUI>(GROWTH_DEPOSIT_MIST, scenario.ctx());
        plant_seed(&mut registry, sapling, payment_one, option::none(), &clock, scenario.ctx());
        plant_seed_with_nftree(&mut registry, &external_nft, payment_two, option::none(), &clock, scenario.ctx());
        assert_eq!(registry.eligible_growth_points, 20);
        assert_eq!(registry.total_growth_points, 20);
        assert_eq!(registry.total_seeds, 2);
        assert_eq!(registry_pool_size(&registry), 14_000_000);
        let ids = *table::borrow(&registry.seeds_by_owner, @0xA);
        assert_eq!(vector::length(&ids), 2);
        scenario.next_tx(@0xA);
        let first = scenario.take_from_sender_by_id<Seed>(ids[0]);
        let second = scenario.take_from_sender_by_id<Seed>(ids[1]);
        assert_eq!(first.registry_id, object::id(&registry));
        assert_eq!(second.registry_id, object::id(&registry));
        assert_eq!(first.version, VERSION);
        assert_eq!(second.version, VERSION);
        assert_eq!(first.cutoff_growth_points, BASE_WATER_POINTS);
        assert_eq!(second.cutoff_growth_points, BASE_WATER_POINTS);
        assert!(!first.reward_processed && !second.reward_processed);
        assert_eq!(first.season_id, registry.current_season_id);
        assert_eq!(second.season_id, registry.current_season_id);
        std::unit_test::destroy(scenario.take_from_sender_by_id<Sapling>(sapling_id));
        std::unit_test::destroy(first);
        std::unit_test::destroy(second);
        std::unit_test::destroy(external_nft);
        std::unit_test::destroy(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    fun settlement_partial_direct_then_real_archive_preserves_original_denominator() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut registry = sf_registry(1_001, scenario.ctx());
        let mut a = sf_seed(&mut registry, @0xA, SF_END - ONE_DAY_MS, 40, scenario.ctx());
        let mut b = sf_seed(&mut registry, @0xA, SF_END - ONE_DAY_MS, 60, scenario.ctx());
        let mut clock = sf_clock(SF_END, scenario.ctx());
        let cap = test_admin_cap_for(&registry, scenario.ctx());
        claim_reward(&mut registry, &mut a, &clock, scenario.ctx());
        assert_eq!(registry_pool_size(&registry), 601);
        assert_eq!(option::borrow(&registry.settlement).pool_mist, 1_001);
        assert_eq!(option::borrow(&registry.settlement).eligible_growth_points, 100);
        assert_eq!(option::borrow(&registry.settlement).processed_growth_points, 40);
        assert_eq!(option::borrow(&registry.settlement).paid_mist, 400);
        clock::set_for_testing(&mut clock, SF_END + REVIEW_WINDOW_MS);
        reset_season(&cap, &mut registry, &clock, scenario.ctx());
        assert!(option::is_none(&registry.settlement));
        assert_eq!(registry.season_start_ms, 0);
        assert_eq!(registry.eligible_growth_points, 0);
        assert_eq!(registry_pool_size(&registry), 0);
        scenario.next_tx(@0xA);
        let first_payment = scenario.take_from_sender<Coin<SUI>>();
        assert_eq!(coin::value(&first_payment), 400);
        std::unit_test::destroy(first_payment);
        let mut archive = scenario.take_shared<SeasonArchive>();
        assert_eq!(archive.settlement.pool_mist, 1_001);
        assert_eq!(archive.settlement.eligible_growth_points, 100);
        assert_eq!(archive.settlement.processed_growth_points, 40);
        assert_eq!(archive.settlement.processed_seeds, 1);
        assert_eq!(archive.claim_deadline_ms, SF_END + CLAIM_GRACE_MS);
        assert_eq!(archive.settlement.claim_deadline_ms, SF_END + CLAIM_GRACE_MS);
        assert_eq!(archive_pool_size(&archive), 601);
        claim_archived_reward(&mut archive, &mut b, &clock, scenario.ctx());
        assert_eq!(archive_pool_size(&archive), 1);
        assert_eq!(archive.settlement.paid_mist, 1_000);
        assert_eq!(archive.settlement.processed_growth_points, 100);
        assert_eq!(archive.settlement.processed_seeds, 2);
        sf_conserved(&archive.settlement, 1);
        test_scenario::return_shared(archive);
        scenario.next_tx(@0xA);
        let second_payment = scenario.take_from_sender<Coin<SUI>>();
        assert_eq!(coin::value(&second_payment), 600);
        std::unit_test::destroy(second_payment);
        std::unit_test::destroy(scenario.take_shared<SeasonArchive>());
        std::unit_test::destroy(a);
        std::unit_test::destroy(b);
        std::unit_test::destroy(registry);
        std::unit_test::destroy(cap);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    fun settlement_finalization_at_cutoff_is_idempotent_and_keeps_frozen_values() {
        let mut ctx = tx_context::new_from_hint(@0xA, 117, 0, 0, 0);
        let mut registry = sf_registry(1_000, &mut ctx);
        let seed = sf_seed(&mut registry, @0xA, SF_END - ONE_DAY_MS, 100, &mut ctx);
        let mut clock = sf_clock(SF_END, &mut ctx);
        finalize_reward_settlement(&mut registry, &clock);
        assert_eq!(option::borrow(&registry.settlement).pool_mist, 1_000);
        assert_eq!(option::borrow(&registry.settlement).eligible_growth_points, 100);
        assert_eq!(option::borrow(&registry.settlement).season_end_ms, SF_END);
        assert_eq!(option::borrow(&registry.settlement).claim_deadline_ms, SF_END + CLAIM_GRACE_MS);
        clock::set_for_testing(&mut clock, SF_END + ONE_DAY_MS);
        finalize_reward_settlement(&mut registry, &clock);
        assert_eq!(option::borrow(&registry.settlement).pool_mist, 1_000);
        assert_eq!(option::borrow(&registry.settlement).eligible_growth_points, 100);
        assert_eq!(option::borrow(&registry.settlement).claim_deadline_ms, SF_END + CLAIM_GRACE_MS);
        assert_eq!(option::borrow(&registry.settlement).processed_seeds, 0);
        std::unit_test::destroy(registry);
        std::unit_test::destroy(seed);
        clock::destroy_for_testing(clock);
    }

    #[test]
    fun settlement_pause_does_not_block_direct_or_archived_entitlements() {
        let mut ctx = tx_context::new_from_hint(@0xA, 118, 0, 0, 0);
        let mut direct = sf_registry(1_000, &mut ctx);
        let mut archived = sf_registry(1_000, &mut ctx);
        let mut a = sf_seed(&mut direct, @0xA, SF_END - ONE_DAY_MS, 100, &mut ctx);
        let mut b = sf_seed(&mut archived, @0xA, SF_END - ONE_DAY_MS, 100, &mut ctx);
        direct.paused = true;
        archived.paused = true;
        let clock = sf_clock(SF_END, &mut ctx);
        let mut archive = sf_archive(&mut archived, &clock, &mut ctx);
        claim_reward(&mut direct, &mut a, &clock, &mut ctx);
        claim_archived_reward(&mut archive, &mut b, &clock, &mut ctx);
        assert_eq!(registry_pool_size(&direct), 0);
        assert_eq!(archive_pool_size(&archive), 0);
        assert!(a.reward_processed && b.reward_processed);
        std::unit_test::destroy(direct);
        std::unit_test::destroy(archived);
        std::unit_test::destroy(archive);
        std::unit_test::destroy(a);
        std::unit_test::destroy(b);
        clock::destroy_for_testing(clock);
    }

    #[test]
    fun settlement_claim_deadline_is_inclusive_for_both_routes() {
        let mut ctx = tx_context::new_from_hint(@0xA, 119, 0, 0, 0);
        let mut direct = sf_registry(1_000, &mut ctx);
        let mut archived = sf_registry(1_000, &mut ctx);
        let mut a = sf_seed(&mut direct, @0xA, SF_END - 9 * ONE_DAY_MS, 100, &mut ctx);
        let mut b = sf_seed(&mut archived, @0xA, SF_END - 9 * ONE_DAY_MS, 100, &mut ctx);
        let clock = sf_clock(SF_END + CLAIM_GRACE_MS, &mut ctx);
        let mut archive = sf_archive(&mut archived, &clock, &mut ctx);
        claim_reward(&mut direct, &mut a, &clock, &mut ctx);
        claim_archived_reward(&mut archive, &mut b, &clock, &mut ctx);
        assert_eq!(registry_pool_size(&direct), 0);
        assert_eq!(archive_pool_size(&archive), 0);
        assert_eq!(archive.claim_deadline_ms, clock::timestamp_ms(&clock));
        std::unit_test::destroy(direct);
        std::unit_test::destroy(archived);
        std::unit_test::destroy(archive);
        std::unit_test::destroy(a);
        std::unit_test::destroy(b);
        clock::destroy_for_testing(clock);
    }

    #[test]
    fun settlement_late_archive_keeps_original_deadline_and_sweeps_only_residual() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut registry = sf_registry(1_001, scenario.ctx());
        let mut a = sf_seed(&mut registry, @0xA, SF_END - ONE_DAY_MS, 40, scenario.ctx());
        let b = sf_seed(&mut registry, @0xA, SF_END - ONE_DAY_MS, 60, scenario.ctx());
        let mut clock = sf_clock(SF_END, scenario.ctx());
        let cap = test_admin_cap_for(&registry, scenario.ctx());
        claim_reward(&mut registry, &mut a, &clock, scenario.ctx());
        clock::set_for_testing(&mut clock, SF_END + CLAIM_GRACE_MS + ONE_DAY_MS);
        reset_season(&cap, &mut registry, &clock, scenario.ctx());
        scenario.next_tx(@0xA);
        let first_payment = scenario.take_from_sender<Coin<SUI>>();
        assert_eq!(coin::value(&first_payment), 400);
        std::unit_test::destroy(first_payment);
        let mut archive = scenario.take_shared<SeasonArchive>();
        assert_eq!(archive.claim_deadline_ms, SF_END + CLAIM_GRACE_MS);
        assert_eq!(archive.settlement.claim_deadline_ms, SF_END + CLAIM_GRACE_MS);
        assert!(archive.finalized_at_ms > archive.claim_deadline_ms);
        assert_eq!(archive_pool_size(&archive), 601);
        assert_eq!(archive.settlement.paid_mist, 400);
        sweep_archived_rewards(&cap, &mut archive, &clock, scenario.ctx());
        assert!(archive.swept);
        assert_eq!(archive_pool_size(&archive), 0);
        assert_eq!(archive.settlement.paid_mist, 400);
        test_scenario::return_shared(archive);
        scenario.next_tx(TREASURY_WALLET);
        let residual = scenario.take_from_sender<Coin<SUI>>();
        assert_eq!(coin::value(&residual), 601);
        assert_eq!(400 + coin::value(&residual), 1_001);
        std::unit_test::destroy(residual);
        std::unit_test::destroy(scenario.take_shared<SeasonArchive>());
        std::unit_test::destroy(registry);
        std::unit_test::destroy(a);
        std::unit_test::destroy(b);
        std::unit_test::destroy(cap);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test_only]
    fun sf_direct_guard(mode: u8) {
        let mut ctx = tx_context::new_from_hint(@0xA, 120, 0, 0, 0);
        let mut registry = sf_registry(1_000, &mut ctx);
        let points = if (mode == 7) 0 else 100;
        let last_watered = if (mode == 8) SF_END - 11 * ONE_DAY_MS else SF_END - ONE_DAY_MS;
        let mut seed = sf_seed(&mut registry, @0xA, last_watered, points, &mut ctx);
        let at = if (mode == 5) SF_END + CLAIM_GRACE_MS + 1
            else if (mode == 9) SF_END - 1 else SF_END;
        let clock = sf_clock(at, &mut ctx);
        if (mode == 0) seed.owner = @0xB;
        if (mode == 1) seed.season_id = seed.season_id + 1;
        if (mode == 2) seed.registry_id = object::id_from_address(@0xBAD);
        if (mode == 3) registry.version = VERSION + 1;
        if (mode == 4) seed.version = VERSION + 1;
        if (mode == 10) seed.cutoff_growth_points = seed.cutoff_growth_points - 1;
        if (mode == 6 || mode == 7 || mode == 8) {
            claim_reward(&mut registry, &mut seed, &clock, &mut ctx);
            assert!(seed.reward_processed);
            assert_eq!(option::borrow(&registry.settlement).processed_seeds, 1);
            let paid = if (mode == 6) 1_000 else 0;
            assert_eq!(option::borrow(&registry.settlement).paid_mist, paid);
        };
        claim_reward(&mut registry, &mut seed, &clock, &mut ctx);
        abort 0xC0FFEE
    }

    #[test, expected_failure(abort_code = E_SEED_NOT_FOUND)]
    fun settlement_direct_rejects_wrong_owner() { sf_direct_guard(0); }

    #[test, expected_failure(abort_code = E_WRONG_SEASON)]
    fun settlement_direct_rejects_wrong_season() { sf_direct_guard(1); }

    #[test, expected_failure(abort_code = E_WRONG_REGISTRY)]
    fun settlement_direct_rejects_seed_from_other_registry() { sf_direct_guard(2); }

    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun settlement_direct_rejects_wrong_registry_version() { sf_direct_guard(3); }

    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun settlement_direct_rejects_wrong_seed_version() { sf_direct_guard(4); }

    #[test, expected_failure(abort_code = E_ARCHIVE_CLAIM_ENDED)]
    fun settlement_direct_rejects_one_millisecond_after_deadline() { sf_direct_guard(5); }

    #[test, expected_failure(abort_code = E_REWARD_PROCESSED)]
    fun settlement_direct_rejects_paid_claim_replay() { sf_direct_guard(6); }

    #[test, expected_failure(abort_code = E_REWARD_PROCESSED)]
    fun settlement_direct_rejects_zero_point_claim_replay() { sf_direct_guard(7); }

    #[test, expected_failure(abort_code = E_REWARD_PROCESSED)]
    fun settlement_direct_rejects_ineligible_claim_replay() { sf_direct_guard(8); }

    #[test, expected_failure(abort_code = E_SEASON_ACTIVE)]
    fun settlement_direct_rejects_one_millisecond_before_cutoff() { sf_direct_guard(9); }

    #[test, expected_failure(abort_code = E_SETTLEMENT_INVARIANT)]
    fun settlement_direct_rejects_inconsistent_seed_cutoff_counter() { sf_direct_guard(10); }

    #[test_only]
    fun sf_archive_guard(mode: u8) {
        let mut ctx = tx_context::new_from_hint(@0xA, 121, 0, 0, 0);
        let mut registry = sf_registry(1_000, &mut ctx);
        let mut seed = sf_seed(&mut registry, @0xA, SF_END - ONE_DAY_MS, 100, &mut ctx);
        let mut clock = sf_clock(SF_END, &mut ctx);
        if (mode == 7) {
            claim_reward(&mut registry, &mut seed, &clock, &mut ctx);
            assert_eq!(registry_pool_size(&registry), 0);
            assert!(seed.reward_processed);
        };
        let mut archive = sf_archive(&mut registry, &clock, &mut ctx);
        if (mode == 0) seed.owner = @0xB;
        if (mode == 1) seed.season_id = seed.season_id + 1;
        if (mode == 2) seed.registry_id = object::id_from_address(@0xBAD);
        if (mode == 3) archive.version = VERSION + 1;
        if (mode == 4) seed.version = VERSION + 1;
        if (mode == 5) clock::set_for_testing(&mut clock, SF_END + CLAIM_GRACE_MS + 1);
        if (mode == 6) {
            claim_archived_reward(&mut archive, &mut seed, &clock, &mut ctx);
            assert!(seed.reward_processed);
            assert_eq!(archive.settlement.paid_mist, 1_000);
            assert_eq!(archive.settlement.processed_seeds, 1);
        };
        if (mode == 8) archive.swept = true;
        if (mode == 9) {
            // A balance mismatch must fail before a second entitlement can pay.
            balance::join(&mut archive.reward_pool, balance::create_for_testing<SUI>(1));
        };
        claim_archived_reward(&mut archive, &mut seed, &clock, &mut ctx);
        abort 0xC0FFEE
    }

    #[test, expected_failure(abort_code = E_SEED_NOT_FOUND)]
    fun settlement_archive_rejects_wrong_owner() { sf_archive_guard(0); }

    #[test, expected_failure(abort_code = E_WRONG_SEASON)]
    fun settlement_archive_rejects_wrong_season() { sf_archive_guard(1); }

    #[test, expected_failure(abort_code = E_WRONG_REGISTRY)]
    fun settlement_archive_rejects_seed_from_other_registry() { sf_archive_guard(2); }

    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun settlement_archive_rejects_wrong_archive_version() { sf_archive_guard(3); }

    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun settlement_archive_rejects_wrong_seed_version() { sf_archive_guard(4); }

    #[test, expected_failure(abort_code = E_ARCHIVE_CLAIM_ENDED)]
    fun settlement_archive_rejects_one_millisecond_after_deadline() { sf_archive_guard(5); }

    #[test, expected_failure(abort_code = E_REWARD_PROCESSED)]
    fun settlement_archive_rejects_archived_claim_replay() { sf_archive_guard(6); }

    #[test, expected_failure(abort_code = E_REWARD_PROCESSED)]
    fun settlement_archive_rejects_previously_paid_direct_claim() { sf_archive_guard(7); }

    #[test, expected_failure(abort_code = E_ARCHIVE_SWEPT)]
    fun settlement_archive_rejects_claim_after_sweep() { sf_archive_guard(8); }

    #[test, expected_failure(abort_code = E_SETTLEMENT_INVARIANT)]
    fun settlement_archive_rejects_balance_accounting_mismatch() { sf_archive_guard(9); }

    #[test_only]
    fun sf_funding_guard(mode: u8) {
        let mut ctx = tx_context::new_from_hint(@0xA, 122, 0, 0, 0);
        let mut registry = sf_registry(1_000, &mut ctx);
        let cap = test_admin_cap_for(&registry, &mut ctx);
        let at = if (mode == 7 || mode == 8) SF_END - ONE_DAY_MS
            else if (mode == 10) SF_START - 1 else SF_END;
        let clock = sf_clock(at, &mut ctx);
        if (mode == 5) registry.season_start_ms = 0;
        if (mode == 6) {
            finalize_reward_settlement(&mut registry, &clock);
            assert_eq!(option::borrow(&registry.settlement).pool_mist, 1_000);
        };
        if (mode == 7 || mode == 8) registry.paused = true;
        let payment = coin::mint_for_testing<SUI>(100_000_000, &mut ctx);
        if (mode == 1 || mode == 8) buy_crate(&mut registry, CRATE_SEEDLING, payment, &clock, &mut ctx)
        else if (mode == 2) buy_boom_chest(&mut registry, payment, &clock, &mut ctx)
        else if (mode == 3) buy_victory_chest(&mut registry, payment, &clock, &mut ctx)
        else if (mode == 4) buy_supply_drop(&mut registry, SUPPLY_DROP_MULCH, payment, &clock, &mut ctx)
        else deposit_to_pool(&cap, &mut registry, payment, &clock, &ctx);
        abort 0xC0FFEE
    }

    #[test, expected_failure(abort_code = E_POOL_FUNDING_CLOSED)]
    fun settlement_deposit_rejects_exact_cutoff() { sf_funding_guard(0); }

    #[test, expected_failure(abort_code = E_POOL_FUNDING_CLOSED)]
    fun settlement_crate_purchase_rejects_exact_cutoff() { sf_funding_guard(1); }

    #[test, expected_failure(abort_code = E_POOL_FUNDING_CLOSED)]
    fun settlement_boom_purchase_rejects_exact_cutoff() { sf_funding_guard(2); }

    #[test, expected_failure(abort_code = E_POOL_FUNDING_CLOSED)]
    fun settlement_victory_purchase_rejects_exact_cutoff() { sf_funding_guard(3); }

    #[test, expected_failure(abort_code = E_POOL_FUNDING_CLOSED)]
    fun settlement_supply_drop_purchase_rejects_exact_cutoff() { sf_funding_guard(4); }

    #[test, expected_failure(abort_code = E_POOL_FUNDING_CLOSED)]
    fun settlement_deposit_rejects_unstarted_season() { sf_funding_guard(5); }

    #[test, expected_failure(abort_code = E_POOL_FUNDING_CLOSED)]
    fun settlement_deposit_cannot_change_already_finalized_pool() { sf_funding_guard(6); }

    #[test, expected_failure(abort_code = E_PAUSED)]
    fun settlement_deposit_rejects_gameplay_pause() { sf_funding_guard(7); }

    #[test, expected_failure(abort_code = E_PAUSED)]
    fun settlement_shop_rejects_gameplay_pause() { sf_funding_guard(8); }

    #[test, expected_failure(abort_code = E_POOL_FUNDING_CLOSED)]
    fun settlement_deposit_rejects_clock_before_season_start() { sf_funding_guard(10); }

    #[test_only]
    fun sf_care_guard(mode: u8) {
        let mut ctx = tx_context::new_from_hint(@0xA, 123, 0, 0, 0);
        let mut registry = sf_registry(0, &mut ctx);
        let mut seed = sf_seed(&mut registry, @0xA, SF_END - 2 * ONE_DAY_MS, 100, &mut ctx);
        let at = if (mode == 0) SF_END - ONE_DAY_MS else SF_END;
        let clock = sf_clock(at, &mut ctx);
        if (mode == 0) registry.paused = true;
        if (mode == 2) {
            let tool = sf_tool(ITEM_RAIN_BARREL, &mut ctx);
            apply_tool(&mut registry, &mut seed, tool, &clock, &ctx);
        } else if (mode == 3) {
            revive_seed(&mut registry, &mut seed, &clock, &ctx);
        } else if (mode == 4) {
            abandon_seed(&mut registry, seed, &clock, &ctx);
        } else {
            water_seed(&mut registry, &mut seed, &clock, &ctx);
        };
        abort 0xC0FFEE
    }

    #[test, expected_failure(abort_code = E_PAUSED)]
    fun settlement_pause_still_blocks_gameplay_water() { sf_care_guard(0); }

    #[test, expected_failure(abort_code = E_SEASON_ENDED)]
    fun settlement_water_rejects_exact_cutoff() { sf_care_guard(1); }

    #[test, expected_failure(abort_code = E_SEASON_ENDED)]
    fun settlement_tool_cannot_change_cutoff_history_after_end() { sf_care_guard(2); }

    #[test, expected_failure(abort_code = E_SEASON_ENDED)]
    fun settlement_revival_cannot_change_cutoff_history_after_end() { sf_care_guard(3); }

    #[test, expected_failure(abort_code = E_SEASON_ENDED)]
    fun settlement_abandon_cannot_destroy_entitlement_after_end() { sf_care_guard(4); }

    #[test, expected_failure(abort_code = E_SEASON_ACTIVE)]
    fun settlement_permissionless_finalization_rejects_early_cutoff() {
        let mut ctx = tx_context::new_from_hint(@0xA, 124, 0, 0, 0);
        let mut registry = sf_registry(1_000, &mut ctx);
        let clock = sf_clock(SF_END - 1, &mut ctx);
        finalize_reward_settlement(&mut registry, &clock);
        abort 0xC0FFEE
    }

    #[test, expected_failure(abort_code = E_SEASON_ACTIVE)]
    fun settlement_admin_archive_now_cannot_shorten_season() {
        let mut ctx = tx_context::new_from_hint(@0xA, 125, 0, 0, 0);
        let mut registry = sf_registry(1_000, &mut ctx);
        let cap = test_admin_cap_for(&registry, &mut ctx);
        let clock = sf_clock(SF_END - 1, &mut ctx);
        finalize_season_archive_now(&cap, &mut registry, &clock, &mut ctx);
        abort 0xC0FFEE
    }

    #[test, expected_failure(abort_code = E_CLAIM_WINDOW_ACTIVE)]
    fun settlement_regular_reset_retains_twenty_four_hour_review_window() {
        let mut ctx = tx_context::new_from_hint(@0xA, 126, 0, 0, 0);
        let mut registry = sf_registry(1_000, &mut ctx);
        let cap = test_admin_cap_for(&registry, &mut ctx);
        let clock = sf_clock(SF_END + REVIEW_WINDOW_MS - 1, &mut ctx);
        reset_season(&cap, &mut registry, &clock, &mut ctx);
        abort 0xC0FFEE
    }

    #[test_only]
    fun sf_sweep_guard(mode: u8) {
        let mut ctx = tx_context::new_from_hint(@0xA, 127, 0, 0, 0);
        let mut registry = sf_registry(1_000, &mut ctx);
        let mut cap = test_admin_cap_for(&registry, &mut ctx);
        let mut clock = sf_clock(SF_END, &mut ctx);
        let mut archive = sf_archive(&mut registry, &clock, &mut ctx);
        let at = if (mode == 0) SF_END + CLAIM_GRACE_MS else SF_END + CLAIM_GRACE_MS + 1;
        clock::set_for_testing(&mut clock, at);
        if (mode == 1) {
            sweep_archived_rewards(&cap, &mut archive, &clock, &mut ctx);
            assert!(archive.swept);
            assert_eq!(archive_pool_size(&archive), 0);
        };
        if (mode == 2) cap.version = VERSION + 1;
        if (mode == 3) archive.registry_id = object::id_from_address(@0xBAD);
        if (mode == 4) archive.version = VERSION + 1;
        sweep_archived_rewards(&cap, &mut archive, &clock, &mut ctx);
        abort 0xC0FFEE
    }

    #[test, expected_failure(abort_code = E_CLAIM_WINDOW_ACTIVE)]
    fun settlement_sweep_rejects_inclusive_claim_deadline() { sf_sweep_guard(0); }

    #[test, expected_failure(abort_code = E_ARCHIVE_SWEPT)]
    fun settlement_sweep_rejects_repeat_transfer() { sf_sweep_guard(1); }

    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun settlement_sweep_rejects_wrong_admin_cap_version() { sf_sweep_guard(2); }

    #[test, expected_failure(abort_code = E_WRONG_REGISTRY)]
    fun settlement_sweep_rejects_admin_cap_from_other_registry() { sf_sweep_guard(3); }

    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun settlement_sweep_rejects_wrong_archive_version() { sf_sweep_guard(4); }

    #[test]
    fun settlement_active_deposit_and_shops_fund_pool_before_cutoff() {
        let mut ctx = tx_context::new_from_hint(@0xA, 128, 0, 0, 0);
        let mut registry = sf_registry(0, &mut ctx);
        let cap = test_admin_cap_for(&registry, &mut ctx);
        let clock = sf_clock(SF_END - 1, &mut ctx);
        let deposit = coin::mint_for_testing<SUI>(1_000, &mut ctx);
        deposit_to_pool(&cap, &mut registry, deposit, &clock, &ctx);
        assert_eq!(registry_pool_size(&registry), 1_000);
        let crate_payment = coin::mint_for_testing<SUI>(CRATE_PRICE_0, &mut ctx);
        buy_crate(&mut registry, CRATE_SEEDLING, crate_payment, &clock, &mut ctx);
        assert_eq!(registry_pool_size(&registry), 7_001_000);
        let supply_payment = coin::mint_for_testing<SUI>(SUPPLY_PRICE_MULCH, &mut ctx);
        buy_supply_drop(&mut registry, SUPPLY_DROP_MULCH, supply_payment, &clock, &mut ctx);
        assert_eq!(registry_pool_size(&registry), 24_501_000);
        assert!(option::is_none(&registry.settlement));
        std::unit_test::destroy(registry);
        std::unit_test::destroy(cap);
        clock::destroy_for_testing(clock);
    }

    #[test]
    fun settlement_transferred_admin_cap_controls_existing_challenge_book() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut registry = sf_registry(1_000, scenario.ctx());
        let cap = test_admin_cap_for(&registry, scenario.ctx());
        let cap_id = object::id(&cap);
        let clock = sf_clock(SF_START + CANOPY_CHALLENGE_UNLOCK_MS + 1, scenario.ctx());
        create_challenge_book(&cap, &registry, scenario.ctx());
        transfer_admin(cap, @0xB, &mut registry, scenario.ctx());
        assert_eq!(registry.admin, @0xB);
        scenario.next_tx(@0xB);
        let new_admin_cap = scenario.take_from_sender_by_id<AdminCap>(cap_id);
        let mut book = scenario.take_shared<ChallengeBook>();
        assert_eq!(book.admin, @0xA);
        assert_eq!(new_admin_cap.registry_id, object::id(&registry));
        open_canopy_sprint(&new_admin_cap, &mut book, &registry, &clock, scenario.ctx());
        assert_eq!(book.active_challenge_id, 1);
        assert_eq!(registry_pool_size(&registry), 1_000);
        let book_id = object::id(&book);
        test_scenario::return_shared(book);
        scenario.next_tx(@0xB);
        let challenge = scenario.take_shared<CanopyChallenge>();
        assert_eq!(challenge.registry_id, object::id(&registry));
        assert_eq!(challenge.book_id, book_id);
        assert_eq!(challenge.version, VERSION);
        assert_eq!(challenge.entry_count, 0);
        std::unit_test::destroy(challenge);
        std::unit_test::destroy(scenario.take_shared<ChallengeBook>());
        std::unit_test::destroy(new_admin_cap);
        std::unit_test::destroy(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    fun settlement_transferred_admin_cap_sweeps_existing_archive() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut registry = sf_registry(1_000, scenario.ctx());
        let cap = test_admin_cap_for(&registry, scenario.ctx());
        let cap_id = object::id(&cap);
        let clock = sf_clock(SF_END + CLAIM_GRACE_MS + 1, scenario.ctx());
        finalize_season_archive_now(&cap, &mut registry, &clock, scenario.ctx());
        transfer_admin(cap, @0xB, &mut registry, scenario.ctx());
        assert_eq!(registry.admin, @0xB);
        scenario.next_tx(@0xB);
        let new_admin_cap = scenario.take_from_sender_by_id<AdminCap>(cap_id);
        let mut archive = scenario.take_shared<SeasonArchive>();
        assert_eq!(archive.admin, @0xA);
        assert_eq!(archive.registry_id, new_admin_cap.registry_id);
        sweep_archived_rewards(&new_admin_cap, &mut archive, &clock, scenario.ctx());
        assert!(archive.swept);
        assert_eq!(archive_pool_size(&archive), 0);
        test_scenario::return_shared(archive);
        scenario.next_tx(TREASURY_WALLET);
        let swept = scenario.take_from_sender<Coin<SUI>>();
        assert_eq!(coin::value(&swept), 1_000);
        std::unit_test::destroy(swept);
        std::unit_test::destroy(scenario.take_shared<SeasonArchive>());
        std::unit_test::destroy(new_admin_cap);
        std::unit_test::destroy(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }
