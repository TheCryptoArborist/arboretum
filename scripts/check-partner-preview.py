#!/usr/bin/env python3
"""Read-only homepage browser checks; no wallet connection or transaction."""
from pathlib import Path
import json,os
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
BASE=os.environ['PARTNER_URL'].rstrip('/')
OUT=ROOT/'partner-results'/os.environ.get('PARTNER_STAGE','preview');OUT.mkdir(parents=True,exist_ok=True)
checks=[]
def check(name,ok):
 checks.append({'check':name,'passed':bool(ok)})
 (OUT/'browser.json').write_text(json.dumps(checks,indent=2))
 if not ok:raise AssertionError(name)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True)
 for w,h,name in [(1440,1000,'desktop'),(768,1024,'tablet'),(390,844,'mobile'),(320,740,'small-mobile')]:
  c=b.new_context(viewport={'width':w,'height':h});page=c.new_page();errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  r=page.goto(BASE+'/',wait_until='domcontentloaded')
  check(name+' homepage accessible without login',r.status==200 and not c.cookies())
  check(name+' removed public gameplay CTA',page.get_by_role('link',name='Enter the Garden',exact=True).count()==0)
  check(name+' tester link remains',page.locator('header .tester-link').count()==1)
  page.evaluate('Promise.all([...document.images].filter(i=>i.loading!=="lazy").map(i=>i.decode().catch(()=>null)))')
  page.screenshot(path=str(OUT/('homepage-'+name+'.png')))
  page.locator('#partner-chests').scroll_into_view_if_needed()
  page.locator('#partner-chests img').evaluate_all('(imgs)=>Promise.all(imgs.map(i=>i.decode().catch(()=>null)))')
  check(name+' two readable visible partner cards',page.locator('.partner-preview-card').count()==2 and page.locator('.partner-preview-card.boom').is_visible() and page.locator('.partner-preview-card.victory').is_visible())
  check(name+' partner artwork loads',page.locator('#partner-chests img').evaluate_all('(a)=>a.every(i=>i.complete&&i.naturalWidth>0)'))
  check(name+' partner cards are not inside a disclosure',page.locator('#partner-chests').evaluate('(e)=>!e.closest("details")'))
  check(name+' no document overflow',not page.evaluate('document.documentElement.scrollWidth > innerWidth'))
  check(name+' readable partner body text',page.locator('.partner-preview-card p').evaluate_all('(a)=>a.every(e=>parseFloat(getComputedStyle(e).fontSize)>=13)'))
  page.locator('#partner-chests').screenshot(path=str(OUT/('partner-chests-'+name+'.png')))
  page.locator('.partner-preview-heading a').click()
  page.wait_for_url('**/player-guide#crates',wait_until='domcontentloaded')
  check(name+' chest guide opens publicly',page.locator('html').get_attribute('data-guide-audience')=='players' and not c.cookies())
  check(name+' no script errors',not errors)
  c.close()
 b.close()
print(json.dumps({'assertions':len(checks),'passed':sum(x['passed'] for x in checks),'wallet_transactions':0}))
