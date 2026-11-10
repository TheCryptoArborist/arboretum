# Confirmed first test season

**The owner's actual first-season transaction is verified on Sui mainnet.**
The fixed start receipt validator recomputed the full transaction digest, matched
the exact reviewed transaction kind, and checked the input Registry, bound
administrator capability, execution Clock, event, resulting state and gas-only
balance changes.

| Item | Verified result |
| --- | --- |
| Transaction | `HEKxugzt8jjFK3bVxdxzBDkWaiRwefawMQb9PtuNy9uW` |
| Season / inventory version | 1 / 1 |
| Actual start | October 31, 2026, 4:57:28.277 p.m. CDT |
| Growing cutoff | November 1, 2026, 3:57:28.277 p.m. CST |
| Claim deadline | November 8, 2026, 3:57:28.277 p.m. CST |
| Duration | Exactly 86,400,000 milliseconds / 24 hours |
| Actual network fee | 100,553 MIST / 0.000100553 SUI |
| Reward funding in the start transaction | 0 SUI |
| Current observed Seeds / Growth Points | 0 / 0 |
| Current observed reward pool / Registry treasury | 0 / 0 SUI |

The different local start/cutoff hours reflect the end of daylight saving time.
The UTC start is `2026-10-31T21:57:28.277Z`; cutoff is
`2026-11-01T21:57:28.277Z`. These come from the real receipt, not the earlier
unsigned simulation or the contract's backdated storage value.

The [summary](summary.json), [actual receipt](receipt.json),
[setup and upgrade proof](proof.json), original response texts and exact requests
are retained. The [read-only verifier](../../verify-confirmed.mjs) made two
public queries and no wallet connection, signature, simulation or submission.
Current inventory quantities describe the saved observation only.

The next owner gameplay review is one paid planting using an already-owned
NFTree. Planting costs 0.01 SUI plus gas and automatically routes 0.007 SUI to
the reward pool, 0.0028 SUI to the existing treasury wallet and 0.0002 SUI to the
existing developer wallet. The start transaction's zero-funding statement does
not describe that later purchase.

Planting initializes an alive Seed with 10 Growth Points, watering streak 1 and
its first watering timestamp. The next normal watering is 21 hours, 36 minutes
after planting. To leave a watering window before this season's cutoff, planting
must execute before October 31 at 7:21:28.277 p.m. CDT. The existing general
garden remains read-only while the isolated owner planting review is prepared.
