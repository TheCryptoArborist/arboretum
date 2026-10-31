#!/usr/bin/env python3
"""Native-browser regression for tester login returning to the admin page.

Offline mode transpiles both the known pre-fix gate and the working gate and
invokes the real handlers using browser-generated request headers. All HTTPS
requests are intercepted. The browser, not the test, handles native form POSTs,
redirects, and SameSite cookies. All credentials are synthetic in this mode.

--hosted permits requests only to https://www.treegrow.xyz, with an intercepted
ChatGPT-origin page as the external entry. Read the existing tester code from
stdin; it is never written into a file or report. JavaScript is disabled in both
modes, so the app cannot connect a wallet or make chain requests.
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

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = Path("/tmp/arboretum-admin-browser-review/tester-return")
DEFAULT_BASELINE = "d1f98d53d99361b8133e7afade438b8b77aaceb9"

RUNNER = r"""
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const config = JSON.parse(process.env.ARBORETUM_TESTER_RETURN_CONFIG);
const require = createRequire(path.join(config.root, 'package.json'));
const { chromium } = require(config.playwright);
const password = config.hosted ? fs.readFileSync(0, 'utf8').trim() : 'SYNTHETIC-ONLY-tester-return-' + 'p'.repeat(48);
assert(password.length >= 32 && password.length <= 256, 'A tester code of the expected length must be supplied via stdin');
const ORIGIN = 'https://www.treegrow.xyz';
const ADMIN = '/admin/settlement-upgrade/';
const EXTERNAL = 'https://chatgpt.com/offline-arboretum-return-fixture';
const GATE_PATH = 'netlify/edge-functions/tester-gate.ts';
const rows = [], requests = [], screenshots = [], gateHashes = {}, contexts = [];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const redact = text => String(text).split(password).join('[REDACTED]');
const requestStats = { total: 0, blocked: 0, chainAttempts: 0, externalDocumentAttempts: 0 };
let browser;
let fixtureTls;

function check(name, passed, detail) {
  const row = { check: name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) };
  rows.push(row); console.log(`${row.passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!row.passed && detail) console.log(redact(typeof detail === 'string' ? detail : JSON.stringify(detail)));
  return row.passed;
}
function cookieFlags(cookie) {
  return { name: cookie.name, domain: cookie.domain, path: cookie.path,
    secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite };
}
async function verifyCookie(context, label) {
  const cookies = (await context.cookies()).filter(cookie => cookie.name === '__Host-arboretum_tester');
  assert.equal(cookies.length, 1, 'Exactly one tester cookie');
  const flags = cookieFlags(cookies[0]);
  assert.equal(flags.domain, 'www.treegrow.xyz');
  assert.equal(flags.path, '/'); assert.equal(flags.secure, true);
  assert.equal(flags.httpOnly, true); assert.equal(flags.sameSite, 'Strict');
  check(label + ': host-only Secure HttpOnly SameSite Strict cookie is retained', true, flags);
}
async function loadGate(source, label) {
  const { transform } = require('esbuild');
  gateHashes[label] = sha(source);
  const result = await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' });
  const filename = path.join(config.output, 'gate-' + label + '.mjs');
  fs.writeFileSync(filename, result.code);
  return (await import(pathToFileURL(filename))).default;
}
function localResponse(url) {
  let filename = decodeURIComponent(url.pathname).replace(/^\//, '');
  if (!filename) filename = 'index.html';
  if (filename === 'admin/settlement-upgrade') filename += '/index.html';
  else if (filename.endsWith('/')) filename += 'index.html';
  const target = path.resolve(config.dist, filename);
  if (!target.startsWith(path.resolve(config.dist) + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    return new Response('Unavailable offline asset', { status: 404 });
  }
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.avif': 'image/avif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json' };
  return new Response(fs.readFileSync(target), { status: 200, headers: { 'content-type': types[path.extname(target)] || 'application/octet-stream' } });
}
function externalHtml(adminTarget) {
  return '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Offline external entry fixture</title>' +
    '<h1>External conversation link fixture</h1><p>No real ChatGPT session is accessed.</p>' +
    '<a id="admin-link" target="_blank" rel="noopener noreferrer" href="' + ORIGIN + adminTarget + '">Open administrator upgrade review</a></html>';
}
function recordDocument(label, url, method, headers) {
  const row = { case: label, origin: url.origin, path: url.pathname, method,
    fetchSite: headers['sec-fetch-site'] || null, originHeader: headers.origin || null,
    hasTesterCookie: /(?:^|;\s*)__Host-arboretum_tester=/.test(headers.cookie || '') };
  requests.push(row); return row;
}
async function localProxy(label, gate, adminTarget) {
  const sockets = new Set();
  const server = https.createServer(fixtureTls, async (incoming, outgoing) => {
    const url = new URL(incoming.url, 'https://' + incoming.headers.host);
    const headers = Object.fromEntries(Object.entries(incoming.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value]));
    requestStats.total += 1;
    const documentRequest = headers['sec-fetch-dest'] === 'document';
    const row = documentRequest ? recordDocument(label, url, incoming.method, headers) : {};
    try {
      let response;
      if (url.href === EXTERNAL && incoming.method === 'GET') {
        response = new Response(externalHtml(adminTarget), { headers: { 'content-type': 'text/html', 'referrer-policy': 'no-referrer' } });
      } else if (url.origin === ORIGIN) {
        const init = { method: incoming.method, headers };
        if (!['GET', 'HEAD'].includes(incoming.method)) {
          const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
          init.body = Buffer.concat(chunks);
        }
        response = await gate(new Request(url, init), { next: async () => localResponse(url) });
      } else {
        requestStats.blocked += 1;
        if (documentRequest) requestStats.externalDocumentAttempts += 1;
        response = new Response('Offline fixture rejects this origin', { status: 403 });
      }
      row.status = response.status;
      const location = response.headers.get('location');
      if (location) row.redirect = location;
      if (documentRequest) {
        fs.writeFileSync(path.join(config.output, 'document-requests-progress.json'), JSON.stringify(requests, null, 2));
      }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      row.error = redact(error.message);
      outgoing.writeHead(599, { 'content-type': 'text/plain' }); outgoing.end('Offline fixture handler failed');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const proxy = http.createServer((request, response) => { response.writeHead(403); response.end(); });
  proxy.on('connect', (request, client, head) => {
    const allowed = ['www.treegrow.xyz:443', 'chatgpt.com:443'].includes(request.url);
    if (!allowed) {
      requestStats.blocked += 1;
      if (/sui\.io:|graphql|fullnode/.test(request.url)) requestStats.chainAttempts += 1;
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return;
    }
    const upstream = net.connect(server.address().port, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream); upstream.pipe(client);
    });
    sockets.add(client); sockets.add(upstream);
    client.on('error', () => upstream.destroy()); upstream.on('error', () => client.destroy());
    client.on('close', () => { sockets.delete(client); upstream.destroy(); });
    upstream.on('close', () => sockets.delete(upstream));
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  return { url: 'http://127.0.0.1:' + proxy.address().port,
    close() { for (const socket of sockets) socket.destroy(); proxy.close(); server.close(); } };
}
async function newContext(label, gate, { width = 1440, adminTarget = ADMIN } = {}) {
  const local = config.hosted ? null : await localProxy(label, gate, adminTarget);
  const context = await browser.newContext({
    viewport: { width, height: width < 600 ? 844 : 1000 }, javaScriptEnabled: false,
    serviceWorkers: 'block', timezoneId: 'UTC', deviceScaleFactor: 1,
    isMobile: width < 600, hasTouch: width < 600,
    ...(local ? { proxy: { server: local.url }, ignoreHTTPSErrors: true } : {}),
  });
  contexts.push(context);
  if (local) context.on('close', () => local.close());
  if (config.hosted) {
    // Leave canonical requests and redirects on Chromium's native HTTP path.
    // Only the external-entry fixture and denied origins use interception.
    await context.route(url => url.origin !== ORIGIN, async route => {
      const request = route.request(); const url = new URL(request.url());
      if (url.href === EXTERNAL && request.method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'text/html', headers: { 'referrer-policy': 'no-referrer' }, body: externalHtml(adminTarget) });
      }
      requestStats.blocked += 1;
      if (/sui\.io$/.test(url.hostname) || /graphql|fullnode/.test(url.hostname)) requestStats.chainAttempts += 1;
      if (request.isNavigationRequest()) requestStats.externalDocumentAttempts += 1;
      return route.abort('blockedbyclient');
    });
    context.on('response', async response => {
      requestStats.total += 1;
      const request = response.request(); const url = new URL(request.url());
      if (!request.isNavigationRequest() || url.origin !== ORIGIN) return;
      const row = recordDocument(label, url, request.method(), await request.allHeaders());
      row.status = response.status();
      const location = (await response.allHeaders()).location; if (location) row.redirect = location;
    });
  }
  return context;
}
async function newPage(context, url) {
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return page;
}
async function submit(page, value, destination) {
  await page.locator('input[name="password"]').fill(value);
  const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/tester-access');
  await page.locator('form').filter({ has: page.locator('input[name="password"]') }).locator('button[type="submit"]').click();
  const response = await responsePromise;
  await response.finished();
  if (destination) await page.waitForURL(url => url.origin === ORIGIN && url.pathname === destination, { waitUntil: 'domcontentloaded' });
  else await page.waitForLoadState('domcontentloaded');
  const headers = await response.request().allHeaders();
  assert.equal(headers.origin, ORIGIN, 'Native POST must have the browser-generated canonical Origin');
  assert.equal(headers['sec-fetch-site'], 'same-origin', 'Native form POST must remain same-origin');
  return response;
}
async function externalEntry(context, label, expectedIntent) {
  const source = await newPage(context, EXTERNAL);
  const nextPage = context.waitForEvent('page');
  await source.locator('#admin-link').click();
  const page = await nextPage; page.setDefaultTimeout(20000);
  await page.waitForURL(url => url.origin === ORIGIN && url.pathname === '/tester-access', { waitUntil: 'domcontentloaded' });
  const target = new URL(page.url());
  assert.equal(target.searchParams.get('next'), expectedIntent ? 'settlement-upgrade' : null);
  const entry = requests.find(row => row.case === label && row.path === ADMIN && row.method === 'GET');
  assert(entry, 'Actual external-link administrator navigation was observed');
  assert.equal(entry.fetchSite, 'cross-site');
  assert.equal(entry.hasTesterCookie, false, 'SameSite Strict cookie must be omitted on cross-site entry');
  check(label + ': external anchor omits Strict cookie and reaches the intended login URL', true,
    { originalPath: ADMIN, loginPath: target.pathname + target.search, fetchSite: entry.fetchSite });
  return page;
}
async function screenshot(page, filename) {
  // A fixed test watermark is inserted only by Playwright, with app JavaScript
  // disabled. Passwords are never shown or captured; this runs on final pages.
  await page.evaluate(() => {
    const mark = document.createElement('div');
    mark.textContent = 'NATIVE LOGIN REVIEW · PAGE JAVASCRIPT DISABLED · NO WALLET';
    mark.style.cssText = 'position:fixed;bottom:10px;left:10px;right:10px;z-index:2147483647;background:#18311f;color:white;padding:8px;text-align:center;font:11px monospace;border:1px solid #b5d39f';
    document.body.append(mark); window.scrollTo(0, 0);
  });
  await page.screenshot({ path: path.join(config.output, filename), fullPage: false });
  screenshots.push({ filename, sha256: sha(fs.readFileSync(path.join(config.output, filename))) });
}
async function scenario(name, fn) {
  try { await fn(); check(name, true); }
  catch (error) { check(name, false, redact(error.stack || error.message)); }
}
async function defaultLogin(context, label) {
  const page = await newPage(context, ORIGIN + '/tester-access');
  const response = await submit(page, password, '/game.html');
  assert.equal(response.status(), 303); assert.equal(new URL(page.url()).pathname, '/game.html');
  assert(await page.locator('#garden-sec').count(), 'Existing game HTML is served');
  await verifyCookie(context, label);
  return page;
}

try {
  if (!config.hosted) {
    const key = path.join(config.output, 'synthetic-tls-key.pem');
    const cert = path.join(config.output, 'synthetic-tls-cert.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
      '-days', '1', '-subj', '/CN=www.treegrow.xyz', '-addext', 'subjectAltName=DNS:www.treegrow.xyz,DNS:chatgpt.com'], { stdio: 'ignore' });
    fixtureTls = { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
  }
  const launch = { headless: true, args: ['--no-sandbox'] };
  if (!config.hosted) launch.proxy = { server: 'http://127.0.0.1:9' };
  if (config.chromium) launch.executablePath = config.chromium;
  browser = await chromium.launch(launch);
  let currentGate;
  if (!config.hosted) {
    const env = { ARBORETUM_TESTER_PASSWORD: password, ARBORETUM_SESSION_SECRET: 'SYNTHETIC-ONLY-session-secret-' + 's'.repeat(80) };
    globalThis.Netlify = { env: { get: key => env[key] } };
    const previousSource = execFileSync('git', ['show', config.baselineRef + ':' + GATE_PATH], { cwd: config.root, encoding: 'utf8' });
    const previousGate = await loadGate(previousSource, 'before');
    currentGate = await loadGate(fs.readFileSync(path.join(config.root, GATE_PATH), 'utf8'), 'after');

    await scenario('Baseline defect: external administrator link loses its destination after native login', async () => {
      const context = await newContext('baseline', previousGate);
      await defaultLogin(context, 'baseline existing session');
      const page = await externalEntry(context, 'baseline', false);
      const response = await submit(page, password, '/game.html');
      assert.equal(response.status(), 303);
      assert.equal(new URL(page.url()).pathname, '/game.html');
      assert(await page.locator('#garden-sec').count());
      await screenshot(page, 'before-external-entry-game.png');
      check('Baseline reproduces game route despite an administrator link and a previously valid session', true);
      await context.close();
    });
  }

  for (const width of [1440, 390]) {
    const label = (config.hosted ? 'hosted' : 'fixed') + '-' + width;
    await scenario(label + ': external administrator entry, bad code, retry and correct native return', async () => {
      const context = await newContext(label, currentGate, { width });
      // Establish a real browser-managed session first, then prove that an
      // external link still needs a login because the cookie stays Strict.
      await defaultLogin(context, label + ' default login');
      const page = await externalEntry(context, label, true);
      assert.equal(await page.locator('input[name="next"]').inputValue(), 'settlement-upgrade');
      assert.match(await page.locator('form[action="/tester-access"] button[type="submit"]').innerText(), /upgrade review/i);
      const bad = await submit(page, 'synthetic-wrong-access-code-for-regression');
      assert.equal(bad.status(), 401);
      await page.locator('[role="alert"]').waitFor({ state: 'visible' });
      assert.equal(await page.locator('input[name="next"]').inputValue(), 'settlement-upgrade');
      check(label + ': rejected password preserves only the approved administrator intent', true);
      const good = await submit(page, password, ADMIN);
      assert.equal(good.status(), 303);
      assert.equal((await good.allHeaders()).location, ORIGIN + ADMIN);
      assert.match(await page.locator('#page-title').innerText(), /Publish the\s+settlement upgrade\./);
      assert.equal(await page.locator('#garden-sec').count(), 0);
      await verifyCookie(context, label);
      await screenshot(page, label + '-admin-after-login.png');
      await context.close();
    });
  }

  if (!config.hosted) {
    await scenario('Unknown external return target cannot redirect outside the site', async () => {
      const context = await newContext('invalid-return', currentGate);
      const page = await newPage(context, ORIGIN + '/tester-access?next=' + encodeURIComponent('https://evil.example/receive'));
      assert.equal(await page.locator('input[name="next"]').count(), 0, 'Invalid GET target must not enter HTML');
      await page.evaluate(() => {
        const input = document.createElement('input'); input.type = 'hidden'; input.name = 'next'; input.value = 'https://evil.example/receive';
        document.querySelector('form[action="/tester-access"]').append(input);
      });
      const response = await submit(page, password, '/game.html');
      assert.equal((await response.allHeaders()).location, ORIGIN + '/game.html');
      await verifyCookie(context, 'invalid-return'); await context.close();
    });
    await scenario('Duplicate return markers fall back to the game', async () => {
      const context = await newContext('duplicate-return', currentGate);
      const page = await newPage(context, ORIGIN + '/tester-access?next=settlement-upgrade');
      await page.evaluate(() => {
        const input = document.createElement('input'); input.type = 'hidden'; input.name = 'next'; input.value = 'settlement-upgrade';
        document.querySelector('form[action="/tester-access"]').append(input);
      });
      const response = await submit(page, password, '/game.html');
      assert.equal((await response.allHeaders()).location, ORIGIN + '/game.html');
      await context.close();
    });
    await scenario('Login POST query alone cannot choose an administrator return target', async () => {
      const context = await newContext('query-only-return', currentGate);
      const page = await newPage(context, ORIGIN + '/tester-access?next=settlement-upgrade');
      await page.evaluate(() => {
        document.querySelector('input[name="next"]').remove();
        document.querySelector('form[action="/tester-access"]').action = '/tester-access?next=settlement-upgrade';
      });
      const response = await submit(page, password, '/game.html');
      assert.equal((await response.allHeaders()).location, ORIGIN + '/game.html');
      await context.close();
    });
  }
  check('No blockchain request was attempted with page JavaScript disabled', requestStats.chainAttempts === 0);
  check('No navigation attempted an external return destination', requestStats.externalDocumentAttempts === 0);
} catch (error) {
  check('Native-browser return review completed', false, redact(error.stack || error.message));
} finally {
  const summary = { schemaVersion: 1, hosted: config.hosted, javascriptEnabled: false,
    walletUsed: false, signaturesCreated: 0, broadcasts: 0, credentialsWritten: false,
    canonicalOrigin: ORIGIN, externalEntryOrigin: new URL(EXTERNAL).origin,
    baselineRef: config.hosted ? null : config.baselineRef, gateSha256: gateHashes,
    playwrightVersion: require(path.join(config.playwright, 'package.json')).version,
    browserVersion: browser?.version() || null, passed: rows.every(row => row.passed), checks: rows,
    documentRequests: requests, requestStats, screenshots };
  fs.writeFileSync(path.join(config.output, 'summary.json'), JSON.stringify(summary, null, 2));
  if (browser) await browser.close();
  console.log('Evidence: ' + config.output);
  process.exitCode = summary.passed ? 0 : 1;
}
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hosted", action="store_true")
    parser.add_argument("--baseline-ref", default=DEFAULT_BASELINE)
    parser.add_argument("--dist", type=Path, default=ROOT / "dist")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    output = (args.output or OUTPUT_ROOT / ("hosted-" if args.hosted else "offline-") / stamp).resolve()
    if not output.is_relative_to(OUTPUT_ROOT.resolve()):
        raise ValueError("Browser evidence must remain under /tmp/arboretum-admin-browser-review/tester-return")
    output.mkdir(parents=True, exist_ok=False)
    runtime_modules = os.environ.get("CODEX_PRIMARY_RUNTIME_NODE_MODULES", "/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules")
    config = {"root": str(ROOT), "dist": str(args.dist.resolve()), "output": str(output),
              "hosted": args.hosted, "baselineRef": args.baseline_ref,
              "playwright": os.environ.get("ARBORETUM_PLAYWRIGHT_MODULE", str(Path(runtime_modules) / "playwright")),
              "chromium": os.environ.get("ARBORETUM_REVIEW_CHROMIUM", "/tmp/arboretum-admin-browser-review/browsers/chrome-headless-shell-linux64/chrome-headless-shell")}
    runner = output / "native-return-runner.mjs"
    runner.write_text(RUNNER)
    node = os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node")
    if not node:
        raise RuntimeError("Node is required to use runtime-owned Playwright")
    # The hosted code travels only through pipes, never a shell argument,
    # environment variable, generated script, output file, or screenshot text.
    supplied_code = sys.stdin.read() if args.hosted else ""
    result = subprocess.run([node, str(runner)], input=supplied_code, text=True, cwd=ROOT,
                            env={**os.environ, "ARBORETUM_TESTER_RETURN_CONFIG": json.dumps(config)}, check=False)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
