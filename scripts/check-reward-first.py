#!/usr/bin/env python3
"""Actual hosted public-page browser checks. Never connect a wallet."""
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
import json,os
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'reward-results'/'hosted';OUT.mkdir(parents=True,exist_ok=True)
BASE=os.environ['REWARD_PREVIEW_URL'].rstrip('/');checks=[]
def ck(name,value):
 checks.append({'check':name,'passed':bool(value)})
 (OUT/'browser.json').write_text(json.dumps(checks,indent=2))
 if not value:raise AssertionError(name)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True)
 for w,h,label in [(1440,1000,'desktop'),(768,1024,'tablet'),(390,844,'mobile'),(320,740,'small-mobile')]:
  c=b.new_context(viewport={'width':w,'height':h});page=c.new_page();errors=[];requested=[]
  page.on('pageerror',lambda e:errors.append(type(e).__name__));page.on('request',lambda r:requested.append(urlsplit(r.url).path))
  response=page.goto(BASE+'/',wait_until='domcontentloaded')
  ck(label+' homepage loads',response.status==200 and page.locator('body.reward-landing').count()==1)
  ck(label+' no login needed',not c.cookies())
  ck(label+' homepage script-free',page.locator('script').count()==0)
  ck(label+' reward-led opening','At season’s end' in page.locator('.rf-intro').inner_text())
  ck(label+' no Enter the Garden control',page.get_by_role('link',name='Enter the Garden',exact=True).count()==0)
  ck(label+' no horizontal overflow',not page.evaluate('document.documentElement.scrollWidth>innerWidth'))
  page.evaluate('Promise.all([...document.images].filter(i=>i.loading!=="lazy").map(i=>i.decode().catch(()=>null)))')
  page.screenshot(path=str(OUT/('homepage-'+label+'.png')))
  page.get_by_role('link',name='See how rewards work').click()
  ck(label+' reward CTA destination',urlsplit(page.url).fragment=='growth-pool')
  ck(label+' example visibly qualified',page.locator('.rf-example-label').is_visible() and 'NOT A LIVE BALANCE OR FORECAST' in page.locator('.rf-example-label').inner_text())
  ck(label+' full costs included','NFTree + planting + network fees' in page.locator('.rf-season-facts').inner_text())
  page.locator('#growth-pool').screenshot(path=str(OUT/('season-rewards-'+label+'.png')))
  page.locator('#item-shop').scroll_into_view_if_needed();page.evaluate('Promise.all([...document.images].map(i=>i.decode().catch(()=>null)))')
  ck(label+' all artwork loaded',page.locator('img').evaluate_all('(a)=>a.every(i=>i.complete&&i.naturalWidth>0)'))
  ck(label+' six original shop designs',page.locator('.rf-crate').count()==6)
  ck(label+' two original partner chests',page.locator('.rf-partner').count()==2)
  ck(label+' partner sources unchanged',page.locator('.rf-boom img').get_attribute('src')=='/prelaunch/boom-chest.png' and page.locator('.rf-victory img').get_attribute('src')=='/prelaunch/victory-chest.png')
  page.locator('#item-shop').screenshot(path=str(OUT/('item-shop-'+label+'.png')))
  ck(label+' no public shop purchase forms',page.locator('#item-shop form,#item-shop button').count()==0)
  page.locator('a[href="/player-guide#boom-chest"]').click();page.wait_for_url('**/player-guide*',wait_until='domcontentloaded')
  ck(label+' partner link reaches public handbook',page.locator('html').get_attribute('data-guide-audience')=='players' and urlsplit(page.url).fragment=='boom-chest')
  page.goto(BASE+'/player-guide',wait_until='domcontentloaded');page.locator('#tool-controls').wait_for(state='visible')
  ck(label+' reward-first guide marker',page.locator('html').get_attribute('data-reward-first')=='true')
  ids=page.locator('main>section').evaluate_all('(a)=>a.map(e=>e.id)')
  ck(label+' guide rewards precede purchases and tools',ids.index('rewards')<ids.index('buy-first')<ids.index('tools'))
  ck(label+' guide no horizontal overflow',not page.evaluate('document.documentElement.scrollWidth>innerWidth'))
  page.evaluate('Promise.all([...document.images].filter(i=>i.loading!=="lazy").map(i=>i.decode().catch(()=>null)))')
  page.screenshot(path=str(OUT/('player-guide-'+label+'.png')))
  page.get_by_role('link',name='Understand the reward').click();ck(label+' guide reward CTA',urlsplit(page.url).fragment=='rewards')
  ck(label+' twenty tool entries retained',page.locator('details.tool').count()==20)
  page.locator('#tool-category').select_option('Recovery');ck(label+' functional category filter',page.locator('details.tool:not([hidden])').count()==1)
  page.locator('#tool-category').select_option('all');page.locator('#tool-search').fill('zzznomatch');ck(label+' guide empty state',page.locator('#no-tools').is_visible())
  page.evaluate('location.hash="tool-fertilizer"');page.wait_for_function('document.getElementById("tool-fertilizer").open');ck(label+' deep link resets filter',page.locator('#tool-search').input_value()=='')
  ck(label+' no wallet scripts requested',not any(x.endswith(('/wallet.js','/garden.js','/sui-sdk.bundle.js')) for x in requested))
  ck(label+' no page errors',not errors)
  c.close()
 b.close()
print(json.dumps({'checks':len(checks),'passed':sum(x['passed'] for x in checks),'wallet_transactions':0}))
