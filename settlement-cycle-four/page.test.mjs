import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EXPECTED } from './common.mjs';
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');

test('Season 4 title, progress, network label and footer agree',()=>{
  for(const text of ['<title>Season 4 watering test | Arboretum</title>', 'SUI MAINNET · SEASON 4 · OWNER TEST', 'aria-label="Season 4 progress"', 'ARBORETUM · SEASON 4 WATERING TEST']) assert.ok(html.includes(text),text);
  assert.ok(!html.includes('SEASON 3'));
});
test('previous-season navigation and payment refer to the actual Season 3',()=>{
  assert.ok(html.includes('href="/admin/season-three/">Season 3 receipts'));
  assert.ok(html.includes('href="https://suivision.xyz/txblock/'+EXPECTED.previousClaimDigest+'"'));
  assert.ok(html.includes('View your completed Season 3 payment'));
  assert.ok(!html.includes('/admin/season-two/'));
  assert.ok(!html.includes('EvJHfMtHpGNcGoKndFNTafx9JSn8rKHwTPwiXuKD4pCB'));
});
test('only the new page asset URLs are used and every HTML id is unique',()=>{
  assert.ok(html.includes('href="/admin/season-four/admin.css"'));
  assert.ok(html.includes('src="/admin/season-four/admin.mjs"'));
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
  assert.equal(ids.length,new Set(ids).size);
  for(const match of html.matchAll(/href="#([^"]+)"/g))assert.ok(ids.includes(match[1]));
});
test('wallet actions start disabled and the page remains noindex',()=>{
  for(const id of ['check-action','submit-action','use-account','watering-calendar']){
    assert.match(html,new RegExp('<button\\b[^>]*\\bid="'+id+'"[^>]*\\bdisabled(?:[ >])'));
  }
  assert.ok(html.includes('content="noindex,nofollow,noarchive"'));
  assert.ok(html.includes('A readiness check requests no signature and costs no gas.'));
});
test('calendar copy states both reminders and does not promise phone delivery',()=>{
  assert.ok(html.includes('Add watering and backup reminders'));
  assert.ok(html.includes('save both calendar events'));
  assert.ok(html.includes('backup 15 minutes later'));
  assert.ok(html.includes('Enable calendar notifications on your phone.'));
  assert.ok(!html.includes('Download the event, then import it into your calendar.'));
});

test('runtime countdown label names Season 4 rather than its predecessor',()=>{
  const source=fs.readFileSync(new URL('./admin.mjs',import.meta.url),'utf8');
  assert.ok(source.includes("el['countdown-label'].textContent = 'SEASON 4 START'"));
  assert.ok(!source.includes('SEASON 3 START'));
});
