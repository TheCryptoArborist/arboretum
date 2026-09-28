"""Hosted public-layout and native tester-form checks; never sign wallet actions."""
import json,os
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
base=os.environ['SHOWCASE_URL'].rstrip('/')
assert base=='https://treegrow.xyz' or (urlparse(base).scheme=='https' and urlparse(base).hostname.endswith('--arboretum-sui-forest.netlify.app'))
out=Path('showcase-results')/os.environ.get('SHOWCASE_STAGE','preview');out.mkdir(parents=True,exist_ok=True)
checks=[]
def check(name,ok):
 checks.append({'check':name,'passed':bool(ok)});(out/'browser.json').write_text(json.dumps(checks,indent=2))
 if not ok:raise RuntimeError(name)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True)
 for w,h,name in [(1440,1050,'desktop'),(768,1024,'tablet'),(390,844,'mobile'),(320,740,'small-mobile')]:
  c=b.new_context(viewport={'width':w,'height':h},reduced_motion='reduce');page=c.new_page();requests=[]
  page.on('request',lambda r:requests.append(r.url));r=page.goto(base+'/',wait_until='networkidle')
  page.locator('img').evaluate_all("a=>Promise.all(a.map(i=>{i.loading='eager';return i.decode().catch(()=>null)}))")
  check(name+' page served',r.status==200)
  check(name+' both requested sections',page.locator('#item-shop').count()==1 and page.locator('#growth-pool').count()==1)
  check(name+' five authentic crate cards',page.locator('.shop-preview-card h3').all_text_contents()==['Seedling','Grove','Canopy','Ancient','Mythic'])
  check(name+' pool is labeled explanatory', 'not a live pool balance' in page.locator('.pool-preview-note').inner_text())
  check(name+' image decoding',page.locator('img').evaluate_all('a=>a.every(i=>i.complete&&i.naturalWidth>0)'))
  check(name+' no document overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
  check(name+' no wallet scripts on public page',page.locator('script').count()==0 and not any('/wallet.js' in u or '/garden.js' in u for u in requests))
  check(name+' referrals unchanged',page.locator('.referral-value strong').all_text_contents()==['10%','1%'])
  page.locator('.shop-more summary').click();check(name+' partner descriptions expand','BOOM Chest' in page.locator('.shop-extras').inner_text());page.locator('.shop-more summary').click()
  if w<1050:check(name+' shop cards scroll horizontally',page.locator('.shop-carousel').evaluate('e=>e.scrollWidth>e.clientWidth'))
  page.locator('#item-shop').screenshot(path=str(out/('shop-'+name+'.png')))
  page.locator('#growth-pool').screenshot(path=str(out/('pool-'+name+'.png')))
  page.screenshot(path=str(out/('homepage-'+name+'.png')),full_page=True);c.close()
 # Restrict authenticated browsing to script-free navigation: no wallet or RPC calls.
 for w,h,name in [(1440,1050,'desktop'),(390,844,'mobile')]:
  c=b.new_context(viewport={'width':w,'height':h},java_script_enabled=False);page=c.new_page();page.goto(base+'/tester-access',wait_until='load')
  page.locator('input[name="password"]').fill('incorrect-showcase-test')
  with page.expect_navigation(wait_until='load') as nav:page.locator('form[action="/tester-access"] button').click()
  check(name+' wrong code rejected',nav.value.status==401)
  page.locator('input[name="password"]').fill(os.environ['SHOWCASE_TESTER_PASSWORD'])
  with page.expect_navigation(wait_until='load'):page.locator('form[action="/tester-access"] button').click()
  check(name+' native login serves game',page.locator('#garden-sec').count()==1)
  page.reload(wait_until='load');check(name+' authenticated reload',page.locator('#garden-sec').count()==1)
  r=page.goto(base+'/player-guide',wait_until='load');check(name+' protected guide',r.status==200 and 'What do I need to buy first?' in page.locator('body').inner_text())
  page.goto(base+'/tester-access',wait_until='load')
  with page.expect_navigation(wait_until='load'):page.locator('form[action="/tester-logout"] button').click()
  check(name+' logout removes access',c.request.get(base+'/wallet.js',headers={'Accept':'application/json'}).status in (401,403));c.close()
 b.close()
print(json.dumps({'assertions':len(checks),'all_passed':all(x['passed'] for x in checks),'wallet_transactions':0}))
