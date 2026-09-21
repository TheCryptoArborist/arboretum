// LOCAL TEST DEPENDENCY ONLY; excluded from the non-test candidate build.
// Layout and rarity getter mirror inspected immutable collection bytecode.
// This is not the full collection source, a real mint, or a deployable replacement.
module canonical_fixture::collection {
    public struct NFT has key, store {
        id: UID,
        number: u64,
        name: std::string::String,
        description: std::string::String,
        image_url: std::string::String,
        rarity: std::string::String,
    }
    public fun make(ctx: &mut TxContext): NFT { make_with_rarity(b"Common", ctx) }
    public fun make_with_rarity(label: vector<u8>, ctx: &mut TxContext): NFT {
        NFT { id: sui::object::new(ctx), number: 1, name: std::string::utf8(b"Test NFTree"),
            description: std::string::utf8(b"Synthetic test object; not an actual collection NFT"),
            image_url: std::string::utf8(b"about:blank"), rarity: std::string::utf8(label) }
    }
    public fun make_with_fields(name: vector<u8>, description: vector<u8>, image: vector<u8>,
        label: vector<u8>, ctx: &mut TxContext): NFT {
        NFT { id: sui::object::new(ctx), number: 99, name: std::string::utf8(name),
            description: std::string::utf8(description), image_url: std::string::utf8(image),
            rarity: std::string::utf8(label) }
    }
    public fun rarity(nft: &NFT): &std::string::String { &nft.rarity }
    public fun destroy(nft: NFT) {
        let NFT { id, number: _, name: _, description: _, image_url: _, rarity: _ } = nft;
        sui::object::delete(id);
    }
}
