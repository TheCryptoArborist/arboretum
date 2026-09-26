from playwright.sync_api import sync_playwright
from pathlib import Path
import json, base64, mimetypes
out=Path(__file__).resolve().parents[1]/'prelaunch-results'
root=out.parent
html=(root/'dist/index.html').read_text()
html=html.replace('<link rel="stylesheet" href="/prelaunch/site.css">', '<style>'+ (root/'prelaunch/site.css').read_text()+'</style>')
for name in ['forest.jpg','hero.png','mark.png','ancient.jpg']:
 data=(root/'dist/prelaunch'/name).read_bytes()
 html=html.replace('/prelaunch/'+name, 'data:'+mimetypes.guess_type(name)[0]+';base64,'+base64.b64encode(data).decode())
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 results=[]
 for w,h,label in [(1440,1050,'desktop'),(390,844,'mobile'),(320,740,'small-mobile')]:
  page=b.new_page(viewport={'width':w,'height':h},device_scale_factor=1)
  errs=[];page.on('pageerror',lambda e:errs.append(str(e)))
  page.set_content(html.replace('loading="lazy"','loading="eager"'),wait_until='load');page.evaluate('Promise.all([...document.images].map(i=>i.decode().catch(()=>null)))');page.screenshot(path=str(out/(label+'.png')),full_page=True)
  bad=page.locator('img').evaluate_all('(imgs)=>imgs.filter(i=>!i.complete || i.naturalWidth===0).map(i=>i.alt)')
  overflow=page.evaluate('document.documentElement.scrollWidth > innerWidth')
  result={'view':label,'imagesMissing':bad,'overflow':overflow,'consoleErrors':errs,'noWalletOrGameJS':not page.locator('script').count(), 'scope':'in-memory browser rendering; HTTP handler tested separately'}
  assert not bad and not overflow and not errs and result['noWalletOrGameJS'],str(result)
  results.append(result)
  page.close()
 b.close()
(out/'browser-checks.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results,indent=2))
