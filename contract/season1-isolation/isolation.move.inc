    // Isolated candidate only. Requires a fresh package origin; no live migration.
    const RULES_VERSION: u64 = 1;
    const ECONOMY_VERSION: u64 = 1;
    const E_RULES_VERSION: u64 = 200;
    const E_FOREIGN_REGISTRY: u64 = 201;
    const E_ECONOMY_VERSION: u64 = 202;
    const E_UNPAID_ITEM: u64 = 203;
    const E_RECEIPT_REPLAY: u64 = 204;
    const E_RECEIPT_PRODUCT: u64 = 205;
    const E_NOT_CANONICAL_NFTREE: u64 = 206;
    const E_WRONG_NFTREE: u64 = 207;
    const E_LEGACY_ROUTE_DISABLED: u64 = 208;
    const E_MAX_ACTIVE_SEEDS: u64 = 209;

    public struct ItemOrigin has copy, drop, store {
        registry_id: ID,
        economy_version: u64,
        receipt_id: ID,
    }

    public struct PaidReceipt has copy, drop, store {
        product: u8,
        paid_mist: u64,
        opened: bool,
    }

    public struct ActiveSeedCount has store, drop {
        season_id: u64,
        count: u8,
    }

    public struct PaidIssuance has copy, drop {
        registry_id: ID,
        economy_version: u64,
        receipt_id: ID,
        buyer: address,
        product: u8,
        paid_mist: u64,
    }

    fun assert_rules(registry: &Registry) {
        assert!(registry.rules_version == RULES_VERSION, E_RULES_VERSION);
        assert!(registry.economy_version == ECONOMY_VERSION, E_ECONOMY_VERSION);
    }

    fun assert_seed_domain(registry: &Registry, seed: &Seed) {
        assert_rules(registry);
        assert!(seed.registry_id == object::id(registry), E_FOREIGN_REGISTRY);
        assert!(seed.economy_version == registry.economy_version, E_ECONOMY_VERSION);
    }

    // Uses the actual defining type ID, not a supplied name, rarity or image URL.
    // Taking NFTree by value in the public entry points ensures Sui validates
    // an owned input rather than accepting an arbitrary shared/immutable borrow.
    fun assert_nftree<NFTree: key + store>(nftree: &NFTree) {
        let name = std::type_name::with_defining_ids<NFTree>();
        assert!(std::ascii::as_bytes(std::type_name::as_string(&name)) ==
            &b"f6c6d439ea0da2f3e9ba79e4992a7a4c113215fbf54c442ac9020c315f953705::collection::NFT",
            E_NOT_CANONICAL_NFTREE);
        let _ = object::id(nftree);
    }

    fun assert_seed_nftree<NFTree: key + store>(registry: &Registry, seed: &Seed, nftree: &NFTree) {
        assert_seed_domain(registry, seed);
        assert_nftree(nftree);
        assert!(object::id(nftree) == seed.sapling_id, E_WRONG_NFTREE);
    }

    fun crate_price(tier: u8): u64 {
        assert!(tier <= 6, E_INVALID_CRATE_TIER);
        if (tier == 0) 2_000_000_000
        else if (tier == 1) 4_000_000_000
        else if (tier == 2) 10_000_000_000
        else if (tier == 3) 25_000_000_000
        else if (tier == 4) 50_000_000_000
        else 20_000_000_000
    }

    fun expected_receipt_price(product: u8): u64 {
        if (product <= 6) crate_price(product)
        else if (product == 16) SUPPLY_PRICE_REVIVAL_KIT
        else if (product == 17) SUPPLY_PRICE_DROUGHT_SHIELD
        else if (product == 18) SUPPLY_PRICE_RAIN_BARREL
        else if (product == 19) SUPPLY_PRICE_MULCH
        else if (product == 20) SUPPLY_PRICE_WATERING_BOOST
        else abort E_RECEIPT_PRODUCT
    }

    // This private function is called only after the corresponding full SUI
    // payment has been split and routed in the same atomic transaction.
    fun record_paid_receipt(registry: &mut Registry, receipt_id: ID, product: u8,
                           paid_mist: u64, opened: bool, buyer: address): ItemOrigin {
        assert_rules(registry);
        assert!(paid_mist == expected_receipt_price(product), E_WRONG_PAYMENT);
        assert!(!table::contains(&registry.paid_receipts, receipt_id), E_RECEIPT_REPLAY);
        table::add(&mut registry.paid_receipts, receipt_id, PaidReceipt { product, paid_mist, opened });
        let origin = ItemOrigin { registry_id: object::id(registry), economy_version: registry.economy_version, receipt_id };
        event::emit(PaidIssuance { registry_id: origin.registry_id, economy_version: origin.economy_version,
            receipt_id, buyer, product, paid_mist });
        origin
    }

    fun validate_origin(registry: &Registry, origin: &ItemOrigin): PaidReceipt {
        assert_rules(registry);
        assert!(origin.registry_id == object::id(registry), E_FOREIGN_REGISTRY);
        assert!(origin.economy_version == registry.economy_version, E_ECONOMY_VERSION);
        assert!(table::contains(&registry.paid_receipts, origin.receipt_id), E_UNPAID_ITEM);
        let receipt = *table::borrow(&registry.paid_receipts, origin.receipt_id);
        assert!(receipt.paid_mist == expected_receipt_price(receipt.product), E_UNPAID_ITEM);
        receipt
    }

    fun consume_crate_receipt(registry: &mut Registry, crate_obj: &Crate) {
        let receipt = validate_origin(registry, &crate_obj.origin);
        assert!(receipt.product == crate_obj.tier, E_RECEIPT_PRODUCT);
        assert!(!receipt.opened, E_RECEIPT_REPLAY);
        table::borrow_mut(&mut registry.paid_receipts, crate_obj.origin.receipt_id).opened = true;
    }

    fun assert_tool_origin(registry: &Registry, tool: &Tool) {
        let receipt = validate_origin(registry, &tool.origin);
        assert!(receipt.opened, E_UNPAID_ITEM);
    }

    fun reserve_active_seed(registry: &mut Registry, owner: address) {
        if (!table::contains(&registry.active_seed_counts, owner)) {
            table::add(&mut registry.active_seed_counts, owner, ActiveSeedCount { season_id: registry.current_season_id, count: 0 });
        };
        let row = table::borrow_mut(&mut registry.active_seed_counts, owner);
        if (row.season_id != registry.current_season_id) {
            row.season_id = registry.current_season_id;
            row.count = 0;
        };
        assert!(row.count < 8, E_MAX_ACTIVE_SEEDS);
        row.count = row.count + 1;
    }

    fun release_active_seed(registry: &mut Registry, owner: address) {
        if (table::contains(&registry.active_seed_counts, owner)) {
            let row = table::borrow_mut(&mut registry.active_seed_counts, owner);
            if (row.season_id == registry.current_season_id && row.count > 0) row.count = row.count - 1;
        };
    }

    // Active gardening requires the same canonical NFTree; completed-season
    // claims remain tied to the owned Seed, not a new NFT ownership requirement.
    entry fun water_seed<NFTree: key + store>(registry: &mut Registry, seed: &mut Seed,
        nftree: NFTree, clock: &Clock, ctx: &mut TxContext) {
        assert_seed_nftree(registry, seed, &nftree);
        water_seed_checked(registry, seed, clock, ctx);
        transfer::public_transfer(nftree, tx_context::sender(ctx));
    }

    entry fun apply_tool<NFTree: key + store>(registry: &mut Registry, seed: &mut Seed,
        nftree: NFTree, mut tool: Tool, clock: &Clock, ctx: &mut TxContext) {
        assert_seed_nftree(registry, seed, &nftree);
        apply_tool_checked(registry, seed, &mut tool, clock, ctx);
        return_or_delete_tool(tool, tx_context::sender(ctx));
        transfer::public_transfer(nftree, tx_context::sender(ctx));
    }

    entry fun revive_seed<NFTree: key + store>(registry: &Registry, seed: &mut Seed,
        nftree: NFTree, clock: &Clock, ctx: &mut TxContext) {
        assert_seed_nftree(registry, seed, &nftree);
        revive_seed_checked(registry, seed, clock, ctx);
        transfer::public_transfer(nftree, tx_context::sender(ctx));
    }

    entry fun revive_seed_with_tool<NFTree: key + store>(registry: &mut Registry, seed: &mut Seed,
        nftree: NFTree, tool: Tool, clock: &Clock, ctx: &mut TxContext) {
        assert_seed_nftree(registry, seed, &nftree);
        revive_seed_with_tool_checked(registry, seed, tool, clock, ctx);
        transfer::public_transfer(nftree, tx_context::sender(ctx));
    }

    entry fun buy_boom_chest(registry: &mut Registry, payment: Coin<SUI>, ctx: &mut TxContext) {
        buy_crate(registry, 5, payment, ctx);
    }

    entry fun buy_victory_chest(registry: &mut Registry, payment: Coin<SUI>, ctx: &mut TxContext) {
        buy_crate(registry, 6, payment, ctx);
    }

    // Recovered from configured deployed open_crate bytecode (Sept 19 evidence).
    // A deterministic roll is injectable ONLY through private/unit-test calls.
    fun partner_items(tier: u8, roll: u8): vector<ItemSpec> {
        assert!(roll <= 99 && (tier == 5 || tier == 6), E_INVALID_CRATE_TIER);
        if (tier == 5) {
            let mut items = vector[
                ItemSpec { kind: ITEM_ANCIENT_BARK, uses: 1, rarity: 2 },
                ItemSpec { kind: ITEM_SUNSTONE, uses: 1, rarity: 1 },
                ItemSpec { kind: ITEM_DOUBLE_DOSE, uses: 2, rarity: 2 },
            ];
            vector::push_back(&mut items, if (roll < 10)
                ItemSpec { kind: ITEM_FOREST_HEART, uses: 1, rarity: 3 }
            else ItemSpec { kind: ITEM_GROWTH_TONIC, uses: 2, rarity: 0 });
            items
        } else {
            let mut items = vector[
                ItemSpec { kind: ITEM_DROUGHT_SHIELD, uses: 2, rarity: 2 },
                ItemSpec { kind: ITEM_RAIN_BARREL, uses: 2, rarity: 1 },
                ItemSpec { kind: ITEM_MULCH, uses: 2, rarity: 1 },
            ];
            vector::push_back(&mut items, if (roll < 25)
                ItemSpec { kind: ITEM_BOTTOMLESS_CAN, uses: 1, rarity: 3 }
            else ItemSpec { kind: ITEM_REVIVAL_KIT, uses: 1, rarity: 2 });
            items
        }
    }

    public struct ItemSpec has drop { kind: vector<u8>, uses: u8, rarity: u8 }

    public fun rules_version(registry: &Registry): u64 { registry.rules_version }
    public fun item_receipt_id(tool: &Tool): ID { tool.origin.receipt_id }
    public fun item_registry_id(tool: &Tool): ID { tool.origin.registry_id }
