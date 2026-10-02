#!/usr/bin/env python3
from pathlib import Path
import re,sys
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'production-economy'/'preview'
OUT.mkdir(parents=True,exist_ok=True)
wallet=(ROOT/'wallet.js').read_text()
html=(ROOT/'index.html').read_text()

def one(text,old,new,label):
    if text.count(old)!=1: raise SystemExit(f'{label}: expected one match, got {text.count(old)}')
    return text.replace(old,new)

wallet=one(wallet,'export const GROWTH_DEPOSIT_MIST = 10_000_000n; // 0.01 SUI','export const GROWTH_DEPOSIT_MIST = 10_000_000_000n; // 10 SUI — production economy candidate','plant price')
old_crates='''// Current live contract economics: all crate tiers cost 0.01 SUI.
export const CRATE_PRICES = {
  0: 10_000_000n,   // 0.01 SUI  (Seedling)
  1: 10_000_000n,   // 0.01 SUI  (Grove)
  2: 10_000_000n,   // 0.01 SUI  (Canopy)
  3: 10_000_000n,   // 0.01 SUI  (Ancient)
  4: 10_000_000n,   // 0.01 SUI  (Mythic)
  5: 10_000_000n,   // 0.01 SUI  ($BOOM)
  6: 10_000_000n,   // 0.01 SUI  (Victory)
};'''
new_crates='''// Production economy candidate. Must match the fresh/versioned Move package.
export const CRATE_PRICES = {
  0: 5_000_000_000n,    // 5 SUI   (Seedling)
  1: 10_000_000_000n,   // 10 SUI  (Grove)
  2: 25_000_000_000n,   // 25 SUI  (Canopy)
  3: 50_000_000_000n,   // 50 SUI  (Ancient)
  4: 100_000_000_000n,  // 100 SUI (Mythic)
  5: 30_000_000_000n,   // 30 SUI  ($BOOM)
  6: 30_000_000_000n,   // 30 SUI  (Victory)
};'''
wallet=one(wallet,old_crates,new_crates,'crate prices')
old_supply='''export const SUPPLY_DROP_PRICES = {
  0: 50_000_000n,   // 0.05 SUI  (Revival Kit)    original economy target: 25 SUI
  1: 40_000_000n,   // 0.04 SUI  (Drought Shield) original economy target: 15 SUI
  2: 30_000_000n,   // 0.03 SUI  (Rain Barrel)    original economy target: 10 SUI
  3: 25_000_000n,   // 0.025 SUI (Mulch)          original economy target: 8 SUI
  4: 20_000_000n,   // 0.02 SUI  (Watering Boost) original economy target: 5 SUI
};'''
new_supply='''export const SUPPLY_DROP_PRICES = {
  0: 15_000_000_000n, // 15 SUI (Revival Kit)
  1: 10_000_000_000n, // 10 SUI (Drought Shield)
  2: 5_000_000_000n,  // 5 SUI  (Rain Barrel)
  3: 4_000_000_000n,  // 4 SUI  (Mulch)
  4: 2_000_000_000n,  // 2 SUI  (Watering Boost)
};'''
wallet=one(wallet,old_supply,new_supply,'supply prices')
# Production candidate leaves gas selection/budgeting to the wallet for purchase PTBs.
wallet=wallet.replace('  tx.setGasBudget(SUPPLY_DROP_GAS_BUDGET_MIST);\n','')
# Player-facing production price labels and confirmations.
repls={
'Connect your wallet and plant a Seed for 0.01 SUI.':'Connect your wallet and plant a Seed for 10 SUI.',
'Plant Seeds: one held NFTree NFT plants one Seed + 0.01 SUI.':'Plant Seeds: one held NFTree NFT plants one Seed + 10 SUI.',
"showConfirm('Plant Seed with 0.01 SUI deposit?'":"showConfirm('Plant Seed with 10 SUI deposit?'",
'<div class="crate-name">Seedling</div><div class="crate-role">Starter Boost</div><div class="crate-price">0.01 SUI</div>':'<div class="crate-name">Seedling</div><div class="crate-role">Starter Boost</div><div class="crate-price">5 SUI</div>',
'<div class="crate-name">Grove</div><div class="crate-role">Daily Helper</div><div class="crate-price">0.01 SUI</div>':'<div class="crate-name">Grove</div><div class="crate-role">Daily Helper</div><div class="crate-price">10 SUI</div>',
'<div class="crate-name">Canopy</div><div class="crate-role">Rank Climber</div><div class="crate-price">0.01 SUI</div>':'<div class="crate-name">Canopy</div><div class="crate-role">Rank Climber</div><div class="crate-price">25 SUI</div>',
'<div class="crate-name">Ancient</div><div class="crate-role">Power Crate</div><div class="crate-price">0.01 SUI</div>':'<div class="crate-name">Ancient</div><div class="crate-role">Power Crate</div><div class="crate-price">50 SUI</div>',
'<div class="crate-name">Mythic</div><div class="crate-role">Cycle Changer</div><div class="crate-price">0.01 SUI</div>':'<div class="crate-name">Mythic</div><div class="crate-role">Cycle Changer</div><div class="crate-price">100 SUI</div>',
"Seedling Crate for 0.01 SUI?":"Seedling Crate for 5 SUI?",
"Grove Crate for 0.01 SUI?":"Grove Crate for 10 SUI?",
"Canopy Crate for 0.01 SUI?":"Canopy Crate for 25 SUI?",
"Ancient Crate for 0.01 SUI?":"Ancient Crate for 50 SUI?",
"Mythic Crate for 0.01 SUI?":"Mythic Crate for 100 SUI?",
'<div class="crate-name">$BOOM Chest</div><div class="crate-role">Growth Point Burst</div><div class="crate-price">0.01 SUI</div>':'<div class="crate-name">$BOOM Chest</div><div class="crate-role">Growth Point Burst</div><div class="crate-price">30 SUI</div>',
'<div class="crate-name">Victory Chest</div><div class="crate-role">Protect the Lead</div><div class="crate-price">0.01 SUI</div>':'<div class="crate-name">Victory Chest</div><div class="crate-role">Protect the Lead</div><div class="crate-price">30 SUI</div>',
"confirm:'$BOOM Chest for 0.01 SUI?":"confirm:'$BOOM Chest for 30 SUI?",
"confirm:'Victory Chest for 0.01 SUI?":"confirm:'Victory Chest for 30 SUI?",
"{drop:0,kind:'revival_kit',name:'Revival Kit',em:'💫',role:'Emergency Recovery',price:'0.05 SUI'":"{drop:0,kind:'revival_kit',name:'Revival Kit',em:'💫',role:'Emergency Recovery',price:'15 SUI'",
"{drop:1,kind:'drought_shield',name:'Drought Shield',em:'🛡️',role:'Absence Protection',price:'0.04 SUI'":"{drop:1,kind:'drought_shield',name:'Drought Shield',em:'🛡️',role:'Absence Protection',price:'10 SUI'",
"{drop:2,kind:'rain_barrel',name:'Rain Barrel',em:'🪣',role:'Timer Rescue',price:'0.03 SUI'":"{drop:2,kind:'rain_barrel',name:'Rain Barrel',em:'🪣',role:'Timer Rescue',price:'5 SUI'",
"{drop:3,kind:'mulch',name:'Mulch',em:'🍂',role:'Short Protection',price:'0.025 SUI'":"{drop:3,kind:'mulch',name:'Mulch',em:'🍂',role:'Short Protection',price:'4 SUI'",
"{drop:4,kind:'watering_boost',name:'Watering Boost',em:'💧',role:'Simple Boost',price:'0.02 SUI'":"{drop:4,kind:'watering_boost',name:'Watering Boost',em:'💧',role:'Simple Boost',price:'2 SUI'",
'<div class="crate-price" id="supply-price">0.05 SUI</div>':'<div class="crate-price" id="supply-price">15 SUI</div>',
}
for old,new in repls.items():
    if old not in html:
        print('optional HTML marker not found:',old[:80])
        continue
    html=html.replace(old,new)
# This preview must never point at the live testing package/state.
banner='''<div style="position:sticky;top:0;z-index:99999;padding:10px 16px;background:#3b2100;color:#ffe9a8;border-bottom:1px solid #d69b25;font:700 13px system-ui;text-align:center">PRODUCTION ECONOMY REVIEW — NO LIVE CONTRACT CONNECTED · PRICES SHOWN FOR VERIFICATION ONLY</div>'''
html=html.replace('<body>', '<body>'+banner,1)
# Disable every purchase/plant path in the static review copy; labels remain testable.
html=html.replace('onclick="doPlant()"','disabled title="Review-only preview"')
html=html.replace('onclick="confirmSupplyDrop()"','disabled title="Review-only preview"')
html=html.replace("onclick="confirmPartnerChest('boom')"",'disabled title="Review-only preview"')
html=html.replace("onclick="confirmPartnerChest('victory')"",'disabled title="Review-only preview"')
html=re.sub(r'onclick="showConfirm\(\'([^\']+ Crate for [^\']+)\', \(\) => doBuyCrate\([0-4]\)\)"','disabled title="Review-only preview"',html)
(OUT/'wallet.js').write_text(wallet)
(OUT/'index.html').write_text(html)
print('production frontend review generated; no live files modified')
