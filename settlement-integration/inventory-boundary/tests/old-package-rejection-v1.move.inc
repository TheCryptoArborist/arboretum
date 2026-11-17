    // Appended only to an isolated copy of the byte-verified frozen v12 code.
    // Version-2-shaped fixtures use the unchanged object layouts. These tests
    // call the actual old entrypoints; they do not duplicate their guards.
    use std::unit_test::assert_eq;
    use sui::test_scenario;

    #[test_only]
    const BND_OLD_NOW: u64 = 3_499_200_000;

    #[test_only]
    fun bnd_old_clock(ctx: &mut TxContext): Clock {
        let mut clock = clock::create_for_testing(ctx);
        clock::set_for_testing(&mut clock, BND_OLD_NOW);
        clock
    }

    #[test_only]
    fun bnd_old_registry(version: u64, ctx: &mut TxContext): Registry {
        let mut registry = test_registry(@0xA, BND_OLD_NOW - (SEASON_DURATION_MS - ONE_DAY_MS), ctx);
        registry.version = version;
        let initial = balance::split(&mut registry.reward_pool, 123_456_789);
        assert_eq!(balance::destroy_for_testing(initial), 123_456_789);
        registry
    }

    #[test_only]
    fun bnd_old_sapling(version: u64, ctx: &mut TxContext): Sapling {
        Sapling { id: object::new(ctx), version, name: string::utf8(b"old package fixture"),
            cycle_count: 0, total_sui_harvested: 0 }
    }

    #[test_only]
    fun bnd_old_seed(registry: &mut Registry, version: u64, dead: bool, ctx: &mut TxContext): Seed {
        let points = if (dead) 0 else 10;
        let seed = Seed { id: object::new(ctx), version, registry_id: object::id(registry),
            cutoff_growth_points: points, reward_processed: false,
            sapling_id: object::id_from_address(@0xB17), season_id: registry.current_season_id,
            owner: @0xA, planted_at_ms: BND_OLD_NOW, last_watered_ms: BND_OLD_NOW,
            watering_streak: 1, growth_points: points,
            state: if (dead) STATE_DEAD else STATE_ALIVE,
            fertilizer_charges: 0, miracle_grow_applied: false, revival_charges: 0,
            bottomless_can_expiry_ms: 0, permanent_gp_bonus: 0 };
        registry.total_seeds = 1;
        registry.total_growth_points = points;
        registry.eligible_growth_points = points;
        seed
    }

    #[test_only]
    fun bnd_old_buy_with_v2_registry(supply: bool) {
        let mut ctx = tx_context::new_from_hint(@0xA, 980, 0, 0, 0);
        let mut registry = bnd_old_registry(2, &mut ctx);
        let clock = bnd_old_clock(&mut ctx);
        let payment = coin::mint_for_testing<SUI>(if (supply) 20_000_000 else 10_000_000, &mut ctx);
        if (supply) buy_supply_drop(&mut registry, SUPPLY_DROP_WATERING_BOOST, payment, &clock, &mut ctx)
        else buy_crate(&mut registry, CRATE_SEEDLING, payment, &clock, &mut ctx);
        std::unit_test::destroy(registry); clock::destroy_for_testing(clock);
    }

    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v1_cheap_crate_purchase_cannot_mutate_v2_registry() { bnd_old_buy_with_v2_registry(false); }
    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v1_cheap_supply_purchase_cannot_mutate_v2_registry() { bnd_old_buy_with_v2_registry(true); }

    #[test_only]
    fun bnd_old_plant_with_v2_registry(generic: bool) {
        let mut ctx = tx_context::new_from_hint(@0xA, 981, 0, 0, 0);
        let mut registry = bnd_old_registry(2, &mut ctx);
        let sapling = bnd_old_sapling(1, &mut ctx);
        let clock = bnd_old_clock(&mut ctx);
        let payment = coin::mint_for_testing<SUI>(10_000_000, &mut ctx);
        if (generic) {
            plant_seed_with_nftree(&mut registry, &sapling, payment, option::none(), &clock, &mut ctx);
            std::unit_test::destroy(sapling);
        } else plant_seed(&mut registry, sapling, payment, option::none(), &clock, &mut ctx);
        std::unit_test::destroy(registry); clock::destroy_for_testing(clock);
    }

    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v1_cheap_native_plant_cannot_mutate_v2_registry() { bnd_old_plant_with_v2_registry(false); }
    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v1_cheap_generic_plant_cannot_mutate_v2_registry() { bnd_old_plant_with_v2_registry(true); }

    #[test_only]
    fun bnd_old_open(crate_version: u64, registry_version: u64) {
        let mut scenario = test_scenario::begin(@0x0);
        random::create_for_testing(scenario.ctx());
        scenario.next_tx(@0xA);
        let registry = bnd_old_registry(registry_version, scenario.ctx());
        let crate_obj = Crate { id: object::new(scenario.ctx()), version: crate_version, tier: CRATE_SEEDLING };
        let rng = scenario.take_shared<Random>();
        open_crate(&registry, crate_obj, &rng, scenario.ctx());
        std::unit_test::destroy(rng); std::unit_test::destroy(registry);
        scenario.end();
    }

    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v1_opening_cannot_consume_v2_crate() { bnd_old_open(2, 1); }
    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v1_crate_cannot_open_through_v2_registry() { bnd_old_open(1, 2); }

    #[test_only]
    fun bnd_old_tool_use(tool_version: u64, registry_version: u64, seed_version: u64, revival: bool) {
        let mut ctx = tx_context::new_from_hint(@0xA, 982, 0, 0, 0);
        let mut registry = bnd_old_registry(registry_version, &mut ctx);
        let mut seed = bnd_old_seed(&mut registry, seed_version, revival, &mut ctx);
        let tool = Tool { id: object::new(&mut ctx), version: tool_version,
            kind: string::utf8(if (revival) b"revival_kit" else b"watering_boost"), charges: 1, rarity: 2 };
        let clock = bnd_old_clock(&mut ctx);
        if (revival) revive_seed_with_tool(&mut registry, &mut seed, tool, &clock, &ctx)
        else apply_tool(&mut registry, &mut seed, tool, &clock, &ctx);
        std::unit_test::destroy(seed); std::unit_test::destroy(registry);
        clock::destroy_for_testing(clock);
    }

    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v1_application_cannot_consume_v2_tool() { bnd_old_tool_use(2, 1, 1, false); }
    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v1_revival_cannot_consume_v2_tool() { bnd_old_tool_use(2, 1, 1, true); }
    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v1_tool_cannot_apply_against_v2_registry() { bnd_old_tool_use(1, 2, 2, false); }
    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v1_tool_cannot_revive_against_v2_registry() { bnd_old_tool_use(1, 2, 2, true); }
    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v1_tool_cannot_mutate_v2_seed_through_v1_registry() { bnd_old_tool_use(1, 1, 2, false); }

    #[test_only]
    fun bnd_old_cap_action(promo: bool) {
        let mut ctx = tx_context::new_from_hint(@0xA, 983, 0, 0, 0);
        let mut registry = bnd_old_registry(2, &mut ctx);
        let mut cap = test_admin_cap_for(&registry, &mut ctx);
        cap.version = 2;
        let clock = bnd_old_clock(&mut ctx);
        if (promo) send_promo_crate(&cap, &registry, @0xB, CRATE_SEEDLING, &mut ctx)
        else {
            registry.current_season_id = 0;
            registry.season_start_ms = 0;
            start_season(&cap, &mut registry, &clock, &ctx);
        };
        std::unit_test::destroy(cap); std::unit_test::destroy(registry);
        clock::destroy_for_testing(clock);
    }

    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v1_start_cannot_activate_v2_registry_and_cap() { bnd_old_cap_action(false); }
    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v1_promo_cannot_mint_using_v2_registry_and_cap() { bnd_old_cap_action(true); }

    #[test, expected_failure(abort_code = E_WRONG_VERSION)]
    fun bnd_v1_claim_cannot_consume_v2_seed_entitlement() {
        let mut ctx = tx_context::new_from_hint(@0xA, 984, 0, 0, 0);
        let mut registry = bnd_old_registry(2, &mut ctx);
        let mut seed = bnd_old_seed(&mut registry, 2, false, &mut ctx);
        let mut clock = bnd_old_clock(&mut ctx);
        clock::set_for_testing(&mut clock, BND_OLD_NOW + ONE_DAY_MS);
        claim_reward(&mut registry, &mut seed, &clock, &mut ctx);
        std::unit_test::destroy(seed); std::unit_test::destroy(registry);
        clock::destroy_for_testing(clock);
    }

    #[test]
    fun bnd_v1_frozen_cheap_purchase_still_mints_only_version_one_inventory() {
        assert_eq!(VERSION, 1);
        let mut scenario = test_scenario::begin(@0xA);
        let mut registry = bnd_old_registry(1, scenario.ctx());
        let clock = bnd_old_clock(scenario.ctx());
        let payment = coin::mint_for_testing<SUI>(10_000_000, scenario.ctx());
        buy_crate(&mut registry, CRATE_SEEDLING, payment, &clock, scenario.ctx());
        let payment = coin::mint_for_testing<SUI>(20_000_000, scenario.ctx());
        buy_supply_drop(&mut registry, SUPPLY_DROP_WATERING_BOOST, payment, &clock, scenario.ctx());
        mint_sapling(b"old version remains old", scenario.ctx());
        scenario.next_tx(@0xA);
        let crate_obj = scenario.take_from_sender<Crate>();
        let tool = scenario.take_from_sender<Tool>();
        let sapling = scenario.take_from_sender<Sapling>();
        assert_eq!(crate_obj.version, 1);
        assert_eq!(tool.version, 1);
        assert_eq!(sapling.version, 1);
        assert_eq!(tool.charges, 1);
        assert_eq!(registry_pool_size(&registry), 21_000_000);
        std::unit_test::destroy(crate_obj); std::unit_test::destroy(tool);
        std::unit_test::destroy(sapling); std::unit_test::destroy(registry);
        clock::destroy_for_testing(clock); scenario.end();
    }
