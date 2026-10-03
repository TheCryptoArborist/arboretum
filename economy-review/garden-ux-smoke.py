"""Offline browser checks of the gated Garden UX build. All requests intercepted.
Synthetic wallet/data; no real login, wallet connection, signing or chain writes.
"""
from pathlib import Path
from urllib.parse import urlsplit, unquote
import ast, hashlib, json, mimetypes, os, sys, time
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];DIST=ROOT/'dist'
OUT=ROOT/'economy-review-results/garden-ux';OUT.mkdir(parents=True,exist_ok=True)
ORIGIN='http://127.0.0.1:8977';RID='0x73672fd5f19137185a3933ea884aacad31eb7a9d41dab0494e628f3cb9b82d50'
TYPE='0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b::arboretum::'
ADDRESS='0x'+'d'*64;NOW=int(time.time()*1000);DAY=86400000
checks=[];blocked=[];errors=[]
def check(name,ok,detail=None):
 row={'check':name,'passed':bool(ok)}
 if detail is not None:row['detail']=detail
 checks.append(row);print(('PASS ' if ok else 'FAIL ')+name,flush=True)
 (OUT/'checks.json').write_text(json.dumps(checks,indent=2))
# Reuse the existing, explicitly non-signing synthetic Wallet Standard provider.
module=ast.parse((ROOT/'economy-review/player-smoke.py').read_text())
FAKE_WALLET=next(ast.literal_eval(n.value) for n in module.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='FAKE_WALLET' for t in n.targets))
def seed(i,state,last,expiry=0):
 return {'address':'0x'+f'{i:064x}','version':'1','contents':{'type':{'repr':TYPE+'Seed'},'json':{
 'id':'0x'+f'{i:064x}','owner':ADDRESS,'season_id':'3','claimed_ms':'0','state':state,
 'last_watered_ms':str(last),'bottomless_can_expiry_ms':str(expiry),'growth_points':str(100*i),
 'watering_streak':str(i),'nft_id':'0x'+f'{i+100:064x}','fertilizer_charges':'0','revival_charges':'0',
 'planted_at_ms':str(NOW-DAY*10)}}}
SEEDS=[seed(1,1,NOW-8*DAY),seed(2,2,NOW-DAY),seed(3,0,NOW-3600000),seed(4,0,NOW-8*DAY,NOW+2*DAY),seed(5,0,NOW-DAY)]
with sync_playwright() as p:
 opts={'headless':True}
 if os.environ.get('PLAYER_CHROMIUM'):opts['executable_path']=os.environ['PLAYER_CHROMIUM']
 browser=p.chromium.launch(**opts)
 for width in [1440,768,390,320]:
  mode={'phase':'active','fail':False,'reverse':False,'empty':False};page_errors=[];reads=[]
  def gql(q,v):
   page={'nodes':[],'pageInfo':{'hasNextPage':False,'endCursor':None,'hasPreviousPage':False,'startCursor':None}}
   start=0 if mode['phase']=='inactive' else NOW+DAY if mode['phase']=='scheduled' else NOW-31*DAY if mode['phase']=='ended' else NOW-DAY
   registry={'address':RID,'version':'1','asMoveObject':{'contents':{'type':{'repr':TYPE+'Registry'},'json':{
    'current_season_id':'3','season_start_ms':str(start),'paused':mode['phase']=='paused','reward_pool':'0','treasury':'0','total_seeds':'5','total_growth_points':'1500'}}}}
   if 'GardenSeasonStatus' in q:
    if mode['phase']=='unknown':raise ValueError('Controlled missing season status')
    return {'registry':registry,'clock':{'asMoveObject':{'contents':{'json':{'timestamp_ms':str(NOW)}}}}}
   if 'object(address: $id)' in q:
    if v.get('id')==RID:return {'object':registry}
    return {'object':{'address':v.get('id'),'version':'1','asMoveObject':{'contents':{'type':{'repr':'0x'+'a'*64+'::nft::NFTree'},'json':{'name':'Fixture NFTree','image_url':ORIGIN+'/prelaunch/hero.png'}}}}}
   if 'defaultNameRecord' in q:return {'address':{'defaultNameRecord':None}}
   if 'address(address:' in q and 'balance(' in q:return {'address':{'balance':{'totalBalance':'0'}}}
   if 'address(address:' in q and 'objects(' in q:
    if mode['fail']:raise ValueError('Controlled inventory read failure')
    if v.get('type')==TYPE+'Seed' and not mode['empty']:page['nodes']=list(reversed(SEEDS)) if mode['reverse'] else SEEDS
    return {'address':{'objects':page}}
   if 'events(' in q:return {'events':page}
   if 'objects(' in q:return {'objects':page}
   raise ValueError('Unhandled fixture read: '+q[:100])
  context=browser.new_context(viewport={'width':width,'height':950},timezone_id='America/Chicago',service_workers='block')
  def route(r):
   req=r.request;u=urlsplit(req.url);reads.append({'host':u.netloc,'path':u.path,'method':req.method})
   if u.netloc==urlsplit(ORIGIN).netloc and req.method=='GET':
    name=unquote(u.path).lstrip('/') or 'index.html';f=(DIST/name).resolve()
    if f.is_relative_to(DIST.resolve()) and f.is_file():
     mime='text/javascript' if f.suffix=='.mjs' else mimetypes.guess_type(f.name)[0] or 'application/octet-stream';r.fulfill(status=200,content_type=mime,body=f.read_bytes());return
    r.fulfill(status=404,body='Fixture optional backend unavailable');return
   if u.hostname=='graphql.mainnet.sui.io' and req.method=='POST':
    data=req.post_data_json;q=data.get('query','')
    if not q.lstrip().startswith(('query','{')) or any(x in q for x in ['executeTransaction','simulateTransaction','dryRunTransaction']):blocked.append({'width':width,'kind':'write-or-simulation'});r.abort();return
    try:r.fulfill(status=200,json={'data':gql(q,data.get('variables',{}))})
    except ValueError as e:r.fulfill(status=200,json={'errors':[{'message':str(e)}]})
    return
   if u.hostname=='fullnode.mainnet.sui.io' and req.method=='POST':
    data=req.post_data_json;items=data if isinstance(data,list) else [data]
    if any(not str(x.get('method','')).startswith(('sui_get','sui_multiGet','suix_get','suix_query','suix_resolve')) for x in items):blocked.append({'width':width,'kind':'non-read-rpc'});r.abort();return
    result=[{'jsonrpc':'2.0','id':x.get('id'),'error':{'code':-32601,'message':'Controlled unavailable legacy RPC'}} for x in items]
    r.fulfill(status=200,json=result if isinstance(data,list) else result[0]);return
   if req.method!='GET':blocked.append({'width':width,'kind':'unexpected-method'})
   if req.resource_type=='stylesheet':r.fulfill(status=200,content_type='text/css',body='')
   else:r.abort()
  context.route('**/*',route);page=context.new_page();page.set_default_timeout(12000);page.on('pageerror',lambda e:page_errors.append(str(e)))
  def ck(name,ok,detail=None):check(f'{width}: '+name,ok,detail)
  def phase(name):mode['phase']=name;page.evaluate('window.arbSeasonStatus.refresh()');page.wait_for_function('(p)=>document.getElementById("garden-sec").dataset.uxPhase===p',arg=name)
  try:
   page.goto(ORIGIN+'/game.html',wait_until='load');page.wait_for_function('window.arbGardenUX && window._walletReady');page.evaluate("setActivePanel('garden-sec')")
   ck('unknown inventory shows placeholder, not eight empty slots',page.locator('#garden-load-placeholder').is_visible() and not page.locator('#garden-grid').is_visible())
   address=page.evaluate(FAKE_WALLET);page.evaluate('doConnect("Arboretum Local Test Wallet")');page.wait_for_selector('#garden-sync[data-status="ready"]');page.wait_for_timeout(600)
   ck('populated garden loads through original reader',page.locator('#garden-grid [data-seed-id]').count()==5)
   ck('ready/wait/protected/dead counters are distinct',page.evaluate("['garden-ready','garden-watered','garden-protected','garden-dead'].map(id=>document.getElementById(id).textContent)")==['2','1','1','1'])
   ck('wilting attention precedes dead',page.locator('#garden-primary-action').text_content()=='Review Wilting Seeds')
   ck('waiting hint remains visible on artwork card',page.locator('[data-seed-id$="0003"] .gc-status-hint').is_visible() and 'Next watering in' in page.locator('[data-seed-id$="0003"] .gc-status-hint').text_content())
   ck('protected card cannot request manual water',page.locator('[data-seed-id$="0004"] .gc-btn').is_disabled())
   ck('waiting card cannot request premature water',page.locator('[data-seed-id$="0003"] .gc-btn').is_disabled())
   ck('ready card keeps existing explicit Water action',page.locator('[data-seed-id$="0005"] .gc-btn').is_enabled())
   labels=page.locator('#garden-grid [data-seed-id]').evaluate_all('(cards)=>Object.fromEntries(cards.map(c=>[c.dataset.seedId,c.querySelector(".gc-slot-label").textContent]))')
   page.select_option('#gfilter','dead')
   ck('filtered dead Seed keeps Slot 2',page.locator('#garden-grid [data-seed-id]:visible .gc-slot-label').all_text_contents()==['Slot 2'])
   ck('filters never show fake empty slots',page.locator('#garden-grid .empty-slot:visible').count()==0)
   page.select_option('#gfilter','ready');ck('ready filter excludes waiting/dead/protected',page.locator('#garden-grid [data-seed-id]:visible').count()==2)
   mode['reverse']=True;page.evaluate('refreshGarden()');page.wait_for_selector('#garden-sync[data-status="ready"]')
   nowlabels=page.locator('#garden-grid [data-seed-id]').evaluate_all('(cards)=>Object.fromEntries(cards.map(c=>[c.dataset.seedId,c.querySelector(".gc-slot-label").textContent]))')
   ck('refresh ordering preserves original Seed labels',labels==nowlabels)
   page.select_option('#gfilter','all')
   ck('real empty positions only when unfiltered',page.locator('#garden-grid .empty-slot:visible').count()==3)
   ck('growth label states requirements instead of calendar ETA','streak days OR' in page.locator('#garden-next-growth-copy').text_content() and 'Progress toward' in page.locator('#garden-next-growth-title').text_content())
   ck('growth explicitly separates reward eligibility','claim eligibility' in page.locator('#garden-next-growth-score').text_content())
   ck('summary precedes garden board',page.locator('#garden-check').bounding_box()['y']<page.locator('.garden-board-panel').bounding_box()['y'])
   ck('season details collapsed by default',page.locator('.garden-season-details').get_attribute('open') is None)
   size=page.locator('[data-seed-id$="0005"] .gc-btn').bounding_box();ck('water touch target meets selected 44px height',size['height']>=44,size)
   page.screenshot(path=str(OUT/f'garden-active-{width}.png'),full_page=True)
   for target in ['garden-sec','market-sec','tools-sec','rewards-sec','leaderboard-sec']:
    page.evaluate('(target)=>setActivePanel(target)',target);ck(target+' remains navigable',page.locator('#'+target).is_visible())
   page.evaluate("setActivePanel('garden-sec')")
   phase('ended')
   ck('ended season primary routes to rewards',page.locator('#garden-primary-action').text_content()=='View Season Rewards')
   ck('closed season has no planting/watering goals',not page.locator('#daily-goals').is_visible() and not page.locator('.garden-buy-crates-banner').is_visible())
   ck('ended season has no watering timer','Not scheduled' in page.locator('#daily-reminder-time').text_content())
   ck('ended season disables all per-Seed care actions',page.locator('#garden-grid .gc-actions button:enabled').count()==0)
   ck('ended season cards show closed status',all('Season ended'==x for x in page.locator('#garden-grid [data-seed-id] .gc-status').all_text_contents()))
   page.screenshot(path=str(OUT/f'garden-ended-{width}.png'),full_page=True)
   for s in ['paused','inactive','scheduled','unknown']:
    phase(s);ck(s+' never recommends planting or watering',page.locator('#garden-primary-action').text_content() in ['Refresh Status','View Season Rewards'] and page.locator('#garden-grid .gc-actions button:enabled').count()==0)
   phase('active');mode['fail']=True;page.evaluate('refreshGarden()');page.wait_for_selector('#garden-sync[data-status="error"]')
   ck('refresh failure retains known Seed inventory',page.locator('#garden-grid [data-seed-id]').count()==5 and page.locator('#garden-grid').is_visible())
   ck('refresh failure has persistent retry state','Couldn’t refresh' in page.locator('#garden-sync-text').text_content() and page.locator('#garden-sync-refresh').is_enabled())
   ck('stale counts are unavailable, not zero',page.locator('#garden-ready').text_content()=='—')
   page.screenshot(path=str(OUT/f'garden-refresh-error-{width}.png'),full_page=True)
   mode['fail']=False;page.locator('#garden-sync-refresh').click();page.wait_for_selector('#garden-sync[data-status="ready"]')
   ck('Retry recovers a loaded garden',page.locator('#garden-grid [data-seed-id]:visible').count()==5)
   # Test a genuine empty read separately from an initial failed read.
   mode['empty']=True;page.evaluate('refreshGarden()');page.wait_for_selector('#garden-sync[data-status="ready"]')
   page.select_option('#gfilter','wilt');ck('empty filter explains hidden Seeds instead of plantable slots',page.locator('#garden-filter-empty').is_visible() and page.locator('#garden-grid .empty-slot:visible').count()==0)
   page.locator('#garden-filter-empty button').click();ck('show-all restores truly empty slots',page.locator('#garden-grid .empty-slot:visible').count()==8)
   page.evaluate('doDisconnect()');ck('disconnect clears previous garden display',not page.locator('#garden-grid').is_visible())
   mode['fail']=True;page.evaluate('doConnect("Arboretum Local Test Wallet")');page.wait_for_selector('#garden-sync[data-status="error"]')
   ck('initial failed read never becomes empty garden',not page.locator('#garden-grid').is_visible() and 'Unable to load' in page.locator('#garden-load-placeholder').text_content())
   mode['fail']=False;mode['empty']=False;page.locator('#garden-sync-refresh').click();page.wait_for_selector('#garden-sync[data-status="ready"]')
   # Test stale-response admission independent of transport timing.
   admission=page.evaluate('''()=>{const ux=window.arbGardenUX,a=window.arbGardenBridge.address();const old=ux.begin(a);ux.reset(a);const latest=ux.begin(a);const denied=!ux.current(old,a);ux.complete(old,a);const ignored=document.getElementById('garden-sync').dataset.status==='loading';ux.fail(latest,a);return denied&&ignored;}''')
   ck('old request cannot overwrite a newer session',admission)
   ck('non-admin navigation remains absent',not page.locator('#admin-nav').is_visible())
   ck('no signing during review scenarios',page.evaluate('window.__walletAudit.sign===0'))
   ck('no page-width overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
   ck('no unhandled page exceptions',not page_errors,page_errors)
  except Exception as e:
   ck('browser scenario completed',False,str(e)[:1000]);page.screenshot(path=str(OUT/f'failure-{width}.png'),full_page=True)
  finally:
   errors.extend(page_errors);(OUT/f'network-{width}.json').write_text(json.dumps(reads,indent=2));context.close()
 browser.close()
summary={'scope':'Offline Chromium using original wallet/read code with synthetic non-signing provider and intercepted GraphQL fixtures; no hosted login or real wallet test.',
 'checked':len(checks),'passed':sum(c['passed'] for c in checks),'failed':sum(not c['passed'] for c in checks),'blockedWrites':blocked,'transactionsSubmitted':0,'realWalletsConnected':0,'testerReady':False,
 'widths':[1440,768,390,320],'build':json.loads((ROOT/'economy-review-results/garden-ux-build.json').read_text())}
(OUT/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2));sys.exit(1 if summary['failed'] or blocked else 0)
