# Season 4 owner watering test

The separate page is `/admin/season-four/`. Publication does not start a
season. The owner approves every transaction in Slush. Public gameplay
remains disabled and existing pages, contracts, functions, and settings are
preserved.

## Verified predecessor

Read-only mainnet queries on November 17, 2026 verified Season 3 claim
`7MLWVofmU1wnoNjqVwYEm3WxRpjMF8AddqojX48YYFKL` at checkpoint 345941355.
It processed **10 GP**, paid 7,000,000 MIST, used 1,575,051 MIST net gas,
and yielded 5,424,949 MIST net. This did not complete the watering test.
The current Registry remains on Season 3, fully paid, unpaused, with zero
reward pool and treasury. All three processed historical Seeds remain owned.
Exact requests, raw responses, and the validation summary are in
`verification/mainnet/`. The page verifies bytes, digest, successful effects,
objects, events, gas, and payout independently before authorizing rollover.

## Owner flow

1. Review **Start Season 4**: ordinary reset plus a 48-hour start, atomically.
2. Plant the same verified NFTree promptly. The existing charge is 0.01 SUI
   plus wallet-reviewed network gas; planting starts at 10 GP.
3. Import the receipt-derived watering calendar event. Watering opens
   21 hours 36 minutes after planting and must execute before the cutoff.
4. Approve one watering, verify **24 GP**, refresh, and verify it remains 24 GP.
5. After the cutoff, approve the claim and verify **24 GP processed**.

The existing Season 3 calendar helper is carried into this isolated page,
bound to Season 4's verified planting receipt, Seed, cycle, and schedule.
No separately uploaded helper was available in this chat. Calendar generation
never signs or submits a transaction. The calendar must be imported to enable
its alert. Journal keys are separate from all earlier seasons.

## Release boundary

Baseline: `6af36b1211851adcba7aa254`, source
`5d17306758518579bf523ab8a7f9e8cb198a9fe8`. All 109 previous application
files must remain byte-identical; only three new runtime assets are added,
for 112 total. The existing calendar function and both edge functions retain
their source hashes and deployed identities. The original site is untouched.

The release requires the complete integration workflow on the exact saved
commit for both push and pull request, authenticated preservation preflight,
browser checks, and one durably journaled source-build submission. Offline
synthetic transaction tests are not evidence of actual Season 4 execution.

Current Mysten skills README, frontend-apps, accessing-data, ptbs, sui-sdks,
and their relevant frontend, GraphQL, and transaction references were read
before implementation. Netlify deployment guidance was also consulted.
