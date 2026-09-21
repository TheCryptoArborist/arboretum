    #[test_only]
    fun step3_setup(rank: u8, tier: u8, choice: u8): (Registry, Seed, Tool, Crate, Clock, TxContext) {
        let (mut r, s, c, mut ctx) = step1_setup();
        let payment = coin::mint_for_testing<SUI>(crate_price(tier), &mut ctx);
        let crate_obj = make_paid_crate(&mut r, tier, payment, true, &mut ctx);
        let tool = issue_holder_tool(&mut r, crate_obj.origin, s.sapling_id, rank, choice, &mut ctx);
        (r, s, tool, crate_obj, c, ctx)
    }
    #[test_only]
    fun step3_finish(r: Registry, s: Seed, tool: Tool, crate_obj: Crate, c: Clock) {
        step1_drop_seed(s); step1_drop_tool(tool); step2_destroy_crate(crate_obj);
        let (_, _) = destroy_test_registry(r); clock::destroy_for_testing(c);
    }
    #[test_only]
    fun step3_labels(): vector<vector<u8>> { vector[b"Common", b"Rare", b"Epic", b"Legendary", b"Mythic", b"One of One"] }

    #[test]
    fun step3_all_twelve_default_grants_have_exact_uses_and_value() {
        let mut rank = 0;
        while (rank < 6) {
            let mut tier = 3;
            while (tier <= 4) {
                let (r, s, tool, crate_obj, c, _) = step3_setup(rank, tier, 0);
                assert!(tool.charges == 1 && tool.holder_waterings == (rank + 1) * (if (tier == 4) 2 else 1), 1000);
                assert_tool_origin(&r, &tool);
                assert!(!validate_origin(&r, &tool.origin).opened, 1001);
                assert!(receipt_has_holder(&r, crate_obj.origin.receipt_id), 1002);
                step3_finish(r, s, tool, crate_obj, c);
                tier = tier + 1;
            };
            rank = rank + 1;
        };
    }
    #[test]
    fun step3_equal_spending_has_equal_default_boost_budget() {
        let mut rank = 0;
        while (rank < 6) {
            assert!(2 * holder_waterings(rank, 3) == holder_waterings(rank, 4), 1003);
            rank = rank + 1;
        };
        assert!(2 * crate_price(3) == crate_price(4), 1004);
    }
    #[test]
    fun step3_all_six_onchain_labels_decode_and_quote_correctly() {
        let (r, s, c, mut ctx) = step1_setup();
        let labels = step3_labels(); let mut rank = 0;
        while (rank < 6) {
            let nft = canonical_fixture::collection::make_with_rarity(*vector::borrow(&labels, rank as u64), &mut ctx);
            assert!(nftree_holder_rank(&nft) == rank, 1005);
            let (rr, boosts, price, miracle, dose) = quote_holder_bonus(&r, &nft, 4);
            assert!(rr == rank && boosts == 2 * (rank + 1) && price == 50_000_000_000, 1006);
            assert!(miracle && dose == (boosts >= 5), 1007);
            canonical_fixture::collection::destroy(nft); rank = rank + 1;
        };
        step1_finish(r, s, c);
    }
    #[test]
    fun step3_rarity_comes_from_rarity_field_not_name_or_description() {
        let (r, s, c, mut ctx) = step1_setup();
        let nft = canonical_fixture::collection::make_with_fields(b"Mythic One of One", b"rarity: Mythic", b"https://example.test/Mythic", b"Common", &mut ctx);
        assert!(nftree_holder_rank(&nft) == 0, 1008);
        canonical_fixture::collection::destroy(nft); step1_finish(r, s, c);
    }
    #[test]
    fun step3_decoder_handles_multibyte_lengths_before_rarity() {
        let (r, s, c, mut ctx) = step1_setup();
        let mut long = vector[]; let mut i = 0;
        while (i < 300) { vector::push_back(&mut long, 65); i = i + 1; };
        let nft = canonical_fixture::collection::make_with_fields(long, long, long, b"Mythic", &mut ctx);
        assert!(nftree_holder_rank(&nft) == 4, 1009);
        canonical_fixture::collection::destroy(nft); step1_finish(r, s, c);
    }
    #[test]
    fun step3_known_case_and_oneofone_aliases_are_explicit() {
        assert!(holder_rank_from_label(b"MYTHIC") == 4 && holder_rank_from_label(b"rare") == 1, 1010);
        assert!(holder_rank_from_label(b"1/1") == 5 && holder_rank_from_label(b"One-of-One") == 5 && holder_rank_from_label(b"1 of 1") == 5, 1011);
    }
    #[test, expected_failure(abort_code = E_UNKNOWN_RARITY)]
    fun step3_unknown_label_is_not_silently_common() { let _ = holder_rank_from_label(b"Uncommon"); }
    #[test, expected_failure(abort_code = E_UNKNOWN_RARITY)]
    fun step3_fuzzy_mythic_text_cannot_upgrade_rank() { let _ = holder_rank_from_label(b"not Mythic"); }
    #[test, expected_failure(abort_code = E_NOT_CANONICAL_NFTREE)]
    fun step3_counterfeit_collection_rejected_before_decoding() {
        let (r, s, c, mut ctx) = step1_setup();
        let nft = fake_fixture::collection::make(&mut ctx);
        let _ = quote_holder_bonus(&r, &nft, 4);
        fake_fixture::collection::destroy(nft); step1_finish(r, s, c);
    }
    #[test]
    fun step3_miracle_and_double_dose_thresholds() {
        let mut count = 1;
        while (count <= 12) {
            assert_holder_choice(count, 0);
            if (count >= 2) assert_holder_choice(count, 1);
            if (count >= 5) assert_holder_choice(count, 2);
            count = count + 1;
        };
    }
    #[test, expected_failure(abort_code = E_HOLDER_CHOICE)]
    fun step3_common_ancient_cannot_choose_miracle() { assert_holder_choice(1, 1); }
    #[test, expected_failure(abort_code = E_HOLDER_CHOICE)]
    fun step3_four_boost_budget_cannot_choose_double_dose() { assert_holder_choice(4, 2); }
    #[test, expected_failure(abort_code = E_HOLDER_CHOICE)]
    fun step3_unknown_choice_rejected() { assert_holder_choice(12, 3); }
    #[test, expected_failure(abort_code = E_HOLDER_TIER)]
    fun step3_seedling_is_not_a_holder_product() { let _ = holder_waterings(5, 0); }
    #[test, expected_failure(abort_code = E_HOLDER_TIER)]
    fun step3_partner_chest_is_not_a_holder_product() { let _ = holder_waterings(5, 5); }

    #[test]
    fun step3_public_checkout_returns_same_nft_and_one_tool() {
        let mut tx = sui::test_scenario::begin(@0xA);
        let mut r = test_registry(@0xA, 1, tx.ctx());
        let mut c = clock::create_for_testing(tx.ctx()); clock::set_for_testing(&mut c, 1);
        let nft = canonical_fixture::collection::make_with_rarity(b"Mythic", tx.ctx());
        let nft_id = object::id(&nft); let nft_before = sui::bcs::to_bytes(&nft);
        let payment = coin::mint_for_testing<SUI>(27_000_000_000, tx.ctx());
        let pool_before = balance::value(&r.reward_pool);
        buy_crate_with_holder(&mut r, nft, 3, 0, payment, &c, tx.ctx());
        assert!(balance::value(&r.reward_pool) == pool_before + 17_500_000_000, 1012);
        tx.next_tx(@0xA);
        assert!(vector::length(&sui::test_scenario::ids_for_address<Tool>(@0xA)) == 1, 1013);
        let nft = tx.take_from_sender<canonical_fixture::collection::NFT>();
        assert!(object::id(&nft) == nft_id && sui::bcs::to_bytes(&nft) == nft_before, 1014);
        let tool = tx.take_from_sender<Tool>(); let crate_obj = tx.take_from_sender<Crate>();
        assert!(tool.charges == 1 && tool.holder_waterings == 5 && tool.origin.receipt_id == crate_obj.origin.receipt_id, 1015);
        assert_tool_origin(&r, &tool);
        let change = tx.take_from_sender<Coin<SUI>>(); assert!(coin::value(&change) == 2_000_000_000, 1016); coin::burn_for_testing(change);
        let dev = tx.take_from_address<Coin<SUI>>(DEV_FEE_WALLET); assert!(coin::value(&dev) == 500_000_000, 1017); coin::burn_for_testing(dev);
        let treasury = tx.take_from_address<Coin<SUI>>(TREASURY_WALLET); assert!(coin::value(&treasury) == 7_000_000_000, 1018); coin::burn_for_testing(treasury);
        step1_drop_tool(tool);step2_destroy_crate(crate_obj);canonical_fixture::collection::destroy(nft);
        let (_, _) = destroy_test_registry(r);clock::destroy_for_testing(c);tx.end();
    }
    #[test]
    fun step3_holder_referral_payment_is_unchanged() {
        let mut tx = sui::test_scenario::begin(@0xA);
        let mut r = test_registry(@0xA, 1, tx.ctx());table::add(&mut r.referrers, @0xA, @0xB);
        let mut c = clock::create_for_testing(tx.ctx());clock::set_for_testing(&mut c, 1);
        let nft = canonical_fixture::collection::make_with_rarity(b"Rare", tx.ctx());
        let payment = coin::mint_for_testing<SUI>(25_000_000_000, tx.ctx());let before = balance::value(&r.reward_pool);
        buy_crate_with_holder(&mut r, nft, 3, 1, payment, &c, tx.ctx());
        assert!(balance::value(&r.reward_pool) == before + 17_325_000_000, 1019);
        assert!(*table::borrow(&r.referral_earnings, @0xB) == 250_000_000, 1020);
        tx.next_tx(@0xA);let tool = tx.take_from_sender<Tool>();
        assert!(*string::as_bytes(&tool.kind) == b"miracle_grow" && tool.charges == 1 && tool.holder_waterings == 0, 1021);
        step1_drop_tool(tool);step2_destroy_crate(tx.take_from_sender<Crate>());
        canonical_fixture::collection::destroy(tx.take_from_sender<canonical_fixture::collection::NFT>());
        let (_, _) = destroy_test_registry(r);clock::destroy_for_testing(c);tx.end();
    }
    #[test]
    fun step3_batch_three_paid_crates_produce_three_unique_grants() {
        let mut tx = sui::test_scenario::begin(@0xA);let mut r = test_registry(@0xA, 1, tx.ctx());
        let mut c = clock::create_for_testing(tx.ctx());clock::set_for_testing(&mut c, 1);
        let nft = canonical_fixture::collection::make_with_rarity(b"Legendary", tx.ctx());
        let payment = coin::mint_for_testing<SUI>(77_000_000_000, tx.ctx());let before = balance::value(&r.reward_pool);
        buy_holder_crates(&mut r, nft, 3, 0, 3, payment, &c, tx.ctx());
        assert!(balance::value(&r.reward_pool) == before + 52_500_000_000, 1022);
        tx.next_tx(@0xA);
        assert!(vector::length(&sui::test_scenario::ids_for_address<Tool>(@0xA)) == 3 && vector::length(&sui::test_scenario::ids_for_address<Crate>(@0xA)) == 3, 1023);
        let mut receipts = vector[];let mut i = 0;
        while (i < 3) {
            let tool = tx.take_from_sender<Tool>();assert_tool_origin(&r, &tool);
            assert!(tool.holder_waterings == 4 && !vector::contains(&receipts, &tool.origin.receipt_id), 1024);
            vector::push_back(&mut receipts, tool.origin.receipt_id);step1_drop_tool(tool);
            step2_destroy_crate(tx.take_from_sender<Crate>());i = i + 1;
        };
        let change = tx.take_from_sender<Coin<SUI>>();assert!(coin::value(&change) == 2_000_000_000, 1025);coin::burn_for_testing(change);
        canonical_fixture::collection::destroy(tx.take_from_sender<canonical_fixture::collection::NFT>());
        let (_, _) = destroy_test_registry(r);clock::destroy_for_testing(c);tx.end();
    }
    #[test, expected_failure(abort_code = E_WRONG_PAYMENT)]
    fun step3_test_price_cannot_obtain_holder_bonus() {
        let (mut r, s, mut c, mut ctx) = step1_setup();clock::set_for_testing(&mut c, 1);
        let nft = canonical_fixture::collection::make_with_rarity(b"Mythic", &mut ctx);
        let payment = coin::mint_for_testing<SUI>(10_000_000, &mut ctx);
        buy_crate_with_holder(&mut r, nft, 3, 0, payment, &c, &mut ctx);step1_finish(r, s, c);
    }
    #[test, expected_failure(abort_code = E_HOLDER_BATCH)]
    fun step3_zero_batch_cannot_issue_item() {
        let (mut r, s, mut c, mut ctx) = step1_setup();clock::set_for_testing(&mut c, 1);
        let nft = canonical_fixture::collection::make(&mut ctx);let payment = coin::zero<SUI>(&mut ctx);
        buy_holder_crates(&mut r, nft, 3, 0, 0, payment, &c, &mut ctx);step1_finish(r, s, c);
    }
    #[test, expected_failure(abort_code = E_HOLDER_BATCH)]
    fun step3_batch_size_guard_precedes_payment() {
        let (mut r, s, mut c, mut ctx) = step1_setup();clock::set_for_testing(&mut c, 1);
        let nft = canonical_fixture::collection::make(&mut ctx);let payment = coin::zero<SUI>(&mut ctx);
        buy_holder_crates(&mut r, nft, 3, 0, 9, payment, &c, &mut ctx);step1_finish(r, s, c);
    }
    #[test, expected_failure(abort_code = E_SEASON_ENDED)]
    fun step3_holder_purchase_rejected_at_season_cutoff() {
        let (mut r, s, mut c, mut ctx) = step1_setup();clock::set_for_testing(&mut c, 1 + SEASON_DURATION_MS);
        let nft = canonical_fixture::collection::make(&mut ctx);let payment = coin::mint_for_testing<SUI>(25_000_000_000, &mut ctx);
        buy_crate_with_holder(&mut r, nft, 3, 0, payment, &c, &mut ctx);step1_finish(r, s, c);
    }
    #[test, expected_failure(abort_code = E_PAUSED)]
    fun step3_paused_registry_cannot_sell_holder_crate() {
        let (mut r, s, mut c, mut ctx) = step1_setup();r.paused = true;clock::set_for_testing(&mut c, 1);
        let nft = canonical_fixture::collection::make(&mut ctx);let payment = coin::mint_for_testing<SUI>(25_000_000_000, &mut ctx);
        buy_crate_with_holder(&mut r, nft, 3, 0, payment, &c, &mut ctx);step1_finish(r, s, c);
    }
    #[test, expected_failure(abort_code = E_HOLDER_REPLAY)]
    fun step3_same_receipt_cannot_grant_twice() {
        let (mut r, s, tool, crate_obj, c, mut ctx) = step3_setup(4, 3, 0);
        let extra = issue_holder_tool(&mut r, crate_obj.origin, s.sapling_id, 4, 0, &mut ctx);
        step1_drop_tool(extra);step3_finish(r, s, tool, crate_obj, c);
    }
    #[test, expected_failure(abort_code = E_HOLDER_RECEIPT)]
    fun step3_ordinary_purchase_cannot_be_retroactively_claimed() {
        let (mut r, s, c, mut ctx) = step1_setup();let payment = coin::mint_for_testing<SUI>(25_000_000_000, &mut ctx);
        let crate_obj = make_paid_crate(&mut r, 3, payment, false, &mut ctx);
        let tool = issue_holder_tool(&mut r, crate_obj.origin, s.sapling_id, 4, 0, &mut ctx);step3_finish(r, s, tool, crate_obj, c);
    }
    #[test, expected_failure(abort_code = E_HOLDER_RECEIPT)]
    fun step3_receipt_cannot_be_granted_to_another_buyer() {
        let (mut r, s, c, mut ctx) = step1_setup();let payment = coin::mint_for_testing<SUI>(25_000_000_000, &mut ctx);
        let crate_obj = make_paid_crate(&mut r, 3, payment, true, &mut ctx);
        let mut other = tx_context::new_from_hint(@0xB, 78, 0, 0, 0);
        let tool = issue_holder_tool(&mut r, crate_obj.origin, s.sapling_id, 4, 0, &mut other);step3_finish(r, s, tool, crate_obj, c);
    }
    #[test]
    fun step3_holder_boost_is_usable_before_opening_but_adds_no_instant_gp() {
        let (mut r, mut s, mut tool, crate_obj, mut c, ctx) = step3_setup(4, 4, 0);
        clock::set_for_testing(&mut c, 1 + POINT_INTERVAL_MS);
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        assert!(s.growth_points == 134 && s.fertilizer_charges == 10 && tool.charges == 0, 1026);
        water_seed_checked(&mut r, &mut s, &c, &ctx);
        assert!(s.growth_points == 155 && s.fertilizer_charges == 9, 1027);
        step3_finish(r, s, tool, crate_obj, c);
    }
    #[test]
    fun step3_holder_boost_adds_queue_not_a_higher_multiplier() {
        let (mut r, mut s, mut tool, crate_obj, mut c, ctx) = step3_setup(5, 4, 0);
        s.fertilizer_charges = 5;clock::set_for_testing(&mut c, 1 + POINT_INTERVAL_MS);
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        assert!(s.fertilizer_charges == 17, 1028);water_seed_checked(&mut r, &mut s, &c, &ctx);
        assert!(s.growth_points == 155 && s.fertilizer_charges == 16, 1029);step3_finish(r, s, tool, crate_obj, c);
    }
    #[test]
    fun step3_selected_double_dose_has_normal_effect_and_one_use() {
        let (mut r, mut s, mut tool, crate_obj, mut c, ctx) = step3_setup(4, 3, 2);
        clock::set_for_testing(&mut c, 1 + POINT_INTERVAL_MS);apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        water_seed_checked(&mut r, &mut s, &c, &ctx);
        assert!(tool.charges == 0 && s.growth_points == 176 && s.fertilizer_charges == 1 && !s.miracle_grow_applied, 1030);
        step3_finish(r, s, tool, crate_obj, c);
    }
    #[test, expected_failure(abort_code = E_NO_TOOL_CHARGES)]
    fun step3_consumed_holder_tool_cannot_apply_twice() {
        let (mut r, mut s, mut tool, crate_obj, mut c, ctx) = step3_setup(4, 4, 0);
        clock::set_for_testing(&mut c, 1);apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);step3_finish(r, s, tool, crate_obj, c);
    }
    #[test, expected_failure(abort_code = E_BOOST_QUEUE_FULL)]
    fun step3_holder_tool_cannot_overflow_queue() {
        let (mut r, mut s, mut tool, crate_obj, mut c, ctx) = step3_setup(5, 4, 0);
        s.fertilizer_charges = 250;clock::set_for_testing(&mut c, 1);
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);step3_finish(r, s, tool, crate_obj, c);
    }
    #[test, expected_failure(abort_code = E_DOUBLE_ALREADY_QUEUED)]
    fun step3_alternative_respects_existing_double_guard() {
        let (mut r, mut s, mut tool, crate_obj, mut c, ctx) = step3_setup(4, 3, 2);
        s.miracle_grow_applied = true;clock::set_for_testing(&mut c, 1);
        apply_tool_checked(&mut r, &mut s, &mut tool, &c, &ctx);step3_finish(r, s, tool, crate_obj, c);
    }
    #[test, expected_failure(abort_code = E_HOLDER_ITEM)]
    fun step3_tampered_watering_count_does_not_match_paid_receipt() {
        let (r, s, mut tool, crate_obj, c, _) = step3_setup(0, 3, 0);tool.holder_waterings = 12;
        assert_tool_origin(&r, &tool);step3_finish(r, s, tool, crate_obj, c);
    }
    #[test, expected_failure(abort_code = E_HOLDER_ITEM)]
    fun step3_tampered_holder_uses_rejected() {
        let (r, s, mut tool, crate_obj, c, _) = step3_setup(4, 3, 0);tool.charges = 2;
        assert_tool_origin(&r, &tool);step3_finish(r, s, tool, crate_obj, c);
    }
    #[test, expected_failure(abort_code = E_HOLDER_ITEM)]
    fun step3_normal_item_cannot_impersonate_holder_boost() {
        let (mut r, s, c, mut ctx) = step1_setup();let mut tool = step1_tool(&mut r, b"watering_boost", 1, &mut ctx);
        tool.kind = string::utf8(b"holder_growth_boost");tool.holder_waterings = 12;
        assert_tool_origin(&r, &tool);step1_drop_tool(tool);step1_finish(r, s, c);
    }
    #[test, expected_failure(abort_code = E_FOREIGN_REGISTRY)]
    fun step3_holder_item_cannot_move_between_registries() {
        let (r, s, tool, crate_obj, c, mut ctx) = step3_setup(4, 3, 0);let other = test_registry(@0xA, 1, &mut ctx);
        assert_tool_origin(&other, &tool);let (_, _) = destroy_test_registry(other);step3_finish(r, s, tool, crate_obj, c);
    }
    #[test]
    fun step3_opening_keeps_same_grant_and_never_mints_it_again() {
        let mut tx = sui::test_scenario::begin(@0x0);random::create_for_testing(tx.ctx());tx.next_tx(@0xA);
        let mut r = test_registry(@0xA, 1, tx.ctx());let mut c = clock::create_for_testing(tx.ctx());clock::set_for_testing(&mut c, 1);
        let nft = canonical_fixture::collection::make_with_rarity(b"Mythic", tx.ctx());
        let payment = coin::mint_for_testing<SUI>(25_000_000_000, tx.ctx());
        buy_crate_with_holder(&mut r, nft, 3, 0, payment, &c, tx.ctx());tx.next_tx(@0xA);
        let holder = tx.take_from_sender<Tool>();let holder_id = object::id(&holder);step1_drop_tool(holder);
        let crate_obj = tx.take_from_sender<Crate>();let receipt_id = crate_obj.origin.receipt_id;
        let rng = tx.take_shared<Random>();open_crate(&mut r, crate_obj, &rng, tx.ctx());sui::test_scenario::return_shared(rng);
        tx.next_tx(@0xA);
        let ids = sui::test_scenario::ids_for_address<Tool>(@0xA);assert!(vector::length(&ids) >= 5 && vector::length(&ids) <= 6, 1031);
        let mut i = 0;
        while (i < vector::length(&ids)) {
            let tool = tx.take_from_address_by_id<Tool>(@0xA, *vector::borrow(&ids, i));
            assert_tool_origin(&r, &tool);assert!(tool.holder_waterings == 0 && *string::as_bytes(&tool.kind) != b"holder_growth_boost", 1032);
            step1_drop_tool(tool);i = i + 1;
        };
        let receipt = table::borrow(&r.paid_receipts, receipt_id);
        assert!(receipt.opened && *option::borrow(&receipt.holder_tool_id) == holder_id, 1033);
        canonical_fixture::collection::destroy(tx.take_from_sender<canonical_fixture::collection::NFT>());
        let (_, _) = destroy_test_registry(r);clock::destroy_for_testing(c);tx.end();
    }
    #[test]
    fun step3_selling_nft_preserves_old_tool_and_new_owner_gets_only_new_purchase() {
        let mut tx = sui::test_scenario::begin(@0xA);let mut r = test_registry(@0xA, 1, tx.ctx());
        let mut c = clock::create_for_testing(tx.ctx());clock::set_for_testing(&mut c, 1);
        let nft = canonical_fixture::collection::make_with_rarity(b"One of One", tx.ctx());let id = object::id(&nft);
        let payment = coin::mint_for_testing<SUI>(25_000_000_000, tx.ctx());buy_crate_with_holder(&mut r, nft, 3, 0, payment, &c, tx.ctx());
        tx.next_tx(@0xA);let nft = tx.take_from_sender<canonical_fixture::collection::NFT>();transfer::public_transfer(nft, @0xB);
        tx.next_tx(@0xB);let nft = tx.take_from_sender<canonical_fixture::collection::NFT>();assert!(object::id(&nft) == id, 1034);
        let payment = coin::mint_for_testing<SUI>(50_000_000_000, tx.ctx());buy_crate_with_holder(&mut r, nft, 4, 0, payment, &c, tx.ctx());
        tx.next_tx(@0xB);let b = tx.take_from_sender<Tool>();let a = tx.take_from_address<Tool>(@0xA);
        assert_tool_origin(&r, &a);assert_tool_origin(&r, &b);assert!(a.holder_waterings == 6 && b.holder_waterings == 12 && a.origin.receipt_id != b.origin.receipt_id, 1035);
        step1_drop_tool(a);step1_drop_tool(b);step2_destroy_crate(tx.take_from_sender<Crate>());step2_destroy_crate(tx.take_from_address<Crate>(@0xA));
        canonical_fixture::collection::destroy(tx.take_from_sender<canonical_fixture::collection::NFT>());
        let (_, _) = destroy_test_registry(r);clock::destroy_for_testing(c);tx.end();
    }
    #[test]
    fun step3_bonus_tool_transfer_keeps_paid_identity_and_uses() {
        let mut tx = sui::test_scenario::begin(@0xA);let mut r = test_registry(@0xA, 1, tx.ctx());
        let mut c = clock::create_for_testing(tx.ctx());clock::set_for_testing(&mut c, 1);
        let nft = canonical_fixture::collection::make_with_rarity(b"Mythic", tx.ctx());let payment = coin::mint_for_testing<SUI>(25_000_000_000, tx.ctx());
        buy_crate_with_holder(&mut r, nft, 3, 0, payment, &c, tx.ctx());tx.next_tx(@0xA);
        let tool = tx.take_from_sender<Tool>();let id = object::id(&tool);transfer::public_transfer(tool, @0xB);tx.next_tx(@0xB);
        let tool = tx.take_from_sender<Tool>();assert_tool_origin(&r, &tool);assert!(object::id(&tool) == id && tool.holder_waterings == 5 && tool.charges == 1, 1036);
        step1_drop_tool(tool);step2_destroy_crate(tx.take_from_address<Crate>(@0xA));canonical_fixture::collection::destroy(tx.take_from_address<canonical_fixture::collection::NFT>(@0xA));
        let (_, _) = destroy_test_registry(r);clock::destroy_for_testing(c);tx.end();
    }
