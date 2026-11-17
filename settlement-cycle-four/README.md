# Season 4 focused owner watering test

## Release boundary

This candidate adds `/admin/season-four/` to the existing TreeGrow test site.
It is **not published by the preparation workflow**. Publishing a page also
does not start a season. The owner must personally approve every transaction
in Slush. No contract code, production pricing, production Registry, ordinary
Garden activation, existing page, backend function, edge function, or dependency
lock is changed.

The goal remains one actual watering from 10 to 24 GP, recovery of that result
after refresh, and a subsequent claim processing 24 GP. Another 10-GP claim
is permitted but does not pass this test.

## Verified predecessor

The candidate pins the completed Season 3 claim
`7MLWVofmU1wnoNjqVwYEm3WxRpjMF8AddqojX48YYFKL` and Seed
`0x949d45fc9e2861ec3c75d46ff2e6b277c9692470ab5b929fc76d6dffe5b9ed1b`.
`capture.mjs` independently checks the actual successful transaction, effects,
payment, gas, historical inputs and current authority. All three completed
Seeds must remain accounted for before preparing the next cycle.

## Owner flow after publication is verified

1. Review the ordinary rollover and approve Start Season 4 in Slush.
2. Plant the same NFTree promptly for 0.01 SUI plus gas. Its NFT remains owned.
3. Save the two calendar events after the planting receipt is verified. First
   watering opens 21 hours and 36 minutes after planting; the first alert rounds
   up to the next full minute and a backup is scheduled 15 minutes later.
   Phone alerts require calendar import and notification permission. An exported
   backup event cannot cancel itself; skip it once watering is confirmed.
4. Water before the growing cutoff and verify 24 GP and streak 2 after refresh.
5. Claim after the 48-hour season ends, within its seven-day claim window.

No new watering deadline can be stated before the next planting succeeds.
The 48-hour season begins at the actual season-start transaction, not webpage
publication. Readiness and signing require fresh chain state, the selected
owner, exact package/Registry identity, a successful simulation, and explicit
acknowledgement. Ambiguous submissions stay locked until verified.

## Reproduce the candidate

Use the locked dependencies and Node 24:

```sh
npm ci --ignore-scripts --no-audit --no-fund
python3 settlement-cycle-four/prepare.py
node settlement-cycle-four/capture.mjs
node settlement-cycle-four/rehearse.mjs
node --test --test-isolation=none settlement-cycle-four/*.test.mjs
CONTEXT=branch-deploy node settlement-integration/build-review.mjs
CONTEXT=branch-deploy node settlement-cycle-four/build.mjs
python3 -m pip install playwright==1.57.0
python3 settlement-cycle-four/browser-check.py
```

The generator checks all 12 original source hashes before applying explicit
transformations; `generated-source.json` records the output hashes. It is not
an unreviewed season-number replacement. The three-Seed history, predecessor
proof, fixtures, browser journal and receipt links change together.

`build.mjs` checks every one of the 109 previously published application files
against its saved SHA-256 and requires exactly three new files (112 total).
The existing production build dispatcher is intentionally unchanged: a normal
Netlify build still builds the old site until a separately reviewed release
includes the Season 4 generation/build steps. Do not drag-and-drop only these
three files or the reminder ZIP: that would omit existing backend/edge assets.

`rehearse.mjs` performs one **unsigned simulation** and re-reads actual state;
it does not sign or submit. Its predicted IDs and dates are never used as
confirmed deployment or season values. Browser checks intercept every request,
freeze the clock to a saved checkpoint and prominently label screenshots as
recorded-data previews. They do not prove hosted deployment or real Slush use.

The preparation workflow retains exact source, generated source, test logs,
checked mainnet reads/simulation, complete asset hashes and browser evidence.
A separate read-only step reports whether the existing deployment credential is
available; it never prints the token or publishes anything.

## Guidance

Current MystenLabs/skills README reviewed November 17, 2026. Applicable files:
`frontend-apps/SKILL.md`, `frontend-apps/transactions.md`,
`accessing-data/SKILL.md`, `accessing-data/graphql.md`, `ptbs/SKILL.md`,
`ptbs/building.md`, `move-security/SKILL.md`, and
`move-security/best-practices.md`. Current Netlify deployment guidance was also
reviewed. Production launch and multiple-wallet acceptance remain separate.
