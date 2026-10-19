    // Appended to a hash-checked COPY of the accepted module for local VM tests.
    // These tests characterize the existing behavior; they do not choose a new
    // entitlement policy or modify a production function.
    use std::unit_test::assert_eq;
    use sui::test_scenario;

    #[test_only]
    fun payout_fixture_registry(start: u64, amount: u64, ctx: &mut TxContext): Registry {
        let mut registry = test_registry(@0xA, start, ctx);
        let existing = balance::value(&registry.reward_pool);
        let removed = balance::split(&mut registry.reward_pool, existing);
        assert_eq!(balance::destroy_for_testing(removed), 123_456_789);
        balance::join(&mut registry.reward_pool, balance::create_for_testing<SUI>(amount));
        registry
    }

    #[test_only]
    fun payout_fixture_seed(
        registry: &mut Registry, owner: address, last_watered: u64, points: u64,
        ctx: &mut TxContext,
    ): Seed {
        let mut seed = Seed {
            id: object::new(ctx), sapling_id: object::id_from_address(owner),
            season_id: registry.current_season_id, owner,
            planted_at_ms: registry.season_start_ms,
            last_watered_ms: last_watered, watering_streak: 1,
            growth_points: 0, state: STATE_ALIVE,
            fertilizer_charges: 0, miracle_grow_applied: false,
            revival_charges: 0, bottomless_can_expiry_ms: 0,
            permanent_gp_bonus: 0,
        };
        registry.total_seeds = registry.total_seeds + 1;
        add_growth_points(registry, &mut seed, owner, points);
        seed
    }

    #[test_only]
    fun payout_destroy_seed(seed: Seed) {
        std::unit_test::destroy(seed);
    }

    #[test_only]
    fun payout_destroy_archive(archive: SeasonArchive): u64 {
        let amount = balance::value(&archive.reward_pool);
        std::unit_test::destroy(archive);
        amount
    }

    #[test]
    fun payout_direct_and_archived_routes_diverge_after_cutoff_drought() {
        let mut scenario = test_scenario::begin(@0xA);
        let start = ONE_DAY_MS;
        let cutoff = start + SEASON_DURATION_MS;
        let last_watered = cutoff - 9 * ONE_DAY_MS;
        let claim_at = cutoff + 2 * ONE_DAY_MS;
        assert!(claim_at < cutoff + CLAIM_GRACE_MS);

        let mut direct_registry = payout_fixture_registry(start, 1_000, scenario.ctx());
        let mut direct_seed = payout_fixture_seed(
            &mut direct_registry, @0xA, last_watered, 100, scenario.ctx(),
        );
        let mut archive_registry = payout_fixture_registry(start, 1_000, scenario.ctx());
        let mut archive_seed = payout_fixture_seed(
            &mut archive_registry, @0xA, last_watered, 100, scenario.ctx(),
        );
        // Identical histories are alive (although wilted) at the season cutoff.
        assert!(!seed_is_dead_by_time(&direct_seed, cutoff));
        assert!(!seed_is_dead_by_time(&archive_seed, cutoff));

        let mut direct_clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut direct_clock, claim_at);
        claim_reward(&mut direct_registry, &mut direct_seed, &direct_clock, scenario.ctx());
        assert_eq!(direct_seed.state, STATE_DEAD);
        assert_eq!(direct_seed.growth_points, 0);
        assert_eq!(registry_total_gp(&direct_registry), 0);
        assert_eq!(registry_pool_size(&direct_registry), 1_000);

        let cap = test_admin_cap(scenario.ctx());
        let mut archive_clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut archive_clock, cutoff + REVIEW_WINDOW_MS);
        reset_season(&cap, &mut archive_registry, &archive_clock, scenario.ctx());
        assert_eq!(registry_pool_size(&archive_registry), 0);
        assert_eq!(registry_total_gp(&archive_registry), 0);
        scenario.next_tx(@0xA);

        let mut archive = scenario.take_shared<SeasonArchive>();
        assert_eq!(archive_total_gp(&archive), 100);
        assert_eq!(archive_pool_size(&archive), 1_000);
        clock::set_for_testing(&mut archive_clock, claim_at);
        claim_archived_reward(&mut archive, &mut archive_seed, &archive_clock, scenario.ctx());
        assert_eq!(archive_seed.growth_points, 0);
        assert_eq!(archive_seed.state, STATE_ALIVE);
        assert_eq!(archive_total_gp(&archive), 0);
        assert_eq!(archive_pool_size(&archive), 0);
        test_scenario::return_shared(archive);
        scenario.next_tx(@0xA);

        let reward = scenario.take_from_sender<Coin<SUI>>();
        assert_eq!(coin::value(&reward), 1_000);
        std::unit_test::destroy(reward);
        assert_eq!(payout_destroy_archive(scenario.take_shared<SeasonArchive>()), 0);
        payout_destroy_seed(direct_seed);
        payout_destroy_seed(archive_seed);
        let (direct_remainder, direct_treasury) = destroy_test_registry(direct_registry);
        assert_eq!(direct_remainder, 1_000);
        assert_eq!(direct_treasury, 0);
        let (archived_remainder, archived_treasury) = destroy_test_registry(archive_registry);
        assert_eq!(archived_remainder, 0);
        assert_eq!(archived_treasury, 0);
        destroy_test_admin_cap(cap);
        clock::destroy_for_testing(direct_clock);
        clock::destroy_for_testing(archive_clock);
        scenario.end();
    }

    #[test]
    fun payout_direct_claim_order_changes_eligible_payment_with_time_dead_seed() {
        let mut scenario = test_scenario::begin(@0xA);
        let start = ONE_DAY_MS;
        let cutoff = start + SEASON_DURATION_MS;
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, cutoff + 2 * ONE_DAY_MS);
        let mut eligible_first = payout_fixture_registry(start, 1_000, scenario.ctx());
        let mut dead_first = payout_fixture_registry(start, 1_000, scenario.ctx());
        let mut first_a = payout_fixture_seed(
            &mut eligible_first, @0xA, cutoff - ONE_DAY_MS, 40, scenario.ctx(),
        );
        let mut first_b = payout_fixture_seed(
            &mut eligible_first, @0xB, cutoff - 11 * ONE_DAY_MS, 60, scenario.ctx(),
        );
        let mut second_a = payout_fixture_seed(
            &mut dead_first, @0xA, cutoff - ONE_DAY_MS, 40, scenario.ctx(),
        );
        let mut second_b = payout_fixture_seed(
            &mut dead_first, @0xB, cutoff - 11 * ONE_DAY_MS, 60, scenario.ctx(),
        );

        claim_reward(&mut eligible_first, &mut first_a, &clock, scenario.ctx());
        assert_eq!(registry_pool_size(&eligible_first), 600);
        assert_eq!(registry_total_gp(&eligible_first), 60);
        scenario.next_tx(@0xA);
        let early_payment = scenario.take_from_sender<Coin<SUI>>();
        let early_amount = coin::value(&early_payment);
        assert_eq!(early_amount, 400);
        std::unit_test::destroy(early_payment);

        scenario.next_tx(@0xB);
        claim_reward(&mut eligible_first, &mut first_b, &clock, scenario.ctx());
        claim_reward(&mut dead_first, &mut second_b, &clock, scenario.ctx());
        assert_eq!(first_b.state, STATE_DEAD);
        assert_eq!(second_b.state, STATE_DEAD);
        assert_eq!(registry_total_gp(&eligible_first), 0);
        assert_eq!(registry_total_gp(&dead_first), 40);
        assert_eq!(registry_pool_size(&eligible_first), 600);
        assert_eq!(registry_pool_size(&dead_first), 1_000);

        scenario.next_tx(@0xA);
        claim_reward(&mut dead_first, &mut second_a, &clock, scenario.ctx());
        assert_eq!(registry_total_gp(&dead_first), 0);
        assert_eq!(registry_pool_size(&dead_first), 0);
        scenario.next_tx(@0xA);
        let late_payment = scenario.take_from_sender<Coin<SUI>>();
        let late_amount = coin::value(&late_payment);
        assert_eq!(late_amount, 1_000);
        std::unit_test::destroy(late_payment);
        assert!(early_amount != late_amount);

        let (early_remainder, early_treasury) = destroy_test_registry(eligible_first);
        let (late_remainder, late_treasury) = destroy_test_registry(dead_first);
        assert_eq!(early_amount + early_remainder, 1_000);
        assert_eq!(late_amount + late_remainder, 1_000);
        assert_eq!(early_treasury, 0);
        assert_eq!(late_treasury, 0);
        payout_destroy_seed(first_a);
        payout_destroy_seed(first_b);
        payout_destroy_seed(second_a);
        payout_destroy_seed(second_b);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test, expected_failure(abort_code = E_NO_SEEDS)]
    fun payout_partial_direct_then_archive_conserves_funds_and_rejects_replay() {
        let mut scenario = test_scenario::begin(@0xA);
        let start = ONE_DAY_MS;
        let cutoff = start + SEASON_DURATION_MS;
        let mut registry = payout_fixture_registry(start, 1_000, scenario.ctx());
        let mut seed_a = payout_fixture_seed(
            &mut registry, @0xA, cutoff - ONE_DAY_MS, 40, scenario.ctx(),
        );
        let mut seed_b = payout_fixture_seed(
            &mut registry, @0xB, cutoff - ONE_DAY_MS, 60, scenario.ctx(),
        );
        let mut clock = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut clock, cutoff + ONE_DAY_MS / 2);
        claim_reward(&mut registry, &mut seed_a, &clock, scenario.ctx());
        assert_eq!(seed_a.growth_points, 0);
        assert_eq!(registry_total_gp(&registry), 60);
        assert_eq!(registry_pool_size(&registry), 600);
        scenario.next_tx(@0xA);
        let first_reward = scenario.take_from_sender<Coin<SUI>>();
        let first_amount = coin::value(&first_reward);
        assert_eq!(first_amount, 400);
        std::unit_test::destroy(first_reward);

        let cap = test_admin_cap(scenario.ctx());
        clock::set_for_testing(&mut clock, cutoff + REVIEW_WINDOW_MS);
        reset_season(&cap, &mut registry, &clock, scenario.ctx());
        assert_eq!(registry_total_gp(&registry), 0);
        assert_eq!(registry_pool_size(&registry), 0);
        scenario.next_tx(@0xB);
        let mut archive = scenario.take_shared<SeasonArchive>();
        assert_eq!(archive_total_gp(&archive), 60);
        assert_eq!(archive_pool_size(&archive), 600);
        claim_archived_reward(&mut archive, &mut seed_b, &clock, scenario.ctx());
        assert_eq!(seed_b.growth_points, 0);
        assert_eq!(archive_total_gp(&archive), 0);
        assert_eq!(archive_pool_size(&archive), 0);
        test_scenario::return_shared(archive);
        scenario.next_tx(@0xB);
        let second_reward = scenario.take_from_sender<Coin<SUI>>();
        let second_amount = coin::value(&second_reward);
        assert_eq!(second_amount, 600);
        assert_eq!(first_amount + second_amount, 1_000);
        std::unit_test::destroy(second_reward);

        // The final expected abort is specifically replaying A's already paid
        // Seed through the archive; all conservation assertions precede it.
        scenario.next_tx(@0xA);
        let mut archive = scenario.take_shared<SeasonArchive>();
        claim_archived_reward(&mut archive, &mut seed_a, &clock, scenario.ctx());
        // A return would be an unexpected replay acceptance. This distinct
        // sentinel also keeps non-drop fixtures off a normal return path.
        abort 0xC0FFEE
    }
