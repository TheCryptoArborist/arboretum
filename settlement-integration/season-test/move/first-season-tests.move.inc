    // Appended only to a generated test copy of the exact deployed source.
    // No test artifact, clock, payment, or inventory object exists on-chain.
    use std::unit_test::assert_eq;
    use sui::test_scenario;

    #[test_only]
    const ST_NOW: u64 = 3_499_200_000; // 40.5 days; safe for duration backdating.

    #[test_only]
    fun st_empty_registry(ctx: &mut TxContext): Registry {
        let mut registry = test_registry(@0xA, 0, ctx);
        registry.current_season_id = 0;
        let initial = balance::split(&mut registry.reward_pool, 123_456_789);
        assert_eq!(balance::destroy_for_testing(initial), 123_456_789);
        assert_eq!(registry.current_season_id, 0);
        assert_eq!(registry.season_start_ms, 0);
        assert_eq!(registry_pool_size(&registry), 0);
        assert_eq!(balance::value(&registry.treasury), 0);
        assert_eq!(registry.total_seeds, 0);
        assert_eq!(registry.total_growth_points, 0);
        assert_eq!(registry.eligible_growth_points, 0);
        assert!(option::is_none(&registry.settlement));
        assert!(!registry.paused);
        registry
    }

    #[test_only]
    fun st_clock(at: u64, ctx: &mut TxContext): Clock {
        let mut clock = clock::create_for_testing(ctx);
        clock::set_for_testing(&mut clock, at);
        clock
    }

    #[test_only]
    fun st_sapling(ctx: &mut TxContext): Sapling {
        Sapling { id: object::new(ctx), version: VERSION,
            name: string::utf8(b"first season fixture"), cycle_count: 0,
            total_sui_harvested: 0 }
    }

    #[test_only]
    fun st_assert_opening(registry: &Registry, actual_start: u64, duration: u64) {
        assert_eq!(registry.current_season_id, 1);
        assert_eq!(registry.season_start_ms, actual_start - (SEASON_DURATION_MS - duration));
        assert_eq!(registry_season_end_ms(registry), actual_start + duration);
        assert_eq!(registry_pool_size(registry), 0);
        assert_eq!(balance::value(&registry.treasury), 0);
        assert_eq!(registry.total_seeds, 0);
        assert_eq!(registry.total_growth_points, 0);
        assert_eq!(registry.eligible_growth_points, 0);
        assert!(option::is_none(&registry.settlement));
        assert!(!registry.paused);
        let events = event::events_by_type<SeasonStarted>();
        assert_eq!(vector::length(&events), 1);
        assert_eq!(events[0].season_id, 1);
        // The event reports actual execution time, not the backdated storage field.
        assert_eq!(events[0].start_ms, actual_start);
    }

    #[test]
    fun season_test_default_start_opens_empty_first_season_for_thirty_days() {
        let mut ctx = tx_context::new_from_hint(@0xA, 800, 0, 0, 0);
        let mut registry = st_empty_registry(&mut ctx);
        let cap = test_admin_cap_for(&registry, &mut ctx);
        let clock = st_clock(ST_NOW, &mut ctx);
        start_season(&cap, &mut registry, &clock, &ctx);
        st_assert_opening(&registry, ST_NOW, SEASON_DURATION_MS);
        std::unit_test::destroy(registry); std::unit_test::destroy(cap);
        clock::destroy_for_testing(clock);
    }

    #[test_only]
    fun st_duration_success(duration: u64) {
        let mut ctx = tx_context::new_from_hint(@0xA, 801, 0, 0, 0);
        let mut registry = st_empty_registry(&mut ctx);
        let cap = test_admin_cap_for(&registry, &mut ctx);
        let clock = st_clock(ST_NOW, &mut ctx);
        start_season_for_duration(&cap, &mut registry, &clock, duration, &ctx);
        st_assert_opening(&registry, ST_NOW, duration);
        std::unit_test::destroy(registry); std::unit_test::destroy(cap);
        clock::destroy_for_testing(clock);
    }

    #[test]
    fun season_test_short_start_uses_exact_twenty_four_hour_cutoff() { st_duration_success(ONE_DAY_MS); }

    #[test]
    fun season_test_duration_accepts_one_millisecond_lower_boundary() { st_duration_success(1); }

    #[test]
    fun season_test_duration_accepts_thirty_day_upper_boundary() { st_duration_success(SEASON_DURATION_MS); }

    #[test_only]
    fun st_start_guard(mode: u8) {
        let sender = if (mode == 0) @0xB else @0xA;
        let mut ctx = tx_context::new_from_hint(sender, 810, 0, 0, 0);
        let mut registry = st_empty_registry(&mut ctx);
        let mut cap = test_admin_cap_for(&registry, &mut ctx);
        let clock = st_clock(if (mode == 7) 0 else ST_NOW, &mut ctx);
        if (mode == 1) cap.registry_id = object::id_from_address(@0xBAD);
        if (mode == 2) cap.version = VERSION + 1;
        if (mode == 3) registry.version = VERSION + 1;
        if (mode == 4) registry.season_start_ms = ST_NOW;
        if (mode == 5) registry.eligible_growth_points = 1;
        if (mode == 6) option::fill(&mut registry.settlement, SettlementState {
            season_id: 0, season_end_ms: ST_NOW, claim_deadline_ms: ST_NOW + CLAIM_GRACE_MS,
            pool_mist: 0, eligible_growth_points: 0, paid_mist: 0,
            processed_growth_points: 0, processed_seeds: 0,
        });
        if (mode == 8) {
            start_season_for_duration(&cap, &mut registry, &clock, ONE_DAY_MS, &ctx);
        };
        start_season(&cap, &mut registry, &clock, &ctx);
        std::unit_test::destroy(registry); std::unit_test::destroy(cap);
        clock::destroy_for_testing(clock);
    }

    #[test, expected_failure(abort_code = E_NOT_ADMIN)]
    fun season_test_start_rejects_wrong_sender() { st_start_guard(0); }
    #[test, expected_failure(abort_code = E_WRONG_REGISTRY)]
    fun season_test_start_rejects_cap_from_other_registry() { st_start_guard(1); }
    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun season_test_start_rejects_wrong_cap_version() { st_start_guard(2); }
    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun season_test_start_rejects_wrong_registry_version() { st_start_guard(3); }
    #[test, expected_failure(abort_code = E_SEASON_ACTIVE)]
    fun season_test_start_rejects_existing_start() { st_start_guard(4); }
    #[test, expected_failure(abort_code = E_SETTLEMENT_INVARIANT)]
    fun season_test_start_rejects_stale_eligible_growth_points() { st_start_guard(5); }
    #[test, expected_failure(abort_code = E_SETTLEMENT_INVARIANT)]
    fun season_test_start_rejects_existing_settlement() { st_start_guard(6); }
    #[test, expected_failure(abort_code = E_INVALID_SEASON_DURATION)]
    fun season_test_start_rejects_zero_clock() { st_start_guard(7); }
    #[test, expected_failure(abort_code = E_SEASON_ACTIVE)]
    fun season_test_start_rejects_replay_after_short_start() { st_start_guard(8); }

    #[test_only]
    fun st_duration_guard(mode: u8) {
        let mut ctx = tx_context::new_from_hint(@0xA, 811, 0, 0, 0);
        let mut registry = st_empty_registry(&mut ctx);
        let cap = test_admin_cap_for(&registry, &mut ctx);
        let now = if (mode == 2) SEASON_DURATION_MS - ONE_DAY_MS else ST_NOW;
        let clock = st_clock(now, &mut ctx);
        let duration = if (mode == 0) 0 else if (mode == 1) SEASON_DURATION_MS + 1 else ONE_DAY_MS;
        start_season_for_duration(&cap, &mut registry, &clock, duration, &ctx);
        std::unit_test::destroy(registry); std::unit_test::destroy(cap);
        clock::destroy_for_testing(clock);
    }

    #[test, expected_failure(abort_code = E_INVALID_SEASON_DURATION)]
    fun season_test_duration_rejects_zero() { st_duration_guard(0); }
    #[test, expected_failure(abort_code = E_INVALID_SEASON_DURATION)]
    fun season_test_duration_rejects_more_than_thirty_days() { st_duration_guard(1); }
    #[test, expected_failure(abort_code = E_INVALID_SEASON_DURATION)]
    fun season_test_duration_rejects_nonpositive_backdated_start() { st_duration_guard(2); }

    #[test]
    fun season_test_first_paid_lifecycle_keeps_archive_claim_after_second_start() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut registry = st_empty_registry(scenario.ctx());
        let cap = test_admin_cap_for(&registry, scenario.ctx());
        let mut clock = st_clock(ST_NOW, scenario.ctx());
        start_season_for_duration(&cap, &mut registry, &clock, ONE_DAY_MS, scenario.ctx());
        st_assert_opening(&registry, ST_NOW, ONE_DAY_MS);
        let sapling = st_sapling(scenario.ctx());
        let sapling_id = object::id(&sapling);
        let external_nft = st_sapling(scenario.ctx());
        let first_payment = coin::mint_for_testing<SUI>(10_000_000, scenario.ctx());
        let second_payment = coin::mint_for_testing<SUI>(10_000_000, scenario.ctx());
        plant_seed(&mut registry, sapling, first_payment, option::none(), &clock, scenario.ctx());
        plant_seed_with_nftree(&mut registry, &external_nft, second_payment, option::none(), &clock, scenario.ctx());
        let ids = *table::borrow(&registry.seeds_by_owner, @0xA);
        assert_eq!(vector::length(&ids), 2);
        assert_eq!(registry_pool_size(&registry), 14_000_000);
        let tool_payment = coin::mint_for_testing<SUI>(20_000_000, scenario.ctx());
        buy_supply_drop(&mut registry, SUPPLY_DROP_WATERING_BOOST, tool_payment, &clock, scenario.ctx());
        let deposit = coin::mint_for_testing<SUI>(13_000_000, scenario.ctx());
        deposit_to_pool(&cap, &mut registry, deposit, &clock, scenario.ctx());
        assert_eq!(registry_pool_size(&registry), 41_000_000);
        assert_eq!(balance::value(&registry.treasury), 0);
        assert_eq!(registry.total_growth_points, 20);
        assert_eq!(registry.eligible_growth_points, 20);

        scenario.next_tx(@0xA);
        let mut first = scenario.take_from_sender_by_id<Seed>(ids[0]);
        let mut second = scenario.take_from_sender_by_id<Seed>(ids[1]);
        let tool = scenario.take_from_sender<Tool>();
        assert_eq!(tool.kind, string::utf8(b"watering_boost"));
        assert_eq!(tool.charges, 1);
        apply_tool(&mut registry, &mut first, tool, &clock, scenario.ctx());
        assert_eq!(first.fertilizer_charges, 1);
        clock::set_for_testing(&mut clock, ST_NOW + ONE_DAY_MS - ONE_DAY_MS / 10);
        water_seed(&mut registry, &mut first, &clock, scenario.ctx());
        assert_eq!(first.growth_points, 31);
        assert_eq!(first.cutoff_growth_points, 31);
        assert_eq!(first.fertilizer_charges, 0);
        assert_eq!(second.growth_points, 10);
        assert_eq!(registry.eligible_growth_points, 41);
        assert_eq!(registry.total_growth_points, 41);

        clock::set_for_testing(&mut clock, ST_NOW + ONE_DAY_MS);
        claim_reward(&mut registry, &mut first, &clock, scenario.ctx());
        assert!(first.reward_processed);
        assert_eq!(registry_pool_size(&registry), 10_000_000);
        assert_eq!(option::borrow(&registry.settlement).pool_mist, 41_000_000);
        assert_eq!(option::borrow(&registry.settlement).eligible_growth_points, 41);
        assert_eq!(option::borrow(&registry.settlement).paid_mist, 31_000_000);
        finalize_season_archive_now(&cap, &mut registry, &clock, scenario.ctx());
        assert_eq!(registry.season_start_ms, 0);
        assert_eq!(registry_pool_size(&registry), 0);
        assert_eq!(registry.total_seeds, 0);
        assert_eq!(registry.total_growth_points, 0);
        assert_eq!(registry.eligible_growth_points, 0);
        assert!(option::is_none(&registry.settlement));
        start_season(&cap, &mut registry, &clock, scenario.ctx());
        assert_eq!(registry.current_season_id, 2);
        assert_eq!(registry.season_start_ms, ST_NOW + ONE_DAY_MS);

        scenario.next_tx(@0xA);
        let direct_payment = scenario.take_from_sender<Coin<SUI>>();
        assert_eq!(coin::value(&direct_payment), 31_000_000);
        std::unit_test::destroy(direct_payment);
        let mut archive = scenario.take_shared<SeasonArchive>();
        assert_eq!(archive.season_id, 1);
        assert_eq!(archive.claim_deadline_ms, ST_NOW + ONE_DAY_MS + CLAIM_GRACE_MS);
        assert_eq!(archive.settlement.pool_mist, 41_000_000);
        assert_eq!(archive.settlement.eligible_growth_points, 41);
        claim_archived_reward(&mut archive, &mut second, &clock, scenario.ctx());
        assert!(second.reward_processed);
        assert_eq!(archive.settlement.paid_mist, 41_000_000);
        assert_eq!(archive_pool_size(&archive), 0);
        assert_eq!(registry_pool_size(&registry), 0);
        test_scenario::return_shared(archive);
        scenario.next_tx(@0xA);
        let archived_payment = scenario.take_from_sender<Coin<SUI>>();
        assert_eq!(coin::value(&archived_payment), 10_000_000);
        std::unit_test::destroy(archived_payment);
        std::unit_test::destroy(scenario.take_from_sender_by_id<Sapling>(sapling_id));
        std::unit_test::destroy(scenario.take_shared<SeasonArchive>());

        scenario.next_tx(TREASURY_WALLET);
        let treasury_a = scenario.take_from_sender<Coin<SUI>>();
        let treasury_b = scenario.take_from_sender<Coin<SUI>>();
        let treasury_c = scenario.take_from_sender<Coin<SUI>>();
        assert_eq!(coin::value(&treasury_a) + coin::value(&treasury_b) + coin::value(&treasury_c), 11_200_000);
        std::unit_test::destroy(treasury_a); std::unit_test::destroy(treasury_b); std::unit_test::destroy(treasury_c);
        scenario.next_tx(DEV_FEE_WALLET);
        let dev_a = scenario.take_from_sender<Coin<SUI>>();
        let dev_b = scenario.take_from_sender<Coin<SUI>>();
        let dev_c = scenario.take_from_sender<Coin<SUI>>();
        assert_eq!(coin::value(&dev_a) + coin::value(&dev_b) + coin::value(&dev_c), 800_000);
        std::unit_test::destroy(dev_a); std::unit_test::destroy(dev_b); std::unit_test::destroy(dev_c);
        std::unit_test::destroy(first); std::unit_test::destroy(second);
        std::unit_test::destroy(external_nft); std::unit_test::destroy(registry);
        std::unit_test::destroy(cap); clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    fun season_test_tool_bought_in_another_registry_is_accepted_current_behavior() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut paid_registry = st_empty_registry(scenario.ctx());
        let mut receiving_registry = st_empty_registry(scenario.ctx());
        let first_cap = test_admin_cap_for(&paid_registry, scenario.ctx());
        let second_cap = test_admin_cap_for(&receiving_registry, scenario.ctx());
        let clock = st_clock(ST_NOW, scenario.ctx());
        start_season_for_duration(&first_cap, &mut paid_registry, &clock, ONE_DAY_MS, scenario.ctx());
        start_season_for_duration(&second_cap, &mut receiving_registry, &clock, ONE_DAY_MS, scenario.ctx());
        assert!(object::id(&paid_registry) != object::id(&receiving_registry));
        let payment = coin::mint_for_testing<SUI>(20_000_000, scenario.ctx());
        buy_supply_drop(&mut paid_registry, SUPPLY_DROP_WATERING_BOOST, payment, &clock, scenario.ctx());
        let sapling = st_sapling(scenario.ctx());
        let sapling_id = object::id(&sapling);
        let payment = coin::mint_for_testing<SUI>(10_000_000, scenario.ctx());
        plant_seed(&mut receiving_registry, sapling, payment, option::none(), &clock, scenario.ctx());
        let seed_id = table::borrow(&receiving_registry.seeds_by_owner, @0xA)[0];
        scenario.next_tx(@0xA);
        let tool = scenario.take_from_sender<Tool>();
        let mut seed = scenario.take_from_sender_by_id<Seed>(seed_id);
        apply_tool(&mut receiving_registry, &mut seed, tool, &clock, scenario.ctx());
        assert_eq!(seed.fertilizer_charges, 1);
        assert_eq!(seed.registry_id, object::id(&receiving_registry));
        assert_eq!(registry_pool_size(&paid_registry), 14_000_000);
        assert_eq!(registry_pool_size(&receiving_registry), 7_000_000);
        std::unit_test::destroy(scenario.take_from_sender_by_id<Sapling>(sapling_id));
        std::unit_test::destroy(seed); std::unit_test::destroy(paid_registry);
        std::unit_test::destroy(receiving_registry); std::unit_test::destroy(first_cap);
        std::unit_test::destroy(second_cap); clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    fun season_test_crate_bought_elsewhere_opens_against_unstarted_registry_current_behavior() {
        let mut scenario = test_scenario::begin(@0x0);
        random::create_for_testing(scenario.ctx());
        scenario.next_tx(@0xA);
        let mut paid_registry = st_empty_registry(scenario.ctx());
        let receiving_registry = st_empty_registry(scenario.ctx());
        let cap = test_admin_cap_for(&paid_registry, scenario.ctx());
        let clock = st_clock(ST_NOW, scenario.ctx());
        start_season_for_duration(&cap, &mut paid_registry, &clock, ONE_DAY_MS, scenario.ctx());
        let payment = coin::mint_for_testing<SUI>(10_000_000, scenario.ctx());
        buy_crate(&mut paid_registry, CRATE_SEEDLING, payment, &clock, scenario.ctx());
        assert_eq!(registry_pool_size(&paid_registry), 7_000_000);
        assert_eq!(receiving_registry.current_season_id, 0);
        assert_eq!(receiving_registry.season_start_ms, 0);
        assert!(object::id(&paid_registry) != object::id(&receiving_registry));
        scenario.next_tx(@0xA);
        let crate_obj = scenario.take_from_sender<Crate>();
        let crate_id = object::id(&crate_obj);
        let rng = scenario.take_shared<Random>();
        open_crate(&receiving_registry, crate_obj, &rng, scenario.ctx());
        let openings = event::events_by_type<CrateOpened>();
        assert_eq!(vector::length(&openings), 1);
        assert_eq!(openings[0].crate_id, crate_id);
        assert_eq!(openings[0].opener, @0xA);
        assert_eq!(registry_pool_size(&receiving_registry), 0);
        test_scenario::return_shared(rng);
        scenario.next_tx(@0xA);
        let tool = scenario.take_from_sender<Tool>();
        assert_eq!(tool.version, VERSION);
        assert_eq!(tool.charges, 2);
        std::unit_test::destroy(tool); std::unit_test::destroy(paid_registry);
        std::unit_test::destroy(receiving_registry); std::unit_test::destroy(cap);
        std::unit_test::destroy(scenario.take_shared<Random>());
        clock::destroy_for_testing(clock); scenario.end();
    }
