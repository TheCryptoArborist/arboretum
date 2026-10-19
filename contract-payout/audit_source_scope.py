#!/usr/bin/env python3
"""Document source scope and gate preservation of the reviewed game economics.

This is a token comparison, not an optimizer or a Move semantic equivalence
proof. Comments and whitespace are ignored. Any permitted replacement is an
explicit, function-specific token sequence shown in the resulting report.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
TOKEN = re.compile(r'(?:b|x)?"(?:\\.|[^"\\])*"|//[^\n]*|/\*.*?\*/|'
                   r'[A-Za-z_]\w*|0x[0-9A-Fa-f]+|[0-9][0-9_]*|::|==|!=|<=|>=|&&|\|\||<<|>>|[^\s]', re.DOTALL)


def tokens(source: str) -> list[str]:
    return [match[0] for match in TOKEN.finditer(source)
            if not match[0].startswith(('//', '/*'))]


def fingerprint(value) -> str:
    return hashlib.sha256(json.dumps(value, separators=(',', ':'), sort_keys=True).encode()).hexdigest()


def extract(source: str) -> tuple[dict, dict]:
    values = tokens(source)
    constants, functions = {}, {}
    i = 0
    while i < len(values):
        if values[i] == 'const':
            name = values[i + 1]
            end = values.index(';', i + 1)
            if name in constants:
                raise ValueError(f'Duplicate source constant {name}')
            constants[name] = values[i:end + 1]
            i = end + 1
        elif values[i] == 'fun':
            name = values[i + 1]
            start = values.index('{', i + 1)
            depth, end = 1, start + 1
            while depth:
                if end >= len(values):
                    raise ValueError(f'Unterminated function {name}')
                depth += (values[end] == '{') - (values[end] == '}')
                end += 1
            if name in functions:
                raise ValueError(f'Duplicate source function {name}')
            functions[name] = {'signature': values[i:start], 'body': values[start + 1:end - 1]}
            i = end
        else:
            i += 1
    return constants, functions


def replace_exactly_once(values: list[str], before: str, after: str) -> list[str]:
    old, new = tokens(before), tokens(after)
    indices = [i for i in range(len(values) - len(old) + 1) if values[i:i + len(old)] == old]
    if len(indices) != 1:
        raise ValueError(f'Expected exactly one reviewed sequence, found {len(indices)}: {before}')
    i = indices[0]
    return values[:i] + new + values[i + len(old):]


# These replacements describe reviewed source additions, not arbitrary patterns.
# They are applied only to the named candidate function before comparison.
VERSION_FIELD = ('version: VERSION,', '')
VERSION_DESTRUCTURE = ('version: _,', '')
REGISTRY_GUARD = ('assert_registry_version(registry);', '')
FUNDING_GUARD = ('assert_pool_funding_open(registry, clock);', 'assert!(!registry.paused, E_PAUSED);')
SEED_FIELDS = ('version: VERSION, registry_id: object::id(registry), cutoff_growth_points: 0, reward_processed: false,', '')
SYNC_NEW_SEED = ('sync_cutoff_points(registry, &mut seed);', '')
SYNC_SEED = ('sync_cutoff_points(registry, seed);', '')
PROTECTED = {
    'route_paid_action': [],
    'pay_direct_invite_shop_bonus': [],
    'payout_from_challenge_pot': [],
    'add_growth_points': [],
    'supply_drop_details': [],
    'roll_common': [],
    'roll_uncommon': [],
    'roll_rare': [],
    'roll_legendary': [],
    'mint_crate_tool': [VERSION_FIELD],
    'return_or_delete_tool': [('assert!(tool.version == VERSION, E_WRONG_VERSION);', ''), VERSION_DESTRUCTURE],
    'buy_crate': [FUNDING_GUARD, VERSION_FIELD],
    'send_promo_crate': [('assert_admin_cap(registry, _cap, ctx);', 'assert_admin(registry, ctx);'), REGISTRY_GUARD, VERSION_FIELD],
    'buy_boom_chest': [('buy_crate(registry, CRATE_BOOM, payment, clock, ctx);', 'buy_crate(registry, CRATE_BOOM, payment, ctx);')],
    'buy_victory_chest': [('buy_crate(registry, CRATE_VICTORY, payment, clock, ctx);', 'buy_crate(registry, CRATE_VICTORY, payment, ctx);')],
    'buy_supply_drop': [FUNDING_GUARD, VERSION_FIELD],
    'open_crate': [('assert!(crate_obj.version == VERSION, E_WRONG_VERSION);', ''), REGISTRY_GUARD, VERSION_DESTRUCTURE],
    'plant_seed': [('assert!(sapling.version == VERSION, E_WRONG_VERSION);', ''), REGISTRY_GUARD, SEED_FIELDS, SYNC_NEW_SEED],
    'plant_seed_with_nftree': [REGISTRY_GUARD, SEED_FIELDS, SYNC_NEW_SEED],
    'water_seed': [REGISTRY_GUARD, SYNC_SEED],
    'apply_tool': [('assert!(tool.version == VERSION, E_WRONG_VERSION);', ''), REGISTRY_GUARD, SYNC_SEED],
}
CLOCK_SIGNATURE_ADDITIONS = {'buy_crate', 'buy_boom_chest', 'buy_victory_chest', 'buy_supply_drop'}


def audit(baseline_source: str, candidate_source: str,
          baseline_production: set[str], candidate_production: set[str]) -> dict:
    baseline_constants, baseline = extract(baseline_source)
    candidate_constants, candidate = extract(candidate_source)
    if not baseline_production <= baseline.keys() or not candidate_production <= candidate.keys():
        raise ValueError('Source function inventory does not cover compiled production functions')
    constant_rows = []
    for name in sorted(baseline_constants.keys() | candidate_constants.keys()):
        a, b = baseline_constants.get(name), candidate_constants.get(name)
        constant_rows.append({'name': name, 'legacy_tokens': a, 'candidate_tokens': b,
                              'unchanged': a == b,
                              'protected_existing_non_error_constant': a is not None and not name.startswith('E_')})
    altered_constants = [row['name'] for row in constant_rows
                         if row['protected_existing_non_error_constant'] and not row['unchanged']]
    if altered_constants:
        raise ValueError(f'Existing economic/gameplay constants changed: {altered_constants}')

    protected_rows = []
    for name, changes in PROTECTED.items():
        if name not in baseline_production or name not in candidate_production:
            raise ValueError(f'Missing protected production function {name}')
        normalized = candidate[name]['body']
        for before, after in changes:
            normalized = replace_exactly_once(normalized, before, after)
        body_match = normalized == baseline[name]['body']
        normalized_signature = candidate[name]['signature']
        if name in CLOCK_SIGNATURE_ADDITIONS:
            normalized_signature = replace_exactly_once(normalized_signature, 'clock: &Clock,', '')
        signature_match = normalized_signature == baseline[name]['signature']
        protected_rows.append({
            'name': name,
            'body_tokens_equal_after_listed_changes': body_match,
            'signature_tokens_equal_after_listed_clock_parameter': signature_match,
            'legacy_body_tokens_sha256': fingerprint(baseline[name]['body']),
            'candidate_body_tokens_sha256': fingerprint(candidate[name]['body']),
            'normalized_candidate_body_tokens_sha256': fingerprint(normalized),
            'reviewed_candidate_to_legacy_token_replacements': [{'from': before, 'to': after} for before, after in changes],
            'new_clock_parameter': name in CLOCK_SIGNATURE_ADDITIONS,
        })
        if not body_match or not signature_match:
            raise ValueError(f'Unreviewed change in protected economics/gameplay function: {name}')

    function_rows = []
    for name in sorted(baseline_production | candidate_production):
        a = baseline.get(name) if name in baseline_production else None
        b = candidate.get(name) if name in candidate_production else None
        function_rows.append({'name': name, 'legacy_present': a is not None, 'candidate_present': b is not None,
                              'source_signature_and_body_tokens_identical': a == b,
                              'legacy_tokens_sha256': fingerprint(a) if a else None,
                              'candidate_tokens_sha256': fingerprint(b) if b else None,
                              'protected_economics_or_care_function': name in PROTECTED})
    return {
        'schema_version': 1,
        'status': 'EXISTING_CONSTANTS_AND_PROTECTED_ECONOMICS_PRESERVED',
        'completed_at_utc': datetime.now(timezone.utc).isoformat(),
        'auditor_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'baseline_source_sha256': hashlib.sha256(baseline_source.encode()).hexdigest(),
        'candidate_source_sha256': hashlib.sha256(candidate_source.encode()).hexdigest(),
        'protected_existing_non_error_constants': sum(row['protected_existing_non_error_constant'] for row in constant_rows),
        'protected_function_count': len(protected_rows),
        'existing_production_functions_with_identical_signature_and_body_tokens': sum(row['source_signature_and_body_tokens_identical'] for row in function_rows),
        'constants': constant_rows,
        'protected_functions': protected_rows,
        'production_function_inventory': function_rows,
        'limitations': [
            'Whitespace/comments are ignored; remaining tokens, literal values, arithmetic, call order, and branches are compared.',
            'The new module has different type identities. A token-identical local body can call helpers that gained version, registry, or settlement checks.',
            'Only the 21 explicitly listed economics and care functions are restricted to the listed substitutions; other changed or added production functions remain visible in the inventory and require settlement review.',
            'Legacy bytecode identity is a separate, stronger check and is not established by this source comparison.',
        ],
    }
