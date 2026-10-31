import test from 'node:test';
import assert from 'node:assert/strict';
import gate from '../netlify/edge-functions/tester-gate.ts';

const origin = 'https://www.treegrow.xyz';
const adminPath = '/admin/settlement-upgrade/';
const entrance = '/tester-access?next=settlement-upgrade';
const password = 'fixture-only-return-password-' + 'p'.repeat(40);
const env = {
  ARBORETUM_TESTER_PASSWORD: password,
  ARBORETUM_SESSION_SECRET: 'fixture-only-return-secret-' + 's'.repeat(80),
};
globalThis.Netlify = { env: { get: key => env[key] } };
let originCalls = 0;
const context = { next: async () => {
  originCalls += 1;
  return new Response('PROTECTED CONTENT', { headers: { ETag: '"unchanged"' } });
} };
const request = (path, init = {}) => new Request(origin + path, init);
const navigate = path => request(path, { headers: { Accept: 'text/html', 'Sec-Fetch-Site': 'cross-site' } });
const post = (values, path = '/tester-access', headers = {}) => request(path, {
  method: 'POST', headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin',
    'Content-Type': 'application/x-www-form-urlencoded', ...headers },
  body: new URLSearchParams(values),
});
const hiddenMarker = /<input type="hidden" name="next" value="settlement-upgrade">/;

test('external entry to the three fixed upgrade-page variants retains only the opaque destination', async () => {
  for (const path of ['/admin/settlement-upgrade', adminPath, adminPath + 'index.html']) {
    const before = originCalls;
    const response = await gate(navigate(path + '?next=https://attacker.example/anything'), context);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), origin + entrance);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(originCalls, before);
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
});

test('the login form carries the fixed marker without client JavaScript', async () => {
  const response = await gate(request(entrance), context);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, hiddenMarker);
  assert.match(html, /Continue to upgrade review/);
  assert.match(html, /<form method="post" action="\/tester-access"/);
  assert.doesNotMatch(html, /<script/i);
  assert.equal(response.headers.get('referrer-policy'), 'same-origin');
  assert.match(response.headers.get('content-security-policy'), /form-action 'self'/);
});

test('wrong-password retry preserves the fixed destination and creates no session', async () => {
  const response = await gate(post({ password: 'wrong', next: 'settlement-upgrade' }), context);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('location'), null);
  const html = await response.text();
  assert.match(html, hiddenMarker);
  assert.match(html, /Continue to upgrade review/);
  assert.equal(response.headers.get('referrer-policy'), 'same-origin');
});

test('successful marked login returns to the upgrade with the same strict session policy', async () => {
  const response = await gate(post({ password, next: 'settlement-upgrade' }), context);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), origin + adminPath);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /^__Host-arboretum_tester=/);
  assert.match(cookie, /; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200$/);
  assert.doesNotMatch(cookie, /Domain=/);
  assert.doesNotMatch(cookie, new RegExp(password));
  const result = await gate(request(adminPath, { headers: { Cookie: cookie.split(';')[0] } }), context);
  assert.equal(result.status, 200);
  assert.equal(await result.text(), 'PROTECTED CONTENT');
  assert.match(result.headers.get('cache-control'), /no-store/);
  assert.equal(result.headers.get('etag'), null);
});

test('ordinary tester entry and login retain the garden destination', async () => {
  const page = await gate(request('/tester-access'), context);
  const html = await page.text();
  assert.doesNotMatch(html, /name="next"/);
  assert.match(html, /Enter the testing garden/);
  const response = await gate(post({ password }), context);
  assert.equal(response.headers.get('location'), origin + '/game.html');
  const fromGame = await gate(navigate('/game.html?next=settlement-upgrade'), context);
  assert.equal(fromGame.headers.get('location'), origin + '/tester-access');
});

test('unknown, URL-shaped, encoded and duplicate return markers cannot redirect or be reflected', async () => {
  const invalidValues = [
    'https://attacker.example/redirect', '//attacker.example', '/admin/settlement-upgrade/',
    'javascript:alert(1)', 'settlement-upgrade/anything', ' settlement-upgrade',
    '%73ettlement-upgrade', '"><script>alert(1)</script>',
  ];
  for (const next of invalidValues) {
    const page = await gate(request('/tester-access?' + new URLSearchParams({ next })), context);
    const html = await page.text();
    assert.doesNotMatch(html, /name="next"/);
    assert.ok(!html.includes(next), 'Unrecognized return text must never enter the page');
    const success = await gate(post({ password, next }), context);
    assert.equal(success.headers.get('location'), origin + '/game.html');
    const rejected = await gate(post({ password: 'wrong', next }), context);
    assert.doesNotMatch(await rejected.text(), /name="next"/);
  }
  for (const values of [
    [['next', 'settlement-upgrade'], ['next', 'settlement-upgrade']],
    [['next', 'settlement-upgrade'], ['next', 'https://attacker.example']],
  ]) {
    const page = await gate(request('/tester-access?' + new URLSearchParams(values)), context);
    assert.doesNotMatch(await page.text(), /name="next"/);
    const response = await gate(post([['password', password], ...values]), context);
    assert.equal(response.headers.get('location'), origin + '/game.html');
  }
});

test('POST uses the form marker rather than a query-string override', async () => {
  const response = await gate(post({ password }, entrance), context);
  assert.equal(response.headers.get('location'), origin + '/game.html');
  const marked = await gate(post({ password, next: 'settlement-upgrade' }, '/tester-access?next=https://attacker.example'), context);
  assert.equal(marked.headers.get('location'), origin + adminPath);
});

test('upgrade assets remain protected without receiving a return destination', async () => {
  for (const path of [adminPath + 'admin.mjs', adminPath + 'admin.css', adminPath + 'upgrade-kind.b64']) {
    const before = originCalls;
    const response = await gate(request(path), context);
    assert.equal(response.status, 401);
    assert.equal(originCalls, before);
    assert.equal(response.headers.get('set-cookie'), null);
    const asDocument = await gate(navigate(path), context);
    assert.equal(asDocument.headers.get('location'), origin + '/tester-access');
  }
});

test('the return marker does not weaken origin checks or authenticate a request', async () => {
  for (const headers of [{ Origin: 'null' }, { Origin: 'https://attacker.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const response = await gate(post({ password, next: 'settlement-upgrade' }, '/tester-access', headers), context);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  const response = await gate(request(adminPath + '?next=settlement-upgrade'), context);
  assert.equal(response.status, 401);
});

test('HEAD login preserves headers and has no body', async () => {
  const response = await gate(request(entrance, { method: 'HEAD' }), context);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
  assert.equal(response.headers.get('referrer-policy'), 'same-origin');
});

test('new-season document variants retain their fixed read-only destination', async () => {
  for (const path of ['/settlement-game', '/settlement-game/', '/settlement-game.html']) {
    const before = originCalls;
    const response = await gate(navigate(path + '?next=settlement-upgrade'), context);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), origin + '/tester-access?next=new-seasons');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(originCalls, before);
  }
});

test('new-season native login and incorrect-code retry preserve intent and the Strict session', async () => {
  const marker = /<input type="hidden" name="next" value="new-seasons">/;
  const page = await gate(request('/tester-access?next=new-seasons'), context);
  const html = await page.text();
  assert.match(html, marker);
  assert.match(html, /Continue to new seasons/);
  assert.doesNotMatch(html, /<script/i);
  assert.equal(page.headers.get('referrer-policy'), 'same-origin');
  const wrong = await gate(post({ password: 'wrong', next: 'new-seasons' }), context);
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get('set-cookie'), null);
  assert.match(await wrong.text(), marker);
  const success = await gate(post({ password, next: 'new-seasons' }, '/tester-access?next=settlement-setup'), context);
  assert.equal(success.status, 303);
  assert.equal(success.headers.get('location'), origin + '/settlement-game.html');
  const cookie = success.headers.get('set-cookie');
  assert.match(cookie, /^__Host-arboretum_tester=/);
  assert.match(cookie, /; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200$/);
  const authenticated = await gate(request('/settlement-game.html', { headers: { Cookie: cookie.split(';')[0] } }), context);
  assert.equal(authenticated.status, 200);
  assert.equal(await authenticated.text(), 'PROTECTED CONTENT');
  assert.match(authenticated.headers.get('cache-control'), /no-store/);
});

test('new-season marker cannot authenticate assets or bypass origin checks', async () => {
  for (const path of ['/settlement-wallet.js', '/settlement-panel.mjs', '/settlement-integration/deployment-config.mjs']) {
    const response = await gate(request(path + '?next=new-seasons'), context);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('set-cookie'), null);
    const asDocument = await gate(navigate(path), context);
    assert.equal(asDocument.headers.get('location'), origin + '/tester-access');
  }
  for (const headers of [{ Origin: 'null' }, { Origin: 'https://attacker.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const response = await gate(post({ password, next: 'new-seasons' }, '/tester-access', headers), context);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('set-cookie'), null);
  }
});

test('duplicate, mixed, malformed or query-only new-season intents fall back to the garden', async () => {
  for (const markers of [
    [['next', 'new-seasons'], ['next', 'new-seasons']],
    [['next', 'new-seasons'], ['next', 'settlement-setup']],
    [['next', 'new-seasons'], ['next', 'https://attacker.example']],
  ]) {
    const page = await gate(request('/tester-access?' + new URLSearchParams(markers)), context);
    assert.doesNotMatch(await page.text(), /name="next"/);
    const response = await gate(post([['password', password], ...markers]), context);
    assert.equal(response.headers.get('location'), origin + '/game.html');
  }
  const queryOnly = await gate(post({ password }, '/tester-access?next=new-seasons'), context);
  assert.equal(queryOnly.headers.get('location'), origin + '/game.html');
  for (const next of ['/settlement-game.html', 'new-seasons/anything', ' new-seasons', '%6eew-seasons']) {
    const page = await gate(request('/tester-access?' + new URLSearchParams({ next })), context);
    assert.doesNotMatch(await page.text(), /name="next"/);
    const response = await gate(post({ password, next }), context);
    assert.equal(response.headers.get('location'), origin + '/game.html');
  }
});

test('setup page navigation preserves the separately approved setup destination', async () => {
  for (const path of ['/admin/settlement-setup', '/admin/settlement-setup/', '/admin/settlement-setup/index.html']) {
    const before = originCalls;
    const response = await gate(navigate(path + '?next=settlement-upgrade'), context);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), origin + '/tester-access?next=settlement-setup');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(originCalls, before);
  }
});

test('native setup login and wrong-code retry retain setup intent and the existing cookie protections', async () => {
  const marker = /<input type="hidden" name="next" value="settlement-setup">/;
  const entry = '/tester-access?next=settlement-setup';
  const page = await gate(request(entry), context);
  assert.match(await page.text(), marker);
  assert.equal(page.headers.get('referrer-policy'), 'same-origin');
  const wrong = await gate(post({ password: 'wrong', next: 'settlement-setup' }), context);
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get('set-cookie'), null);
  const retry = await wrong.text();
  assert.match(retry, marker);
  assert.match(retry, /Continue to setup review/);
  assert.doesNotMatch(retry, /<script/i);
  const success = await gate(post({ password, next: 'settlement-setup' }, '/tester-access?next=settlement-upgrade'), context);
  assert.equal(success.status, 303);
  assert.equal(success.headers.get('location'), origin + '/admin/settlement-setup/');
  const cookie = success.headers.get('set-cookie');
  assert.match(cookie, /^__Host-arboretum_tester=/);
  assert.match(cookie, /; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200$/);
  const authenticated = await gate(request('/admin/settlement-setup/', { headers: { Cookie: cookie.split(';')[0] } }), context);
  assert.equal(authenticated.status, 200);
  assert.equal(await authenticated.text(), 'PROTECTED CONTENT');
  assert.match(authenticated.headers.get('cache-control'), /no-store/);
});

test('setup intent cannot authenticate assets or bypass same-origin POST checks', async () => {
  for (const name of ['admin.mjs', 'admin.css', 'setup-kind.b64']) {
    const response = await gate(request('/admin/settlement-setup/' + name + '?next=settlement-setup'), context);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('set-cookie'), null);
    const asDocument = await gate(navigate('/admin/settlement-setup/' + name), context);
    assert.equal(asDocument.headers.get('location'), origin + '/tester-access');
  }
  for (const headers of [{ Origin: 'null' }, { Origin: 'https://attacker.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const response = await gate(post({ password, next: 'settlement-setup' }, '/tester-access', headers), context);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('set-cookie'), null);
  }
});

test('duplicate or mixed setup intents fail closed to the ordinary garden destination', async () => {
  for (const markers of [
    [['next', 'settlement-setup'], ['next', 'settlement-setup']],
    [['next', 'settlement-setup'], ['next', 'settlement-upgrade']],
    [['next', 'settlement-setup'], ['next', 'https://attacker.example']],
  ]) {
    const page = await gate(request('/tester-access?' + new URLSearchParams(markers)), context);
    assert.doesNotMatch(await page.text(), /name="next"/);
    const response = await gate(post([['password', password], ...markers]), context);
    assert.equal(response.headers.get('location'), origin + '/game.html');
  }
  const queryOnly = await gate(post({ password }, '/tester-access?next=settlement-setup'), context);
  assert.equal(queryOnly.headers.get('location'), origin + '/game.html');
  for (const next of ['/admin/settlement-setup/', 'settlement-setup/anything', ' settlement-setup', '%73ettlement-setup']) {
    const page = await gate(request('/tester-access?' + new URLSearchParams({ next })), context);
    assert.doesNotMatch(await page.text(), /name="next"/);
    const response = await gate(post({ password, next }), context);
    assert.equal(response.headers.get('location'), origin + '/game.html');
  }
});

test('first-test season document variants retain only their fixed owner-review destination', async () => {
  for (const path of ['/admin/season-test', '/admin/season-test/', '/admin/season-test/index.html']) {
    const before = originCalls;
    const response = await gate(navigate(path + '?next=new-seasons'), context);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), origin + '/tester-access?next=season-test');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal(originCalls, before);
  }
  for (const path of ['/admin/season-test-extra', '/admin/season-test/extra', '/admin/season-test/index.html/']) {
    const response = await gate(navigate(path), context);
    assert.equal(response.headers.get('location'), origin + '/tester-access');
  }
});

test('native first-test login and incorrect-code retry preserve intent and the unchanged Strict session', async () => {
  const marker = /<input type="hidden" name="next" value="season-test">/;
  const page = await gate(request('/tester-access?next=season-test'), context);
  const html = await page.text();
  assert.match(html, marker);
  assert.match(html, /Continue to test season review/);
  assert.doesNotMatch(html, /<script/i);
  assert.equal(page.headers.get('referrer-policy'), 'same-origin');
  assert.match(page.headers.get('content-security-policy'), /form-action 'self'/);
  const wrong = await gate(post({ password: 'wrong', next: 'season-test' }), context);
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get('set-cookie'), null);
  assert.equal(wrong.headers.get('location'), null);
  assert.match(await wrong.text(), marker);
  const success = await gate(post({ password, next: 'season-test' }, '/tester-access?next=settlement-setup'), context);
  assert.equal(success.status, 303);
  assert.equal(success.headers.get('location'), origin + '/admin/season-test/');
  const cookie = success.headers.get('set-cookie');
  assert.match(cookie, /^__Host-arboretum_tester=/);
  assert.match(cookie, /; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200$/);
  assert.doesNotMatch(cookie, /Domain=/);
  const authenticated = await gate(request('/admin/season-test/', { headers: { Cookie: cookie.split(';')[0] } }), context);
  assert.equal(authenticated.status, 200);
  assert.equal(await authenticated.text(), 'PROTECTED CONTENT');
  assert.match(authenticated.headers.get('cache-control'), /no-store/);
  assert.match(authenticated.headers.get('x-robots-tag'), /noindex/);
  assert.equal(authenticated.headers.get('etag'), null);
});

test('the first-test marker cannot authorize assets or weaken origin and request checks', async () => {
  for (const name of ['admin.mjs', 'admin.css']) {
    const before = originCalls;
    const response = await gate(request('/admin/season-test/' + name + '?next=season-test'), context);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(originCalls, before);
    const asDocument = await gate(navigate('/admin/season-test/' + name), context);
    assert.equal(asDocument.headers.get('location'), origin + '/tester-access');
  }
  for (const headers of [{ Origin: 'null' }, { Origin: 'https://attacker.example' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }]) {
    const response = await gate(post({ password, next: 'season-test' }, '/tester-access', headers), context);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  const unsigned = await gate(request('/admin/season-test/?next=season-test'), context);
  assert.equal(unsigned.status, 401);
  const head = await gate(request('/tester-access?next=season-test', { method: 'HEAD' }), context);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('referrer-policy'), 'same-origin');
});

test('duplicate, mixed, malformed and query-only first-test intents fall back to the ordinary garden', async () => {
  for (const other of ['season-test', 'settlement-upgrade', 'settlement-setup', 'new-seasons', 'https://attacker.example']) {
    const markers = [['next', 'season-test'], ['next', other]];
    const page = await gate(request('/tester-access?' + new URLSearchParams(markers)), context);
    assert.doesNotMatch(await page.text(), /name="next"/);
    const response = await gate(post([['password', password], ...markers]), context);
    assert.equal(response.headers.get('location'), origin + '/game.html');
    const wrong = await gate(post([['password', 'wrong'], ...markers]), context);
    assert.doesNotMatch(await wrong.text(), /name="next"/);
  }
  const queryOnly = await gate(post({ password }, '/tester-access?next=season-test'), context);
  assert.equal(queryOnly.headers.get('location'), origin + '/game.html');
  for (const next of ['/admin/season-test/', 'season-test/anything', ' season-test', 'season-test ', '%73eason-test', 'Season-Test']) {
    const page = await gate(request('/tester-access?' + new URLSearchParams({ next })), context);
    const html = await page.text();
    assert.doesNotMatch(html, /name="next"/);
    assert.ok(!html.includes(next), 'Unrecognized return text must never enter the page');
    const response = await gate(post({ password, next }), context);
    assert.equal(response.headers.get('location'), origin + '/game.html');
  }
});
