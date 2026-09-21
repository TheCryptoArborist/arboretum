#!/usr/bin/env python3
"""Generate an isolated fresh-origin Season 1 candidate. No publish or wallet calls.
Only generated package/results paths are written. Step 1 and production files stay intact.
"""
from pathlib import Path
import hashlib,json,re,runpy,difflib
ROOT=Path(__file__).resolve().parents[1]
ns=runpy.run_path(str(ROOT/'scripts/prepare-season1-step1.py'))
original=ns['src']
assert hashlib.sha256(original.encode()).hexdigest()=='f0ade5506f09076f88d56249aca75c508d062377126d6df745df8dcc2bfc48b9'
src=original
AREA=ROOT/'contract/season1-isolation'
OUT=AREA/'generated'
RESULTS=ROOT/'step2-results';RESULTS.mkdir(exist_ok=True)
span=ns['fn_span'];replace=ns['replace'];edit=ns['edit_function']

def remove_fn(s,name):
 a,b=span(s,name);return s[:a]+s[b:]
def prepend(s,name,code):
 return edit(s,name,lambda x:x[:x.index('{')+1]+'\n'+code+x[x.index('{')+1:])
def change_body(s,name,body):
 return edit(s,name,lambda x:x[:x.index('{')+1]+'\n'+body+'\n    }')

src=replace(src,'module arboretum::arboretum {','module season1::arboretum {')
# Versioned registry and independent issuance ledger.
src=replace(src,'        line_controls: Table<LineKey, LineControls>,','        line_controls: Table<LineKey, LineControls>,\n        rules_version: u64,\n        economy_version: u64,\n        paid_receipts: Table<ID, PaidReceipt>,\n        active_seed_counts: Table<address, ActiveSeedCount>,')
src=replace(src,'            line_controls: table::new<LineKey, LineControls>(ctx),','            line_controls: table::new<LineKey, LineControls>(ctx),\n            rules_version: 1, economy_version: 1,\n            paid_receipts: table::new<ID, PaidReceipt>(ctx),\n            active_seed_counts: table::new<address, ActiveSeedCount>(ctx),',2)
src=replace(src,'            line_controls,\n        } = registry;','            line_controls, rules_version: _, economy_version: _, paid_receipts, active_seed_counts,\n        } = registry;')
src=replace(src,'        table::drop(line_controls);','        table::drop(line_controls);\n        table::drop(paid_receipts);\n        table::drop(active_seed_counts);')
# New package/types only: old package objects cannot have these identities/layouts.
src=replace(src,'    public struct Seed has key {\n        id: UID,','    public struct Seed has key {\n        id: UID,\n        registry_id: ID,\n        economy_version: u64,')
src=replace(src,'    public struct Tool has key, store {\n        id: UID,','    public struct Tool has key, store {\n        id: UID,\n        origin: ItemOrigin,')
src=replace(src,'    public struct Crate has key, store {\n        id: UID,','    public struct Crate has key, store {\n        id: UID,\n        origin: ItemOrigin,')
src=replace(src,'    public struct SeasonArchive has key {\n        id: UID,','    public struct SeasonArchive has key {\n        id: UID,\n        registry_id: ID,\n        rules_version: u64,\n        economy_version: u64,')
src=replace(src,'        let archive = SeasonArchive {\n            id: object::new(ctx),','        let archive = SeasonArchive {\n            id: object::new(ctx),\n            registry_id: object::id(registry), rules_version: registry.rules_version, economy_version: registry.economy_version,')
# No public free-Sapling or promotional route can mint competitive seeds/items.
for name in ['mint_sapling','plant_seed','send_promo_crate']:
 src=change_body(src,name,'        abort E_LEGACY_ROUTE_DISABLED')
# Candidate prices are confined to generated code, not live wallet or Move sources.
for const,value in [('GROWTH_DEPOSIT_MIST',10_000_000_000),('REFERRAL_SHARE_MIST',1_000_000_000),('SUPPLY_PRICE_REVIVAL_KIT',8_000_000_000),('SUPPLY_PRICE_DROUGHT_SHIELD',6_000_000_000),('SUPPLY_PRICE_RAIN_BARREL',3_000_000_000),('SUPPLY_PRICE_MULCH',3_000_000_000),('SUPPLY_PRICE_WATERING_BOOST',1_500_000_000)]:
 src,n=re.subn(r'(const '+const+r':\s*u64\s*=\s*)[\d_]+;[^\n]*',r'\g<1>'+str(value)+'; // isolated Season 1 candidate only',src);assert n==1

# Canonical NFT gate on the only enabled planting route. NFT is returned unchanged.
def plant(x):
 x=x.replace('plant_seed_with_nftree<NFTree: key>','plant_seed_with_nftree<NFTree: key + store>').replace('nftree: &NFTree','nftree: NFTree')
 x=replace(x,'        let owner = tx_context::sender(ctx);','        assert_nftree(&nftree);\n        let owner = tx_context::sender(ctx);\n        reserve_active_seed(registry, owner);')
 x=x.replace('object::id(nftree)','object::id(&nftree)')
 x=replace(x,'            id: object::new(ctx),','            id: object::new(ctx),\n            registry_id: object::id(registry), economy_version: registry.economy_version,')
 return replace(x,'        transfer::transfer(seed, owner);','        transfer::transfer(seed, owner);\n        transfer::public_transfer(nftree, owner);')
src=edit(src,'plant_seed_with_nftree',plant)
# Domain validation inside core; public active-action wrappers add NFT proof.
src=prepend(src,'assert_seed_current','        assert_seed_domain(registry, seed);')
for name in ['assert_admin','assert_season_active','route_paid_action','register_line','line_controls']:
 src=prepend(src,name,'        assert_rules(registry);')
src=prepend(src,'add_growth_points','        assert_seed_domain(registry, seed);')
src=prepend(src,'remove_seed_growth_points','        assert_seed_domain(registry, seed);')
src=prepend(src,'apply_tool_checked','        assert_tool_origin(registry, tool);')
src=prepend(src,'revive_seed_with_tool','        assert_tool_origin(registry, &tool);')
# Active wrappers are emitted in isolation.move.inc; old tests call private core.
for name in ['water_seed','revive_seed','revive_seed_with_tool']:
 src=src.replace(name+'(',name+'_checked(')
 src=src.replace('entry fun '+name+'_checked(','fun '+name+'_checked(')
# Preserve the exact old apply wrapper only for internal regression tests.
src=src.replace('apply_tool(', 'apply_tool_internal(')
src=src.replace('entry fun apply_tool_internal(', 'fun apply_tool_internal(')
# No core checked function is public/package-public.

# Origin checks on archive claims prevent cross-registry reward mixing.
src=prepend(src,'claim_archived_reward','        assert!(archive.rules_version == RULES_VERSION, E_RULES_VERSION);\n        assert!(archive.economy_version == ECONOMY_VERSION && seed.economy_version == archive.economy_version, E_ECONOMY_VERSION);\n        assert!(seed.registry_id == archive.registry_id, E_FOREIGN_REGISTRY);')
src=prepend(src,'sweep_archived_rewards','        assert!(archive.rules_version == RULES_VERSION, E_RULES_VERSION);\n        assert!(archive.economy_version == ECONOMY_VERSION, E_ECONOMY_VERSION);')
# Pay and record issuance atomically; preserve base allocation/referral arithmetic.
def buy_crate(x):
 x=replace(x,'        assert!(tier <= CRATE_MYTHIC, E_INVALID_CRATE_TIER);','        assert!(tier <= 6, E_INVALID_CRATE_TIER);')
 a=x.index('        let required =');b=x.index('        assert!(coin::value',a)
 x=x[:a]+'        let required = crate_price(tier);\n\n'+x[b:]
 x=replace(x,'        let crate_obj = Crate { id: object::new(ctx), tier };','        let id = object::new(ctx);\n        let origin = record_paid_receipt(registry, object::uid_to_inner(&id), tier, required, false, buyer);\n        let crate_obj = Crate { id, tier, origin };')
 return x
src=edit(src,'buy_crate',buy_crate)
def buy_drop(x):
 x=replace(x,'        let tool = Tool {\n            id: object::new(ctx),','        let id = object::new(ctx);\n        let origin = record_paid_receipt(registry, object::uid_to_inner(&id), 16 + drop, required, true, buyer);\n        let tool = Tool {\n            id, origin,')
 return x
src=edit(src,'buy_supply_drop',buy_drop)
def mint_tool(x):
 x=replace(x,'        crate_id: ID,','        origin: ItemOrigin,\n        crate_id: ID,')
 return replace(x,'Tool { id: object::new(ctx), kind:','Tool { id: object::new(ctx), origin, kind:')
src=edit(src,'mint_crate_tool',mint_tool)
def open_crate(x):
 x=replace(x,'registry: &Registry','registry: &mut Registry')
 x=replace(x,'        let opener = tx_context::sender(ctx);','        consume_crate_receipt(registry, &crate_obj);\n        let opener = tx_context::sender(ctx);')
 x=replace(x,'let Crate { id, tier } = crate_obj;','let Crate { id, tier, origin } = crate_obj;')
 x=x.replace('mint_crate_tool(crate_id_val,','mint_crate_tool(origin, crate_id_val,')
 x=replace(x,'        } else {\n            // Mythic crate:','        } else if (tier == CRATE_MYTHIC) {\n            // Mythic crate:')
 end=x.rfind('        };')
 x=x[:end]+'''        } else {
            let roll = random::generate_u8_in_range(&mut rng_gen, 0, 99);
            let mut items = partner_items(tier, roll);
            while (!vector::is_empty(&items)) {
                let ItemSpec { kind, uses, rarity } = vector::pop_back(&mut items);
                mint_crate_tool(origin, crate_id_val, opener, kind, uses, rarity, ctx);
            };
            vector::destroy_empty(items);
'''+x[end:]
 return x
src=edit(src,'open_crate',open_crate)
src=replace(src,'let Tool { id, kind: _, charges: _, rarity: _ } = tool;','let Tool { id, origin: _, kind: _, charges: _, rarity: _ } = tool;',2)
src=replace(src,'        let Seed {\n            id,','        let Seed {\n            id, registry_id: _, economy_version: _,')
src=prepend(src,'abandon_seed','        release_active_seed(registry, tx_context::sender(ctx));')
# Guard every exposed Registry entry before it changes/uses shared state.
entry_names=re.findall(r'entry fun\s+(\w+)(?:<[^\n]+>)?\s*\(',src)
for name in entry_names:
 a,b=span(src,name);head=src[a:src.index('{',a)]
 if re.search(r'\bregistry:\s*&(?:mut )?Registry\b',head):
  src=prepend(src,name,'        assert_rules(registry);')
# Default generated singleton is paused. Starting it is not part of this work.
src=edit(src,'init',lambda x:replace(x,'            paused: false,','            paused: true,'))

# Adapt original unit fixtures to the new domains. Test-only receipts are never
# reachable in published bytecode. These changes do not weaken production guards.
src=edit(src,'step1_seed',lambda x:x.replace('fun step1_seed(nft_id:', 'fun step1_seed(registry: &Registry, nft_id:').replace('Seed { id: object::new(ctx), sapling_id:', 'Seed { id: object::new(ctx), registry_id: object::id(registry), economy_version: registry.economy_version, sapling_id:'))
src=replace(src,'let mut seed = step1_seed(object::id_from_address(@0xCAFE)', 'let mut seed = step1_seed(&registry, object::id_from_address(@0xCAFE)')
# All other calls of the helper occur in fixtures with local variable r.
src=src.replace('= step1_seed(s.sapling_id', '= step1_seed(&r, s.sapling_id').replace('= step1_seed(object::id_from_address(@0xBEEF)', '= step1_seed(&r, object::id_from_address(@0xBEEF)')
src=edit(src,'step1_tool',lambda x:x.replace('fun step1_tool(kind:', 'fun step1_tool(registry: &mut Registry, kind:').replace('        Tool { id: object::new(ctx), kind:', '        let id = object::new(ctx);\n        let origin = record_paid_receipt(registry, object::uid_to_inner(&id), 0, crate_price(0), true, tx_context::sender(ctx));\n        Tool { id, origin, kind:'))
src=re.sub(r'(= step1_tool\()(?=b")',r'\1&mut r, ',src)
src=edit(src,'step1_drop_seed',lambda x:x.replace('Seed { id, sapling_id:', 'Seed { id, registry_id: _, economy_version: _, sapling_id:'))
# Existing watermark/foreign-seed test expects line-table failure, so retain
# that behavior while fixtures now contain correct registry provenance.

# Extra canonical test fixtures compile only under Move test mode.
src=src.rstrip()[:-1]+'\n'+(AREA/'isolation.move.inc').read_text()+'\n'+(AREA/'isolation-tests.move.inc').read_text()+'\n}\n'
# No production/public entry can reach the old generic free planting/promo body.
for name in ['mint_sapling','plant_seed','send_promo_crate']:
 a,b=span(src,name);assert 'abort E_LEGACY_ROUTE_DISABLED' in src[a:b]
assert 'entry fun water_seed_checked' not in src and 'public fun apply_tool_checked' not in src
assert src.count('fun record_paid_receipt(')==1
assert 'publi' not in src[src.index('    fun record_paid_receipt'):src.index('    fun record_paid_receipt')+5]
# Payment allocation routine stays unchanged except its version guard.
a,b=span(original,'route_paid_action');c,d=span(src,'route_paid_action')
assert src[c:d].replace('\n        assert_rules(registry);','')==original[a:b]

manifest='''[package]
name = "arboretum_season1_isolated"
edition = "2024.beta"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "58386edc269ef88ff0f40ab0a9d50e87cba80ca8" }

[addresses]
season1 = "0x0"

[dev-addresses]
canonical_fixture = "0xf6c6d439ea0da2f3e9ba79e4992a7a4c113215fbf54c442ac9020c315f953705"
legacy_fixture = "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b"
fake_fixture = "0xbad"
'''
(OUT/'sources').mkdir(parents=True,exist_ok=True);(OUT/'tests').mkdir(exist_ok=True)
(OUT/'Move.toml').write_text(manifest)
(OUT/'sources/arboretum.move').write_text(src)
(OUT/'tests/fixtures.move').write_text((AREA/'fixtures.move').read_text())
report={'step1_commit':'d18ed4420f60375c453e25f3f045d0135af5a66e','step1_sha256':hashlib.sha256(original.encode()).hexdigest(),'candidate_sha256':hashlib.sha256(src.encode()).hexdigest(),'scope':'Fresh origin isolated build only; existing contracts, wallet and Netlify unchanged','new_test_count':len(re.findall(r'#\[test(?:,|\])',(AREA/'isolation-tests.move.inc').read_text())),'production_prices_activated':False,'full_deployed_source_equivalence':False,'partner_tables':'Recovered from recorded deployed open_crate control flow; not inferred from website loot labels'}
(RESULTS/'preparation.json').write_text(json.dumps(report,indent=2)+'\n')
(RESULTS/'integration.patch').write_text(''.join(difflib.unified_diff(original.splitlines(True),src.splitlines(True),fromfile='step1',tofile='season1-isolated')))
print(json.dumps(report,indent=2))
