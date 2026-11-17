#!/usr/bin/env python3
"""Generate isolated Season 4 source from the pinned Season 3 baseline.
Original application, contracts, build configuration and dependencies stay untouched.
All edits below are explicit, counted, reviewable source transformations.
"""
from pathlib import Path
import hashlib, json, re
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'settlement-cycle-three'
TARGET = ROOT / 'settlement-cycle-four'
BASELINE = {'common.mjs': '74a72f8edf24045cd861d0360c8e4b7c387dc1a441660a817fae46564b7a6a95', 'rollover-core.mjs': '469cfcb76b8b7a1823c457b90ac04e812aaf45e6182cfe1e11bd75d6f33f1867', 'care-core.mjs': 'a6e5f3e46da5fce6f464235ab20217511505e90b266180a0a009d8ab95522db2', 'admin.mjs': '032c475ad410226285e821bb8991e6fc96c68e210024a8b510346e00975df45d', 'index.html': 'c1b2cf159f986614762993f9c57aeebdb9068b2fef36bc4e3b9312556cb0b911', 'admin.css': '598b23593b29c3da03f13a9a626babd9bf8e2d35c224db0982ba86af95380422', 'rollover-fixtures.mjs': '2316d15b1a9c63cea2d4ed1813868a78d7e6ad364c72ea3b3cd8cfdd81fb5bd6', 'care-fixtures.mjs': '62e2f8894c41ad3edbda9e087942778619020ff44c9f111acdf55d2a0957d902', 'common.test.mjs': 'cd91622edb738415280caaa53bbc25d3449d90c20ba4d03dbdf8e5d1bd87a5c7', 'rollover-core.test.mjs': '91f1e004c947eaa582b1e6f6d2924a0608b716d9b4286c895bd77efb7ed27ea2', 'care-core.test.mjs': 'f2cadf15ac69bb48d5f928acdd50af6fa9f91ad8286e6e8e4fff4f00ac054494', 'controller.test.mjs': '163e3c5efd6e1429bb30626d0d2fb6d7a2eb308c4a190fa3fe9e72d80894e5d4'}

def replace(text, old, new, count=1):
    actual = text.count(old)
    assert actual == count, f'Expected {count} occurrences of {old!r}, found {actual}'
    return text.replace(old, new)

def generate():
    generated = {}
    for name, expected in BASELINE.items():
        raw = (SOURCE / name).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == expected, f'Season 3 baseline changed: {name}'
        text = raw.decode()
        text = re.sub(r'Season ([23])', lambda m: 'Season ' + str(int(m[1])+1), text)
        text = text.replace('season-three', 'season-four').replace('season-3', 'season-4')
        text = text.replace('third', 'fourth').replace('Third', 'Fourth')
        text = replace(text, '[EXPECTED.olderSeedId, EXPECTED.previousSeedId',
            '[EXPECTED.olderSeedId, EXPECTED.middleSeedId, EXPECTED.previousSeedId',
            text.count('[EXPECTED.olderSeedId, EXPECTED.previousSeedId'))
        if name == 'common.mjs':
            for old,new in {
                "seasonId: '3'": "seasonId: '4'",
                "previousSeasonId: '2'": "previousSeasonId: '3'",
                "previousStoredStartMs: '1791729927707'": "previousStoredStartMs: '1792011931137'",
                "previousCutoffMs: '1794321927707'": "previousCutoffMs: '1794603931137'",
                "previousClaimDeadlineMs: '1794926727707'": "previousClaimDeadlineMs: '1795208731137'",
                "previousClaimDigest: 'EvJHfMtHpGNcGoKndFNTafx9JSn8rKHwTPwiXuKD4pCB'": "previousClaimDigest: '7MLWVofmU1wnoNjqVwYEm3WxRpjMF8AddqojX48YYFKL'",
                "previousSeedId: '0x4e3200ee3a42f82158e14e5c14f37a3ed33134c7b1e60c80b2178e94772dc6f2'": "previousSeedId: '0x949d45fc9e2861ec3c75d46ff2e6b277c9692470ab5b929fc76d6dffe5b9ed1b',\n  middleSeedId: '0x4e3200ee3a42f82158e14e5c14f37a3ed33134c7b1e60c80b2178e94772dc6f2'",
                "previousPlantedAtMs: '1794151496120'": "previousPlantedAtMs: '1794431510191'",
            }.items(): text=replace(text,old,new)
            text=replace(text, "  const seasonSeeds = ownedSeeds.filter", """  const middleSeed = ownedSeeds.find(x => x.address === EXPECTED.middleSeedId);
  requireThat(middleSeed && contents(middleSeed).season_id === '2' && contents(middleSeed).sapling_id === EXPECTED.previousNftId &&
    contents(middleSeed).reward_processed && contents(middleSeed).growth_points === '0' && contents(middleSeed).cutoff_growth_points === '0',
    'The completed Season 2 Seed must remain in this owner inventory.');
  const seasonSeeds = ownedSeeds.filter""")
            text=replace(text, 'seasonSeeds, oldSeed, olderSeed,', 'seasonSeeds, oldSeed, olderSeed, middleSeed,')
            text=replace(text, "'oldSeed', 'olderSeed']", "'oldSeed', 'olderSeed', 'middleSeed']")
        if name == 'rollover-core.mjs':
            text=replace(text,'state.ownedSeeds.length === 2', 'state.ownedSeeds.length === 3')
            text=replace(text,'the two processed previous Seeds','the three processed previous Seeds')
        if name == 'care-fixtures.mjs':
            text=replace(text, 'clone(state.olderSeed), clone(state.oldSeed)', 'clone(state.olderSeed), clone(state.middleSeed), clone(state.oldSeed)')
            text=replace(text, 'clone(fixture.state.olderSeed), clone(fixture.state.oldSeed)',
                'clone(fixture.state.olderSeed), clone(fixture.state.middleSeed), clone(fixture.state.oldSeed)',2)
        if name == 'rollover-fixtures.mjs':
            text=replace(text, 'Number(BigInt(EXPECTED.previousCutoffMs) + BigInt(EXPECTED.reviewWindowMs)) + 10000',
                'Math.max(Number(BigInt(EXPECTED.previousCutoffMs) + BigInt(EXPECTED.reviewWindowMs)), Date.parse(dataOf(capturedInputs).checkpoint.timestamp)) + 10000')
        if name == 'admin.mjs':
            text=replace(text, 'SEASON 3 START', 'SEASON 4 START')
            text=replace(text, "import * as care from './care-core.mjs';", "import * as care from './care-core.mjs';\nimport { createWateringCalendar as exportCalendar } from './watering-plan.mjs';")
            start=text.index('  const starts = wateringReminderTime(plant, cycle);',text.index('export function createWateringCalendar'))
            end=text.index('\n}\n',start)
            text=text[:start]+"""  wateringReminderTime(plant, cycle);
  return exportCalendar(plant, cycle, { seasonId: EXPECTED.seasonId,
    registryId: EXPECTED.registryId, pageUrl: EXPECTED.origin + '/admin/season-four/',
    nowMs: generatedAt });"""+text[end:]
            text=replace(text,"estimatedClock() >= at", "estimatedClock() >= Number(plant.waterReadyMs)",2)
            text=replace(text,"ensure(estimatedClock() < at,", "ensure(estimatedClock() < Number(state.receipts.plant.waterReadyMs),")
            text=replace(text, "Import the downloaded event into your calendar to enable its reminder.",
                "Import both calendar events: the first alert and a backup 15 minutes later. Phone alerts depend on your calendar notification settings.")
            text=replace(text, "Open the file and save the event in your calendar. Its alert is set for ",
                "Open the file and save both events in your calendar. The first alert is set for ")
        if name == 'index.html':
            text=replace(text, 'SEASON 3', 'SEASON 4', 2)
            text=replace(text, 'href="/admin/season-two/"', 'href="/admin/season-three/"')
            text=replace(text, 'EvJHfMtHpGNcGoKndFNTafx9JSn8rKHwTPwiXuKD4pCB', '7MLWVofmU1wnoNjqVwYEm3WxRpjMF8AddqojX48YYFKL')
            text=replace(text, 'Add watering to my calendar', 'Add watering and backup reminders')
            text=replace(text, 'Download the event, then import it into your calendar.',
                'Download and save both calendar events: the first watering appointment and a backup 15 minutes later. Enable calendar notifications on your phone.')
        if name == 'common.test.mjs':
            for expression in ['inputs', 'proof', 'f.inputs', 'f.proof', 'p']:
                text = re.sub(r'(?<![.\w])' + re.escape(expression) + r'\.data\.', 'dataOf(' + expression + ').', text)
            start=text.index("test('ordinary reset")
            end=text.index("test('completed predecessor",start)
            text=text[:start]+"""test('ordinary reset boundary is checked independently of the late predecessor claim', async () => {
  // Actual Season 3 was claimed after the reset boundary. Do not invent a
  // mainnet observation or claim before it. Vary only the pure gate's Clock.
  const state = await inspect();
  assert.equal(state.status, 'rollover-ready');
  const waiting = { ...state, status: 'rollover-wait', clockMs: String(resetReadyMs - 1) };
  await assert.rejects(prepareRollover(waiting), error => error.code === 'NOT_READY');
  await assert.rejects(prepareRollover({ ...waiting, status: 'rollover-ready' }), error => error.code === 'ROLLOVER_NOT_READY');
  const packet = await prepareRollover({ ...state, clockMs: String(resetReadyMs) });
  assert.equal(packet.seasonId, '4'); assert.equal(packet.durationMs, '172800000');
  assert.deepEqual(packet.transaction.getData().commands.map(x => x.MoveCall.function), ['reset_season', 'start_season_for_duration']);
});

"""+text[end:]
            text=text.replace('two processed Seeds','three processed Seeds')
            text=replace(text,'offlineSnapshotAt(resetReadyMs)', 'offlineSnapshotAt(capturedNow())',2)
            text=replace(text,'f.proof, resetReadyMs)', 'f.proof, capturedNow())',2)
            text=replace(text,'/Seed.*missing|Season 1 Seed/', '/Seed.*missing|Season [12] Seed/')
        if name == 'rollover-core.test.mjs':
            text=replace(text, "current_season_id = '4'", "current_season_id = '5'")
            text=replace(text, "contents.json.season_id = '4'", "contents.json.season_id = '5'")
            text=replace(text,"assert.equal(state.status, 'rollover-wait');", "assert.equal(state.status, 'rollover-ready');")
            text=replace(text,"'1794408327707'", "'1794690331137'")
            text=replace(text,'state.ownedSeeds.length, 2', 'state.ownedSeeds.length, 3')
            text=replace(text,"await assert.rejects(() => prepareRollover(state), /Refresh the completed Season 3/);", "assert.equal((await prepareRollover(state)).seasonId, '4');")
            text=text.replace('keeps the early rollover locked', 'allows the elapsed ordinary rollover')
        if name == 'care-core.test.mjs':
            for old,new in {
              "contents(checked.careFields.playerGrowthSeason).value, '2'":"contents(checked.careFields.playerGrowthSeason).value, '3'",
              "contents(checked.careFields.plantedSapling).value, '2'":"contents(checked.careFields.plantedSapling).value, '3'",
              'f.plant.state.ownedSeeds.length, 2':'f.plant.state.ownedSeeds.length, 3',
              "contents(packet.fieldInputs.plantedSapling).value, '2'":"contents(packet.fieldInputs.plantedSapling).value, '3'",
              "['1', '3', '4']":"['1', '2', '4', '5']",
              "contents(foreign.registry).current_season_id = '4'":"contents(foreign.registry).current_season_id = '5'",
              'retain both processed Seeds':'retain all three processed Seeds',
            }.items():text=replace(text,old,new)
        if name == 'controller.test.mjs':
            text=replace(text, 'BASE_TIME = 1794412800000', 'BASE_TIME = 1794942000000')
            text=replace(text, '/Nov 11, 2026, 8:45:27 AM CST/', '/Nov 14, 2026, 3:05:31 PM CST/')
            text=replace(text, "seasonId: '2'", "seasonId: '3'")
            text=replace(text, 'arboretum:season-two:v1:rollover', 'arboretum:season-three:v1:rollover')
            text=replace(text,'/save the event in your calendar/','/save both events in your calendar/')
            old_end = r"assert.ok(ics.endsWith('END:VCALENDAR\r\n'));"
            text=replace(text, old_end, "assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);\n    assert.ok(ics.includes('Backup: water'));\n    " + old_end)
        (TARGET / name).write_text(text)
        generated[name]=hashlib.sha256(text.encode()).hexdigest()
    (TARGET / 'generated-source.json').write_text(json.dumps({'baselineDirectory':'settlement-cycle-three', 'baselineSha256': BASELINE,'generatedSha256': generated},indent=2)+'\n')
    print(json.dumps({'generated':list(generated),'contractChanges':False,'existingPageChanges':False}))

if __name__ == '__main__': generate()
