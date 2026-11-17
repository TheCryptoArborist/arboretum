    // Appended only to an isolated test copy of the production-economy candidate.
    // Imports are supplied once by version-boundary-v2.move.inc. Literal prices
    // below come from the approved decision record, not the candidate constants.
    // Every payment is a synthetic Move VM coin; no wallet or chain is used.

    #[test_only]
    const ECON_START: u64 = 864_000_000;
    #[test_only]
    const ECON_OVERPAYMENT: u64 = 37;

    #[test_only]
    fun econ_registry(ctx: &mut TxContext): Registry {
        let mut registry = test_registry(@0xA, ECON_START, ctx);
        let old_amount = balance::value(&registry.reward_pool);
        let old_balance = balance::split(&mut registry.reward_pool, old_amount);
        assert_eq!(balance::destroy_for_testing(old_balance), 123_456_789);
        registry
    }

    #[test_only]
    fun econ_clock(ctx: &mut TxContext): Clock {
        let mut clock = clock::create_for_testing(ctx);
        clock::set_for_testing(&mut clock, ECON_START);
        clock
    }

    #[test_only]
    fun econ_sapling(ctx: &mut TxContext): Sapling {
        Sapling {
            id: object::new(ctx), version: 2,
            name: string::utf8(b"production economy fixture"),
            cycle_count: 0, total_sui_harvested: 0,
        }
    }

    #[test_only]
    fun econ_assert_coin(scenario: &mut test_scenario::Scenario, recipient: address, expected: u64) {
        scenario.next_tx(recipient);
        let received = scenario.take_from_sender<Coin<SUI>>();
        assert_eq!(coin::value(&received), expected);
        std::unit_test::destroy(received);
    }

    #[test_only]
    fun econ_assert_two_coins(scenario: &mut test_scenario::Scenario, recipient: address, expected: u64) {
        scenario.next_tx(recipient);
        let first = scenario.take_from_sender<Coin<SUI>>();
        let second = scenario.take_from_sender<Coin<SUI>>();
        assert_eq!(coin::value(&first) + coin::value(&second), expected);
        std::unit_test::destroy(first);
        std::unit_test::destroy(second);
    }

    #[test_only]
    fun econ_shop_case(
        scenario: &mut test_scenario::Scenario,
        is_crate: bool, product: u8, price: u64, with_referrer: bool, use_partner_wrapper: bool,
    ) {
        scenario.next_tx(@0xA);
        let mut registry = econ_registry(scenario.ctx());
        let clock = econ_clock(scenario.ctx());
        if (with_referrer) table::add(&mut registry.referrers, @0xA, @0xB);
        let crate_events_before = vector::length(&event::events_by_type<CratePurchased>());
        let drop_events_before = vector::length(&event::events_by_type<SupplyDropPurchased>());
        let referral_events_before = vector::length(&event::events_by_type<ReferralPaid>());
        let payment = coin::mint_for_testing<SUI>(price + ECON_OVERPAYMENT, scenario.ctx());
        if (is_crate) {
            if (use_partner_wrapper) {
                assert!(product == 5 || product == 6);
                if (product == 5) buy_boom_chest(&mut registry, payment, &clock, scenario.ctx())
                else buy_victory_chest(&mut registry, payment, &clock, scenario.ctx());
            } else buy_crate(&mut registry, product, payment, &clock, scenario.ctx());
        } else buy_supply_drop(&mut registry, product, payment, &clock, scenario.ctx());

        let referral = if (with_referrer) price / 100 else 0;
        let routed = price - referral;
        let pool = routed * 70 / 100;
        let developer = routed * 2 / 100;
        let treasury = routed - pool - developer;
        assert_eq!(registry_pool_size(&registry), pool);
        assert_eq!(balance::value(&registry.treasury), 0);
        assert_eq!(registry.total_seeds, 0);
        assert_eq!(registry.eligible_growth_points, 0);
        let referrals = event::events_by_type<ReferralPaid>();
        if (with_referrer) {
            assert_eq!(vector::length(&referrals), referral_events_before + 1);
            let receipt = &referrals[referral_events_before];
            assert_eq!(receipt.referrer, @0xB);
            assert_eq!(receipt.referee, @0xA);
            assert_eq!(receipt.amount_mist, referral);
            assert_eq!(*table::borrow(&registry.referral_earnings, @0xB), referral);
        } else {
            assert_eq!(vector::length(&referrals), referral_events_before);
            assert!(!table::contains(&registry.referral_earnings, @0xB));
        };

        if (is_crate) {
            let receipts = event::events_by_type<CratePurchased>();
            assert_eq!(vector::length(&receipts), crate_events_before + 1);
            assert_eq!(vector::length(&event::events_by_type<SupplyDropPurchased>()), drop_events_before);
            let receipt = &receipts[crate_events_before];
            assert_eq!(receipt.buyer, @0xA);
            assert_eq!(receipt.tier, product);
            let crate_id = receipt.crate_id;
            scenario.next_tx(@0xA);
            let crate_obj = scenario.take_from_sender_by_id<Crate>(crate_id);
            assert_eq!(crate_obj.version, 2);
            assert_eq!(crate_obj.tier, product);
            std::unit_test::destroy(crate_obj);
        } else {
            let receipts = event::events_by_type<SupplyDropPurchased>();
            assert_eq!(vector::length(&receipts), drop_events_before + 1);
            assert_eq!(vector::length(&event::events_by_type<CratePurchased>()), crate_events_before);
            let receipt = &receipts[drop_events_before];
            assert_eq!(receipt.buyer, @0xA);
            assert_eq!(receipt.drop, product);
            assert_eq!(receipt.price_mist, price);
            let kinds = vector[b"revival_kit", b"drought_shield", b"rain_barrel", b"mulch", b"watering_boost"];
            let rarities = vector[2u8, 2, 1, 1, 0];
            let expected_kind = string::utf8(kinds[product as u64]);
            assert_eq!(receipt.tool_kind, expected_kind);
            let tool_id = receipt.tool_id;
            scenario.next_tx(@0xA);
            let tool = scenario.take_from_sender_by_id<Tool>(tool_id);
            assert_eq!(tool.version, 2);
            assert_eq!(tool.kind, expected_kind);
            assert_eq!(tool.charges, 1);
            assert_eq!(tool.rarity, rarities[product as u64]);
            std::unit_test::destroy(tool);
        };
        let refund = scenario.take_from_sender<Coin<SUI>>();
        assert_eq!(coin::value(&refund), ECON_OVERPAYMENT);
        std::unit_test::destroy(refund);
        econ_assert_coin(scenario, DEV_FEE_WALLET, developer);
        econ_assert_coin(scenario, TREASURY_WALLET, treasury);
        if (with_referrer) econ_assert_coin(scenario, @0xB, referral);
        assert_eq!(price + ECON_OVERPAYMENT, referral + pool + developer + treasury + ECON_OVERPAYMENT);
        std::unit_test::destroy(registry);
        clock::destroy_for_testing(clock);
    }

    #[test_only]
    fun econ_all_crates(with_referrer: bool) {
        let mut scenario = test_scenario::begin(@0xA);
        let approved = vector[5_000_000_000u64, 10_000_000_000, 25_000_000_000,
            50_000_000_000, 100_000_000_000, 30_000_000_000, 30_000_000_000];
        let mut tier = 0u8;
        while (tier < 7) {
            econ_shop_case(&mut scenario, true, tier, approved[tier as u64], with_referrer, false);
            tier = tier + 1;
        };
        scenario.end();
    }

    #[test_only]
    fun econ_all_drops(with_referrer: bool) {
        let mut scenario = test_scenario::begin(@0xA);
        // Move IDs: Revival, Shield, Barrel, Mulch, Watering Boost.
        let approved = vector[15_000_000_000u64, 10_000_000_000, 5_000_000_000, 4_000_000_000, 2_000_000_000];
        let mut drop = 0u8;
        while (drop < 5) {
            econ_shop_case(&mut scenario, false, drop, approved[drop as u64], with_referrer, false);
            drop = drop + 1;
        };
        scenario.end();
    }

    #[test]
    fun bnd_economy_all_seven_crate_prices_refunds_and_nonreferral_routing() { econ_all_crates(false); }
    #[test]
    fun bnd_economy_all_seven_crate_prices_refunds_and_referral_routing() { econ_all_crates(true); }
    #[test]
    fun bnd_economy_all_five_supply_prices_refunds_and_nonreferral_routing() { econ_all_drops(false); }
    #[test]
    fun bnd_economy_all_five_supply_prices_refunds_and_referral_routing() { econ_all_drops(true); }

    #[test_only]
    fun econ_partner_wrappers(with_referrer: bool) {
        let mut scenario = test_scenario::begin(@0xA);
        econ_shop_case(&mut scenario, true, 5, 30_000_000_000, with_referrer, true);
        econ_shop_case(&mut scenario, true, 6, 30_000_000_000, with_referrer, true);
        scenario.end();
    }
    #[test]
    fun bnd_economy_both_partner_wrappers_charge_thirty_sui_without_referral() { econ_partner_wrappers(false); }
    #[test]
    fun bnd_economy_both_partner_wrappers_charge_thirty_sui_with_referral() { econ_partner_wrappers(true); }

    #[test_only]
    fun econ_old_shop_price(is_crate: bool, product: u8, use_partner_wrapper: bool) {
        let mut scenario = test_scenario::begin(@0xA);
        let mut registry = econ_registry(scenario.ctx());
        let clock = econ_clock(scenario.ctx());
        let old_drop_prices = vector[50_000_000u64, 40_000_000, 30_000_000, 25_000_000, 20_000_000];
        let old_price = if (is_crate) 10_000_000 else old_drop_prices[product as u64];
        let payment = coin::mint_for_testing<SUI>(old_price, scenario.ctx());
        if (is_crate) {
            if (use_partner_wrapper) {
                if (product == 5) buy_boom_chest(&mut registry, payment, &clock, scenario.ctx())
                else buy_victory_chest(&mut registry, payment, &clock, scenario.ctx());
            } else buy_crate(&mut registry, product, payment, &clock, scenario.ctx());
        } else buy_supply_drop(&mut registry, product, payment, &clock, scenario.ctx());
        std::unit_test::destroy(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test, expected_failure(abort_code = E_WRONG_PAYMENT)]
    fun bnd_economy_seedling_rejects_old_test_price() { econ_old_shop_price(true, 0, false); }
    #[test, expected_failure(abort_code = E_WRONG_PAYMENT)]
    fun bnd_economy_grove_rejects_old_test_price() { econ_old_shop_price(true, 1, false); }
    #[test, expected_failure(abort_code = E_WRONG_PAYMENT)]
    fun bnd_economy_canopy_rejects_old_test_price() { econ_old_shop_price(true, 2, false); }
    #[test, expected_failure(abort_code = E_WRONG_PAYMENT)]
    fun bnd_economy_ancient_rejects_old_test_price() { econ_old_shop_price(true, 3, false); }
    #[test, expected_failure(abort_code = E_WRONG_PAYMENT)]
    fun bnd_economy_mythic_rejects_old_test_price() { econ_old_shop_price(true, 4, false); }
    #[test, expected_failure(abort_code = E_WRONG_PAYMENT)]
    fun bnd_economy_boom_tier_rejects_old_test_price() { econ_old_shop_price(true, 5, false); }
    #[test, expected_failure(abort_code = E_WRONG_PAYMENT)]
    fun bnd_economy_victory_tier_rejects_old_test_price() { econ_old_shop_price(true, 6, false); }
    #[test, expected_failure(abort_code = E_WRONG_PAYMENT)]
    fun bnd_economy_revival_drop_rejects_old_test_price() { econ_old_shop_price(false, 0, false); }
    #[test, expected_failure(abort_code = E_WRONG_PAYMENT)]
    fun bnd_economy_shield_drop_rejects_old_test_price() { econ_old_shop_price(false, 1, false); }
    #[test, expected_failure(abort_code = E_WRONG_PAYMENT)]
    fun bnd_economy_barrel_drop_rejects_old_test_price() { econ_old_shop_price(false, 2, false); }
    #[test, expected_failure(abort_code = E_WRONG_PAYMENT)]
    fun bnd_economy_mulch_drop_rejects_old_test_price() { econ_old_shop_price(false, 3, false); }
    #[test, expected_failure(abort_code = E_WRONG_PAYMENT)]
    fun bnd_economy_watering_drop_rejects_old_test_price() { econ_old_shop_price(false, 4, false); }
    #[test, expected_failure(abort_code = E_WRONG_PAYMENT)]
    fun bnd_economy_boom_wrapper_rejects_old_test_price() { econ_old_shop_price(true, 5, true); }
    #[test, expected_failure(abort_code = E_WRONG_PAYMENT)]
    fun bnd_economy_victory_wrapper_rejects_old_test_price() { econ_old_shop_price(true, 6, true); }

    #[test_only]
    fun econ_plant_case(native_path: bool, old_test_price: bool) {
        let mut scenario = test_scenario::begin(@0xA);
        let mut registry = econ_registry(scenario.ctx());
        let clock = econ_clock(scenario.ctx());
        let sapling = econ_sapling(scenario.ctx());
        let sapling_id = object::id(&sapling);
        let payment_amount = if (old_test_price) 10_000_000 else 10_000_000_000 + ECON_OVERPAYMENT;
        let payment = coin::mint_for_testing<SUI>(payment_amount, scenario.ctx());
        if (native_path) {
            plant_seed(&mut registry, sapling, payment, option::some(@0xB), &clock, scenario.ctx());
        } else {
            plant_seed_with_nftree(&mut registry, &sapling, payment, option::some(@0xB), &clock, scenario.ctx());
            std::unit_test::destroy(sapling);
        };
        assert_eq!(registry_pool_size(&registry), 6_999_300_000);
        assert_eq!(balance::value(&registry.treasury), 0);
        assert_eq!(*table::borrow(&registry.referral_earnings, @0xB), 1_000_000);
        let referrals = event::events_by_type<ReferralPaid>();
        assert_eq!(vector::length(&referrals), 1);
        assert_eq!(referrals[0].amount_mist, 1_000_000);
        assert_eq!(referrals[0].referrer, @0xB);
        assert_eq!(referrals[0].referee, @0xA);
        assert_eq!(registry.total_seeds, 1);
        // This is a full 30-day fixture. Without later care the fresh Seed is
        // projected dead at cutoff, so gameplay GP is 10 while eligible GP is 0.
        assert_eq!(registry.eligible_growth_points, 0);
        let seed_id = table::borrow(&registry.seeds_by_owner, @0xA)[0];
        scenario.next_tx(@0xA);
        let seed = scenario.take_from_sender_by_id<Seed>(seed_id);
        assert_eq!(seed.version, 2);
        assert_eq!(seed.growth_points, 10);
        std::unit_test::destroy(seed);
        if (native_path) std::unit_test::destroy(scenario.take_from_sender_by_id<Sapling>(sapling_id));
        let refund = scenario.take_from_sender<Coin<SUI>>();
        assert_eq!(coin::value(&refund), ECON_OVERPAYMENT);
        std::unit_test::destroy(refund);
        econ_assert_coin(&mut scenario, DEV_FEE_WALLET, 199_980_000);
        econ_assert_coin(&mut scenario, TREASURY_WALLET, 2_799_720_000);
        econ_assert_coin(&mut scenario, @0xB, 1_000_000);
        std::unit_test::destroy(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    fun bnd_economy_native_plant_charges_ten_sui_refunds_and_keeps_fixed_referral() { econ_plant_case(true, false); }
    #[test]
    fun bnd_economy_generic_plant_charges_ten_sui_refunds_and_keeps_fixed_referral() { econ_plant_case(false, false); }
    #[test, expected_failure(abort_code = E_WRONG_PAYMENT)]
    fun bnd_economy_native_plant_rejects_old_test_price() { econ_plant_case(true, true); }
    #[test, expected_failure(abort_code = E_WRONG_PAYMENT)]
    fun bnd_economy_generic_plant_rejects_old_test_price() { econ_plant_case(false, true); }

    #[test]
    fun bnd_economy_planting_fixed_referral_is_paid_only_on_first_registration() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut registry = econ_registry(scenario.ctx());
        let clock = econ_clock(scenario.ctx());
        let first_nft = econ_sapling(scenario.ctx());
        let second_nft = econ_sapling(scenario.ctx());
        let first_payment = coin::mint_for_testing<SUI>(10_000_000_000, scenario.ctx());
        let second_payment = coin::mint_for_testing<SUI>(10_000_000_000, scenario.ctx());
        plant_seed_with_nftree(&mut registry, &first_nft, first_payment, option::some(@0xB), &clock, scenario.ctx());
        plant_seed_with_nftree(&mut registry, &second_nft, second_payment, option::some(@0xB), &clock, scenario.ctx());
        assert_eq!(registry_pool_size(&registry), 13_999_300_000);
        assert_eq!(balance::value(&registry.treasury), 0);
        assert_eq!(*table::borrow(&registry.referral_earnings, @0xB), 1_000_000);
        assert_eq!(vector::length(&event::events_by_type<ReferralPaid>()), 1);
        let ids = *table::borrow(&registry.seeds_by_owner, @0xA);
        assert_eq!(vector::length(&ids), 2);
        scenario.next_tx(@0xA);
        assert!(!scenario.has_most_recent_for_sender<Coin<SUI>>());
        std::unit_test::destroy(scenario.take_from_sender_by_id<Seed>(ids[0]));
        std::unit_test::destroy(scenario.take_from_sender_by_id<Seed>(ids[1]));
        econ_assert_two_coins(&mut scenario, DEV_FEE_WALLET, 399_980_000);
        econ_assert_two_coins(&mut scenario, TREASURY_WALLET, 5_599_720_000);
        econ_assert_coin(&mut scenario, @0xB, 1_000_000);
        std::unit_test::destroy(first_nft);
        std::unit_test::destroy(second_nft);
        std::unit_test::destroy(registry);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    #[test]
    fun bnd_economy_promo_crate_is_admin_only_inventory_and_not_paid_revenue() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut registry = econ_registry(scenario.ctx());
        registry.current_season_id = 0;
        registry.season_start_ms = 0;
        let cap = test_admin_cap_for(&registry, scenario.ctx());
        send_promo_crate(&cap, &registry, @0xB, 5, scenario.ctx());
        assert_eq!(registry_pool_size(&registry), 0);
        assert_eq!(balance::value(&registry.treasury), 0);
        assert_eq!(registry.current_season_id, 0);
        let receipts = event::events_by_type<CratePurchased>();
        assert_eq!(vector::length(&receipts), 1);
        assert_eq!(receipts[0].buyer, @0xB);
        assert_eq!(receipts[0].tier, 5);
        assert_eq!(vector::length(&event::events_by_type<ReferralPaid>()), 0);
        let crate_id = receipts[0].crate_id;
        scenario.next_tx(@0xB);
        let crate_obj = scenario.take_from_sender_by_id<Crate>(crate_id);
        assert_eq!(crate_obj.version, 2);
        assert_eq!(crate_obj.tier, 5);
        assert!(!scenario.has_most_recent_for_sender<Coin<SUI>>());
        std::unit_test::destroy(crate_obj);
        scenario.next_tx(DEV_FEE_WALLET);
        assert!(!scenario.has_most_recent_for_sender<Coin<SUI>>());
        scenario.next_tx(TREASURY_WALLET);
        assert!(!scenario.has_most_recent_for_sender<Coin<SUI>>());
        // CratePurchased exists even though this call accepts no payment and
        // produces no revenue. Consumers must verify the paid acquisition path.
        std::unit_test::destroy(cap);
        std::unit_test::destroy(registry);
        scenario.end();
    }

    #[test_only]
    fun econ_promo_guard(mode: u8) {
        let mut scenario = test_scenario::begin(@0xA);
        let mut registry = econ_registry(scenario.ctx());
        let mut cap = test_admin_cap_for(&registry, scenario.ctx());
        if (mode == 1) { scenario.next_tx(@0xB); };
        if (mode == 2) cap.registry_id = object::id_from_address(@0xB);
        if (mode == 3) registry.paused = true;
        send_promo_crate(&cap, &registry, @0xB, 5, scenario.ctx());
        std::unit_test::destroy(cap);
        std::unit_test::destroy(registry);
        scenario.end();
    }
    #[test, expected_failure(abort_code = E_NOT_ADMIN)]
    fun bnd_economy_promo_rejects_nonadministrator_sender() { econ_promo_guard(1); }
    #[test, expected_failure(abort_code = E_WRONG_REGISTRY)]
    fun bnd_economy_promo_rejects_capability_bound_to_another_registry() { econ_promo_guard(2); }
    #[test, expected_failure(abort_code = E_PAUSED)]
    fun bnd_economy_promo_rejects_paused_registry() { econ_promo_guard(3); }
