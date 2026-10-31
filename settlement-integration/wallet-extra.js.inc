// Settlement integration exports. Each reward view is a single checkpoint snapshot.
export function getProtocolRoutes() {
  return Object.values(PROTOCOL_ROUTES).map(route=>({
    id:route.id,label:route.label,available:route.available,reason:route.reason,
    selected:route.id===CONTRACT.id,href:route.id==='legacy'?'/game.html':'/settlement-game.html',
  }));
}
export function getIntegrationStatus() { return {reviewOnly:REVIEW_ONLY,protocol:CONTRACT.id}; }
export async function getRewardOptions(owner=_address) {
  const snap=await integrationReader.state(CONTRACT.REGISTRY_ID);
  if(!objectMatchesRoute(snap.registry,CONTRACT,'Registry'))throw new Error('Garden identity mismatch.');
  const seeds=owner?await protocolOwned(owner,'Seed',snap.checkpoint):[];
  if(!SETTLEMENT_MODE)return{protocol:'legacy',checkpoint:snap.checkpoint,nowMs:snap.nowMs,
    entries:seeds.map(seed=>({seed:parseSeedObject(seed),archiveId:null,
      reward:rewardState(seed,snap.registry,{route:CONTRACT,nowMs:snap.nowMs})}))};
  const archives=(await integrationReader.all(routeType(CONTRACT,'SeasonArchive'),10000,snap.checkpoint))
    .filter(obj=>objectMatchesRoute(obj,CONTRACT,'SeasonArchive',{registryBound:true}));
  const entries=seeds.map(seed=>{
    const f=moveFields(seed);
    const current=String(f.season_id)===String(moveFields(snap.registry).current_season_id);
    const matching=archives.filter(obj=>String(moveFields(obj).season_id)===String(f.season_id));
    const archive=!current&&matching.length===1?matching[0]:null;
    const ledger=current?snap.registry:archive;
    const reward=ledger?rewardState(seed,ledger,{route:CONTRACT,nowMs:snap.nowMs,archive:!!archive})
      :{status:'unknown',label:'History unavailable',claimable:false,processable:false,amountMist:null,
        reason:'A unique matching season archive could not be verified.'};
    return{seed:parseSeedObject(seed),archiveId:archive?.objectId||null,reward};
  });
  return{protocol:'settlement',checkpoint:snap.checkpoint,nowMs:snap.nowMs,entries};
}
async function requireProcessableSeed(seedId,archiveId) {
  if(!_account?.address)throw new Error('Wallet not connected.');
  const view=await getRewardOptions(_account.address);
  const row=view.entries.find(item=>canonicalAddress(item.seed.objectId)===canonicalAddress(seedId)
    &&(archiveId?canonicalAddress(item.archiveId)===canonicalAddress(archiveId):!item.archiveId));
  if(!row?.reward.processable)throw new Error(row?.reward.reason||row?.reward.label||'This Seed has no processable reward in the selected garden.');
  return row;
}
function requireSettlementReceipt(result,owner,seedId,expected) {
  const receipts=(result.events||[]).filter(event=>event.type===routeType(CONTRACT,'RewardEntitlementProcessed')
    &&sameClaimAddress(event.parsedJson?.registry_id,CONTRACT.REGISTRY_ID)
    &&sameClaimAddress(event.parsedJson?.seed_id,seedId)
    &&sameClaimAddress(event.parsedJson?.owner,owner));
  const receipt=receipts.length===1?receipts[0].parsedJson:null;
  if(!receipt||!expected?.reward?.processable
    ||canonicalClaimMist(receipt.season_id)!==expected.reward.seasonId
    ||canonicalClaimMist(receipt.eligible_growth_points)!==expected.reward.eligibleGP
    ||canonicalClaimMist(receipt.amount_mist)!==expected.reward.amountMist){
    throw transactionOutcomeError('CLAIM_PAYOUT_UNCONFIRMED',
      'The transaction was confirmed, but this Seed settlement receipt could not be verified. Check it before another claim.',result.digest);
  }
  const amount=canonicalClaimMist(receipts[0].parsedJson.amount_mist);
  return{...result,reward:{processed:true,paid:amount>0n,amountMist:amount.toString()}};
}

