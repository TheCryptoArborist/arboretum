#!/usr/bin/env python3
"""Offline adversarial browser review of the compiled first-Seed planting page.

Run after the normal site build. The Python entry point uses the runtime-owned
Node Playwright installation (or ARBORETUM_PLAYWRIGHT_MODULE) without adding a
project dependency. Supply ARBORETUM_REVIEW_CHROMIUM when Chromium is not in
Playwright's cache. Every browser request is fulfilled by a local fixture or
aborted, with a dead proxy as a second network barrier. The Slush provider is a
synthetic Wallet Standard fixture and cannot sign or submit any transaction.

Evidence is explicitly synthetic and written only under
/tmp/arboretum-gameplay-browser-review, never mixed with on-chain release evidence.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = Path("/tmp/arboretum-gameplay-browser-review")

RUNNER = r"""
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const config = JSON.parse(process.env.ARBORETUM_OFFLINE_REVIEW_CONFIG);
const require = createRequire(path.join(config.root, 'package.json'));
const { chromium } = require(config.playwright);
const { Transaction } = await import(pathToFileURL(require.resolve('@mysten/sui/transactions')));
const { bcs } = await import(pathToFileURL(require.resolve('@mysten/sui/bcs')));
const { toBase58, toBase64 } = await import(pathToFileURL(require.resolve('@mysten/bcs')));
const { GetTransactionRequest, GetTransactionResponse } = await import(pathToFileURL(
  path.join(path.dirname(require.resolve('@mysten/sui/grpc')), 'proto/sui/rpc/v2/ledger_service.mjs')));

const { PLANT_EXPECTED: EXPECTED, PROOF_QUERY, PROOF_VARIABLES, INPUTS_QUERY, INPUT_VARIABLES,
  SIMULATION_QUERY, CONFIRM_QUERY, CONFIRM_VARIABLES, inspectPlantState, buildReviewedPlant,
  validateSimulation, validateConfirmedPlant } = await import(pathToFileURL(path.join(config.root, 'settlement-gameplay/plant-core.mjs')));
const { createPlantFixtures } = await import(pathToFileURL(path.join(config.root, 'settlement-gameplay/plant-fixtures.mjs')));
const ORIGIN = EXPECTED.origin, ENDPOINT = EXPECTED.graphqlEndpoint || EXPECTED.endpoint;
const PAGE_PATH = '/admin/gameplay-test/';
const WRONG = '0x' + '1'.repeat(64);
const ATTEMPT_KEY = 'arboretum:first-plant:v1:season-1:attempt';
const rows = [], screenshots = [], contexts = [], network = [];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const clone = value => structuredClone(value);
const syntheticDigest = label => toBase58(Buffer.from(sha('arboretum-offline-plant-review:' + label), 'hex'));
function attachExisting(data, fixture, candidate = null) {
  for (const key of Object.keys(data)) if (key in fixture.confirmation.data) data[key] = clone(fixture.confirmation.data[key]);
  delete data.transaction;
  for (const object of [data.registries.nodes[0], ...data.ownedSeeds.nodes]) object.previousTransaction = candidate ? {
    digest: candidate, effects: { status: 'SUCCESS', checkpoint: clone(fixture.confirmation.data.checkpoint) },
  } : null;
}
async function createFixtures() {
  const fixtures = await createPlantFixtures();
  const { inputs, proof, simulation, confirmation, digest, bytes } = fixtures;
  const options = { now: fixtures.now };
  const chain = await inspectPlantState(inputs, proof, options);
  const packet = await buildReviewedPlant(fixtures.nftId, chain);
  const simulated = await validateSimulation(simulation, packet, chain, proof, options);
  const parsedReceipt = await validateConfirmedPlant(confirmation, digest, proof, options);
  assert.equal(chain.status, 'ready');
  assert.equal(parsedReceipt.priceMist, '10000000');
  assert.equal(parsedReceipt.growthPoints, '10');
  assert.equal(BigInt(parsedReceipt.waterReadyMs) - BigInt(parsedReceipt.plantedAtMs), 77760000n);
  const effects = confirmation.data.transaction.effects;
  const walletEffects = bcs.TransactionEffects.serialize({ V2: {
    status: { Success: null }, executedEpoch: String(effects.epoch.epochId), gasUsed: effects.gasEffects.gasSummary,
    transactionDigest: digest, gasObjectIndex: null, eventsDigest: null, dependencies: [],
    lamportVersion: String(effects.lamportVersion), changedObjects: [], unchangedConsensusObjects: [], auxDataDigest: null,
  } }).toBase64();
  const walletResult = { digest, bytes, effects: walletEffects, signature: 'SYNTHETIC-NOT-A-SIGNATURE' };
  const grpcMessage = GetTransactionResponse.toBinary(GetTransactionResponse.create({ transaction: {
    digest, signatures: [], effects: { status: { success: true } },
  } }));
  function frame(flag, value) { const head = Buffer.alloc(5); head[0] = flag; head.writeUInt32BE(value.length, 1); return Buffer.concat([head, Buffer.from(value)]); }
  const grpcResponse = Buffer.concat([frame(0, grpcMessage), frame(128, Buffer.from('grpc-status: 0\r\n'))]);
  return { ...fixtures, packet, simulated, parsedReceipt, walletResult, grpcResponse };
}
const adminNames = ['index.html', 'admin.css', 'admin.mjs'];
const compiled = new Map([...adminNames.map(name => 'admin/gameplay-test/' + name), 'prelaunch/mark.png']
  .map(name => [name, fs.readFileSync(path.join(config.dist, name))]));
let browser;
function check(name, passed, detail) {
  const row = { check: name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) };
  rows.push(row); console.log(`${row.passed ? 'PASS' : 'FAIL'} ${name}${row.passed || !detail ? '' : ': ' + detail}`);
}
function installWallet(settings) {
  // No keypair, signing primitive, extension connection or live RPC exists in
  // this fixture. Handoffs serialize the unsigned request for inspection, then
  // reject, wait, or return a separately marked synthetic transport result.
  const listeners = new Set();
  Date.now = () => settings.now;
  const makeAccount = (address, chain = 'sui:mainnet') => ({
    address, publicKey: new Uint8Array(32), chains: [chain],
    features: ['sui:signAndExecuteTransaction', 'sui:signTransaction', 'sui:signPersonalMessage'],
  });
  const state = {
    accounts: [], mode: settings.mode || 'reject',
    connect: 0, disconnect: 0, signing: [], otherSigning: [],
    release: null, wallet: null,
  };
  const configured = (settings.accounts || [settings.administrator, settings.wrong]).map(value =>
    typeof value === 'string' ? makeAccount(value) : makeAccount(value.address, value.chain));
  const reject = mode => {
    if (mode === 'uncertain') throw new Error('Synthetic response lost after wallet handoff');
    const error = new Error('Synthetic user rejection; no signature or transaction was produced');
    error.name = 'WalletStandardError';
    error.context = { __code: 4001000 };
    throw error;
  };
  const wallet = {
    version: '1.0.0', name: 'Slush',
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',
    chains: ['sui:mainnet', 'sui:testnet'],
    get accounts() { return state.accounts; },
    features: {
      'standard:connect': { version: '1.0.0', connect: async () => {
        state.connect += 1;
        state.accounts = configured;
        listeners.forEach(listener => listener({ accounts: state.accounts }));
        return { accounts: state.accounts };
      } },
      'standard:disconnect': { version: '1.0.0', disconnect: async () => {
        state.disconnect += 1; state.accounts = [];
        listeners.forEach(listener => listener({ accounts: [] }));
      } },
      'standard:events': { version: '1.0.0', on: (event, listener) => {
        if (event === 'change') listeners.add(listener);
        return () => listeners.delete(listener);
      } },
      'sui:signAndExecuteTransaction': { version: '2.0.0', signAndExecuteTransaction: async input => {
        const entry = { account: input.account.address, chain: input.chain, json: null };
        state.signing.push(entry);
        entry.json = await input.transaction.toJSON();
        if (state.mode === 'hold') await new Promise(resolve => { state.release = resolve; });
        if (state.mode === 'success') return settings.walletResult;
        return reject(state.mode);
      } },
      'sui:signTransaction': { version: '2.0.0', signTransaction: async () => {
        state.otherSigning.push('signTransaction'); throw new Error('Offline fixture cannot sign');
      } },
      'sui:signPersonalMessage': { version: '1.1.0', signPersonalMessage: async () => {
        state.otherSigning.push('signPersonalMessage'); throw new Error('Offline fixture cannot sign');
      } },
    },
  };
  state.wallet = wallet;
  state.changeAccounts = accounts => {
    state.accounts = accounts.map(value => typeof value === 'string' ? makeAccount(value) : makeAccount(value.address, value.chain));
    listeners.forEach(listener => listener({ accounts: state.accounts }));
  };
  state.rejectHeld = mode => { state.mode = mode || 'reject'; state.release?.(); };
  state.addDuplicate = () => {
    const duplicate = { ...wallet, accounts: [] };
    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: api => api.register(duplicate) }));
  };
  window.__offlineWallet = state;
  const register = api => api.register(wallet);
  window.addEventListener('wallet-standard:app-ready', event => register(event.detail));
  window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }));
  if (settings.disableStorage) {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw Error('Synthetic unavailable storage'); } });
  }
}

async function fixtureContext(name, settings = {}) {
  const width = settings.width || 1440;
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 1000 },
    deviceScaleFactor: 1, timezoneId: 'America/Chicago', serviceWorkers: 'block', isMobile: width < 600, hasTouch: width < 600 });
  const record = { name, errors: [], blocked: [], requests: [], simulationPayloads: [] };
  contexts.push(record);
  const fixtures = await createFixtures();
  const { proof, inputs, simulation, confirmation, walletResult, grpcResponse } = fixtures;
  const control = { ...settings, ...fixtures, simulationCount: 0, confirmationCount: 0, grpcReads: 0 };
  if (settings.existing) attachExisting(inputs.data, fixtures, settings.existingCandidate === false ? null : fixtures.digest);
  if (settings.incompleteInventory) { inputs.data.ownedNFTs.pageInfo.hasNextPage = true; inputs.data.ownedNFTs.pageInfo.endCursor = null; }
  if (settings.stale) inputs.data.checkpoint.timestamp = new Date(fixtures.now - 121000).toISOString();
  await context.addInitScript(installWallet, { administrator: EXPECTED.sender, wrong: WRONG, walletResult, now: fixtures.now, ...settings });
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type,x-grpc-web,x-user-agent,grpc-timeout',
    'access-control-expose-headers': 'grpc-status,grpc-message' };
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    const row = { context: name, origin: url.origin, path: url.pathname, method: request.method() };
    record.requests.push(row); network.push(row);
    if ([ORIGIN, settings.origin].includes(url.origin) && request.method() === 'GET') {
      let filename = decodeURIComponent(url.pathname).replace(/^\//, '');
      if (filename.endsWith('/')) filename += 'index.html';
      if (compiled.has(filename)) {
        const types = { '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript', '.png': 'image/png' };
        row.fixture = 'local compiled asset';
        return route.fulfill({ status: 200, contentType: types[path.extname(filename)] || 'application/octet-stream', body: compiled.get(filename) });
      }
    }
    if (url.href === ENDPOINT && request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.href === ENDPOINT && request.method() === 'POST') {
      try {
        const data = request.postDataJSON();
        assert(/^query\s+\w+/.test(data.query) && !/\bmutation\b|\bexecuteTransaction\b/.test(data.query));
        let response;
        if (data.query === PROOF_QUERY) { assert.deepEqual(data.variables, PROOF_VARIABLES); response = proof; }
        else if (data.query === INPUTS_QUERY) { assert.deepEqual(data.variables, INPUT_VARIABLES); response = inputs; }
        else if (data.query === SIMULATION_QUERY) {
          assert.deepEqual(data.variables, { ...INPUT_VARIABLES, transaction: fixtures.packet.simulationTransaction });
          record.simulationPayloads.push(sha(JSON.stringify(data.variables.transaction))); control.simulationCount += 1;
          if (control.onSimulation) await control.onSimulation(control.simulationCount);
          response = clone(simulation);
          if (control.feeChanges && control.simulationCount > 1) {
            const e = response.data.simulateTransaction.effects;
            e.gasEffects.gasSummary.computationCost = String(BigInt(e.gasEffects.gasSummary.computationCost) + 1n);
            const balance = e.balanceChangesJson.find(value => value.address === EXPECTED.sender);
            balance.amount = String(BigInt(balance.amount) - 1n);
          }
        } else if (data.query === CONFIRM_QUERY) {
          assert.deepEqual(data.variables, { ...CONFIRM_VARIABLES, digest: data.variables.digest });
          control.confirmationCount += 1; response = clone(confirmation);
          if (data.variables.digest !== walletResult.digest || control.receiptMismatch) response.data.transaction.sender.address = WRONG;
          if (control.simulationAsReceipt) response = clone(simulation);
        } else throw Error('Unrecognized GraphQL operation');
        row.fixture = data.query === CONFIRM_QUERY ? 'synthetic planting receipt' : 'isolated proof/input/simulation fixture';
        row.operation = data.query.match(/^query\s+(\w+)/)[1];
        return route.fulfill({ status: 200, headers: cors, json: response });
      } catch (error) { row.error = error.message; record.blocked.push(row); return route.abort('blockedbyclient'); }
    }
    if (url.origin === 'https://fullnode.mainnet.sui.io' && url.pathname === '/sui.rpc.v2.LedgerService/GetTransaction') {
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (request.method() === 'POST') {
        try {
          let body = request.postDataBuffer(); const textFormat = request.headers()['content-type']?.includes('grpc-web-text');
          if (textFormat) body = Buffer.from(body.toString(), 'base64');
          assert(body && body[0] === 0 && body.readUInt32BE(1) === body.length - 5);
          assert.equal(GetTransactionRequest.fromBinary(body.subarray(5)).digest, walletResult.digest);
          control.grpcReads += 1; row.fixture = 'local read-only synthetic gRPC receipt';
          return route.fulfill({ status: 200, headers: cors, contentType: textFormat ? 'application/grpc-web-text+proto' : 'application/grpc-web+proto', body: textFormat ? grpcResponse.toString('base64') : grpcResponse });
        } catch (error) { row.error = error.message; record.blocked.push(row); return route.abort('blockedbyclient'); }
      }
    }
    record.blocked.push(row); return route.abort('blockedbyclient');
  });
  const newPage = async () => {
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', error => record.errors.push(error.message));
    await page.goto((settings.origin || ORIGIN) + PAGE_PATH, { waitUntil: 'networkidle' }); return page;
  };
  const page = await newPage(); return { context, page, record, control, newPage };
}
async function walletAudit(page) {
  return page.evaluate(() => ({ connect: __offlineWallet.connect, signing: __offlineWallet.signing, otherSigning: __offlineWallet.otherSigning }));
}
async function snapshot(page) {
  return page.evaluate(key => ({ title: document.querySelector('#status-title').textContent, message: document.querySelector('#status-message').textContent,
    checkDisabled: document.querySelector('#check-plant').disabled, submitDisabled: document.querySelector('#submit-plant').disabled,
    acknowledgementDisabled: document.querySelector('#acknowledge').disabled, nftSelected: document.querySelector('#nft-select').value,
    recoveryVisible: !document.querySelector('#recovery-panel').hidden, receiptVisible: !document.querySelector('#receipt-panel').hidden,
    journal: (() => { try { return JSON.parse(localStorage.getItem(key)); } catch { return 'unavailable'; } })(),
    receiptDigest: document.querySelector('#receipt-digest').textContent, seedId: document.querySelector('#receipt-seed').textContent,
    viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
  }), ATTEMPT_KEY);
}
async function waitTitle(page, text) { await page.waitForFunction(text => document.querySelector('#status-title').textContent.includes(text), text); }
async function connect(page, address = EXPECTED.sender) {
  await page.locator('#connect-slush').click(); await page.locator('#account-controls').waitFor({ state: 'visible' });
  assert(await page.locator('#load-nfts').isDisabled());
  const value = await page.locator('#account-select').evaluate((select, address) => [...select.options].find(o => o.textContent.includes(address))?.value, address);
  assert.notEqual(value, undefined); await page.selectOption('#account-select', value); await page.locator('#use-account').click();
}
async function ready(f) {
  await connect(f.page); await f.page.locator('#load-nfts').click(); await waitTitle(f.page, 'Choose an NFTree');
  assert.equal(await f.page.locator('#nft-select').inputValue(), ''); assert(await f.page.locator('#check-plant').isDisabled());
  await f.page.selectOption('#nft-select', f.control.nftId); await f.page.locator('#check-plant').click(); await waitTitle(f.page, 'Ready for your review');
}
async function acknowledge(page) { await page.locator('#acknowledge').check(); assert(!(await page.locator('#submit-plant').isDisabled())); }
async function exactRequest(f) {
  const audit = await walletAudit(f.page); assert.equal(audit.signing.length, 1); assert.equal(audit.otherSigning.length, 0);
  const request = audit.signing[0]; assert.equal(request.account, EXPECTED.sender); assert.equal(request.chain, EXPECTED.chain);
  const tx = Transaction.from(request.json); assert.equal(tx.getData().sender, EXPECTED.sender);
  assert(Object.values(tx.getData().gasData).every(x => x === null));
  assert.equal(toBase64(await tx.build({ onlyTransactionKind: true })), f.control.packet.kindBase64);
  check(`${f.record.name}: one exact selected-NFT planting request, no other signing method`, true);
}
async function screenshot(page, name) {
  await page.evaluate(() => {
    const mark = document.createElement('div'); mark.id = 'offline-evidence-mark';
    mark.textContent = 'SYNTHETIC OFFLINE REVIEW · NO REAL WALLET OR PAYMENT';
    Object.assign(mark.style, { position: 'fixed', left: '0', right: '0', top: '0', zIndex: '2147483647', textAlign: 'center', font: 'bold 11px sans-serif', background: '#6b245c', color: '#fff', padding: '6px' });
    document.body.append(mark);
  });
  await page.screenshot({ path: path.join(config.output, name), fullPage: true });
  await page.locator('#offline-evidence-mark').evaluate(e => e.remove()); screenshots.push(name);
}
async function scenario(name, run) { await run(); check(name, true); }
try {
  browser = await chromium.launch({ headless: true, executablePath: config.chromium || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>'] });
  for (const width of [1440, 390]) await scenario(`${width}px explicit account and NFT selection, payment review and responsive layout`, async () => {
    const f = await fixtureContext(`review-${width}`, { width });
    assert.equal((await walletAudit(f.page)).connect, 0); assert.equal(f.record.requests.filter(x => x.method === 'POST').length, 0);
    await ready(f); const s = await snapshot(f.page);
    assert(s.submitDisabled && !s.acknowledgementDisabled && s.pageWidth === s.viewport);
    assert.equal(s.nftSelected, f.control.nftId);
    assert.match(await f.page.locator('.payment-grid').innerText(), /0.0100 SUI/);
    assert.match(await f.page.locator('#projected-water').innerText(), /watering/);
    assert.equal(await f.page.locator('#expected-kind').textContent(), f.control.packet.kindSha256);
    await screenshot(f.page, `${width === 1440 ? 'desktop' : 'mobile'}-ready.png`);
    await acknowledge(f.page); await f.page.locator('#submit-plant').click(); await waitTitle(f.page, 'cancelled in Slush');
    await exactRequest(f); assert.equal((await snapshot(f.page)).journal, null); f.record.final = await snapshot(f.page); await f.context.close();
  });
  await scenario('Read-only current Seed check works without wallet connection or simulation', async () => {
    const f = await fixtureContext('read-only'); await f.page.locator('#check-existing').click(); await waitTitle(f.page, 'Ready for the first test Seed');
    assert.equal((await walletAudit(f.page)).connect, 0); assert.equal(f.control.simulationCount, 0);
    const s = await snapshot(f.page); assert(s.submitDisabled && s.journal === null && s.nftSelected === ''); await f.context.close();
  });
  await scenario('Wrong account cannot load NFTrees or review planting', async () => {
    const f = await fixtureContext('wrong-account'); await connect(f.page, WRONG); await waitTitle(f.page, 'Select the required administrator');
    assert(await f.page.locator('#load-nfts').isDisabled()); assert.equal((await walletAudit(f.page)).signing.length, 0); await f.context.close();
  });
  await scenario('Changing NFT selection clears acknowledgement and prevents stale handoff', async () => {
    const f = await fixtureContext('changed-nft'); await ready(f); await acknowledge(f.page);
    const other = await f.page.locator('#nft-select').evaluate((select, id) => [...select.options].find(o => o.value && o.value !== id)?.value, f.control.nftId);
    assert(other); await f.page.selectOption('#nft-select', other);
    assert(await f.page.locator('#submit-plant').isDisabled()); assert(!(await f.page.locator('#acknowledge').isChecked()));
    assert.equal((await walletAudit(f.page)).signing.length, 0); await f.context.close();
  });
  await scenario('Final account change stops the handoff after rechecking', async () => {
    const f = await fixtureContext('changed-account'); await ready(f); await acknowledge(f.page);
    f.control.onSimulation = async count => { if (count === 2) await f.page.evaluate(address => __offlineWallet.changeAccounts([address]), WRONG); };
    await f.page.locator('#submit-plant').click(); await waitTitle(f.page, 'Wallet review did not open');
    assert.equal((await walletAudit(f.page)).signing.length, 0); assert((await snapshot(f.page)).submitDisabled); await f.context.close();
  });
  for (const setting of ['stale', 'incompleteInventory']) await scenario(`${setting} live input blocks review before simulation`, async () => {
    const f = await fixtureContext(setting, { [setting]: true }); await connect(f.page); await f.page.locator('#load-nfts').click(); await waitTitle(f.page, 'NFTree loading stopped');
    assert.equal(f.control.simulationCount, 0); assert((await snapshot(f.page)).submitDisabled); await f.context.close();
  });
  await scenario('Changed fee requires another acknowledgement before opening Slush', async () => {
    const f = await fixtureContext('changed-fee', { feeChanges: true }); await ready(f); await acknowledge(f.page);
    await f.page.locator('#submit-plant').click(); await waitTitle(f.page, 'planting review changed');
    assert(!(await f.page.locator('#acknowledge').isChecked())); assert((await snapshot(f.page)).submitDisabled);
    assert.equal((await walletAudit(f.page)).signing.length, 0); await f.context.close();
  });
  await scenario('Duplicate clicks and second tab cannot open a second in-flight planting', async () => {
    const f = await fixtureContext('duplicate-request', { mode: 'hold' }); await ready(f); await acknowledge(f.page);
    await f.page.locator('#submit-plant').click(); await f.page.waitForFunction(() => __offlineWallet.signing.length === 1);
    await f.page.evaluate(() => document.querySelector('#submit-plant').click());
    const second = await f.newPage(); assert((await snapshot(second)).submitDisabled); assert.equal((await walletAudit(second)).signing.length, 0);
    await f.page.evaluate(() => __offlineWallet.rejectHeld('reject')); await waitTitle(f.page, 'cancelled in Slush'); await exactRequest(f);
    await f.context.close();
  });
  await scenario('Uncertain request survives reload and recovers the exact receipt without another wallet request', async () => {
    const f = await fixtureContext('uncertain-request', { mode: 'uncertain' }); await ready(f); await acknowledge(f.page);
    await f.page.locator('#submit-plant').click(); await waitTitle(f.page, 'needs verification'); await exactRequest(f);
    assert.equal((await snapshot(f.page)).journal.phase, 'uncertain'); await f.page.reload({ waitUntil: 'networkidle' });
    assert.equal((await walletAudit(f.page)).signing.length, 0); assert((await snapshot(f.page)).submitDisabled);
    await f.page.locator('#check-existing').click(); await waitTitle(f.page, 'No confirmed first planting found yet');
    assert.equal((await snapshot(f.page)).journal.phase, 'uncertain'); await screenshot(f.page, 'desktop-uncertain-recovery.png');
    await f.page.locator('#transaction-digest').fill(f.control.digest); await f.page.locator('#verify-receipt').click(); await waitTitle(f.page, 'Test Seed confirmed');
    assert.equal((await walletAudit(f.page)).signing.length, 0); assert.equal((await snapshot(f.page)).journal.phase, 'confirmed'); await f.context.close();
  });
  await scenario('Synthetic successful receipt confirms one Seed, 10 GP, payment and actual watering schedule', async () => {
    const f = await fixtureContext('successful-plant', { mode: 'success' }); await ready(f); await acknowledge(f.page);
    await f.page.locator('#submit-plant').click(); await waitTitle(f.page, 'Test Seed confirmed'); await exactRequest(f);
    const s = await snapshot(f.page); assert(s.receiptVisible && s.submitDisabled && !s.recoveryVisible);
    assert.equal(s.seedId, f.control.parsedReceipt.seedId); assert.equal(s.receiptDigest, f.control.digest);
    const formatted = await f.page.evaluate(receipt => ({ planted: new Date(Number(receipt.plantedAtMs)).toLocaleString(undefined, { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'long' }), water: new Date(Number(receipt.waterReadyMs)).toLocaleString(undefined, { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'long' }) }), f.control.parsedReceipt);
    assert.equal(await f.page.locator('#receipt-planted').textContent(), formatted.planted);
    assert.equal(await f.page.locator('#receipt-next-water').textContent(), formatted.water);
    assert.match(await f.page.locator('#receipt-state-message').textContent(), /0.007 SUI/);
    assert.equal(f.control.grpcReads, 1); await screenshot(f.page, 'desktop-confirmed-synthetic.png');
    f.record.final = s; await f.context.close();
  });
  for (const setting of ['receiptMismatch', 'simulationAsReceipt']) await scenario(`${setting} cannot confirm or replace a known wallet digest`, async () => {
    const f = await fixtureContext(setting, { mode: 'success', [setting]: true }); await ready(f); await acknowledge(f.page);
    await f.page.locator('#submit-plant').click(); await waitTitle(f.page, 'needs verification'); await exactRequest(f);
    const s = await snapshot(f.page); assert(!s.receiptVisible && s.submitDisabled && s.journal.digest === f.control.digest);
    await f.page.locator('#transaction-digest').fill(EXPECTED.startDigest); await f.page.locator('#verify-receipt').click(); await waitTitle(f.page, 'Receipt not yet verified');
    assert.match((await snapshot(f.page)).message, /digest already returned by Slush/); assert.equal(f.control.confirmationCount, 1); await f.context.close();
  });
  await scenario('Already-planted discovery blocks a fresh browser without requesting a wallet', async () => {
    const f = await fixtureContext('already-planted', { existing: true, existingCandidate: false });
    await f.page.locator('#check-existing').click(); await waitTitle(f.page, 'first-Seed test has on-chain activity');
    assert.equal((await snapshot(f.page)).journal.phase, 'observed-existing'); assert.equal((await walletAudit(f.page)).connect, 0); await f.context.close();
  });
  await scenario('Unavailable storage blocks signing while preserving read-only checks', async () => {
    const f = await fixtureContext('no-storage', { disableStorage: true });
    assert((await snapshot(f.page)).submitDisabled); await f.page.locator('#check-existing').click(); await waitTitle(f.page, 'Ready for the first test Seed');
    assert.equal((await walletAudit(f.page)).signing.length, 0); await f.context.close();
  });
  await scenario('Noncanonical origin rejects wallet initialization', async () => {
    const f = await fixtureContext('wrong-origin', { origin: 'https://treegrow.xyz' });
    await f.page.locator('#origin-warning').waitFor({ state: 'visible' });
    assert.match(await f.page.locator('#origin-warning').innerText(), /only at https:\/\/www.treegrow.xyz/);
    assert.equal((await walletAudit(f.page)).connect, 0); assert((await snapshot(f.page)).submitDisabled); await f.context.close();
  });
  for (const record of contexts) {
    check(`${record.name}: no browser exception`, record.errors.length === 0, record.errors);
    check(`${record.name}: only isolated assets and exact read/simulation fixtures requested`, record.blocked.length === 0, record.blocked);
  }
} catch (error) { check('Browser review completed', false, error.stack || error.message); }
finally {
  const summary = { schemaVersion: 1, syntheticOnly: true, liveNetworkAllowed: false, realWalletUsed: false,
    signaturesCreated: 0, broadcasts: 0, testedOrigin: ORIGIN,
    playwrightVersion: require(path.join(config.playwright, 'package.json')).version, browserVersion: browser?.version() || null,
    compiledSha256: Object.fromEntries(adminNames.map(name => [name, sha(compiled.get('admin/gameplay-test/' + name))])),
    passed: rows.every(row => row.passed), checks: rows, screenshots, contexts };
  fs.writeFileSync(path.join(config.output, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(config.output, 'network.json'), JSON.stringify(network, null, 2));
  if (browser) await browser.close(); console.log(`Evidence: ${config.output}`); process.exitCode = summary.passed ? 0 : 1;
}
"""

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist", type=Path, default=ROOT / "dist")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    output = (args.output or OUTPUT_ROOT / f"run-{stamp}").resolve()
    if not output.is_relative_to(OUTPUT_ROOT.resolve()):
        raise ValueError("Synthetic browser evidence must remain under /tmp/arboretum-gameplay-browser-review")
    output.mkdir(parents=True, exist_ok=False)
    runtime_modules = os.environ.get("CODEX_PRIMARY_RUNTIME_NODE_MODULES", "/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules")
    config = {
        "root": str(ROOT), "dist": str(args.dist.resolve()), "output": str(output),
        "playwright": os.environ.get("ARBORETUM_PLAYWRIGHT_MODULE", str(Path(runtime_modules) / "playwright")),
        "chromium": os.environ.get("ARBORETUM_REVIEW_CHROMIUM"),
    }
    node = os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node")
    if not node:
        raise RuntimeError("A Node runtime is required to use the installed Playwright dependency")
    env = {**os.environ, "ARBORETUM_OFFLINE_REVIEW_CONFIG": json.dumps(config)}
    result = subprocess.run([node, "--input-type=module", "-"], input=RUNNER, text=True, cwd=ROOT, env=env, check=False)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
