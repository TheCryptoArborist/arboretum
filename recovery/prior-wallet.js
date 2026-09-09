// wallet.js — Arboretum SUI Forest v2
// 5 crate tiers, 20 items, full staking game.
// Uses @mysten/wallet-standard for universal wallet detection.

import { getWallets, SuiClient, Transaction } from './sui-sdk.bundle.js';

// ── CONFIG ────────────────────────────────────────────────────────────────────
const NETWORK = 'mainnet';
const CHAIN   = 'sui:mainnet';
const RPC_URL = 'https://fullnode.mainnet.sui.io:443';
const GRAPHQL_URL = 'https://graphql.mainnet.sui.io/graphql';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — supports daily return visits

export const CONTRACT = {
  PACKAGE_ID: "0x0ad12507d7e2762102cea78aa2fe3b2c2aed96c1e180ee18561233f931f75914",
  TYPE_PACKAGE_ID: "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b",
  TYPE_PACKAGE_IDS: [
    "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b",
    "0xfa7030bc4d8e454482adb1ce3ec07ebc3dbcef85f1288d4a9eeea615be44a992",
  ],
  MODULE: "arboretum",
  REGISTRY_ID: "0x73672fd5f19137185a3933ea884aacad31eb7a9d41dab0494e628f3cb9b82d50",
  ADMIN_CAP_ID: "0x74b2e28a362a148c1a0c0a8da8519966ba19c3cec82148028b3019d30829f3b3",
  CLOCK_ID: "0x6",
  RANDOM_ID: "0x8",
  SUPPORTS_SUPPLY_DROPS: true,
  SUPPORTS_MONTHLY_DURATION_START: true,
  SUPPORTS_ARCHIVED_SEASON_CLAIMS: true,
  SUPPORTS_EARLY_SEASON_ARCHIVE: true,
  SUPPORTS_CANOPY_CHALLENGES: false,
  CHALLENGE_BOOK_ID: "",
  ACTIVE_CANOPY_CHALLENGE_ID: "",
};

export const NFTREE = {
  MINT_URL: "https://nftree.net",
  PACKAGE_ID: "0xf6c6d439ea0da2f3e9ba79e4992a7a4c113215fbf54c442ac9020c315f953705",
  STRUCT_TYPE: "0xf6c6d439ea0da2f3e9ba79e4992a7a4c113215fbf54c442ac9020c315f953705::collection::NFT",
};

// ── ADMIN WALLETS ─────────────────────────────────────────────────────────────
export const ADMIN_WALLETS = [
  '0x485953e2eadf4aa02af950cf8e914fbd2b67523385e73c36118341459d8d45c4',
  '0x5c1f8444d680093e51d23278b8c2ec91da7e8feb582a640d18d1666556f69ea1',
  '0xd2532cd788aa03079221c88eedb37de542fc58d733ad5dafe6c91a17d136d49d',
];

// ── CONTRACT CONSTANTS (exact mirror of Move source) ─────────────────────────
export const GROWTH_DEPOSIT_MIST = 10_000_000n; // 0.01 SUI
export const REFERRAL_MIST       =  1_000_000n; // 0.001 SUI

// Current live contract economics: all crate tiers cost 0.01 SUI.
export const CRATE_PRICES = {
  0: 10_000_000n,   // 0.01 SUI  (Seedling)
  1: 10_000_000n,   // 0.01 SUI  (Grove)
  2: 10_000_000n,   // 0.01 SUI  (Canopy)
  3: 10_000_000n,   // 0.01 SUI  (Ancient)
  4: 10_000_000n,   // 0.01 SUI  (Mythic)
};
export const SUPPLY_DROP_PRICES = {
  0: 50_000_000n,   // 0.05 SUI  (Revival Kit)    original economy target: 25 SUI
  1: 40_000_000n,   // 0.04 SUI  (Drought Shield) original economy target: 15 SUI
  2: 30_000_000n,   // 0.03 SUI  (Rain Barrel)    original economy target: 10 SUI
  3: 25_000_000n,   // 0.025 SUI (Mulch)          original economy target: 8 SUI
  4: 20_000_000n,   // 0.02 SUI  (Watering Boost) original economy target: 5 SUI
};
export const SEASON_MS    = 2_592_000_000n;
export const ONE_DAY_MS   = 86_400_000;
export const CANOPY_CHALLENGE_ENTRY_MIST = 250_000_000n;
export const CANOPY_CHALLENGE_DURATION_MS = 86_400_000;
export const CANOPY_CHALLENGE_UNLOCK_MS = 14 * ONE_DAY_MS;
export const WILT_DAYS    = 7;
export const DEATH_DAYS   = 10;
const OPEN_CRATE_GAS_BUDGET_MIST = 100_000_000n; // Open crate can mint several Tool NFTs.
const SUPPLY_DROP_GAS_BUDGET_MIST = 60_000_000n; // Supply Drop mints one Tool NFT.
const WATER_ALL_GAS_BUDGET_MIST = 120_000_000n; // Batch up to 8 ready Seeds in one wallet approval.
const _suinsCache = new Map();

// ── ALL 20 ITEMS (mirrors Move constants) ─────────────────────────────────────
export const ITEMS = {
  // Common
  fertilizer:        { id:'fertilizer',        rarity:0, label:'Fertilizer',        em:'🌻', desc:'Use before watering: adds three +50% future waterings; no instant Growth Points', role:'Growth Booster', roleCopy:'Increase Growth Points directly now or make upcoming waterings worth more.', rarLabel:'Common' },
  watering_boost:    { id:'watering_boost',     rarity:0, label:'Watering Boost',    em:'💦', desc:'Use before watering: adds one +50% future watering; no instant Growth Points',role:'Growth Booster', roleCopy:'Increase Growth Points directly now or make upcoming waterings worth more.', rarLabel:'Common' },
  compost:           { id:'compost',            rarity:0, label:'Compost',            em:'♻️', desc:'Best before watering: adds one streak day; helps reach stronger stages sooner', role:'Streak Builder', roleCopy:'Speed up stage progress so a Seed can become more valuable over the season.', rarLabel:'Common' },
  growth_tonic:      { id:'growth_tonic',       rarity:0, label:'Growth Tonic',      em:'🧪', desc:'Use before or after watering: adds +20 Growth Points immediately', role:'Growth Booster', roleCopy:'Increase Growth Points directly now or make upcoming waterings worth more.', rarLabel:'Common' },
  // Uncommon
  miracle_grow:      { id:'miracle_grow',       rarity:1, label:'Miracle Grow',      em:'⚡', desc:'Use before watering: doubles Growth Points from the next watering; no instant Growth Points', role:'Growth Booster', roleCopy:'Increase Growth Points directly now or make upcoming waterings worth more.', rarLabel:'Uncommon' },
  mulch:             { id:'mulch',              rarity:1, label:'Mulch',              em:'🍂', desc:'Use before missed time: protects future Growth Points through about three missed watering days',role:'Protection Item', roleCopy:'Protect the future Growth Points you would lose if a Seed dries out or dies.', rarLabel:'Uncommon' },
  rain_barrel:       { id:'rain_barrel',        rarity:1, label:'Rain Barrel',       em:'🪣', desc:'Use before a Seed gets too dry: refreshes the timer to protect future Growth Points', role:'Protection Item', roleCopy:'Protect the future Growth Points you would lose if a Seed dries out or dies.', rarLabel:'Uncommon' },
  super_soil:        { id:'super_soil',         rarity:1, label:'Super Soil',        em:'🌍', desc:'Best before watering: adds three streak days; helps reach stronger stages sooner', role:'Streak Builder', roleCopy:'Speed up stage progress so a Seed can become more valuable over the season.', rarLabel:'Uncommon' },
  sunstone:          { id:'sunstone',           rarity:1, label:'Sunstone',          em:'🌟', desc:'Use before or after watering: adds +30 Growth Points immediately', role:'Growth Booster', roleCopy:'Increase Growth Points directly now or make upcoming waterings worth more.', rarLabel:'Uncommon' },
  // Rare
  revival_kit:       { id:'revival_kit',        rarity:2, label:'Revival Kit',       em:'💫', desc:'Use after a Seed dies: revives it so it can earn future Growth Points again', role:'Recovery Item', roleCopy:'Bring a dead current-cycle Seed back so it can earn again.', rarLabel:'Rare' },
  double_dose:       { id:'double_dose',        rarity:2, label:'Double Dose',       em:'🔥', desc:'Use before watering: doubles next watering and adds two +50% future waterings',role:'Growth Booster', roleCopy:'Increase Growth Points directly now or make upcoming waterings worth more.', rarLabel:'Rare' },
  drought_shield:    { id:'drought_shield',     rarity:2, label:'Drought Shield',    em:'🛡️', desc:'Use before longer time away: protects future Growth Points through about seven missed watering days',role:'Protection Item', roleCopy:'Protect the future Growth Points you would lose if a Seed dries out or dies.', rarLabel:'Rare' },
  ancient_bark:      { id:'ancient_bark',       rarity:2, label:'Ancient Bark',      em:'🌳', desc:'Use before or after watering: adds +50 Growth Points immediately', role:'Growth Booster', roleCopy:'Increase Growth Points directly now or make upcoming waterings worth more.', rarLabel:'Rare' },
  moon_water:        { id:'moon_water',         rarity:2, label:'Moon Water',        em:'🌕', desc:'Use before watering: adds five +50% future waterings; no instant Growth Points', role:'Power Enhancer', roleCopy:'Make one Seed stronger for future waterings or the rest of the cycle.', rarLabel:'Rare' },
  earth_core:        { id:'earth_core',         rarity:2, label:'Earth Core',        em:'💎', desc:'Use before watering: adds five +50% future waterings; no instant Growth Points', role:'Power Enhancer', roleCopy:'Make one Seed stronger for future waterings or the rest of the cycle.', rarLabel:'Rare' },
  // Legendary
  bottomless_can:    { id:'bottomless_can',     rarity:3, label:'Bottomless Can',    em:'✨🪣✨', desc:'Use before time away: auto-waters one selected Seed for the timed window',role:'Protection Item', roleCopy:'Protect the future Growth Points you would lose if a Seed dries out or dies.', rarLabel:'Legendary' },
  philosophers_soil: { id:'philosophers_soil',  rarity:3, label:'Philosopher\'s Soil',em:'🏆', desc:'Use before watering, preferably early: adds ten +50% future waterings; no instant Growth Points', role:'Power Enhancer', roleCopy:'Make one Seed stronger for future waterings or the rest of the cycle.', rarLabel:'Legendary' },
  timeless_seed:     { id:'timeless_seed',      rarity:3, label:'Timeless Seed',     em:'⏳', desc:'Use after missed time or before risk: refreshes timer and adds five streak days', role:'Streak Builder', roleCopy:'Speed up stage progress so a Seed can become more valuable over the season.', rarLabel:'Legendary' },
  crystal_water:     { id:'crystal_water',      rarity:3, label:'Crystal Water',     em:'💠', desc:'Use before watering: doubles next watering and adds nine +50% future waterings',role:'Power Enhancer', roleCopy:'Make one Seed stronger for future waterings or the rest of the cycle.', rarLabel:'Legendary' },
  forest_heart:      { id:'forest_heart',       rarity:3, label:'Forest Heart',      em:'❤️‍🔥', desc:'Use before watering, preferably early: adds +5 Growth Points to every future watering on one Seed',role:'Power Enhancer', roleCopy:'Make one Seed stronger for future waterings or the rest of the cycle.', rarLabel:'Legendary'},
};

// ── CRATE DEFINITIONS ─────────────────────────────────────────────────────────
export const CRATES = [
  { id:0, name:'Seedling Crate', sui:0.01, em:'🌱', color:'rgba(25,230,180,.7)',
    items:1,   desc:'1 Common item guaranteed',
    lootTable:[ {w:100,rarity:0} ] },
  { id:1, name:'Grove Crate',    sui:0.01, em:'🌿', color:'rgba(59,130,246,.8)',
    items:'2+', desc:'2 Commons + 0.01% chance Legendary',
    lootTable:[ {w:9999,rarity:0}, {w:1,rarity:3} ] },
  { id:2, name:'Canopy Crate',   sui:0.01, em:'🌲', color:'rgba(168,85,247,.8)',
    items:'3+', desc:'3 items (1 Uncommon, 2 Common) + 5% Legendary bonus',
    lootTable:[ {w:95,rarity:1}, {w:5,rarity:3} ] },
  { id:3, name:'Ancient Crate',  sui:0.01, em:'🌳', color:'rgba(255,179,71,.9)',
    items:'5+', desc:'5 items (2 Rare, 2 Uncommon, 1 Common) + 50% Legendary',
    lootTable:[ {w:50,rarity:2}, {w:50,rarity:3} ] },
  { id:4, name:'Mythic Crate',   sui:0.01, em:'✨🌳✨', color:'rgba(255,216,111,1)',
    items:'9+', desc:'9 items guaranteed + 1 Legendary + 30% second Legendary',
    lootTable:[ {w:100,rarity:3} ] },
];

// ── SIGN FEATURES ─────────────────────────────────────────────────────────────
const SIGN_FEATURES = ['sui:signAndExecuteTransaction','sui:signAndExecuteTransactionBlock'];

// ── SESSION ───────────────────────────────────────────────────────────────────
const _mem = { address:null, name:null, expiry:0 };
const _sessionStores=()=>[sessionStorage,localStorage].filter(Boolean);
function _save(a,n){
  const e=Date.now()+SESSION_TTL_MS;
  Object.assign(_mem,{address:a,name:n,expiry:e});
  for(const store of _sessionStores()){
    try{store.setItem('arb_addr',a);store.setItem('arb_name',n);store.setItem('arb_expiry',String(e));}catch(_){}
  }
}
function _clear(){
  Object.assign(_mem,{address:null,name:null,expiry:0});
  for(const store of _sessionStores()){
    ['arb_addr','arb_name','arb_expiry'].forEach(k=>{try{store.removeItem(k);}catch(_){}});
  }
}
function _load(){
  if(_mem.address&&Date.now()<_mem.expiry)return{address:_mem.address,name:_mem.name};
  for(const store of _sessionStores()){
    try{
      const a=store.getItem('arb_addr'),n=store.getItem('arb_name'),e=parseInt(store.getItem('arb_expiry')||'0',10);
      if(a&&n&&Date.now()<e){Object.assign(_mem,{address:a,name:n,expiry:e});return{address:a,name:n};}
    }catch(_){}
  }
  return null;
}

// ── STATE ─────────────────────────────────────────────────────────────────────
let _wallet=null,_account=null,_address=null,_suiClient=null;
function _client(){ if(!_suiClient)_suiClient=new SuiClient({url:RPC_URL}); return _suiClient; }
function _signFeat(w){ for(const f of SIGN_FEATURES)if(w.features?.[f])return f; return null; }
const _sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
function _isSui(a){ const c=a?.chains||[]; return c.length===0||c.includes(CHAIN); }
function _supportsSui(a){ const c=a?.chains||[]; return c.length===0||c.includes('sui')||c.some(x=>x.startsWith('sui:')); }
function _pick(accs,pref=null){ const l=accs||[]; if(!l.length)return null; if(pref){const e=l.find(a=>a.address===pref);if(e)return e;} return l.find(a=>(a.chains||[]).includes(CHAIN))||l.find(a=>_supportsSui(a))||l[0]; }
async function _signingWallets(timeoutMs=12000){
  const start=Date.now();
  do{
    const ws=getWallets().get().filter(w=>_signFeat(w)!==null);
    if(ws.length)return ws;
    await _sleep(150);
  }while(Date.now()-start<timeoutMs);
  return [];
}

// ── CONNECT ───────────────────────────────────────────────────────────────────
export async function connectWallet(walletName=null){
  const ws=await _signingWallets(15000);
  if(!ws.length)throw new Error('NO_WALLET');
  // If a specific wallet name was requested (from picker UI), prefer it
  const w=walletName
    ? (ws.find(x=>x.name===walletName)||ws.find(x=>(x.accounts||[]).length>0)||ws[0])
    : (ws.find(x=>(x.accounts||[]).length>0)||ws[0]);
  if(w.features['standard:connect'])await w.features['standard:connect'].connect();
  if(!w.accounts?.length)throw new Error('No accounts found — unlock your wallet.');
  const acc=_pick(w.accounts);
  if(!acc)throw new Error('No suitable Sui account.');
  const chains=acc.chains||[];
  if(chains.length&&!chains.includes(CHAIN))throw new Error('WRONG_NETWORK');
  _wallet=w;_account=acc;_address=acc.address;
  window.currentWallet=_wallet;window.currentAccount=_account;window.playerAddress=_address;
  _save(_address,w.name);_client();
  return{address:_address,walletName:w.name,isAdmin:isAdmin(_address)};
}

export function getInstalledWallets(){
  return getWallets().get().filter(w=>_signFeat(w)!==null);
}

export async function disconnectWallet(){
  try{if(_wallet?.features['standard:disconnect'])await _wallet.features['standard:disconnect'].disconnect();}catch(_){}
  _wallet=_account=_address=_suiClient=null;
  window.currentWallet=window.currentAccount=window.playerAddress=null;
  _clear();
}

export async function initializeWallet(){
  const s=_load();if(!s)return null;
  try{
    const ws=await _signingWallets(5000);
    const w=ws.find(x=>x.name===s.name);if(!w)return null;
    if((!w.accounts||!w.accounts.length)&&w.features['standard:connect']){
      try{await w.features['standard:connect'].connect({silent:true});}catch(_){}
    }
    const a=_pick(w.accounts||[],s.address);if(!a)return null;
    const chains=a.chains||[];if(chains.length&&!chains.includes(CHAIN))return null;
    _wallet=w;_account=a;_address=a.address;
    window.currentWallet=_wallet;window.currentAccount=_account;window.playerAddress=_address;
    _save(_address,w.name);_client();return{address:_address,walletName:w.name,isAdmin:isAdmin(_address)};
  }catch(e){console.warn('Session restore:',e.message);return null;}
}

// ── SIGN & EXECUTE ────────────────────────────────────────────────────────────
export async function signAndExecute(tx) {
  if (!_wallet || !_account) throw new Error('Wallet not connected');

  const f = _wallet.features['sui:signAndExecuteTransaction'];
  if (!f) throw new Error('Wallet does not support sui:signAndExecuteTransaction');

  // Make sure the sender is set
  tx.setSender(_account.address);

  // Let the wallet handle build / toJSON internally
  const result = await f.signAndExecuteTransaction({
    account: _account,
    chain: CHAIN,
    transaction: tx,
    options: { showEffects: true, showEvents: true, showObjectChanges: true },
  });

  if (result?.digest && (!Array.isArray(result.events) || !Array.isArray(result.objectChanges))) {
    try {
      const full = await _client().waitForTransaction({
        digest: result.digest,
        options: { showEffects: true, showEvents: true, showObjectChanges: true },
      });
      return { ...result, ...full, digest: result.digest };
    } catch (err) {
      console.warn('Could not hydrate transaction result', err);
    }
  }

  return result;
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
export function isAdmin(addr=_address){ if(!addr)return false; return ADMIN_WALLETS.some(a=>a.toLowerCase()===addr.toLowerCase()); }
export function getAddress(){ return _address; }
export function getClient(){ return _client(); }

export async function resolveSuiName(addr){
  const address=String(addr||'').toLowerCase();
  if(!/^0x[a-fA-F0-9]{64}$/.test(address))return '';
  if(_suinsCache.has(address))return _suinsCache.get(address);
  try{
    const res=await _client().resolveNameServiceNames({address,limit:1,format:'dot'});
    const name=String(res?.data?.[0]||'').trim();
    _suinsCache.set(address,name);
    return name;
  }catch(e){
    try{
    const query=`query ($address: SuiAddress!) {
      address(address: $address) {
        defaultNameRecord { domain }
      }
    }`;
    const data=await gql(query,{address});
    const name=String(data?.address?.defaultNameRecord?.domain||'').trim();
    _suinsCache.set(address,name);
    return name;
    }catch(fallbackErr){
      console.warn('SuiNS lookup failed:',address,e,fallbackErr);
      _suinsCache.set(address,'');
      return '';
    }
  }
}

function mistNumber(value){
  if(value && typeof value==='object' && value.fields && value.fields.value !== undefined){
    return Number(value.fields.value);
  }
  return Number(value ?? 0);
}

function formatSuiFromMist(value, digits=4){
  return (mistNumber(value)/1e9).toFixed(digits);
}

async function gql(query,variables={}){
  const res=await fetch(GRAPHQL_URL,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({query,variables}),
  });
  const json=await res.json();
  if(json.errors?.length)throw new Error(json.errors.map(e=>e.message).join('; '));
  return json.data;
}

function gqlObjectToSuiData(node){
  if(!node)return null;
  const type=node.contents?.type?.repr||null;
  const fields=node.contents?.json||{};
  return{
    objectId:node.address,
    version:String(node.version??''),
    digest:node.digest,
    type,
    display:{data:{}},
    content:{dataType:'moveObject',type,fields},
  };
}

function fullnodeObjectToSuiData(item){
  const data=item?.data||item;
  const content=data?.content;
  const type=data?.type||content?.type||null;
  if(!data?.objectId||!content||content.dataType!=='moveObject')return null;
  return{
    objectId:data.objectId,
    version:String(data.version??''),
    digest:data.digest,
    type,
    display:data.display||{data:{}},
    content:{dataType:'moveObject',type,fields:content.fields||{}},
  };
}

function objectTypeOf(obj){
  return obj?.content?.type||obj?.type||obj?.data?.content?.type||'';
}

function currentObjectType(structType){
  return `${CONTRACT.TYPE_PACKAGE_ID}::${CONTRACT.MODULE}::${structType}`;
}

function isCurrentObjectType(obj,structType){
  return objectTypeOf(obj)===currentObjectType(structType);
}

async function gqlOwnedObjectsByType(owner,type){
  const query=`query ($address: SuiAddress!, $type: String!, $after: String) {
    address(address: $address) {
      objects(first: 50, after: $after, filter: { type: $type }) {
        pageInfo { hasNextPage endCursor }
        nodes { address version digest contents { type { repr } json } }
      }
    }
  }`;
  const out=[];
  let after=null;
  do{
    const data=await gql(query,{address:owner,type,after});
    const page=data?.address?.objects;
    out.push(...((page?.nodes||[]).map(gqlObjectToSuiData).filter(Boolean)));
    after=page?.pageInfo?.hasNextPage?page.pageInfo.endCursor:null;
  }while(after);
  return out;
}

async function fullnodeOwnedObjectsByType(owner,type){
  const out=[];
  let cursor=null;
  do{
    const page=await _client().getOwnedObjects({
      owner,
      cursor,
      limit:50,
      filter:{StructType:type},
      options:{showType:true,showContent:true,showDisplay:true},
    });
    out.push(...((page?.data||[]).map(fullnodeObjectToSuiData).filter(Boolean)));
    cursor=page?.hasNextPage?page.nextCursor:null;
  }while(cursor);
  return out;
}

async function gqlObjectById(objectId){
  const query=`query ($id: SuiAddress!) {
    object(address: $id) {
      address version digest
      asMoveObject { contents { type { repr } json } }
    }
  }`;
  const data=await gql(query,{id:objectId});
  const obj=data?.object;
  if(!obj?.asMoveObject)return null;
  return gqlObjectToSuiData({
    address:obj.address,
    version:obj.version,
    digest:obj.digest,
    contents:obj.asMoveObject.contents,
  });
}

async function gqlAllObjectsByType(type,limit=500){
  const query=`query ($type: String!, $first: Int, $after: String) {
    objects(first: $first, after: $after, filter: { type: $type }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        address version digest
        asMoveObject { contents { type { repr } json } }
      }
    }
  }`;
  const out=[];
  let after=null;
  do{
    const data=await gql(query,{type,first:Math.min(50,limit-out.length),after});
    const page=data?.objects;
    out.push(...((page?.nodes||[]).map((node)=>{
      if(!node?.asMoveObject)return null;
      return gqlObjectToSuiData({
        address:node.address,
        version:node.version,
        digest:node.digest,
        contents:node.asMoveObject.contents,
      });
    }).filter(Boolean)));
    after=page?.pageInfo?.hasNextPage&&out.length<limit?page.pageInfo.endCursor:null;
  }while(after&&out.length<limit);
  return out.slice(0,limit);
}

export async function getSuiBalance(addr=_address){
  if(!addr)throw new Error('No address');
  const query=`query ($address: SuiAddress!) {
    address(address: $address) { balance(coinType:"0x2::sui::SUI") { totalBalance } }
  }`;
  const data=await gql(query,{address:addr});
  return BigInt(data?.address?.balance?.totalBalance||0);
}

export async function getOwnedObjects(addr,structType){
  if(!addr)throw new Error('No address');
  const out=[];
  const seen=new Set();
  const typePackageIds=[
    ...(CONTRACT.TYPE_PACKAGE_IDS||[]),
    CONTRACT.TYPE_PACKAGE_ID,
    CONTRACT.PACKAGE_ID,
  ].filter(Boolean);
  const uniqueTypePackageIds=[...new Set(typePackageIds)];
  for(const typePackageId of uniqueTypePackageIds){
    const type=`${typePackageId}::${CONTRACT.MODULE}::${structType}`;
    let objects=[];
    try{
      objects=await fullnodeOwnedObjectsByType(addr,type);
    }catch(err){
      console.warn('Fullnode owned object read failed, falling back to GraphQL', err);
      objects=await gqlOwnedObjectsByType(addr,type);
    }
    for(const obj of objects){
      if(obj.objectId&&!seen.has(obj.objectId)){
        seen.add(obj.objectId);
        out.push(obj);
      }
    }
  }
  return out;
}

export async function getObjectById(objectId){
  if(!objectId)throw new Error('No object id');
  return gqlObjectById(objectId);
}

async function getDynamicFieldObject(parentId,nameType,nameValue){
  if(!parentId)throw new Error('No parent object id');
  const res=await _client().getDynamicFieldObject({
    parentId,
    name:{type:nameType,value:nameValue},
  });
  return fullnodeObjectToSuiData(res);
}

function fieldObjectId(value){
  return value?.fields?.id?.id || value?.fields?.id || value?.id?.id || value?.id || null;
}

function configuredChallengeBookId(){
  const win=typeof window!=='undefined'?String(window.ARBORETUM_CHALLENGE_BOOK_ID||''):'';
  const stored=typeof window!=='undefined'?String(localStorage.getItem('arb_challenge_book_id')||''):'';
  return win || stored || String(CONTRACT.CHALLENGE_BOOK_ID||'');
}

function configuredCanopyChallengeId(){
  const win=typeof window!=='undefined'?String(window.ARBORETUM_ACTIVE_CANOPY_CHALLENGE_ID||''):'';
  const stored=typeof window!=='undefined'?String(localStorage.getItem('arb_active_canopy_challenge_id')||''):'';
  return win || stored || String(CONTRACT.ACTIVE_CANOPY_CHALLENGE_ID||'');
}

function parseChallengeEventObjectId(result,eventName,fieldName){
  const suffix=`::${eventName}`;
  const ev=(result?.events||[]).find((e)=>String(e.type||'').endsWith(suffix));
  return ev?.parsedJson?.[fieldName] || null;
}

function parseSeasonArchiveEvent(result){
  const suffix='::SeasonArchived';
  const ev=(result?.events||[]).find((e)=>String(e.type||'').endsWith(suffix));
  const json=ev?.parsedJson||{};
  const archiveId=json.archive_id||null;
  if(archiveId&&typeof window!=='undefined'){
    localStorage.setItem('arb_last_season_archive_id',archiveId);
    if(json.season_id!==undefined)localStorage.setItem('arb_last_season_archive_season_id',String(json.season_id));
    if(json.claim_deadline_ms!==undefined)localStorage.setItem('arb_last_season_archive_deadline_ms',String(json.claim_deadline_ms));
  }
  return archiveId?{
    archiveId,
    seasonId:Number(json.season_id??0),
    claimDeadlineMs:Number(json.claim_deadline_ms??0),
    rewardPoolMist:BigInt(json.reward_pool_mist??0),
    totalGrowthPoints:Number(json.total_growth_points??0),
    totalSeeds:Number(json.total_seeds??0),
  }:null;
}

export function getConfiguredSeasonArchiveId(){
  const win=typeof window!=='undefined'?String(window.ARBORETUM_SEASON_ARCHIVE_ID||''):'';
  const stored=typeof window!=='undefined'?String(localStorage.getItem('arb_last_season_archive_id')||''):'';
  return win || stored;
}

export async function getSeasonArchive(archiveObjectId=getConfiguredSeasonArchiveId()){
  if(!archiveObjectId)return null;
  const obj=await getObjectById(archiveObjectId);
  const f=obj?.content?.fields||{};
  return{
    objectId:archiveObjectId,
    seasonId:Number(f.season_id??0),
    seasonStartMs:Number(f.season_start_ms??0),
    seasonEndMs:Number(f.season_end_ms??0),
    finalizedAtMs:Number(f.finalized_at_ms??0),
    claimDeadlineMs:Number(f.claim_deadline_ms??0),
    totalGrowthPoints:Number(f.total_growth_points??0),
    totalSeeds:Number(f.total_seeds??0),
    rewardPoolSui:formatSuiFromMist(f.reward_pool),
    swept:Boolean(f.swept),
  };
}

function parseCanopyChallengeObject(obj,playerEntry=null,playerGrowthPoints=0){
  if(!obj)return null;
  const f=obj.content?.fields||{};
  const baseline=Number(playerEntry?.baseline_growth_points??0);
  const current=Number(playerGrowthPoints||0);
  return{
    objectId:obj.objectId,
    challengeId:Number(f.challenge_id??0),
    seasonId:Number(f.season_id??0),
    startMs:Number(f.start_ms??0),
    endMs:Number(f.end_ms??0),
    entryFeeMist:BigInt(f.entry_fee_mist??0),
    entryFeeSui:formatSuiFromMist(f.entry_fee_mist),
    entryCount:Number(f.entry_count??0),
    potMist:BigInt(mistNumber(f.pot)),
    potSui:formatSuiFromMist(f.pot),
    settled:Boolean(f.settled),
    canceled:Boolean(f.canceled),
    entriesTableId:fieldObjectId(f.entries),
    playerEntered:Boolean(playerEntry),
    playerBaseline:baseline,
    playerGrowthPoints:current,
    playerScore:Math.max(0,current-baseline),
    playerRefunded:Boolean(playerEntry?.refunded),
  };
}

async function getChallengeEntry(entriesTableId,player){
  if(!entriesTableId||!player)return null;
  try{
    const obj=await getDynamicFieldObject(entriesTableId,'address',player);
    return obj?.content?.fields?.value?.fields||obj?.content?.fields?.value||null;
  }catch(_){
    return null;
  }
}

export async function getOwnedObjectsByStructType(addr,structType){
  if(!addr)throw new Error('No address');
  if(!/^0x[a-fA-F0-9]+::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*(<.*>)?$/.test(String(structType||''))){
    throw new Error('NFTree collection StructType is not configured.');
  }
  return gqlOwnedObjectsByType(addr,structType);
}

export async function getOwnedNftreeNfts(addr=_address){
  const structType=(typeof window!=='undefined'&&window.ARBORETUM_NFTREE_STRUCT_TYPE)||NFTREE.STRUCT_TYPE;
  return getOwnedObjectsByStructType(addr,structType);
}

export async function checkWalletNftreeAccess(addr=_address){
  if(!addr)throw new Error('Wallet not connected');
  const [nfts,registry,seedsRaw]=await Promise.all([
    getOwnedNftreeNfts(addr),
    getRegistryFields().catch(()=>({})),
    getOwnedObjects(addr,'Seed'),
  ]);
  const currentSeasonId=Number(registry.current_season_id??0);
  const seasonStarted=Number(registry.season_start_ms??0)>0;
  const seeds=seedsRaw.filter((s)=>isCurrentObjectType(s,'Seed'));
  const activeSeeds=seeds.filter((s)=>{
    const f=s.content?.fields??{};
    const seedSeasonId=Number(f.season_id??0);
    return seasonStarted&&Number(f.claimed_ms??0)===0&&(!currentSeasonId||seedSeasonId===currentSeasonId);
  });
  const ownedNftIds=new Set(nfts.map((nft)=>nft.objectId).filter(Boolean));
  // Read nft_id from the fixed contract field; fall back to sapling_id for older objects
  const attachedNftIds=new Set(
    activeSeeds
      .map((s)=>{ const f=s.content?.fields??{}; return f.nft_id||f.sapling_id; })
      .filter(Boolean)
  );
  const missingAttachedNftIds=[...attachedNftIds].filter((id)=>!ownedNftIds.has(id));
  const availableNfts=nfts.filter((nft)=>!attachedNftIds.has(nft.objectId));
  const capacity=nfts.length;
  const used=activeSeeds.length;
  const gardenLocked=missingAttachedNftIds.length>0||used>capacity;
  return{
    address:addr,
    nftCount:capacity,
    activeSeedCount:used,
    availableSeedSlots:Math.max(0,capacity-used),
    canPlant:seasonStarted&&!gardenLocked&&availableNfts.length>0&&capacity>used,
    currentSeasonId,
    seasonStarted,
    attachedNftIds:[...attachedNftIds],
    missingAttachedNftIds,
    gardenLocked,
    availableNfts,
    nfts,
    seeds:activeSeeds,
  };
}

export async function getRegistryFields(){
  const obj=await gqlObjectById(CONTRACT.REGISTRY_ID);
  return obj?.content?.fields??{};
}

export async function getEventsByType(eventType,limit=100){
  const query=`query ($type: String!, $first: Int, $after: String) {
    events(first: $first, after: $after, filter: { type: $type }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        sender { address }
        timestamp
        contents { type { repr } json }
      }
    }
  }`;
  const out=[];
  let after=null;
  do{
    const data=await gql(query,{type:eventType,first:Math.min(50,limit),after});
    const page=data?.events;
    out.push(...((page?.nodes||[]).map((node)=>({
      sender:node.sender?.address,
      timestamp:node.timestamp,
      type:node.contents?.type?.repr,
      parsedJson:node.contents?.json||{},
    }))));
    after=page?.pageInfo?.hasNextPage&&out.length<limit?page.pageInfo.endCursor:null;
  }while(after);
  return out.slice(0,limit);
}

export async function getAllObjectsByStructType(structType,limit=500){
  const out=[];
  const seen=new Set();
  const typePackageIds=[
    ...(CONTRACT.TYPE_PACKAGE_IDS||[]),
    CONTRACT.TYPE_PACKAGE_ID,
    CONTRACT.PACKAGE_ID,
  ].filter(Boolean);
  for(const typePackageId of [...new Set(typePackageIds)]){
    const objects=await gqlAllObjectsByType(`${typePackageId}::${CONTRACT.MODULE}::${structType}`,limit);
    for(const obj of objects){
      if(obj.objectId&&!seen.has(obj.objectId)){
        seen.add(obj.objectId);
        out.push(obj);
      }
    }
  }
  return out.slice(0,limit);
}

export async function getSeasonStats(){
  const f=await getRegistryFields();
  const startMs=Number(f.season_start_ms??0);
  const now=Date.now();
  const elapsed=startMs>0?now-startMs:0;
  const totalMs=Number(SEASON_MS);
  return{
    totalSeeds:        Number(f.total_seeds??0),
    totalGrowthPoints: Number(f.total_growth_points??0),
    rewardPoolSui:     formatSuiFromMist(f.reward_pool),
    treasurySui:       formatSuiFromMist(f.treasury),
    currentSeasonId:   Number(f.current_season_id??0),
    seasonStartMs:     startMs,
    seasonEndMs:       startMs>0?startMs+totalMs:0,
    reviewReadyMs:     startMs>0?startMs+totalMs+ONE_DAY_MS:0,
    paused:            Boolean(f.paused),
    daysLeft:          startMs>0?Math.max(0,Math.floor((totalMs-elapsed)/ONE_DAY_MS)):30,
    progressPct:       startMs>0?Math.min(100,(elapsed/totalMs)*100).toFixed(1):'0.0',
    claimable:         startMs>0&&elapsed>=totalMs,
    admin:             f.admin??null,
  };
}

export async function getProjectedReward(addr=_address){
  if(!addr)return 0;
  const f=await getRegistryFields();
  const total=Number(f.total_growth_points??0);
  const pool=mistNumber(f.reward_pool);
  if(!total||!pool)return 0;
  const currentSeasonId=Number(f.current_season_id??0);
  const seeds=await getOwnedObjects(addr,'Seed');
  const playerGP=seeds.reduce((a,s)=>{
    const fields=s.content?.fields??{};
    const seedSeasonId=Number(fields.season_id??0);
    if(currentSeasonId&&seedSeasonId!==currentSeasonId)return a;
    if(Number(fields.claimed_ms??0)>0)return a;
    return a+Number(fields.growth_points??0);
  },0);
  return(playerGP/total)*(pool/1e9);
}

export async function getTotalRewardsCollected(addr=_address,limit=1000){
  if(!addr)return 0;
  const target=String(addr).toLowerCase();
  const typePackageIds=[
    ...(CONTRACT.TYPE_PACKAGE_IDS||[]),
    CONTRACT.TYPE_PACKAGE_ID,
    CONTRACT.PACKAGE_ID,
  ].filter(Boolean);
  const seen=new Set();
  let totalMist=0;

  for(const typePackageId of [...new Set(typePackageIds)]){
    const eventType=`${typePackageId}::${CONTRACT.MODULE}::RewardClaimed`;
    const events=await getEventsByType(eventType,limit);
    for(const ev of events){
      const owner=String(ev.parsedJson?.owner||'').toLowerCase();
      const eventKey=`${ev.type||eventType}:${ev.timestamp||''}:${owner}:${ev.parsedJson?.amount_mist||0}`;
      if(owner===target&&!seen.has(eventKey)){
        seen.add(eventKey);
        totalMist+=Number(ev.parsedJson?.amount_mist||0);
      }
    }
  }

  return totalMist/1e9;
}

export async function getPlayerCurrentGrowthPoints(addr=_address){
  if(!addr)return 0;
  const registry=await getRegistryFields().catch(()=>({}));
  const currentSeasonId=Number(registry.current_season_id??0);
  const seasonStarted=Number(registry.season_start_ms??0)>0;
  if(!seasonStarted)return 0;
  const seeds=await getOwnedObjects(addr,'Seed');
  return seeds.reduce((sum,s)=>{
    if(!isCurrentObjectType(s,'Seed'))return sum;
    const f=s.content?.fields??{};
    if(currentSeasonId&&Number(f.season_id??0)!==currentSeasonId)return sum;
    return sum+Number(f.growth_points??0);
  },0);
}

export async function getCanopyChallengeState(addr=_address){
  if(!CONTRACT.SUPPORTS_CANOPY_CHALLENGES){
    return{supported:false,status:'upgrade_needed',message:'Daily Canopy Challenges are coming soon.'};
  }
  const bookId=configuredChallengeBookId();
  const activeChallengeId=configuredCanopyChallengeId();
  const [bookObj,challengeObj,playerGrowthPoints]=await Promise.all([
    bookId?getObjectById(bookId).catch(()=>null):Promise.resolve(null),
    activeChallengeId?getObjectById(activeChallengeId).catch(()=>null):Promise.resolve(null),
    addr?getPlayerCurrentGrowthPoints(addr).catch(()=>0):Promise.resolve(0),
  ]);
  const bookFields=bookObj?.content?.fields||{};
  if(!bookObj){
    return{supported:true,status:'book_needed',message:'Admin needs to create the Daily Canopy Challenge book.'};
  }
  if(!challengeObj){
    return{
      supported:true,
      status:'no_active_challenge',
      bookId,
      currentChallengeId:Number(bookFields.current_challenge_id??0),
      activeChallengeId:Number(bookFields.active_challenge_id??0),
      activeEndMs:Number(bookFields.active_end_ms??0),
      message:'No Canopy Sprint is open right now.',
    };
  }
  const fields=challengeObj.content?.fields||{};
  const entriesTableId=fieldObjectId(fields.entries);
  const playerEntry=addr?await getChallengeEntry(entriesTableId,addr):null;
  const challenge=parseCanopyChallengeObject(challengeObj,playerEntry,playerGrowthPoints);
  const now=Date.now();
  const status=challenge.canceled?'canceled':challenge.settled?'settled':now<challenge.startMs?'scheduled':now<challenge.endMs?'open':'ended';
  return{
    supported:true,
    status,
    bookId,
    currentChallengeId:Number(bookFields.current_challenge_id??0),
    activeChallengeId:Number(bookFields.active_challenge_id??0),
    activeEndMs:Number(bookFields.active_end_ms??0),
    challenge,
  };
}

export function parseSeedObject(obj){
  const f=obj.content?.fields??{};
  const now=Date.now();
  const lastWatered=Number(f.last_watered_ms??0);
  const bottomlessExpiry=Number(f.bottomless_can_expiry_ms??0);
  const bottomlessCanActive=bottomlessExpiry>now;
  const actualDroughtDays=Math.floor((now-lastWatered)/ONE_DAY_MS);
  const droughtDays=bottomlessCanActive?0:actualDroughtDays;
  const rawState=Number(f.state??0);
  let state='alive';
  if(rawState===2)state='dead';
  else if(!bottomlessCanActive&&(rawState===1||droughtDays>=WILT_DAYS))state='wilting';
  return{
    objectId:           obj.objectId,
    objectType:         obj.content?.type||obj.type||obj.data?.content?.type||'',
    state, rawState, droughtDays, actualDroughtDays,
    streak:             Number(f.watering_streak??0),
    growthPoints:       Number(f.growth_points??0),
    seasonId:           Number(f.season_id??0),
    claimedMs:          Number(f.claimed_ms??0),
    lastWatered,
    fertilizerCharges:  Number(f.fertilizer_charges??0),
    miracleGrowApplied: Boolean(f.miracle_grow_applied),
    revivalCharges:     Number(f.revival_charges??0),
    bottomlessCanActive,
    bottomlessExpiry,
    permanentGpBonus:   Number(f.permanent_gp_bonus??0),
    plantedAt:          Number(f.planted_at_ms??0),
    saplingId:          f.nft_id||f.sapling_id,
    owner:              f.owner,
  };
}

export function parseToolObject(obj){
  const f=obj.content?.fields??{};
  const kind=f.kind||'unknown';
  const meta=ITEMS[kind]||{label:kind,em:'🔧',rarity:0,rarLabel:'Common',desc:''};
  return{ objectId:obj.objectId, objectType:obj.content?.type||obj.type||obj.data?.content?.type||'', kind, charges:Number(f.charges??0), rarity:Number(f.rarity??0), ...meta };
}

// ── PLAYER TRANSACTIONS ───────────────────────────────────────────────────────
export async function plantSeed(nftObjectId, referrer = null, nftStructTypeOverride = null) {
  const tx = new Transaction();

  // Current contract supports two planting paths:
  // - plant_seed consumes an Arboretum Sapling object.
  // - plant_seed_with_nftree<T> uses an NFTree NFT by immutable reference.
  const nftStructType =
    nftStructTypeOverride
    || (typeof window !== 'undefined' && window.ARBORETUM_NFTREE_STRUCT_TYPE)
    || NFTREE.STRUCT_TYPE;
  if(!/^0x[a-fA-F0-9]+::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*(<.*>)?$/.test(String(nftStructType||''))){
    throw new Error('NFTree collection StructType is not configured.');
  }

  const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(GROWTH_DEPOSIT_MIST)]);
  const isSapling = String(nftStructType) === currentObjectType('Sapling');

  tx.moveCall({
    target: `${CONTRACT.PACKAGE_ID}::${CONTRACT.MODULE}::${isSapling?'plant_seed':'plant_seed_with_nftree'}`,
    typeArguments: isSapling ? [] : [nftStructType],
    arguments: [
      tx.object(CONTRACT.REGISTRY_ID),                   // &mut Registry
      tx.object(nftObjectId),                            // Sapling or &NFTree NFT
      payment,                                           // Coin<SUI>
      referrer
        ? tx.pure.option('address', referrer)
        : tx.pure.option('address', null),               // Option<address>
      tx.object(CONTRACT.CLOCK_ID),                      // &Clock
    ],                                                   // TxContext injected by VM
  });

  return signAndExecute(tx);
}

export async function batchPlantSeeds(nfts = [], referrer = null) {
  if(!_address)throw new Error('Wallet not connected');
  const entries=(Array.isArray(nfts)?nfts:[])
    .map((nft)=>({
      objectId:nft?.objectId||nft?.id,
      objectType:nft?.objectType||nft?.content?.type||nft?.type||nft?.data?.content?.type||''
    }))
    .filter((nft)=>nft.objectId);
  if(!entries.length)throw new Error('No available NFTree NFTs selected.');
  if(entries.length>8)throw new Error('A garden can plant up to 8 Seeds at a time.');

  const tx = new Transaction();
  const payments = tx.splitCoins(
    tx.gas,
    entries.map(()=>tx.pure.u64(GROWTH_DEPOSIT_MIST))
  );

  entries.forEach((nft,index)=>{
    const nftStructType =
      nft.objectType
      || (typeof window !== 'undefined' && window.ARBORETUM_NFTREE_STRUCT_TYPE)
      || NFTREE.STRUCT_TYPE;
    if(!/^0x[a-fA-F0-9]+::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*(<.*>)?$/.test(String(nftStructType||''))){
      throw new Error('NFTree collection StructType is not configured.');
    }
    const isSapling = String(nftStructType) === currentObjectType('Sapling');
    tx.moveCall({
      target: `${CONTRACT.PACKAGE_ID}::${CONTRACT.MODULE}::${isSapling?'plant_seed':'plant_seed_with_nftree'}`,
      typeArguments: isSapling ? [] : [nftStructType],
      arguments: [
        tx.object(CONTRACT.REGISTRY_ID),
        tx.object(nft.objectId),
        payments[index],
        referrer
          ? tx.pure.option('address', referrer)
          : tx.pure.option('address', null),
        tx.object(CONTRACT.CLOCK_ID),
      ],
    });
  });

  return signAndExecute(tx);
}

export async function waterSeed(seedObjectId){
  const tx=new Transaction();
  tx.moveCall({target:`${CONTRACT.PACKAGE_ID}::${CONTRACT.MODULE}::water_seed`,arguments:[tx.object(CONTRACT.REGISTRY_ID),tx.object(seedObjectId),tx.object(CONTRACT.CLOCK_ID)]});
  return signAndExecute(tx);
}

export async function applyTool(seedObjectId, toolObjectId) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${CONTRACT.PACKAGE_ID}::${CONTRACT.MODULE}::apply_tool`,
    arguments: [
      tx.object(CONTRACT.REGISTRY_ID), // &mut Registry, if your Move includes it
      tx.object(seedObjectId),
      tx.object(toolObjectId),
      tx.object(CONTRACT.CLOCK_ID),
    ],
  });
  return signAndExecute(tx);
}

export async function reviveSeed(seedObjectId){
  const tx=new Transaction();
  tx.moveCall({target:`${CONTRACT.PACKAGE_ID}::${CONTRACT.MODULE}::revive_seed`,arguments:[tx.object(CONTRACT.REGISTRY_ID),tx.object(seedObjectId),tx.object(CONTRACT.CLOCK_ID)]});
  return signAndExecute(tx);
}

export async function reviveSeedWithTool(seedObjectId, toolObjectId){
  const tx=new Transaction();
  tx.moveCall({target:`${CONTRACT.PACKAGE_ID}::${CONTRACT.MODULE}::revive_seed_with_tool`,arguments:[tx.object(CONTRACT.REGISTRY_ID),tx.object(seedObjectId),tx.object(toolObjectId),tx.object(CONTRACT.CLOCK_ID)]});
  return signAndExecute(tx);
}

export async function abandonSeed(seedObjectId){
  const tx=new Transaction();
  tx.moveCall({target:`${CONTRACT.PACKAGE_ID}::${CONTRACT.MODULE}::abandon_seed`,arguments:[tx.object(CONTRACT.REGISTRY_ID),tx.object(seedObjectId),tx.object(CONTRACT.CLOCK_ID)]});
  return signAndExecute(tx);
}

export async function buyCrate(tier = 0) {
  const price = CRATE_PRICES[tier];
  if (!price) throw new Error("Invalid crate tier");

  const tx = new Transaction();

  // pay in SUI from gas object
  const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(price)]);

  tx.moveCall({
    target: `${CONTRACT.PACKAGE_ID}::${CONTRACT.MODULE}::buy_crate`,
    arguments: [
      tx.object(CONTRACT.REGISTRY_ID), // &mut Registry
      tx.pure.u8(tier),                // u8 tier
      payment,                         // Coin<SUI>
    ],
  });

  return signAndExecute(tx);
}

export async function buySupplyDrop(drop = 0) {
  if (!CONTRACT.SUPPORTS_SUPPLY_DROPS) {
    throw new Error("Supply Drop purchases are not enabled in the current live Arboretum contract.");
  }
  const price = SUPPLY_DROP_PRICES[drop];
  if (!price) throw new Error("Invalid Supply Drop");

  const tx = new Transaction();
  tx.setGasBudget(SUPPLY_DROP_GAS_BUDGET_MIST);
  const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(price)]);

  tx.moveCall({
    target: `${CONTRACT.PACKAGE_ID}::${CONTRACT.MODULE}::buy_supply_drop`,
    arguments: [
      tx.object(CONTRACT.REGISTRY_ID),
      tx.pure.u8(drop),
      payment,
    ],
  });

  return signAndExecute(tx);
}

export async function openCrate(crateObjectId){
  const tx=new Transaction();
  tx.setGasBudget(OPEN_CRATE_GAS_BUDGET_MIST);
  tx.moveCall({target:`${CONTRACT.PACKAGE_ID}::${CONTRACT.MODULE}::open_crate`,arguments:[tx.object(CONTRACT.REGISTRY_ID),tx.object(crateObjectId),tx.object(CONTRACT.RANDOM_ID)]});
  return signAndExecute(tx);
}

export async function claimReward(seedObjectId){
  if(!seedObjectId)throw new Error('Choose a Seed to claim rewards for.');
  const tx=new Transaction();
  tx.moveCall({target:`${CONTRACT.PACKAGE_ID}::${CONTRACT.MODULE}::claim_reward`,arguments:[tx.object(CONTRACT.REGISTRY_ID),tx.object(seedObjectId),tx.object(CONTRACT.CLOCK_ID)]});
  return signAndExecute(tx);
}

export async function claimArchivedReward(seedObjectId,archiveObjectId=getConfiguredSeasonArchiveId()){
  if(!CONTRACT.SUPPORTS_ARCHIVED_SEASON_CLAIMS)throw new Error('Previous-season claims are waiting on the contract upgrade.');
  if(!archiveObjectId)throw new Error('No previous-season archive is configured yet.');
  if(!seedObjectId)throw new Error('Choose a Seed to claim rewards for.');
  const tx=new Transaction();
  tx.moveCall({target:`${CONTRACT.PACKAGE_ID}::${CONTRACT.MODULE}::claim_archived_reward`,arguments:[tx.object(archiveObjectId),tx.object(seedObjectId),tx.object(CONTRACT.CLOCK_ID)]});
  return signAndExecute(tx);
}

export async function batchWaterAllSeeds(){
  if(!_address)throw new Error('Wallet not connected');
  const [allSeeds,registry]=await Promise.all([
    getOwnedObjects(_address,'Seed'),
    getRegistryFields().catch(()=>({})),
  ]);
  const currentSeasonId=Number(registry.current_season_id??0);
  const seasonStarted=Number(registry.season_start_ms??0)>0;
  const seeds=allSeeds.filter((s)=>{
    if(!isCurrentObjectType(s,'Seed'))return false;
    const f=s.content?.fields??{};
    return seasonStarted&&Number(f.claimed_ms??0)===0&&(!currentSeasonId||Number(f.season_id??0)===currentSeasonId);
  });
  const now=Date.now();const minGap=ONE_DAY_MS-ONE_DAY_MS/10;
  const results=allSeeds
    .filter((s)=>!isCurrentObjectType(s,'Seed'))
    .map((s)=>({objectId:s.objectId,ok:false,reason:'legacy'}));
  const readySeeds=[];
  for(const s of seeds){
    const seed=parseSeedObject(s);
    if(seed.rawState===2||seed.state==='dead'){results.push({objectId:s.objectId,ok:false,reason:'dead'});continue;}
    if(seed.bottomlessCanActive){results.push({objectId:s.objectId,ok:false,reason:'auto_protected'});continue;}
    if(now-seed.lastWatered<minGap){results.push({objectId:s.objectId,ok:false,reason:'too_soon'});continue;}
    readySeeds.push(s);
  }
  if(!readySeeds.length)return results;
  const tx=new Transaction();
  tx.setGasBudget(WATER_ALL_GAS_BUDGET_MIST);
  for(const seed of readySeeds.slice(0,8)){
    tx.moveCall({
      target:`${CONTRACT.PACKAGE_ID}::${CONTRACT.MODULE}::water_seed`,
      arguments:[tx.object(CONTRACT.REGISTRY_ID),tx.object(seed.objectId),tx.object(CONTRACT.CLOCK_ID)],
    });
  }
  const result=await signAndExecute(tx);
  for(const seed of readySeeds.slice(0,8))results.push({objectId:seed.objectId,ok:true,result});
  if(readySeeds.length>8){
    for(const seed of readySeeds.slice(8))results.push({objectId:seed.objectId,ok:false,reason:'batch_limit'});
  }
  return results;
}

export async function loadProjectedReward() {
  if (typeof window === 'undefined' || !window.arb) return;

  try {
    const projectedSui = await getProjectedReward(_address);
    const value = projectedSui.toFixed(4) + " SUI";

    txt("h-proj", value);
    txt("d-sui", value);
    txt("roi-pct", value);
    if (typeof window.syncRewardsHub === "function") window.syncRewardsHub();
  } catch (e) {
    console.error("Projected reward error", e);
    txt("h-proj", "0.0000 SUI");
    txt("d-sui", "0.0000 SUI");
    txt("roi-pct", "0.0000 SUI");
    if (typeof window.syncRewardsHub === "function") window.syncRewardsHub();
  }
}

// ── ADMIN TRANSACTIONS ────────────────────────────────────────────────────────
function getAdminCapId(){
  const id=typeof window!=='undefined'?(window.ARBORETUM_ADMIN_CAP||CONTRACT.ADMIN_CAP_ID):CONTRACT.ADMIN_CAP_ID;
  if(!/^0x[a-fA-F0-9]{64}$/.test(String(id||'')))throw new Error('AdminCap is not configured for this build.');
  return id;
}

export async function adminStartSeason(){ if(!isAdmin())throw new Error('Not admin'); const tx=new Transaction(); tx.moveCall({target:`${CONTRACT.PACKAGE_ID}::${CONTRACT.MODULE}::start_season`,arguments:[tx.object(getAdminCapId()),tx.object(CONTRACT.REGISTRY_ID),tx.object(CONTRACT.CLOCK_ID)]}); return signAndExecute(tx); }
export async function adminStartSeasonForDuration(durationMs){ if(!isAdmin())throw new Error('Not admin'); if(!CONTRACT.SUPPORTS_MONTHLY_DURATION_START)throw new Error('Monthly cycle start is waiting on the contract upgrade.'); const duration=BigInt(Math.max(1,Math.floor(Number(durationMs||0)))); const tx=new Transaction(); tx.moveCall({target:`${CONTRACT.PACKAGE_ID}::${CONTRACT.MODULE}::start_season_for_duration`,arguments:[tx.object(getAdminCapId()),tx.object(CONTRACT.REGISTRY_ID),tx.object(CONTRACT.CLOCK_ID),tx.pure.u64(duration)]}); return signAndExecute(tx); }
export async function adminResetSeason(){ if(!isAdmin())throw new Error('Not admin'); const fn=CONTRACT.SUPPORTS_EARLY_SEASON_ARCHIVE?'finalize_season_archive_now':'reset_season'; const tx=new Transaction(); tx.moveCall({target:`${CONTRACT.PACKAGE_ID}::${CONTRACT.MODULE}::${fn}`,arguments:[tx.object(getAdminCapId()),tx.object(CONTRACT.REGISTRY_ID),tx.object(CONTRACT.CLOCK_ID)]}); const result=await signAndExecute(tx); return{...result,archive:parseSeasonArchiveEvent(result)}; }
export async function adminSetPaused(p){ if(!isAdmin())throw new Error('Not admin'); const tx=new Transaction(); tx.moveCall({target:`${CONTRACT.PACKAGE_ID}::${CONTRACT.MODULE}::set_paused`,arguments:[tx.object(getAdminCapId()),tx.object(CONTRACT.REGISTRY_ID),tx.pure.bool(Boolean(p))]}); return signAndExecute(tx); }
export async function adminDepositToPool(amountMist){ if(!isAdmin())throw new Error('Not admin'); const tx=new Transaction(); const[coin]=tx.splitCoins(tx.gas,[tx.pure.u64(BigInt(amountMist))]); tx.moveCall({target:`${CONTRACT.PACKAGE_ID}::${CONTRACT.MODULE}::deposit_to_pool`,arguments:[tx.object(getAdminCapId()),tx.object(CONTRACT.REGISTRY_ID),coin]}); return signAndExecute(tx); }
export async function adminWithdrawTreasury(amountMist){ if(!isAdmin())throw new Error('Not admin'); const tx=new Transaction(); tx.moveCall({target:`${CONTRACT.PACKAGE_ID}::${CONTRACT.MODULE}::withdraw_treasury`,arguments:[tx.object(getAdminCapId()),tx.object(CONTRACT.REGISTRY_ID),tx.pure.u64(BigInt(amountMist))]}); return signAndExecute(tx); }
export async function adminSendPromoCrate(recipient,tier=0){ if(!isAdmin())throw new Error('Not admin'); if(!/^0x[a-fA-F0-9]{64}$/.test(String(recipient||'')))throw new Error('Enter a valid recipient wallet address.'); const n=Number(tier); if(!Number.isInteger(n)||n<0||n>4)throw new Error('Choose a valid crate tier.'); const tx=new Transaction(); tx.moveCall({target:`${CONTRACT.PACKAGE_ID}::${CONTRACT.MODULE}::send_promo_crate`,arguments:[tx.object(getAdminCapId()),tx.object(CONTRACT.REGISTRY_ID),tx.pure.address(recipient),tx.pure.u8(n)]}); return signAndExecute(tx); }

function assertCanopyChallengesSupported(){
  if(!CONTRACT.SUPPORTS_CANOPY_CHALLENGES)throw new Error('Daily Canopy Challenges are coming soon.');
}

export async function adminCreateChallengeBook(){
  if(!isAdmin())throw new Error('Not admin');
  assertCanopyChallengesSupported();
  const tx=new Transaction();
  tx.moveCall({target:`${CONTRACT.PACKAGE_ID}::${CONTRACT.MODULE}::create_challenge_book`,arguments:[tx.object(getAdminCapId()),tx.object(CONTRACT.REGISTRY_ID)]});
  const result=await signAndExecute(tx);
  const bookId=parseChallengeEventObjectId(result,'ChallengeBookCreated','book_id');
  if(bookId&&typeof window!=='undefined')localStorage.setItem('arb_challenge_book_id',bookId);
  return{...result,bookId};
}

export async function adminOpenCanopySprint(){
  if(!isAdmin())throw new Error('Not admin');
  assertCanopyChallengesSupported();
  const bookId=configuredChallengeBookId() || (typeof window!=='undefined'?localStorage.getItem('arb_challenge_book_id'):'');
  if(!bookId)throw new Error('ChallengeBook is not configured yet.');
  const tx=new Transaction();
  tx.moveCall({target:`${CONTRACT.PACKAGE_ID}::${CONTRACT.MODULE}::open_canopy_sprint`,arguments:[tx.object(getAdminCapId()),tx.object(bookId),tx.object(CONTRACT.REGISTRY_ID),tx.object(CONTRACT.CLOCK_ID)]});
  const result=await signAndExecute(tx);
  const challengeId=parseChallengeEventObjectId(result,'ChallengeOpened','challenge_object_id');
  if(challengeId&&typeof window!=='undefined')localStorage.setItem('arb_active_canopy_challenge_id',challengeId);
  return{...result,challengeId};
}

export async function enterCanopySprint(challengeObjectId=null){
  assertCanopyChallengesSupported();
  const id=challengeObjectId||configuredCanopyChallengeId();
  if(!id)throw new Error('No active Canopy Sprint is configured.');
  const tx=new Transaction();
  const [payment]=tx.splitCoins(tx.gas,[tx.pure.u64(CANOPY_CHALLENGE_ENTRY_MIST)]);
  tx.moveCall({target:`${CONTRACT.PACKAGE_ID}::${CONTRACT.MODULE}::enter_canopy_sprint`,arguments:[tx.object(id),tx.object(CONTRACT.REGISTRY_ID),payment,tx.object(CONTRACT.CLOCK_ID)]});
  return signAndExecute(tx);
}

export async function adminFinalizeCanopySprint(challengeObjectId,first,second,third){
  if(!isAdmin())throw new Error('Not admin');
  assertCanopyChallengesSupported();
  const bookId=configuredChallengeBookId() || (typeof window!=='undefined'?localStorage.getItem('arb_challenge_book_id'):'');
  const id=challengeObjectId||configuredCanopyChallengeId();
  if(!bookId)throw new Error('ChallengeBook is not configured yet.');
  if(!id)throw new Error('No Canopy Sprint object is configured.');
  for(const addr of [first,second,third]){
    if(!/^0x[a-fA-F0-9]{64}$/.test(String(addr||'')))throw new Error('Enter valid winner wallet addresses.');
  }
  const tx=new Transaction();
  tx.moveCall({target:`${CONTRACT.PACKAGE_ID}::${CONTRACT.MODULE}::finalize_canopy_sprint`,arguments:[tx.object(getAdminCapId()),tx.object(bookId),tx.object(id),tx.object(CONTRACT.REGISTRY_ID),tx.pure.address(first),tx.pure.address(second),tx.pure.address(third),tx.object(CONTRACT.CLOCK_ID)]});
  return signAndExecute(tx);
}

export async function adminCancelCanopySprint(challengeObjectId=null){
  if(!isAdmin())throw new Error('Not admin');
  assertCanopyChallengesSupported();
  const bookId=configuredChallengeBookId() || (typeof window!=='undefined'?localStorage.getItem('arb_challenge_book_id'):'');
  const id=challengeObjectId||configuredCanopyChallengeId();
  if(!bookId)throw new Error('ChallengeBook is not configured yet.');
  if(!id)throw new Error('No Canopy Sprint object is configured.');
  const tx=new Transaction();
  tx.moveCall({target:`${CONTRACT.PACKAGE_ID}::${CONTRACT.MODULE}::cancel_canopy_sprint`,arguments:[tx.object(getAdminCapId()),tx.object(bookId),tx.object(id),tx.object(CONTRACT.CLOCK_ID)]});
  return signAndExecute(tx);
}

export async function refundCanopySprintEntry(challengeObjectId=null){
  assertCanopyChallengesSupported();
  const id=challengeObjectId||configuredCanopyChallengeId();
  if(!id)throw new Error('No Canopy Sprint object is configured.');
  const tx=new Transaction();
  tx.moveCall({target:`${CONTRACT.PACKAGE_ID}::${CONTRACT.MODULE}::refund_canceled_canopy_sprint_entry`,arguments:[tx.object(id)]});
  return signAndExecute(tx);
}

// ── WINDOW EXPORTS ────────────────────────────────────────────────────────────
if(typeof window!=='undefined'){
  Object.assign(window,{
    connectWallet,disconnectWallet,initializeWallet,
    getBalance:getSuiBalance,
    _getInstalledWallets: getInstalledWallets,
    getSeasonStats,
    getProjectedReward,
    getTotalRewardsCollected,
    loadProjectedReward,
    parseSeedObject,
    arb:{
      plantSeed,batchPlantSeeds,waterSeed,applyTool,reviveSeed,reviveSeedWithTool,abandonSeed,buyCrate,buySupplyDrop,openCrate,claimReward,claimArchivedReward,batchWaterAllSeeds,
      adminStartSeason,adminStartSeasonForDuration,adminResetSeason,adminSetPaused,adminDepositToPool,adminWithdrawTreasury,adminSendPromoCrate,
      getCanopyChallengeState,enterCanopySprint,refundCanopySprintEntry,adminCreateChallengeBook,adminOpenCanopySprint,adminFinalizeCanopySprint,adminCancelCanopySprint,
      getOwnedObjects,getOwnedObjectsByStructType,getAllObjectsByStructType,getObjectById,getOwnedNftreeNfts,checkWalletNftreeAccess,getRegistryFields,getSeasonStats,getSeasonArchive,getConfiguredSeasonArchiveId,getProjectedReward,getTotalRewardsCollected,
      getEventsByType,parseSeedObject,parseToolObject,getSuiBalance,isAdmin,getAddress,getClient,getInstalledWallets,resolveSuiName,
      CONTRACT,NFTREE,ADMIN_WALLETS,ITEMS,CRATES,CRATE_PRICES,SUPPLY_DROP_PRICES,GROWTH_DEPOSIT_MIST,ONE_DAY_MS,CANOPY_CHALLENGE_ENTRY_MIST,WILT_DAYS,DEATH_DAYS,
    },
  });
  window._walletReady = true;
  document.dispatchEvent(new Event('wallet-sdk-ready'));
}
