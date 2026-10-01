    // Season 1 candidate ONLY. Added layouts require a fresh type origin, not a
    // drop-in upgrade of the live Registry. No migration or activation is supplied.
    const E_LINE_CONTROLS_MISSING: u64 = 100;
    const E_INSTANT_COOLDOWN: u64 = 101;
    const E_FOREST_HEART_CAP: u64 = 102;
    const E_DOUBLE_ALREADY_QUEUED: u64 = 103;
    const E_PROTECTION_NO_EXTENSION: u64 = 104;
    const E_BOOST_QUEUE_FULL: u64 = 105;
    const POINT_INTERVAL_MS: u64 = 77_760_000;

    public struct LineKey has copy, drop, store {
        nft_id: ID,
        season_id: u64,
    }

    public struct LineControls has store, drop {
        last_gp_ms: u64,
        has_instant_use: bool,
        last_instant_ms: u64,
        forest_hearts: u8,
    }

    fun line_key(seed: &Seed): LineKey {
        LineKey { nft_id: seed.sapling_id, season_id: seed.season_id }
    }

    // Invoked by both planting paths. Replanting does NOT refresh caps.
    fun register_line(registry: &mut Registry, seed: &Seed, now_ms: u64) {
        let key = line_key(seed);
        if (table::contains(&registry.line_controls, key)) {
            let line = table::borrow_mut(&mut registry.line_controls, key);
            // A new Seed cannot start with a backdated earning clock.
            if (now_ms > line.last_gp_ms) line.last_gp_ms = now_ms;
        } else {
            table::add(&mut registry.line_controls, key, LineControls {
                last_gp_ms: now_ms,
                has_instant_use: false,
                last_instant_ms: 0,
                forest_hearts: 0,
            });
        };
    }

    fun line_controls(registry: &Registry, seed: &Seed): &LineControls {
        let key = line_key(seed);
        assert!(table::contains(&registry.line_controls, key), E_LINE_CONTROLS_MISSING);
        table::borrow(&registry.line_controls, key)
    }

    fun consume_point_interval(registry: &mut Registry, seed: &Seed, now_ms: u64): u64 {
        let key = line_key(seed);
        assert!(table::contains(&registry.line_controls, key), E_LINE_CONTROLS_MISSING);
        let line = table::borrow_mut(&mut registry.line_controls, key);
        assert!(now_ms >= line.last_gp_ms, E_ALREADY_WATERED_TODAY);
        let elapsed = now_ms - line.last_gp_ms;
        assert!(elapsed >= POINT_INTERVAL_MS, E_ALREADY_WATERED_TODAY);
        line.last_gp_ms = now_ms;
        elapsed
    }

    fun consume_instant_allowance(registry: &mut Registry, seed: &Seed, now_ms: u64) {
        let key = line_key(seed);
        assert!(table::contains(&registry.line_controls, key), E_LINE_CONTROLS_MISSING);
        let line = table::borrow_mut(&mut registry.line_controls, key);
        if (line.has_instant_use) {
            assert!(now_ms >= line.last_instant_ms, E_INSTANT_COOLDOWN);
            assert!(now_ms - line.last_instant_ms >= POINT_INTERVAL_MS, E_INSTANT_COOLDOWN);
        };
        line.has_instant_use = true;
        line.last_instant_ms = now_ms;
    }

    fun consume_forest_allowance(registry: &mut Registry, seed: &Seed) {
        let key = line_key(seed);
        assert!(table::contains(&registry.line_controls, key), E_LINE_CONTROLS_MISSING);
        let line = table::borrow_mut(&mut registry.line_controls, key);
        assert!(line.forest_hearts < 2, E_FOREST_HEART_CAP);
        line.forest_hearts = line.forest_hearts + 1;
    }

    fun queue_boost(seed: &mut Seed, count: u8) {
        assert!(count <= 255 - seed.fertilizer_charges, E_BOOST_QUEUE_FULL);
        seed.fertilizer_charges = seed.fertilizer_charges + count;
    }

    fun assert_double_available(seed: &Seed) {
        assert!(!seed.miracle_grow_applied, E_DOUBLE_ALREADY_QUEUED);
    }

    fun extend_protection(seed: &mut Seed, now_ms: u64, duration: u64) {
        let proposed = now_ms + duration;
        assert!(proposed > seed.bottomless_can_expiry_ms, E_PROTECTION_NO_EXTENSION);
        seed.bottomless_can_expiry_ms = proposed;
    }

    // These reads support a later UI integration; the website is not changed here.
    public fun point_watering_ready_at(registry: &Registry, seed: &Seed): u64 {
        line_controls(registry, seed).last_gp_ms + POINT_INTERVAL_MS
    }

    public fun instant_tool_ready_at(registry: &Registry, seed: &Seed): u64 {
        let line = line_controls(registry, seed);
        if (line.has_instant_use) line.last_instant_ms + POINT_INTERVAL_MS else 0
    }

    public fun forest_hearts_used(registry: &Registry, seed: &Seed): u8 {
        line_controls(registry, seed).forest_hearts
    }
