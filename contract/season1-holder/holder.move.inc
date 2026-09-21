    // Isolated candidate only. No production activation or external rarity oracle.
    const E_HOLDER_TIER: u64 = 300;
    const E_UNKNOWN_RARITY: u64 = 301;
    const E_NFT_LAYOUT: u64 = 302;
    const E_HOLDER_CHOICE: u64 = 303;
    const E_HOLDER_REPLAY: u64 = 304;
    const E_HOLDER_RECEIPT: u64 = 305;
    const E_HOLDER_ITEM: u64 = 306;
    const E_HOLDER_BATCH: u64 = 307;
    const HOLDER_DEFAULT: u8 = 0;
    const HOLDER_MIRACLE: u8 = 1;
    const HOLDER_DOUBLE_DOSE: u8 = 2;

    public struct HolderBonusGranted has copy, drop {
        registry_id: ID,
        economy_version: u64,
        season_id: u64,
        receipt_id: ID,
        tool_id: ID,
        buyer: address,
        nft_id: ID,
        nft_rarity: u8,
        crate_tier: u8,
        choice: u8,
        default_waterings: u8,
    }

    // Exact canonical type gate precedes serialization. Layout is pinned to the
    // original deployed NFT: UID, u64, name, description, image_url, rarity.
    // UID/ID serialize as address; String as vector<u8>. No caller-supplied BCS.
    // This avoids compiling against a fabricated external collection dependency.
    // The public collection rarity getter and layout are independently inspected
    // by CI; this local decoder reads the same stored field, not the description.
    fun nftree_holder_rank<NFTree: key + store>(nftree: &NFTree): u8 {
        assert_nftree(nftree);
        let mut data = sui::bcs::new(sui::bcs::to_bytes(nftree));
        let id = sui::bcs::peel_address(&mut data);
        assert!(object::id_from_address(id) == object::id(nftree), E_NFT_LAYOUT);
        let _number = sui::bcs::peel_u64(&mut data);
        let _name = sui::bcs::peel_vec_u8(&mut data);
        let _description = sui::bcs::peel_vec_u8(&mut data);
        let _image = sui::bcs::peel_vec_u8(&mut data);
        let label = sui::bcs::peel_vec_u8(&mut data);
        assert!(vector::is_empty(&sui::bcs::into_remainder_bytes(data)), E_NFT_LAYOUT);
        holder_rank_from_label(label)
    }

    fun holder_rank_from_label(mut label: vector<u8>): u8 {
        let mut i = 0;
        while (i < vector::length(&label)) {
            let c = *vector::borrow(&label, i);
            if (c >= 65 && c <= 90) *vector::borrow_mut(&mut label, i) = c + 32;
            i = i + 1;
        };
        if (label == b"common") 0
        else if (label == b"rare") 1
        else if (label == b"epic") 2
        else if (label == b"legendary") 3
        else if (label == b"mythic") 4
        else if (label == b"one of one" || label == b"one-of-one" || label == b"1 of 1" || label == b"1/1") 5
        else abort E_UNKNOWN_RARITY
    }

    fun holder_waterings(rank: u8, tier: u8): u8 {
        assert!(rank <= 5, E_UNKNOWN_RARITY);
        assert!(tier == CRATE_ANCIENT || tier == CRATE_MYTHIC, E_HOLDER_TIER);
        (rank + 1) * (if (tier == CRATE_MYTHIC) 2 else 1)
    }

    fun assert_holder_choice(default_waterings: u8, choice: u8) {
        assert!(choice == HOLDER_DEFAULT ||
            (choice == HOLDER_MIRACLE && default_waterings >= 2) ||
            (choice == HOLDER_DOUBLE_DOSE && default_waterings >= 5), E_HOLDER_CHOICE);
    }

    fun holder_item_spec(default_waterings: u8, choice: u8): (vector<u8>, u8, u8) {
        assert_holder_choice(default_waterings, choice);
        if (choice == HOLDER_DEFAULT) (b"holder_growth_boost", default_waterings, 0)
        else if (choice == HOLDER_MIRACLE) (b"miracle_grow", 0, 1)
        else (b"double_dose", 0, 2)
    }

    // Quote is informational, not ownership proof. Purchase consumes an owned NFT
    // input and reads its actual rank again. UI should choose the highest eligible
    // NFT held; submitting a lower-rarity proof cannot grant a higher bonus.
    public fun quote_holder_bonus<NFTree: key + store>(registry: &Registry,
        nftree: &NFTree, tier: u8): (u8, u8, u64, bool, bool) {
        assert_rules(registry);
        let rank = nftree_holder_rank(nftree);
        let count = holder_waterings(rank, tier);
        (rank, count, crate_price(tier), count >= 2, count >= 5)
    }

    // Called ONLY within the paid holder checkout. Ordinary receipts explicitly
    // lack holder_intent, so there is no retroactive ordinary/test-item claim path.
    fun issue_holder_tool(registry: &mut Registry, origin: ItemOrigin, nft_id: ID,
        rank: u8, choice: u8, ctx: &mut TxContext): Tool {
        let receipt = validate_origin(registry, &origin);
        assert!(receipt.holder_intent && receipt.buyer == tx_context::sender(ctx) &&
            !receipt.opened, E_HOLDER_RECEIPT);
        assert!(option::is_none(&receipt.holder_tool_id), E_HOLDER_REPLAY);
        let count = holder_waterings(rank, receipt.product);
        let (kind, waterings, tool_rarity) = holder_item_spec(count, choice);
        let tool = Tool { id: object::new(ctx), origin, holder_waterings: waterings,
            kind: string::utf8(kind), charges: 1, rarity: tool_rarity };
        let tool_id = object::id(&tool);
        let saved = table::borrow_mut(&mut registry.paid_receipts, origin.receipt_id);
        saved.holder_tool_id = option::some(tool_id);
        saved.holder_nft_id = option::some(nft_id);
        saved.holder_rank = rank;
        saved.holder_choice = choice;
        saved.holder_default_waterings = count;
        saved.holder_season_id = registry.current_season_id;
        event::emit(HolderBonusGranted { registry_id: origin.registry_id,
            economy_version: origin.economy_version, season_id: registry.current_season_id,
            receipt_id: origin.receipt_id, tool_id, buyer: tx_context::sender(ctx),
            nft_id, nft_rarity: rank, crate_tier: receipt.product, choice, default_waterings: count });
        tool
    }

    entry fun buy_crate_with_holder<NFTree: key + store>(registry: &mut Registry,
        nftree: NFTree, tier: u8, choice: u8, payment: Coin<SUI>,
        clock: &Clock, ctx: &mut TxContext) {
        buy_holder_crates(registry, nftree, tier, choice, 1, payment, clock, ctx);
    }

    // Eight is an operational batch limit, NOT a per-wallet purchase quota.
    // Each crate is priced/routed separately to preserve exact referral rounding.
    entry fun buy_holder_crates<NFTree: key + store>(registry: &mut Registry,
        nftree: NFTree, tier: u8, choice: u8, quantity: u8, mut payment: Coin<SUI>,
        clock: &Clock, ctx: &mut TxContext) {
        assert_rules(registry);
        assert!(!registry.paused, E_PAUSED);
        let _now = assert_season_active(registry, clock);
        let rank = nftree_holder_rank(&nftree);
        let count = holder_waterings(rank, tier);
        assert_holder_choice(count, choice);
        assert!(quantity >= 1 && quantity <= 8, E_HOLDER_BATCH);
        let price = crate_price(tier);
        assert!(coin::value(&payment) >= price * (quantity as u64), E_WRONG_PAYMENT);
        let buyer = tx_context::sender(ctx);
        let mut i = 0;
        while (i < quantity) {
            let exact = coin::split(&mut payment, price, ctx);
            let crate_obj = make_paid_crate(registry, tier, exact, true, ctx);
            let tool = issue_holder_tool(registry, crate_obj.origin, object::id(&nftree), rank, choice, ctx);
            transfer::transfer(crate_obj, buyer);
            transfer::public_transfer(tool, buyer);
            i = i + 1;
        };
        if (coin::value(&payment) > 0) transfer::public_transfer(payment, buyer)
        else coin::destroy_zero(payment);
        transfer::public_transfer(nftree, buyer);
    }

    fun assert_holder_item(tool: &Tool, receipt: &PaidReceipt) {
        assert!(receipt.holder_intent && option::is_some(&receipt.holder_nft_id), E_HOLDER_ITEM);
        assert!(receipt.holder_default_waterings == holder_waterings(receipt.holder_rank, receipt.product), E_HOLDER_ITEM);
        let (kind, waterings, rarity) = holder_item_spec(receipt.holder_default_waterings, receipt.holder_choice);
        assert!(*string::as_bytes(&tool.kind) == kind && tool.holder_waterings == waterings &&
            tool.rarity == rarity && tool.charges <= 1, E_HOLDER_ITEM);
    }

    public fun item_holder_waterings(tool: &Tool): u8 { tool.holder_waterings }
    public fun receipt_has_holder(registry: &Registry, receipt_id: ID): bool {
        assert_rules(registry);
        table::contains(&registry.paid_receipts, receipt_id) &&
            option::is_some(&table::borrow(&registry.paid_receipts, receipt_id).holder_tool_id)
    }
