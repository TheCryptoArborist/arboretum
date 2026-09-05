# Arboretum — Monthly SUI Growth Cycles

## File Overview

```
arboretum/
├── sources/
│   └── arboretum.move   ← Full SUI Move smart contract
├── Move.toml            ← Package manifest (fill in your address after publish)
├── wallet.js            ← Frontend wallet integration (ESM, load in index.html)
├── garden.js            ← Live garden renderer with seed emoticons
├── api.js               ← Node.js Express backend (leaderboard, garden state)
├── package.json         ← Node deps for the API server
└── README.md
```

---

## 1. Deploy the Smart Contract

```bash
# Install SUI CLI: https://docs.sui.io/guides/developer/getting-started/sui-install
sui client switch --env testnet   # or mainnet

sui move build
sui client publish --gas-budget 200000000
```

After publish, copy the **Package ID** from the output.
Also copy the **Registry** shared object ID from the `init` event.

---

## 2. Wire up the IDs

### In `wallet.js`:
```js
export const CONTRACT = {
  PACKAGE_ID:  "0xee2cb50c675bb47de4612e713b2101b3b6a5f66620f146ff57858efc39dd689b",
  TYPE_PACKAGE_ID: "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b",
  TYPE_PACKAGE_IDS: [
    "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b",
    "0xfa7030bc4d8e454482adb1ce3ec07ebc3dbcef85f1288d4a9eeea615be44a992",
  ],
  REGISTRY_ID: "0x73672fd5f19137185a3933ea884aacad31eb7a9d41dab0494e628f3cb9b82d50",
  ADMIN_CAP_ID:"0x74b2e28a362a148c1a0c0a8da8519966ba19c3cec82148028b3019d30829f3b3",
  CLOCK_ID:    "0x6",
  RANDOM_ID:   "0x8",
  MODULE:      "arboretum",
};

export const NFTREE = {
  MINT_URL: "https://nftree.net",
  PACKAGE_ID: "0xf6c6d439ea0da2f3e9ba79e4992a7a4c113215fbf54c442ac9020c315f953705",
  STRUCT_TYPE: "0xf6c6d439ea0da2f3e9ba79e4992a7a4c113215fbf54c442ac9020c315f953705::collection::NFT",
};
```

Keep the NFTree struct type in sync with the live NFTree collection before production deploy.

### In `api.js` (or via env vars):
```bash
PACKAGE_ID=0xee2cb50c675bb47de4612e713b2101b3b6a5f66620f146ff57858efc39dd689b \
TYPE_PACKAGE_ID=0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b \
LEGACY_TYPE_PACKAGE_IDS=0xfa7030bc4d8e454482adb1ce3ec07ebc3dbcef85f1288d4a9eeea615be44a992 \
SUI_GRAPHQL=https://graphql.mainnet.sui.io/graphql \
REGISTRY_ID=0x73672fd5f19137185a3933ea884aacad31eb7a9d41dab0494e628f3cb9b82d50 \
ADMIN_CAP_ID=0x74b2e28a362a148c1a0c0a8da8519966ba19c3cec82148028b3019d30829f3b3 \
CLOCK_ID=0x6 \
APP_URL=https://treegrow.xyz \
node api.js
```

---

## 3. Start a Season (Admin only)

```bash
# Call start_season with your AdminCap
sui client call \
  --package $PACKAGE_ID \
  --module arboretum \
  --function start_season \
  --args $ADMIN_CAP_ID $REGISTRY_ID 0x6 \
  --gas-budget 10000000
```

---

## 4. Add `wallet.js` and `garden.js` to `index.html`

Inside `<head>` (before closing tag):
```html
<script type="module" src="/wallet.js"></script>
<!-- Optional: only include garden.js if you want the standalone API-backed renderer. -->
<!-- <script type="module" src="/garden.js"></script> -->
```

Add the Garden section HTML in `index.html` (in `<main>`):
```html
<section class="section" id="garden-section">
  <div class="section-header-row">
    <div>
      <h2 class="section-title">🌱 My Garden</h2>
      <p class="section-sub">
        Seeds:&nbsp;<strong id="garden-total-seeds">—</strong>
        &nbsp;|&nbsp;GP:&nbsp;<strong id="garden-total-gp">—</strong>
        &nbsp;|&nbsp;Alerts:&nbsp;<span id="garden-alert-count" style="color:var(--warning)">0</span>
      </p>
    </div>
    <button class="glow-button" onclick="window.open('https://nftree.net','_blank','noopener')">
      Mint NFTree
    </button>
  </div>
  <div id="garden-alert-bar"></div>
  <div id="garden-grid"></div>
</section>
```

Update the Content-Security-Policy in `index.html` to allow your API domain:
```
connect-src 'self' https://yourdomain.com https://localhost:3001 https://fullnode.mainnet.sui.io:443;
```

---

## 5. Run the API Server

```bash
cd arboretum
cp .env.example .env
npm install
npm start
# Listens on :3001
```

For production, set the same environment variables in your host dashboard. Do not ship a filled `.env` file in frontend or handoff zips. `ALLOWED_ORIGIN` must be the exact browser origin, currently `https://treegrow.xyz` with no trailing slash.

Important: this build was audited on 2026-08-17 and the public Sui fullnode rejected deprecated JSON-RPC reads. The garden, stats, object, balance, and leaderboard reads now use Sui GraphQL through `SUI_GRAPHQL`. Wallet transaction signing still uses the wallet/SDK transaction path.

---

## 6. Leaderboard integration

`index.html` builds the leaderboard directly from Sui events with `client.queryEvents`.
If you prefer a backend leaderboard later, add a matching API route before switching the UI to fetch it.

---

## 7. Seed Emoticon Reference

| Emoji | State | Condition |
|-------|-------|-----------|
| 🌱 | Sprout | Alive, streak < 4 days |
| 🌿 | Growing | Alive, streak 4–9 days |
| 🌲 | Sapling | Alive, streak 10–24 days |
| 🌺 | Blooming | Alive, streak 25–49 days |
| ✨🌳✨ | Mythic | Alive, streak ≥ 50 days |
| 🍂 | Wilting | Not watered 7–9 days (orange glow) |
| 💀 | Dead | Not watered ≥ 10 days |
| ⬜ | Empty | No seed planted here |

---

## 8. Key contract entry functions

| Function | Who | Cost |
|----------|-----|------|
| NFTree mint | Player | External mint at `https://nftree.net` |
| `plant_seed<T>` | Player | 0.01 SUI + 1 eligible NFTree |
| `water_seed` | Player | Gas only |
| `apply_tool` | Player | Gas only; tools can only be applied to live Seeds |
| `revive_seed` | Player | Gas only; requires a saved revive charge already on the dead Seed |
| `revive_seed_with_tool` | Player | Gas only; consumes a newly purchased Revival Kit Tool to revive an already-dead Seed |
| `abandon_seed` / reset slot | Player | Gas only; resets a dead Seed slot so the attached NFTree can plant again |
| `buy_crate` | Player | 0.01 SUI per live crate tier |
| `open_crate` | Player | Gas only |
| `claim_reward` | Player | Gas only (season end) |
| `start_season` | Admin | Gas only |
| `deposit_to_pool` | Admin | Gas + SUI amount |
| `withdraw_treasury` | Admin | Gas only |

---

## 9. API Endpoints

The included API exposes:

```text
GET /api/health
GET /api/stats
GET /api/garden/:address
GET /api/referral/:address
GET /api/leaderboard
```

Wilt/death status is computed in the garden response. This package does not include a cron alert webhook.

---

## 10. Security Notes

- The `AdminCap` object controls treasury and season management. **Store it in a multisig or hardware wallet.**
- NFTree ownership and the "1 NFT = 1 active Seed per monthly cycle" rule must be enforced in the Move contract as well as the frontend. Frontend checks prevent bad UX, but they are not sufficient security by themselves.
- If an attached NFTree is transferred out during a season, the frontend locks garden actions. The contract should also reject watering, tool use, reward claims, or any other active-cycle action when the required NFT is no longer owned by the player.
- Crate randomness uses Sui Randomness via the shared random object (`0x8`) when your Move function accepts `sui::random::Random`.
- CSP headers are configured in `index.html` — update `connect-src` with your actual domain.
- The leaderboard endpoint is public; add rate-limiting middleware in production.
