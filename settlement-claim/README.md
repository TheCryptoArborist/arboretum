# Season 1 reward review and claim

The protected owner page is `/admin/claim-test/`. Its fixed tester entrance is
<https://www.treegrow.xyz/tester-access?next=claim-test>.

This continues the first version-1 test Seed through its season-end reward. The
owner reviews one `settlement::claim_reward` call and approves it in Slush.
Reading the reward and recovering a receipt require no wallet connection.

## Verified starting point

The November 4, 2026 evening mainnet check still shows the original planting
transaction, 10 Growth Points, watering streak 1 and an unprocessed reward. No
watering occurred before the season cutoff. The one-Seed reward pool is
7,000,000 MIST (0.007 SUI), with 10 eligible Growth Points in total.

| Item | Value |
| --- | --- |
| Seed | `0x2b06e3f3900d08eff3921f374137c2b2cb87f2f7bbf6cdb5ff7f1e3238a1046d` |
| Owner | `0x485953e2eadf4aa02af950cf8e914fbd2b67523385e73c36118341459d8d45c4` |
| Package | `0xfc6c6e5f6159d40052a8ff8083aa5ef6d270d15b72be8cc42cde27b643ca7b9a` |
| Registry | `0x2f8eb25c571d1f1e963f822265c32bc08ded86a16a5d6dbd4a417a318a6c8ab9` |
| Planting transaction | `FM5QeE2Eb2tQwQeSsTKz8s4a81mZVqde5kF2HAEmyisB` |
| Season / inventory version | 1 / 1 |
| Growing cutoff / claiming opens | November 1, 2026, 3:57:28.277 p.m. CST (`2026-11-01T21:57:28.277Z`) |
| Claim deadline | November 8, 2026, 3:57:28.277 p.m. CST (`2026-11-08T21:57:28.277Z`) |

All local times use America/Chicago. The seven-day claim interval includes the
exact deadline; execution after that time is rejected. The page uses a fresh
mainnet Clock and rejects stale or unsupported state.

## Expected reward and transaction

The contract computes each Seed's reward from its eligible Growth Points at the
season cutoff and the season's fixed reward pool. For the observed one-Seed
state, `10 / 10 × 0.007 SUI = 0.007 SUI`. Later drying cannot remove Growth Points
that were already eligible at that cutoff. The missed watering therefore does
not prevent this Seed's reward claim.

The initial checked, unsigned mainnet simulation succeeded at checkpoint
**341771684**, `2026-11-05T02:55:55.002Z`. It predicts:

- Reward paid to the owner: **0.007 SUI**.
- Estimated network fee: **0.001575051 SUI**.
- Net owner balance increase: **0.005424949 SUI**.
- The Seed's reward is marked processed; its recorded Growth Points and cutoff
  Growth Points become zero as the entitlement is consumed.
- The Registry records the fixed pool, eligible total and completed payment.

These are simulation results, not a payment receipt. The page checks again
before wallet review; actual gas can differ. This operation does not purchase
anything or deposit funds. The first claim automatically finalizes settlement
when necessary, so a separate administrator finalization transaction is not
required. The pinned claim also accepts an already finalized but unpaid Season
1 settlement. Other seasons and archived claims remain outside this page.

## Owner flow

1. Open the claim tester entrance using the existing tester code.
2. Review the current reward, cutoff Growth Points and remaining claim window.
3. Connect the Slush browser extension and explicitly choose account **45c4**.
4. Select the claim check to verify current inputs and simulate the single claim.
5. Review reward and network gas separately, acknowledge the review, and hand
   the transaction to Slush for approval.
6. Read or copy the confirmed receipt after actual execution and payment are
   verified. A transaction digest alone does not establish a successful claim.

The journal and browser lock prevent another wallet handoff while a prior
request is uncertain. Receipt recovery uses the actual transaction. A confirmed
failed transaction requires explicit revalidation before any new attempt; the
page never automatically repeats a wallet transaction.

## Implementation scope

The existing locked `@mysten/sui` 2.19.0 and `@mysten/dapp-kit-core` 1.6.1
packages and explicit Slush selection flow are retained. The wallet receives
the `Transaction` object and selects its final gas configuration. The one Move
call uses a mutable Registry, the owned mutable Seed and the read-only Clock.
No administrator capability, NFTree argument or payment input is needed.

Only the planting and watering HTML gain navigation links. The other previous
application files, ordinary garden transaction guards, contract source and
production version-2 plan retain their existing scope. Release verification
checks the dedicated site identity, complete asset inventory, calendar function
bundle/runtime, both edge handlers, empty schedule list and original site.

## Guidance and evidence

The current MystenLabs/skills README was checked on this request and the live
repository cloned at `495528ab09a75480847f5b9668adc163817bb296`. Applicable
guidance includes `frontend-apps/SKILL.md`, `frontend-apps/non-react.md`,
`frontend-apps/transactions.md`, `ptbs/SKILL.md`, `ptbs/building.md`,
`ptbs/commands.md`, `accessing-data/SKILL.md`, `accessing-data/graphql.md`,
`sui-sdks/SKILL.md`, `sui-sdks/typescript.md`, `sui-sdks/llm-docs.md`,
`move-security/SKILL.md`, `move-security/best-practices.md` and the installed
packages' version-matched LLM documentation. APIs are resolved against the
installed package types when reference examples differ.

`verification/initial-mainnet-simulation-20261105.json` records the original
checked unsigned simulation. `verification/preflight-20261105.json` records the
unchanged live deployment before this release.
`verification/validated-mainnet-simulation-20261105.json` additionally records a
fresh read, transaction build and checked simulation accepted by the new claim
validator. Verification does not connect a real wallet, request a signature or
submit a blockchain transaction.
