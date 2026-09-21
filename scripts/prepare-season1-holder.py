#!/usr/bin/env python3
"""Generate a fresh-origin holder candidate; no chain writes or live-source edits."""
from pathlib import Path
import hashlib,json,re,runpy,difflib
ROOT=Path(__file__).resolve().parents[1]
ns=runpy.run_path(str(ROOT/'scripts/prepare-season1-isolation.py'))
original=ns['src']
assert hashlib.sha256(original.encode()).hexdigest()=='7057176001bfef8e27fb831a34b622178462d18c0797192cf2ace8545bf887d6', 'Step 2 source drift'
src=original;replace=ns['replace'];span=ns['span'];edit=ns['edit']
AREA=ROOT/'contract/season1-holder';OUT=AREA/'generated';RESULTS=ROOT/'step3-results';RESULTS.mkdir(exist_ok=True)
# A bonus remains a one-use Tool; only the dedicated item carries a variable
# future-watering count. All ordinary constructors explicitly initialize zero.
src=replace(src,'    public struct Tool has key, store {\n        id: UID,\n        origin: ItemOrigin,','    public struct Tool has key, store {\n        id: UID,\n        origin: ItemOrigin,\n        holder_waterings: u8,')
src=replace(src,'Tool { id: object::new(ctx), origin, kind:', 'Tool { id: object::new(ctx), origin, holder_waterings: 0, kind:')
src=replace(src,'Tool { id, origin, kind:', 'Tool { id, origin, holder_waterings: 0, kind:')
src=replace(src,'        let tool = Tool {\n            id, origin,','        let tool = Tool {\n            id, origin, holder_waterings: 0,')
src=replace(src,'let Tool { id, origin: _, kind: _, charges: _, rarity: _ } = tool;', 'let Tool { id, origin: _, holder_waterings: _, kind: _, charges: _, rarity: _ } = tool;',2)
src=replace(src,'    public struct PaidReceipt has copy, drop, store {\n        product: u8,\n        paid_mist: u64,\n        opened: bool,','''    public struct PaidReceipt has copy, drop, store {
        product: u8,
        paid_mist: u64,
        opened: bool,
        buyer: address,
        holder_intent: bool,
        holder_tool_id: Option<ID>,
        holder_nft_id: Option<ID>,
        holder_rank: u8,
        holder_choice: u8,
        holder_default_waterings: u8,
        holder_season_id: u64,''')
src=replace(src,'PaidReceipt { product, paid_mist, opened }','''PaidReceipt { product, paid_mist, opened, buyer,
            holder_intent: false, holder_tool_id: option::none(), holder_nft_id: option::none(),
            holder_rank: 0, holder_choice: 0, holder_default_waterings: 0, holder_season_id: 0 }''')
# Common price/rounding/payment routine for ordinary and holder checkout.
a,b=span(src,'buy_crate');factory=src[a:b]
factory=replace(factory,'    entry fun buy_crate(', '    fun make_paid_crate(')
factory=replace(factory,'        ctx: &mut TxContext,','        holder_intent: bool,\n        ctx: &mut TxContext,')
factory=replace(factory,'    ) {','    ): Crate {')
factory=replace(factory,'        let crate_obj = Crate { id, tier, origin };','        table::borrow_mut(&mut registry.paid_receipts, origin.receipt_id).holder_intent = holder_intent;\n        let crate_obj = Crate { id, tier, origin };')
factory=replace(factory,'        transfer::transfer(crate_obj, buyer);','        crate_obj')
wrapper='''    entry fun buy_crate(registry: &mut Registry, tier: u8, payment: Coin<SUI>, ctx: &mut TxContext) {
        let crate_obj = make_paid_crate(registry, tier, payment, false, ctx);
        transfer::transfer(crate_obj, tx_context::sender(ctx));
    }

'''
src=src[:a]+wrapper+factory+src[b:]
# A holder grant is usable before opening only when its exact ID and immutable
# terms match the receipt. Merely sharing an unopened receipt cannot authorize loot.
def tool_origin(x):
 return replace(x,'        assert!(receipt.opened, E_UNPAID_ITEM);','''        let holder_match = option::is_some(&receipt.holder_tool_id) &&
            *option::borrow(&receipt.holder_tool_id) == object::id(tool);
        if (holder_match) {
            assert_holder_item(tool, &receipt);
        } else {
            assert!(tool.holder_waterings == 0 && *string::as_bytes(&tool.kind) != b"holder_growth_boost", E_HOLDER_ITEM);
            assert!(receipt.opened, E_UNPAID_ITEM);
        };''')
src=edit(src,'assert_tool_origin',tool_origin)
src=edit(src,'apply_tool_checked',lambda x:replace(x,'        if (kind_bytes == b"fertilizer") {','        if (kind_bytes == b"holder_growth_boost") {\n            queue_boost(seed, tool.holder_waterings);\n        } else if (kind_bytes == b"fertilizer") {'))
helpers=(AREA/'holder.move.inc').read_text();tests=(AREA/'holder-tests.move.inc').read_text()
src=src.rstrip()[:-1]+'\n'+helpers+'\n'+tests+'\n}\n'
# Payment allocations, advertised normal loot, limits and claims are not redesigned.
unchanged=['route_paid_action','pay_direct_invite_shop_bonus','crate_price','open_crate','partner_items',
 'water_seed_checked','consume_point_interval','consume_instant_allowance','consume_forest_allowance',
 'claim_reward','claim_archived_reward','start_season','reset_season']
for name in unchanged:
 a,b=span(original,name);c,d=span(src,name);assert original[a:b]==src[c:d], 'Unexpected change: '+name
manifest=ns['manifest'].replace('arboretum_season1_isolated','arboretum_season1_holder')
(OUT/'sources').mkdir(parents=True,exist_ok=True);(OUT/'tests').mkdir(exist_ok=True)
(OUT/'Move.toml').write_text(manifest);(OUT/'sources/arboretum.move').write_text(src)
report={'step2_commit':'89db32d6aec5a4877bac3917e8aa94ed1d3c323e','step2_source_sha256':hashlib.sha256(original.encode()).hexdigest(),
 'candidate_sha256':hashlib.sha256(src.encode()).hexdigest(),'retained_tests':68,
 'new_tests':len(re.findall(r'#\[test(?:,|\])',tests)),'unchanged_functions':unchanged,
 'rarity_source':'Canonical owned NFT serialized on-chain; exact pinned field layout, strict label map. No browser or admin-provided rarity.',
 'deployment':False,'live_mitigation':False}
(RESULTS/'preparation.json').write_text(json.dumps(report,indent=2)+'\n')
(RESULTS/'holder.patch').write_text(''.join(difflib.unified_diff(original.splitlines(True),src.splitlines(True),fromfile='step2',tofile='holder-candidate')))
print(json.dumps(report,indent=2))
