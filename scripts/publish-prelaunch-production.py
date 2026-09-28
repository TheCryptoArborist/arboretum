#!/usr/bin/env python3
"""One approved website release; no Sui transactions or game-state changes.
Receives a short-lived Netlify build capability through a run-bound encrypted
handoff. Signing material stays in runner temp, never in source or artifacts.
"""
import base64,hashlib,io,json,os,pathlib,subprocess,sys,time,urllib.parse,zipfile
import requests
from cryptography.hazmat.primitives.asymmetric import rsa,padding
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'production-release-results';OUT.mkdir(exist_ok=True)
SITE='a344fb31-10b4-4eea-9562-067d90a39607'
BASE='2338affe1dd984f5bc676cec7f3763d1f37a90cf'
APPROVED='51c3a571fb340fbd6b32b0c1dde47673280244c1'
RUN=os.environ['GITHUB_RUN_ID']
KEY=pathlib.Path(os.environ['RUNNER_TEMP'])/'prelaunch-production-handoff.pem'
PUBLIC='https://treegrow.xyz'
OLD_DEPLOY='6aa4e0bdc5c59a631ddc1db9'
sys.excepthook=lambda kind,value,tb:print('Production release stopped ('+kind.__name__+'). Inspect the non-secret report; no successful release is implied.',file=sys.stderr)
def save(name,value): (OUT/name).write_text(json.dumps(value,indent=2)+'\n')
def sha(b):return hashlib.sha256(b).hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT)
if os.environ.get('PRODUCTION_RELAY_MODE')=='key':
 key=rsa.generate_private_key(public_exponent=65537,key_size=3072)
 KEY.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()));KEY.chmod(0o600)
 save('handoff-public-key.json',{'run_id':RUN,'site_id':SITE,'approved_source':APPROVED,'production_release':True,'public_key':key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo).decode()})
 print('Run-specific production release public key ready. No capability received.');raise SystemExit(0)
# Deployment application bytes must remain exactly the owner-approved revision.
application=['prelaunch/index.html','prelaunch/site.css','prelaunch/garden-preview.avif','netlify/edge-functions/tester-gate.ts','netlify.toml','scripts/build-prelaunch.mjs','scripts/build-player-guide.py','scripts/build-guide-site.mjs']
for name in application:
 assert git('show',APPROVED+':'+name)==(ROOT/name).read_bytes(), 'Approved application source drift'
unchanged=['index.html','wallet.js','garden.js','sui-sdk.bundle.js','sdk-entry.js','netlify/functions/calendar-reminder.js','contract/sources/arboretum.move']
for name in unchanged:assert git('show',BASE+':'+name)==(ROOT/name).read_bytes(), 'Game source changed'
# Confirm no unrelated production commit has arrived since owner approval.
api=requests.Session();api.headers.update({'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json'})
main=api.get('https://api.github.com/repos/TheCryptoArborist/arboretum/git/ref/heads/main',timeout=20)
main.raise_for_status();assert main.json()['object']['sha']==BASE, 'Main changed: reconcile before publishing'
previous={}
for path in ['index.html','wallet.js','garden.js','sui-sdk.bundle.js','player-guide.html']:
 r=requests.get(PUBLIC+'/'+path,timeout=30);r.raise_for_status();previous[path]=sha(r.content)
 if path in ['wallet.js','garden.js','sui-sdk.bundle.js']:assert r.content==(ROOT/path).read_bytes(),'Live game changed'
 if path=='index.html':assert 'garden-sec' in r.text and 'data-prelaunch-version=' not in r.text,'Unexpected existing homepage'
save('before-release.json',{'read_at':time.time(),'old_deploy':OLD_DEPLOY,'main':BASE,'live_hashes':previous,'approved_application':APPROVED,'game_source_unchanged':unchanged})
# Read a run-matching encrypted capability. Never print or serialize plaintext.
key=serialization.load_pem_private_key(KEY.read_bytes(),password=None);packet=None
endpoint='https://api.github.com/repos/TheCryptoArborist/arboretum/contents/docs/prelaunch-production-envelope.json?ref=feature/prelaunch-gate'
for attempt in range(60):
 r=api.get(endpoint,timeout=20)
 if r.status_code==200:
  env=json.loads(base64.b64decode(r.json()['content']))
  if env.get('run_id')==RUN:
   aes=key.decrypt(base64.b64decode(env['wrapped_key']),padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),algorithm=hashes.SHA256(),label=None))
   packet=json.loads(AESGCM(aes).decrypt(base64.b64decode(env['nonce']),base64.b64decode(env['ciphertext']),RUN.encode()));break
 time.sleep(8)
KEY.unlink(missing_ok=True)
if packet is None:raise SystemExit('No matching capability arrived; no production deployment attempted.')
assert packet.get('production_approved') is True and packet.get('site_id')==SITE
proxy=packet['proxy_url'].rstrip('/');u=urllib.parse.urlparse(proxy)
assert u.scheme=='https' and u.netloc in ['netlify-mcp.netlify.app','mcp.netlify.com','netlify-mcp.netlify.com'] and u.path.startswith('/proxy/')
# Prepare both source uploads before changing production. Never package secrets.
def archive(ref):
 b=io.BytesIO()
 names=git('ls-tree','-r','--name-only',ref).decode().splitlines()
 with zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z:
  for name in names:
   if name.startswith(('.git','.env','docs/','contract/','production-release-results/','prelaunch-results/')):continue
   z.writestr(name,git('show',ref+':'+name))
 return b.getvalue()
candidate=archive(os.environ['GITHUB_SHA']);rollback=archive(BASE)
save('upload-provenance.json',{'source_commit':os.environ['GITHUB_SHA'],'candidate_zip_sha256':sha(candidate),'rollback_source':BASE,'rollback_zip_sha256':sha(rollback),'signing_keys_uploaded':False})
def deploy_source(content,title):
 # Omitting branch creates a production-context build through the authorized API.
 endpoint=proxy+'/api/v1/sites/'+SITE+'/builds?'+urllib.parse.urlencode({'title':title})
 r=requests.post(endpoint,files={'zip':('site-source.zip',content,'application/zip')},timeout=120)
 if not r.ok:raise RuntimeError('Build request HTTP '+str(r.status_code))
 data=r.json();data=data[0] if isinstance(data,list) else data
 did=data.get('deploy_id');assert did
 print('Build started:',did)
 for attempt in range(100):
  r=requests.get(proxy+'/api/v1/deploys/'+did,timeout=25)
  if r.ok:
   d=r.json()
   if d.get('state')=='error':raise RuntimeError('Netlify build failed')
   if d.get('state')=='ready':
    assert d.get('context')=='production','Unexpected deployment context'
    return d
  time.sleep(5)
 raise RuntimeError('Build polling deadline exceeded')
report={'source_commit':os.environ['GITHUB_SHA'],'approved_application':APPROVED,'previous_deploy':OLD_DEPLOY,'site_id':SITE,'production_url':PUBLIC,'production_verified':False,'wallet_transactions':0}
checks=[]
def check(name,ok):
 checks.append({'check':name,'passed':bool(ok)});save('production-http.json',checks)
 if not ok:raise RuntimeError(name)
try:
 d=deploy_source(candidate,'Owner-approved Arboretum prelaunch homepage — gameplay remains private testing')
 report.update({'deploy_id':d['id'],'state':d['state'],'context':d['context'],'published_at':d.get('published_at')});save('production-deploy.json',report)
 check('Production publication timestamp present',bool(d.get('published_at')))
 s=requests.Session();r=s.get(PUBLIC+'/',timeout=30)
 check('Public approved homepage',r.status_code==200 and 'data-prelaunch-version="2"' in r.text and '<script' not in r.text)
 check('Referral descriptions and rates present',all(x in r.text for x in ['DIRECT PLANTS','CRATE BUYS','10%','1%']))
 check('Production indexable, not preview noindex','content="index,follow"' in r.text and 'noindex' not in r.headers.get('X-Robots-Tag',''))
 r=s.get(PUBLIC+'/robots.txt',timeout=30);check('Marketing homepage allowed, other routes excluded',r.status_code==200 and 'Allow: /$' in r.text and 'Disallow: /' in r.text)
 r=s.get(PUBLIC+'/sitemap.xml',timeout=30);check('Production sitemap',r.status_code==200 and '<loc>https://treegrow.xyz/</loc>' in r.text)
 r=s.get(PUBLIC+'/prelaunch/garden-preview.avif',timeout=30);check('Approved garden graphic preserved',r.status_code==200 and r.content==(ROOT/'prelaunch/garden-preview.avif').read_bytes())
 for path in ['/game.html','/game','/wallet.js','/garden.js','/player-guide','/player-guide.html','/sui-sdk.bundle.js','/sdk-entry.js','/.netlify/functions/calendar-reminder']:
  r=s.get(PUBLIC+path,headers={'Accept':'application/json'},allow_redirects=False,timeout=30);check('Anonymous blocked '+path,r.status_code in (401,403))
 r=s.get(PUBLIC+'/tester-access',timeout=30);check('Native login origin handling preserved',r.status_code==200 and r.headers.get('Referrer-Policy')=='same-origin')
 r=s.post(PUBLIC+'/tester-access',headers={'Origin':PUBLIC},data={'password':'incorrect-release-test'},allow_redirects=False,timeout=30);check('Wrong code creates no session',r.status_code==401 and 'set-cookie' not in r.headers)
 r=s.post(PUBLIC+'/tester-access',headers={'Origin':PUBLIC},data={'password':packet['tester_password']},allow_redirects=False,timeout=30);check('Existing tester code works on production',r.status_code==303 and 'HttpOnly' in r.headers.get('set-cookie','') and 'Secure' in r.headers.get('set-cookie',''))
 r=s.get(PUBLIC+'/game.html',timeout=30);check('Original game served after authentication',r.status_code==200 and sha(r.content)==previous['index.html'])
 for name in ['wallet.js','garden.js','sui-sdk.bundle.js']:
  r=s.get(PUBLIC+'/'+name,timeout=30);check('Unchanged production '+name,r.status_code==200 and sha(r.content)==previous[name])
 r=s.get(PUBLIC+'/player-guide.html',timeout=30);check('Unchanged protected guide',r.status_code==200 and sha(r.content)==previous['player-guide.html'])
 r=s.get(PUBLIC+'/.netlify/functions/calendar-reminder',params={'start':1790859600000,'wallet':'release-test'},timeout=30);check('Authenticated calendar download',r.status_code==200 and 'BEGIN:VCALENDAR' in r.text)
 r=s.post(PUBLIC+'/tester-logout',headers={'Origin':PUBLIC},allow_redirects=False,timeout=30);check('Logout',r.status_code==303)
 r=s.get(PUBLIC+'/wallet.js',headers={'Accept':'application/json'},allow_redirects=False,timeout=30);check('Blocked after logout',r.status_code in (401,403))
 # Exercise the existing hosted browser test unchanged except its exact host allowlist.
 test=(ROOT/'scripts/check-prelaunch-redesign-browser.py').read_text()
 guard="assert urlparse(base).scheme=='https' and urlparse(base).hostname.endswith('--arboretum-sui-forest.netlify.app')"
 assert test.count(guard)==1
 test=test.replace(guard,"assert base == 'https://treegrow.xyz'")
 tmp=pathlib.Path(os.environ['RUNNER_TEMP'])/'production-browser-check.py';tmp.write_text(test)
 result=subprocess.run([sys.executable,str(tmp)],cwd=ROOT,env=dict(os.environ,REDESIGN_PREVIEW_URL=PUBLIC,REDESIGN_TESTER_PASSWORD=packet['tester_password']),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=300)
 if result.returncode!=0:raise RuntimeError('Production native-browser acceptance failed')
 browser=json.loads((ROOT/'prelaunch-results/redesign-browser.json').read_text())
 check('Hosted desktop and mobile native-browser checks',all(x['passed'] for x in browser))
 # Verify default hosting alias also receives the newly deployed gate.
 for alias in ['https://arboretum-sui-forest.netlify.app','https://www.treegrow.xyz']:
  r=requests.get(alias+'/',timeout=30);check('Marketing landing on alias '+urllib.parse.urlparse(alias).hostname,r.status_code==200 and 'data-prelaunch-version="2"' in r.text)
  r=requests.get(alias+'/wallet.js',headers={'Accept':'application/json'},timeout=30);check('Game script gated on alias '+urllib.parse.urlparse(alias).hostname,r.status_code in (401,403))
 report.update({'production_verified':True,'http_checks':len(checks),'browser_assertions':len(browser),'game_source_unchanged':unchanged,'note':'No wallet signing. Authenticated game JavaScript disabled in browser checks. Old deployment permalinks are not retroactively protected.'});save('production-deploy.json',report)
 print(json.dumps(report,indent=2))
except Exception as exc:
 report.update({'production_verified':False,'failure_type':type(exc).__name__,'rollback_attempted':True});save('production-deploy.json',report)
 try:
  rd=deploy_source(rollback,'Automatic rollback to prior approved game following failed prelaunch verification')
  rr=requests.get(PUBLIC+'/wallet.js',timeout=30)
  ri=requests.get(PUBLIC+'/',timeout=30)
  report.update({'rollback_deploy':rd['id'],'rollback_verified':rr.status_code==200 and sha(rr.content)==previous['wallet.js'] and sha(ri.content)==previous['index.html']})
 except Exception as rollback_error:report.update({'rollback_verified':False,'rollback_error_type':type(rollback_error).__name__})
 save('production-deploy.json',report)
 raise SystemExit('Release verification failed. Review the non-secret production-deploy report and rollback result.')
