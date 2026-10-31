#!/usr/bin/env python3
"""Offline browser verification of the read-only New seasons and legacy routes.

Run after the normal production-target build. Runtime Node Playwright avoids a
project dependency. ARBORETUM_REVIEW_CHROMIUM selects an installed Chromium.
The browser has a dead proxy, blocked service workers/WebSockets, synthetic
Wallet Standard providers, and explicit local responses for every read. No
real wallet, signing primitive, chain submission, or live RPC is available.

Evidence stays under /tmp/arboretum-new-seasons-browser-review. Registry and
AdminCap shapes come from the confirmed public setup receipt; wallet ownership,
legacy Seed, balances, clock freshness, and unavailable responses are fixtures.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
OUTPUT_ROOT = Path("/tmp/arboretum-new-seasons-browser-review")

RUNNER = r"""
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const config = JSON.parse(process.env.ARBORETUM_NEW_SEASONS_REVIEW);
const password = config.hosted ? fs.readFileSync(0, 'utf8').trim() : '';
if (config.hosted) assert(password.length >= 32 && password.length <= 256, 'Supply the existing tester code through stdin');
const redact = value => password ? String(value).split(password).join('[REDACTED]') : String(value);
const require = createRequire(path.join(config.root, 'package.json'));
const { chromium } = require(config.playwright);
const { toBase58 } = await import(pathToFileURL(require.resolve('@mysten/bcs')));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const read = file => JSON.parse(fs.readFileSync(path.join(config.root, file), 'utf8'));
const ORIGIN = 'https://www.treegrow.xyz';
const GRAPHQL = 'https://graphql.mainnet.sui.io/graphql';
const OWNER = '0x' + 'd'.repeat(64);
const SEED_ID = '0x' + 'e'.repeat(64);
const WRONG = '0x' + '1'.repeat(64);
const WALLET_NAME = 'Arboretum Synthetic Read-only Review';
const SETUP_CAPTURE = 'settlement-integration/release/evidence/20261031-confirmed-setup/receipt.json';
const LEGACY_CAPTURE = 'settlement-integration/release/evidence/20261020-initial/chain-inputs.json';
const setup = read(SETUP_CAPTURE).response.data;
const legacy = read(LEGACY_CAPTURE).response.data.registry;
const registry = setup.registries.nodes[0], adminCap = setup.adminCaps.nodes[0];
const registryFields = registry.asMoveObject.contents.json;
const legacyPackage = legacy.asMoveObject.contents.type.repr.split('::')[0];
const checkpoint = setup.checkpoint.sequenceNumber;
const binding = {
  registryId: registry.address, adminCapId: adminCap.address,
  packageId: registry.asMoveObject.contents.type.repr.split('::')[0], administrator: registryFields.admin,
};
const empty = nodes => ({ nodes: nodes || [], pageInfo: { hasNextPage: false, endCursor: null } });
const checks = [], contexts = [], screenshots = [];
const compiled = new Map();
function freeze(dir, prefix = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) freeze(path.join(dir, entry.name), name + '/');
    else compiled.set(name, fs.readFileSync(path.join(dir, entry.name)));
  }
}
freeze(config.dist);
const assetHashes = new Map();
const servedAssetHashes = new Map();
let hostedHtmlVerification = null;
let browser;

function check(name, passed, detail) {
  const row = { check: name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) };
  checks.push(row);
  console.log(redact(`${row.passed ? 'PASS' : 'FAIL'} ${name}${!row.passed && detail ? ': ' + detail : ''}`));
}
async function scenario(name, run) {
  try { await run(); check(name, true); }
  catch (error) { check(name, false, error.stack || error.message); }
}

function installWallet(settings) {
  const listeners = new Set();
  const account = { address: settings.address, publicKey: new Uint8Array(32), chains: [settings.chain],
    features: ['sui:signAndExecuteTransaction', 'sui:signTransaction', 'sui:signPersonalMessage'] };
  const audit = { connect: 0, disconnect: 0, signing: [] };
  const denied = method => async () => {
    audit.signing.push(method);
    await window.__recordWalletAction({ method, signing: true });
    throw Error('Synthetic review wallet cannot sign or submit');
  };
  const wallet = {
    version: '1.0.0', name: settings.name,
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',
    chains: [settings.chain], accounts: [], features: {
      'standard:connect': { version: '1.0.0', connect: async () => {
        audit.connect += 1; wallet.accounts = [account];
        await window.__recordWalletAction({ method: 'connect', signing: false });
        listeners.forEach(listener => listener({ accounts: wallet.accounts }));
        return { accounts: wallet.accounts };
      } },
      'standard:disconnect': { version: '1.0.0', disconnect: async () => {
        audit.disconnect += 1; wallet.accounts = [];
        await window.__recordWalletAction({ method: 'disconnect', signing: false });
        listeners.forEach(listener => listener({ accounts: [] }));
      } },
      'standard:events': { version: '1.0.0', on: (event, listener) => {
        if (event === 'change') listeners.add(listener);
        return () => listeners.delete(listener);
      } },
      'sui:signAndExecuteTransaction': { version: '2.0.0', signAndExecuteTransaction: denied('signAndExecuteTransaction') },
      'sui:signTransaction': { version: '2.0.0', signTransaction: denied('signTransaction') },
      'sui:signPersonalMessage': { version: '1.1.0', signPersonalMessage: denied('signPersonalMessage') },
    },
  };
  window.__syntheticWallet = { audit, wallet };
  const register = api => api.register(wallet);
  window.addEventListener('wallet-standard:app-ready', event => register(event.detail));
  window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }));
}

function createFixture(settings) {
  const control = { failRegistry: false, wrongRegistry: false, failOwned: false, now: Date.now(), ...settings };
  const seed = {
    address: SEED_ID, version: 1, digest: toBase58(Buffer.from(sha('Arboretum isolated legacy Seed'), 'hex')),
    owner: { __typename: 'AddressOwner', address: { address: OWNER } },
    asMoveObject: { contents: { type: { repr: `${legacyPackage}::arboretum::Seed` }, json: {
      id: SEED_ID, owner: OWNER, sapling_id: '0x' + 'f'.repeat(64), season_id: '3',
      planted_at_ms: '1788383941401', last_watered_ms: '1790548022735', watering_streak: '2',
      growth_points: '188', state: 0, fertilizer_charges: 0, miracle_grow_applied: false,
      revival_charges: 0, bottomless_can_expiry_ms: '0', permanent_gp_bonus: '0',
    } } },
  };
  const clock = () => ({ asMoveObject: { contents: { json: { timestamp_ms: String(control.now) } } } });
  const selectedRegistry = id => {
    assert([binding.registryId, legacy.address].includes(id), 'Unexpected Registry requested');
    if (id === binding.registryId && control.failRegistry) throw Object.assign(Error('Synthetic Registry read unavailable'), { fixture: true });
    const object = clone(id === binding.registryId ? registry : legacy);
    if (id === binding.registryId && control.wrongRegistry) object.asMoveObject.contents.type.repr = `${WRONG}::settlement::Registry`;
    return object;
  };
  const scope = (variables, value) => {
    if (variables.cp != null) assert.equal(variables.cp, checkpoint, 'Reads must use one fixture checkpoint');
    return { checkpoint: { sequenceNumber: checkpoint, query: value } };
  };
  function query(operation, variables) {
    if (operation === 'IntegrationState') return scope(variables, { registry: selectedRegistry(variables.registry), clock: clock() });
    if (operation === 'IntegrationObject') {
      let object = null;
      if ([binding.registryId, legacy.address].includes(variables.id)) object = selectedRegistry(variables.id);
      else if (variables.id === binding.adminCapId) object = clone(adminCap);
      else if (variables.id === SEED_ID) object = clone(seed);
      return scope(variables, { object });
    }
    if (operation === 'IntegrationOwned' || operation === 'IntegrationAll') {
      const owned = operation === 'IntegrationOwned';
      if (owned) assert([OWNER, binding.administrator].includes(variables.owner), 'Unexpected synthetic wallet owner');
      const legacySeed = variables.type === `${legacyPackage}::arboretum::Seed`;
      if (owned && control.failOwned && /::Seed$/.test(variables.type)) throw Object.assign(Error('Synthetic owned-Seed read unavailable'), { fixture: true });
      const nodes = legacySeed && (!owned || variables.owner === OWNER) ? [clone(seed)] : [];
      if (owned) for (const node of nodes) { node.contents = node.asMoveObject.contents; delete node.asMoveObject; }
      return scope(variables, owned ? { address: { objects: empty(nodes) } } : { objects: empty(nodes) });
    }
    if (operation === 'IntegrationEvents') return scope(variables, { events: empty() });
    if (operation === 'IntegrationName') return { address: { defaultNameRecord: null } };
    if (operation === 'IntegrationBalance') return { address: { balance: { totalBalance: '5000000000' } } };
    if (operation === 'GardenSeasonStatus') return { registry: selectedRegistry(variables.registry), clock: clock() };
    throw Error(`Unhandled read-only fixture ${operation}`);
  }
  return { control, query };
}

async function fixtureContext(name, settings = {}) {
  const width = settings.width || 1440;
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 1000 },
    deviceScaleFactor: 1, timezoneId: 'UTC', serviceWorkers: 'block', isMobile: width < 600, hasTouch: width < 600 });
  const fixture = createFixture(settings);
  const record = { name, width, requests: [], blocked: [], unexpected: [], pageErrors: [], consoleErrors: [], walletActions: [], snapshots: {} };
  record.expectedConsoleErrors = [];
  contexts.push(record);
  await context.exposeBinding('__recordWalletAction', (_source, event) => { record.walletActions.push(event); });
  await context.addInitScript(installWallet, { name: WALLET_NAME, address: settings.administrator ? binding.administrator : OWNER,
    chain: settings.chain || 'sui:mainnet' });
  await context.routeWebSocket('**/*', socket => { record.unexpected.push({ websocket: socket.url() }); socket.close({ code: 1008, reason: 'Offline review' }); });
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    const row = { origin: url.origin, path: url.pathname, method: request.method() };
    record.requests.push(row);
    if (url.origin === ORIGIN && request.method() === 'GET') {
      if (url.pathname.startsWith('/api/referral/')) {
        row.fixture = 'Unavailable optional referral backend';
        return route.fulfill({ status: 200, json: { error: 'Offline optional backend fixture' } });
      }
      let filename = decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html';
      if (filename.endsWith('/')) filename += 'index.html';
      if (compiled.has(filename)) {
        const body = compiled.get(filename);
        const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
          '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json' };
        row.fixture = 'Frozen compiled asset'; assetHashes.set(filename, sha(body));
        return route.fulfill({ status: 200, contentType: types[path.extname(filename)] || 'application/octet-stream', body });
      }
      record.unexpected.push({ ...row, reason: 'Missing compiled asset' });
      return route.fulfill({ status: 404, body: 'Missing offline asset' });
    }
    if (url.href === GRAPHQL && request.method() === 'OPTIONS') {
      row.fixture = 'Local GraphQL CORS'; return route.fulfill({ status: 204, headers: cors });
    }
    if (url.href === GRAPHQL && request.method() === 'POST') {
      try {
        const body = request.postDataJSON(), operation = /^\s*query\s+(\w+)/.exec(body.query)?.[1];
        assert(operation && !/\b(mutation|executeTransaction|simulateTransaction|dryRunTransaction)\b/.test(body.query), 'Only explicit read queries are allowed');
        row.operation = operation; row.variables = body.variables || {};
        const data = fixture.query(operation, row.variables);
        row.fixture = 'Captured binding and synthetic read response';
        return route.fulfill({ status: 200, headers: cors, json: { data } });
      } catch (error) {
        row.fixture = error.fixture ? error.message : 'Unexpected query';
        if (!error.fixture) record.unexpected.push({ ...row, reason: error.message });
        return route.fulfill({ status: 200, headers: cors, json: { errors: [{ message: error.message }] } });
      }
    }
    if (url.hostname === 'fonts.googleapis.com' && request.method() === 'GET') {
      row.fixture = 'Empty optional font stylesheet; local fallback fonts';
      return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    }
    record.blocked.push(row);
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => record.pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (settings.chain === 'sui:testnet' && /^connectWallet error Error: WRONG_NETWORK\n/.test(text)) record.expectedConsoleErrors.push(text);
    else record.consoleErrors.push(text);
  });
  const goto = async pathname => {
    await page.goto(ORIGIN + pathname, { waitUntil: 'load' });
    await page.waitForFunction(() => window._walletReady && window.arb && window.arbSettlementPanel);
  };
  return { context, page, goto, record, control: fixture.control };
}

async function openRewards(page) {
  const nav = page.locator('.nav-a[href="#rewards-sec"]').first();
  if (!await nav.isVisible() && await page.locator('#menu-toggle').isVisible()) await page.locator('#menu-toggle').click();
  await nav.click();
  await page.waitForFunction(() => document.querySelector('#rewards-sec').classList.contains('active'));
}
async function connect(page) {
  await page.locator('#wallet-btn').click();
  await page.locator('#wallet-modal.open').waitFor();
  await page.getByText(WALLET_NAME, { exact: true }).click();
}
async function capture(page, filename) {
  await page.waitForFunction(() => !document.querySelector('#toast-wrap .toast'), null, { timeout: 15000 });
  await page.evaluate(hosted => {
    let tag = document.querySelector('#synthetic-review-watermark');
    if (!tag) {
      tag = document.createElement('div'); tag.id = 'synthetic-review-watermark';
      tag.textContent = hosted ? 'HOSTED READ-ONLY VERIFICATION · NO WALLET CONNECTED' : 'SYNTHETIC OFFLINE REVIEW · NO LIVE WALLET OR NETWORK';
      tag.style.cssText = 'position:relative;padding:8px 10px;background:#314434;color:#fff;text-align:center;font:11px/1.5 monospace;overflow-wrap:anywhere;z-index:2';
      document.body.prepend(tag);
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, config.hosted);
  await page.screenshot({ path: path.join(config.output, filename), fullPage: true, animations: 'disabled' });
  screenshots.push({ filename, sha256: sha(fs.readFileSync(path.join(config.output, filename))) });
}

const ECONOMIC_METHODS = ['plantSeed', 'batchPlantSeeds', 'waterSeed', 'applyTool', 'reviveSeed',
  'reviveSeedWithTool', 'abandonSeed', 'buyCrate', 'buyBoomChest', 'buyVictoryChest', 'buySupplyDrop', 'openCrate',
  'claimReward', 'claimArchivedReward', 'batchWaterAllSeeds', 'adminStartSeason', 'adminStartSeasonForDuration',
  'adminResetSeason', 'adminSetPaused', 'adminDepositToPool', 'adminWithdrawTreasury', 'adminSendPromoCrate',
  'adminCreateChallengeBook', 'adminOpenCanopySprint', 'enterCanopySprint', 'adminFinalizeCanopySprint',
  'adminCancelCanopySprint', 'refundCanopySprintEntry'];

async function snapshot(page) {
  return page.evaluate(() => {
    const text = id => document.getElementById(id)?.textContent.trim() ?? null;
    return {
      protocol: window.arb?.getIntegrationStatus?.(), account: window.arb?.getAddress?.(),
      registryState: document.querySelector('#sr-registry')?.dataset.state,
      registryTitle: text('sr-registry-title'), registryCopy: text('sr-registry-copy'),
      pool: text('sr-registry-pool'), treasury: text('sr-registry-treasury'),
      registrySeeds: text('sr-registry-seeds'), growthPoints: text('sr-registry-gp'),
      registryId: text('sr-registry-id'), checkpoint: text('sr-registry-checkpoint'),
      rewardsState: text('sr-state'), ownedCount: text('sr-count'), rewardReadStatus: text('sr-read-status'),
      rewardRows: [...document.querySelectorAll('#sr-entries .sr-seed')].map(element => ({ status: element.dataset.rewardStatus, text: element.textContent })),
      projections: ['hero-earn-proj', 'd-sui', 'r-proj'].map(text),
      viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
      lockedControls: [...document.querySelectorAll('[data-review-disabled]')].map(element => ({
        id: element.id, tag: element.tagName, disabled: element.disabled === true,
        hidden: element.hidden, handler: element.getAttribute('onclick'), visible: element.checkVisibility(),
        handlerSource: element.onclick?.toString() || null,
      })),
    };
  });
}
async function waitPublic(page, state = 'inactive') {
  await page.waitForFunction(state => document.querySelector('#sr-registry')?.dataset.state === state, state);
}
function assertInactive(value) {
  assert.equal(value.registryState, 'inactive');
  assert.match(value.registryTitle, /No active season/i);
  assert.equal(value.pool, '0 SUI'); assert.equal(value.treasury, '0 SUI');
  assert.equal(value.registrySeeds, '0'); assert.equal(value.growthPoints, '0');
  assert.equal(value.registryId, binding.registryId);
  assert(value.pageWidth <= value.viewport, `Horizontal overflow: ${value.pageWidth} > ${value.viewport}`);
}
async function assertBindings(page) {
  const selected = await page.evaluate(() => ({ contract: window.arb.CONTRACT, status: window.arb.getIntegrationStatus() }));
  assert.equal(selected.contract.REGISTRY_ID, binding.registryId);
  assert.equal(selected.contract.ADMIN_CAP_ID, binding.adminCapId);
  assert.equal(selected.contract.PACKAGE_ID, binding.packageId);
  assert.equal(selected.contract.NETWORK, 'mainnet');
  assert.equal(selected.contract.READ_ONLY, true);
  assert.equal(selected.status.readOnly, true); assert.equal(selected.status.reviewOnly, true);
  assert.equal(selected.status.protocol, 'settlement');
}
async function assertEconomicGuards(page, expectedCode) {
  const outcomes = await page.evaluate(async ({ methods, expectedCode }) => {
    const output = [];
    for (const name of methods) {
      if (typeof window.arb[name] !== 'function') throw Error('Missing public economic entry point: ' + name);
      try { await window.arb[name](); output.push({ name, code: 'UNEXPECTED_SUCCESS' }); }
      catch (error) { output.push({ name, code: error?.code || null }); }
    }
    const source = [...document.scripts].find(script => /\/(?:settlement-)?wallet\.js(?:\?|$)/.test(script.src))?.src;
    if (!source) throw Error('Compiled wallet module script was not found');
    const module = await import(source);
    try { await module.signAndExecute({}); output.push({ name: 'signAndExecute', code: 'UNEXPECTED_SUCCESS' }); }
    catch (error) { output.push({ name: 'signAndExecute', code: error?.code || null }); }
    if (output.some(row => row.code !== expectedCode)) throw Error(JSON.stringify(output));
    return output;
  }, { methods: ECONOMIC_METHODS, expectedCode });
  return outcomes;
}

async function runOffline() {
  verifyHostedAllowlist();
  check('Hosted request allowlist rejects unknown, wrong-Registry, mutation, simulation and signing queries', true);
  const deployment = await import(pathToFileURL(path.join(config.dist, 'settlement-integration/deployment-config.mjs')));
  assert.equal(deployment.SETTLEMENT_DEPLOYMENT.reviewEnabled, true);
  assert.equal(deployment.SETTLEMENT_DEPLOYMENT.enabled, false);
  assert.equal(deployment.REVIEW_ONLY, true);
  assert.equal(deployment.SETTLEMENT_DEPLOYMENT.REGISTRY_ID, binding.registryId);
  assert.equal(deployment.SETTLEMENT_DEPLOYMENT.ADMIN_CAP_ID, binding.adminCapId);
  assert.equal(adminCap.asMoveObject.contents.json.registry_id, binding.registryId);
  assert.equal(adminCap.owner.address.address, binding.administrator);
  check('Compiled read-only configuration matches the independently confirmed Registry and AdminCap binding', true, binding);

  for (const width of [1440, 390]) {
    await scenario(`${width}: public inactive state, explicit empty-wallet read and preserved legacy navigation`, async () => {
      const f = await fixtureContext('read-only-' + width, { width }); const p = f.page;
      await f.goto('/settlement-game.html'); await waitPublic(p); await assertBindings(p);
      assert.equal(await p.evaluate(() => __syntheticWallet.audit.connect), 0);
      assert.equal(await p.evaluate(() => arb.getAddress()), null);
      assert(!f.record.requests.some(row => row.operation === 'IntegrationOwned'));
      const disconnected = await snapshot(p); assertInactive(disconnected);
      assert.notEqual(disconnected.ownedCount, '0', 'Disconnected wallet inventory must not be presented as a verified zero');
      f.record.snapshots.disconnected = disconnected;
      // The inherited advice renderer refreshes one hidden compatibility node's
      // onclick/disabled values. Accept only that known node, while verifying
      // actual invisibility, inability to focus, and every mutation API below.
      assert(disconnected.lockedControls.length > 0 && disconnected.lockedControls.every(control =>
        control.hidden && !control.visible), JSON.stringify(disconnected.lockedControls));
      const focusable = await p.evaluate(() => {
        const found = [];
        for (const element of document.querySelectorAll('[data-review-disabled]')) {
          element.focus({ preventScroll: true });
          if (document.activeElement === element) found.push(element.id || element.textContent.trim());
        }
        return found;
      });
      assert.deepEqual(focusable, []);
      const dispatched = disconnected.lockedControls.filter(control => control.handler !== 'return false' && control.handlerSource !== null);
      f.record.hiddenInheritedAdviceHandlers = dispatched;
      assert(dispatched.every(control => control.id === 'garden-next-growth-action' && /^\(\)\s*=>\s*act\(a\.kind\)$/.test(control.handlerSource)), JSON.stringify(dispatched));
      check(`${width}: economic controls are invisible and cannot receive focus; the known hidden advice handler is recorded`, true, dispatched);
      check(`${width}: disconnected view verifies no active season and zero balances without an automatic wallet request`, true);
      await p.waitForTimeout(3000);
      assertInactive(await snapshot(p));
      assert(!/care actions use real transactions/i.test(await p.locator('body').innerText()));
      check(`${width}: inherited periodic updates preserve inactive read-only state and accurate transaction copy`, true);
      await capture(p, `new-seasons-disconnected-${width}.png`);

      f.record.economicGuards = await assertEconomicGuards(p, 'CONTRACT_ROUTE_READ_ONLY');
      assert.equal(f.record.walletActions.filter(event => event.signing).length, 0);
      check(`${width}: all 28 public economic actions and the common signing boundary reject before wallet access`, true);

      await connect(p);
      await p.waitForFunction(address => window.arb.getAddress() === address, OWNER);
      await openRewards(p);
      await p.waitForFunction(() => document.querySelector('#sr-count').textContent === '0');
      const connected = await snapshot(p); assertInactive(connected);
      assert.equal(connected.rewardRows.length, 0);
      assert.equal(connected.ownedCount, '0');
      assert.match(connected.rewardsState, /No Seeds|No active season/i);
      f.record.snapshots.connected = connected;
      check(`${width}: explicit synthetic mainnet connection shows a verified empty new-season inventory`, true);
      await p.evaluate(() => window.doClaimReward());
      assert.match(await p.locator('#sr-action-note').innerText(), /review|disabled/i);
      const mint = await p.evaluate(() => window.mintNftreeInArboretum());
      assert.equal(mint.submitted, false); assert.equal(mint.reason, 'REVIEW_ONLY');
      assert.equal(f.record.walletActions.filter(event => event.signing).length, 0);

      await p.locator('#sr-routes [data-route="legacy"]').click();
      await p.waitForURL(ORIGIN + '/game.html');
      await p.waitForFunction(() => window._walletReady && window.arbSettlementPanel && window.arb.getIntegrationStatus().protocol === 'legacy');
      assert.equal(await p.locator('#sr-routes [data-route="settlement"]').getAttribute('href'), '/settlement-game.html');
      if (!await p.evaluate(() => window.arb.getAddress())) {
        await connect(p); await p.waitForFunction(address => window.arb.getAddress() === address, OWNER);
      }
      await openRewards(p); await p.waitForFunction(() => document.querySelector('#sr-count').textContent === '1');
      const prior = await snapshot(p);
      assert.equal(prior.rewardRows.length, 1); assert.equal(prior.rewardRows[0].status, 'legacy');
      assert(prior.projections.every(value => value === 'Under review'));
      assert(prior.pageWidth <= width);
      f.record.snapshots.legacy = prior;
      check(`${width}: legacy navigation preserves separate Seed history and Under review rewards`, true);
      await assertEconomicGuards(p, 'REVIEW_ONLY');
      await capture(p, `existing-garden-rewards-${width}.png`);
      await p.locator('#sr-routes [data-route="settlement"]').click();
      await p.waitForURL(ORIGIN + '/settlement-game.html');
      await p.waitForFunction(() => window._walletReady && window.arbSettlementPanel);
      await waitPublic(p); assertInactive(await snapshot(p));
      assert.equal(f.record.walletActions.filter(event => event.signing).length, 0);
      check(`${width}: navigation returns to the new Registry without any signing request`, true);
      await f.context.close();
    });
  }

  await scenario('Failed and wrong-identity Registry reads clear verified zeros and recover explicitly', async () => {
    const f = await fixtureContext('registry-unavailable'); const p = f.page;
    await f.goto('/settlement-game.html'); await waitPublic(p);
    for (const key of ['failRegistry', 'wrongRegistry']) {
      f.control[key] = true;
      await p.locator('#sr-registry-refresh').click(); await waitPublic(p, 'unavailable');
      const failed = await snapshot(p);
      for (const field of ['pool', 'treasury', 'registrySeeds', 'growthPoints']) assert.equal(failed[field], 'Unavailable');
      assert.match(failed.registryTitle, /unavailable/i);
      assert.equal(await p.evaluate(() => arb.getAddress()), null);
      f.record.snapshots[key] = failed;
      check(`${key}: unverified public values display Unavailable, never retained or fabricated zero`, true);
      if (key === 'failRegistry') await capture(p, 'new-seasons-unavailable-desktop.png');
      f.control[key] = false;
      await p.locator('#sr-registry-refresh').click(); await waitPublic(p); assertInactive(await snapshot(p));
    }
    await f.context.close();
  });

  await scenario('An unavailable owned-Seed read clears an empty-wallet count without altering verified public state', async () => {
    const f = await fixtureContext('inventory-unavailable', { width: 390 }); const p = f.page;
    await f.goto('/settlement-game.html'); await waitPublic(p); await connect(p);
    await p.waitForFunction(address => window.arb.getAddress() === address, OWNER); await openRewards(p);
    await p.waitForFunction(() => document.querySelector('#sr-count').textContent === '0');
    f.control.failOwned = true;
    await p.locator('#sr-refresh').click();
    await p.waitForFunction(() => document.querySelector('#sr-read-status').textContent === 'Reward read failed');
    const failed = await snapshot(p); assertInactive(failed);
    assert.equal(failed.ownedCount, 'Unavailable'); assert.match(failed.rewardsState, /Unavailable/i);
    assert(failed.projections.every(value => value === 'Unavailable'));
    f.record.snapshots.failure = failed;
    await capture(p, 'new-seasons-inventory-unavailable-mobile.png');
    await f.context.close();
  });

  await scenario('A testnet-only wallet is rejected while the verified public mainnet view remains independent', async () => {
    const f = await fixtureContext('wrong-wallet-network', { chain: 'sui:testnet' }); const p = f.page;
    await f.goto('/settlement-game.html'); await waitPublic(p); await connect(p);
    await p.waitForFunction(() => /mainnet|network/i.test(document.querySelector('#toast-wrap')?.textContent || ''));
    assert.equal(await p.evaluate(() => arb.getAddress()), null);
    assert(!f.record.requests.some(row => row.operation === 'IntegrationOwned'));
    assertInactive(await snapshot(p));
    assert.equal(f.record.walletActions.filter(event => event.signing).length, 0);
    await f.context.close();
  });
  for (const context of contexts) {
    check(context.name + ': no uncaught page or unexpected console errors', context.pageErrors.length === 0 && context.consoleErrors.length === 0,
      { pageErrors: context.pageErrors, consoleErrors: context.consoleErrors,
        expectedHandledWrongNetworkErrors: context.expectedConsoleErrors.length });
    check(context.name + ': only known local assets and read-only fixtures requested', context.unexpected.length === 0 && context.blocked.length === 0,
      { unexpected: context.unexpected, blocked: context.blocked });
    check(context.name + ': no wallet signing request', context.walletActions.every(event => !event.signing));
  }
}

function allowPublicRead(body) {
  if (!body || typeof body.query !== 'string' || /\b(mutation|executeTransaction|simulateTransaction|dryRunTransaction|signTransaction)\b/.test(body.query)) return null;
  const operation = /^\s*query\s+(\w+)/.exec(body.query)?.[1];
  const variables = body.variables || {};
  if (['IntegrationState', 'GardenSeasonStatus'].includes(operation)) {
    return variables.registry === binding.registryId ? operation : null;
  }
  if (operation === 'IntegrationObject') {
    return [binding.registryId, binding.adminCapId, '0x6', '0x' + '0'.repeat(63) + '6'].includes(variables.id) ? operation : null;
  }
  if (['IntegrationAll', 'IntegrationEvents'].includes(operation)) {
    return typeof variables.type === 'string' && variables.type.startsWith(binding.packageId + '::settlement::') ? operation : null;
  }
  return null;
}

function verifyHostedAllowlist() {
  const good = { query: 'query IntegrationState($registry:SuiAddress!){checkpoint{sequenceNumber}}', variables: { registry: binding.registryId } };
  assert.equal(allowPublicRead(good), 'IntegrationState');
  for (const body of [
    { ...good, variables: { registry: legacy.address } },
    { ...good, query: 'mutation IntegrationState { executeTransaction }' },
    { ...good, query: 'query IntegrationState { simulateTransaction }' },
    { ...good, query: 'query IntegrationState { dryRunTransaction }' },
    { ...good, query: 'query IntegrationState { executeTransaction }' },
    { ...good, query: 'query IntegrationState { signTransaction }' },
    { query: 'query IntegrationOwned { address }', variables: { owner: OWNER } },
    { query: 'query ArbitraryRead { checkpoint }' },
    {},
  ]) assert.equal(allowPublicRead(body), null, 'Host allowlist accepted an unapproved request');
}

// The hosting layer rewrites these seven static .html anchors to pretty paths
// and reserializes only their attributes. The authenticated edge gate forwards
// the body unchanged. This is an exact observed exception, not HTML/whitespace
// normalization: all seven complete anchors must occur once in each document,
// and every byte outside these replacements must equal the frozen build.
const HOSTED_HTML_ANCHORS = Object.freeze([
  {
    source: `<a class="sr-route" href="/game.html">Existing garden <small>Default route</small></a>`,
    served: `<a class='sr-route' href='/game'>Existing garden <small>Default route</small></a>`,
  },
  {
    source: `<a href="player-guide.html" class="nav-a home-link player-guide-link" target="_blank" rel="noopener noreferrer" aria-label="How to Play — opens player guide in a new tab">How to Play</a>`,
    served: `<a aria-label='How to Play — opens player guide in a new tab' class='nav-a home-link player-guide-link' href='/player-guide' rel='noopener noreferrer' target='_blank'>How to Play</a>`,
  },
  {
    source: `<a href="player-guide.html" class="home-link player-guide-link" target="_blank" rel="noopener noreferrer">How to Play ↗</a>`,
    served: `<a class='home-link player-guide-link' href='/player-guide' rel='noopener noreferrer' target='_blank'>How to Play ↗</a>`,
  },
  {
    source: `<a class="gbtn guide-context-link" href="player-guide.html#watering" target="_blank" rel="noopener noreferrer">Garden help ↗</a>`,
    served: `<a class='gbtn guide-context-link' href='/player-guide#watering' rel='noopener noreferrer' target='_blank'>Garden help ↗</a>`,
  },
  {
    source: `<a class="gbtn guide-context-link" href="player-guide.html#tools" target="_blank" rel="noopener noreferrer">Tool guide ↗</a>`,
    served: `<a class='gbtn guide-context-link' href='/player-guide#tools' rel='noopener noreferrer' target='_blank'>Tool guide ↗</a>`,
  },
  {
    source: `<a class="gbtn guide-context-link" href="player-guide.html#crates" target="_blank" rel="noopener noreferrer">Player Guide: crates &amp; chests ↗</a>`,
    served: `<a class='gbtn guide-context-link' href='/player-guide#crates' rel='noopener noreferrer' target='_blank'>Player Guide: crates &amp; chests ↗</a>`,
  },
  {
    source: `<a href="/game.html">Open the existing garden</a>`,
    served: `<a href='/game'>Open the existing garden</a>`,
  },
]);

function verifyHostedHtml(sourceBytes, servedBytes) {
  assert(Buffer.isBuffer(sourceBytes) && Buffer.isBuffer(servedBytes), 'Both frozen and served HTML bytes are required');
  const source = sourceBytes.toString('utf8'), served = servedBytes.toString('utf8');
  assert(Buffer.from(source, 'utf8').equals(sourceBytes), 'Frozen HTML is not exact UTF-8');
  assert(Buffer.from(served, 'utf8').equals(servedBytes), 'Served HTML is not exact UTF-8');
  let expected = source;
  const transforms = [];
  for (const [index, anchor] of HOSTED_HTML_ANCHORS.entries()) {
    const sourceOccurrences = source.split(anchor.source).length - 1;
    const servedOccurrences = served.split(anchor.served).length - 1;
    assert.equal(sourceOccurrences, 1, `Frozen anchor ${index + 1} must occur exactly once`);
    assert.equal(servedOccurrences, 1, `Served anchor ${index + 1} must occur exactly once`);
    expected = expected.replace(anchor.source, anchor.served);
    transforms.push({ ...anchor, sourceOccurrences, servedOccurrences });
  }
  assert(Buffer.from(expected, 'utf8').equals(servedBytes),
    'Served HTML differs outside the seven exact reviewed anchor rewrites');
  return { sourceSha256: sha(sourceBytes), servedSha256: sha(servedBytes),
    sourceBytes: sourceBytes.length, servedBytes: servedBytes.length,
    allOtherBytesEqual: true, transforms };
}

async function runHosted() {
  verifyHostedAllowlist();
  check('Hosted transport permits only the selected Registry public reads and rejects write/simulation/signing requests', true);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1, timezoneId: 'UTC', serviceWorkers: 'block' });
  const record = { name: 'hosted-public-mainnet', width: 1440, requests: [], blocked: [], unexpected: [],
    pageErrors: [], consoleErrors: [], walletActions: [], snapshots: {}, tlsVerification: 'normal', walletProviderInjected: false };
  contexts.push(record);
  const publicResponses = [], responseTasks = [], hostedHashes = new Map();
  const requiredAssets = new Set(['settlement-game.html', 'settlement-wallet.js', 'settlement-panel.mjs',
    'settlement-integration/deployment-config.mjs', 'settlement-integration/reader.mjs', 'settlement-integration/model.mjs']);
  let servedHtml = null;
  const publicOps = new WeakMap();
  await context.routeWebSocket('**/*', socket => {
    record.blocked.push({ websocket: socket.url() }); socket.close({ code: 1008, reason: 'Read-only smoke' });
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    const row = { origin: url.origin, path: url.pathname, method: request.method() };
    record.requests.push(row);
    if (url.origin === ORIGIN) {
      const filename = decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html';
      if ((request.method() === 'GET' || request.method() === 'HEAD') && (compiled.has(filename) || url.pathname === '/tester-access')) {
        row.allowed = 'Canonical hosted document or asset'; return route.continue();
      }
      if (url.pathname === '/tester-access' && request.method() === 'POST' && request.isNavigationRequest()) {
        // Let the native login form submit. Never read or save its body/headers.
        row.allowed = 'Native tester login'; return route.continue();
      }
    }
    if (url.href === GRAPHQL) {
      if (request.method() === 'OPTIONS') { row.allowed = 'Public GraphQL CORS'; return route.continue(); }
      if (request.method() === 'POST') {
        let operation = null;
        try { operation = allowPublicRead(request.postDataJSON()); } catch { /* Invalid input is denied below. */ }
        if (operation) {
          row.allowed = 'Public mainnet read'; row.operation = operation;
          publicOps.set(request, operation); return route.continue();
        }
      }
    }
    if (url.hostname === 'fonts.googleapis.com' && request.method() === 'GET') {
      row.fixture = 'Empty optional font stylesheet; local fallback fonts';
      return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    }
    // The public, disconnected page uses GraphQL. No gRPC service, wallet host,
    // third-party API, execution service or other POST is needed or permitted.
    record.blocked.push(row);
    return route.abort('blockedbyclient');
  });
  context.on('response', response => {
    responseTasks.push((async () => {
      const request = response.request(), url = new URL(response.url());
      if (url.href === GRAPHQL && publicOps.has(request)) {
        let data;
        try { data = await response.json(); }
        catch { data = { unavailable: 'Non-JSON response' }; }
        publicResponses.push({ receivedAt: new Date().toISOString(), operation: publicOps.get(request), status: response.status(), response: data });
      }
      if (url.origin === ORIGIN && request.method() === 'GET' && response.status() === 200) {
        const filename = decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html';
        // Observe only the authenticated app document and its required module
        // dependencies. Login CSS/images can finish just before navigation and
        // lose their CDP bodies; they are outside this app-byte verification.
        // Any body-read error for a required app asset still fails below.
        if (requiredAssets.has(filename)) {
          const body = await response.body();
          hostedHashes.set(filename, sha(body));
          if (filename === 'settlement-game.html') servedHtml = body;
        }
      }
    })().catch(error => { record.unexpected.push({ observationError: redact(error.message) }); }));
  });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on('pageerror', error => record.pageErrors.push(redact(error.message)));
  page.on('console', message => { if (message.type() === 'error') record.consoleErrors.push(redact(message.text())); });
  context.on('page', opened => { if (opened !== page) record.unexpected.push({ reason: 'Unexpected popup or page' }); });
  try {
    await page.goto(ORIGIN + '/settlement-game.html', { waitUntil: 'domcontentloaded' });
    assert.equal(new URL(page.url()).pathname, '/tester-access', 'A fresh browser must use the existing tester gate');
    assert.equal(new URL(page.url()).searchParams.get('next'), 'new-seasons');
    await page.locator('input[name="password"]').fill(password);
    await page.locator('form').filter({ has: page.locator('input[name="password"]') }).locator('button[type="submit"]').click();
    await page.waitForURL(ORIGIN + '/settlement-game.html');
    await page.waitForFunction(() => window._walletReady && window.arb && window.arbSettlementPanel);
    check('Hosted tester login reaches the actual JavaScript-enabled New seasons route', true);
    await waitPublic(page); await assertBindings(page);
    const actual = await snapshot(page); assertInactive(actual);
    assert.equal(actual.account, null); assert.notEqual(actual.ownedCount, '0');
    assert.equal(await page.locator('#wallet-modal.open').count(), 0);
    assert(!/care actions use real transactions/i.test(await page.locator('body').innerText()));
    record.snapshots.initial = actual;
    check('Actual mainnet response shows the exact Registry, no active season, and verified zero pool/treasury without a wallet', true);
    const state = await page.evaluate(async () => {
      const result = await window.getSeasonStats();
      return JSON.parse(JSON.stringify(result, (_key, value) => typeof value === 'bigint' ? value.toString() : value));
    });
    assert.equal(state.registryId, binding.registryId); assert.equal(state.protocol, 'settlement');
    assert.equal(state.readOnly, true); assert.equal(state.seasonStartMs, 0);
    assert.equal(state.remainingPoolMist, '0'); assert.equal(state.treasuryMist, '0');
    assert.equal(state.totalSeeds, 0); assert.equal(state.totalGrowthPoints, 0);
    assert(Number.isSafeInteger(state.checkpoint) && state.checkpoint >= checkpoint);
    assert(Number.isSafeInteger(state.nowMs) && Math.abs(Date.now() - state.nowMs) < 120000);
    record.snapshots.livePublicGetter = state;
    check('Live public getter binds current checkpoint, network clock and exact empty-state amounts', true);
    await page.waitForTimeout(3000); assertInactive(await snapshot(page));
    check('Hosted periodic updates preserve no-active-season state', true);
    await capture(page, 'hosted-new-seasons-read-only.png');
    await Promise.all(responseTasks);
    hostedHtmlVerification = verifyHostedHtml(compiled.get('settlement-game.html'), servedHtml);
    check('Served HTML has exactly seven reviewed anchor rewrites and all other bytes equal the frozen build', true, hostedHtmlVerification);
    for (const filename of requiredAssets) {
      const sourceHash = sha(compiled.get(filename));
      if (filename !== 'settlement-game.html') assert.equal(hostedHashes.get(filename), sourceHash, 'Hosted asset differs from frozen dist: ' + filename);
      assetHashes.set(filename, sourceHash);
      servedAssetHashes.set(filename, hostedHashes.get(filename));
    }
    check('Hosted wallet/config/model/reader/panel bytes exactly match the frozen local build', true);
    assert(publicResponses.some(response => response.operation === 'IntegrationState' && response.status === 200 && response.response.data));
    assert.equal(record.blocked.length, 0); assert.equal(record.unexpected.length, 0);
    assert.equal(record.pageErrors.length, 0); assert.equal(record.consoleErrors.length, 0);
    check('Hosted app has no console/page errors, forbidden network request, or unexpected wallet popup', true);
  } finally {
    await Promise.all(responseTasks);
    fs.writeFileSync(path.join(config.output, 'public-mainnet-reads.json'), redact(JSON.stringify(publicResponses, null, 2)) + '\n');
    await context.close();
  }
}

try {
  const launch = { headless: true, args: ['--no-sandbox'], ...(config.hosted ? {} : { proxy: { server: 'http://127.0.0.1:9' } }) };
  if (config.chromium) launch.executablePath = config.chromium;
  browser = await chromium.launch(launch);
  if (config.hosted) await runHosted(); else await runOffline();
} catch (error) {
  check('Read-only browser verification completed', false, error.stack || error.message);
} finally {
  const summary = {
    schemaVersion: 1, completedAt: new Date().toISOString(), hosted: config.hosted,
    syntheticOnly: !config.hosted, liveNetworkAllowed: Boolean(config.hosted),
    realWalletsUsed: 0, signaturesCreated: 0, transactionsSubmitted: 0,
    walletSigningRequests: contexts.reduce((total, context) => total + context.walletActions.filter(event => event.signing).length, 0),
    playwrightVersion: require(path.join(config.playwright, 'package.json')).version, browserVersion: browser?.version() || null,
    compiledSha256: Object.fromEntries([...assetHashes].sort(([a], [b]) => a.localeCompare(b))),
    servedSha256: Object.fromEntries([...servedAssetHashes].sort(([a], [b]) => a.localeCompare(b))),
    hostedHtmlVerification,
    fixtureSources: Object.fromEntries([SETUP_CAPTURE, LEGACY_CAPTURE].map(file => [file, sha(fs.readFileSync(path.join(config.root, file)))])),
    binding, passed: checks.length > 0 && checks.every(check => check.passed), checks, screenshots, contexts,
    limits: [config.hosted ? 'Hosted mode verifies public mainnet reads with no connected wallet; it cannot test private wallet behavior.' : 'Offline fixtures verify browser behavior, not live RPC availability or actual wallet signing.',
      'No season activation, funding, purchase, gameplay, or reward transaction was executed.',
      'Optional remote fonts use local fallback fonts. Hosted authentication is verified separately.'],
  };
  fs.writeFileSync(path.join(config.output, 'summary.json'), redact(JSON.stringify(summary, null, 2)) + '\n');
  if (browser) await browser.close();
  console.log(`Evidence: ${config.output}`);
  process.exitCode = summary.passed ? 0 : 1;
}
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist", type=Path, default=ROOT / "dist")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--hosted", action="store_true", help="Run a public live-read smoke; tester code must arrive through stdin")
    options = parser.parse_args()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    output = (options.output or OUTPUT_ROOT / f"{'hosted' if options.hosted else 'run'}-{stamp}").resolve()
    if not output.is_relative_to(OUTPUT_ROOT.resolve()):
        raise ValueError("Synthetic evidence must remain under /tmp/arboretum-new-seasons-browser-review")
    output.mkdir(parents=True, exist_ok=False)
    modules = os.environ.get("CODEX_PRIMARY_RUNTIME_NODE_MODULES", "/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules")
    config = {
        "root": str(ROOT), "dist": str(options.dist.resolve()), "output": str(output), "hosted": options.hosted,
        "playwright": os.environ.get("ARBORETUM_PLAYWRIGHT_MODULE", str(Path(modules) / "playwright")),
        "chromium": os.environ.get("ARBORETUM_REVIEW_CHROMIUM"),
    }
    node = os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node")
    if not node:
        raise RuntimeError("Node is required for the installed Playwright dependency")
    environment = {**os.environ, "ARBORETUM_NEW_SEASONS_REVIEW": json.dumps(config)}
    # The reusable runner contains no credential. Hosted access codes travel
    # through pipes only, never shell arguments, environment variables or files.
    supplied_code = sys.stdin.read() if options.hosted else ""
    runner = output / "runner.mjs"
    runner.write_text(RUNNER)
    result = subprocess.run([node, str(runner)], input=supplied_code, text=True, cwd=ROOT,
                            env=environment, check=False)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
