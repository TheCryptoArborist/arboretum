#!/usr/bin/env python3
"""Real browser checks of anonymous public guide and private tester navigation.
Handbook JavaScript runs. Authenticated game checks use a JS-disabled context.
"""
from pathlib import Path
from urllib.parse import urlsplit
import json,os
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];BASE=os.environ['HANDBOOK_URL'].rstrip('/');STAGE=os.environ.get('HANDBOOK_STAGE','preview')
OUT=ROOT/'handbook-results'/STAGE;OUT.mkdir(parents=True,exist_ok=True)
checks=[]
def check(name,ok):
 checks.append({'check':name,'passed':bool(ok)})
 (OUT/'browser.json').write_text(json.dumps(checks,indent=2))
 if not ok:raise AssertionError(name)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 for w,h,label in [(1440,1000,'desktop'),(768,1024,'tablet'),(390,844,'mobile'),(320,740,'small-mobile')]:
  c=browser.new_context(viewport={'width':w,'height':h});page=c.new_page();errors=[];requests=[]
  page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(urlsplit(r.url).path))
  response=page.goto(BASE+'/player-guide',wait_until='domcontentloaded');page.locator('#tool-controls').wait_for(state='visible')
  check(label+' anonymous handbook',response.status==200 and page.locator('html').get_attribute('data-guide-audience')=='players')
  check(label+' public without cookies',len(c.cookies())==0)
  check(label+' no tester warning','Read this before testing' not in page.locator('body').inner_text())
  check(label+' twenty tool cards',page.locator('details.tool').count()==20)
  check(label+' CSS loaded',page.locator('body').evaluate('(e)=>getComputedStyle(e).backgroundColor') in ['rgb(6, 16, 22)','rgb(9, 19, 15)'])
  check(label+' no horizontal overflow',not page.evaluate('document.documentElement.scrollWidth > innerWidth'))
  page.evaluate('Promise.all([...document.images].filter(i=>i.loading!=="lazy").map(i=>i.decode().catch(()=>null)))')
  page.screenshot(path=str(OUT/('handbook-'+label+'.png')))
  page.locator('#crates').scroll_into_view_if_needed();page.evaluate('Promise.all([...document.images].map(i=>i.decode().catch(()=>null)))')
  check(label+' all artwork loaded',page.locator('img').evaluate_all('(a)=>a.every(i=>i.complete&&i.naturalWidth>0)'))
  page.screenshot(path=str(OUT/('crates-'+label+'.png')))
  page.locator('#tools').scroll_into_view_if_needed();page.locator('#tool-category').select_option('Recovery')
  check(label+' category filter',page.locator('details.tool:not([hidden])').count()==1)
  page.locator('#tool-category').select_option('all');page.locator('#tool-search').fill('zzznomatch')
  check(label+' empty state',page.locator('#no-tools').is_visible())
  page.evaluate('location.hash="tool-fertilizer"');page.wait_for_function('document.getElementById("tool-fertilizer").open')
  check(label+' deep link clears filters',page.locator('#tool-search').input_value()=='' and page.locator('details.tool:not([hidden])').count()==20)
  page.locator('#expand-tools').click();check(label+' expand tools',page.locator('details.tool[open]').count()==20)
  page.locator('#collapse-tools').click();check(label+' collapse tools',page.locator('details.tool[open]').count()==0)
  page.evaluate('window.dispatchEvent(new Event("beforeprint"))');check(label+' print expands tools',page.locator('details.tool[open]').count()==20)
  page.evaluate('window.dispatchEvent(new Event("afterprint"))');check(label+' print restores state',page.locator('details.tool[open]').count()==0)
  check(label+' no wallet scripts requested',not any(x.endswith(('/wallet.js','/garden.js','/sui-sdk.bundle.js')) for x in requests))
  check(label+' no script errors',not errors)
  check(label+' restrictive CSP',"connect-src 'none'" in response.headers.get('content-security-policy',''))
  c.close()
 # Confirm progressive enhancement without any guide JavaScript.
 c=browser.new_context(java_script_enabled=False);page=c.new_page();page.goto(BASE+'/player-guide',wait_until='domcontentloaded');page.locator('#tool-fertilizer summary').click();check('no-JS tool disclosure',page.locator('#tool-fertilizer').get_attribute('open') is not None);c.close()
 # No wallet code is executed during login / private reference verification.
 c=browser.new_context(java_script_enabled=False,viewport={'width':390,'height':844});page=c.new_page();page.goto(BASE+'/tester-access',wait_until='domcontentloaded')
 page.locator('#password').fill('incorrect-example');page.locator('button[type=submit]').first.click();page.locator('[role=alert]').wait_for();check('wrong code retry',page.locator('[role=alert]').is_visible())
 page.locator('#password').fill(os.environ['HANDBOOK_TESTER_PASSWORD']);page.locator('button[type=submit]').first.click();page.wait_for_url('**/game*',wait_until='domcontentloaded')
 check('correct code still opens private game',urlsplit(page.url).path in ['/game','/game.html'] and page.locator('#garden-sec').count()==1)
 page.goto(BASE+'/tester-guide',wait_until='domcontentloaded');check('tester reference remains available after login','Read this before testing' in page.locator('body').inner_text())
 page.goto(BASE+'/tester-access',wait_until='domcontentloaded');page.locator('form[action="/tester-logout"] button').click();page.wait_for_url('**/tester-access',wait_until='domcontentloaded')
 page.goto(BASE+'/tester-guide',wait_until='domcontentloaded');check('tester reference denied after logout',urlsplit(page.url).path=='/tester-access')
 page.goto(BASE+'/player-guide',wait_until='domcontentloaded');check('public handbook still opens after logout',page.locator('html').get_attribute('data-guide-audience')=='players');c.close();browser.close()
print(json.dumps({'browser_assertions':len(checks),'passed':sum(x['passed'] for x in checks),'wallet_transactions':0}))
