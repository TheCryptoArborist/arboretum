"""Real hosted layout and native-form regression. No wallet or chain signing."""
import json,os,sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
base=os.environ['REDESIGN_PREVIEW_URL'].rstrip('/')
password=os.environ['REDESIGN_TESTER_PASSWORD']
assert urlparse(base).scheme=='https' and urlparse(base).hostname.endswith('--arboretum-sui-forest.netlify.app')
out=Path('prelaunch-results');out.mkdir(exist_ok=True)
checks=[]
def check(label,condition):
 checks.append({'check':label,'passed':bool(condition)})
 (out/'redesign-browser.json').write_text(json.dumps(checks,indent=2))
 if not condition:raise RuntimeError(label)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 for w,h,label in [(1440,1050,'desktop'),(768,1024,'tablet'),(390,844,'mobile'),(320,740,'small-mobile')]:
  c=browser.new_context(viewport={'width':w,'height':h},reduced_motion='reduce')
  page=c.new_page();errors=[];requests=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('request',lambda r:requests.append(r.url))
  response=page.goto(base+'/',wait_until='networkidle')
  check(label+' public page',response.status==200)
  page.locator('img').evaluate_all("imgs=>Promise.all(imgs.map(i=>{i.loading='eager';return i.decode().catch(()=>null)}))")
  check(label+' real headline',page.locator('h1').count()==1 and 'SUI Growth Pool' in page.locator('h1').inner_text())
  check(label+' visible referral percentages',page.locator('.referral-value strong').all_text_contents()==['10%','1%'])
  check(label+' three benefit cards',page.locator('.benefit-card').count()==3)
  check(label+' no document horizontal overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
  check(label+' all images decoded',page.locator('img').evaluate_all('a=>a.every(i=>i.complete&&i.naturalWidth>0)'))
  check(label+' no public wallet scripts',page.locator('script').count()==0 and not any('/wallet.js' in u or '/garden.js' in u for u in requests))
  check(label+' no JavaScript errors',not errors)
  page.locator('details summary').click();check(label+' expandable essentials',page.locator('details').get_attribute('open') is not None)
  page.locator('details summary').click()
  if w>820:
   page.locator('.main-nav a[href="#referrals"]').click();check(label+' referral navigation',urlparse(page.url).fragment=='referrals')
  page.evaluate('scrollTo(0,0)');page.screenshot(path=str(out/('redesign-'+label+'.png')),full_page=True)
  if w<=600:check(label+' scrollable readable gameplay crop',page.locator('.screen-scroll').evaluate('e=>e.scrollWidth>e.clientWidth'))
  for button in page.locator('.actions a').all():
   box=button.bounding_box();check(label+' large CTA '+button.inner_text().strip(),box is not None and box['height']>=44)
  check(label+' tester link',page.locator('.actions a').first.get_attribute('href')=='/tester-access')
  c.close()
 # Forms are script-free. Disable JS on authenticated game pages to avoid wallet/RPC code.
 for w,h,label in [(1440,1050,'desktop'),(390,844,'mobile')]:
  c=browser.new_context(viewport={'width':w,'height':h},java_script_enabled=False)
  page=c.new_page();page.goto(base+'/',wait_until='load');page.locator('.actions a').first.click()
  check(label+' entry opens form',page.locator('input[name="password"]').count()==1)
  page.locator('input[name="password"]').fill('incorrect-test-code')
  with page.expect_navigation(wait_until='load') as nav:page.locator('form[action="/tester-access"] button').click()
  check(label+' invalid code retains form',nav.value.status==401 and page.locator('input[name="password"]').count()==1)
  page.locator('input[name="password"]').fill(password)
  with page.expect_navigation(wait_until='load'):page.locator('form[action="/tester-access"] button').click()
  check(label+' native login reaches original game',page.locator('#garden-sec').count()==1 and '/game' in urlparse(page.url).path)
  page.reload(wait_until='load');check(label+' authenticated reload',page.locator('#garden-sec').count()==1)
  r=page.goto(base+'/player-guide',wait_until='load');check(label+' authenticated guide',r.status==200 and 'What do I need to buy first?' in page.locator('body').inner_text())
  page.goto(base+'/tester-access',wait_until='load')
  check(label+' styled form fits viewport',page.locator('input[name="password"]').bounding_box()['width']<=w)
  page.screenshot(path=str(out/('redesign-login-'+label+'.png')),full_page=True)
  with page.expect_navigation(wait_until='load'):page.locator('form[action="/tester-logout"] button').click()
  r=c.request.get(base+'/wallet.js',headers={'Accept':'application/json'});check(label+' logout revokes access',r.status in (401,403))
  c.close()
 browser.close()
print(json.dumps({'browser_assertions':len(checks),'passed':sum(x['passed'] for x in checks),'wallet_transactions':0,'scope':'Hosted Chromium public-page renders and native-form login; authenticated game JS intentionally disabled.'}))
