const express = require("express");
const cors = require("cors");
const fetch = (...a) => import("node-fetch").then(({ default: f }) => f(...a));
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;
const allowedOrigin = (process.env.ALLOWED_ORIGIN || "*").replace(/\/+$/, "");

// ─── Rate limiting ───────────────────────────────────────────────────────────
// Basic in-memory rate limiter — no extra dependency needed.
// For high traffic, swap with express-rate-limit + Redis.
const _rateCounts = new Map();
function rateLimit(windowMs, maxRequests) {
  return (req, res, next) => {
    const key = req.ip + req.path;
    const now = Date.now();
    const entry = _rateCounts.get(key) || { count: 0, start: now };
    if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
    entry.count++;
    _rateCounts.set(key, entry);
    if (entry.count > maxRequests) {
      return res.status(429).json({ ok: false, error: "Too many requests — slow down." });
    }
    next();
  };
}
const gardenLimit   = rateLimit(60_000, 30);  // 30 req/min per IP per path
const statsLimit    = rateLimit(60_000, 20);
const referralLimit = rateLimit(60_000, 10);

app.use(
  cors({
    origin: allowedOrigin,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  }),
);
app.use(express.json());

const RPC_URL =
  process.env.SUI_RPC || "https://fullnode.mainnet.sui.io:443";
const GRAPHQL_URL =
  process.env.SUI_GRAPHQL || "https://graphql.mainnet.sui.io/graphql";

// LIVE CONTRACT (upgraded 2026-09-02)
const PACKAGE_ID =
  process.env.PACKAGE_ID ||
  "0x0ad12507d7e2762102cea78aa2fe3b2c2aed96c1e180ee18561233f931f75914";

const TYPE_PACKAGE_ID =
  process.env.TYPE_PACKAGE_ID ||
  process.env.ORIGINAL_PACKAGE_ID ||
  "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b";

const TYPE_PACKAGE_IDS = [
  TYPE_PACKAGE_ID,
  ...(process.env.LEGACY_TYPE_PACKAGE_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
  "0xfa7030bc4d8e454482adb1ce3ec07ebc3dbcef85f1288d4a9eeea615be44a992",
  PACKAGE_ID,
].filter(Boolean);

const REGISTRY_ID =
  process.env.REGISTRY_ID ||
  "0x73672fd5f19137185a3933ea884aacad31eb7a9d41dab0494e628f3cb9b82d50";

const MODULE           = "arboretum";
const ONE_DAY_MS       = 86_400_000;
const SEASON_DURATION_MS = 2_592_000_000;
const WILT_DAYS        = 7;
const DEATH_DAYS       = 10;
const MAX_ACTIVE_GARDEN_SEEDS = 8;

function mistNumber(value) {
  if (value && typeof value === "object" && value.fields && value.fields.value !== undefined) {
    return Number(value.fields.value);
  }
  return Number(value ?? 0);
}

function formatSuiFromMist(value, digits = 4) {
  return (mistNumber(value) / 1e9).toFixed(digits);
}

// ─── Sui GraphQL helpers ────────────────────────────────────────────────────
async function gql(query, variables = {}, retries = 3) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(GRAPHQL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(15000),
      });
      const json = await res.json();
      if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
      return json.data;
    } catch (err) {
      lastErr = err;
      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, 400 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastErr;
}

function gqlObjectToRpcObject(node) {
  if (!node) return null;
  const type = node.contents?.type?.repr ?? null;
  const fields = node.contents?.json ?? {};
  return {
    data: {
      objectId: node.address,
      version: String(node.version ?? ""),
      digest: node.digest,
      type,
      content: { dataType: "moveObject", type, fields },
    },
  };
}

// ─── Seed parser (matches on‑chain Seed struct) ─────────────────────────────
function parseSeed(obj) {
  const f = obj.data?.content?.fields ?? {};
  const now = Date.now();
  const lastWatered = Number(f.last_watered_ms ?? 0);
  const droughtDays = Math.floor((now - lastWatered) / ONE_DAY_MS);
  const rawState = Number(f.state ?? 0);

  let liveState = "alive";
  if (rawState === 2 || droughtDays >= DEATH_DAYS) liveState = "dead";
  else if (rawState === 1 || droughtDays >= WILT_DAYS) liveState = "wilting";

  return {
    objectId:           obj.data?.objectId,
    nftId:              f.nft_id,
    owner:              f.owner,
    plantedAt:          Number(f.planted_at_ms ?? 0),
    lastWatered,
    wateringStreak:     Number(f.watering_streak ?? 0),
    growthPoints:       Number(f.growth_points ?? 0),
    seasonId:           Number(f.season_id ?? 0),
    claimedMs:          Number(f.claimed_ms ?? 0),
    state:              liveState,
    droughtDays,
    fertilizerCharges:  Number(f.fertilizer_charges ?? 0),
    miracleGrow:        Boolean(f.miracle_grow_applied),
    revivalCharges:     Number(f.revival_charges ?? 0),
    bottomlessCanExpiry:Number(f.bottomless_can_expiry_ms ?? 0),
    bottomlessCanActive:Number(f.bottomless_can_expiry_ms ?? 0) > now,
  };
}

// ─── RPC helpers ────────────────────────────────────────────────────────────
async function getOwnedByType(address, structType) {
  const out = [];
  const seen = new Set();
  const query = `query ($address: SuiAddress!, $type: String!, $after: String) {
    address(address: $address) {
      objects(first: 50, after: $after, filter: { type: $type }) {
        pageInfo { hasNextPage endCursor }
        nodes { address version digest contents { type { repr } json } }
      }
    }
  }`;
  for (const typePackageId of [...new Set(TYPE_PACKAGE_IDS)]) {
    let after = null;
    do {
      const type = `${typePackageId}::${MODULE}::${structType}`;
      const data = await gql(query, { address, type, after });
      const page = data?.address?.objects;
      for (const obj of (page?.nodes ?? []).map(gqlObjectToRpcObject).filter(Boolean)) {
        const objectId = obj?.data?.objectId;
        if (objectId && !seen.has(objectId)) {
          seen.add(objectId);
          out.push(obj);
        }
      }
      after = page?.pageInfo?.hasNextPage ? page.pageInfo.endCursor : null;
    } while (after);
  }
  return out;
}

async function getAllObjectsByType(structType, limit = 500) {
  const out = [];
  const seen = new Set();
  const query = `query ($type: String!, $first: Int, $after: String) {
    objects(first: $first, after: $after, filter: { type: $type }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        address version digest
        asMoveObject { contents { type { repr } json } }
      }
    }
  }`;
  for (const typePackageId of [...new Set(TYPE_PACKAGE_IDS)]) {
    let after = null;
    do {
      const type = `${typePackageId}::${MODULE}::${structType}`;
      const data = await gql(query, { type, first: Math.min(50, limit - out.length), after });
      const page = data?.objects;
      const nodes = (page?.nodes ?? []).map((node) => {
        if (!node?.asMoveObject) return null;
        return gqlObjectToRpcObject({
          address: node.address,
          version: node.version,
          digest: node.digest,
          contents: node.asMoveObject.contents,
        });
      }).filter(Boolean);
      for (const obj of nodes) {
        const objectId = obj?.data?.objectId;
        if (objectId && !seen.has(objectId)) {
          seen.add(objectId);
          out.push(obj);
        }
      }
      after = page?.pageInfo?.hasNextPage && out.length < limit ? page.pageInfo.endCursor : null;
    } while (after && out.length < limit);
  }
  return out.slice(0, limit);
}

async function getRegistryFields() {
  const query = `query ($id: SuiAddress!) {
    object(address: $id) {
      address version digest
      asMoveObject { contents { type { repr } json } }
    }
  }`;
  const data = await gql(query, { id: REGISTRY_ID });
  return data?.object?.asMoveObject?.contents?.json ?? {};
}

async function getAllEvents(eventType, limit = 100) {
  const allEvents = [];
  let after = null;
  const query = `query ($type: String!, $first: Int, $after: String) {
    events(first: $first, after: $after, filter: { type: $type }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        sender { address }
        timestamp
        contents { type { repr } json }
      }
    }
  }`;
  do {
    const type = `${TYPE_PACKAGE_ID}::${MODULE}::${eventType}`;
    const data = await gql(query, { type, first: Math.min(50, limit), after });
    const page = data?.events;
    allEvents.push(...((page?.nodes ?? []).map((node) => ({
      sender: node.sender?.address,
      timestamp: node.timestamp,
      type: node.contents?.type?.repr,
      parsedJson: node.contents?.json ?? {},
    }))));
    after = page?.pageInfo?.hasNextPage && allEvents.length < limit ? page.pageInfo.endCursor : null;
  } while (after);
  return allEvents;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// Player garden: seeds + tools + crates
app.get("/api/garden/:address", gardenLimit, async (req, res) => {
  try {
    const { address } = req.params;
    if (!/^0x[a-fA-F0-9]{64}$/.test(address)) {
      return res.status(400).json({ ok: false, error: "Invalid SUI address format" });
    }

    const rawSeeds  = await getOwnedByType(address, "Seed");
    const rawTools  = await getOwnedByType(address, "Tool");
    const rawCrates = await getOwnedByType(address, "Crate");

    const seeds = rawSeeds.map(parseSeed);
    const tools = rawTools.map((obj) => ({
      objectId: obj.data.objectId,
      kind:     obj.data?.content?.fields?.kind ?? "unknown",
      charges:  Number(obj.data?.content?.fields?.charges ?? 0),
    }));
    const crates = rawCrates.map((obj) => ({
      objectId: obj.data.objectId,
      tier:     Number(obj.data?.content?.fields?.tier ?? 0),
    }));

    res.json({
      ok: true,
      data: {
        address,
        totalSeeds: seeds.length,
        totalGP:    seeds.reduce((s, x) => s + (x.growthPoints ?? 0), 0),
        seeds,
        tools,
        crates,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Global stats from Registry
app.get("/api/stats", statsLimit, async (_, res) => {
  try {
    const fields = await getRegistryFields();
    const seasonStartMs = Number(fields.season_start_ms ?? 0);
    const elapsed = seasonStartMs > 0 ? Math.max(0, Date.now() - seasonStartMs) : 0;
    const daysLeft = seasonStartMs > 0
      ? Math.max(0, Math.floor((SEASON_DURATION_MS - elapsed) / ONE_DAY_MS))
      : 30;
    const progressPct = seasonStartMs > 0
      ? Math.min(100, (elapsed / SEASON_DURATION_MS) * 100)
      : 0;

    res.json({
      ok: true,
      data: {
        admin:             fields.admin ?? null,
        totalSeeds:        Number(fields.total_seeds ?? 0),
        totalGrowthPoints: Number(fields.total_growth_points ?? 0),
        rewardPoolSui:     formatSuiFromMist(fields.reward_pool),
        treasurySui:       formatSuiFromMist(fields.treasury),
        currentSeasonId:   Number(fields.current_season_id ?? 0),
        seasonStartMs,
        daysLeft,
        progressPct:       progressPct.toFixed(1),
        claimable:         seasonStartMs > 0 && elapsed >= SEASON_DURATION_MS,
        paused:            Boolean(fields.paused),
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Referral earnings via events
app.get("/api/referral/:address", referralLimit, async (req, res) => {
  try {
    const { address } = req.params;
    if (!/^0x[a-fA-F0-9]{64}$/.test(address)) {
      return res.status(400).json({ ok: false, error: "Invalid SUI address format" });
    }

    const events = await getAllEvents("ReferralPaid", 100);
    let totalEarned = 0;
    let plantingEarned = 0;
    let shopEarned = 0;
    let plantingBonusCount = 0;
    let itemShopBonusCount = 0;
    const referees = new Set();
    const PLANTING_REFERRAL_MIST = 1_000_000;

    for (const ev of events) {
      if (ev.parsedJson?.referrer === address) {
        const amount = Number(ev.parsedJson.amount_mist ?? 0);
        totalEarned += amount;
        if (ev.parsedJson?.referee) referees.add(ev.parsedJson.referee);
        if (amount === PLANTING_REFERRAL_MIST) {
          plantingEarned += amount;
          plantingBonusCount += 1;
        } else {
          shopEarned += amount;
          itemShopBonusCount += 1;
        }
      }
    }

    res.json({
      ok: true,
      data: {
        address,
        totalEarnedSui: (totalEarned / 1e9).toFixed(4),
        plantingEarnedSui: (plantingEarned / 1e9).toFixed(4),
        shopEarnedSui: (shopEarned / 1e9).toFixed(4),
        refereeCount: referees.size,
        plantingBonusCount,
        itemShopBonusCount,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Leaderboard — cached for 60s to avoid hammering the RPC
let _lbCache  = null;
let _lbCacheTs = 0;
const LB_CACHE_MS = 60_000;

app.get("/api/leaderboard", statsLimit, async (_, res) => {
  try {
    if (_lbCache && Date.now() - _lbCacheTs < LB_CACHE_MS) {
      return res.json({ ok: true, data: _lbCache, cached: true });
    }

    const fields = await getRegistryFields();
    const currentSeasonId = Number(fields.current_season_id ?? 0);
    const seasonStarted = Number(fields.season_start_ms ?? 0) > 0;
    const allSeeds = (await getAllObjectsByType("Seed", 500))
      .map(parseSeed)
      .filter((seed) =>
        seasonStarted
        && Number(seed.claimedMs ?? 0) === 0
        && (!currentSeasonId || Number(seed.seasonId ?? 0) === currentSeasonId)
      );
    const byOwner = new Map();
    for (const seed of allSeeds) {
      if (!seed.owner) continue;
      const current = byOwner.get(seed.owner) || { addr: seed.owner, gp: 0, count: 0, seeds: 0, live: 0, topStreak: 0 };
      current.gp += seed.growthPoints ?? 0;
      current.count += 1;
      current.seeds = current.count;
      if (seed.state !== "dead") current.live += 1;
      current.topStreak = Math.max(current.topStreak, seed.wateringStreak ?? 0);
      byOwner.set(seed.owner, current);
    }

    const sorted = [...byOwner.values()]
      .map((row) => {
        const count = Math.max(0, Math.min(MAX_ACTIVE_GARDEN_SEEDS, Number(row.count ?? row.seeds ?? 0)));
        const live = Math.max(0, Math.min(count, MAX_ACTIVE_GARDEN_SEEDS, Number(row.live ?? 0)));
        return { ...row, count, seeds: count, live };
      })
      .sort((a, b) => b.gp - a.gp)
      .slice(0, 50);
    _lbCache   = sorted;
    _lbCacheTs = Date.now();

    res.json({ ok: true, data: sorted });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Health check
app.get("/api/health", (_, res) =>
  res.json({ ok: true, ts: Date.now(), network: RPC_URL }),
);

// ─── Start server ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Arboretum API listening on ${PORT}`);
  console.log(`RPC: ${RPC_URL}`);
  console.log(`GraphQL: ${GRAPHQL_URL}`);
  console.log(`Package: ${PACKAGE_ID}`);
  console.log(`Type package: ${TYPE_PACKAGE_ID}`);
  console.log(`Registry: ${REGISTRY_ID}`);
});

module.exports = app;
