import test from 'node:test';
import assert from 'node:assert/strict';
import { createReader, objectData } from './reader.mjs';

// All responses are local fixtures. This suite never contacts an endpoint.
const address = n => '0x' + BigInt(n).toString(16).padStart(64, '0');
const OWNER = address(1), REGISTRY = address(2), TYPE = address(3) + '::settlement::Seed';
const EVENT_TYPE = address(3) + '::settlement::RewardEntitlementProcessed';
const CP = 831;
const page = (nodes, hasNextPage = false, endCursor = null) => ({ nodes, pageInfo: { hasNextPage, endCursor } });
const snapshot = (query, sequenceNumber = CP) => ({ data: { checkpoint: { sequenceNumber, query } } });
const node = (id, changes = {}) => ({
  address: address(id), version: 12, digest: 'fixture-object-digest-' + id,
  contents: { type: { repr: TYPE }, json: { id: address(id), version: '1' } }, ...changes,
});
const event = (sequenceNumber = 0, changes = {}) => ({
  sequenceNumber, timestamp: '2026-10-20T00:00:00.000Z', sender: { address: OWNER },
  transaction: { digest: 'fixture-transaction-digest' },
  contents: { type: { repr: EVENT_TYPE }, json: { owner: OWNER, amount_mist: '5' } }, ...changes,
});

function harness(responses) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, options, body });
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.match(body.query, /^query /);
    assert.doesNotMatch(body.query, /\bmutation\b|executeTransaction|simulateTransaction|suix_/);
    const response = typeof responses === 'function'
      ? await responses(body, calls.length)
      : responses[calls.length - 1];
    assert.notEqual(response, undefined, 'The reader requested an unexpected extra fixture page');
    if (response instanceof Error) throw response;
    if (response.httpError) return { ok: false, status: response.httpError, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => structuredClone(response) };
  };
  return { calls, reader: createReader({ fetchImpl, endpoint: 'https://fixture.invalid/graphql' }) };
}

test('owned inventory pins every page to the first verified checkpoint', async () => {
  const h = harness([
    snapshot({ address: { objects: page([node(10), node(11)], true, 'next-owned') } }),
    snapshot({ address: { objects: page([node(12)]) } }),
  ]);
  const objects = await h.reader.owned(OWNER, TYPE);
  assert.deepEqual(objects.map(value => value.objectId), [address(10), address(11), address(12)]);
  assert.deepEqual(h.calls.map(call => call.body.variables), [
    { owner: OWNER, type: TYPE, cp: null, after: null },
    { owner: OWNER, type: TYPE, cp: CP, after: 'next-owned' },
  ]);
  assert.equal(objects[0].content.type, TYPE);
  assert.equal(objects[0].version, '12');
  assert.equal(h.calls[0].url, 'https://fixture.invalid/graphql');
});

test('all-object inventory uses the caller checkpoint from its first page', async () => {
  const h = harness([
    snapshot({ objects: page([node(10)], true, 'next-all') }, 99),
    snapshot({ objects: page([node(11)]) }, 99),
  ]);
  assert.equal((await h.reader.all(TYPE, 10, 99)).length, 2);
  assert.deepEqual(h.calls.map(call => call.body.variables), [
    { type: TYPE, cp: 99, after: null }, { type: TYPE, cp: 99, after: 'next-all' },
  ]);
});

test('event pages preserve exact transaction/event identity at one checkpoint', async () => {
  const h = harness([
    snapshot({ events: page([event(0)], true, 'next-events') }),
    snapshot({ events: page([event(1)]) }),
  ]);
  const events = await h.reader.events(EVENT_TYPE);
  assert.deepEqual(events.map(value => value.id), ['fixture-transaction-digest:0', 'fixture-transaction-digest:1']);
  assert.equal(events[0].parsedJson.amount_mist, '5');
  assert.equal(events[1].type, EVENT_TYPE);
  assert.deepEqual(h.calls.map(call => call.body.variables.cp), [null, CP]);
  assert.equal(h.calls[1].body.variables.after, 'next-events');
});

test('a checkpoint change during pagination rejects the complete result', async () => {
  const h = harness([
    snapshot({ objects: page([node(10)], true, 'page-two') }),
    snapshot({ objects: page([node(11)]) }, CP + 1),
  ]);
  await assert.rejects(h.reader.all(TYPE), /different checkpoint/);
  assert.equal(h.calls.length, 2);
});

test('a page read failure never returns objects already collected from earlier pages', async () => {
  const failure = new Error('fixture connection interrupted');
  const h = harness([
    snapshot({ objects: page([node(10)], true, 'page-two') }), failure,
  ]);
  await assert.rejects(h.reader.all(TYPE), error => error === failure);
  assert.equal(h.calls.length, 2);
});

for (const [name, response] of [
  ['HTTP failure', { httpError: 503 }],
  ['GraphQL error with partial data', { ...snapshot({ objects: page([node(10)]) }), errors: [{ message: 'incomplete fixture result' }] }],
  ['missing data', {}],
  ['null data', { data: null }],
]) test(name + ' is an error, not an empty inventory', async () => {
  const h = harness([response]);
  await assert.rejects(h.reader.all(TYPE));
  assert.equal(h.calls.length, 1);
});

for (const [name, scope] of [
  ['missing checkpoint', undefined],
  ['negative checkpoint', { sequenceNumber: -1, query: { objects: page([]) } }],
  ['unsafe checkpoint', { sequenceNumber: Number.MAX_SAFE_INTEGER + 1, query: { objects: page([]) } }],
  ['string checkpoint', { sequenceNumber: String(CP), query: { objects: page([]) } }],
  ['missing checkpoint query', { sequenceNumber: CP }],
]) test(name + ' cannot authenticate an inventory snapshot', async () => {
  const h = harness([{ data: { checkpoint: scope } }]);
  await assert.rejects(h.reader.all(TYPE), /checkpoint/i);
});

for (const [name, connection] of [
  ['missing connection', undefined],
  ['missing nodes', { pageInfo: { hasNextPage: false } }],
  ['missing page info', { nodes: [] }],
  ['non-boolean continuation', { nodes: [], pageInfo: { hasNextPage: 'false' } }],
  ['missing continuing cursor', page([node(10)], true)],
  ['empty continuing cursor', page([node(10)], true, '')],
]) test(name + ' rejects an incomplete inventory', async () => {
  const h = harness([snapshot({ objects: connection })]);
  await assert.rejects(h.reader.all(TYPE), /incomplete|pagination/i);
});

test('a repeated continuing cursor is rejected before another page request', async () => {
  const h = harness([
    snapshot({ objects: page([node(10)], true, 'same-cursor') }),
    snapshot({ objects: page([node(11)], true, 'same-cursor') }),
  ]);
  await assert.rejects(h.reader.all(TYPE), /pagination did not advance/);
  assert.equal(h.calls.length, 2);
});

test('duplicate object IDs across pages invalidate the entire inventory', async () => {
  const h = harness([
    snapshot({ objects: page([node(10)], true, 'page-two') }),
    snapshot({ objects: page([node(10)]) }),
  ]);
  await assert.rejects(h.reader.all(TYPE), /Duplicate/);
});

test('equivalent padded, short, and uppercase object IDs are duplicate identities', async () => {
  const h = harness([
    snapshot({ objects: page([node(10)], true, 'page-two') }),
    snapshot({ objects: page([node(10, { address: '0xA' })]) }),
  ]);
  await assert.rejects(h.reader.all(TYPE), /Duplicate/);
});

test('duplicate event identities do not become a doubled reward total', async () => {
  const h = harness([
    snapshot({ events: page([event(0)], true, 'page-two') }),
    snapshot({ events: page([event(0)]) }),
  ]);
  await assert.rejects(h.reader.events(EVENT_TYPE), /Duplicate/);
});

test('reaching the view limit with unread pages returns no partial total', async () => {
  const h = harness([snapshot({ objects: page([node(10), node(11)], true, 'page-two') })]);
  await assert.rejects(h.reader.all(TYPE, 2), /No partial totals/);
  assert.equal(h.calls.length, 1);
});

test('an oversized response is rejected even when it claims to be the last page', async () => {
  const h = harness([snapshot({ objects: page([node(10), node(11), node(12)]) })]);
  await assert.rejects(h.reader.all(TYPE, 2), /No partial totals/);
});

test('a complete inventory exactly at the limit is permitted', async () => {
  const h = harness([snapshot({ objects: page([node(10), node(11)]) })]);
  assert.equal((await h.reader.all(TYPE, 2)).length, 2);
});

test('an explicitly absent object is distinct from a missing response field', async () => {
  assert.equal(await harness([snapshot({ object: null })]).reader.object(address(10)), null);
  await assert.rejects(harness([snapshot({})]).reader.object(address(10)), /incomplete|missing/i);
});

test('object reads validate identity and any requested checkpoint', async () => {
  const h = harness([snapshot({ object: node(10) })]);
  assert.equal((await h.reader.object('0xA', CP)).objectId, address(10));
  assert.equal(h.calls[0].body.variables.cp, CP);
  await assert.rejects(harness([snapshot({ object: node(11) })]).reader.object(address(10)), /different object/);
  await assert.rejects(harness([snapshot({ object: node(10) }, CP + 1)]).reader.object(address(10), CP), /different checkpoint/);
});

for (const [name, override] of [
  ['missing address', { address: undefined }],
  ['invalid address', { address: 'not-an-object-id' }],
  ['missing version', { version: undefined }],
  ['unsafe object version', { version: Number.MAX_SAFE_INTEGER + 1 }],
  ['negative object version', { version: -1 }],
  ['missing digest', { digest: undefined }],
  ['empty digest', { digest: '' }],
  ['missing type', { contents: { json: {} } }],
  ['missing fields', { contents: { type: { repr: TYPE } } }],
  ['non-object fields', { contents: { type: { repr: TYPE }, json: 'corrupt' } }],
]) test(name + ' cannot become a usable Move object', () => {
  assert.throws(() => objectData(node(10, override)), /incomplete|invalid/i);
});

test('both GraphQL Move-object layouts retain complete fields', () => {
  const source = node(10);
  const wrapped = { ...source, contents: undefined, asMoveObject: { contents: source.contents } };
  assert.deepEqual(objectData(wrapped), objectData(source));
  assert.equal(objectData({ ...source, version: '18446744073709551615' }).version, '18446744073709551615');
});

test('a Move UID must agree with the outer object address, including nested wrappers', () => {
  const source = node(10);
  for (const uid of [address(10), { id: address(10) }, { fields: { id: '0xA' } }]) {
    const wrapped = { ...source, contents: { ...source.contents, json: { id: uid, version: '1' } } };
    assert.equal(objectData(wrapped).objectId, address(10));
  }
  for (const uid of [address(11), 'invalid', { fields: {} }]) {
    const corrupt = { ...source, contents: { ...source.contents, json: { id: uid, version: '1' } } };
    assert.throws(() => objectData(corrupt), /UID/);
  }
});

test('overflowing object versions, array fields, and whitespace digests are invalid', () => {
  for (const changes of [
    { version: '18446744073709551616' }, { digest: '  ' },
    { contents: { type: { repr: TYPE }, json: [] } },
  ]) assert.throws(() => objectData(node(10, changes)), /invalid|incomplete/i);
});

test('a null item inside a successful page is an incomplete response', async () => {
  const h = harness([snapshot({ objects: page([node(10), null]) })]);
  await assert.rejects(h.reader.all(TYPE), /incomplete|invalid/i);
});

test('Registry and Clock are fetched together at the selected checkpoint', async () => {
  const h = harness([snapshot({
    registry: node(2), clock: { asMoveObject: { contents: { json: { timestamp_ms: '1730000000000' } } } },
  })]);
  const state = await h.reader.state(REGISTRY, CP);
  assert.equal(state.registry.objectId, REGISTRY);
  assert.equal(state.nowMs, 1730000000000);
  assert.equal(state.checkpoint, CP);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].body.variables, { registry: REGISTRY, cp: CP });
  assert.match(h.calls[0].body.query, /registry:object/);
  assert.match(h.calls[0].body.query, /clock:object\(address:"0x6"\)/);
});

for (const raw of [undefined, null, '-1', '1.5', 'NaN', -1, Number.MAX_SAFE_INTEGER + 1, '18446744073709551615']) {
  test('invalid chain Clock ' + String(raw) + ' cannot establish claim timing', async () => {
    const h = harness([snapshot({
      registry: node(2), clock: { asMoveObject: { contents: { json: { timestamp_ms: raw } } } },
    })]);
    await assert.rejects(h.reader.state(REGISTRY), /clock/i);
  });
}

test('a state snapshot for a different Registry is rejected', async () => {
  const h = harness([snapshot({
    registry: node(99), clock: { asMoveObject: { contents: { json: { timestamp_ms: '1730000000000' } } } },
  })]);
  await assert.rejects(h.reader.state(REGISTRY), /selected garden/);
});

for (const [name, changes] of [
  ['missing event transaction', { transaction: null }],
  ['missing event ordinal', { sequenceNumber: undefined }],
  ['negative event ordinal', { sequenceNumber: -1 }],
  ['missing event type', { contents: { json: {} } }],
  ['missing event fields', { contents: { type: { repr: EVENT_TYPE } } }],
]) test(name + ' rejects an incomplete receipt history', async () => {
  const h = harness([snapshot({ events: page([event(0, changes)]) })]);
  await assert.rejects(h.reader.events(EVENT_TYPE), /incomplete|invalid/i);
});

test('invalid wallet and object IDs fail before any query', async () => {
  const h = harness([]);
  await assert.rejects(h.reader.owned('invalid-wallet', TYPE), /Invalid wallet/);
  await assert.rejects(h.reader.object('invalid-object'), /Invalid Sui object/);
  assert.equal(h.calls.length, 0);
});

test('invalid requested checkpoints fail before reads across every snapshot method', async () => {
  const h = harness([]);
  for (const cp of [-1, '831', 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(h.reader.object(REGISTRY, cp), /checkpoint/i);
    await assert.rejects(h.reader.state(REGISTRY, cp), /checkpoint/i);
    await assert.rejects(h.reader.owned(OWNER, TYPE, cp), /checkpoint/i);
    await assert.rejects(h.reader.all(TYPE, 10, cp), /checkpoint/i);
    await assert.rejects(h.reader.events(EVENT_TYPE, 10, cp), /checkpoint/i);
  }
  assert.equal(h.calls.length, 0);
});

test('invalid inventory limits cannot trigger an unbounded or partial read', async () => {
  const h = harness([]);
  for (const maximum of [0, -1, 1.5, Infinity]) {
    await assert.rejects(h.reader.all(TYPE, maximum), /limit/i);
    await assert.rejects(h.reader.events(EVENT_TYPE, maximum), /limit/i);
  }
  assert.equal(h.calls.length, 0);
});

test('non-object event fields cannot establish a receipt history', async () => {
  for (const json of [null, [], 'corrupt']) {
    const h = harness([snapshot({ events: page([event(0, { contents: { type: { repr: EVENT_TYPE }, json } })]) })]);
    await assert.rejects(h.reader.events(EVENT_TYPE), /incomplete|invalid/i);
  }
});
