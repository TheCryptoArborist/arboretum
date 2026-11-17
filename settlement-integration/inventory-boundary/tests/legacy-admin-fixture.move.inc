    // Appended only to the isolated v2 test package's legacy module. This
    // wrapper never enters the production build or published legacy bytecode.
    #[test_only]
    public fun bnd_test_legacy_cap(ctx: &mut TxContext): AdminCap {
        test_admin_cap(ctx)
    }
