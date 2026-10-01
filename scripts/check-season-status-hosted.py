"""Hosted game integration: real scripts and native login; no wallet connections/writes.
Live reads first, then explicitly isolated network fixtures on the same hosted code.
"""
from pathlib import Path
from urllib.parse import urlsplit
import json,os
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
BASE=os.environ['SEASON_STATUS_URL'].rstrip('/')
STAGE=os.environ.get('SEASON_STATUS_STAGE','preview')
OUT=ROOT/'season-status-results'/STAGE;OUT.mkdir(parents=True,exist_ok=True)
checks=[]
def ck(name,ok):
 checks.append({'check':name,'passed':bool(ok)})
 (OUT/'browser.json').write_text(json.dumps(checks,indent=2))
 if not ok:raise AssertionError(name)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 # Authenticate through actual browser forms; no wallet is connected.
 login=browser.new_context(java_script_enabled=False)
 page=login.new_page();page.goto(BASE+'/tester-access')
 page.locator('#password').fill('not-a-valid-tester-code');page.locator('button[type=submit]').first.click()
 ck('native wrong-code rejection',page.locator('[role=alert]').is_visible())
 page.locator('#password').fill(os.environ['SEASON_TESTER_PASSWORD']);page.locator('button[type=submit]').first.click()
 page.wait_for_url('**/game*',wait_until='domcontentloaded')
 ck('native login opens game',page.locator('#garden-season-status').count()==1)
 cookies=login.cookies();ck('HttpOnly secure session',any(x['name']=='__Host-arboretum_tester' and x['httpOnly'] and x['secure'] for x in cookies))
 login.close()
 for width,label in [(1440,'desktop'),(768,'tablet'),(390,'mobile'),(320,'small-mobile')]:
  c=browser.new_context(viewport={'width':width,'height':1000},timezone_id='America/Chicago');c.add_cookies(cookies)
  page=c.new_page();errors=[];blocked=[];live_reads=[];requests_seen=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  fixture={'enabled':False,'error':False,'start':1791000000000,'now':1791000000000+2592000000+1000,'paused':False}
  def route(r):
   req=r.request;u=urlsplit(req.url);requests_seen.append(u.path)
   if req.method=='POST' and u.netloc!=urlsplit(BASE).netloc:
    try:data=req.post_data_json
    except Exception:data={}
    if isinstance(data,dict) and 'query' in data:
     q=data['query']
     if not q.lstrip().startswith(('query','{')) or any(x in q for x in ['executeTransaction','simulateTransaction','dryRunTransaction']):
      blocked.append('non-read GraphQL');r.abort();return
     if 'query GardenSeasonStatus' in q and fixture['enabled']:
      if fixture['error']:r.fulfill(status=503,body='Fixture unavailable');return
      r.fulfill(json={'data':{'registry':{'asMoveObject':{'contents':{'json':{'current_season_id':'3','season_start_ms':str(fixture['start']),'paused':fixture['paused']}}}},'clock':{'asMoveObject':{'contents':{'json':{'timestamp_ms':str(fixture['now'])}}}}}});return
    else:
     entries=data if isinstance(data,list) else [data]
     if any(not str(x.get('method','')).startswith(('sui_get','sui_multiGet','suix_get','suix_query','suix_resolve')) for x in entries if isinstance(x,dict)):
      blocked.append('non-read RPC');r.abort();return
   r.continue_()
  page.route('**/*',route)
  def response(res):
   if fixture['enabled']:return
   try:
    data=res.request.post_data_json
    if isinstance(data,dict) and 'query GardenSeasonStatus' in data.get('query',''):
     j=res.json();live_reads.append(j)
   except Exception:pass
  page.on('response',response)
  page.goto(BASE+'/game.html#garden-sec',wait_until='domcontentloaded')
  page.wait_for_function("window.arbSeasonStatus && window.arb",timeout=45000)
  page.wait_for_function("['active','ended','paused','ended-paused','inactive','scheduled'].includes(document.getElementById('garden-season-status').dataset.phase)",timeout=45000)
  page.evaluate("window.doc('garden-sec')")
  ck(label+' real game and wallet scripts loaded',page.evaluate("typeof window.arb.waterSeed==='function'&&typeof window.doClaimReward==='function'"))
  ck(label+' no wallet connected',page.evaluate("!window.arb.getAddress()"))
  ck(label+' network state actually read',bool(live_reads) and not live_reads[-1].get('errors'))
  fields=live_reads[-1]['data']['registry']['asMoveObject']['contents']['json'];clock=int(live_reads[-1]['data']['clock']['asMoveObject']['contents']['json']['timestamp_ms'])
  start=int(fields['season_start_ms']);end=start+2592000000
  expected='inactive' if not start else ('ended-paused' if fields['paused'] else 'ended') if clock>=end else ('paused' if fields['paused'] else 'active')
  ck(label+' live phase matches network',page.locator('#garden-season-status').get_attribute('data-phase')==expected)
  ck(label+' new stylesheet loaded',page.locator('#garden-season-status').evaluate('(e)=>getComputedStyle(e).display')=='grid')
  ck(label+' panel has no horizontal overflow',page.locator('#garden-season-status').evaluate('(e)=>e.scrollWidth<=e.clientWidth'))
  ck(label+' no fabricated calculation status','being calculated' not in page.locator('#garden-season-status').inner_text())
  page.locator('#garden-season-status').scroll_into_view_if_needed()
  page.locator('#garden-season-status').screenshot(path=str(OUT/f'panel-{label}.png'))
  page.screenshot(path=str(OUT/f'garden-{label}.png'))
  page.locator('.garden-season-help summary').click()
  ck(label+' visible manual claim instructions','Rewards → Monthly Pool → Claim Reward' in page.locator('.garden-season-help').inner_text() and page.locator('.garden-season-help p').first.is_visible())
  page.locator('#garden-season-rewards').click()
  ck(label+' existing rewards section opened',page.locator('#rewards-sec').is_visible())
  ck(label+' Monthly Pool selected',page.locator('#reward-tab-season-btn').get_attribute('aria-selected')=='true')
  ck(label+' original Claim Reward control present',page.locator('button[onclick="doClaimReward()"]').count()>0)
  page.evaluate("window.doc('garden-sec')")
  # Fixtures never reach original write methods. No user wallet is impersonated.
  fixture['enabled']=True
  page.evaluate("""() => {
   window.__seasonWriteCalls=0;
   for(const name of ['waterSeed','batchWaterAllSeeds','claimReward','claimArchivedReward'])window.arb[name]=async()=>{window.__seasonWriteCalls++;throw new Error('Writes blocked in test');};
   window.needWallet=()=>false;
   window.__postGuardCalls=0;window.requireGardenActive=async()=>{window.__postGuardCalls++;return false;};
   const area=document.getElementById('garden-grid');
   for(const [id,direct] of [['fixture-single',false],['fixture-batch',true]]){
    const b=document.createElement('button');b.id=id;b.textContent='Fixture watering';
    if(direct)b.onclick=window.doWaterAll;else b.setAttribute('onclick',"doWaterSeed('fixture')");area.append(b);
   }
  }""")
  def refresh(phase):
   page.evaluate('window.arbSeasonStatus.refresh()')
   page.wait_for_function("(phase)=>document.getElementById('garden-season-status').dataset.phase===phase",arg=phase,timeout=15000)
  refresh('ended')
  ck(label+' expired batch and single controls disabled',page.locator('#fixture-single').is_disabled() and page.locator('#fixture-batch').is_disabled())
  page.evaluate("async()=>{await window.doWaterAll();await window.doWaterSeed('fixture');}")
  ck(label+' original handlers stopped before write path',page.evaluate('window.__seasonWriteCalls===0&&window.__postGuardCalls===0'))
  ck(label+' expiry maps to user language',page.evaluate("window.friendlyTxError('Batch Water',new Error('MoveAbort abort code: 6, in '+window.arb.CONTRACT.PACKAGE_ID+'::arboretum::assert_season_active')).startsWith('This season has ended.')"))
  ck(label+' unrelated abort preserved',page.evaluate("!window.friendlyTxError('Claim Reward',new Error('MoveAbort abort code: 6, in '+window.arb.CONTRACT.PACKAGE_ID+'::arboretum::claim_reward')).startsWith('This season has ended.')"))
  fixture['now']=fixture['start']+2592000000-60000;refresh('active')
  ck(label+' active controls restored',page.locator('#fixture-single').is_enabled() and page.locator('#fixture-batch').is_enabled())
  ck(label+' live countdown text', 's' in page.locator('#garden-season-time').inner_text() and 'm' in page.locator('#garden-season-time').inner_text())
  page.evaluate("async()=>{await window.doWaterAll();await window.doWaterSeed('fixture');}")
  ck(label+' active preflight permits existing eligibility checks',page.evaluate('window.__postGuardCalls===2&&window.__seasonWriteCalls===0'))
  fixture['paused']=True;refresh('paused');ck(label+' pause locks controls',page.locator('#fixture-single').is_disabled())
  fixture['now']=fixture['start']+2592000000+1000;refresh('ended-paused');ck(label+' pause not mislabeled claim-ready','claims are paused' in page.locator('#garden-season-claims').inner_text())
  fixture['start']=0;fixture['paused']=False;refresh('inactive');ck(label+' archive context not lost','previous-season claims' in page.locator('#garden-season-claims').inner_text())
  fixture['error']=True;refresh('unknown');ck(label+' unavailable fails closed',page.locator('#fixture-single').is_disabled())
  fixture.update(error=False,start=1791000000000,now=1791000000000+2592000000-500)
  refresh('active');page.wait_for_function("document.getElementById('garden-season-status').dataset.phase==='ended'",timeout=5000)
  ck(label+' cutoff updates without another fetch',page.locator('#fixture-single').is_disabled())
  ck(label+' no blocked write attempts',not blocked and page.evaluate('window.__seasonWriteCalls===0'))
  ck(label+' no uncaught JS errors',not errors)
  c.close()
 # Logout prevents new access to the game and all new module paths.
 c=browser.new_context(java_script_enabled=False);c.add_cookies(cookies);page=c.new_page()
 page.goto(BASE+'/tester-access');page.locator('form[action="/tester-logout"] button').click()
 page.wait_for_url('**/tester-access')
 page.goto(BASE+'/game.html');ck('game denied after logout',urlsplit(page.url).path=='/tester-access')
 page.goto(BASE+'/player-guide');ck('handbook public after logout',page.locator('html').get_attribute('data-guide-audience')=='players')
 c.close();browser.close()
print(json.dumps({'checks':len(checks),'passed':sum(x['passed'] for x in checks),'real_game_scripts':True,'wallet_connections':0,'chain_transactions':0}))
