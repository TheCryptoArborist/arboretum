"""Hosted native tester gate plus report integration. No real wallet connection.
The positive Admin identity and archived-season UI are explicit test doubles.
"""
import json,os
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
BASE=os.environ['PARTNER_URL'].rstrip('/');OUT=Path('economy-review-results/hosted');OUT.mkdir(parents=True,exist_ok=True)
checks=[]
def ck(name,ok):
 checks.append({'check':name,'passed':bool(ok)});(OUT/'browser-checks.json').write_text(json.dumps(checks,indent=2))
 if not ok:raise AssertionError(name)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 c=browser.new_context(java_script_enabled=False);page=c.new_page();page.goto(BASE+'/tester-access')
 page.locator('#password').fill('invalid-tester-code');page.locator('button[type=submit]').first.click();ck('native wrong code rejected',page.locator('[role=alert]').is_visible())
 page.locator('#password').fill(os.environ['PARTNER_TESTER_PASSWORD']);page.locator('button[type=submit]').first.click();page.wait_for_url('**/game.html')
 ck('native existing tester login opens game',page.locator('#partner-revenue-mount').count()==1)
 cookies=c.cookies();ck('secure HttpOnly tester cookie',any(x['name']=='__Host-arboretum_tester' and x['httpOnly'] and x['secure'] for x in cookies));c.close()
 live_report=None
 for width,label in [(1440,'desktop'),(390,'mobile'),(768,'tablet'),(320,'small-mobile')]:
  c=browser.new_context(viewport={'width':width,'height':1100},timezone_id='America/Chicago',accept_downloads=True);c.add_cookies(cookies);page=c.new_page();blocked=[];errors=[]
  def route(r):
   req=r.request
   if req.method=='POST' and urlsplit(req.url).netloc!=urlsplit(BASE).netloc:
    try:d=req.post_data_json
    except Exception:d={}
    if isinstance(d,dict) and 'query' in d:
     q=d['query']
     if not q.lstrip().startswith(('query','{')) or any(x in q for x in ['executeTransaction','simulateTransaction','dryRunTransaction']):blocked.append('write/simulation');r.abort();return
    else:
     xs=d if isinstance(d,list) else [d]
     if any(not isinstance(x,dict) or not str(x.get('method','')).startswith(('sui_get','sui_multiGet','suix_get','suix_query','suix_resolve')) for x in xs):blocked.append('non-read request');r.abort();return
   r.continue_()
  page.route('**/*',route);page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(BASE+'/game.html',wait_until='domcontentloaded');page.wait_for_function('window.arb && window.arbPartnerReport',timeout=45000)
  ck(label+' actual game scripts loaded',page.evaluate("typeof window.arb.waterSeed==='function'&&typeof window.doClaimReward==='function'"))
  ck(label+' no real wallet connected',page.evaluate('!window.arb.getAddress()'))
  await_result=page.evaluate('async()=>{await window.arbPartnerReport.loadSeasons();return document.querySelector("#partner-revenue-mount .pr-status").textContent;}')
  ck(label+' disconnected Admin access denied','authorized wallet' in await_result)
  # This is an in-memory test identity, not a signed owner login. Never click
  # existing administrative write controls. All report operations are reads.
  page.evaluate("""()=>{window.__originalAddress=window.arb.getAddress();window.arb.getAddress=()=>('0x'+'f'.repeat(64));window.arb.isAdmin=()=>true;const n=document.getElementById('admin-panel');n.style.display='block';n.classList.add('show');}""")
  root=page.locator('#partner-revenue-mount')
  if live_report is None:
   root.get_by_role('button',name='Load seasons',exact=True).click()
   page.wait_for_function('!document.querySelector("[aria-label=\\"Planting season\\"]").disabled',timeout=90000)
   ck('genuine discovery populated season selector',root.get_by_label('Planting season').input_value()!='')
   root.get_by_role('button',name='Read on-chain receipts',exact=True).click()
   page.wait_for_function('document.querySelector("#partner-revenue-mount .pr-card")',timeout=90000)
   ck('genuine reader identifies testing economy','TEST' in root.locator('.pr-status').inner_text())
   with page.expect_download() as dl:root.get_by_role('button',name='Export JSON',exact=True).click()
   dl.value.save_as(str(OUT/'live-report.json'));live_report=json.loads((OUT/'live-report.json').read_text())
   ck('export keeps checkpoint and coverage',bool(live_report['coverage']['throughCheckpoint']) and 'complete' in live_report['coverage'])
   ck('testing receipts do not create purchase budgets',all(x['purchaseBudgetMist'] is None for x in live_report['rows']))
   ck('matching snapshot keeps season',page.evaluate('(s)=>window.arbPartnerReport.snapshotAttachment(s).mode',live_report['season']['id'])=='live_test')
   ck('wrong-season snapshot blocked',page.evaluate('window.arbPartnerReport.snapshotAttachment("99999").status')=='not_loaded_for_snapshot_season')
  else:
   page.evaluate('(r)=>window.arbPartnerReport.render(r)',live_report)
  root.scroll_into_view_if_needed();page.wait_for_function('Array.from(document.querySelectorAll("#partner-revenue-mount img")).every(x=>x.complete&&x.naturalWidth>0)')
  ck(label+' original artwork loaded',root.locator('img').count()==2)
  ck(label+' no report overflow',root.evaluate('(e)=>e.scrollWidth<=e.clientWidth'))
  root.screenshot(path=str(OUT/f'partner-{label}.png'))
  # Exercise archived selection on hosted module without inventing live archives.
  page.evaluate("""async(r)=>{
   const {mountPartnerPanel}=await import('/economy-review/partner-panel.mjs');
   window.arbPartnerReport.destroy();window.__fixtureFailure=false;
   const a=structuredClone(r);a.season={...a.season,id:'2',kind:'archived',selectionKey:'archive:fixture',archiveId:'CONTROLLED TEST FIXTURE',claimDeadlineMs:Date.now()+86400000};a.rows=a.rows.map(x=>({...x,seasonId:'2'}));
   const now=structuredClone(r);now.season={...now.season,selectionKey:'current:3'};
   window.__panel=mountPartnerPanel(document.getElementById('partner-revenue-mount'),{requireAdmin:true,seasonSelection:true,
    listSeasons:async()=>({seasons:[{id:'3',key:'current:3',kind:'current',selectable:true},{id:'2',key:'archive:fixture',kind:'archived',selectable:true}],issues:[],discovery:{objectsComplete:true}}),
    readSeason:async(key)=>{if(window.__fixtureFailure)throw Error('Controlled read failure');return key==='archive:fixture'?a:now;}});
   await window.__panel.loadSeasons();
  }""",live_report)
  root.get_by_label('Planting season').select_option('archive:fixture');root.get_by_role('button',name='Read on-chain receipts',exact=True).click()
  page.wait_for_function('document.querySelector("#partner-revenue-mount .pr-card")')
  ck(label+' archive selection renders distinct season','season 2 (archived)' in root.inner_text())
  ck(label+' archive disclaimer visible','does not check individual reward eligibility' in root.inner_text())
  with page.expect_download() as dl:root.get_by_role('button',name='Export CSV',exact=True).click()
  text=Path(dl.value.path()).read_text();ck(label+' archive CSV identifies selected season','"archived"' in text and '"CONTROLLED TEST FIXTURE"' in text)
  ck(label+' wrong active snapshot excludes archived report',page.evaluate('window.__panel.snapshotAttachment("3").status')=='not_loaded_for_snapshot_season')
  root.get_by_label('Planting season').select_option('current:3');ck(label+' change clears prior cards',root.locator('.pr-card').count()==0)
  ck(label+' change disables old exports',root.get_by_role('button',name='Export JSON',exact=True).is_disabled())
  root.get_by_label('Planting season').select_option('archive:fixture');root.get_by_role('button',name='Read on-chain receipts',exact=True).click();page.wait_for_function('document.querySelector("#partner-revenue-mount .pr-card")')
  page.evaluate('window.__fixtureFailure=true');root.get_by_role('button',name='Read on-chain receipts',exact=True).click();page.wait_for_function('document.querySelector("#partner-revenue-mount .pr-error")')
  ck(label+' failed refresh disables exports',root.get_by_role('button',name='Export JSON',exact=True).is_disabled())
  ck(label+' stale snapshot explicitly marked',page.evaluate('window.__panel.snapshotAttachment("2").status')=='STALE_PREVIOUS_READ')
  page.evaluate('window.arb.isAdmin=()=>false');ck(label+' disconnected snapshot denied',page.evaluate('window.__panel.snapshotAttachment("2").status')=='admin_unavailable')
  ck(label+' no transaction or simulation attempted',not blocked)
  ck(label+' no module or page runtime exceptions',not errors)
  c.close()
 browser.close()
(OUT/'browser-summary.json').write_text(json.dumps({'checks':len(checks),'passed':sum(x['passed'] for x in checks),'walletConnections':0,'transactionsSubmitted':0,'scope':'Genuine native tester gate and genuine read of current test receipts; positive Admin identity and archive UI states used explicit in-memory test doubles.'},indent=2))
