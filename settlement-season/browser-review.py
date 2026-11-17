#!/usr/bin/env python3
"""Offline adversarial browser review of the compiled first test-season page.

Run after the normal site build. The Python entry point uses the runtime-owned
Node Playwright installation (or ARBORETUM_PLAYWRIGHT_MODULE) without adding a
project dependency. Supply ARBORETUM_REVIEW_CHROMIUM when Chromium is not in
Playwright's cache. Every browser request is fulfilled by a local fixture or
aborted, with a dead proxy as a second network barrier. The Slush provider is a
synthetic Wallet Standard fixture and cannot sign or submit any transaction.

Evidence is explicitly synthetic and written only under
/tmp/arboretum-season-browser-review, never mixed with on-chain release evidence.
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
OUTPUT_ROOT = Path("/tmp/arboretum-season-browser-review")

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
const { START_EXPECTED: EXPECTED, PROOF_QUERY, PROOF_VARIABLES, INPUTS_QUERY, INPUT_VARIABLES,
  SIMULATION_QUERY, CONFIRM_QUERY, CONFIRM_VARIABLES, loadReviewedStart,
  validateInputs, validateSimulation, validateConfirmedStart } =
  await import(pathToFileURL(path.join(config.root, 'settlement-season/start-core.mjs')));
const captureRoot = path.join(config.root, 'settlement-integration/verification/season-test-20261031/mainnet');
const read = name => JSON.parse(fs.readFileSync(path.join(captureRoot, name), 'utf8')).response;
const kind = fs.readFileSync(path.join(captureRoot, 'unsigned-start-kind.b64'), 'utf8').trim();
const approvedSimulation = JSON.parse(fs.readFileSync(path.join(captureRoot, 'unsigned-packet.json'), 'utf8')).simulationTransaction;
const ORIGIN = EXPECTED.origin;
const PAGE_PATH = '/admin/season-test/';
const WRONG = '0x' + '1'.repeat(64);
const ATTEMPT_KEY = 'arboretum:first-season:v1:attempt';
const rows = [], screenshots = [], contexts = [], network = [];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const clone = value => structuredClone(value);
const syntheticAddress = label => '0x' + sha('arboretum-offline-season-review:' + label);
const syntheticDigest = label => toBase58(Buffer.from(sha('arboretum-offline-season-review:' + label), 'hex'));
// Explicitly synthetic fixtures. Captured public shapes are advanced only for
// offline freshness; unsigned BCS supplies a recomputable test receipt digest.
// There is no keypair, signing primitive, real wallet or live network here.
async function createRawFixtures() {
  const inputs = { data: clone(read('inputs.json').data) };
  const proof = { data: clone(read('confirmed-proof.json').data) };
  const simulation = { data: clone(read('simulation.json').data) };
  const capturedStart = BigInt(simulation.data.simulateTransaction.effects.events.nodes[0].contents.json.start_ms);
  const actualStart = BigInt(Date.now() - 3000);
  const delta = actualStart - capturedStart;
  const shift = value => String(BigInt(value) + delta);
  for (const response of [inputs, proof, simulation]) {
    response.data.checkpoint.timestamp = new Date(Date.parse(response.data.checkpoint.timestamp) + Number(delta)).toISOString();
    if (response.data.clock) response.data.clock.asMoveObject.contents.json.timestamp_ms = shift(response.data.clock.asMoveObject.contents.json.timestamp_ms);
  }
  const effects = simulation.data.simulateTransaction.effects;
  effects.events.nodes[0].contents.json.start_ms = shift(effects.events.nodes[0].contents.json.start_ms);
  effects.unchangedConsensusObjects.nodes[0].object.asMoveObject.contents.json.timestamp_ms = String(actualStart);
  const outputRegistry = effects.objectChanges.nodes.find(change => change.address === EXPECTED.registryId).outputState;
  outputRegistry.asMoveObject.contents.json.season_start_ms = shift(outputRegistry.asMoveObject.contents.json.season_start_ms);

  const confirmedEffects = clone(effects);
  const resolved = Transaction.from(effects.transaction.transactionBcs).getData();
  const transaction = Transaction.fromKind(kind);
  transaction.setSender(EXPECTED.sender);
  transaction.setGasOwner(EXPECTED.sender);
  transaction.setGasPrice(resolved.gasData.price);
  transaction.setGasBudget(EXPECTED.maxGasMist);
  transaction.setGasPayment([]);
  transaction.setExpiration(resolved.expiration);
  const bytes = toBase64(await transaction.build());
  const digest = await transaction.getDigest();
  const checkpoint = {
    sequenceNumber: simulation.data.checkpoint.sequenceNumber + 5,
    timestamp: new Date(Number(actualStart) + 1000).toISOString(),
    digest: syntheticDigest('receipt-checkpoint'),
  };
  confirmedEffects.checkpoint = clone(checkpoint);
  confirmedEffects.transaction = { transactionBcs: bytes, sender: { address: EXPECTED.sender } };
  const previousTransaction = { digest, effects: { status: 'SUCCESS', checkpoint: clone(checkpoint) } };
  for (const change of confirmedEffects.objectChanges.nodes) {
    change.outputState.digest = syntheticDigest('receipt-output:' + change.address);
    change.outputState.previousTransaction = clone(previousTransaction);
  }
  const confirmation = { data: clone(inputs.data) };
  confirmation.data.checkpoint = {
    sequenceNumber: checkpoint.sequenceNumber + 5,
    timestamp: new Date(Number(actualStart) + 2000).toISOString(),
    digest: syntheticDigest('current-checkpoint'),
  };
  confirmation.data.clock = clone(confirmedEffects.unchangedConsensusObjects.nodes[0].object);
  confirmation.data.clock.asMoveObject.contents.json.timestamp_ms = String(actualStart + 2000n);
  confirmation.data.transaction = { digest, sender: { address: EXPECTED.sender }, transactionBcs: bytes, effects: confirmedEffects };
  confirmation.data.registries.nodes = [clone(confirmedEffects.objectChanges.nodes.find(change => change.address === EXPECTED.registryId).outputState)];
  confirmation.data.adminCaps.nodes = [clone(confirmedEffects.objectChanges.nodes.find(change => change.address === EXPECTED.adminCapId).outputState)];
  return { checkpoint, inputs, proof, simulation, confirmation, digest, bytes,
    actualStartMs: String(actualStart), storedStartMs: outputRegistry.asMoveObject.contents.json.season_start_ms,
    cutoffMs: String(actualStart + 86400000n), claimDeadlineMs: String(actualStart + 691200000n),
    gasEstimateMist: String(BigInt(effects.gasEffects.gasSummary.computationCost) + BigInt(effects.gasEffects.gasSummary.storageCost) - BigInt(effects.gasEffects.gasSummary.storageRebate)),
  };
}
function attachExisting(data, fixture, candidate = null) {
  for (const key of ['registries', 'adminCaps', 'clock', 'checkpoint']) data[key] = clone(fixture.confirmation.data[key]);
  data.registries.nodes[0].previousTransaction = candidate ? {
    digest: candidate, effects: { status: 'SUCCESS', checkpoint: fixture.checkpoint },
  } : null;
}

async function createFixtures() {
  const fixtures = await createRawFixtures();
  const { inputs, proof, simulation, confirmation, bytes, digest } = fixtures;
  const loaded = await loadReviewedStart(kind);
  const chain = await validateInputs(inputs, proof);
  const simulated = await validateSimulation(simulation, loaded, chain, proof);
  const parsedReceipt = await validateConfirmedStart(confirmation, digest, proof);
  assert.equal(chain.status, 'ready');
  assert.equal(simulated.gasEstimateMist, '100553');
  assert.equal(BigInt(parsedReceipt.cutoffMs) - BigInt(parsedReceipt.actualStartMs), 86400000n);
  assert.equal(BigInt(parsedReceipt.actualStartMs) - BigInt(parsedReceipt.storedStartMs), 2505600000n);
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
  return { ...fixtures, parsedReceipt, walletResult, grpcResponse };
}
// Freeze the emitted files for this run so an unrelated rebuild cannot change
// the tested bundle midway through the scenarios or mislabel its final hash.
const adminNames = ['index.html', 'admin.css', 'admin.mjs', 'start-kind.b64'];
const compiled = new Map([...adminNames.map(name => 'admin/season-test/' + name), 'prelaunch/mark.png']
  .map(name => [name, fs.readFileSync(path.join(config.dist, name))]));
let browser;

function check(name, passed, detail) {
  const row = { check: name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) };
  rows.push(row);
  console.log(`${row.passed ? 'PASS' : 'FAIL'} ${name}${row.passed || !detail ? '' : ': ' + detail}`);
  return row.passed;
}

function installWallet(settings) {
  // No keypair, signing primitive, extension connection or live RPC exists in
  // this fixture. Handoffs serialize the unsigned request for inspection, then
  // reject, wait, or return a separately marked synthetic transport result.
  const listeners = new Set();
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
  const context = await browser.newContext({
    viewport: { width, height: width < 600 ? 844 : 1000 },
    deviceScaleFactor: 1, timezoneId: 'UTC', serviceWorkers: 'block',
    isMobile: width < 600, hasTouch: width < 600,
  });
  const record = { name, errors: [], blocked: [], requests: [], simulationPayloads: [], settings };
  contexts.push(record);
  const fixtures = await createFixtures();
  const { checkpoint, proof, inputs, simulation, confirmation, walletResult, grpcResponse } = fixtures;
  const control = { ...settings, ...fixtures, simulationCount: 0, confirmationCount: 0, grpcReads: 0 };
  if (settings.existing) {
    attachExisting(inputs.data, fixtures, fixtures.digest);
    if (settings.existingCandidate === false) inputs.data.registries.nodes[0].previousTransaction = null;
    if (settings.existingCandidate === 'later-activity') inputs.data.registries.nodes[0].previousTransaction.digest = syntheticDigest('later-activity');
  }
  if (settings.duplicates) inputs.data.registries.nodes.push(clone(inputs.data.registries.nodes[0]));
  if (settings.incompleteInventory) inputs.data.registries.pageInfo.hasNextPage = true;
  if (settings.stale) inputs.data.checkpoint.timestamp = new Date(Date.now() - 121000).toISOString();
  await context.addInitScript(installWallet, { administrator: EXPECTED.sender, wrong: WRONG, walletResult, ...settings });
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type,x-grpc-web,x-user-agent,grpc-timeout',
    'access-control-expose-headers': 'grpc-status,grpc-message' };
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const row = { context: name, origin: url.origin, path: url.pathname, method: request.method() };
    record.requests.push(row); network.push(row);
    if ([ORIGIN, settings.origin].includes(url.origin) && request.method() === 'GET') {
      let filename = decodeURIComponent(url.pathname).replace(/^\//, '');
      if (filename.endsWith('/')) filename += 'index.html';
      if (compiled.has(filename)) {
        let content = compiled.get(filename);
        if (url.pathname.endsWith('start-kind.b64') && control.tampered) {
          const bytes = Buffer.from(kind, 'base64'); bytes[50] ^= 1;
          content = Buffer.from(bytes.toString('base64'));
        }
        const types = { '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript', '.js': 'text/javascript', '.png': 'image/png', '.b64': 'text/plain' };
        row.fixture = 'local compiled asset';
        return route.fulfill({ status: 200, contentType: types[path.extname(filename)] || 'application/octet-stream', body: content });
      }
    }
    if (url.href === EXPECTED.graphqlEndpoint && request.method() === 'OPTIONS') {
      row.fixture = 'local CORS'; return route.fulfill({ status: 204, headers: cors });
    }
    if (url.href === EXPECTED.graphqlEndpoint && request.method() === 'POST') {
      try {
        const data = request.postDataJSON();
        const op = /^\s*query\s+(\w+)/.exec(data.query)?.[1];
        assert(op && !/\bmutation\b|\bexecuteTransaction\b/.test(data.query), 'Only named, approved read/simulation fixtures are permitted');
        row.operation = op;
        let response;
        if (data.query === PROOF_QUERY) {
          assert.deepEqual(data.variables, PROOF_VARIABLES);
          response = proof;
        } else if (data.query === INPUTS_QUERY) {
          assert.deepEqual(data.variables, INPUT_VARIABLES);
          response = inputs;
        } else if (data.query === SIMULATION_QUERY) {
          assert.deepEqual(data.variables, { ...INPUT_VARIABLES, transaction: approvedSimulation });
          record.simulationPayloads.push(sha(JSON.stringify(data.variables.transaction)));
          control.simulationCount += 1;
          if (control.onSimulation) await control.onSimulation(control.simulationCount);
          response = clone(simulation);
          if (control.feeChanges && control.simulationCount > 1) {
            const effects = response.data.simulateTransaction.effects;
            effects.gasEffects.gasSummary.computationCost = String(BigInt(effects.gasEffects.gasSummary.computationCost) + 1n);
            effects.balanceChangesJson[0].amount = String(-BigInt(fixtures.gasEstimateMist) - 1n);
          }
          if (control.excessiveFee) {
            const effects = response.data.simulateTransaction.effects;
            effects.gasEffects.gasSummary.computationCost = '100000000';
            const gas = effects.gasEffects.gasSummary;
            effects.balanceChangesJson[0].amount = String(-(BigInt(gas.computationCost) + BigInt(gas.storageCost) - BigInt(gas.storageRebate)));
            const transaction = Transaction.from(effects.transaction.transactionBcs);
            transaction.setGasBudget('200000000');
            effects.transaction.transactionBcs = toBase64(await transaction.build());
          }
        } else if (data.query === CONFIRM_QUERY) {
          assert.deepEqual(data.variables, { ...CONFIRM_VARIABLES, digest: data.variables.digest });
          control.confirmationCount += 1;
          response = clone(confirmation);
          if (data.variables.digest !== walletResult.digest) response.data.transaction = clone(proof.data.transaction);
          if (control.receiptPending) response.data.transaction = null;
          if (control.receiptMismatch) response.data.transaction.sender.address = WRONG;
          if (control.simulationAsReceipt) response = clone(simulation);
        } else throw Error(`Unrecognized GraphQL operation ${op}`);
        row.fixture = data.query === CONFIRM_QUERY ? 'unsigned synthetic receipt and current-state fixture' : 'saved capture with synthetic fresh timestamp';
        return route.fulfill({ status: 200, headers: cors, json: response });
      } catch (error) {
        row.error = error.message; record.blocked.push(row);
        return route.abort('blockedbyclient');
      }
    }
    if (url.origin === 'https://fullnode.mainnet.sui.io' && url.pathname === '/sui.rpc.v2.LedgerService/GetTransaction') {
      if (request.method() === 'OPTIONS') {
        row.fixture = 'local read-only gRPC CORS'; return route.fulfill({ status: 204, headers: cors });
      }
      if (request.method() === 'POST') {
        try {
          let body = request.postDataBuffer();
          const textFormat = request.headers()['content-type']?.includes('grpc-web-text');
          if (textFormat) body = Buffer.from(body.toString(), 'base64');
          assert(body && body[0] === 0 && body.readUInt32BE(1) === body.length - 5, 'Expected one gRPC request frame');
          const requested = GetTransactionRequest.fromBinary(body.subarray(5));
          assert.equal(requested.digest, walletResult.digest, 'Only the fixture receipt may be read');
          control.grpcReads += 1;
          row.fixture = 'local read-only synthetic gRPC transaction';
          return route.fulfill({ status: 200, headers: cors,
            contentType: textFormat ? 'application/grpc-web-text+proto' : 'application/grpc-web+proto',
            body: textFormat ? grpcResponse.toString('base64') : grpcResponse });
        } catch (error) {
          row.error = error.message; record.blocked.push(row);
          return route.abort('blockedbyclient');
        }
      }
    }
    record.blocked.push(row);
    return route.abort('blockedbyclient');
  });
  const newPage = async () => {
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => record.errors.push(error.message));
    await page.goto((settings.origin || ORIGIN) + PAGE_PATH, { waitUntil: 'networkidle' });
    return page;
  };
  const page = await newPage();
  return { context, page, record, control, newPage };
}

async function walletAudit(page) {
  return page.evaluate(() => ({ connect: __offlineWallet.connect, disconnect: __offlineWallet.disconnect,
    signing: __offlineWallet.signing, otherSigning: __offlineWallet.otherSigning }));
}
async function snapshot(page) {
  return page.evaluate(key => ({
    title: document.querySelector('#status-title').textContent,
    message: document.querySelector('#status-message').textContent,
    wallet: document.querySelector('#wallet-status').textContent,
    checkDisabled: document.querySelector('#check-season').disabled,
    submitDisabled: document.querySelector('#submit-season').disabled,
    acknowledgementDisabled: document.querySelector('#acknowledge').disabled,
    recoveryVisible: !document.querySelector('#recovery-panel').hidden,
    receiptVisible: !document.querySelector('#receipt-panel').hidden,
    journal: (() => { try { return JSON.parse(localStorage.getItem(key)); } catch { return 'unavailable'; } })(),
    receiptDigest: document.querySelector('#receipt-digest').textContent,
    receiptRegistry: document.querySelector('#receipt-registry').textContent,
    receiptAdminCap: document.querySelector('#receipt-admin-cap').textContent,
    viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
  }), ATTEMPT_KEY);
}
async function connect(page, address = EXPECTED.sender) {
  await page.locator('#connect-slush').click();
  await page.locator('#account-controls').waitFor({ state: 'visible' });
  assert(await page.locator('#check-season').isDisabled(), 'Connection must not implicitly authorize an account');
  const value = await page.locator('#account-select').evaluate((select, address) =>
    [...select.options].find(option => option.textContent.includes(address))?.value, address);
  assert.notEqual(value, undefined, 'Expected synthetic account choice');
  await page.selectOption('#account-select', value);
  await page.locator('#use-account').click();
}
async function ready(page) {
  await connect(page);
  await page.locator('#check-season').click();
  await page.waitForFunction(() => !document.querySelector('#acknowledge').disabled);
  assert.equal((await walletAudit(page)).signing.length, 0, 'Readiness checks must not invoke signing');
}
async function acknowledge(page) {
  await page.locator('#acknowledge').check();
  assert(await page.locator('#submit-season').isEnabled());
}
async function waitTitle(page, pattern) {
  await page.waitForFunction(pattern => new RegExp(pattern).test(document.querySelector('#status-title').textContent), pattern);
}
async function screenshot(page, filename) {
  await page.evaluate(() => {
    let tag = document.querySelector('#offline-review-watermark');
    if (!tag) {
      tag = document.createElement('div'); tag.id = 'offline-review-watermark';
      tag.textContent = 'SYNTHETIC OFFLINE REVIEW · NO LIVE WALLET OR NETWORK';
      tag.style.cssText = 'position:relative;padding:9px 12px;background:#314434;color:#fff;text-align:center;font:11px/1.5 monospace;letter-spacing:.03em;overflow-wrap:anywhere';
      document.body.prepend(tag);
    }
    window.scrollTo(0, 0);
  });
  await page.screenshot({ path: path.join(config.output, filename), fullPage: true, animations: 'disabled' });
  screenshots.push({ filename, sha256: sha(fs.readFileSync(path.join(config.output, filename))) });
}
async function exactRequest(page) {
  const audit = await walletAudit(page);
  assert.equal(audit.signing.length, 1);
  assert.equal(audit.otherSigning.length, 0);
  const request = audit.signing[0];
  assert.equal(request.account, EXPECTED.sender);
  assert.equal(request.chain, EXPECTED.chain);
  const transaction = Transaction.from(request.json);
  const data = transaction.getData();
  assert.equal(data.sender, EXPECTED.sender);
  assert.equal(data.commands.length, 1);
  assert.equal(data.commands[0].MoveCall.module, 'settlement');
  assert.equal(data.commands[0].MoveCall.function, 'start_season_for_duration');
  assert.equal(data.expiration, null);
  assert(Object.values(data.gasData).every(value => value === null), 'Wallet must select final gas');
  assert.equal(sha(await transaction.build({ onlyTransactionKind: true })), EXPECTED.kindSha256);
  return { account: request.account, chain: request.chain, kindSha256: EXPECTED.kindSha256,
    commands: data.commands.map(command => command.$kind), gasData: data.gasData };
}
async function scenario(name, run) {
  try { await run(); check(name, true); }
  catch (error) { check(name, false, error.stack || error.message); }
}

try {
  const launch = { headless: true, args: ['--no-sandbox'], proxy: { server: 'http://127.0.0.1:9' } };
  if (config.chromium) launch.executablePath = config.chromium;
  browser = await chromium.launch(launch);

  await scenario('Desktop explicit selection, read-only review, exact single 24-hour start request, cancellation and duplicate-tab lock', async () => {
    const f = await fixtureContext('desktop', { mode: 'hold' });
    const p = f.page;
    assert.equal((await walletAudit(p)).connect, 0, 'No auto-connection');
    assert.equal((await walletAudit(p)).signing.length, 0, 'No signing on load');
    assert.equal(f.record.requests.filter(row => row.operation).length, 0, 'No automatic chain reads');
    await ready(p);
    check('Load, connect, account selection and fresh simulation produce zero signing requests', (await walletAudit(p)).signing.length === 0);
    check('Readiness review uses exact captured simulation payload', f.record.simulationPayloads.length === 1);
    check('Review requires explicit acknowledgement', await p.locator('#submit-season').isDisabled());
    assert.match(await p.locator('#projected-cutoff').textContent(), /202[0-9]/);
    assert.match(await p.locator('#watering-note').textContent(), /21\.6|21.hour.*36/);
    await screenshot(p, 'desktop-ready.png');
    check('Desktop has no horizontal overflow', (await snapshot(p)).pageWidth <= 1440);
    await acknowledge(p);
    await p.locator('#submit-season').click();
    await p.waitForFunction(() => __offlineWallet.signing.length === 1 && __offlineWallet.signing[0].json);
    const request = await exactRequest(p);
    fs.writeFileSync(path.join(config.output, 'synthetic-wallet-request-summary.json'), JSON.stringify(request, null, 2));
    check('Final wallet handoff has exact approved kind, explicit sender/mainnet and unset gas', true, request);
    assert.equal(f.record.simulationPayloads.length, 2, 'Must refresh again before handoff');
    await p.locator('#submit-season').dispatchEvent('click');
    assert.equal((await walletAudit(p)).signing.length, 1, 'Duplicate click must not open another request');
    const second = await f.newPage();
    await second.locator('#recovery-panel').waitFor({ state: 'visible' });
    const secondState = await snapshot(second);
    assert(secondState.checkDisabled && secondState.submitDisabled);
    assert.equal((await walletAudit(second)).signing.length, 0);
    check('A second tab sees the persisted in-flight request and cannot resubmit', true);
    await p.evaluate(() => __offlineWallet.rejectHeld('reject'));
    await waitTitle(p, 'cancelled');
    const cancelled = await snapshot(p);
    assert.equal(cancelled.journal, null);
    assert(cancelled.submitDisabled && cancelled.acknowledgementDisabled);
    check('Explicit wallet cancellation clears only this request and requires a fresh review', true);
    f.record.final = cancelled;
    await f.context.close();
  });

  await scenario('Mobile review has no overflow and no signing', async () => {
    const f = await fixtureContext('mobile', { width: 390 });
    await ready(f.page); await screenshot(f.page, 'mobile-ready.png');
    const s = await snapshot(f.page);
    assert(s.pageWidth <= 390, `Horizontal overflow ${s.pageWidth}`);
    assert.equal((await walletAudit(f.page)).signing.length, 0);
    f.record.final = s; await f.context.close();
  });

  await scenario('Wrong administrator account fails before any chain check or signature', async () => {
    const f = await fixtureContext('wrong-account'); await connect(f.page, WRONG);
    const s = await snapshot(f.page);
    assert(s.checkDisabled && s.submitDisabled);
    assert.match(s.message, /administrator/i);
    assert.equal((await walletAudit(f.page)).signing.length, 0);
    assert.equal(f.record.simulationPayloads.length, 0);
    f.record.final = s; await f.context.close();
  });

  await scenario('Administrator account restricted to testnet is rejected', async () => {
    const f = await fixtureContext('wrong-chain', { accounts: [{ address: EXPECTED.sender, chain: 'sui:testnet' }] });
    // dAppKit rejects a wallet connection with no eligible mainnet account,
    // before the page can show its explicit account selector.
    await f.page.locator('#connect-slush').click();
    await waitTitle(f.page, 'Connection not completed');
    const s = await snapshot(f.page); assert(s.checkDisabled && s.submitDisabled);
    assert.equal((await walletAudit(f.page)).signing.length, 0);
    assert.equal(f.record.simulationPayloads.length, 0);
    f.record.final = s; await f.context.close();
  });

  await scenario('Changed wallet account invalidates a previously acknowledged review', async () => {
    const f = await fixtureContext('changed-account'); await ready(f.page); await acknowledge(f.page);
    await f.page.evaluate(address => __offlineWallet.changeAccounts([address]), WRONG);
    await f.page.waitForFunction(() => document.querySelector('#submit-season').disabled);
    const s = await snapshot(f.page); assert(s.checkDisabled && s.submitDisabled);
    assert.equal((await walletAudit(f.page)).signing.length, 0);
    f.record.final = s; await f.context.close();
  });

  await scenario('A second Slush provider invalidates the pinned provider selection', async () => {
    const f = await fixtureContext('duplicate-provider'); await ready(f.page); await acknowledge(f.page);
    await f.page.evaluate(() => __offlineWallet.addDuplicate());
    await f.page.waitForFunction(() => document.querySelector('#submit-season').disabled);
    const s = await snapshot(f.page); assert(s.checkDisabled && s.submitDisabled);
    assert.match(await f.page.locator('#wallet-list').innerText(), /More than one Slush/);
    assert.equal((await walletAudit(f.page)).signing.length, 0);
    f.record.final = s; await f.context.close();
  });

  await scenario('Tampered approved packet fails closed before simulation or wallet handoff', async () => {
    const f = await fixtureContext('tampered-packet', { tampered: true }); await connect(f.page);
    await f.page.locator('#check-season').click(); await waitTitle(f.page, 'Season check stopped');
    const s = await snapshot(f.page); assert(s.submitDisabled && s.acknowledgementDisabled);
    assert.match(s.message, /packet.*differs|differs.*packet/);
    assert.equal(f.record.simulationPayloads.length, 0); assert.equal((await walletAudit(f.page)).signing.length, 0);
    f.record.final = s; await f.context.close();
  });

  await scenario('Stale checkpoint fails closed before simulation or wallet handoff', async () => {
    const f = await fixtureContext('stale-checkpoint', { stale: true }); await connect(f.page);
    await f.page.locator('#check-season').click(); await waitTitle(f.page, 'Season check stopped');
    const s = await snapshot(f.page); assert(s.submitDisabled && s.acknowledgementDisabled);
    assert.match(s.message, /too old|stale/i); assert.equal((await walletAudit(f.page)).signing.length, 0);
    f.record.final = s; await f.context.close();
  });

  await scenario('An already-started season prevents another start and verifies its receipt without a wallet', async () => {
    const f = await fixtureContext('existing-registry', { existing: true });
    await f.page.locator('#check-existing').click();
    await waitTitle(f.page, 'Test season confirmed');
    const s = await snapshot(f.page); assert(s.submitDisabled && s.journal?.phase === 'confirmed' && s.receiptVisible);
    assert.equal(s.receiptRegistry, f.control.parsedReceipt.registryId);
    assert.equal(s.receiptAdminCap, f.control.parsedReceipt.adminCapId);
    assert.equal(f.record.simulationPayloads.length, 0);
    assert.equal((await walletAudit(f.page)).connect, 0);
    assert.equal((await walletAudit(f.page)).signing.length, 0);
    f.record.final = s; await f.context.close();
  });

  await scenario('An unverified later-activity candidate remains replaceable and cannot permit another first start', async () => {
    const f = await fixtureContext('existing-candidate', { existing: true, existingCandidate: 'later-activity' }); await connect(f.page);
    await f.page.locator('#check-season').click();
    await waitTitle(f.page, 'Season check stopped');
    let s = await snapshot(f.page);
    assert(s.checkDisabled && s.submitDisabled && s.journal?.phase === 'observed-existing');
    assert.equal(s.journal.digest, null, 'An unverified candidate cannot become a pinned wallet digest');
    assert.equal(await f.page.locator('#transaction-digest').inputValue(), syntheticDigest('later-activity'));
    await f.page.locator('#transaction-digest').fill(f.control.walletResult.digest);
    await f.page.locator('#verify-receipt').click();
    await waitTitle(f.page, 'Test season confirmed');
    s = await snapshot(f.page);
    assert.equal(s.receiptRegistry, f.control.parsedReceipt.registryId);
    assert.equal(s.journal.digest, f.control.walletResult.digest);
    assert.equal(f.record.simulationPayloads.length, 0); assert.equal((await walletAudit(f.page)).signing.length, 0);
    f.record.final = s; await f.context.close();
  });

  for (const [name, setting] of [['Duplicate Registry inventory', 'duplicates'], ['Truncated Registry inventory', 'incompleteInventory']]) {
    await scenario(`${name} prevents simulation and wallet handoff`, async () => {
      const f = await fixtureContext(setting, { [setting]: true }); await connect(f.page);
      await f.page.locator('#check-season').click(); await waitTitle(f.page, 'Season check stopped');
      const s = await snapshot(f.page); assert(s.submitDisabled && s.acknowledgementDisabled);
      assert.match(s.message, /inventory|incomplete|multiple/i);
      assert.equal(f.record.simulationPayloads.length, 0);
      assert.equal((await walletAudit(f.page)).signing.length, 0);
      f.record.final = s; await f.context.close();
    });
  }

  await scenario('Changed fee requires a new acknowledgement without opening the wallet', async () => {
    const f = await fixtureContext('changed-fee', { feeChanges: true }); await ready(f.page); await acknowledge(f.page);
    await f.page.locator('#submit-season').click(); await waitTitle(f.page, 'network fee estimate changed');
    const s = await snapshot(f.page); assert(s.submitDisabled && !s.acknowledgementDisabled);
    assert.equal(await f.page.locator('#acknowledge').isChecked(), false);
    assert.equal((await walletAudit(f.page)).signing.length, 0);
    f.record.final = s; await f.context.close();
  });

  await scenario('Excessive simulated network fee stops review before acknowledgement', async () => {
    const f = await fixtureContext('excessive-fee', { excessiveFee: true }); await connect(f.page);
    await f.page.locator('#check-season').click(); await waitTitle(f.page, 'Season check stopped');
    const s = await snapshot(f.page); assert(s.submitDisabled && s.acknowledgementDisabled);
    assert.match(s.message, /exceeds.*0\.01.*SUI/);
    assert.equal((await walletAudit(f.page)).signing.length, 0);
    f.record.final = s; await f.context.close();
  });

  await scenario('Uncertain wallet response remains locked across reload, tabs and an unstarted-state check, then recovers a verified receipt', async () => {
    const f = await fixtureContext('uncertain-wallet', { mode: 'uncertain' }); await ready(f.page); await acknowledge(f.page);
    await f.page.locator('#submit-season').click(); await waitTitle(f.page, 'needs verification');
    await exactRequest(f.page);
    let s = await snapshot(f.page); assert(s.submitDisabled && s.recoveryVisible && s.journal.phase === 'uncertain');
    await f.page.reload({ waitUntil: 'networkidle' });
    s = await snapshot(f.page); assert(s.submitDisabled && s.recoveryVisible && s.journal.phase === 'uncertain');
    assert.equal((await walletAudit(f.page)).signing.length, 0, 'Reload must not reopen the wallet');
    const second = await f.newPage();
    assert((await snapshot(second)).submitDisabled);
    assert.equal((await walletAudit(second)).signing.length, 0);
    await f.page.locator('#check-existing').click(); await waitTitle(f.page, 'No confirmed first start found yet');
    s = await snapshot(f.page); assert(s.submitDisabled && s.journal.phase === 'uncertain');
    await screenshot(f.page, 'desktop-uncertain-recovery.png');
    await f.page.locator('#transaction-digest').fill(f.control.walletResult.digest);
    await f.page.locator('#verify-receipt').click(); await waitTitle(f.page, 'Test season confirmed');
    s = await snapshot(f.page);
    assert(s.submitDisabled && s.receiptVisible && s.journal.phase === 'confirmed');
    assert.equal(s.receiptDigest, f.control.walletResult.digest);
    assert.equal(s.receiptRegistry, f.control.parsedReceipt.registryId);
    assert.equal((await walletAudit(f.page)).signing.length, 0, 'Read-only recovery must not reopen wallet');
    assert.equal(f.control.grpcReads, 1, 'Current SDK inclusion wait must use only the allowed read fixture');
    await second.waitForFunction(key => JSON.parse(localStorage.getItem(key)).phase === 'confirmed', ATTEMPT_KEY);
    assert((await snapshot(second)).submitDisabled);
    f.record.final = s; await f.context.close();
  });

  await scenario('A synthetic successful wallet result confirms exact actual start and 24-hour cutoff', async () => {
    const f = await fixtureContext('successful-season', { mode: 'success' }); await ready(f.page); await acknowledge(f.page);
    await f.page.locator('#submit-season').click(); await waitTitle(f.page, 'Test season confirmed');
    await exactRequest(f.page);
    let s = await snapshot(f.page);
    assert(s.receiptVisible && !s.recoveryVisible && s.submitDisabled && s.journal.phase === 'confirmed');
    assert.equal(s.receiptDigest, f.control.walletResult.digest);
    assert.equal(s.receiptRegistry, f.control.parsedReceipt.registryId);
    assert.equal(s.receiptAdminCap, f.control.parsedReceipt.adminCapId);
    assert.equal(await f.page.locator('#receipt-package').textContent(), EXPECTED.packageId);
    assert.equal(await f.page.locator('#gas-estimate').textContent(), '0.000100553 SUI');
    assert.equal(await f.page.locator('#gas-status').textContent(), 'Confirmed fee');
    assert.equal(f.control.grpcReads, 1);
    assert.equal(f.control.confirmationCount, 1);
    const receipt = f.control.parsedReceipt;
    assert.equal(BigInt(receipt.cutoffMs) - BigInt(receipt.actualStartMs), 86400000n);
    assert.equal(BigInt(receipt.actualStartMs) - BigInt(receipt.storedStartMs), 2505600000n);
    const startText = await f.page.locator('#receipt-start').textContent();
    const cutoffText = await f.page.locator('#receipt-cutoff').textContent();
    assert.notEqual(startText, cutoffText);
    assert.equal(await f.page.locator('#receipt-season').textContent(), '1 · test inventory version 1');
    const formatted = await f.page.evaluate(receipt => ({ start: new Date(Number(receipt.actualStartMs)).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'long' }), cutoff: new Date(Number(receipt.cutoffMs)).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'long' }) }), receipt);
    assert.equal(startText, formatted.start);
    assert.equal(cutoffText, formatted.cutoff);
    check('Confirmed timing is exactly 24 hours from actual event time; backdated storage time is separate', true,
      { actualStartMs: receipt.actualStartMs, storedStartMs: receipt.storedStartMs, cutoffMs: receipt.cutoffMs });
    await screenshot(f.page, 'desktop-confirmed-synthetic.png');
    await f.page.reload({ waitUntil: 'networkidle' });
    s = await snapshot(f.page); assert(s.submitDisabled && s.journal.phase === 'confirmed');
    assert.equal((await walletAudit(f.page)).signing.length, 0);
    f.record.final = s; await f.context.close();
  });

  for (const [name, setting] of [['Wrong sender receipt', 'receiptMismatch'], ['Simulation presented as a receipt', 'simulationAsReceipt']]) {
    await scenario(`${name} cannot confirm or clear a returned-digest lock`, async () => {
      const f = await fixtureContext(setting, { mode: 'success', [setting]: true }); await ready(f.page); await acknowledge(f.page);
      await f.page.locator('#submit-season').click(); await waitTitle(f.page, 'needs verification');
      await exactRequest(f.page);
      const s = await snapshot(f.page);
      assert(s.submitDisabled && s.recoveryVisible && !s.receiptVisible && s.journal.phase === 'uncertain');
      assert.equal(s.journal.digest, f.control.walletResult.digest);
      await f.page.locator('#transaction-digest').fill(syntheticDigest('unrelated'));
      await f.page.locator('#verify-receipt').click(); await waitTitle(f.page, 'Receipt not yet verified');
      assert.match((await snapshot(f.page)).message, /digest already returned by Slush/);
      assert.equal(f.control.confirmationCount, 1, 'A known wallet digest cannot be replaced with an unrelated candidate');
      f.record.final = await snapshot(f.page); await f.context.close();
    });
  }

  await scenario('Storage unavailable disables signing while retaining read-only recovery', async () => {
    const f = await fixtureContext('no-storage', { disableStorage: true });
    const s = await snapshot(f.page); assert(s.submitDisabled && s.recoveryVisible);
    assert.match(s.title, /storage is required/i);
    assert.equal((await walletAudit(f.page)).signing.length, 0);
    f.record.final = s; await f.context.close();
  });

  await scenario('Wrong origin is rejected before connecting a wallet', async () => {
    const f = await fixtureContext('wrong-origin', { origin: 'https://treegrow.xyz' });
    await f.page.locator('#origin-warning').waitFor({ state: 'visible' });
    assert.match(await f.page.locator('#origin-warning').innerText(), /only at https:\/\/www.treegrow.xyz/);
    assert.equal((await walletAudit(f.page)).connect, 0);
    assert.equal((await walletAudit(f.page)).signing.length, 0);
    assert(await f.page.locator('#submit-season').isDisabled());
    await f.context.close();
  });

  for (const record of contexts) {
    check(`${record.name}: no unexpected browser exception`, record.errors.length === 0, record.errors);
    check(`${record.name}: all network calls match offline assets or approved read/simulation fixtures`, record.blocked.length === 0, record.blocked);
  }
} catch (error) {
  check('Browser review completed', false, error.stack || error.message);
} finally {
  const summary = { schemaVersion: 1, syntheticOnly: true, liveNetworkAllowed: false,
    realWalletUsed: false, signaturesCreated: 0, broadcasts: 0,
    testedOrigin: ORIGIN, playwrightVersion: require(path.join(config.playwright, 'package.json')).version,
    browserVersion: browser?.version() || null, dist: config.dist,
    compiledSha256: Object.fromEntries(adminNames.map(name => [name, sha(compiled.get('admin/season-test/' + name))])),
    passed: rows.every(row => row.passed), checks: rows, screenshots,
    contexts: contexts.map(({ settings, ...record }) => record),
  };
  fs.writeFileSync(path.join(config.output, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(config.output, 'network.json'), JSON.stringify(network, null, 2));
  if (browser) await browser.close();
  console.log(`Evidence: ${config.output}`);
  process.exitCode = summary.passed ? 0 : 1;
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
        raise ValueError("Synthetic browser evidence must remain under /tmp/arboretum-season-browser-review")
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
