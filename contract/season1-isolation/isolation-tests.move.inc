    #[test_only]
    fun step2_destroy_crate(c: Crate) { let Crate { id, tier: _, origin: _ } = c; object::delete(id); }

    #[test_only]
    fun step2_crate(r: &mut Registry, tier: u8, ctx: &mut TxContext): Crate {
        let id = object::new(ctx);
        let origin = record_paid_receipt(r, object::uid_to_inner(&id), tier, crate_price(tier), false, tx_context::sender(ctx));
        Crate { id, tier, origin }
    }

    #[test, expected_failure(abort_code = E_RULES_VERSION)]
    fun step2_old_rules_version_cannot_water() {
        let (mut r, mut s, mut c, ctx) = step1_setup();
        r.rules_version = 0;
        clock::set_for_testing(&mut c, 1 + POINT_INTERVAL_MS);
        water_seed_checked(&mut r, &mut s, &c, &ctx);
        step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_ECONOMY_VERSION)]
    fun step2_foreign_economy_cannot_water() {
        let (mut r, mut s, mut c, ctx) = step1_setup();
        s.economy_version = 0;
        clock::set_for_testing(&mut c, 1 + POINT_INTERVAL_MS);
        water_seed_checked(&mut r, &mut s, &c, &ctx);
        step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_FOREIGN_REGISTRY)]
    fun step2_seed_cannot_move_points_between_registries() {
        let (mut r, mut s, mut c, ctx) = step1_setup();
        s.registry_id = object::id_from_address(@0xBAD);
        clock::set_for_testing(&mut c, 1 + POINT_INTERVAL_MS);
        water_seed_checked(&mut r, &mut s, &c, &ctx);
        step1_finish(r, s, c);
    }

    #[test]
    fun step2_canonical_type_is_accepted_without_remint_requirement() {
        let mut ctx = tx_context::new_from_hint(@0xA, 71, 0, 0, 0);
        let nft = canonical_fixture::collection::make(&mut ctx);
        assert_nftree(&nft);
        canonical_fixture::collection::destroy(nft);
    }

    #[test, expected_failure(abort_code = E_NOT_CANONICAL_NFTREE)]
    fun step2_lookalike_collection_nft_is_rejected() {
        let (mut r, s, mut c, mut ctx) = step1_setup();
        clock::set_for_testing(&mut c, 2);
        let nft = fake_fixture::collection::make(&mut ctx);
        let payment = coin::mint_for_testing<SUI>(GROWTH_DEPOSIT_MIST, &mut ctx);
        plant_seed_with_nftree(&mut r, nft, payment, option::none(), &c, &mut ctx);
        step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_WRONG_NFTREE)]
    fun step2_other_canonical_nft_cannot_water_this_seed() {
        let (mut r, mut s, mut c, mut ctx) = step1_setup();
        clock::set_for_testing(&mut c, 1 + POINT_INTERVAL_MS);
        let nft = canonical_fixture::collection::make(&mut ctx);
        water_seed(&mut r, &mut s, nft, &c, &mut ctx);
        step1_finish(r, s, c);
    }

    #[test]
    fun step2_paid_plant_returns_same_nft_and_watering_uses_proof() {
        let mut scenario = sui::test_scenario::begin(@0xA);
        let mut r = test_registry(@0xA, 1, scenario.ctx());
        let mut c = clock::create_for_testing(scenario.ctx());
        clock::set_for_testing(&mut c, 2);
        let nft = canonical_fixture::collection::make(scenario.ctx());
        let nft_id = object::id(&nft);
        let payment = coin::mint_for_testing<SUI>(GROWTH_DEPOSIT_MIST, scenario.ctx());
        let old_pool = balance::value(&r.reward_pool);
        plant_seed_with_nftree(&mut r, nft, payment, option::none(), &c, scenario.ctx());
        assert!(balance::value(&r.reward_pool) == old_pool + 7_000_000_000, 950);
        scenario.next_tx(@0xA);
        let mut s = scenario.take_from_sender<Seed>();
        let nft = scenario.take_from_sender<canonical_fixture::collection::NFT>();
        assert!(object::id(&nft) == nft_id && s.sapling_id == nft_id && s.registry_id == object::id(&r), 951);
        assert!(s.growth_points == 10, 952);
        clock::set_for_testing(&mut c, 2 + POINT_INTERVAL_MS);
        water_seed(&mut r, &mut s, nft, &c, scenario.ctx());
        assert!(s.growth_points == 24 && s.watering_streak == 2, 953);
        step1_drop_seed(s);
        let _ = destroy_test_registry(r); clock::destroy_for_testing(c);
        scenario.next_tx(@0xA);
        let returned = scenario.take_from_sender<canonical_fixture::collection::NFT>();
        assert!(object::id(&returned) == nft_id, 954);
        canonical_fixture::collection::destroy(returned);
        scenario.end();
    }

    #[test, expected_failure(abort_code = E_LEGACY_ROUTE_DISABLED)]
    fun step2_free_sapling_route_is_disabled() {
        let mut ctx = tx_context::new_from_hint(@0xA, 72, 0, 0, 0);
        mint_sapling(b"fake access", &mut ctx);
    }

    #[test, expected_failure(abort_code = E_LEGACY_ROUTE_DISABLED)]
    fun step2_admin_promo_route_cannot_issue_reward_tools() {
        let (r, s, c, mut ctx) = step1_setup();
        let cap = test_admin_cap(&mut ctx);
        send_promo_crate(&cap, &r, @0xA, 4, &mut ctx);
        destroy_test_admin_cap(cap); step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_WRONG_PAYMENT)]
    fun step2_cheap_testing_price_cannot_buy_season1_crate() {
        let (mut r, s, c, mut ctx) = step1_setup();
        let payment = coin::mint_for_testing<SUI>(10_000_000, &mut ctx);
        buy_crate(&mut r, 0, payment, &mut ctx);
        step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_WRONG_PAYMENT)]
    fun step2_cheap_testing_price_cannot_buy_partner_chest() {
        let (mut r, s, c, mut ctx) = step1_setup();
        let payment = coin::mint_for_testing<SUI>(10_000_000, &mut ctx);
        buy_boom_chest(&mut r, payment, &mut ctx);
        step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_WRONG_PAYMENT)]
    fun step2_cheap_testing_supply_payment_is_rejected() {
        let (mut r, s, c, mut ctx) = step1_setup();
        let payment = coin::mint_for_testing<SUI>(20_000_000, &mut ctx);
        buy_supply_drop(&mut r, 4, payment, &mut ctx);
        step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_UNPAID_ITEM)]
    fun step2_missing_paid_receipt_rejects_tool_before_points() {
        let (mut r, mut s, mut c, mut ctx) = step1_setup();
        clock::set_for_testing(&mut c, 1);
        let mut tool = step1_tool(&mut r, b"growth_tonic", 1, &mut ctx);
        tool.origin.receipt_id = object::id_from_address(@0xBAD);
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        step1_drop_tool(tool); step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_FOREIGN_REGISTRY)]
    fun step2_foreign_registry_tool_is_rejected() {
        let (mut r, mut s, mut c, mut ctx) = step1_setup();
        clock::set_for_testing(&mut c, 1);
        let mut tool = step1_tool(&mut r, b"growth_tonic", 1, &mut ctx);
        tool.origin.registry_id = object::id_from_address(@0xBAD);
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        step1_drop_tool(tool); step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_ECONOMY_VERSION)]
    fun step2_test_economy_item_cannot_be_promoted_by_transfer() {
        let (mut r, mut s, mut c, mut ctx) = step1_setup();
        clock::set_for_testing(&mut c, 1);
        let mut tool = step1_tool(&mut r, b"growth_tonic", 1, &mut ctx);
        tool.origin.economy_version = 0;
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        step1_drop_tool(tool); step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_UNPAID_ITEM)]
    fun step2_zero_value_receipt_cannot_authorize_a_tool() {
        let (mut r, mut s, mut c, mut ctx) = step1_setup();
        clock::set_for_testing(&mut c, 1);
        let mut tool = step1_tool(&mut r, b"growth_tonic", 1, &mut ctx);
        table::borrow_mut(&mut r.paid_receipts, tool.origin.receipt_id).paid_mist = 0;
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        step1_drop_tool(tool); step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_RECEIPT_REPLAY)]
    fun step2_receipt_cannot_be_recorded_twice() {
        let (mut r, s, c, mut ctx) = step1_setup();
        let tool = step1_tool(&mut r, b"growth_tonic", 1, &mut ctx);
        let _ = record_paid_receipt(&mut r, tool.origin.receipt_id, 0, crate_price(0), true, @0xA);
        step1_drop_tool(tool); step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_RECEIPT_REPLAY)]
    fun step2_opened_crate_receipt_cannot_be_redeemed_twice() {
        let (mut r, s, c, mut ctx) = step1_setup();
        let crate_obj = step2_crate(&mut r, 0, &mut ctx);
        consume_crate_receipt(&mut r, &crate_obj);
        consume_crate_receipt(&mut r, &crate_obj);
        step2_destroy_crate(crate_obj); step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_RECEIPT_PRODUCT)]
    fun step2_seedling_receipt_cannot_open_mythic_crate() {
        let (mut r, s, c, mut ctx) = step1_setup();
        let mut crate_obj = step2_crate(&mut r, 0, &mut ctx);
        crate_obj.tier = 4;
        consume_crate_receipt(&mut r, &crate_obj);
        step2_destroy_crate(crate_obj); step1_finish(r, s, c);
    }

    #[test, expected_failure(abort_code = E_UNPAID_ITEM)]
    fun step2_unopened_crate_cannot_back_an_applicable_tool() {
        let (mut r, mut s, mut c, mut ctx) = step1_setup();
        clock::set_for_testing(&mut c, 1);
        let crate_obj = step2_crate(&mut r, 0, &mut ctx);
        let mut tool = step1_tool(&mut r, b"growth_tonic", 1, &mut ctx);
        tool.origin = crate_obj.origin;
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        step2_destroy_crate(crate_obj); step1_drop_tool(tool); step1_finish(r, s, c);
    }

    #[test]
    fun step2_paid_crate_records_exact_price_and_pool_allocation() {
        let mut scenario = sui::test_scenario::begin(@0xA);
        let mut r = test_registry(@0xA, 1, scenario.ctx());
        let initial = balance::value(&r.reward_pool);
        let coin = coin::mint_for_testing<SUI>(25_000_000_000, scenario.ctx());
        buy_crate(&mut r, 3, coin, scenario.ctx());
        assert!(balance::value(&r.reward_pool) == initial + 17_500_000_000, 955);
        scenario.next_tx(@0xA);
        let crate_obj = scenario.take_from_sender<Crate>();
        let rec = validate_origin(&r, &crate_obj.origin);
        assert!(rec.product == 3 && rec.paid_mist == 25_000_000_000 && !rec.opened, 956);
        consume_crate_receipt(&mut r, &crate_obj);
        assert!(validate_origin(&r, &crate_obj.origin).opened, 957);
        step2_destroy_crate(crate_obj); let _ = destroy_test_registry(r); scenario.end();
    }

    #[test]
    fun step2_referral_payment_and_issuance_remain_consistent() {
        let mut scenario = sui::test_scenario::begin(@0xA);
        let mut r = test_registry(@0xA, 1, scenario.ctx());
        table::add(&mut r.referrers, @0xA, @0xB);
        let initial = balance::value(&r.reward_pool);
        let coin = coin::mint_for_testing<SUI>(25_000_000_000, scenario.ctx());
        buy_crate(&mut r, 3, coin, scenario.ctx());
        assert!(balance::value(&r.reward_pool) == initial + 17_325_000_000, 958);
        assert!(*table::borrow(&r.referral_earnings, @0xB) == 250_000_000, 959);
        scenario.next_tx(@0xA);
        let crate_obj = scenario.take_from_sender<Crate>();
        assert!(validate_origin(&r, &crate_obj.origin).paid_mist == 25_000_000_000, 960);
        step2_destroy_crate(crate_obj); let _ = destroy_test_registry(r); scenario.end();
    }

    #[test]
    fun step2_real_open_path_mints_tools_with_paid_provenance() {
        let mut scenario = sui::test_scenario::begin(@0x0);
        random::create_for_testing(scenario.ctx());
        scenario.next_tx(@0xA);
        let mut r = test_registry(@0xA, 1, scenario.ctx());
        let payment = coin::mint_for_testing<SUI>(crate_price(0), scenario.ctx());
        buy_crate(&mut r, 0, payment, scenario.ctx());
        scenario.next_tx(@0xA);
        let crate_obj = scenario.take_from_sender<Crate>();
        let receipt = crate_obj.origin.receipt_id;
        let rng = scenario.take_shared<Random>();
        open_crate(&mut r, crate_obj, &rng, scenario.ctx());
        sui::test_scenario::return_shared(rng);
        scenario.next_tx(@0xA);
        let tool = scenario.take_from_sender<Tool>();
        assert_tool_origin(&r, &tool);
        assert!(tool.charges == 2 && tool.origin.receipt_id == receipt, 961);
        step1_drop_tool(tool); let _ = destroy_test_registry(r); scenario.end();
    }

    #[test]
    fun step2_paid_tool_transfer_retains_receipt_and_uses() {
        let mut scenario = sui::test_scenario::begin(@0xA);
        let mut r = test_registry(@0xA, 1, scenario.ctx());
        let payment = coin::mint_for_testing<SUI>(SUPPLY_PRICE_WATERING_BOOST, scenario.ctx());
        buy_supply_drop(&mut r, 4, payment, scenario.ctx());
        scenario.next_tx(@0xA);
        let tool = scenario.take_from_sender<Tool>();
        let receipt = tool.origin.receipt_id;
        transfer::public_transfer(tool, @0xB);
        scenario.next_tx(@0xB);
        let transferred = scenario.take_from_sender<Tool>();
        assert_tool_origin(&r, &transferred);
        assert!(transferred.charges == 1 && transferred.origin.receipt_id == receipt, 962);
        step1_drop_tool(transferred); let _ = destroy_test_registry(r); scenario.end();
    }

    #[test, expected_failure(abort_code = E_MAX_ACTIVE_SEEDS)]
    fun step2_ninth_active_seed_is_rejected() {
        let (mut r, s, c, _) = step1_setup();
        let mut i = 0;
        while (i < 9) { reserve_active_seed(&mut r, @0xA); i = i + 1; };
        step1_finish(r, s, c);
    }

    #[test]
    fun step2_active_count_resets_for_new_season_not_line_history() {
        let (mut r, s, c, _) = step1_setup();
        let mut i = 0;
        while (i < 8) { reserve_active_seed(&mut r, @0xA); i = i + 1; };
        release_active_seed(&mut r, @0xA);
        reserve_active_seed(&mut r, @0xA);
        r.current_season_id = 2;
        reserve_active_seed(&mut r, @0xA);
        assert!(table::borrow(&r.active_seed_counts, @0xA).count == 1, 963);
        step1_finish(r, s, c);
    }

    #[test]
    fun step2_partner_table_boundaries_and_uses_match_evidence() {
        let mut roll = 0;
        let mut hearts = 0;
        let mut cans = 0;
        while (roll < 100) {
            let boom = partner_items(5, roll);
            let victory = partner_items(6, roll);
            assert!(vector::length(&boom) == 4 && vector::length(&victory) == 4, 964);
            assert!(boom[0].kind == ITEM_ANCIENT_BARK && boom[0].uses == 1, 965);
            assert!(boom[1].kind == ITEM_SUNSTONE && boom[1].uses == 1, 966);
            assert!(boom[2].kind == ITEM_DOUBLE_DOSE && boom[2].uses == 2, 967);
            if (boom[3].kind == ITEM_FOREST_HEART) { hearts = hearts + 1; assert!(boom[3].uses == 1, 968); }
            else { assert!(boom[3].kind == ITEM_GROWTH_TONIC && boom[3].uses == 2, 969); };
            assert!(victory[0].kind == ITEM_DROUGHT_SHIELD && victory[0].uses == 2, 970);
            assert!(victory[1].kind == ITEM_RAIN_BARREL && victory[1].uses == 2, 971);
            assert!(victory[2].kind == ITEM_MULCH && victory[2].uses == 2, 972);
            if (victory[3].kind == ITEM_BOTTOMLESS_CAN) { cans = cans + 1; }
            else { assert!(victory[3].kind == ITEM_REVIVAL_KIT, 973); };
            assert!(victory[3].uses == 1, 974);
            roll = roll + 1;
        };
        assert!(hearts == 10 && cans == 25, 975);
    }

    #[test, expected_failure(abort_code = E_RULES_VERSION)]
    fun step2_retired_registry_cannot_issue_new_crates() {
        let (mut r, s, c, mut ctx) = step1_setup();
        r.rules_version = 2;
        let payment = coin::mint_for_testing<SUI>(crate_price(0), &mut ctx);
        buy_crate(&mut r, 0, payment, &mut ctx);
        step1_finish(r, s, c);
    }

    // Public only under test compilation. Attack fixtures use these typed
    // signatures to prove old nominal types cannot cross the new boundary.
    #[test_only] public fun step2_type_tool(_value: &Tool) {}
    #[test_only] public fun step2_type_crate(_value: &Crate) {}
    #[test_only] public fun step2_type_seed(_value: &Seed) {}
    #[test_only] public fun step2_type_registry(_value: &Registry) {}
