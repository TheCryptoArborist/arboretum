    #[test_only]
    fun step1_seed(nft_id: ID, owner: address, start: u64, ctx: &mut TxContext): Seed {
        Seed { id: object::new(ctx), sapling_id: nft_id, season_id: 1, owner,
            planted_at_ms: start, last_watered_ms: start, watering_streak: 1,
            growth_points: 0, state: STATE_ALIVE, fertilizer_charges: 0,
            miracle_grow_applied: false, revival_charges: 0,
            bottomless_can_expiry_ms: 0, permanent_gp_bonus: 0 }
    }

    #[test_only]
    fun step1_setup(): (Registry, Seed, Clock, TxContext) {
        let mut ctx = tx_context::new_from_hint(@0xA, 11, 0, 0, 0);
        let clock = clock::create_for_testing(&mut ctx);
        let mut registry = test_registry(@0xA, 1, &mut ctx);
        let mut seed = step1_seed(object::id_from_address(@0xCAFE), @0xA, 1, &mut ctx);
        register_line(&mut registry, &seed, 1);
        add_growth_points(&mut registry, &mut seed, @0xA, 134);
        (registry, seed, clock, ctx)
    }

    #[test_only]
    fun step1_tool(kind: vector<u8>, uses: u8, ctx: &mut TxContext): Tool {
        Tool { id: object::new(ctx), kind: string::utf8(kind), charges: uses, rarity: 0 }
    }

    #[test_only]
    fun step1_drop_tool(tool: Tool) {
        let Tool { id, kind: _, charges: _, rarity: _ } = tool;
        object::delete(id);
    }

    #[test_only]
    fun step1_drop_seed(seed: Seed) {
        let Seed { id, sapling_id: _, season_id: _, owner: _, planted_at_ms: _,
            last_watered_ms: _, watering_streak: _, growth_points: _, state: _,
            fertilizer_charges: _, miracle_grow_applied: _, revival_charges: _,
            bottomless_can_expiry_ms: _, permanent_gp_bonus: _ } = seed;
        object::delete(id);
    }

    #[test_only]
    fun step1_finish(registry: Registry, seed: Seed, clock: Clock) {
        step1_drop_seed(seed);
        let (pool, treasury) = destroy_test_registry(registry);
        assert!(pool == 123_456_789 && treasury == 0, 900);
        clock::destroy_for_testing(clock);
    }

    #[test]
    fun step1_five_day_return_matches_observed_134_to_146() {
        let (mut r, mut s, mut c, ctx) = step1_setup();
        clock::set_for_testing(&mut c, 1 + 509_381_422);
        water_seed(&mut r, &mut s, &c, &ctx);
        assert!(s.growth_points == 146 && r.total_growth_points == 146, 901);
        assert!(s.watering_streak == 1 && s.state == STATE_ALIVE, 902);
        assert!(s.last_watered_ms == 509_381_423, 903);
        step1_finish(r, s, c);
    }

    #[test]
    fun step1_missed_days_reset_higher_streak_without_losing_gp() {
        let (mut r, mut s, mut c, ctx) = step1_setup();
        s.watering_streak = 19;
        clock::set_for_testing(&mut c, 1 + 5 * ONE_DAY_MS);
        water_seed(&mut r, &mut s, &c, &ctx);
        assert!(s.watering_streak == 1 && s.growth_points == 146, 904);
        step1_finish(r, s, c);
    }

    #[test]
    fun step1_wilted_but_living_seed_returns_to_alive() {
        let (mut r, mut s, mut c, ctx) = step1_setup();
        s.state = STATE_WILTING;
        clock::set_for_testing(&mut c, 1 + 7 * ONE_DAY_MS);
        water_seed(&mut r, &mut s, &c, &ctx);
        assert!(s.state == STATE_ALIVE && s.growth_points == 146, 905);
        step1_finish(r, s, c);
    }

    #[test]
    fun step1_ten_day_unprotected_seed_dies_without_award() {
        let (mut r, mut s, mut c, ctx) = step1_setup();
        clock::set_for_testing(&mut c, 1 + 10 * ONE_DAY_MS);
        water_seed(&mut r, &mut s, &c, &ctx);
        assert!(s.state == STATE_DEAD && s.growth_points == 0, 906);
        assert!(r.total_growth_points == 0, 907);
        step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_ALREADY_WATERED_TODAY)]
    fun step1_normal_water_rejects_one_millisecond_early() {
        let (mut r, mut s, mut c, ctx) = step1_setup();
        clock::set_for_testing(&mut c, POINT_INTERVAL_MS);
        water_seed(&mut r, &mut s, &c, &ctx);
        step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_ALREADY_WATERED_TODAY)]
    fun step1_protection_blocks_early_points() {
        let (mut r, mut s, mut c, ctx) = step1_setup();
        s.bottomless_can_expiry_ms = 7 * ONE_DAY_MS;
        clock::set_for_testing(&mut c, POINT_INTERVAL_MS);
        water_seed(&mut r, &mut s, &c, &ctx);
        step1_finish(r, s, c);
    }

    #[test]
    fun step1_exact_interval_awards_once_with_protection() {
        let (mut r, mut s, mut c, ctx) = step1_setup();
        s.bottomless_can_expiry_ms = 7 * ONE_DAY_MS;
        clock::set_for_testing(&mut c, 1 + POINT_INTERVAL_MS);
        water_seed(&mut r, &mut s, &c, &ctx);
        assert!(s.growth_points == 148 && s.watering_streak == 2, 908);
        assert!(point_watering_ready_at(&r, &s) == 1 + 2 * POINT_INTERVAL_MS, 909);
        step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_ALREADY_WATERED_TODAY)]
    fun step1_second_protected_water_in_same_transaction_rejected() {
        let (mut r, mut s, mut c, ctx) = step1_setup();
        s.bottomless_can_expiry_ms = 7 * ONE_DAY_MS;
        clock::set_for_testing(&mut c, 1 + POINT_INTERVAL_MS);
        water_seed(&mut r, &mut s, &c, &ctx);
        water_seed(&mut r, &mut s, &c, &ctx);
        step1_finish(r, s, c);
    }

    #[test]
    fun step1_protected_long_gap_earns_only_one_watering() {
        let (mut r, mut s, mut c, ctx) = step1_setup();
        s.bottomless_can_expiry_ms = 12 * ONE_DAY_MS;
        clock::set_for_testing(&mut c, 1 + 10 * ONE_DAY_MS);
        water_seed(&mut r, &mut s, &c, &ctx);
        assert!(s.growth_points == 146 && s.state == STATE_ALIVE, 910);
        step1_finish(r, s, c);
    }

    #[test]
    fun step1_expired_protection_does_not_prevent_death() {
        let (mut r, mut s, mut c, ctx) = step1_setup();
        s.bottomless_can_expiry_ms = 3 * ONE_DAY_MS;
        clock::set_for_testing(&mut c, 1 + 10 * ONE_DAY_MS);
        water_seed(&mut r, &mut s, &c, &ctx);
        assert!(s.state == STATE_DEAD && s.growth_points == 0, 911);
        step1_finish(r, s, c);
    }

    #[test]
    fun step1_rain_barrel_does_not_delay_gp_clock_or_add_points() {
        let (mut r, mut s, mut c, mut ctx) = step1_setup();
        clock::set_for_testing(&mut c, 1 + POINT_INTERVAL_MS / 2);
        let mut tool = step1_tool(b"rain_barrel", 2, &mut ctx);
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        assert!(tool.charges == 1 && s.growth_points == 134, 912);
        assert!(point_watering_ready_at(&r, &s) == 1 + POINT_INTERVAL_MS, 913);
        clock::set_for_testing(&mut c, 1 + POINT_INTERVAL_MS);
        water_seed(&mut r, &mut s, &c, &ctx);
        assert!(s.growth_points == 148, 914);
        step1_drop_tool(tool); step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_ALREADY_WATERED_TODAY)]
    fun step1_rain_barrel_cannot_enable_early_watering() {
        let (mut r, mut s, mut c, mut ctx) = step1_setup();
        clock::set_for_testing(&mut c, POINT_INTERVAL_MS);
        let mut tool = step1_tool(b"rain_barrel", 2, &mut ctx);
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        water_seed(&mut r, &mut s, &c, &ctx);
        step1_drop_tool(tool); step1_finish(r, s, c);
    }

    #[test]
    fun step1_rain_barrel_cannot_hide_missed_streak_days() {
        let (mut r, mut s, mut c, mut ctx) = step1_setup();
        s.watering_streak = 15;
        clock::set_for_testing(&mut c, 1 + 5 * ONE_DAY_MS);
        let mut tool = step1_tool(b"rain_barrel", 1, &mut ctx);
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        water_seed(&mut r, &mut s, &c, &ctx);
        assert!(s.watering_streak == 1 && s.growth_points == 146, 915);
        step1_drop_tool(tool); step1_finish(r, s, c);
    }

    #[test]
    fun step1_timeless_seed_changes_streak_not_point_clock() {
        let (mut r, mut s, mut c, mut ctx) = step1_setup();
        clock::set_for_testing(&mut c, 1 + POINT_INTERVAL_MS);
        let mut tool = step1_tool(b"timeless_seed", 1, &mut ctx);
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        assert!(s.watering_streak == 6, 916);
        assert!(point_watering_ready_at(&r, &s) == 1 + POINT_INTERVAL_MS, 917);
        water_seed(&mut r, &mut s, &c, &ctx);
        assert!(s.growth_points == 158 && s.watering_streak == 7, 918);
        step1_drop_tool(tool); step1_finish(r, s, c);
    }

    #[test]
    fun step1_instant_tool_spends_exactly_one_use() {
        let (mut r, mut s, mut c, mut ctx) = step1_setup();
        clock::set_for_testing(&mut c, 1);
        let mut tool = step1_tool(b"growth_tonic", 2, &mut ctx);
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        assert!(tool.charges == 1 && s.growth_points == 154, 919);
        assert!(instant_tool_ready_at(&r, &s) == 1 + POINT_INTERVAL_MS, 920);
        step1_drop_tool(tool); step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_INSTANT_COOLDOWN)]
    fun step1_instant_limit_shared_between_different_tool_names() {
        let (mut r, mut s, mut c, mut ctx) = step1_setup();
        clock::set_for_testing(&mut c, 1);
        let mut first = step1_tool(b"growth_tonic", 1, &mut ctx);
        let mut second = step1_tool(b"ancient_bark", 1, &mut ctx);
        apply_tool_checked(&mut r, &mut s, &mut first, &c, &ctx);
        apply_tool_checked(&mut r, &mut s, &mut second, &c, &ctx);
        step1_drop_tool(first); step1_drop_tool(second); step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_INSTANT_COOLDOWN)]
    fun step1_instant_limit_rejects_one_millisecond_early() {
        let (mut r, mut s, mut c, mut ctx) = step1_setup();
        clock::set_for_testing(&mut c, 1);
        let mut tool = step1_tool(b"sunstone", 2, &mut ctx);
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        clock::set_for_testing(&mut c, POINT_INTERVAL_MS);
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        step1_drop_tool(tool); step1_finish(r, s, c);
    }

    #[test]
    fun step1_instant_limit_accepts_exact_boundary() {
        let (mut r, mut s, mut c, mut ctx) = step1_setup();
        clock::set_for_testing(&mut c, 1);
        let mut tool = step1_tool(b"sunstone", 2, &mut ctx);
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        clock::set_for_testing(&mut c, 1 + POINT_INTERVAL_MS);
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        assert!(tool.charges == 0 && s.growth_points == 194, 921);
        step1_drop_tool(tool); step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_INSTANT_COOLDOWN)]
    fun step1_watering_and_rain_do_not_reset_instant_allowance() {
        let (mut r, mut s, mut c, mut ctx) = step1_setup();
        clock::set_for_testing(&mut c, 1 + POINT_INTERVAL_MS);
        let mut first = step1_tool(b"growth_tonic", 2, &mut ctx);
        let mut rain = step1_tool(b"rain_barrel", 1, &mut ctx);
        apply_tool_checked(&mut r, &mut s, &mut first, &c, &ctx);
        water_seed(&mut r, &mut s, &c, &ctx);
        apply_tool_checked(&mut r, &mut s, &mut rain, &c, &ctx);
        apply_tool_checked(&mut r, &mut s, &mut first, &c, &ctx);
        step1_drop_tool(first); step1_drop_tool(rain); step1_finish(r, s, c);
    }

    #[test]
    fun step1_two_forest_hearts_add_ten_base_points() {
        let (mut r, mut s, mut c, mut ctx) = step1_setup();
        clock::set_for_testing(&mut c, 1);
        let mut tool = step1_tool(b"forest_heart", 3, &mut ctx);
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        assert!(tool.charges == 1 && forest_hearts_used(&r, &s) == 2, 922);
        assert!(s.permanent_gp_bonus == 10 && s.growth_points == 134, 923);
        clock::set_for_testing(&mut c, 1 + POINT_INTERVAL_MS);
        water_seed(&mut r, &mut s, &c, &ctx);
        assert!(s.growth_points == 158, 924);
        step1_drop_tool(tool); step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_FOREST_HEART_CAP)]
    fun step1_third_forest_heart_rejected() {
        let (mut r, mut s, mut c, mut ctx) = step1_setup();
        clock::set_for_testing(&mut c, 1);
        let mut tool = step1_tool(b"forest_heart", 3, &mut ctx);
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        step1_drop_tool(tool); step1_finish(r, s, c);
    }

    #[test]
    fun step1_recreated_seed_and_owner_keep_line_caps() {
        let (mut r, mut s, mut c, mut ctx) = step1_setup();
        clock::set_for_testing(&mut c, 1);
        let mut heart = step1_tool(b"forest_heart", 2, &mut ctx);
        let mut instant = step1_tool(b"ancient_bark", 1, &mut ctx);
        apply_tool_checked(&mut r, &mut s, &mut heart, &c, &ctx);
        apply_tool_checked(&mut r, &mut s, &mut heart, &c, &ctx);
        apply_tool_checked(&mut r, &mut s, &mut instant, &c, &ctx);
        let replacement = step1_seed(s.sapling_id, @0xB, 2, &mut ctx);
        register_line(&mut r, &replacement, 2);
        assert!(forest_hearts_used(&r, &replacement) == 2, 925);
        assert!(instant_tool_ready_at(&r, &replacement) == 1 + POINT_INTERVAL_MS, 926);
        assert!(point_watering_ready_at(&r, &replacement) == 2 + POINT_INTERVAL_MS, 927);
        step1_drop_seed(replacement); step1_drop_tool(heart); step1_drop_tool(instant);
        step1_finish(r, s, c);
    }

    #[test]
    fun step1_other_nft_and_next_season_have_independent_allowances() {
        let (mut r, s, c, mut ctx) = step1_setup();
        consume_instant_allowance(&mut r, &s, 1);
        consume_forest_allowance(&mut r, &s);
        let other = step1_seed(object::id_from_address(@0xBEEF), @0xA, 1, &mut ctx);
        register_line(&mut r, &other, 1);
        assert!(forest_hearts_used(&r, &other) == 0 && instant_tool_ready_at(&r, &other) == 0, 928);
        let mut next = step1_seed(s.sapling_id, @0xA, 1, &mut ctx);
        next.season_id = 2;
        register_line(&mut r, &next, 1);
        assert!(forest_hearts_used(&r, &next) == 0 && instant_tool_ready_at(&r, &next) == 0, 929);
        step1_drop_seed(other); step1_drop_seed(next); step1_finish(r, s, c);
    }

    #[test]
    fun step1_boost_counts_add_without_multiplying_percentages() {
        let (mut r, mut s, mut c, mut ctx) = step1_setup();
        clock::set_for_testing(&mut c, 1 + POINT_INTERVAL_MS);
        let mut fertilizer = step1_tool(b"fertilizer", 2, &mut ctx);
        let mut boost = step1_tool(b"watering_boost", 1, &mut ctx);
        apply_tool_checked(&mut r, &mut s, &mut fertilizer, &c, &ctx);
        apply_tool_checked(&mut r, &mut s, &mut boost, &c, &ctx);
        assert!(s.fertilizer_charges == 4 && fertilizer.charges == 1 && boost.charges == 0, 930);
        water_seed(&mut r, &mut s, &c, &ctx);
        assert!(s.growth_points == 155 && s.fertilizer_charges == 3, 931);
        step1_drop_tool(fertilizer); step1_drop_tool(boost); step1_finish(r, s, c);
    }

    #[test]
    fun step1_double_dose_combines_once_and_keeps_second_boost() {
        let (mut r, mut s, mut c, mut ctx) = step1_setup();
        clock::set_for_testing(&mut c, 1 + POINT_INTERVAL_MS);
        let tool = step1_tool(b"double_dose", 1, &mut ctx);
        apply_tool(&mut r, &mut s, tool, &c, &ctx);
        water_seed(&mut r, &mut s, &c, &ctx);
        assert!(s.growth_points == 176 && !s.miracle_grow_applied && s.fertilizer_charges == 1, 932);
        clock::set_for_testing(&mut c, 1 + 2 * POINT_INTERVAL_MS);
        water_seed(&mut r, &mut s, &c, &ctx);
        assert!(s.growth_points == 200 && s.fertilizer_charges == 0, 933);
        step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_DOUBLE_ALREADY_QUEUED)]
    fun step1_duplicate_miracle_rejected() {
        let (mut r, mut s, mut c, mut ctx) = step1_setup();
        clock::set_for_testing(&mut c, 1);
        s.miracle_grow_applied = true;
        let mut tool = step1_tool(b"miracle_grow", 1, &mut ctx);
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        step1_drop_tool(tool); step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_DOUBLE_ALREADY_QUEUED)]
    fun step1_duplicate_crystal_water_rejected_as_whole_item() {
        let (mut r, mut s, mut c, mut ctx) = step1_setup();
        clock::set_for_testing(&mut c, 1);
        s.miracle_grow_applied = true;
        let mut tool = step1_tool(b"crystal_water", 1, &mut ctx);
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        step1_drop_tool(tool); step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_DOUBLE_ALREADY_QUEUED)]
    fun step1_duplicate_double_dose_rejected_as_whole_item() {
        let (mut r, mut s, mut c, mut ctx) = step1_setup();
        clock::set_for_testing(&mut c, 1);
        s.miracle_grow_applied = true;
        let mut tool = step1_tool(b"double_dose", 1, &mut ctx);
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        step1_drop_tool(tool); step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_PROTECTION_NO_EXTENSION)]
    fun step1_mulch_cannot_shorten_drought_shield() {
        let (mut r, mut s, mut c, mut ctx) = step1_setup();
        clock::set_for_testing(&mut c, 1);
        s.bottomless_can_expiry_ms = 1 + 7 * ONE_DAY_MS;
        let mut tool = step1_tool(b"mulch", 1, &mut ctx);
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        step1_drop_tool(tool); step1_finish(r, s, c);
    }

    #[test]
    fun step1_protection_refresh_extends_from_now_not_prior_expiry() {
        let (mut r, mut s, mut c, mut ctx) = step1_setup();
        clock::set_for_testing(&mut c, 1 + 6 * ONE_DAY_MS);
        s.bottomless_can_expiry_ms = 1 + 7 * ONE_DAY_MS;
        let mut tool = step1_tool(b"mulch", 1, &mut ctx);
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        assert!(s.bottomless_can_expiry_ms == 1 + 9 * ONE_DAY_MS, 934);
        step1_drop_tool(tool); step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_BOOST_QUEUE_FULL)]
    fun step1_queue_overflow_rejected_explicitly() {
        let (mut r, mut s, mut c, mut ctx) = step1_setup();
        clock::set_for_testing(&mut c, 1);
        s.fertilizer_charges = 250;
        let mut tool = step1_tool(b"philosophers_soil", 1, &mut ctx);
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        step1_drop_tool(tool); step1_finish(r, s, c);
    }

    #[test]
    fun step1_revival_does_not_restore_points_or_reset_forest_cap() {
        let (mut r, mut s, mut c, mut ctx) = step1_setup();
        consume_forest_allowance(&mut r, &s);
        consume_forest_allowance(&mut r, &s);
        clock::set_for_testing(&mut c, 1 + 10 * ONE_DAY_MS);
        water_seed(&mut r, &mut s, &c, &ctx);
        let kit = step1_tool(b"revival_kit", 1, &mut ctx);
        revive_seed_with_tool(&mut r, &mut s, kit, &c, &ctx);
        assert!(s.growth_points == 0 && s.state == STATE_ALIVE && forest_hearts_used(&r, &s) == 2, 935);
        water_seed(&mut r, &mut s, &c, &ctx);
        assert!(s.growth_points == 12, 936);
        step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_SEASON_ENDED)]
    fun step1_no_watering_at_or_after_season_end() {
        let (mut r, mut s, mut c, ctx) = step1_setup();
        clock::set_for_testing(&mut c, 1 + SEASON_DURATION_MS);
        water_seed(&mut r, &mut s, &c, &ctx);
        step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_SEED_NOT_FOUND)]
    fun step1_wrong_owner_cannot_water() {
        let (mut r, mut s, mut c, ctx) = step1_setup();
        s.owner = @0xB;
        clock::set_for_testing(&mut c, 1 + POINT_INTERVAL_MS);
        water_seed(&mut r, &mut s, &c, &ctx);
        step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_WRONG_SEASON)]
    fun step1_wrong_season_cannot_water() {
        let (mut r, mut s, mut c, ctx) = step1_setup();
        s.season_id = 2;
        clock::set_for_testing(&mut c, 1 + POINT_INTERVAL_MS);
        water_seed(&mut r, &mut s, &c, &ctx);
        step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_LINE_CONTROLS_MISSING)]
    fun step1_unregistered_legacy_like_seed_fails_closed() {
        let (mut r, mut s, mut c, ctx) = step1_setup();
        s.sapling_id = object::id_from_address(@0xBAD);
        clock::set_for_testing(&mut c, 1 + POINT_INTERVAL_MS);
        water_seed(&mut r, &mut s, &c, &ctx);
        step1_finish(r, s, c);
    }
