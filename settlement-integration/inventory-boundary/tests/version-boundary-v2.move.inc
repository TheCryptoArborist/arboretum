    // Appended only to a generated test copy of the production v2 candidate.
    // Fixture version edits construct old serialized shapes; no migration API
    // is added to the candidate and no test object exists on-chain.
    use std::unit_test::assert_eq;
    use sui::test_scenario;

    #[test_only]
    const BND_NOW: u64 = 3_499_200_000;

    #[test_only]
    fun bnd_clock(at: u64, ctx: &mut TxContext): Clock {
        let mut clock = clock::create_for_testing(ctx);
        clock::set_for_testing(&mut clock, at);
        clock
    }

    #[test_only]
    fun bnd_active_registry(version: u64, ctx: &mut TxContext): Registry {
        let mut registry = test_registry(@0xA, BND_NOW - (SEASON_DURATION_MS - ONE_DAY_MS), ctx);
        registry.version = version;
        let balance = balance::split(&mut registry.reward_pool, 123_456_789);
        assert_eq!(balance::destroy_for_testing(balance), 123_456_789);
        registry
    }

    #[test_only]
    fun bnd_sapling(version: u64, ctx: &mut TxContext): Sapling {
        Sapling { id: object::new(ctx), version,
            name: string::utf8(b"inventory boundary fixture"), cycle_count: 0,
            total_sui_harvested: 0 }
    }

    #[test_only]
    fun bnd_tool(version: u64, kind: vector<u8>, charges: u8, ctx: &mut TxContext): Tool {
        Tool { id: object::new(ctx), version, kind: string::utf8(kind), charges, rarity: 3 }
    }

    #[test_only]
    fun bnd_seed(registry: &mut Registry, version: u64, ctx: &mut TxContext): Seed {
        let seed = Seed {
            id: object::new(ctx), version, registry_id: object::id(registry),
            cutoff_growth_points: 10, reward_processed: false,
            sapling_id: object::id_from_address(@0xB17), season_id: registry.current_season_id,
            owner: @0xA, planted_at_ms: BND_NOW, last_watered_ms: BND_NOW,
            watering_streak: 1, growth_points: 10, state: STATE_ALIVE,
            fertilizer_charges: 0, miracle_grow_applied: false, revival_charges: 0,
            bottomless_can_expiry_ms: 0, permanent_gp_bonus: 0,
        };
        registry.total_seeds = 1;
        registry.total_growth_points = 10;
        registry.eligible_growth_points = 10;
        table::add(&mut registry.seeds_by_owner, @0xA, vector[object::id(&seed)]);
        table::add(&mut registry.player_growth, @0xA, 10);
        table::add(&mut registry.player_growth_season, @0xA, registry.current_season_id);
        seed
    }

    #[test_only]
    fun bnd_dead_seed(registry: &mut Registry, version: u64, ctx: &mut TxContext): Seed {
        let mut seed = bnd_seed(registry, version, ctx);
        seed.state = STATE_DEAD;
        seed.growth_points = 0;
        seed.cutoff_growth_points = 0;
        registry.total_growth_points = 0;
        registry.eligible_growth_points = 0;
        *table::borrow_mut(&mut registry.player_growth, @0xA) = 0;
        seed
    }

    #[test_only]
    fun bnd_archive(registry: &Registry, version: u64, ctx: &mut TxContext): SeasonArchive {
        let end = BND_NOW + ONE_DAY_MS;
        SeasonArchive {
            id: object::new(ctx), version, registry_id: object::id(registry),
            settlement: SettlementState { season_id: 1, season_end_ms: end,
                claim_deadline_ms: end + CLAIM_GRACE_MS, pool_mist: 0,
                eligible_growth_points: 10, paid_mist: 0, processed_growth_points: 0,
                processed_seeds: 0 },
            admin: @0xA, season_id: 1, season_start_ms: registry.season_start_ms,
            season_end_ms: end, finalized_at_ms: end,
            claim_deadline_ms: end + CLAIM_GRACE_MS, total_growth_points: 10,
            total_seeds: 1, reward_pool: balance::zero<SUI>(), swept: false,
        }
    }

    #[test]
    fun bnd_v2_real_factory_creates_empty_bound_registry_and_first_start_succeeds() {
        let mut scenario = test_scenario::begin(@0xA);
        let legacy_cap = arboretum::arboretum::bnd_test_legacy_cap(scenario.ctx());
        let legacy_id = object::id(&legacy_cap);
        create_settlement_registry(&legacy_cap, scenario.ctx());
        let created = event::events_by_type<SettlementRegistryCreated>();
        assert_eq!(vector::length(&created), 1);
        assert_eq!(created[0].admin, @0xA);
        assert_eq!(created[0].legacy_cap_id, legacy_id);
        let registry_id = created[0].registry_id;
        scenario.next_tx(@0xA);
        let mut registry = scenario.take_shared<Registry>();
        let cap = scenario.take_from_sender<AdminCap>();
        assert_eq!(object::id(&registry), registry_id);
        assert_eq!(registry.version, 2);
        assert_eq!(cap.version, 2);
        assert_eq!(cap.registry_id, registry_id);
        assert_eq!(registry.admin, @0xA);
        assert_eq!(registry.current_season_id, 0);
        assert_eq!(registry.season_start_ms, 0);
        assert_eq!(registry_pool_size(&registry), 0);
        assert_eq!(balance::value(&registry.treasury), 0);
        assert_eq!(registry.total_seeds, 0);
        assert_eq!(registry.total_growth_points, 0);
        assert_eq!(registry.eligible_growth_points, 0);
        assert!(option::is_none(&registry.settlement));
        assert!(!registry.paused);
        assert_eq!(table::length(&registry.seeds_by_owner), 0);
        assert_eq!(table::length(&registry.referrers), 0);
        assert_eq!(table::length(&registry.referral_earnings), 0);
        assert_eq!(table::length(&registry.player_growth), 0);
        assert_eq!(table::length(&registry.player_growth_season), 0);
        assert_eq!(table::length(&registry.planted_saplings), 0);
        assert_eq!(vector::length(&event::events_by_type<SeasonStarted>()), 0);
        let clock = bnd_clock(BND_NOW, scenario.ctx());
        start_season_for_duration(&cap, &mut registry, &clock, ONE_DAY_MS, scenario.ctx());
        assert_eq!(registry.current_season_id, 1);
        assert_eq!(registry.season_start_ms, BND_NOW - (SEASON_DURATION_MS - ONE_DAY_MS));
        assert_eq!(registry_season_end_ms(&registry), BND_NOW + ONE_DAY_MS);
        assert_eq!(registry_pool_size(&registry), 0);
        assert_eq!(balance::value(&registry.treasury), 0);
        assert_eq!(object::id(&legacy_cap), legacy_id);
        let started = event::events_by_type<SeasonStarted>();
        assert_eq!(vector::length(&started), 1);
        assert_eq!(started[0].season_id, 1);
        assert_eq!(started[0].start_ms, BND_NOW);
        test_scenario::return_shared(registry);
        std::unit_test::destroy(cap); std::unit_test::destroy(legacy_cap);
        clock::destroy_for_testing(clock); scenario.end();
    }

    #[test]
    fun bnd_v2_native_mint_and_paid_plant_create_current_version_seed() {
        assert_eq!(VERSION, 2);
        let mut scenario = test_scenario::begin(@0xA);
        mint_sapling(b"new production Sapling", scenario.ctx());
        scenario.next_tx(@0xA);
        let sapling = scenario.take_from_sender<Sapling>();
        assert_eq!(sapling.version, 2);
        let sapling_id = object::id(&sapling);
        let mut registry = bnd_active_registry(2, scenario.ctx());
        let clock = bnd_clock(BND_NOW, scenario.ctx());
        let payment = coin::mint_for_testing<SUI>(10_000_000_000, scenario.ctx());
        plant_seed(&mut registry, sapling, payment, option::none(), &clock, scenario.ctx());
        assert_eq!(registry.total_seeds, 1);
        assert_eq!(registry.total_growth_points, 10);
        assert_eq!(registry.eligible_growth_points, 10);
        assert_eq!(registry_pool_size(&registry), 7_000_000_000);
        scenario.next_tx(@0xA);
        let seed = scenario.take_from_sender<Seed>();
        assert_eq!(seed.version, 2);
        assert_eq!(seed.registry_id, object::id(&registry));
        assert_eq!(seed.sapling_id, sapling_id);
        assert_eq!(seed.growth_points, BASE_WATER_POINTS);
        assert_eq!(seed.permanent_gp_bonus, 0);
        assert!(!seed.reward_processed);
        let returned = scenario.take_from_sender_by_id<Sapling>(sapling_id);
        assert_eq!(returned.version, 2);
        assert_eq!(returned.cycle_count, 1);
        std::unit_test::destroy(seed); std::unit_test::destroy(returned);
        std::unit_test::destroy(registry); clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    fun bnd_v2_paid_crate_opens_to_current_version_tool_and_reuses_remaining_charge() {
        let mut scenario = test_scenario::begin(@0x0);
        random::create_for_testing(scenario.ctx());
        scenario.next_tx(@0xA);
        let mut registry = bnd_active_registry(2, scenario.ctx());
        let mut seed = bnd_seed(&mut registry, 2, scenario.ctx());
        let clock = bnd_clock(BND_NOW, scenario.ctx());
        let payment = coin::mint_for_testing<SUI>(5_000_000_000, scenario.ctx());
        buy_crate(&mut registry, CRATE_SEEDLING, payment, &clock, scenario.ctx());
        scenario.next_tx(@0xA);
        let crate_obj = scenario.take_from_sender<Crate>();
        assert_eq!(crate_obj.version, 2);
        let rng = scenario.take_shared<Random>();
        open_crate(&registry, crate_obj, &rng, scenario.ctx());
        test_scenario::return_shared(rng);
        scenario.next_tx(@0xA);
        let tool = scenario.take_from_sender<Tool>();
        let tool_id = object::id(&tool);
        assert_eq!(tool.version, 2);
        assert_eq!(tool.charges, 2);
        apply_tool(&mut registry, &mut seed, tool, &clock, scenario.ctx());
        scenario.next_tx(@0xA);
        let remaining = scenario.take_from_sender_by_id<Tool>(tool_id);
        assert_eq!(remaining.version, 2);
        assert_eq!(remaining.charges, 1);
        assert_eq!(seed.version, 2);
        assert_eq!(registry.eligible_growth_points, seed.cutoff_growth_points);
        std::unit_test::destroy(remaining); std::unit_test::destroy(seed);
        std::unit_test::destroy(registry); std::unit_test::destroy(scenario.take_shared<Random>());
        clock::destroy_for_testing(clock); scenario.end();
    }

    #[test]
    fun bnd_v2_paid_revival_kit_restores_dead_seed_without_importing_points() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut registry = bnd_active_registry(2, scenario.ctx());
        let mut seed = bnd_dead_seed(&mut registry, 2, scenario.ctx());
        let clock = bnd_clock(BND_NOW, scenario.ctx());
        let payment = coin::mint_for_testing<SUI>(15_000_000_000, scenario.ctx());
        buy_supply_drop(&mut registry, SUPPLY_DROP_REVIVAL_KIT, payment, &clock, scenario.ctx());
        scenario.next_tx(@0xA);
        let tool = scenario.take_from_sender<Tool>();
        assert_eq!(tool.version, 2);
        assert_eq!(tool.charges, 1);
        revive_seed_with_tool(&mut registry, &mut seed, tool, &clock, scenario.ctx());
        assert_eq!(seed.state, STATE_ALIVE);
        assert_eq!(seed.version, 2);
        assert_eq!(seed.growth_points, 0);
        assert_eq!(seed.cutoff_growth_points, 0);
        assert_eq!(registry.eligible_growth_points, 0);
        let events = event::events_by_type<SeedRevived>();
        assert_eq!(vector::length(&events), 1);
        std::unit_test::destroy(seed); std::unit_test::destroy(registry);
        clock::destroy_for_testing(clock); scenario.end();
    }

    #[test]
    fun bnd_v2_old_object_nft_reference_requires_full_price_and_creates_only_fresh_base_seed() {
        let mut scenario = test_scenario::begin(@0xA);
        let old_item = bnd_tool(1, b"forest_heart", 99, scenario.ctx());
        let old_id = object::id(&old_item);
        let mut registry = bnd_active_registry(2, scenario.ctx());
        let clock = bnd_clock(BND_NOW, scenario.ctx());
        let payment = coin::mint_for_testing<SUI>(10_000_000_000, scenario.ctx());
        plant_seed_with_nftree(&mut registry, &old_item, payment, option::none(), &clock, scenario.ctx());
        assert_eq!(old_item.version, 1);
        assert_eq!(old_item.charges, 99);
        assert_eq!(registry_pool_size(&registry), 7_000_000_000);
        scenario.next_tx(@0xA);
        let seed = scenario.take_from_sender<Seed>();
        assert_eq!(seed.version, 2);
        assert_eq!(seed.sapling_id, old_id);
        assert_eq!(seed.registry_id, object::id(&registry));
        assert_eq!(seed.growth_points, 10);
        assert_eq!(seed.cutoff_growth_points, 10);
        assert_eq!(seed.permanent_gp_bonus, 0);
        assert_eq!(seed.fertilizer_charges, 0);
        assert_eq!(seed.revival_charges, 0);
        assert_eq!(seed.bottomless_can_expiry_ms, 0);
        assert!(!seed.miracle_grow_applied);
        assert!(!seed.reward_processed);
        std::unit_test::destroy(seed); std::unit_test::destroy(old_item);
        std::unit_test::destroy(registry); clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test, expected_failure(abort_code = E_WRONG_PAYMENT)]
    fun bnd_v2_old_nft_reference_cannot_use_the_cheap_plant_price() {
        let mut ctx = tx_context::new_from_hint(@0xA, 950, 0, 0, 0);
        let old_item = bnd_tool(1, b"forest_heart", 99, &mut ctx);
        let mut registry = bnd_active_registry(2, &mut ctx);
        let clock = bnd_clock(BND_NOW, &mut ctx);
        let payment = coin::mint_for_testing<SUI>(10_000_000, &mut ctx);
        plant_seed_with_nftree(&mut registry, &old_item, payment, option::none(), &clock, &mut ctx);
        std::unit_test::destroy(old_item); std::unit_test::destroy(registry);
        clock::destroy_for_testing(clock);
    }

    #[test_only]
    fun bnd_reject_tool_use(tool_version: u64, seed_version: u64, registry_version: u64, revival: bool) {
        let mut ctx = tx_context::new_from_hint(@0xA, 951, 0, 0, 0);
        let mut registry = bnd_active_registry(registry_version, &mut ctx);
        let mut seed = if (revival) bnd_dead_seed(&mut registry, seed_version, &mut ctx)
            else bnd_seed(&mut registry, seed_version, &mut ctx);
        let kind = if (revival) b"revival_kit" else b"watering_boost";
        let tool = bnd_tool(tool_version, kind, 1, &mut ctx);
        let clock = bnd_clock(BND_NOW, &mut ctx);
        if (revival) revive_seed_with_tool(&mut registry, &mut seed, tool, &clock, &ctx)
        else apply_tool(&mut registry, &mut seed, tool, &clock, &ctx);
        std::unit_test::destroy(seed); std::unit_test::destroy(registry);
        clock::destroy_for_testing(clock);
    }

    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v2_rejects_v1_tool_application() { bnd_reject_tool_use(1, 2, 2, false); }
    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v2_rejects_v1_revival_tool() { bnd_reject_tool_use(1, 2, 2, true); }
    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v2_rejects_v1_seed_for_v2_tool() { bnd_reject_tool_use(2, 1, 2, false); }
    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v2_rejects_v1_registry_for_v2_tool() { bnd_reject_tool_use(2, 2, 1, false); }

    #[test_only]
    fun bnd_reject_crate(crate_version: u64, registry_version: u64) {
        let mut scenario = test_scenario::begin(@0x0);
        random::create_for_testing(scenario.ctx());
        scenario.next_tx(@0xA);
        let registry = bnd_active_registry(registry_version, scenario.ctx());
        let crate_obj = Crate { id: object::new(scenario.ctx()), version: crate_version, tier: CRATE_SEEDLING };
        let rng = scenario.take_shared<Random>();
        open_crate(&registry, crate_obj, &rng, scenario.ctx());
        std::unit_test::destroy(rng); std::unit_test::destroy(registry);
        scenario.end();
    }

    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v2_rejects_v1_crate_before_it_can_mint_v2_tools() { bnd_reject_crate(1, 2); }
    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v2_rejects_v1_registry_for_v2_crate() { bnd_reject_crate(2, 1); }

    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v2_rejects_native_v1_sapling_planting() {
        let mut ctx = tx_context::new_from_hint(@0xA, 952, 0, 0, 0);
        let mut registry = bnd_active_registry(2, &mut ctx);
        let sapling = bnd_sapling(1, &mut ctx);
        let clock = bnd_clock(BND_NOW, &mut ctx);
        let payment = coin::mint_for_testing<SUI>(10_000_000_000, &mut ctx);
        plant_seed(&mut registry, sapling, payment, option::none(), &clock, &mut ctx);
        std::unit_test::destroy(registry); clock::destroy_for_testing(clock);
    }

    #[test_only]
    fun bnd_reject_seed_action(mode: u8) {
        let mut ctx = tx_context::new_from_hint(@0xA, 953, 0, 0, 0);
        let mut registry = bnd_active_registry(2, &mut ctx);
        let mut seed = bnd_seed(&mut registry, if (mode == 2) 2 else 1, &mut ctx);
        let clock = bnd_clock(if (mode == 0) BND_NOW + ONE_DAY_MS - ONE_DAY_MS / 10 else BND_NOW + ONE_DAY_MS, &mut ctx);
        if (mode == 0) water_seed(&mut registry, &mut seed, &clock, &ctx)
        else if (mode == 1) claim_reward(&mut registry, &mut seed, &clock, &mut ctx)
        else {
            let mut archive = bnd_archive(&registry, if (mode == 2) 1 else 2, &mut ctx);
            claim_archived_reward(&mut archive, &mut seed, &clock, &mut ctx);
            std::unit_test::destroy(archive);
        };
        std::unit_test::destroy(seed); std::unit_test::destroy(registry);
        clock::destroy_for_testing(clock);
    }

    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v2_rejects_v1_seed_watering() { bnd_reject_seed_action(0); }
    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v2_rejects_v1_seed_direct_claim() { bnd_reject_seed_action(1); }
    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v2_rejects_v1_archive_for_v2_seed() { bnd_reject_seed_action(2); }
    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v2_rejects_v1_seed_archived_claim() { bnd_reject_seed_action(3); }

    #[test_only]
    fun bnd_reject_old_registry_purchase(supply: bool) {
        let mut ctx = tx_context::new_from_hint(@0xA, 954, 0, 0, 0);
        let mut registry = bnd_active_registry(1, &mut ctx);
        let clock = bnd_clock(BND_NOW, &mut ctx);
        let payment = coin::mint_for_testing<SUI>(5_000_000_000, &mut ctx);
        if (supply) buy_supply_drop(&mut registry, SUPPLY_DROP_WATERING_BOOST, payment, &clock, &mut ctx)
        else buy_crate(&mut registry, CRATE_SEEDLING, payment, &clock, &mut ctx);
        std::unit_test::destroy(registry); clock::destroy_for_testing(clock);
    }

    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v2_rejects_v1_registry_crate_purchase() { bnd_reject_old_registry_purchase(false); }
    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v2_rejects_v1_registry_supply_purchase() { bnd_reject_old_registry_purchase(true); }

    #[test_only]
    fun bnd_reject_old_cap(mode: u8) {
        let mut ctx = tx_context::new_from_hint(@0xA, 955, 0, 0, 0);
        let mut registry = bnd_active_registry(2, &mut ctx);
        let mut cap = test_admin_cap_for(&registry, &mut ctx);
        cap.version = 1;
        let clock = bnd_clock(BND_NOW, &mut ctx);
        if (mode == 0) {
            registry.current_season_id = 0;
            registry.season_start_ms = 0;
            start_season(&cap, &mut registry, &clock, &ctx);
        } else if (mode == 1) send_promo_crate(&cap, &registry, @0xB, CRATE_SEEDLING, &mut ctx)
        else {
            let payment = coin::mint_for_testing<SUI>(1, &mut ctx);
            deposit_to_pool(&cap, &mut registry, payment, &clock, &ctx);
        };
        std::unit_test::destroy(cap); std::unit_test::destroy(registry);
        clock::destroy_for_testing(clock);
    }

    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v2_rejects_v1_cap_for_first_start() { bnd_reject_old_cap(0); }
    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v2_rejects_v1_cap_for_free_promo_inventory() { bnd_reject_old_cap(1); }
    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v2_rejects_v1_cap_for_pool_deposit() { bnd_reject_old_cap(2); }

    #[test]
    fun bnd_v2_uniform_production_inventory_remains_usable_between_v2_registries() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut purchase_registry = bnd_active_registry(2, scenario.ctx());
        let mut planting_registry = bnd_active_registry(2, scenario.ctx());
        assert!(object::id(&purchase_registry) != object::id(&planting_registry));
        let clock = bnd_clock(BND_NOW, scenario.ctx());
        let payment = coin::mint_for_testing<SUI>(2_000_000_000, scenario.ctx());
        buy_supply_drop(&mut purchase_registry, SUPPLY_DROP_WATERING_BOOST, payment, &clock, scenario.ctx());
        let sapling = bnd_sapling(2, scenario.ctx());
        let sapling_id = object::id(&sapling);
        let payment = coin::mint_for_testing<SUI>(10_000_000_000, scenario.ctx());
        plant_seed(&mut planting_registry, sapling, payment, option::none(), &clock, scenario.ctx());
        scenario.next_tx(@0xA);
        let tool = scenario.take_from_sender<Tool>();
        let mut seed = scenario.take_from_sender<Seed>();
        assert_eq!(tool.version, 2);
        assert_eq!(seed.version, 2);
        apply_tool(&mut planting_registry, &mut seed, tool, &clock, scenario.ctx());
        assert_eq!(seed.fertilizer_charges, 1);
        assert_eq!(registry_pool_size(&purchase_registry), 1_400_000_000);
        assert_eq!(registry_pool_size(&planting_registry), 7_000_000_000);
        std::unit_test::destroy(seed); std::unit_test::destroy(purchase_registry);
        std::unit_test::destroy(planting_registry);
        std::unit_test::destroy(scenario.take_from_sender_by_id<Sapling>(sapling_id));
        clock::destroy_for_testing(clock); scenario.end();
    }
