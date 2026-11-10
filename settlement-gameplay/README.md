# First owner gameplay test

The protected owner page prepares **one NFTree-backed planting** in the existing
version-1 Season 1. Its entrance is
<https://www.treegrow.xyz/tester-access?next=gameplay-test>; the page is
`/admin/gameplay-test/` and says **Plant your first test Seed.**

Publication and exact checks are recorded in [verification](verification/README.md).
The owner must approve the real planting in Slush. The
[actual season-start receipt](../settlement-season/verification/confirmed-20261031/README.md)
is already verified; its digest is
`HEKxugzt8jjFK3bVxdxzBDkWaiRwefawMQb9PtuNy9uW`.

## Owner flow

1. Open the fixed tester entrance using the existing code, in a browser with the
   Slush extension enabled.
2. Connect Slush, explicitly select the administrator ending **45c4**, then
   select **Use selected account**.
3. Select **Load my NFTrees**. Choose one NFTree from the complete verified
   inventory. The page does not choose an NFTree automatically.
4. Select **Check planting**. Review the 0.01-SUI price, allocation, additional
   network fee and watering window, then select the acknowledgment.
5. Select **Review planting in Slush** and review the single planting payment.
6. After **Your first test Seed is planted.**, select **Copy receipt**. The
   receipt contains the actual Seed, NFTree, transaction, payment, network fee,
   planting time and next-water eligibility for the watering test step.

## Exact purchase

| Item | Reviewed value |
| --- | --- |
| Network | Sui mainnet |
| Required owner | `0x485953e2eadf4aa02af950cf8e914fbd2b67523385e73c36118341459d8d45c4` |
| Package | `0xfc6c6e5f6159d40052a8ff8083aa5ef6d270d15b72be8cc42cde27b643ca7b9a` |
| Registry | `0x2f8eb25c571d1f1e963f822265c32bc08ded86a16a5d6dbd4a417a318a6c8ab9` |
| Season / inventory version | 1 / 1 |
| NFTree collection type | `0xf6c6d439ea0da2f3e9ba79e4992a7a4c113215fbf54c442ac9020c315f953705::collection::NFT` |
| Commands | Split exact payment from gas; one `settlement::plant_seed_with_nftree` call |
| Gross payment | 10,000,000 MIST / **0.01 SUI** |
| Referral | None |
| NFTree treatment | Borrowed by immutable reference; contents and owner retained |
| New Seed | One version-1 Season-1 Seed, alive, 10 GP, watering streak 1 |

Planting both purchases and plants the Seed. The contract initializes its first
watering time during that transaction. The page restricts the generic contract
function to the exact NFTree collection above, using an explicitly selected,
currently owner-held object and its current reference. It does not mint or
consume a new NFTree or Sapling.

The existing contract automatically divides the planting payment:

| Destination | SUI |
| --- | ---: |
| Test season reward pool | 0.0070 |
| Existing treasury wallet | 0.0028 |
| Existing developer wallet | 0.0002 |
| Gross price | **0.0100** |

The treasury wallet is
`0x6f1020c2fd6c91129f7cb5e0d651295e87f7245f96b7d090715c89b38197e77f`.
The developer wallet is the administrator above, so its expected net liquid
debit is 0.0098 SUI plus actual gas. The gross price shown for approval stays
0.01 SUI. Registry treasury remains zero; those treasury proceeds go directly
to the existing wallet. This paid planting contributes to the pool even though
the preceding season-start transaction deposited no rewards.

## Watering schedule

Season 1's real cutoff is **November 1, 2026 at 3:57:28.277 p.m. CST**
(`2026-11-01T21:57:28.277Z`). The next normal watering is **21 hours, 36 minutes
after the actual planting time**, and must execute before cutoff.

Plant before **October 31 at 7:21:28.277 p.m. CDT** to leave a watering window.
The page still permits a separately acknowledged planting later in the growing
period, while clearly showing that there will be no later watering opportunity
in this season. After approval, the real receipt determines the exact schedule.
No watering transaction is included in this page or its planting payment.

## Review, confirmation and preservation

The page reuses the accepted explicit Slush-extension selection pattern and
locked SDK versions. The selected provider, account, network and NFTree must
remain consistent through fresh proof, current-state reads, simulation and the
final wallet handoff. Changed fees or watering-window status require another
acknowledgment. Final gas and expiration remain for Slush to select.

A separate first-plant journal and Web Lock protect this paid operation.
Unknown wallet errors, reloads, other tabs and uncertain receipts keep another
planting disabled. Only an explicit typed wallet rejection clears its own
pending request. Existing on-chain first-plant activity also blocks another
first-Seed review. Receipt recovery works without a connected wallet.

The validator checks the full real transaction digest and exact dynamic kind,
the selected NFTree input, execution Clock, created Seed, complete object and
event inventories, four Registry table records, Registry transition and payment
plus gas balance effects. Simulation remains a prediction and never establishes
a real Seed or successful purchase.

This page adds three protected runtime files. The ordinary garden retains its
read-only guards and the existing administrator pages retain their exact bytes.
Contracts, package versions, approved production prices, wallet dependencies
and the separate version-2 production candidate are preserved. Production
remains reserved for a later separately reviewed upgrade and fresh v2 Registry.
