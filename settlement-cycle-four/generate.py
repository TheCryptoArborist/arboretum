#!/usr/bin/env python3
"""Reproduce the isolated Season 4 implementation from the frozen Season 3 source.
No network, blockchain execution, credentials, or deployment are used here.
Generated files are committed as ordinary readable source after their tests pass.
"""
from pathlib import Path
import re
import hashlib
import json
import subprocess
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'settlement-cycle-three'
DEST = ROOT / 'settlement-cycle-four'
BASE = 'a3379ed9e564de153c5a0ea5f0d24d15a875da92'
FILES = ['common.mjs', 'rollover-core.mjs', 'care-core.mjs', 'admin.mjs', 'admin.css', 'index.html', 'rollover-fixtures.mjs', 'care-fixtures.mjs', 'common.test.mjs', 'rollover-core.test.mjs', 'care-core.test.mjs', 'controller.test.mjs', 'check-live.mjs']
LABELS = {'Season 2': 'Season 3', 'Season 3': 'Season 4', 'season-three': 'season-four', 'season-3': 'season-4', 'ThirdSeason': 'FourthSeason', 'third-cycle': 'fourth-cycle', 'third cycle': 'fourth cycle', 'third-season': 'fourth-season'}
pattern = re.compile('|'.join(map(re.escape, LABELS)))
sha = lambda data: hashlib.sha256(data).hexdigest()
manifest = {'baselineCommit': BASE, 'files': {}}
for name in FILES:
    original = subprocess.check_output(['git', 'show', BASE + ':settlement-cycle-three/' + name], cwd=ROOT)
    assert (SOURCE / name).read_bytes() == original, 'The retained Season 3 source changed: ' + name
    s = pattern.sub(lambda m: LABELS[m[0]], original.decode())
    s = s.replace('[EXPECTED.olderSeedId, EXPECTED.previousSeedId', '[EXPECTED.oldestSeedId, EXPECTED.olderSeedId, EXPECTED.previousSeedId')
    s = s.replace('[clone(state.olderSeed), clone(state.oldSeed)', '[clone(state.oldestSeed), clone(state.olderSeed), clone(state.oldSeed)')
    s = s.replace('[clone(fixture.state.olderSeed), clone(fixture.state.oldSeed)', '[clone(fixture.state.oldestSeed), clone(fixture.state.olderSeed), clone(fixture.state.oldSeed)')
    if name == 'common.mjs':
        s = s.replace("seasonId: '3', durationMs:", "seasonId: '4', durationMs:")
        s = s.replace("previousSeasonId: '2',", "previousSeasonId: '3',")
        substitutions = {
            '1791729927707': '1792011931137', '1794321927707': '1794603931137', '1794926727707': '1795208731137',
            'EvJHfMtHpGNcGoKndFNTafx9JSn8rKHwTPwiXuKD4pCB': '7MLWVofmU1wnoNjqVwYEm3WxRpjMF8AddqojX48YYFKL',
            "previousSeedId: '0x4e3200ee3a42f82158e14e5c14f37a3ed33134c7b1e60c80b2178e94772dc6f2'": "previousSeedId: '0x949d45fc9e2861ec3c75d46ff2e6b277c9692470ab5b929fc76d6dffe5b9ed1b'",
            "olderSeedId: '0x2b06e3f3900d08eff3921f374137c2b2cb87f2f7bbf6cdb5ff7f1e3238a1046d'": "olderSeedId: '0x4e3200ee3a42f82158e14e5c14f37a3ed33134c7b1e60c80b2178e94772dc6f2',\n  oldestSeedId: '0x2b06e3f3900d08eff3921f374137c2b2cb87f2f7bbf6cdb5ff7f1e3238a1046d'",
            '1794151496120': '1794431510191',
        }
        for a, b in substitutions.items():
            assert a in s, (name, a)
            s = s.replace(a, b)
        old = """  const olderSeed = ownedSeeds.find(x => x.address === EXPECTED.olderSeedId);
  requireThat(olderSeed && contents(olderSeed).season_id === '1' && contents(olderSeed).sapling_id === EXPECTED.previousNftId &&
    contents(olderSeed).reward_processed && contents(olderSeed).growth_points === '0' && contents(olderSeed).cutoff_growth_points === '0',
    'The completed Season 1 Seed must remain in this owner inventory.');"""
        new = """  const olderSeed = ownedSeeds.find(x => x.address === EXPECTED.olderSeedId);
  const oldestSeed = ownedSeeds.find(x => x.address === EXPECTED.oldestSeedId);
  for (const [seed, season] of [[oldestSeed, '1'], [olderSeed, '2']]) {
    requireThat(seed && contents(seed).season_id === season && contents(seed).sapling_id === EXPECTED.previousNftId &&
      contents(seed).reward_processed && contents(seed).growth_points === '0' && contents(seed).cutoff_growth_points === '0',
      `The completed Season ${season} Seed must remain in this owner inventory.`);
  }"""
        assert old in s
        s = s.replace(old, new).replace('seasonSeeds, oldSeed, olderSeed,', 'seasonSeeds, oldSeed, olderSeed, oldestSeed,')
        s = s.replace("'oldSeed', 'olderSeed']", "'oldSeed', 'olderSeed', 'oldestSeed']")
    if name == 'rollover-core.mjs':
        s = s.replace('state.ownedSeeds.length === 2', 'state.ownedSeeds.length === 3')
    if name == 'rollover-fixtures.mjs':
        a = "const now = options.nowMs ?? Number(BigInt(EXPECTED.previousCutoffMs) + BigInt(EXPECTED.reviewWindowMs)) + 10000;"
        b = "const now = options.nowMs ?? Math.max(Number(BigInt(EXPECTED.previousCutoffMs) + BigInt(EXPECTED.reviewWindowMs)), Date.parse(dataOf(capturedInputs).checkpoint.timestamp)) + 10000;"
        assert a in s
        s = s.replace(a, b)
    if name == 'common.test.mjs':
        start = s.index("test('ordinary reset stays")
        end = s.index("\ntest('completed predecessor", start)
        s = s[:start] + """test('ordinary reset boundary checks remain mandatory even with an already-paid predecessor', async () => {
  // The real Season 3 claim occurred after its reset gate. Never backdate that
  // receipt to fabricate a historical pre-claim observation. Exercise the pure
  // preparation gate with a labeled offline clock perturbation instead.
  const current = await inspect();
  assert.equal(current.status, 'rollover-ready');
  const before = { ...current, status: 'rollover-wait', clockMs: String(resetReadyMs - 1) };
  await assert.rejects(prepareRollover(before), error => error.code === 'NOT_READY');
  await assert.rejects(prepareRollover({ ...before, status: 'rollover-ready' }),
    error => error.code === 'ROLLOVER_NOT_READY');
  const boundary = { ...current, clockMs: String(resetReadyMs) };
  const packet = await prepareRollover(boundary);
  assert.equal(packet.seasonId, '4'); assert.equal(packet.durationMs, '172800000');
  assert.deepEqual(packet.transaction.getData().commands.map(x => x.MoveCall.function),
    ['reset_season', 'start_season_for_duration']);
});
""" + s[end:]
        s = s.replace('two processed Seeds', 'three processed Seeds').replace('offlineSnapshotAt(resetReadyMs)', 'offlineSnapshotAt(capturedNow())')
        s = s.replace('f.inputs, f.proof, resetReadyMs)', 'f.inputs, f.proof, capturedNow())').replace('/Seed.*missing|Season 1 Seed/', '/Seed.*missing|Season [12] Seed/')
    if name == 'rollover-core.test.mjs':
        s = s.replace('keeps the early rollover locked', 'permits rollover only after the normal reset gate')
        s = s.replace("assert.equal(state.status, 'rollover-wait');", "assert.equal(state.status, 'rollover-ready');").replace("'1794408327707'", "'1794690331137'")
        s = s.replace('state.ownedSeeds.length, 2', 'state.ownedSeeds.length, 3')
        s = s.replace("  await assert.rejects(() => prepareRollover(state), /Refresh the completed Season 3/);", "  assert.equal((await prepareRollover(state)).seasonId, '4');")
        s = s.replace("seasonId: '3'", "seasonId: '4'").replace(".current_season_id = '4';", ".current_season_id = '5';")
        s = s.replace("e.events.nodes[2].contents.json.season_id = '4'", "e.events.nodes[2].contents.json.season_id = '5'")
    if name == 'care-core.test.mjs':
        s = s.replace('.ownedSeeds.length, 2', '.ownedSeeds.length, 3').replace(".playerGrowthSeason).value, '2'", ".playerGrowthSeason).value, '3'")
        s = s.replace(".plantedSapling).value, '2'", ".plantedSapling).value, '3'").replace("['1', '3', '4']", "['1', '2', '4', '5']")
        s = s.replace(".current_season_id = '4';", ".current_season_id = '5';")
    if name == 'controller.test.mjs':
        s = s.replace("'arboretum:season-two:v1:'", "'arboretum:season-three:v1:'").replace('BASE_TIME = 1794412800000', 'BASE_TIME = 1794859200000')
        s = s.replace('/Nov 11, 2026, 8:45:27 AM CST/', '/Nov 14, 2026, 3:05:31 PM CST/')
        s = s.replace("registryId: EXPECTED.registryId, seasonId: '2',", "registryId: EXPECTED.registryId, seasonId: '3',")
        s = s.replace("assert.ok(unfolded.includes(plant.digest)); assert.ok(unfolded.includes('TRIGGER:PT0M\\r\\n'));", "assert.ok(unfolded.includes(plant.digest)); assert.ok(unfolded.includes('TRIGGER:PT0M\\r\\n'));\n    assert.ok(unfolded.includes('TRIGGER:PT1H\\r\\n'));\n    assert.equal(unfolded.split('BEGIN:VALARM').length - 1, 2);")
    if name == 'check-live.mjs':
        s = s.replace('state.ownedSeeds.length, 2', 'state.ownedSeeds.length, 3').replace('seasonThreeHasStarted', 'seasonFourHasStarted')
    if name == 'index.html':
        s = s.replace('href="/admin/season-two/"', 'href="/admin/season-three/"')
        s = s.replace('EvJHfMtHpGNcGoKndFNTafx9JSn8rKHwTPwiXuKD4pCB', '7MLWVofmU1wnoNjqVwYEm3WxRpjMF8AddqojX48YYFKL')
    if name == 'admin.mjs':
        s = s.replace("'END:VALARM', 'END:VEVENT', 'END:VCALENDAR',", """'END:VALARM',
    ...(starts + 3600000 < Number(cycle.cutoffMs) ? [
      'BEGIN:VALARM', 'TRIGGER:PT1H', 'ACTION:DISPLAY',
      'DESCRIPTION:Backup reminder: water your Seed if you have not already confirmed watering in Slush.',
      'END:VALARM',
    ] : []),
    'END:VEVENT', 'END:VCALENDAR',""")
        s = s.replace("'. Import the downloaded event into your calendar to enable its reminder.'", "'. Save this event in your phone calendar before leaving. It includes an opening alert and a one-hour backup when time permits; check your calendar notification settings.'")
    if name == 'controller.test.mjs':
        s += """

test('watering calendar omits a backup that would fall at or beyond the growing cutoff', async () => {
  const h = await harness();
  try {
    const original = h.receipts.plant, starts = wateringReminderTime(original, h.receipts.rollover);
    for (const margin of [3600000, 1800000]) {
      const cycle = { ...h.receipts.rollover, cutoffMs: String(starts + margin) };
      const plant = { ...original, cutoffMs: cycle.cutoffMs };
      const ics = createWateringCalendar(plant, cycle, BASE_TIME).replace(/\\r\\n /g, '');
      assert.ok(ics.includes('TRIGGER:PT0M\\r\\n'));
      assert.ok(!ics.includes('TRIGGER:PT1H\\r\\n'));
      assert.equal(ics.split('BEGIN:VALARM').length - 1, 1);
    }
  } finally { h.controller.destroy(); }
});
"""
    if name == 'common.test.mjs':
        s += """

for (const [idKey, season] of [['oldestSeedId', '1'], ['olderSeedId', '2']]) {
  for (const [field, value] of [['season_id', '99'], ['sapling_id', EXPECTED.registryId], ['reward_processed', false], ['growth_points', '10'], ['cutoff_growth_points', '10']]) {
    test(`processed Season ${season} inventory rejects changed ${field}`, async () => {
      const inputs = observedRolloverInputs();
      const seed = inputs.data.ownedSeeds.nodes.find(x => x.address === EXPECTED[idKey]);
      contents(seed)[field] = value;
      await assert.rejects(inspect(inputs), /completed Season/);
    });
  }
}

test('a current snapshot dated before the actual predecessor claim cannot authorize rollover', async () => {
  const earlier = resetReadyMs;
  const fixture = offlineSnapshotAt(earlier);
  await assert.rejects(inspect(fixture.inputs, fixture.proof, earlier), /predates the Season 3 claim/);
});
"""
    target = DEST / name
    if target.exists():
        assert target.read_text() == s, 'Refusing to overwrite an edited generated file: ' + name
    else:
        target.write_text(s)
    manifest['files'][name] = {'baselineSha256': sha(original), 'outputSha256': sha(s.encode())}
integration = ROOT / 'settlement-integration/build-review.mjs'
original = subprocess.check_output(['git', 'show', BASE + ':settlement-integration/build-review.mjs'], cwd=ROOT).decode()
append = """
// Additive Season 4 owner test. All preceding build and preservation checks
// have already passed; its independent gate pins every existing runtime byte.
const { buildSeasonFour } = await import('../settlement-cycle-four/build.mjs');
const seasonFour = await buildSeasonFour();
console.log('Season 4 review build: ' + seasonFour.existingApplicationFilesPreserved +
  ' existing files preserved; ' + seasonFour.completeApplicationFileCount + ' total.');
"""
assert integration.read_text() in [original, original + append], 'Unexpected integration build edits'
integration.write_text(original + append)
(DEST / 'source-map.json').write_text(json.dumps(manifest, indent=2) + '\n')
print('Generated the isolated Season 4 implementation; existing runtime source retained.')
