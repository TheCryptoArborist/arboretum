# Seasonal partner accounting — reader and Admin review

## Current status

The separate live-read adapter and read-only Admin overlay are implemented for review. This supersedes the initial README's statement that the whole branch has no chain reader: `ledger.mjs` is still an offline calculator, while `live-reader.mjs` now performs bounded GraphQL reads. The integration is **not deployed**, and the new economy is **not activated**. PR #12 remains draft and unmerged.

Approved policy is unchanged: the existing treasury receives normal fee routing; seasonal accounting allocates 10% of each partner chest's treasury proceeds to its corresponding token. No automatic transfers, new partner wallets, reserve contract, token swaps, or TREE allocation from gameplay receipts are introduced. NFTree revenue remains the separate TREE funding source.

## Implemented reader and Admin overlay

- Fixed read-only queries validate the configured Sui network, registry, package, original event type, successful transaction, checkpoint and actual purchase payment. Supported exact-price legacy purchase transactions must reconcile with the treasury's transaction balance credit.
- The reader binds each receipt to its chest, buyer and purchase season, not its opening. Generic promotional events and unsupported/mixed payment paths are not silently counted as paid revenue. Failures, duplicate conflicts and incomplete historical coverage remain explicit.
- The currently supported deployment is the legacy **testing economy**. Its receipts never create production partner-purchase budgets. A production deployment/policy must be explicitly configured and tested later.
- The review-only build adds **Partner Chest Revenue** to the existing Admin markup, with original BOOM and Victory chest artwork, source/status information, paid receipts found, gross sales, treasury proceeds and separate allocation/spend fields. The normal Admin version requires the existing Admin identity check and does not initiate a wallet connection.
- Separate report JSON and CSV exports include coverage/status metadata. The existing season snapshot JSON gains a partner report attachment only when the loaded report matches the snapshot's season. The existing leaderboard CSV is not replaced; partner CSV is a separate export.
- A failed refresh leaves the previous report visibly stale and disables exports. Stale or wrong-season data never silently become a fresh season snapshot. The report does not claim to have reserved cash or completed token purchases.

## Genuine read evidence — not full-season totals

GitHub read workflow **36962885398**, source **d6cb6c48b041da4f71503b2bdb94dc1a327eac92**, retrieved the testing-season report at **2026-10-02T04:03:56.760Z**, bounded by checkpoint **329296029** at **2026-10-02T04:03:53.912Z**.

The supported records found and reconciled were:

| Product | Paid test receipts found | Gross SUI | Treasury credit attributable to those receipts |
|---|---:|---:|---:|
| BOOM | 1 | 0.01 | 0.0028 |
| Victory | 1 | 0.01 | 0.0028 |

These are confirmed supported receipts found, **not certified complete season sales totals**. The provider's guaranteed range for the exact type/checkpoint-filtered query begins **2026-09-05T05:44:27.190Z**, later than the actual season-opening transaction. Pagination reached its end, but the reader correctly returns `PARTIAL_TEST_RECEIPTS_REVIEW_REQUIRED`, `providerCoversStart:false`, `complete:false` and `finalForSeason:false`. This does not prove additional sales exist; it prevents an unsupported assertion that none are missing.

The live-read CLI deliberately exited with status **2** for incomplete coverage. That workflow is therefore marked unsuccessful for full reconciliation, even though its 97 then-current unit tests passed and both observed payment transactions were successfully reconciled. The safeguard was not removed or relabeled as a complete result.

The modeled pool and developer allocations follow the pinned routing model. Their display is **not a full historical pool balance or payout audit**. Actual partner budgets, SUI spent, tokens acquired and remaining spend allocations are unrecorded/null for this testing report.

Downloaded evidence artifact **11208044576** passed SHA-256 verification: `8d7dac841a47f86a1f425cd6c20c19aa0092b2f54c7ed279a60f2fa9cba06016`.

## Build and tests

Application/test source **da24ade68ae00665d20f9ac833c19e6160e2ea01** passed **109 Node tests**, zero failed/skipped, locally and in GitHub workflow **36963372554**. The latter also completed the full website build and review overlay with its additive-only production-source guard. Its downloaded artifact **11209031723** passed SHA-256 verification: `e34d8e79c8a971f1aefc04b361c50d536b183046ca890be0007df8ea43f0656b`.

Ten local runtime/model/test files and the six relevant built page/wallet files matched the exact CI artifact bytes. The original public homepage, Player Guide, wallet, garden and SDK build bytes remained unchanged by the overlay. The production-overlay build guard still rejects production context. No Netlify configuration, Move source, main branch or deployed site was changed in this step.

**81 local in-memory browser assertions passed**, using the exact panel module logic, original embedded artwork, the separately retrieved saved on-chain report and explicitly controlled fixtures at 1440, 768, 390 and 320 pixels. Checks included exports, mode switching, incomplete-history labels, no overflow, stale refresh handling, missing Admin identity, wrong-season snapshots, lifecycle cancellation and text-only handling of external strings. Desktop/mobile screenshots were inspected.

Browser checks were **not hosted tester-gate tests or real-wallet integration**. No wallet was connected; no transaction was submitted. The downloadable self-contained HTML replays a saved read and a distinct synthetic example; it is not a live query page. Its optional sample mode uses fictional 100 BOOM / 50 Victory sales and must never be presented as actual sales. Reproduction scripts and browser results are included in the review handoff, alongside the GitHub source.

## Remaining gates

1. Validate archived-season discovery and selection, including the interval after the active registry is cleared. The present adapter reads the registry's current testing season; it explicitly stops when a verified archive descriptor is needed.
2. Resolve or explicitly preserve incomplete historical coverage. Do not certify full-season totals from the current provider range alone.
3. Verify hosted tester access, Admin access, module delivery and existing game scripts before publishing this new panel. Local panel assertions are not that verification.
4. Bind a future production reader to the approved production package, economy version, frozen season prices/allocation rules and supported purchase paths. No pending Supply Drop price or partner token identity is inferred.
5. Reconcile separately approved actual purchases and execution costs against each season budget when that functionality is implemented. Merely approving the rate or rendering a report does not lock funds or authorize trades.

## Live technical guidance consulted

MystenLabs/skills `README.md`; `accessing-data/SKILL.md` and `accessing-data/graphql.md`; `frontend-apps/SKILL.md`, `frontend-apps/limitations.md` and `frontend-apps/non-react.md`. Current official Sui GraphQL documentation and the running endpoint's exact schema/retention response informed query verification. No deprecated JSON-RPC data reader was added.
