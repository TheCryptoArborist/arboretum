import test from 'node:test';
import assert from 'node:assert/strict';
import gate from '../netlify/edge-functions/tester-gate.ts';
const origin = 'https://arboretum-preview.example';
const password = 'test-only-password-' + 'p'.repeat(40);
const env = {ARBORETUM_TESTER_PASSWORD:password, ARBORETUM_SESSION_SECRET:'test-only-secret-'+'s'.repeat(80)};
globalThis.Netlify = {env:{get:key=>env[key]}};
const context = {next:async()=>new Response('PRIVATE ORIGIN CONTENT')};
const req = (path, init={}) => new Request(origin+path, init);
for (const path of ['/tester-access','/tester-access/','/tester-access.html']) {
  for (const method of ['GET','HEAD']) test('native form origin retained '+method+' '+path,async()=>{
    const r=await gate(req(path,{method}),context);
    assert.equal(r.status,200);
    assert.equal(r.headers.get('referrer-policy'),'same-origin');
    assert.match(r.headers.get('content-security-policy'),/form-action 'self'/);
  });
}
test('incorrect-code retry preserves native form origin',async()=>{
  const r=await gate(req('/tester-access',{method:'POST',headers:{origin,'Content-Type':'application/x-www-form-urlencoded'},body:'password=wrong'}),context);
  assert.equal(r.status,401);assert.equal(r.headers.get('referrer-policy'),'same-origin');
});
test('null origin still rejected, not trusted as workaround',async()=>{
  const r=await gate(req('/tester-access',{method:'POST',headers:{origin:'null','Content-Type':'application/x-www-form-urlencoded','sec-fetch-site':'same-origin'},body:new URLSearchParams({password})}),context);
  assert.equal(r.status,403);assert.equal(r.headers.get('set-cookie'),null);
});
test('cross-site metadata rejects forged same-origin login',async()=>{
  const r=await gate(req('/tester-access',{method:'POST',headers:{origin,'Content-Type':'application/x-www-form-urlencoded','sec-fetch-site':'cross-site'},body:new URLSearchParams({password})}),context);
  assert.equal(r.status,403);assert.equal(r.headers.get('set-cookie'),null);
});
test('ordinary protected response retains no-referrer privacy',async()=>{
  const r=await gate(req('/game.html'),context);
  assert.equal(r.status,401);assert.equal(r.headers.get('referrer-policy'),'no-referrer');
});
