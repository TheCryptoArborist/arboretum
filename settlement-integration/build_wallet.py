"""Build a separate review wallet, preserving the accepted wallet source."""
from pathlib import Path
import hashlib
import sys

ROOT = Path(__file__).resolve().parent.parent
INPUT_WALLET = "ce600b052fcb87098ec001ebb57e33709d676d8d0562d7092e5d5081b295119f"

def transform(source, route_id="legacy"):
    if route_id not in ("legacy", "settlement"):
        raise ValueError("Unknown garden route")
    if hashlib.sha256(source.encode()).hexdigest() != INPUT_WALLET:
        raise ValueError("Unexpected wallet source; review it before rebuilding")
    code = source
    def once(before, after):
        nonlocal code
        if code.count(before) != 1:
            raise ValueError("Wallet anchor is not unique: " + before[:75])
        code = code.replace(before, after)
    def section(start, end, replacement):
        nonlocal code
        if code.count(start) != 1:
            raise ValueError("Wallet section is not unique: " + start)
        a = code.index(start)
        b = code.index(end, a + len(start))
        code = code[:a] + replacement + "\n\n" + code[b:]

    once("import { getWallets, SuiClient, Transaction } from './sui-sdk.bundle.js';",
         """import { getWallets, SuiGrpcClient, Transaction, bcs } from './settlement-sdk.bundle.js';
import { createReader } from './settlement-integration/reader.mjs';
import { makeRoutes, selectRoute, routeType, objectMatchesRoute, normalizeSettlementFields, rewardState, canonicalAddress, moveFields, u64 } from './settlement-integration/model.mjs';
import { SETTLEMENT_DEPLOYMENT, REVIEW_ONLY } from './settlement-integration/deployment-config.mjs';
const integrationReader = createReader();""")
    once("export const CONTRACT = {", "const LEGACY_CONTRACT = {")
    once("export const NFTREE = {", """
const PROTOCOL_ROUTES = makeRoutes({...LEGACY_CONTRACT, TYPE_ORIGINS: {
  SeasonArchive: '0x98377567410480b96dec45d1d22de11ac967c69425391f58c6099351fed0f940',
  ArchivedRewardClaimed: '0x98377567410480b96dec45d1d22de11ac967c69425391f58c6099351fed0f940',
  SeasonArchived: '0x98377567410480b96dec45d1d22de11ac967c69425391f58c6099351fed0f940',
}}, SETTLEMENT_DEPLOYMENT);
export const CONTRACT = selectRoute(PROTOCOL_ROUTES, '""" + route_id + """');
const SETTLEMENT_MODE = CONTRACT.id === 'settlement';

export const NFTREE = {""")
    once("new SuiClient({url:RPC_URL})", "new SuiGrpcClient({network:NETWORK,baseUrl:RPC_URL})")
    once("export async function signAndExecute(tx) {\n",
         """export async function signAndExecute(tx) {
  if (REVIEW_ONLY) throw new Error('This integration preview does not submit transactions.');
""")
    section("async function gql(query,variables={})", "function gqlObjectToSuiData(", """
async function gql(query,variables={}) { return integrationReader.query(query,variables); }
""")
    section("export async function resolveSuiName(", "function mistNumber(", """
export async function resolveSuiName(addr) {
  if (!addr) return '';
  const address = canonicalAddress(addr);
  if (_suinsCache.has(address)) return _suinsCache.get(address);
  const result = await integrationReader.query(
    'query IntegrationName($address:SuiAddress!){address(address:$address){defaultNameRecord{domain}}}', {address});
  const name = String(result.address?.defaultNameRecord?.domain || '');
  _suinsCache.set(address, name);
  return name;
}""")
    section("function currentObjectType(", "function isCurrentObjectType(", """
function currentObjectType(structType) { return routeType(CONTRACT, structType); }""")
    section("async function gqlOwnedObjectsByType(", "export async function getSuiBalance(", """
async function gqlOwnedObjectsByType(owner, type) { return integrationReader.owned(owner, type); }
async function fullnodeOwnedObjectsByType(owner, type) { return integrationReader.owned(owner, type); }
async function gqlObjectById(id) { return integrationReader.object(id); }
async function gqlAllObjectsByType(type, limit = 10000) { return integrationReader.all(type, limit); }""")
    section("export async function getSuiBalance(", "export async function getOwnedObjects(addr,structType)", """
export async function getSuiBalance(addr=_address) {
  const address=canonicalAddress(addr);
  if(!address)throw new Error('No valid address.');
  const data=await integrationReader.query(
    'query IntegrationBalance($address:SuiAddress!){address(address:$address){balance(coinType:"0x2::sui::SUI"){totalBalance}}}',{address});
  return u64(data?.address?.balance?.totalBalance,'SUI balance');
}""")
    section("export async function getOwnedObjects(addr,structType)", "export async function getObjectById(", """
function protocolTypes(structType) {
  if (SETTLEMENT_MODE || CONTRACT.TYPE_ORIGINS?.[structType]) return [routeType(CONTRACT, structType)];
  return [...new Set([...(CONTRACT.TYPE_PACKAGE_IDS || []), CONTRACT.TYPE_PACKAGE_ID])]
    .filter(Boolean).map(origin => origin + '::' + CONTRACT.MODULE + '::' + structType);
}
function belongsToSelectedGarden(obj, structType) {
  return !SETTLEMENT_MODE || objectMatchesRoute(obj, CONTRACT, structType,
    {registryBound: ['Seed','SeasonArchive','AdminCap','ChallengeBook','CanopyChallenge'].includes(structType)});
}
async function protocolOwned(owner, structType, cp = null) {
  const out = [], seen = new Set();
  for (const type of protocolTypes(structType)) {
    for (const obj of await integrationReader.owned(owner, type, cp)) {
      if (structType==='Seed' && canonicalAddress(moveFields(obj).owner)!==canonicalAddress(owner)) {
        throw new Error('The Seed owner does not match the connected wallet.');
      }
      if (!seen.has(obj.objectId) && belongsToSelectedGarden(obj, structType)) {
        seen.add(obj.objectId); out.push(obj);
      }
    }
  }
  return out;
}
export async function getOwnedObjects(addr, structType) {
  if (!addr) throw new Error('No address');
  return protocolOwned(addr, structType);
}""")
    section("export async function getObjectsByIds(", "function fieldObjectId(", """
export async function getObjectsByIds(objectIds = []) {
  const objects = await Promise.all([...new Set(objectIds.filter(Boolean))].map(id => integrationReader.object(id)));
  return objects.filter(Boolean);
}
async function getDynamicFieldObject(parentId, nameType, nameValue) {
  const bytes = nameType === 'address' ? bcs.Address.serialize(nameValue).toBytes()
    : nameType === 'u64' ? bcs.u64().serialize(BigInt(nameValue)).toBytes() : null;
  if (!bytes) throw new Error('Unsupported dynamic-field key type.');
  const result = await _client().core.getDynamicField({parentId, name:{type:nameType,bcs:bytes}});
  return integrationReader.object(result.dynamicField.fieldId);
}""")

    once("const suffix='::SeasonArchived';\n  const ev=(result?.events||[]).find((e)=>String(e.type||'').endsWith(suffix));",
         "const ev=(result?.events||[]).find((e)=>e.type===routeType(CONTRACT,'SeasonArchived'));")
    for key in ("arb_last_season_archive_id", "arb_last_season_archive_season_id", "arb_last_season_archive_deadline_ms"):
        code = code.replace("'" + key + "'", "'" + key + ":' + CONTRACT.REGISTRY_ID")
    once("const win=typeof window!=='undefined'?String(window.ARBORETUM_SEASON_ARCHIVE_ID||''):'';",
         "const win=SETTLEMENT_MODE?String(CONTRACT.SEASON_ARCHIVE_ID||''):(typeof window!=='undefined'?String(window.ARBORETUM_SEASON_ARCHIVE_ID||''):'');")
    once("  const obj=await getObjectById(archiveObjectId);\n  const f=obj?.content?.fields||{};", """
  const obj=await getObjectById(archiveObjectId);
  if (!obj || !objectMatchesRoute(obj,CONTRACT,'SeasonArchive',{registryBound:SETTLEMENT_MODE})) throw new Error('This archive belongs to a different garden.');
  const f=obj.content.fields;
  if(SETTLEMENT_MODE){
    const snap=await integrationReader.state(CONTRACT.REGISTRY_ID);
    const n=normalizeSettlementFields(obj,{archive:true,route:CONTRACT,nowMs:snap.nowMs});
    return {objectId:archiveObjectId,seasonId:Number(n.seasonId),seasonStartMs:Number(n.seasonStartMs),
      seasonEndMs:Number(n.seasonEndMs),claimDeadlineMs:Number(n.claimDeadlineMs),
      totalGrowthPoints:Number(n.eligibleGP),totalSeeds:Number(f.total_seeds),
      rewardPoolSui:formatSuiFromMist(n.remainingPoolMist),swept:n.swept};
  }""")
    section("export async function getRegistryFields()", "export async function getSeasonStats()", """
export async function getRegistryFields() {
  const obj=await integrationReader.object(CONTRACT.REGISTRY_ID);
  if(!obj || !objectMatchesRoute(obj,CONTRACT,'Registry')) throw new Error('The selected garden Registry could not be verified.');
  return obj.content.fields;
}
export async function getEventsByType(type,limit=10000) { return integrationReader.events(type,limit); }
export async function getAllObjectsByStructType(structType,limit=10000) {
  const out=[],seen=new Set();
  for(const type of protocolTypes(structType)) for(const obj of await integrationReader.all(type,limit)) {
    if(!seen.has(obj.objectId) && belongsToSelectedGarden(obj,structType)) {seen.add(obj.objectId);out.push(obj);}
  }
  return out;
}""")
    once("  const f=await getRegistryFields();\n  const startMs=Number(f.season_start_ms??0);\n  const now=Date.now();", """
  const snap=await integrationReader.state(CONTRACT.REGISTRY_ID);
  if(!objectMatchesRoute(snap.registry,CONTRACT,'Registry')) throw new Error('The selected garden could not be verified.');
  const f=snap.registry.content.fields;
  if(SETTLEMENT_MODE) {
    const n=normalizeSettlementFields(snap.registry,{route:CONTRACT,nowMs:snap.nowMs});
    return {
      totalSeeds:Number(f.total_seeds),totalGrowthPoints:Number(n.frozen?n.eligibleGP:n.totalGP),
      rewardPoolSui:formatSuiFromMist(n.remainingPoolMist),treasurySui:formatSuiFromMist(f.treasury),
      currentSeasonId:Number(n.seasonId),seasonStartMs:Number(n.seasonStartMs),seasonEndMs:Number(n.seasonEndMs),
      claimDeadlineMs:Number(n.claimDeadlineMs),reviewReadyMs:Number(n.seasonEndMs)+ONE_DAY_MS,paused:n.paused,
      daysLeft:Math.max(0,Math.floor((Number(n.seasonEndMs)-snap.nowMs)/ONE_DAY_MS)),
      progressPct:n.seasonStartMs>0n?Math.min(100,Math.max(0,(snap.nowMs-Number(n.seasonStartMs))/Number(SEASON_MS)*100)).toFixed(1):'0.0',
      claimable:n.claimWindowOpen,admin:f.admin,protocol:'settlement',originalPoolMist:n.poolMist.toString(),
      eligibleGrowthPoints:n.eligibleGP.toString(),finalized:n.finalized,checkpoint:snap.checkpoint};
  }
  const startMs=Number(f.season_start_ms??0);
  const now=snap.nowMs;""")
    section("export async function getProjectedReward(", "export async function getPlayerCurrentGrowthPoints(", """
export async function getProjectedReward(addr=_address) {
  if(!addr) return null;
  const view=await getRewardOptions(addr);
  if(!SETTLEMENT_MODE || view.entries.some(row=>row.reward.status==='unknown')) return null;
  const amount=view.entries.reduce((sum,row)=>sum+
    (['estimate','claimable','zero_entitlement'].includes(row.reward.status)?(row.reward.amountMist||0n):0n),0n);
  return Number(amount)/1e9;
}
export async function getTotalRewardsCollected(addr=_address,limit=10000) {
  if(!addr) return 0;
  const owner=canonicalAddress(addr),seen=new Set();
  const names=SETTLEMENT_MODE?['RewardEntitlementProcessed']:['RewardClaimed','ArchivedRewardClaimed'];
  let total=0n;
  for(const name of names) for(const type of protocolTypes(name)) {
    for(const event of await integrationReader.events(type,limit)) {
      if(event.type!==type)continue;
      const f=event.parsedJson||{};
      if(seen.has(event.id) || canonicalAddress(f.owner)!==owner) continue;
      if(SETTLEMENT_MODE && canonicalAddress(f.registry_id)!==canonicalAddress(CONTRACT.REGISTRY_ID)) continue;
      total+=u64(f.amount_mist,'confirmed payout');seen.add(event.id);
    }
  }
  return Number(total)/1e9;
}""")
    section("export async function getPlayerCurrentGrowthPoints(", "export async function getCanopyChallengeState(", """
export async function getPlayerCurrentGrowthPoints(addr=_address) {
  if(!addr)return 0;
  const snap=await integrationReader.state(CONTRACT.REGISTRY_ID);
  if(!objectMatchesRoute(snap.registry,CONTRACT,'Registry'))throw new Error('The selected garden could not be verified.');
  const fields=moveFields(snap.registry);
  const season=u64(fields.current_season_id,'Season');
  if(u64(fields.season_start_ms,'Season start')===0n)return 0;
  let total=0n;
  for(const seed of await protocolOwned(addr,'Seed',snap.checkpoint)) {
    if(!isCurrentObjectType(seed,'Seed'))continue;
    const f=moveFields(seed);
    if(u64(f.season_id,'Seed season')===season)total+=u64(f.growth_points,'Growth Points');
  }
  if(total>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Growth Points exceed the display precision.');
  return Number(total);
}""")
    once("    state, rawState, droughtDays, actualDroughtDays,", """
    state, rawState, droughtDays, actualDroughtDays,
    registryId:f.registry_id||null,cutoffGrowthPoints:f.cutoff_growth_points??null,
    rewardProcessed:f.reward_processed??null,protocol:CONTRACT.id,rawFields:f,""")

    once("      payment,                         // Coin<SUI>\n",
         "      payment,                         // Coin<SUI>\n      ...(SETTLEMENT_MODE?[tx.object(CONTRACT.CLOCK_ID)]:[]),\n")
    once("      payment,\n    ],\n  });\n  return signAndExecute(tx);",
         "      payment,\n      ...(SETTLEMENT_MODE?[tx.object(CONTRACT.CLOCK_ID)]:[]),\n    ],\n  });\n  return signAndExecute(tx);")
    once("      tx.pure.u8(drop),\n      payment,\n",
         "      tx.pure.u8(drop),\n      payment,\n      ...(SETTLEMENT_MODE?[tx.object(CONTRACT.CLOCK_ID)]:[]),\n")
    once("arguments:[tx.object(getAdminCapId()),tx.object(CONTRACT.REGISTRY_ID),coin]",
         "arguments:[tx.object(getAdminCapId()),tx.object(CONTRACT.REGISTRY_ID),coin,...(SETTLEMENT_MODE?[tx.object(CONTRACT.CLOCK_ID)]:[])]")
    import re
    code=re.sub(r"^\s*tx\.setGasBudget\((?:SUPPLY_DROP_GAS_BUDGET_MIST|OPEN_CRATE_GAS_BUDGET_MIST|WATER_ALL_GAS_BUDGET_MIST)\);","",code,flags=re.M)
    once("  const id=typeof window!=='undefined'?(window.ARBORETUM_ADMIN_CAP||CONTRACT.ADMIN_CAP_ID):CONTRACT.ADMIN_CAP_ID;",
         "  const id=SETTLEMENT_MODE?CONTRACT.ADMIN_CAP_ID:(typeof window!=='undefined'?(window.ARBORETUM_ADMIN_CAP||CONTRACT.ADMIN_CAP_ID):CONTRACT.ADMIN_CAP_ID);")
    once("export async function claimReward(seedObjectId){\n",
         "export async function claimReward(seedObjectId){\n  const expected=SETTLEMENT_MODE?await requireProcessableSeed(seedObjectId,null):null;\n")
    once("export async function claimArchivedReward(seedObjectId,archiveObjectId=getConfiguredSeasonArchiveId()){\n",
         "export async function claimArchivedReward(seedObjectId,archiveObjectId=getConfiguredSeasonArchiveId()){\n  const expected=SETTLEMENT_MODE?await requireProcessableSeed(seedObjectId,archiveObjectId):null;\n")
    once("  return requireRewardReceipt(result,owner,seedObjectId);", "  return SETTLEMENT_MODE?requireSettlementReceipt(result,owner,seedObjectId,expected):requireRewardReceipt(result,owner,seedObjectId);")
    once("  return requireRewardReceipt(result,owner,seedObjectId,archiveObjectId);", "  return SETTLEMENT_MODE?requireSettlementReceipt(result,owner,seedObjectId,expected):requireRewardReceipt(result,owner,seedObjectId,archiveObjectId);")
    once('const value = projectedSui.toFixed(4) + " SUI";',
         'const value = projectedSui==null ? "Under review" : projectedSui.toFixed(4) + " SUI";')
    for key in ("h-proj","d-sui","roi-pct"):
        code=code.replace('txt("'+key+'", "0.0000 SUI");','txt("'+key+'", "Unavailable");')
    once("      CONTRACT,NFTREE,ADMIN_WALLETS,ITEMS,CRATES,",
         "      getProtocolRoutes,getRewardOptions,getIntegrationStatus,\n      CONTRACT,NFTREE,ADMIN_WALLETS,ITEMS,CRATES,")
    additions=(ROOT/"settlement-integration/wallet-extra.js.inc").read_text()
    once("// ── WINDOW EXPORTS", additions+"\n// ── WINDOW EXPORTS")
    if re.search(r"\bSuiClient\b|\.getOwnedObjects\(|\.multiGetObjects\(|\.getDynamicFieldObject\(",code):
        raise ValueError("Retired read API survived the integration transform")
    return code

if __name__=="__main__":
    target=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/"dist/wallet.js"
    route=sys.argv[2] if len(sys.argv)>2 else "legacy"
    result=transform((ROOT/"wallet.js").read_text(),route)
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(result)
    print("Built "+str(target)+" ("+route+" review route)")

