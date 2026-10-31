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
