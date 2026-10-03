"""Offline UI checks, not a hosted login or on-chain security audit.
Every browser request is fulfilled locally or aborted. Wallet accounts and data
are synthetic. No Netlify gate, credentials, real wallet or chain write is used.
"""
from pathlib import Path
from urllib.parse import urlsplit, unquote
import hashlib, json, mimetypes, os, sys
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
DIST=ROOT/'dist'
OUT=ROOT/'economy-review-results/player-smoke';OUT.mkdir(parents=True,exist_ok=True)
ORIGIN='http://127.0.0.1:8977'
REGISTRY_ID='0x73672fd5f19137185a3933ea884aacad31eb7a9d41dab0494e628f3cb9b82d50'
TYPE='0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b::arboretum::Registry'
REGISTRY={'address':REGISTRY_ID,'version':'1','asMoveObject':{'contents':{'type':{'repr':TYPE},'json':{'current_season_id':'3','season_start_ms':'1788220806247','paused':False,'reward_pool':'0','treasury':'0','total_seeds':'0','total_growth_points':'0'}}}}
EXPECTED={'game.html':'1f927e9f3ac3ea79b43636f9fd3f455cdd34174adb902751cb28c89e7240a842','wallet.js':'e75087b0cfad4857932205f1aa827812d7ea06b4c9d833a062ab2ed3c1f08e17','sui-sdk.bundle.js':'8ad797a87557f50b3473c533225bf1778361ec689707b8b70a22632990c6ca44','economy-review/partner-reconciliation-panel.mjs':'90f2c57634d5fc32c722b0a2bfa9103134b1c17c4e2ba196164f5220ad655aac'}
checks=[];blocked=[];missing=[]
def ck(name,ok,detail=None):
    row={'check':name,'passed':bool(ok)}
    if detail is not None:row['detail']=detail
    checks.append(row);(OUT/'checks.json').write_text(json.dumps(checks,indent=2))
    print(('PASS ' if ok else 'FAIL ')+name,flush=True)

def graphql(q,v):
    page={'nodes':[],'pageInfo':{'hasNextPage':False,'endCursor':None,'hasPreviousPage':False,'startCursor':None}}
    if 'GardenSeasonStatus' in q:return {'registry':REGISTRY,'clock':{'asMoveObject':{'contents':{'json':{'timestamp_ms':'1790993271110'}}}}}
    if 'object(address: $id)' in q:return {'object':REGISTRY if v.get('id')==REGISTRY_ID else None}
    if 'defaultNameRecord' in q:return {'address':{'defaultNameRecord':None}}
    if 'address(address:' in q and 'balance(' in q:return {'address':{'balance':{'totalBalance':'0'}}}
    if 'address(address:' in q and 'objects(' in q:return {'address':{'objects':page}}
    if 'events(' in q:return {'events':page}
    if 'objects(' in q:return {'objects':page}
    raise ValueError('Unhandled fixture read: '+q[:100])

FAKE_WALLET="""async()=>{
 const {getWallets}=await import('/sui-sdk.bundle.js');
 window.__walletAudit={connect:0,disconnect:0,sign:0,wrongNetwork:false,reject:false};
 const address='0x'+'d'.repeat(64);
 const account={address,publicKey:new Uint8Array(32),chains:['sui:mainnet'],features:['sui:signAndExecuteTransaction']};
 const wallet={version:'1.0.0',name:'Arboretum Local Test Wallet',icon:'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',chains:['sui:mainnet'],accounts:[],features:{
 'standard:connect':{version:'1.0.0',connect:async()=>{
 window.__walletAudit.connect++;
 if(window.__walletAudit.reject)throw Error('User rejected the connection (test fixture)');
 account.chains=[window.__walletAudit.wrongNetwork?'sui:testnet':'sui:mainnet'];wallet.accounts=[account];return {accounts:wallet.accounts};}},
 'standard:disconnect':{version:'1.0.0',disconnect:async()=>{window.__walletAudit.disconnect++;wallet.accounts=[];}},
 'sui:signAndExecuteTransaction':{version:'2.0.0',signAndExecuteTransaction:async()=>{window.__walletAudit.sign++;throw Error('SIGNING DISABLED IN LOCAL TEST');}}
 }};
 getWallets().register(wallet);return address;
}"""
for name,expected in EXPECTED.items():
    ck('CI build matches staged-source artifact: '+name,hashlib.sha256((DIST/name).read_bytes()).hexdigest()==expected)
if any(not c['passed'] for c in checks):sys.exit(1)
with sync_playwright() as p:
    args={'headless':True}
    if os.environ.get('PLAYER_CHROMIUM'):args['executable_path']=os.environ['PLAYER_CHROMIUM']
    browser=p.chromium.launch(**args)
    for width in [1440,768,390,320]:
        context=browser.new_context(viewport={'width':width,'height':950},timezone_id='America/Chicago',service_workers='block')
        errors=[];requests=[];denied=[]
        def route(r):
            req=r.request;u=urlsplit(req.url)
            requests.append({'host':u.netloc,'path':u.path,'method':req.method})
            if u.netloc==urlsplit(ORIGIN).netloc and req.method=='GET':
                name=unquote(u.path).lstrip('/') or 'index.html';f=(DIST/name).resolve()
                if f.is_relative_to(DIST.resolve()) and f.is_file():
                    mime='text/javascript' if f.suffix=='.mjs' else mimetypes.guess_type(f.name)[0] or 'application/octet-stream'
                    r.fulfill(status=200,content_type=mime,body=f.read_bytes());return
                missing.append({'width':width,'path':name});r.fulfill(status=404,body='Local file missing');return
            if u.hostname=='graphql.mainnet.sui.io' and req.method=='POST':
                data=req.post_data_json;q=data.get('query','')
                if not q.lstrip().startswith(('query','{')) or any(x in q for x in ['executeTransaction','simulateTransaction','dryRunTransaction']):
                    blocked.append({'width':width,'kind':'write-or-simulation'});r.abort();return
                try:r.fulfill(status=200,json={'data':graphql(q,data.get('variables',{}))})
                except Exception as e:errors.append(str(e));r.fulfill(status=200,json={'errors':[{'message':str(e)}]})
                return
            if u.hostname=='fullnode.mainnet.sui.io' and req.method=='POST':
                data=req.post_data_json;items=data if isinstance(data,list) else [data]
                if any(not str(x.get('method','')).startswith(('sui_get','sui_multiGet','suix_get','suix_query','suix_resolve')) for x in items):
                    blocked.append({'width':width,'kind':'non-read-rpc'});r.abort();return
                result=[{'jsonrpc':'2.0','id':x.get('id'),'error':{'code':-32601,'message':'JSON-RPC unavailable: controlled test fixture'}} for x in items]
                r.fulfill(status=200,json=result if isinstance(data,list) else result[0]);return
            denied.append({'host':u.netloc,'path':u.path,'method':req.method})
            if req.method!='GET':blocked.append({'width':width,'kind':'unexpected-request','path':u.path})
            if req.resource_type=='stylesheet':r.fulfill(status=200,content_type='text/css',body='')
            else:r.abort()
        context.route('**/*',route)
        page=context.new_page();page.set_default_timeout(10000)
        page.on('pageerror',lambda e:errors.append(str(e)))
        try:
            page.goto(ORIGIN+'/game.html',wait_until='load')
            page.wait_for_function('window._walletReady && window.arb && window.arbPartnerReport')
            ck(f'{width}: original wallet and review modules load',True)
            ck(f'{width}: initially disconnected',page.evaluate('window.arb.getAddress()===null'))
            ck(f'{width}: admin navigation hidden while disconnected',not page.locator('#admin-nav').is_visible())
            msg=page.evaluate('async()=>{await window.arbPartnerReport.loadSeasons();return document.querySelector("#partner-revenue-mount .pr-status").textContent}')
            ck(f'{width}: report rejects disconnected access','authorized wallet' in msg)
            address=page.evaluate(FAKE_WALLET)
            page.locator('#wallet-btn').click();page.wait_for_selector('#wallet-modal.open')
            page.get_by_text('Arboretum Local Test Wallet',exact=True).click()
            page.wait_for_function('(a)=>window.arb.getAddress()===a',arg=address);page.wait_for_timeout(1200)
            ck(f'{width}: simulated connection uses original application flow','connected' in (page.locator('#wallet-btn').get_attribute('class') or '').split())
            ck(f'{width}: non-admin classification retained',page.evaluate('!window.arb.isAdmin(window.arb.getAddress())'))
            ck(f'{width}: admin link and modal hidden',not page.locator('#admin-nav').is_visible() and not page.locator('#admin-modal').is_visible())
            before=len(requests)
            msg=page.evaluate('async()=>{await window.arbPartnerReport.loadSeasons();return document.querySelector("#partner-revenue-mount .pr-status").textContent}')
            ck(f'{width}: non-admin report denied without discovery','authorized wallet' in msg and len(requests)==before)
            for target,label in [('garden-sec','My Garden'),('market-sec','Item Shop'),('tools-sec','Strategy'),('rewards-sec','Rewards'),('leaderboard-sec','Leaderboard')]:
                link=page.locator(f'.nav-a[href="#{target}"]').first
                if not link.is_visible() and page.locator('#menu-toggle').is_visible():page.locator('#menu-toggle').click()
                link.click();page.wait_for_timeout(150)
                ck(f'{width}: {label} navigation opens correct panel',page.locator('#'+target).is_visible() and 'active' in (page.locator('#'+target).get_attribute('class') or '').split())
                dims=page.evaluate('({viewport:innerWidth,page:document.documentElement.scrollWidth})')
                ck(f'{width}: {label} has no page-width overflow',dims['page']<=dims['viewport'],dims)
            page.evaluate("setActivePanel('tools-sec')");page.locator('#strategy-tab-owned-btn').click()
            ck(f'{width}: My Items subtab opens',page.locator('#strategy-tab-owned').is_visible())
            page.evaluate("setActivePanel('garden-sec')")
            ck(f'{width}: empty wallet has no live Seed cards',page.locator('#garden-grid [data-seed-id]').count()==0)
            ck(f'{width}: ended season prevents watering',page.locator('#garden-season-status').get_attribute('data-phase')=='ended')
            page.screenshot(path=str(OUT/f'player-garden-{width}.png'))
            ck(f'{width}: no signing during navigation',page.evaluate('window.__walletAudit.sign===0'))
            page.reload(wait_until='load');page.wait_for_function('window._walletReady');page.evaluate(FAKE_WALLET)
            page.wait_for_function('(a)=>window.arb.getAddress()===a',arg=address);page.wait_for_timeout(700)
            ck(f'{width}: saved non-admin session restores',page.evaluate('window.arb.getAddress()!==null && !window.arb.isAdmin(window.arb.getAddress())'))
            page.evaluate('doDisconnect()');page.wait_for_function('window.arb.getAddress()===null')
            ck(f'{width}: disconnect clears both session stores',page.evaluate('localStorage.getItem("arb_addr")===null && sessionStorage.getItem("arb_addr")===null'))
            ck(f'{width}: admin remains hidden after disconnect',not page.locator('#admin-nav').is_visible() and not page.locator('#admin-modal').is_visible())
            page.evaluate('window.__walletAudit.wrongNetwork=true');page.evaluate('doConnect("Arboretum Local Test Wallet")')
            ck(f'{width}: wrong network rejected',page.evaluate('window.arb.getAddress()===null') and page.locator('#wallet-btn').inner_text()=='Connect Wallet')
            page.evaluate('window.__walletAudit.wrongNetwork=false;window.__walletAudit.reject=true');page.evaluate('doConnect("Arboretum Local Test Wallet")')
            ck(f'{width}: rejected connection recovers Connect button',page.evaluate('window.arb.getAddress()===null') and page.locator('#wallet-btn').inner_text()=='Connect Wallet')
            ck(f'{width}: no signing during connection scenarios',page.evaluate('window.__walletAudit.sign===0'))
            ck(f'{width}: no write or simulation attempted',not [x for x in blocked if x['width']==width])
            ck(f'{width}: no unhandled page exceptions',not errors,errors)
        except Exception as e:
            ck(f'{width}: test harness completed',False,str(e)[:1800])
            try:page.screenshot(path=str(OUT/f'failure-{width}.png'),timeout=3000)
            except Exception:pass
        finally:
            (OUT/f'network-{width}.json').write_text(json.dumps({'intercepted':requests,'blockedOther':denied,'pageErrors':errors},indent=2));context.close()
    browser.close()
summary={'scope':'Offline Chromium UI checks with a synthetic non-signing Wallet Standard provider, empty inventory and synthetic ended-season data. All browser requests intercepted. Not a hosted gate test, live wallet test, populated-garden test or on-chain permission audit.',
    'referenceApplicationSource':'96845880a7ea75f345a515a1182eea14fd368f26','runnerSource':os.environ.get('GITHUB_SHA'),
    'checked':len(checks),'passed':sum(x['passed'] for x in checks),'failed':sum(not x['passed'] for x in checks),
    'transactionsSubmitted':0,'realWalletsConnected':0,'testerReady':False,
    'pending':['Genuine hosted non-admin wallet check','Genuine tester logout and blocked re-entry'],
    'missingLocalAssets':missing,'blockedWrites':blocked}
(OUT/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))
sys.exit(1 if summary['failed'] or blocked else 0)
