"""Offline desktop/mobile checks against an explicitly labelled mainnet snapshot.
All browser requests are intercepted. No live calls, wallets, or transactions.
"""
from pathlib import Path
import json, mimetypes, re, shutil
from urllib.parse import urlparse, unquote
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'season-four-results'/'browser'
OUT.mkdir(parents=True,exist_ok=True)
EVIDENCE=ROOT/'settlement-cycle-four'/'verification'/'mainnet'
normalize=lambda query: re.sub(r'\s+',' ',query).strip()
responses={}
for name in ['previous-claim-proof','inputs','fields']:
    request=json.loads((EVIDENCE/(name+'-request.json')).read_text())
    capture=json.loads((EVIDENCE/(name+'.json')).read_text())
    responses[normalize(request['query'])]=(request['variables'],capture.get('response',capture))
summary=json.loads((EVIDENCE/'summary.json').read_text())
from datetime import datetime
frozen=int(datetime.fromisoformat(summary['checkpoint']['timestamp'].replace('Z','+00:00')).timestamp()*1000)
record={'mode':'offline replay of saved mainnet reads','observedCheckpoint':summary['checkpoint'],
        'walletConnections':0,'submittedTransactions':0,'externalRequests':0,'views':[]}
with sync_playwright() as p:
    executable=shutil.which('google-chrome') or shutil.which('chromium')
    browser=p.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox'])
    for name,width,height in [('desktop',1440,1000),('mobile',390,844)]:
        context=browser.new_context(viewport={'width':width,'height':height},device_scale_factor=1)
        context.add_init_script('''(() => {const Native=Date; class SnapshotDate extends Native {constructor(...args){super(...(args.length?args:[%d]));} static now(){return %d;}} window.Date=SnapshotDate;})();'''%(frozen,frozen))
        mode={'unavailable':False};errors=[];reads=[]
        def route_request(route):
            request=route.request;url=urlparse(request.url)
            if url.hostname=='graphql.mainnet.sui.io':
                cors={'Access-Control-Allow-Origin':'https://www.treegrow.xyz','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'content-type,accept,cache-control,pragma'}
                if request.method=='OPTIONS':
                    route.fulfill(status=204,headers=cors);return
                if mode['unavailable']:
                    route.fulfill(status=503,headers=cors,content_type='application/json',body='{"errors":[{"message":"Offline unavailable-data test"}]}');return
                body=request.post_data_json
                pair=responses.get(normalize(body.get('query','')))
                assert pair and body.get('variables')==pair[0], 'Unexpected query or variables'
                reads.append(normalize(body['query']).split('{')[0])
                route.fulfill(status=200,headers=cors,content_type='application/json',body=json.dumps(pair[1]));return
            if url.hostname=='www.treegrow.xyz' and request.method=='GET':
                rel=unquote(url.path).lstrip('/')
                if rel.endswith('/'):rel+='index.html'
                file=(ROOT/'dist'/rel).resolve()
                assert file.is_relative_to((ROOT/'dist').resolve()),'Invalid local asset path'
                if file.is_file():
                    mime='text/javascript' if file.suffix=='.mjs' else mimetypes.guess_type(str(file))[0] or 'application/octet-stream'
                    route.fulfill(status=200,content_type=mime,body=file.read_bytes());return
            route.abort()
        context.route('**/*',route_request)
        page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto('https://www.treegrow.xyz/admin/season-four/',wait_until='networkidle')
        page.wait_for_function("document.querySelector('#chain-status').textContent==='Mainnet verified'",timeout=20000)
        assert page.locator('#current-stage').inner_text()=='Ready for Season 4'
        assert page.locator('#action-heading').inner_text()=='Start Season 4'
        assert page.locator('#check-action').is_disabled() and page.locator('#submit-action').is_disabled()
        assert page.locator('.back-link').get_attribute('href')=='/admin/season-three/'
        assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth'), 'Horizontal overflow'
        page.evaluate("""() => {const note=document.createElement('div');note.textContent='VERIFICATION PREVIEW · Recorded mainnet snapshot · Wallet disabled';note.style.cssText='position:sticky;top:0;z-index:9999;padding:10px;text-align:center;background:#fff4bd;color:#191919;font:14px sans-serif';document.body.prepend(note);} """)
        page.screenshot(path=str(OUT/(name+'.png')),full_page=True)
        mode['unavailable']=True
        page.locator('#refresh-state').click()
        page.wait_for_function("document.querySelector('#status-title').textContent==='Season status could not be verified'",timeout=20000)
        assert page.locator('#check-action').is_disabled() and page.locator('#submit-action').is_disabled()
        assert not errors,errors
        record['views'].append({'name':name,'width':width,'height':height,'pageErrors':errors,
            'noHorizontalOverflow':True,'walletActionsDisabled':True,'readFailureClosed':True,'snapshotReads':len(reads)})
        context.close()
    browser.close()
record['passed']=True
(OUT/'summary.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record,indent=2))
