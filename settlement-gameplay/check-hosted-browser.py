#!/usr/bin/env python3
"""Read-only hosted browser check of the published first owner Seed page.

Supply the existing tester access code through stdin. It is sent only by the
native login form to www.treegrow.xyz and never recorded. No wallet provider is
injected, connected, or used. The browser can request only explicitly listed
same-origin assets and the exact public proof/input queries and checkpoint-pinned NFT pages from plant-core.
No simulation, signing, execution, receipt recovery, or other RPC is allowed.

Run after deploying the matching dist build. Normal TLS validation is required;
this harness neither installs certificates nor disables verification. Select
an existing Chromium with ARBORETUM_REVIEW_CHROMIUM. Evidence is kept in a new
directory under /tmp/arboretum-gameplay-hosted-browser-review.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = Path("/tmp/arboretum-gameplay-hosted-browser-review")

RUNNER = r"""
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const config = JSON.parse(process.env.ARBORETUM_GAMEPLAY_HOSTED_REVIEW);
assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0', 'Normal TLS verification is required.');
const password = fs.readFileSync(0, 'utf8').trim();
assert(password.length >= 32 && password.length <= 256, 'Supply the existing tester code through stdin.');
const redact = value => String(value).split(password).join('[REDACTED]');
const require = createRequire(path.join(config.root, 'package.json'));
const { chromium } = require(config.playwright);
const { PLANT_EXPECTED: EXPECTED, PROOF_QUERY, PROOF_VARIABLES,
  INPUTS_QUERY, INPUT_VARIABLES, NFT_PAGE_QUERY, nextNFTPageVariables, appendNFTPage, inspectPlantState } = await import(pathToFileURL(
    path.join(config.root, 'settlement-gameplay/plant-core.mjs')));
const ORIGIN = 'https://www.treegrow.xyz';
const PAGE = '/admin/gameplay-test/';
const ENTRANCE = '/tester-access?next=gameplay-test';
const ATTEMPT_KEY = 'arboretum:first-plant:v1:season-1:attempt';
assert.equal(EXPECTED.origin, ORIGIN);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const requiredFiles = ['admin/gameplay-test/admin.mjs', 'admin/gameplay-test/admin.css'];
const compiled = new Map(requiredFiles.map(name => [name, fs.readFileSync(path.join(config.dist, name))]));
const allowedStatic = new Set([...requiredFiles.map(name => '/' + name),
  '/prelaunch/site.css', '/prelaunch/mark.png', '/prelaunch/forest.jpg']);
const contexts = [], checks = [], screenshots = [];
let browser;
const save = (filename, value) => fs.writeFileSync(path.join(config.output, filename),
  redact(JSON.stringify(value, null, 2)) + '\n');
function check(name, detail) {
  checks.push({ check: name, passed: true, ...(detail === undefined ? {} : { detail }) });
  console.log('PASS ' + name);
}
function allowedRead(payload, paginationInputs, pageNumber) {
  assert.deepEqual(Object.keys(payload).sort(), ['query', 'variables']);
  if (payload.query === PROOF_QUERY) {
    assert.deepEqual(payload.variables, PROOF_VARIABLES);
    return 'proof';
  }
  if (payload.query === INPUTS_QUERY) {
    assert.deepEqual(payload.variables, INPUT_VARIABLES);
    return 'inputs';
  }
  if (payload.query === NFT_PAGE_QUERY) {
    assert(paginationInputs, 'The initial checkpoint-pinned input response must precede NFT pagination.');
    const expectedVariables = nextNFTPageVariables(paginationInputs);
    assert(expectedVariables, 'A terminal NFT inventory must not request another page.');
    assert(pageNumber >= 1 && pageNumber <= 100, 'NFT pagination exceeded its fixed bound.');
    assert.deepEqual(payload.variables, expectedVariables);
    return 'nft-page-' + pageNumber;
  }
  throw new Error('Only the exact public proof, current inputs and checked NFT-page queries are allowed.');
}
async function snapshot(page) {
  return page.evaluate(key => ({
    title: document.title,
    heading: document.querySelector('#page-title')?.textContent.replace(/\s+/g, ' ').trim(),
    statusTitle: document.querySelector('#status-title')?.textContent,
    statusMessage: document.querySelector('#status-message')?.textContent,
    walletNote: document.querySelector('#wallet-list')?.textContent,
    connectedAddressVisible: !document.querySelector('#connected-address').hidden,
    accountControlsVisible: !document.querySelector('#account-controls').hidden,
    connectButtonCount: document.querySelectorAll('#connect-slush').length,
    loadNftsDisabled: document.querySelector('#load-nfts').disabled,
    nftSelection: document.querySelector('#nft-select').value,
    checkDisabled: document.querySelector('#check-plant').disabled,
    submitDisabled: document.querySelector('#submit-plant').disabled,
    acknowledgmentDisabled: document.querySelector('#acknowledge').disabled,
    acknowledgmentChecked: document.querySelector('#acknowledge').checked,
    receiptVisible: !document.querySelector('#receipt-panel').hidden,
    recoveryVisible: !document.querySelector('#recovery-panel').hidden,
    attemptJournalPresent: localStorage.getItem(key) !== null,
    viewportWidth: innerWidth, pageWidth: document.documentElement.scrollWidth,
  }), ATTEMPT_KEY);
}
function assertDisconnected(state) {
  assert.equal(state.connectedAddressVisible, false);
  assert.equal(state.accountControlsVisible, false);
  assert.equal(state.connectButtonCount, 0, 'This fresh verification browser must have no wallet provider.');
  assert.equal(state.loadNftsDisabled, true);
  assert.equal(state.nftSelection, '');
  assert.equal(state.checkDisabled, true);
  assert.equal(state.submitDisabled, true);
  assert.equal(state.acknowledgmentDisabled, true);
  assert.equal(state.acknowledgmentChecked, false);
  assert.equal(state.receiptVisible, false);
  assert.equal(state.attemptJournalPresent, false, 'A read-only check must not record a wallet attempt.');
  assert.match(state.walletNote, /Slush extension installed and enabled/);
  assert(state.pageWidth <= state.viewportWidth, 'The hosted page has horizontal overflow.');
}
async function capture(page, width) {
  assert.equal(await page.locator('input[name="password"]').count(), 0,
    'Never capture a tester form or credential field.');
  await page.evaluate(() => {
    const tag = document.createElement('div');
    tag.textContent = 'READ-ONLY LIVE CHECK · NO WALLET CONNECTED';
    tag.style.cssText = 'position:relative;padding:9px 12px;background:#314434;color:#fff;text-align:center;font:11px/1.5 monospace;letter-spacing:.03em;overflow-wrap:anywhere';
    document.body.prepend(tag);
    window.scrollTo(0, 0);
  });
  const filename = `hosted-read-only-${width}.png`;
  await page.screenshot({ path: path.join(config.output, filename), fullPage: true, animations: 'disabled' });
  screenshots.push({ filename, width, sha256: sha(fs.readFileSync(path.join(config.output, filename))) });
}

async function review(width) {
  const context = await browser.newContext({
    viewport: { width, height: width < 600 ? 844 : 1000 },
    deviceScaleFactor: 1, timezoneId: 'America/Chicago',
    isMobile: width < 600, hasTouch: width < 600,
    serviceWorkers: 'block', javaScriptEnabled: true, ignoreHTTPSErrors: false,
  });
  const record = { width, requests: [], blocked: [], observationErrors: [],
    pageErrors: [], consoleErrors: [], snapshots: {}, hostedSha256: {},
    walletProviderInjected: false, walletConnectionActions: 0,
    signingActions: 0, simulations: 0, executionRequests: 0, tlsVerification: 'normal' };
  contexts.push(record);
  const publicRequests = new WeakMap(), requestRows = new WeakMap();
  const publicResponses = new Map(), responseTasks = [];
  let page;
  let phase = 'login';
  let paginationInputs = null, nftPages = 0;
  async function drainObservations() {
    let consumed = 0;
    while (consumed < responseTasks.length) {
      const pending = responseTasks.slice(consumed);
      consumed = responseTasks.length;
      await Promise.all(pending);
    }
  }
  await context.routeWebSocket('**/*', socket => {
    const url = new URL(socket.url());
    record.blocked.push({ origin: url.origin, path: url.pathname, method: 'WEBSOCKET' });
    socket.close({ code: 1008, reason: 'Read-only live verification' });
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    const row = { origin: url.origin, path: url.pathname, method: request.method(), phase };
    record.requests.push(row); requestRows.set(request, row);
    if (url.origin === ORIGIN && request.method() === 'GET') {
      if (url.pathname === '/tester-access' && url.search === '?next=gameplay-test' && request.isNavigationRequest()) {
        row.allowed = 'Fixed tester entrance'; return route.continue();
      }
      if ([PAGE, PAGE.slice(0, -1), PAGE + 'index.html'].includes(url.pathname) && !url.search && request.isNavigationRequest()) {
        row.allowed = 'Protected first-Seed document'; return route.continue();
      }
      if (allowedStatic.has(url.pathname) && !url.search) {
        row.allowed = 'Explicit same-origin asset'; return route.continue();
      }
    }
    if (url.origin === ORIGIN && url.pathname === '/tester-access' && !url.search &&
      request.method() === 'POST' && request.isNavigationRequest() && phase === 'login') {
      // The browser sends the native form. Its request body, credentials and
      // cookie headers are deliberately never inspected, logged or persisted.
      row.allowed = 'Native tester login'; return route.continue();
    }
    if (url.href === EXPECTED.graphqlEndpoint && phase === 'read-only') {
      if (request.method() === 'OPTIONS') {
        row.allowed = 'Public GraphQL CORS'; return route.continue();
      }
      if (request.method() === 'POST') {
        try {
          const payload = request.postDataJSON();
          await drainObservations();
          const operation = allowedRead(payload, paginationInputs, nftPages + 1);
          row.allowed = 'Exact public mainnet read'; row.operation = operation;
          publicRequests.set(request, { operation, payload });
          return route.continue();
        } catch { /* A mismatched query or variable is denied below. */ }
      }
    }
    record.blocked.push(row);
    return route.abort('blockedbyclient');
  });
  context.on('response', response => {
    responseTasks.push((async () => {
      const request = response.request(), url = new URL(response.url());
      const row = requestRows.get(request);
      if (row) row.status = response.status();
      const publicRead = publicRequests.get(request);
      if (publicRead) {
        assert.equal(response.status(), 200, 'A public mainnet read failed.');
        const raw = await response.json();
        assert(raw?.data && !raw.errors?.length, 'A public mainnet query returned incomplete data or errors.');
        const headers = await response.allHeaders();
        assert([ORIGIN, '*'].includes(headers['access-control-allow-origin']), 'Canonical-origin CORS is missing.');
        const captured = { capturedAt: new Date().toISOString(), endpoint: EXPECTED.graphqlEndpoint,
          operation: publicRead.operation, query: publicRead.payload.query,
          variables: publicRead.payload.variables, httpStatus: response.status(), response: raw };
        assert(!publicResponses.has(publicRead.operation), 'Unexpected duplicate mainnet read.');
        publicResponses.set(publicRead.operation, captured);
        if (publicRead.operation === 'inputs') paginationInputs = raw;
        if (publicRead.operation.startsWith('nft-page-')) {
          paginationInputs = appendNFTPage(paginationInputs, raw);
          nftPages += 1;
        }
        save(`mainnet-${width}-${publicRead.operation}.json`, captured);
      }
      const filename = url.pathname.slice(1);
      if (url.origin === ORIGIN && request.method() === 'GET' && compiled.has(filename)) {
        assert.equal(response.status(), 200, 'A required protected asset did not load: ' + filename);
        const body = await response.body();
        assert(body.equals(compiled.get(filename)), 'Hosted asset differs from the frozen local build: ' + filename);
        record.hostedSha256[filename] = sha(body);
      }
    })().catch(error => { record.observationErrors.push(redact(error.message)); }));
  });
  context.on('requestfailed', request => {
    const row = requestRows.get(request);
    if (row) row.failed = redact(request.failure()?.errorText || 'Request failed');
  });
  context.on('page', opened => {
    if (page && opened !== page) record.blocked.push({ unexpectedPage: true });
  });
  try {
    page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => record.pageErrors.push(redact(error.message)));
    page.on('console', message => {
      if (message.type() === 'error') record.consoleErrors.push(redact(message.text()));
    });
    await page.goto(ORIGIN + ENTRANCE, { waitUntil: 'domcontentloaded' });
    assert.equal(page.url(), ORIGIN + ENTRANCE, 'The fixed tester entrance changed.');
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('input[name="next"]').inputValue(), 'gameplay-test');
    await page.locator('input[name="password"]').fill(password);
    const loginResponse = page.waitForResponse(response => response.request().method() === 'POST' &&
      new URL(response.url()).origin === ORIGIN && new URL(response.url()).pathname === '/tester-access');
    await page.locator('form').filter({ has: page.locator('input[name="password"]') })
      .locator('button[type="submit"]').click();
    assert.equal((await loginResponse).status(), 303, 'Native tester login did not succeed.');
    await page.waitForURL(ORIGIN + PAGE);
    await page.waitForFunction(() => document.querySelector('#wallet-list')?.textContent.includes('Slush extension installed and enabled'));
    await page.waitForLoadState('networkidle');
    assert.equal(await page.title(), 'First test Seed | Arboretum owner test');
    assert.equal((await page.locator('#page-title').textContent()).replace(/\s+/g, ' ').trim(), 'Plant your first test Seed.');
    assert.equal(await page.locator('#plant-heading').textContent(), 'One NFTree. One test Seed.');
    const acknowledgment = await page.locator('label[for="acknowledge"]').textContent();
    assert.match(acknowledgment, /one version-1 test Seed/);
    assert.match(acknowledgment, /0\.01 SUI payment/);
    assert.equal(await page.locator('#expected-admin').textContent(), EXPECTED.sender);
    assert.equal(await page.locator('#expected-package').textContent(), EXPECTED.packageId);
    assert.equal(await page.locator('#expected-registry').textContent(), EXPECTED.registryId);
    assert.equal(await page.locator('#expected-start').textContent(), EXPECTED.startDigest);
    assert.equal(await page.locator('#origin-warning').isVisible(), false);
    record.snapshots.before = await snapshot(page);
    assertDisconnected(record.snapshots.before);
    assert.equal(publicResponses.size, 0, 'Loading the page must not issue public mainnet queries automatically.');
    check(`${width}px: native login reaches the correct JavaScript-enabled, disconnected first-Seed review`);

    await drainObservations();
    for (const filename of requiredFiles) assert.equal(record.hostedSha256[filename], sha(compiled.get(filename)),
      'Required published asset was not verified: ' + filename);
    check(`${width}px: compiled JavaScript and CSS match the frozen dist bytes`);

    phase = 'read-only';
    await page.locator('#check-existing').click();
    await page.waitForFunction(() => {
      const title = document.querySelector('#status-title')?.textContent;
      return title && !/^Checking\b/i.test(title) && !document.querySelector('#check-existing').disabled;
    });
    await drainObservations();
    assert.deepEqual([...publicResponses.keys()], ['proof', 'inputs', ...Array.from({ length: nftPages }, (_, index) => 'nft-page-' + (index + 1))]);
    assert.equal(nextNFTPageVariables(paginationInputs), null, 'The hosted check must finish the complete NFT inventory.');
    save(`mainnet-${width}-inputs-complete.json`, { checkpointPinnedNFTPages: nftPages, response: paginationInputs });
    const observed = await inspectPlantState(paginationInputs, publicResponses.get('proof').response);
    assert.equal(observed.status, 'ready');
    assert.equal(observed.registryId, EXPECTED.registryId);
    assert.equal(observed.packageId, EXPECTED.packageId);
    assert.equal(observed.registry.asMoveObject.contents.json.version, '1');
    assert.equal(observed.currentState.seasonId, '1');
    assert.equal(observed.currentState.rewardPoolMist, '0');
    assert.equal(observed.currentState.treasuryMist, '0');
    assert.equal(observed.currentState.totalSeeds, '0');
    assert.equal(observed.currentState.growthPoints, '0');
    assert(Array.isArray(observed.ownedNFTs) && observed.ownedNFTs.length > 0, 'The owner must have at least one verified NFTree.');
    assert.equal(await page.locator('#status-panel').isVisible(), true);
    assert.match(await page.locator('#status-title').textContent(), /first.*Seed|Seed.*ready/i,
      redact(await page.locator('#status-message').textContent()));
    assert.doesNotMatch(await page.locator('#status-title').textContent(), /unavailable|failed|closed/i);
    record.mainnet = { checkpoint: observed.checkpoint, clockMs: observed.clockMs,
      registryId: observed.registryId, packageId: observed.packageId,
      inventoryVersion: observed.registry.asMoveObject.contents.json.version,
      currentState: observed.currentState, ownedNFTs: observed.ownedNFTs, additionalNFTPages: nftPages,
      confirmedStart: observed.confirmedStart };
    record.snapshots.after = await snapshot(page);
    assertDisconnected(record.snapshots.after);
    check(`${width}px: actual public reads confirm started Season 1, zero Seeds and owned NFTrees`, record.mainnet);
    await capture(page, width);
    await drainObservations();
    assert.equal(record.blocked.length, 0, 'A forbidden network request or popup was attempted.');
    assert.equal(record.observationErrors.length, 0, record.observationErrors.join('; '));
    assert.equal(record.pageErrors.length, 0, record.pageErrors.join('; '));
    assert.equal(record.consoleErrors.length, 0, record.consoleErrors.join('; '));
    assert(record.requests.every(row => !row.failed), 'An allowed request failed.');
    assert(record.requests.every(row => row.status && row.status < 400), 'A hosted request did not complete successfully.');
    check(`${width}px: no wallet action, simulation, execution request, journal, console error or overflow`);
  } finally {
    await drainObservations();
    await context.close();
  }
}

try {
  const launch = { headless: true, args: ['--no-sandbox', '--disable-extensions'] };
  if (config.chromium) launch.executablePath = config.chromium;
  browser = await chromium.launch(launch);
  for (const width of [1440, 390]) await review(width);
  for (const [filename, bytes] of compiled) assert(bytes.equals(fs.readFileSync(path.join(config.dist, filename))),
    'The local build changed during hosted verification.');
} catch (error) {
  const detail = redact(error.stack || error.message);
  checks.push({ check: 'Hosted read-only verification completed', passed: false, detail });
  console.log('FAIL Hosted read-only verification completed: ' + detail);
} finally {
  const summary = { schemaVersion: 1, completedAt: new Date().toISOString(),
    hosted: true, readOnly: true, syntheticOnly: false, testedOrigin: ORIGIN, entrance: ENTRANCE,
    realWalletsUsed: 0, walletProviderInjected: false, walletConnectionActions: 0,
    signaturesRequested: 0, transactionsSubmitted: 0, simulationsRequested: 0,
    tlsVerification: 'normal', ignoreHTTPSErrors: false,
    passed: checks.length === 8 && checks.every(row => row.passed), checks, contexts, screenshots,
    compiledSha256: Object.fromEntries([...compiled].map(([filename, bytes]) => [filename, sha(bytes)])),
    sourceSha256: { 'settlement-gameplay/check-hosted-browser.py': config.harnessSha256,
      'settlement-gameplay/plant-core.mjs': sha(fs.readFileSync(path.join(config.root, 'settlement-gameplay/plant-core.mjs'))) },
    browserVersion: browser?.version() || null,
    playwrightVersion: require(path.join(config.playwright, 'package.json')).version,
    limits: ['This is a disconnected browser verification of deployed assets and public reads, not real wallet signing.',
      'The exact raw published HTML is verified separately; this harness checks its visible structure and controls.',
      'No planting, watering, funding, or reward transaction is executed.'],
  };
  save('summary.json', summary);
  if (browser) await browser.close();
  console.log('Evidence: ' + config.output);
  process.exitCode = summary.passed ? 0 : 1;
}
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist", type=Path, default=ROOT / "dist")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if os.environ.get("NODE_TLS_REJECT_UNAUTHORIZED") == "0":
        raise ValueError("Normal TLS verification is required.")
    supplied_code = sys.stdin.read().strip()
    if not 32 <= len(supplied_code) <= 256:
        raise ValueError("Supply the existing tester access code through stdin.")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    output = (args.output or OUTPUT_ROOT / f"run-{stamp}").resolve()
    if not output.is_relative_to(OUTPUT_ROOT.resolve()):
        raise ValueError("Hosted browser evidence must remain under /tmp/arboretum-gameplay-hosted-browser-review.")
    output.mkdir(parents=True, exist_ok=False)
    modules = os.environ.get("CODEX_PRIMARY_RUNTIME_NODE_MODULES", "/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules")
    config = {
        "root": str(ROOT), "dist": str(args.dist.resolve()), "output": str(output),
        "playwright": os.environ.get("ARBORETUM_PLAYWRIGHT_MODULE", str(Path(modules) / "playwright")),
        "chromium": os.environ.get("ARBORETUM_REVIEW_CHROMIUM"),
        "harnessSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    }
    node = os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node")
    if not node:
        raise RuntimeError("Node is required for the installed Playwright dependency.")
    runner = output / "runner.mjs"
    runner.write_text(RUNNER)
    # Credentials are passed through pipes only. The generated runner and JSON
    # configuration contain no password, cookie, session or token.
    result = subprocess.run([node, str(runner)], input=supplied_code, text=True,
        cwd=ROOT, env={**os.environ, "ARBORETUM_GAMEPLAY_HOSTED_REVIEW": json.dumps(config)}, check=False)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
