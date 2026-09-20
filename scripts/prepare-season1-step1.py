#!/usr/bin/env python3
"""Generate the isolated Step 1 Move candidate; never publish, sign or edit live files.

The saved source is NOT proven equivalent to the current deployed package.
This candidate changes Registry layout and is ONLY for a fresh package/type origin.
It must not be submitted as an upgrade of the live package. Production provenance,
partner-source reconciliation, inventory migration and reward cutover are separate gates.
"""
from pathlib import Path
import difflib
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
AREA = ROOT / 'contract' / 'season1-step1'
OUT = AREA / 'generated'
RESULTS = ROOT / 'step1-results'
SOURCE = ROOT / 'contract/sources/arboretum.move'
BASE_SHA256 = 'f0356e68c676e2e9864cce2d5a8593106ef9c3550c30e4b9a2b0b359620c2aa2'
BASE = '2338affe1dd984f5bc676cec7f3763d1f37a90cf'
original_bytes = SOURCE.read_bytes()
if hashlib.sha256(original_bytes).hexdigest() != BASE_SHA256:
    raise SystemExit('Saved source changed. Reconcile the new source; do not overwrite it.')
original = original_bytes.decode('utf-8')
src = original


def replace(text: str, before: str, after: str, count: int = 1) -> str:
    if text.count(before) != count:
        raise ValueError(f'Expected {count} exact matches, got {text.count(before)}: {before[:90]}')
    return text.replace(before, after)


def fn_span(text: str, name: str) -> tuple[int, int]:
    match = re.search(r'\bfun\s+' + re.escape(name) + r'(?:<[^\n]*>)?\s*\(', text)
    if not match:
        raise ValueError('Missing function ' + name)
    start = text.rfind('\n', 0, match.start()) + 1
    brace = text.index('{', match.end())
    depth = 0
    for i in range(brace, len(text)):
        if text[i] == '{': depth += 1
        elif text[i] == '}': depth -= 1
        if depth == 0:
            return start, i + 1
    raise ValueError('Unclosed function ' + name)


def edit_function(text: str, name: str, edit) -> str:
    a, b = fn_span(text, name)
    return text[:a] + edit(text[a:b]) + text[b:]


# Persistent per-NFT-and-season controls. The table does not get deleted when
# a Seed is abandoned; later ownership/recreation sees the same allowance.
src = replace(src, '        planted_saplings:     Table<ID, u64>,',
              '        planted_saplings:     Table<ID, u64>,\n        line_controls: Table<LineKey, LineControls>,')
src = replace(src, '            planted_saplings:     table::new<ID, u64>(ctx),',
              '            planted_saplings:     table::new<ID, u64>(ctx),\n            line_controls: table::new<LineKey, LineControls>(ctx),', 2)
src = replace(src, '            planted_saplings,\n        } = registry;',
              '            planted_saplings,\n            line_controls,\n        } = registry;')
src = replace(src, '        table::drop(planted_saplings);',
              '        table::drop(planted_saplings);\n        table::drop(line_controls);')
for name in ['plant_seed', 'plant_seed_with_nftree']:
    src = edit_function(src, name, lambda s: replace(s, '        let seed_id = object::id(&seed);',
             '        register_line(registry, &seed, now_ms);\n        let seed_id = object::id(&seed);'))


def fix_watering(s: str) -> str:
    s = replace(s, '''        // Min interval: ~21.6h
        let min_interval = ONE_DAY_MS - ONE_DAY_MS / 10;
        assert!(drought_ms >= min_interval || seed.bottomless_can_expiry_ms >= now_ms, E_ALREADY_WATERED_TODAY);''',
        '''        // Earning is independent of survival protection or timer-refresh tools.
        // Consume exactly one elapsed interval; no missed-day catch-up awards.
        let earning_gap_ms = consume_point_interval(registry, seed, now_ms);''')
    s = replace(s, '        seed.state = if (drought_days >= WILT_DAYS) STATE_WILTING else STATE_ALIVE;',
                   '        seed.state = STATE_ALIVE;')
    return replace(s, '        if (drought_days >= 2) {',
                      '        if (earning_gap_ms / ONE_DAY_MS >= 2) {')


src = edit_function(src, 'water_seed', fix_watering)


def fix_tool(s: str) -> str:
    # All test helpers call this exact implementation, not a separately modeled effect.
    s = replace(s, '    entry fun apply_tool(', '    fun apply_tool_checked(')
    s = replace(s, '        mut tool: Tool,', '        tool: &mut Tool,')
    s = replace(s, '        assert!(tool.charges > 0, E_NO_TOOL_CHARGES);',
        '        let _ = line_controls(registry, seed);\n        assert!(tool.charges > 0, E_NO_TOOL_CHARGES);')
    for count in [1, 2, 3, 5, 9, 10]:
        old = f'            seed.fertilizer_charges = seed.fertilizer_charges + {count};'
        s = replace(s, old, f'            queue_boost(seed, {count});', 2 if count == 5 else 1)
    for gp in [20, 30, 50]:
        old = f'            add_growth_points(registry, seed, owner, {gp});'
        s = replace(s, old, f'            consume_instant_allowance(registry, seed, now_ms);\n{old}')
    s = replace(s, '            seed.miracle_grow_applied = true;',
                   '            assert_double_available(seed);\n            seed.miracle_grow_applied = true;', 3)
    for duration in ['3 * ONE_DAY_MS', '7 * ONE_DAY_MS', 'BOTTOMLESS_DURATION_MS']:
        s = replace(s, f'            seed.bottomless_can_expiry_ms = now_ms + {duration};',
                       f'            extend_protection(seed, now_ms, {duration});')
    s = replace(s, '            seed.permanent_gp_bonus = seed.permanent_gp_bonus + 5;',
        '            consume_forest_allowance(registry, seed);\n            seed.permanent_gp_bonus = seed.permanent_gp_bonus + 5;')
    return replace(s, '        return_or_delete_tool(tool, owner);\n', '')


a, b = fn_span(src, 'apply_tool')
checked = fix_tool(src[a:b])
wrapper = '''    entry fun apply_tool(
        registry: &mut Registry,
        seed: &mut Seed,
        mut tool: Tool,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        apply_tool_checked(registry, seed, &mut tool, clock, ctx);
        return_or_delete_tool(tool, tx_context::sender(ctx));
    }

'''
src = src[:a] + wrapper + checked + src[b:]
controls = (AREA / 'controls.move.inc').read_text()
tests = (AREA / 'regression-tests.move.inc').read_text()
src = src.rstrip()[:-1] + '\n' + controls + '\n' + tests + '\n}\n'

# These payment, claim and admin functions must remain byte-identical to the saved
# baseline. They are NOT certified as complete/current simply by remaining unchanged.
unchanged = ['route_paid_action','pay_direct_invite_shop_bonus','buy_crate',
             'open_crate','claim_reward','claim_archived_reward','revive_seed',
             'revive_seed_with_tool','abandon_seed','start_season','reset_season']
for name in unchanged:
    a,b = fn_span(original,name)
    c,d = fn_span(src,name)
    if original[a:b] != src[c:d]: raise ValueError('Out-of-scope function changed: '+name)
if '|| seed.bottomless_can_expiry_ms >= now_ms' in src:
    raise ValueError('Unsafe point-readiness condition survived')
if src.count('register_line(registry, &seed, now_ms);') != 2:
    raise ValueError('Both planting paths must initialize line state')

manifest = '''[package]
name = "arboretum_step1_candidate"
edition = "2024.beta"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "58386edc269ef88ff0f40ab0a9d50e87cba80ca8" }

[addresses]
arboretum = "0x0"
'''
(OUT/'sources').mkdir(parents=True, exist_ok=True)
RESULTS.mkdir(exist_ok=True)
(OUT/'Move.toml').write_text(manifest)
(OUT/'sources/arboretum.move').write_text(src)
(RESULTS/'core-fix.patch').write_text(''.join(difflib.unified_diff(
    original.splitlines(keepends=True), src.splitlines(keepends=True),
    fromfile='saved-baseline/arboretum.move', tofile='isolated-candidate/arboretum.move')))
report = {
    'baseline_commit':BASE,'baseline_sha256':BASE_SHA256,
    'candidate_sha256':hashlib.sha256(src.encode()).hexdigest(),
    'new_regression_tests':len(re.findall(r'#\[test(?:,|\])', tests)),
    'original_tests_retained':len(re.findall(r'#\[test(?:,|\])', original)),
    'out_of_scope_functions_unchanged':unchanged,
    'production_source_unchanged':SOURCE.read_bytes()==original_bytes,
    'warning':'Fresh-type-origin isolated candidate ONLY. Not a live package upgrade. Partner source, canonical NFT gating, old-package cutoff, reward migration and UI integration remain release gates.'
}
(RESULTS/'preparation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
