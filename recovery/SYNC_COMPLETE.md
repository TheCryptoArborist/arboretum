# Arboretum production synchronization — completed September 9, 2026

## Main branch checkpoint

- Repository: TheCryptoArborist/arboretum
- Main commit: d1dcfafb5d3090ae1866ed38d806c77b3567357a
- Commit subject: Sync live garden slot improvements from production
- Previous main: d493a045dddf9d4111e0c8ba92ae3a9ba6fc665b
- GitHub comparison confirmed exactly four files changed, with no other modifications to main.
- Main was updated by a non-force fast-forward and reread afterward.

## Production files preserved byte-for-byte

| File | Git blob SHA |
| --- | --- |
| index.html | 7757bfb2695c822d20752ded16eb0048f753bcd7 |
| wallet.js | de725c9fe0db18d35e41232f7ad96406de086168 |
| assets/shop/crates/boom-chest.png | d90ebb332a84efe2b4b6ca32881a2b9c259dd8c5 |
| assets/shop/crates/victory-chest.png | c067051cf16e237c2e8c0a8c6c46224ffee4561c |

Production HTML size: 574,682 bytes.
Production HTML SHA-256: d097ef796f14380c0d2e9e3dcfecab0fead13808d6c26a20497b5b9bd0123701

The HTML retrieved from the immutable Netlify deploy URL, treegrow.xyz, and www.treegrow.xyz was identical. Each recovered dependency also matched the immutable deploy and current production byte-for-byte. The synchronized main index.html and wallet.js were read back and their Git blob hashes matched the recovered source.

## Preserved improvements observed in the comparison

- NFTree artwork and image gateway fallbacks within live Garden seed slots.
- Refined per-slot growth/status readouts and progress text.
- Watering Reminder moved beside the Garden check with status styling.
- Open Crates action and unopened-crate counts inside My Garden.
- Rewards and cosmetics layout improvements.
- BOOM and Victory partner chest interface, images, and wallet helpers.
- Current production wallet contract-package reference preserved, not replaced with the older GitHub reference.

## Validation and limitations

Both executable inline HTML scripts passed Node syntax checks. The recovered wallet.js passed module syntax checking. Existing garden.js and sui-sdk.bundle.js also passed syntax checks and matched their previous GitHub bytes. This was source comparison and syntax validation, not an authenticated browser play-through or smart-contract audit. No wallet was connected, no blockchain transaction was signed, and no on-chain settings were changed.

The initial broad asset scanner included pre-existing cosmetic image entries marked assetReady:false and an nftree.net script URL mistakenly treated as a local path. Their source contexts are documented in dependency-report.json; these were not newly introduced missing dependencies.

## Production preservation

Netlify project: arboretum-sui-forest
Site ID: a344fb31-10b4-4eea-9562-067d90a39607
Current production deploy: 6aa0cfff32d753e6369d8cba
Production was rechecked after the main update; Netlify still reported that same deploy as current and ready. No Netlify deploy operation was invoked. The main synchronization commit includes [skip netlify].

The contract source, backend, README, deployment configuration, and economy were not separately audited or synchronized by this front-end recovery.

## Backups

This recovery branch retains production-index.html, prior-index.html, prior-wallet.js, the HTML and wallet diffs, production-sync-report.json, and dependency-report.json under recovery/. Its root contains the four recovered production files. The two one-time recovery workflows were removed after completion; no recovery workflow was added to main.

Development should start from the verified main commit above, not from the older September 5 source.
