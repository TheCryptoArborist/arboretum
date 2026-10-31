# Confirmed Arboretum version-12 mainnet upgrade

The owner-approved upgrade succeeded at **October 30, 2026, 10:31 p.m. CDT** (2026-10-31T03:31:58.538Z), checkpoint **340000251**.

- Transaction: `GY23E3FJnMkg9VgZnqABEyWrKsTog35hfqAQx6mwBZKU`
- Actual package: `0xfc6c6e5f6159d40052a8ff8083aa5ef6d270d15b72be8cc42cde27b643ca7b9a`
- Package version: **12**
- Actual net fee: **0.337998763 SUI**
- Sender and retained administrator: `0x485953e2eadf4aa02af950cf8e914fbd2b67523385e73c36118341459d8d45c4`

The [verification](verification.json) and [independent review](independent-verification.json) confirm the actual transaction digest, exact approved 40,617-byte three-command kind, both published module hashes, all 32 legacy type origins, all 39 new settlement type origins, and the same UpgradeCap owner and compatible policy. The actual transaction only performed the reviewed package upgrade and paid its gas fee. The existing admin page now recognizes the completed upgrade and prevents repeating it.

The [raw receipt and current authority response](receipt.json) and [network proof](network.json) are public mainnet observations. The version-12 package ID is taken from the real confirmed receipt, not from an earlier simulation.

The next operation is the [separate empty Registry setup review](../20261031-empty-registry-review/REVIEW.md). It remains unsigned and does not activate a season or move pool funds. The current website provides upgrade/receipt controls only; setup signing is a separate next implementation step.
