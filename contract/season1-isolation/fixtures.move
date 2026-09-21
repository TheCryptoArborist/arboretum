// TEST FIXTURES ONLY. No external collection bytecode is replaced or published.
// The canonical-address fixture tests the unchanged type-identity gate, not the
// actual collection's mint code, marketplace custody, or production ownership.
#[test_only]
module canonical_fixture::collection {
    public struct NFT has key, store { id: UID }
    public fun make(ctx: &mut TxContext): NFT { NFT { id: sui::object::new(ctx) } }
    public fun destroy(nft: NFT) { let NFT { id } = nft; sui::object::delete(id); }
}

#[test_only]
module fake_fixture::collection {
    public struct NFT has key, store { id: UID }
    public fun make(ctx: &mut TxContext): NFT { NFT { id: sui::object::new(ctx) } }
    public fun destroy(nft: NFT) { let NFT { id } = nft; sui::object::delete(id); }
}

// Legacy nominal identities for negative compilation tests. Their fields are not
// used to claim source equivalence; type mismatch is independent of their layout.
#[test_only]
module legacy_fixture::arboretum {
    public struct Tool has key, store { id: UID }
    public struct Crate has key, store { id: UID }
    public struct Seed has key { id: UID }
    public struct Registry has key { id: UID }
}
