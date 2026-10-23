"""Add the settlement review UI to emitted game HTML, never to source inputs.

Usage: python settlement-integration/ui/transform_game.py dist/game.html legacy
The caller supplies the correct compiled wallet and copies panel.mjs/panel.css
to /settlement-panel.mjs and /settlement-panel.css in the emitted site.
"""
from pathlib import Path
import hashlib
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
MARKER = 'data-settlement-review="true"'

BANNER = '''
<aside class="sr-banner" aria-label="Integration review">
  <div class="sr-banner-copy"><span class="sr-eyebrow">Arboretum · Integration review</span>
    <strong>Explore your garden. Review the reward state.</strong>
    <p>This review build connects to wallets and reads the Sui network. Transactions are disabled.</p>
  </div>
  <nav id="sr-routes" class="sr-routes" aria-label="Garden protocol">
    <a class="sr-route" href="/game.html">Existing garden <small>Default route</small></a>
    <span class="sr-route sr-route-unavailable" aria-disabled="true">New seasons <small>Unavailable · awaiting activation</small></span>
  </nav>
</aside>
'''

PANEL = '''
    <section id="settlement-rewards" class="sr-panel" aria-labelledby="sr-title" tabindex="-1">
      <div class="sr-panel-heading">
        <div><span class="sr-eyebrow">Wallet reward review</span><h3 id="sr-title">Your season rewards</h3>
          <p id="sr-intro">Connect your wallet to read the reward status of its Seeds in the selected garden.</p></div>
        <span class="sr-badge sr-badge-review">Review only</span>
      </div>
      <div class="sr-overview">
        <div><span>Garden</span><strong id="sr-protocol">Unavailable</strong></div>
        <div><span>Connected wallet</span><strong id="sr-owner">Not connected</strong></div>
        <div><span>Owned Seeds</span><strong id="sr-count">Unavailable</strong></div>
      </div>
      <div class="sr-toolbar">
        <div class="sr-actions"><button type="button" class="sr-button sr-button-primary" id="sr-connect">Connect wallet</button>
          <button type="button" class="sr-button" id="sr-refresh">Refresh reward data</button></div>
        <span id="sr-read-status" role="status">Reward reader is loading.</span>
      </div>
      <p id="sr-action-note" class="sr-callout" hidden role="status"></p>
      <div id="sr-state" class="sr-state" role="status">Unavailable until the wallet reader is ready.</div>
      <div id="sr-entries" class="sr-entries" aria-label="Seed reward states"></div>
      <details id="sr-evidence" class="sr-evidence" hidden><summary>Read verification</summary>
        <dl><div><dt>Checkpoint</dt><dd id="sr-checkpoint">Unavailable</dd></div>
          <div><dt>Network time</dt><dd id="sr-network-time">Unavailable</dd></div>
          <div><dt>Wallet</dt><dd id="sr-owner-full">Unavailable</dd></div></dl>
        <p>These Seeds, their reward records, and the network clock were read at the same checkpoint. Refresh for a new snapshot.</p>
      </details>
      <p class="sr-footnote">A processed Seed needs its matching receipt before the amount paid can be shown. A verified zero and an unavailable amount are shown separately.</p>
      <p class="sr-footnote">Observed payouts include verified receipts returned by the data provider. Older history may be incomplete, so this is not a guaranteed lifetime total.</p>
    </section>
'''


def transform(source, route_id="legacy"):
    if route_id not in ("legacy", "settlement"):
        raise ValueError("Unknown garden route")
    if MARKER in source:
        raise ValueError("The emitted game already has the settlement review transform")
    code = source

    def once(before, after):
        nonlocal code
        if code.count(before) != 1:
            raise ValueError("Review UI anchor is not unique: " + before[:90])
        code = code.replace(before, after, 1)

    def section(start, end, replacement):
        nonlocal code
        if code.count(start) != 1 or code.count(end) != 1:
            raise ValueError("Review UI section is not unique: " + start)
        a, b = code.index(start), code.index(end)
        if b <= a:
            raise ValueError("Review UI section order is invalid: " + start)
        code = code[:a] + replacement + "\n" + code[b:]

    once('<html lang="en">', '<html lang="en" ' + MARKER + ' data-review-protocol="' + route_id + '">')
    once('</head>', '<link rel="stylesheet" href="/settlement-panel.css">\n</head>')
    once('<body>', '<body>\n' + BANNER)
    once('</body>', '<script type="module" src="/settlement-panel.mjs"></script>\n</body>')
    # NFTree minting uses an independent remote wallet helper, so the emitted
    # wallet's signAndExecute guard cannot protect it. Remove that path from
    # both review routes before any wallet connection or remote script load.
    once("let NFTREE_MINT_SCRIPT_PROMISE=null;\n", '')
    once("const NFTREE_SALE_POOL_API='https://nftree.net/api/nftree-sale-pools';\n", '')
    once("const NFTREE_MINT_SCRIPT='https://nftree.net/assets/nftree-wallet-mint.js';\n", '')
    section('async function loadNftreeMintScript(){', 'function formatMistAsSui(mist){', '')
    section('async function mintNftreeInArboretum(){', 'window.mintNftreeInArboretum=mintNftreeInArboretum;', '''async function mintNftreeInArboretum(){
  toast('NFTree minting is disabled in this review. No wallet transaction will be requested.','ti',9000);
  return {submitted:false,reason:'REVIEW_ONLY'};
}''')
    section('<div class="amodal-overlay" id="mint-modal">', '<div class="amodal-overlay" id="eco-modal">', '''<div class="amodal-overlay" id="mint-modal">
  <div class="amodal-box">
    <h3>NFTree access review</h3>
    <p id="mint-review-notice">NFTree minting is disabled in this review. No wallet transaction will be requested.</p>
    <p>You can check the NFTrees already in your wallet and review your garden access.</p>
    <div class="amodal-acts">
      <button class="gbtn" id="mint-here-btn" type="button" disabled aria-describedby="mint-review-notice">Minting disabled in review</button>
      <button class="gbtn" onclick="checkMintAndReturn()">Check existing NFTree access</button>
      <button class="gbtn" onclick="closeAModal2('mint-modal')">Close</button>
    </div>
  </div>
</div>
''')
    section('function openMintModal(){', 'window.openMintModal=openMintModal;', '''function openMintModal(){
  $('mint-modal')?.classList.add('open');
}''')
    once('<div class="reward-tab-panel active" id="reward-tab-season" role="tabpanel" aria-labelledby="reward-tab-season-btn">',
         '<div class="reward-tab-panel active" id="reward-tab-season" role="tabpanel" aria-labelledby="reward-tab-season-btn">' + PANEL)
    # Keep legacy IDs for the existing game scripts, but remove the old payout
    # story from the accessibility tree and visible UI in this review build.
    once('<div class="reward-zone claim">', '<div class="reward-zone claim" hidden aria-hidden="true">')
    once('See your monthly SUI pool estimate, claim status, invite earnings, badges, and cosmetics.',
         'Review your season reward state, invite earnings, badges, and cosmetics.')
    once('<small>Claimed</small><b id="r-collected">', '<small>Observed payouts</small><b id="r-collected">')
    if route_id == 'settlement':
        once('<div class="adm-wide" id="partner-revenue-mount"></div>',
             '<div class="adm-wide sr-partner-unavailable" id="settlement-partner-report">Partner accounting for new seasons is not configured. <a href="/game.html">Open the existing garden</a> to review legacy partner receipts.</div>')

    section('async function doClaimReward(){', 'window.doClaimReward=doClaimReward;', '''async function doClaimReward(){
  if(window.arbSettlementPanel){await window.arbSettlementPanel.openClaims();return;}
  if(typeof setRewardTab==='function')setRewardTab('season');
  if(typeof doc==='function')doc('rewards-sec');
  toast('This is a review build. Transactions are disabled; the reward reader is still loading.','ti',9000);
}''')
    # The old local GP/pool projection would otherwise overwrite the wallet's
    # Under review/Unavailable text whenever the garden refreshed.
    section('function updateProjectedReward(playerGP=0){', 'function updatePoolShare(playerGP=0){', '''function updateProjectedReward(playerGP=0){
  if(window.arbSettlementPanel){window.arbSettlementPanel.syncProjection();return;}
  const value=PA?'Loading…':'Connect wallet';
  for(const id of ['hero-earn-proj','h-proj','d-sui','r-proj','roi-pct'])txt(id,value);
}''')
    once('function afterConnect(r){', "function afterConnect(r){\n  window.arbSettlementPanel?.onWalletChanged();")
    once('  PA=null;WALLET_NAME=null;ALL=[];', '  PA=null;WALLET_NAME=null;ALL=[];\n  window.arbSettlementPanel?.onWalletChanged();')

    section('async function loadCollectedRewards(){', 'window.loadCollectedRewards=loadCollectedRewards;', '''async function loadCollectedRewards(){
  const owner=PA;
  const show=value=>{txt('d-collected',value);txt('r-collected',value);};
  if(!owner){show('Connect wallet');return;}
  if(typeof window.arb?.getTotalRewardsCollected!=='function'){show('Unavailable');return;}
  try{
    const total=await window.arb.getTotalRewardsCollected(owner);
    if(PA!==owner)return;
    if(total==null||!Number.isFinite(Number(total))||Number(total)<0)throw Error('Collected reward history unavailable.');
    show(`${Number(total).toFixed(4)} SUI`);
    syncRewardsHub();
  }catch(e){
    if(PA!==owner)return;
    console.warn('Collected rewards:',e);
    show('Unavailable');
  }
}''')
    # Only missing-data fallbacks change; successful numeric zero stays zero.
    once("txt('r-collected',$('d-collected')?.textContent||'0.0000 SUI');", "txt('r-collected',$('d-collected')?.textContent||'Unavailable');")
    once("txt('r-proj',$('d-sui')?.textContent||'0.00 SUI');", "txt('r-proj',$('d-sui')?.textContent||'Unavailable');")
    once("txt('hero-earn-proj',$('h-proj')?.textContent||$('d-sui')?.textContent||'0.00 SUI');", "txt('hero-earn-proj',$('h-proj')?.textContent||$('d-sui')?.textContent||'Unavailable');")
    # The only remaining copies are in the explicit disconnect handler.
    once("  txt('d-collected','0.0000 SUI');", "  txt('d-collected','Connect wallet');")
    once("  txt('r-collected','0.0000 SUI');", "  txt('r-collected','Connect wallet');")
    for element_id in ('d-collected', 'r-collected', 'hero-earn-proj', 'h-proj', 'd-sui', 'r-proj', 'roi-pct'):
        pattern = r'(<[^>]+\bid="' + re.escape(element_id) + r'"[^>]*>)([^<]*)(</[^>]+>)'
        code, count = re.subn(pattern, lambda m: m[1] + 'Connect wallet' + m[3], code)
        # These two names remain JavaScript compatibility aliases; the
        # accepted Garden layout no longer emits elements with those IDs.
        if count != 1 and not (count == 0 and element_id in ('h-proj', 'roi-pct')):
            raise ValueError("Review initial-value anchor is not unique: " + element_id)

    # Admin support lookup must not turn failed inventories into empty wallets.
    # Inventory errors reach its visible outer error state; independent balance
    # and receipt history errors remain explicit Unavailable fields.
    for kind in ('Seed', 'Tool', 'Crate'):
        once("window.arb.getOwnedObjects(addr,'" + kind + "').catch(()=>[])", "window.arb.getOwnedObjects(addr,'" + kind + "')")
    once('window.arb.getOwnedNftreeNfts(addr).catch(()=>[])', 'window.arb.getOwnedNftreeNfts(addr)')
    once('window.arb.getSuiBalance(addr).catch(()=>0n)', 'window.arb.getSuiBalance(addr).catch(()=>null)')
    once('window.arb.getTotalRewardsCollected?.(addr).catch(()=>0)', "typeof window.arb.getTotalRewardsCollected==='function'?window.arb.getTotalRewardsCollected(addr).catch(()=>null):Promise.resolve(null)")
    once('    const seeds=seedObjs.map(window.arb.parseSeedObject);', "    if(![seedObjs,toolObjs,crateObjs,nfts].every(Array.isArray))throw Error('Wallet inventory unavailable.');\n    const seeds=seedObjs.map(window.arb.parseSeedObject);")
    once('    const balanceSui=(Number(balanceMist||0n)/1e9).toFixed(4);', "    const balanceSui=balanceMist==null||!Number.isFinite(Number(balanceMist))||Number(balanceMist)<0?'Unavailable':(Number(balanceMist)/1e9).toFixed(4);\n    const collectedSui=collected==null||!Number.isFinite(Number(collected))||Number(collected)<0?'Unavailable':Number(collected).toFixed(4);")
    once('${Number(collected||0).toFixed(4)}</strong><span>SUI claimed', '${collectedSui}</strong><span>Observed SUI payouts')
    once('<span class="adm-chip danger">Lookup failed</span>', '<span class="adm-chip danger">Wallet data unavailable</span>')
    return code


def main():
    if len(sys.argv) not in (2, 3):
        raise SystemExit(__doc__)
    target = Path(sys.argv[1]).resolve()
    if target in (ROOT / 'index.html', ROOT / 'wallet.js'):
        raise SystemExit('Only an emitted review file may be transformed; source inputs are protected.')
    route = sys.argv[2] if len(sys.argv) == 3 else 'legacy'
    original = target.read_text()
    output = transform(original, route)
    target.write_text(output)
    digest = lambda text: hashlib.sha256(text.encode()).hexdigest()
    print(json.dumps({'reviewOnly': True, 'protocol': route, 'path': str(target),
                      'inputSha256': digest(original), 'outputSha256': digest(output),
                      'transactionsSubmitted': 0}))


if __name__ == '__main__':
    main()
