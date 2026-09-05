/**
 * garden.js — Arboretum Garden Renderer
 * Fetches the player's seed data and renders an animated emoji garden grid.
 * Include AFTER wallet.js in index.html.
 *
 * <script type="module" src="/garden.js"></script>
 *
 * Expects a <div id="garden-grid"></div> in the HTML.
 */

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const API_BASE = window.ARBORETUM_API_BASE
  || (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001"
    : window.location.origin);

const REFRESH_INTERVAL_MS = 30_000;  // re-poll every 30s

// ─── EMOJI MAPS ──────────────────────────────────────────────────────────────
const STATE_EMOJI = {
  // alive tiers by streak
  alive_0:   { icon: "🌱", label: "Sprout",       color: "#61ffca" },
  alive_4:   { icon: "🌿", label: "Growing",      color: "#19e6b4" },
  alive_10:  { icon: "🌲", label: "Sapling",      color: "#0ecfa0" },
  alive_25:  { icon: "🌺", label: "Blooming",     color: "#ff85c0" },
  alive_50:  { icon: "✨🌳✨", label: "Mythic",  color: "#ffd86f" },
  wilting:   { icon: "🍂", label: "Wilting",      color: "#ffb347" },
  dead:      { icon: "💀", label: "Dead",         color: "#ff4d6a" },
  empty:     { icon: "⬜", label: "Empty slot",   color: "#1a2233" },
};

function seedEmoji(seed) {
  if (!seed || seed.empty) return STATE_EMOJI.empty;
  if (seed.state === "dead")    return STATE_EMOJI.dead;
  if (seed.state === "wilting") return STATE_EMOJI.wilting;
  if (seed.wateringStreak >= 50) return STATE_EMOJI["alive_50"];
  if (seed.wateringStreak >= 25) return STATE_EMOJI["alive_25"];
  if (seed.wateringStreak >= 10) return STATE_EMOJI["alive_10"];
  if (seed.wateringStreak >= 4)  return STATE_EMOJI["alive_4"];
  return STATE_EMOJI["alive_0"];
}

// ─── RENDER ──────────────────────────────────────────────────────────────────
function renderGarden(gardenData) {
  const container = document.getElementById("garden-grid");
  if (!container) return;

  const { seeds = [], totalGP = 0 } = gardenData;
  const alerts = gardenData.alerts ?? seeds
    .filter((seed) => seed.state === "wilting" || seed.state === "dead")
    .map((seed) => ({
      message: `${seed.objectId.slice(0, 8)}… ${seed.droughtDays}d dry`,
    }));
  const deadSeeds = gardenData.deadSeeds ?? seeds.filter((seed) => seed.state === "dead").length;

  // Update stat badges
  setInner("garden-total-gp",    totalGP.toLocaleString());
  setInner("garden-dead-count",  deadSeeds);
  setInner("garden-alert-count", alerts.length);

  // Alert bar
  const alertBar = document.getElementById("garden-alert-bar");
  if (alertBar) {
    if (alerts.length > 0) {
      alertBar.innerHTML = alerts.map(a =>
        `<span class="alert-chip">⚠️ ${escHtml(a.message)}</span>`
      ).join(" ");
      alertBar.style.display = "block";
    } else {
      alertBar.style.display = "none";
    }
  }

  // Build grid – pad to fill complete rows of 8
  const COLS = 8;
  const total = Math.max(seeds.length + 1, COLS);  // always show at least 1 empty "buy" slot
  const padded = [...seeds];
  while (padded.length < total) padded.push(null);

  container.innerHTML = padded.map((seed, idx) => {
    if (!seed) {
      // Empty slot — "buy a seed" CTA
      return `
        <div class="garden-cell empty-cell" title="Plant a new Seed here"
             onclick="(window.openWalletModal || window.showWalletModal)?.('Connect your wallet to plant a new Seed!')">
          <div class="garden-emoji">⬜</div>
          <div class="garden-label">+ Plant</div>
        </div>`;
    }

    const em    = seedEmoji(seed);
    const isWilt = seed.state === "wilting";
    const isDead = seed.state === "dead";

    const canWater = !isDead && seed.droughtDays >= 1;
    const seedIdShort = seed.objectId.slice(0, 6) + "…" + seed.objectId.slice(-4);

    return `
      <div class="garden-cell ${isWilt ? "wilting-cell" : ""} ${isDead ? "dead-cell" : ""}"
           title="${em.label} | Streak: ${seed.wateringStreak}d | GP: ${seed.growthPoints.toLocaleString()}">
        <div class="garden-emoji ${isWilt ? "wilt-pulse" : ""} ${isDead ? "dead-shake" : ""}">
          ${em.icon}
        </div>
        <div class="garden-label" style="color:${em.color}">${em.label}</div>
        <div class="garden-meta">🔥 ${seed.wateringStreak}d streak</div>
        <div class="garden-meta">🌿 ${seed.growthPoints.toLocaleString()} GP</div>
        ${seed.droughtDays > 0
          ? `<div class="garden-meta drought">💧 ${seed.droughtDays}d dry</div>` : ""}
        <div class="garden-actions">
          ${canWater
            ? `<button class="garden-btn water-btn"
                       onclick="handleWater('${escHtml(seed.objectId)}')"
                       data-tooltip="Water this Seed">💧 Water</button>` : ""}
          ${isDead && seed.revivalCharges > 0
            ? `<button class="garden-btn revive-btn"
                       onclick="handleRevive('${escHtml(seed.objectId)}')"
                       data-tooltip="Use a Revival Kit">💫 Revive</button>` : ""}
          <button class="garden-btn info-btn"
                  onclick="showSeedModal('${escHtml(seed.objectId)}')"
                  data-tooltip="Seed details">🔍</button>
        </div>
      </div>`;
  }).join("");
}

// ─── ACTION HANDLERS ─────────────────────────────────────────────────────────
async function handleWater(seedObjectId) {
  const arb = window.arb || window.arboretum;
  if (!arb?.waterSeed) {
    return showToast("Wallet not connected. Please connect first.", "warning");
  }
  showToast("Sending water transaction…", "info");
  try {
    await arb.waterSeed(seedObjectId);
    showToast("💧 Seed watered! Growth points added.", "success");
    setTimeout(() => refreshGarden(), 3000);
  } catch (err) {
    showToast(`Water failed: ${err.message}`, "danger");
  }
}
window.handleWater = handleWater;

async function handleRevive(seedObjectId) {
  const arb = window.arb || window.arboretum;
  if (!arb?.reviveSeed) {
    return showToast("Wallet not connected.", "warning");
  }
  showToast("Sending revival transaction…", "info");
  try {
    await arb.reviveSeed(seedObjectId);
    showToast("💫 Seed revived!", "success");
    setTimeout(() => refreshGarden(), 3000);
  } catch (err) {
    showToast(`Revive failed: ${err.message}`, "danger");
  }
}
window.handleRevive = handleRevive;

function showSeedModal(seedObjectId) {
  if (typeof window.showModal === "function") {
    window.showModal(`
      <strong>Seed Details</strong><br/>
      <code style="font-size:0.7rem;word-break:break-all">${seedObjectId}</code><br/>
      <a href="https://suivision.xyz/object/${seedObjectId}" target="_blank" rel="noopener"
         style="color:var(--primary);font-size:0.78rem">View on SuiVision ↗</a>
    `);
  }
}
window.showSeedModal = showSeedModal;

// ─── POLLING ─────────────────────────────────────────────────────────────────
let gardenTimer = null;

export async function refreshGarden() {
  const address = sessionStorage.getItem("arb_addr") || sessionStorage.getItem("suiWalletAddress");
  if (!address) return;

  const container = document.getElementById("garden-grid");
  if (!container) return;

  // Loading skeleton
  if (container.children.length === 0) {
    container.innerHTML = `<div class="garden-loading">🌱 Loading your Garden…</div>`;
  }

  try {
    const res  = await fetch(`${API_BASE}/api/garden/${address}`);
    const json = await res.json();
    if (json.ok) renderGarden(json.data);
  } catch (err) {
    console.warn("Garden fetch error:", err);
  }
}

export function startGardenPolling() {
  refreshGarden();
  if (gardenTimer) clearInterval(gardenTimer);
  gardenTimer = setInterval(refreshGarden, REFRESH_INTERVAL_MS);
}

export function stopGardenPolling() {
  if (gardenTimer) clearInterval(gardenTimer);
}

// ─── INLINE STYLES ───────────────────────────────────────────────────────────
// Injected so garden.js is self-contained (no extra CSS file needed)
const style = document.createElement("style");
style.textContent = `
  #garden-grid {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 0.6rem;
    margin-top: 0.8rem;
  }

  @media (max-width: 900px) {
    #garden-grid { grid-template-columns: repeat(4, 1fr); }
  }
  @media (max-width: 500px) {
    #garden-grid { grid-template-columns: repeat(3, 1fr); }
  }

  .garden-cell {
    position: relative;
    padding: 0.6rem 0.4rem 0.55rem;
    border-radius: 14px;
    border: 1px solid rgba(190,224,255,0.22);
    background: rgba(5,9,19,0.97);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    cursor: default;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    min-height: 130px;
    overflow: hidden;
  }

  .garden-cell:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 18px rgba(25,230,180,0.25);
    border-color: rgba(25,230,180,0.55);
  }

  .empty-cell {
    border-style: dashed;
    border-color: rgba(190,224,255,0.15);
    cursor: pointer;
    opacity: 0.6;
  }
  .empty-cell:hover { opacity: 1; }

  .wilting-cell {
    border-color: rgba(255,179,71,0.6);
    box-shadow: 0 0 12px rgba(255,179,71,0.25);
  }

  .dead-cell {
    border-color: rgba(255,77,106,0.5);
    opacity: 0.75;
  }

  .garden-emoji {
    font-size: 2rem;
    line-height: 1;
    user-select: none;
  }

  .wilt-pulse {
    animation: wiltPulse 2s ease-in-out infinite;
  }
  @keyframes wiltPulse {
    0%, 100% { opacity: 1;   transform: scale(1);    }
    50%       { opacity: 0.6; transform: scale(0.92); }
  }

  .dead-shake {
    animation: deadShake 4s ease-in-out infinite;
  }
  @keyframes deadShake {
    0%,90%,100% { transform: rotate(0deg);   }
    92%          { transform: rotate(-4deg);  }
    94%          { transform: rotate(4deg);   }
    96%          { transform: rotate(-2deg);  }
    98%          { transform: rotate(2deg);   }
  }

  .garden-label {
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .garden-meta {
    font-size: 0.6rem;
    color: rgba(165,175,199,0.85);
  }

  .garden-meta.drought { color: #ffb347; }

  .garden-actions {
    display: flex;
    gap: 0.25rem;
    margin-top: 0.3rem;
    flex-wrap: wrap;
    justify-content: center;
  }

  .garden-btn {
    padding: 0.18rem 0.4rem;
    border-radius: 999px;
    border: 1px solid rgba(25,230,180,0.5);
    background: rgba(25,230,180,0.1);
    color: #f5f7ff;
    font-size: 0.6rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .garden-btn:hover { background: rgba(25,230,180,0.22); }
  .revive-btn  { border-color: rgba(255,216,111,0.6); background: rgba(255,216,111,0.12); }
  .info-btn    { border-color: rgba(133,189,255,0.4); background: rgba(59,130,246,0.1); }

  .garden-loading {
    grid-column: 1/-1;
    text-align: center;
    padding: 2rem;
    color: rgba(165,175,199,0.7);
    font-size: 0.85rem;
  }

  #garden-alert-bar {
    display: none;
    background: rgba(255,179,71,0.1);
    border: 1px solid rgba(255,179,71,0.4);
    border-radius: 10px;
    padding: 0.5rem 0.8rem;
    margin-bottom: 0.6rem;
    font-size: 0.75rem;
    color: #ffb347;
  }

  .alert-chip {
    display: inline-block;
    margin: 0.15rem 0.25rem;
  }

  /* Toast notifications */
  #arboretum-toast-container {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    pointer-events: none;
  }

  .arboretum-toast {
    padding: 0.6rem 1rem;
    border-radius: 10px;
    font-size: 0.78rem;
    border: 1px solid rgba(190,224,255,0.25);
    background: rgba(3,7,16,0.97);
    color: #f5f7ff;
    box-shadow: 0 8px 24px rgba(0,0,0,0.8);
    animation: toastIn 0.2s ease forwards;
    pointer-events: auto;
  }
  .arboretum-toast.success { border-color: rgba(25,230,180,0.6); }
  .arboretum-toast.warning { border-color: rgba(255,179,71,0.6); }
  .arboretum-toast.danger  { border-color: rgba(255,77,106,0.6); }
  .arboretum-toast.info    { border-color: rgba(133,189,255,0.5); }

  @keyframes toastIn {
    from { opacity: 0; transform: translateX(20px); }
    to   { opacity: 1; transform: translateX(0); }
  }
`;
document.head.appendChild(style);

// ─── TOAST ───────────────────────────────────────────────────────────────────
let toastContainer;
function ensureToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.id = "arboretum-toast-container";
    document.body.appendChild(toastContainer);
  }
}

function showToast(message, type = "info", durationMs = 4000) {
  ensureToastContainer();
  const toast = document.createElement("div");
  toast.className = `arboretum-toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => { toast.style.opacity = "0"; setTimeout(() => toast.remove(), 300); }, durationMs);
}
window.showToast = showToast;

// ─── UTILS ───────────────────────────────────────────────────────────────────
function setInner(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── AUTO-START on wallet connect ─────────────────────────────────────────────
// Listen for the BroadcastChannel message that index.html fires
const bc = new BroadcastChannel("arboretum-wallet");
bc.addEventListener("message", (e) => {
  if (e.data?.type === "wallet-connected") {
    startGardenPolling();
  } else if (e.data?.type === "wallet-disconnected") {
    stopGardenPolling();
    const container = document.getElementById("garden-grid");
    if (container) container.innerHTML = "";
  }
});

// Also check immediately (page reload with active session)
if (sessionStorage.getItem("arb_addr") || sessionStorage.getItem("suiWalletAddress")) {
  startGardenPolling();
}

export { showToast };
