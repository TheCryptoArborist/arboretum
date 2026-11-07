// Current GraphQL reads, with checkpoint-pinned pagination and no signing path.
const ENDPOINT = 'https://graphql.mainnet.sui.io/graphql';
const ADDRESS = /^0x[0-9a-fA-F]{1,64}$/;
const U64_MAX = (1n << 64n) - 1n;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const canonicalAddress = value => typeof value === 'string' && ADDRESS.test(value)
  ? '0x' + value.slice(2).toLowerCase().padStart(64, '0') : null;
const same = (a, b) => canonicalAddress(a) !== null && canonicalAddress(a) === canonicalAddress(b);

function uidAddress(value) {
  // GraphQL normally returns the UID as a string; accept the standard Move wrappers too.
  for (let n = 0; n < 5 && record(value); n++) value = value.fields ?? value.id;
  return canonicalAddress(value);
}

function objectVersion(value) {
  if (!(typeof value === 'string' && /^[0-9]+$/.test(value))
      && !(Number.isSafeInteger(value) && value >= 0)) {
    throw new Error('The Sui object version is invalid or incomplete.');
  }
  const version = BigInt(value);
  if (version > U64_MAX) throw new Error('The Sui object version is invalid.');
  return version.toString();
}

function requestedCheckpoint(cp) {
  if (cp !== null && (!Number.isSafeInteger(cp) || cp < 0)) {
    throw new Error('Invalid Sui checkpoint.');
  }
}

export function objectData(node) {
  if (node === null) return null;
  if (!record(node)) throw new Error('The Sui object response is incomplete.');
  const contents = node.contents ?? node.asMoveObject?.contents;
  if (!text(contents?.type?.repr) || !record(contents?.json)
      || !canonicalAddress(node.address) || !text(node.digest)) {
    throw new Error('The Sui object response is incomplete.');
  }
  if (Object.hasOwn(contents.json, 'id') && uidAddress(contents.json.id) !== canonicalAddress(node.address)) {
    throw new Error('The Sui object UID is invalid or does not match its address.');
  }
  return {
    objectId: node.address, version: objectVersion(node.version), digest: node.digest,
    type: contents.type.repr, owner: node.owner,
    content: { dataType: 'moveObject', type: contents.type.repr, fields: contents.json },
    display: { data: {} },
  };
}

export function createReader({ fetchImpl = (...args) => fetch(...args), endpoint = ENDPOINT } = {}) {
  async function query(source, variables = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'omit', cache: 'no-store', signal: controller.signal,
        body: JSON.stringify({ query: source, variables }),
      });
      if (!response.ok) throw new Error('Sui data request failed (' + response.status + ').');
      const result = await response.json();
      if (!record(result)) throw new Error('Sui data response is missing.');
      if (result.errors?.length) throw new Error(result.errors.map(e => e.message).join('; '));
      if (!record(result?.data)) throw new Error('Sui data response is missing.');
      return result.data;
    } finally { clearTimeout(timeout); }
  }

  function checkpoint(data, expected) {
    const scope = data.checkpoint;
    if (!Number.isSafeInteger(scope?.sequenceNumber) || scope.sequenceNumber < 0 || !record(scope.query)) {
      throw new Error('The Sui checkpoint could not be verified.');
    }
    if (expected != null && scope.sequenceNumber !== expected) {
      throw new Error('Sui data belongs to a different checkpoint.');
    }
    return scope;
  }

  async function object(id, cp = null) {
    if (!canonicalAddress(id)) throw new Error('Invalid Sui object ID.');
    requestedCheckpoint(cp);
    const data = await query(
      'query IntegrationObject($id:SuiAddress!,$cp:UInt53){checkpoint(sequenceNumber:$cp){sequenceNumber query{' +
      'object(address:$id){address version digest owner{__typename ... on AddressOwner{address{address}}}' +
      'asMoveObject{contents{type{repr} json}}}}}}', { id, cp });
    const scope = checkpoint(data, cp);
    if (!Object.hasOwn(scope.query, 'object') || scope.query.object === undefined) {
      throw new Error('The Sui object response is incomplete.');
    }
    const value = scope.query.object;
    if (value && !same(value.address, id)) throw new Error('Sui returned a different object.');
    return objectData(value);
  }

  async function pageThrough(source, variables, select, convert, maxItems = 10000) {
    const out = [], cursors = new Set(), identities = new Set();
    let after = null, cp = variables.cp ?? null;
    requestedCheckpoint(cp);
    if (!Number.isSafeInteger(maxItems) || maxItems < 1) throw new Error('Invalid Sui inventory limit.');
    do {
      const scope = checkpoint(await query(source, { ...variables, cp, after }), cp);
      cp = scope.sequenceNumber;
      const page = select(scope.query);
      if (!Array.isArray(page?.nodes) || typeof page.pageInfo?.hasNextPage !== 'boolean') {
        throw new Error('Sui inventory pagination is incomplete.');
      }
      for (const node of page.nodes) {
        const value = convert(node);
        if (!record(value)) throw new Error('The Sui inventory item is incomplete.');
        const identity = value.objectId != null ? canonicalAddress(value.objectId) : value.id;
        if (!text(identity)) throw new Error('The Sui inventory identity is incomplete.');
        if (identities.has(identity)) throw new Error('Duplicate item in a Sui snapshot.');
        identities.add(identity);
        out.push(value);
      }
      if (out.length > maxItems || (out.length === maxItems && page.pageInfo.hasNextPage)) {
        throw new Error('The complete Sui inventory exceeds this view. No partial totals were used.');
      }
      if (!page.pageInfo.hasNextPage) return out;
      const next = page.pageInfo.endCursor;
      if (typeof next !== 'string' || !next || cursors.has(next)) {
        throw new Error('Sui pagination did not advance.');
      }
      cursors.add(next); after = next;
    } while (after);
    return out;
  }

  async function owned(owner, type, cp = null) {
    if (!canonicalAddress(owner)) throw new Error('Invalid wallet address.');
    return pageThrough(
      'query IntegrationOwned($owner:SuiAddress!,$type:String!,$cp:UInt53,$after:String){' +
      'checkpoint(sequenceNumber:$cp){sequenceNumber query{address(address:$owner){' +
      'objects(first:50,after:$after,filter:{type:$type}){nodes{address version digest contents{type{repr} json}}' +
      'pageInfo{hasNextPage endCursor}}}}}}',
      { owner, type, cp }, q => q.address?.objects, objectData);
  }

  async function all(type, maxItems = 10000, cp = null) {
    return pageThrough(
      'query IntegrationAll($type:String!,$cp:UInt53,$after:String){checkpoint(sequenceNumber:$cp){sequenceNumber query{' +
      'objects(first:50,after:$after,filter:{type:$type}){nodes{address version digest ' +
      'asMoveObject{contents{type{repr} json}}}pageInfo{hasNextPage endCursor}}}}}',
      { type, cp }, q => q.objects, objectData, maxItems);
  }

  async function state(registryId, cp = null) {
    if (!canonicalAddress(registryId)) throw new Error('Invalid Sui object ID.');
    requestedCheckpoint(cp);
    const data = await query(
      'query IntegrationState($registry:SuiAddress!,$cp:UInt53){checkpoint(sequenceNumber:$cp){sequenceNumber query{' +
      'registry:object(address:$registry){address version digest asMoveObject{contents{type{repr} json}}}' +
      'clock:object(address:"0x6"){asMoveObject{contents{json}}}}}}', { registry: registryId, cp });
    const scope = checkpoint(data, cp);
    const registry = objectData(scope.query.registry);
    if (!registry || !same(registry.objectId, registryId)) throw new Error('The selected garden could not be verified.');
    const raw = scope.query.clock?.asMoveObject?.contents?.json?.timestamp_ms;
    if (!(typeof raw === 'string' && /^[0-9]+$/.test(raw)) && !(Number.isSafeInteger(raw) && raw >= 0)) {
      throw new Error('The Sui clock could not be verified.');
    }
    const nowMs = Number(raw);
    if (!Number.isSafeInteger(nowMs)) throw new Error('Invalid Sui clock.');
    return { checkpoint: scope.sequenceNumber, registry, nowMs };
  }

  async function events(type, maxItems = 10000, cp = null) {
    return pageThrough(
      'query IntegrationEvents($type:String!,$cp:UInt53,$after:String){checkpoint(sequenceNumber:$cp){sequenceNumber query{' +
      'events(first:50,after:$after,filter:{type:$type}){nodes{sequenceNumber timestamp sender{address} ' +
      'transaction{digest} contents{type{repr} json}}pageInfo{hasNextPage endCursor}}}}}',
      { type, cp }, q => q.events, node => {
        if (!record(node) || !text(node.transaction?.digest)
            || !Number.isSafeInteger(node.sequenceNumber) || node.sequenceNumber < 0
            || !text(node.contents?.type?.repr) || !record(node.contents?.json)) {
          throw new Error('Sui event identity or fields are incomplete.');
        }
        return {
          id: node.transaction.digest + ':' + node.sequenceNumber,
          digest: node.transaction.digest, sequenceNumber: node.sequenceNumber,
          timestamp: node.timestamp, sender: node.sender?.address,
          type: node.contents.type.repr, parsedJson: node.contents.json,
        };
      }, maxItems);
  }

  return Object.freeze({ query, object, owned, all, state, events });
}

