# Season 2: a 48-hour owner test

This isolated page brings the next test cycle together at
<https://www.treegrow.xyz/admin/season-two/>. The compatibility entrance is
<https://www.treegrow.xyz/tester-access?next=season-two>. The dedicated site does
not require a tester code. Other Netlify site contexts retain their existing
access policy.

## Published release

The page was published on **November 8, 2026, at 8:34 AM America/Chicago**
from source commit `ed128b295e80701067a0f74c66e6a1ae3e6b709b`, as Netlify
deployment `6af08867e808541bad23b5b2`. Authenticated verification matched all
106 application assets and preserved all 103 previous files. All 24 public
HTTP checks passed. The live browser showed **Mainnet verified** and
**Ready for Season 2**, and a manual refresh returned a newer checkpoint.
The desktop layout was inspected at 1348 CSS pixels; mobile visual checking
remains unverified because this browser blocks DevTools. No wallet was
connected and no Sui transaction was submitted during deployment.

See the [completed release record](verification/hosted/README.md). Earlier
local validation files retain their original prepublication status; the hosted
record documents the subsequent deployment and browser checks.

### Planting field correction

The owner then started Season 2 successfully. Its actual rollover transaction is
`9SqBoBCyVA4A1mWfmBid7dGxny4ba2tzCgVPLiRS77z4`; the growing cutoff is
November 10, 2026, at 8:45:27 AM America/Chicago. The first planting preview
revealed that Sui can report the existing 10-GP owner field as unchanged when
the first Seed of the new season also sets it to 10. The verifier now checks
that explicit unchanged runtime reference. Receipt recovery reads the exact
historical object version, independently validating its identity, parent, key,
type and value. The other three planting field changes remain required.

See the [planting correction record](verification/plant-fields-fix/README.md)
for the untouched reproduction, passing live unsigned preview, tests and
publication status. `release.py --plant-fields-hotfix` pins the published
initial Season 2 deployment and allows only `admin/season-two/admin.mjs` to
change, preserving the other 105 application files. The growing season and
all transaction economics stay unchanged.

Publishing the page does not archive a season, start a season, plant, water or
claim. The owner reviews and approves each transaction in the Slush extension.
The general garden remains read-only; this does not activate the prepared
version-2 production Registry or upgrade any contract.

## The four steps

1. **Start Season 2.** Review the completed Season 1 settlement, archive it and
   start a new season lasting exactly **172,800,000 milliseconds / 48 hours**.
   The start time comes from the confirmed execution, not page publication.
2. **Plant one Seed.** Reuse the fixed, verified Season 1 NFTree and review the
   existing **0.01 SUI** planting charge plus the network fee. The NFTree remains
   owned by the wallet. The new Seed belongs to Season 2.
3. **Water once.** The first watering opens **21 hours, 36 minutes after
   planting**. Its exact readiness and the season cutoff are checked from chain
   state. This page covers the first watering, from 10 to 24 GP, rather than
   enabling the unrestricted game.
4. **Claim after the cutoff.** The page reviews the current entitlement and
   network fee. The claim window ends seven days after the growing cutoff.

Plant promptly after starting so there is room for the watering window. The
page stops preparing new planting transactions at the growing cutoff minus
**21 hours, 36 minutes**. A valid planting transaction executed later can still
be recovered from its exact checkpointed receipt; its existing growth points
remain eligible for claim, even when the first watering no longer fits before
the cutoff. The page displays its schedule in `America/Chicago`, using the
mainnet Clock for readiness. A simulation is an estimate; only a validated
checkpointed receipt completes a step. Changed review values require another
acknowledgment before the wallet handoff.

## Fixed scope

| Item | Reviewed value |
| --- | --- |
| Network and origin | Sui mainnet; `https://www.treegrow.xyz` |
| Package | `0xfc6c6e5f6159d40052a8ff8083aa5ef6d270d15b72be8cc42cde27b643ca7b9a` |
| Registry | `0x2f8eb25c571d1f1e963f822265c32bc08ded86a16a5d6dbd4a417a318a6c8ab9` |
| Administrator / owner | `0x485953e2eadf4aa02af950cf8e914fbd2b67523385e73c36118341459d8d45c4` |
| Bound AdminCap | `0x2f5d88ef66be5701e33c4ddc076868845b2bc153bceb4ae3fc997e2b63b93835` |
| Completed Season 1 claim | `8PitEh5UEu5WeFKbZ2kZcr1QRixFZeq1NBXX7mxkSm9R` |
| Fixed NFTree reused for Season 2 | `0x04a937cd60e0cbcfc315b15d2dd08187d3f180ebb925d588223303ea52afbcc7` |
| Inventory version and new season | Version 1; Season 2 |
| Season duration | 48 hours |

The version-1 contract permits ordinary reset after cutoff plus 24 hours;
archiving preserves the original settlement and deadline. The page adds its
own narrow requirement that the known one-Seed Season 1 settlement is fully
processed and paid. Completing its claim does not itself reset the Registry.
See [the settlement source](../contract-payout/source/settlement.move) and
[the first-start boundary](../settlement-season/README.md).

## Build and release boundaries

`build.mjs` emits only these new runtime files:

- `admin/season-two/index.html`
- `admin/season-two/admin.css`
- `admin/season-two/admin.mjs`

The JavaScript is bundled locally with the existing locked SDK versions;
source modules, tests and evidence are not published. The integration build
compares every prior application file against the recorded source hashes:
**103 unchanged files + 3 additions = 106 files**. No old page navigation or
copy changes are included.

The release is pinned to Netlify site
`d425445d-4980-49be-8ab2-12e7527ba281` (`arboretum-preview`, `www.treegrow.xyz`),
with baseline deployment `6aeea0b254e028ece344267c`. It preserves the exact
`calendar-reminder` digest and runtime configuration, both edge functions
(`public-player-guide` and `tester-gate`), and the absence of schedules. The
original `arboretum-sui-forest` site must remain on
`6abe81174b61a8e3dd53b333`.

`release.py` adapts the audited claim-release helpers. It binds the previous
gate-only release's source candidate to its publication journal and public
verification evidence. A fresh authenticated preflight then checks those 103
files against the actual published deployment inventory. The prior public
verification distinguished raw byte matches from narrowly proven Netlify HTML
anchor rewrites; it is not relabeled as an authenticated inventory.

Submission requires a saved, clean, exact source commit and unchanged build
output. The source archive, candidate hashes and submission attempt are
durably journaled before the sole source-build POST. Unknown responses and
existing submissions block automatic resubmission. A static-only upload is
insufficient because the backend and edge bundles must be built as well.

The release helper accepts the standard `NETLIFY_AUTH_TOKEN` or the normal
Netlify CLI configuration at `~/.config/netlify/config.json`. It never prints
the token or follows authenticated redirects. No other credential source is
searched. `preserve` is completely offline; other release operations require
normal deployment authentication.

## Verification commands

```sh
node --test --test-isolation=none settlement-cycle/*.test.mjs
python3 -m unittest discover -s settlement-cycle -p 'test_*.py' -v
node --test --test-isolation=none scripts/test-tester-return.mjs scripts/build-policy.test.mjs
NETLIFY=true CONTEXT=production SITE_ID=d425445d-4980-49be-8ab2-12e7527ba281 node scripts/build-site.mjs
python3 settlement-cycle/release.py preserve /tmp/arboretum-season-two-check
```

After the exact source is saved and required CI passes, the release operator
uses one journal directory outside the repository. `CYCLE_SOURCE_COMMIT` is the
exact saved 40-character commit, and `CYCLE_RELEASE_DIR` is that journal path:

```sh
python3 settlement-cycle/release.py preflight "$CYCLE_RELEASE_DIR"
python3 settlement-cycle/release.py submit "$CYCLE_RELEASE_DIR" --commit "$CYCLE_SOURCE_COMMIT"
python3 settlement-cycle/release.py status "$CYCLE_RELEASE_DIR"
python3 settlement-cycle/release.py verify "$CYCLE_RELEASE_DIR"
python3 settlement-cycle/release.py http "$CYCLE_RELEASE_DIR"
```

`verify` checks the source archive and local candidate binding, all 106
authenticated file records and raw assets, source configuration, backend and
both sites' publication identities. `http` checks anonymous GET/HEAD access,
fixed entrance redirects, invalid destination fallbacks, rejected direct
writes, the calendar download and retained public pages. HTML comparisons
allow only the previously observed exact anchor pretty-URL transformation;
other byte changes fail. Browser and wallet behavior require their separate
controller and browser checks.

## Guidance

The current [Mysten skills README](https://github.com/MystenLabs/skills) was
checked on November 8, 2026, at revision
`495528ab09a75480847f5b9668adc163817bb296`. The implementation and reviews used:

- `ptbs/SKILL.md`, `ptbs/building.md` and `ptbs/commands.md` for exact transaction composition.
- `accessing-data/SKILL.md` and `accessing-data/graphql.md` for scoped reads and confirmed effects.
- `sui-move/SKILL.md` and `sui-move/move.md` for contract behavior.
- `move-security/SKILL.md`, `move-security/access-control.md` and `move-security/best-practices.md` for authority and validation boundaries.
- `object-model/SKILL.md` and `object-model/ownership.md` for owned and shared object handling.
- `frontend-apps/SKILL.md`, `frontend-apps/non-react.md`, `frontend-apps/transactions.md`, `frontend-apps/limitations.md` and `frontend-apps/queries.md` for wallet identity, transaction execution and browser integration.

Current Netlify deployment guidance and coding context were consulted for this
release path. No new contract deployment or upgrade is included.
