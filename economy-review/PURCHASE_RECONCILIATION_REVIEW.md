# Partner purchase reconciliation — next review step

## Status and boundaries

Prepared October 2, 2026 against review branch `774fd294d4408b7e12928ef50553f0b7d4c3c07f`.
This adds a Node.js review module, tests, and a developer point-read helper. It does not modify the hosted Admin panel, deploy the site, change Move code, activate prices, start a season, or send funds. The existing owner-wallet preview confirmation remains pending; “The next” was not recorded as a successful wallet test.

The approved policy remains **10% of each respective partner chest's treasury proceeds**, after existing referral, Growth Pool and developer deductions. BOOM and VICTORY use the existing treasury with separate seasonal bookkeeping. NFTree-to-TREE revenue is separate. No approved decision or wallet address is changed in this step.

## Added workflow

1. A separately executed, nominated transaction can be read through one fixed GraphQL query. This helper does not search a wallet's history or initiate a transaction.
2. Check the network, transaction success, requested digest, checkpoint, treasury sender/gas payer, net SUI debit and positive credit of the configured partner coin to the same treasury. Unknown coin types or ambiguous/mixed records remain blocked or require review.
3. Show the net treasury debit, net gas component and remaining non-gas outflow separately. The debit already includes gas; adding gas again would double-count it. Net gas uses computation + storage - rebate, including a negative rebate result. Token amounts are exact base units; no decimals, ticker identities, price or resale value is guessed.
4. Require a human to classify the transaction's purpose and bind that review to the exact evidence hash. **Matching balance changes do not prove a swap or its business purpose.** The output never claims independent swap verification. A hash detects changed review material; it does not authenticate a reviewer or prove an imported file came from the chain.
5. Reconcile the full supplied journal against supplied seasonal sales using the existing ledger. A later token purchase can be attributed to the season that funded it rather than its execution season. A transaction digest cannot be counted twice across that journal's partner or season entries. One transaction split across several seasons/partners is not supported; such cases need separate review.
6. Keep budgets, recorded debits, recorded token credits, and projected remainder separate. Incomplete sales or unresolved journal entries prevent a clean remainder. Over-budget reviewed spending stays visible with a shortfall; it is not silently discarded. An empty supplied journal is not proof that the wallet has spent nothing.

## Important limitations

`reconcilePartnerPurchases` recomputes supplied sales with `buildReport`. Imported sales and transaction evidence remain explicitly unverified, even when they declare complete coverage. It produces review bookkeeping, not an independently audited final season report. `actualUnspentCashMist` and `balanceAvailableToSpendMist` always remain null. No funds are locked or reserved. Duplicate protection covers the supplied journal, not omitted files, other browsers or a persistent shared database.

The real BOOM and VICTORY coin types are still null in `decisions.json`. The helper deliberately stops before making a network request until the relevant canonical type is configured through a separate reviewed change. Tests use fictional token types; they are never installed as production configuration. No actual partner-token purchase has been certified by these tests.

The point-read query and gas calculation were checked against current official Sui GraphQL documentation. Automated network tests use controlled responses; this step does not claim a successful live partner-purchase read. The previous hosted receipt reader still has its documented legacy-testing and historical-coverage limits.

Before this module can populate the live Admin spend fields, integrate independently verified production sales, verified token identities, shared journal persistence, evidence retention, and real owner review. A future persistent journal needs authentication and concurrency protection. Manual accounting approval is not authority to sign a trade. Existing funded claims and test inventory separation remain untouched.

## Reproduce

```sh
node --test economy-review/*.test.mjs
node --check economy-review/purchase-reconciliation.mjs
node --check economy-review/check-purchase.mjs
```

After canonical partner types are separately verified and configured, the optional developer point-read path is:

```sh
node economy-review/check-purchase.mjs BOOM TRANSACTION_DIGEST new-purchase-evidence.json
```

It writes a new evidence file without overwriting an existing file and leaves purpose review pending. It has no wallet, signature, swap, transfer, mutation or private-key handling.

## Verification for this step

Local Node 22 run: **194 tests passed, 0 failed/skipped/cancelled**: 139 retained tests and 55 added reconciliation tests. New coverage includes exact amounts, gas/rebates, missing/wrong identities, failed/unknown transactions, unsafe numbers, missing evidence, manual review/hash checks, cross-season/partner duplicates, partial coverage, over-budget records and fixed read-only requests. GitHub CI must be checked against the committed revision before a CI success is reported.

## References checked live

- MystenLabs/skills `README.md`, `accessing-data/SKILL.md`, `accessing-data/graphql.md`.
- Official Sui `Transaction`, `TransactionEffects`, `BalanceChange` and `GasCostSummary` GraphQL references. Current Transaction JSON is documented as matching the gRPC proto format.
- Existing `economy-review/decisions.json` and `ledger.mjs`, read from the current review branch; the locally used files matched their GitHub blob hashes.
