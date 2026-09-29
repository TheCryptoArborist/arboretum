#!/usr/bin/env python3
"""Publish the owner-approved website; never alter game state or sign transactions.
A run-bound encrypted capability stays in runner memory, not Git or artifacts.
"""
from pathlib import Path
import base64, hashlib, io, json, os, shutil, subprocess, sys, time, traceback, urllib.parse, zipfile, difflib
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'release-results'; OUT.mkdir(exist_ok=True)
SITE='a344fb31-10b4-4eea-9562-067d90a39607'
BASE='781caf03d17bda0d4c618cdf486e1c77756d8e6a'
APPROVED='43d0b00b7f7dd72a4eb84723df3e33f78d9680fd'
APPROVED_URL='https://6abbdf055fd66d9f0cd32cd6--arboretum-sui-forest.netlify.app'
OLD_DEPLOY='6ab9e6f36eda285b562f5b2f'
LIVE='https://treegrow.xyz'
RUN=os.environ['GITHUB_RUN_ID']; ATTEMPT=os.environ.get('GITHUB_RUN_ATTEMPT','1')
KEY=Path(os.environ['RUNNER_TEMP'])/'reward-release-key.pem'
progress='initializing'
def save(name,obj): (OUT/name).write_text(json.dumps(obj,indent=2)+'\n')
def sha(data): return hashlib.sha256(data).hexdigest()
def stage(name):
 global progress
 progress=name; save('progress.json',{'operation':name})
def failed(kind,value,tb):
 save('failure.json',{'type':kind.__name__,'operation':progress,'frames':[{'file':Path(f.filename).name,'line':f.lineno} for f in traceback.extract_tb(tb)][-8:]})
 print('Website release stopped. See non-secret failure.json.',file=sys.stderr)
sys.excepthook=failed
def session():
 s=requests.Session(); retry=Retry(total=3,connect=2,read=2,status=2,backoff_factor=.5,allowed_methods=frozenset(['GET','HEAD']),status_forcelist=[429,500,502,503,504])
 s.mount('https://',HTTPAdapter(max_retries=retry)); return s
def git(*args): return subprocess.check_output(['git',*args],cwd=ROOT)
if os.environ.get('REWARD_RELEASE_MODE')=='key':
 key=rsa.generate_private_key(public_exponent=65537,key_size=3072)
 KEY.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption())); KEY.chmod(0o600)
 save('public-key.json',{'run_id':RUN,'attempt':ATTEMPT,'site_id':SITE,'public_key':key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo).decode()})
 raise SystemExit(0)
api=session(); api.headers.update({'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json'})
web=session()
def check_main():
 r=api.get('https://api.github.com/repos/TheCryptoArborist/arboretum/git/ref/heads/main',timeout=(10,30)); assert r.ok and r.json()['object']['sha']==BASE, 'Main changed; reconcile first'
stage('Validate source boundaries and owner-approved presentation')
check_main()
unchanged=['index.html','wallet.js','garden.js','sui-sdk.bundle.js','sdk-entry.js','contract/sources/arboretum.move','netlify/functions/calendar-reminder.js','netlify/edge-functions/public-player-guide.ts','content/public-player-guide.html','content/public-player-guide.js','scripts/build-player-guide.py','scripts/build-guide-site.mjs','scripts/build-prelaunch.mjs','scripts/polish-player-guide.mjs','scripts/build-public-guide.py']
for f in unchanged: assert (ROOT/f).read_bytes()==git('show',BASE+':'+f), 'Out-of-scope source drift'
for f in ['reward-preview/home.html','reward-preview/rewards.html','reward-preview/theme.css','reward-preview/responsive-fix.css','netlify/edge-functions/tester-gate.ts','netlify.toml']:
 assert (ROOT/f).read_bytes()==git('show',APPROVED+':'+f), 'Approved presentation or gate changed'
key=serialization.load_pem_private_key(KEY.read_bytes(),password=None); packet=None
stage('Wait for run-bound encrypted release capability')
for _ in range(100):
 r=api.get('https://api.github.com/repos/TheCryptoArborist/arboretum/contents/docs/reward-release-envelope.json?ref=feature/reward-first-preview',timeout=(10,20))
 if r.ok:
  envelope=json.loads(base64.b64decode(r.json()['content']))
  if envelope.get('run_id')==RUN and envelope.get('attempt')==ATTEMPT:
   aes=key.decrypt(base64.b64decode(envelope['wrapped_key']),padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),algorithm=hashes.SHA256(),label=None))
   packet=json.loads(AESGCM(aes).decrypt(base64.b64decode(envelope['nonce']),base64.b64decode(envelope['ciphertext']),(RUN+':'+ATTEMPT).encode())); break
 time.sleep(6)
KEY.unlink(missing_ok=True)
if packet is None: raise SystemExit('No matching capability received; nothing published.')
proxy=packet['proxy_url'].rstrip('/'); u=urllib.parse.urlparse(proxy)
assert u.scheme=='https' and u.hostname in ['netlify-mcp.netlify.app','mcp.netlify.com','netlify-mcp.netlify.com'] and u.path.startswith('/proxy/')
paths=['/','/player-guide','/prelaunch/site.css','/guide/player-guide.css','/guide/player-guide.js','/prelaunch/shop-pool.css']
paths+=['/prelaunch/'+n for n in ['mark.png','hero.png','forest.jpg','boom-chest.png','victory-chest.png','supply-drop.jpg','garden-preview.avif','seedling-crate.jpg','grove-crate.jpg','canopy-crate.jpg','ancient.jpg','mythic-crate.jpg']]
def built(path): return (ROOT/'dist'/({'/':'index.html','/player-guide':'player-guide.html'}.get(path,path.lstrip('/')))).read_bytes()
stage('Compare final build with exact approved hosted preview')
comparisons=[]
for path in paths:
 r=web.get(APPROVED_URL+path,timeout=(10,40)); assert r.status_code==200, 'Approved preview unavailable'
 expected=r.content.replace(b'content="noindex,nofollow"',b'content="index,follow"') if path in ['/','/player-guide'] else r.content
 assert built(path)==expected, 'Production build differs from approved preview'
 comparisons.append({'path':path,'matches_approved_preview':True,'production_sha256':sha(expected)})
save('approved-output-comparison.json',comparisons)
production_before={}
for path in ['/','/player-guide','/prelaunch/site.css','/guide/player-guide.css']:
 r=web.get(LIVE+path,timeout=(10,40)); assert r.status_code==200
 production_before[path]=r.content
prior=session(); reference=session()
for base,s in [(LIVE,prior),(APPROVED_URL,reference)]:
 stage('Read-only tester authorization for hosted baseline')
 r=s.post(base+'/tester-access',headers={'Origin':base},data={'password':packet['tester_password']},allow_redirects=False,timeout=(10,30)); assert r.status_code==303
protected={}; rendered_differences=[]
for name in ['game.html','wallet.js','garden.js','sui-sdk.bundle.js','tester-guide.html','guide/guide.css']:
 stage('Compare current and approved protected response '+name)
 r=prior.get(LIVE+'/'+name,timeout=(10,40)); a=reference.get(APPROVED_URL+'/'+name,timeout=(10,40))
 assert r.status_code==200 and a.status_code==200 and len(r.content)>1000
 if name=='game.html': assert b'id="garden-sec"' in r.content
 assert r.content==a.content, 'Current game differs from approved hosted baseline'
 protected[name]=r.content
 raw=(ROOT/'dist'/name).read_bytes()
 if raw!=r.content:
  # Netlify's hosted representation can differ from raw HTML. Preserve exact
  # prior hosted bytes after publication; source and transform guards still run.
  rendered_differences.append({'file':name,'raw_sha256':sha(raw),'hosted_sha256':sha(r.content),'approved_hosted_matches':True,'diff':list(difflib.unified_diff(raw.decode().splitlines(),r.text.splitlines(),fromfile='raw-build',tofile='prior-hosted',n=1))[:100]})
for base,s in [(LIVE,prior),(APPROVED_URL,reference)]: s.post(base+'/tester-logout',headers={'Origin':base},data={},allow_redirects=False,timeout=(10,30))
save('protected-rendering.json',rendered_differences)
save('before.json',{'production_deploy':OLD_DEPLOY,'main':BASE,'public_hashes':{k:sha(v) for k,v in production_before.items()},'protected_hashes':{k:sha(v) for k,v in protected.items()}})
def archive(ref):
 buffer=io.BytesIO()
 with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED) as z:
  for name in git('ls-tree','-r','--name-only',ref).decode().splitlines():
   if name.startswith(('.git','.env','docs/','contract/','release-results/','reward-results/','handbook-results/','guide-results/','prelaunch-results/','partner-results/')): continue
   z.writestr(name,git('show',ref+':'+name))
 return buffer.getvalue()
source=archive('HEAD'); previous_source=archive(BASE)
report={'main_before':BASE,'source_commit':os.environ['GITHUB_SHA'],'approved_preview_commit':APPROVED,'approved_preview_deploy':'6abbdf055fd66d9f0cd32cd6','previous_production':OLD_DEPLOY,'production_verified':False,'wallet_transactions':0,'unchanged_game_sources':unchanged}
save('release.json',report)
def deploy(payload,title):
 # No branch means production, per the current official createSiteBuild schema.
 # Never retry writes automatically; uncertain responses must be investigated.
 r=requests.post(proxy+'/api/v1/sites/'+SITE+'/builds?'+urllib.parse.urlencode({'title':title}),files={'zip':('source.zip',payload,'application/zip')},timeout=(15,120))
 if not r.ok: raise RuntimeError('Build request rejected: '+str(r.status_code))
 data=r.json(); data=data[0] if isinstance(data,list) else data; ident=data['deploy_id']
 report['attempted_deploy']=ident; save('release.json',report)
 for _ in range(120):
  r=web.get(proxy+'/api/v1/deploys/'+ident,timeout=(10,30)); assert r.ok
  d=r.json()
  if d['state']=='error': raise RuntimeError('Production build failed before publication')
  if d['state']=='ready':
   assert d['context']=='production' and d.get('published_at'), 'Not a published production deploy'
   return d
  time.sleep(5)
 raise RuntimeError('Build status incomplete; inspect deployment before retry')
checks=[]
def ck(name,ok):
 checks.append({'check':name,'passed':bool(ok)}); save('production-http.json',checks)
 if not ok: raise AssertionError(name)
def verify():
 s=session()
 for path in paths:
  r=s.get(LIVE+path,timeout=(10,40)); ck('Published approved bytes '+path,r.status_code==200 and r.content==built(path))
  if path in ['/','/player-guide']:
   ck('Anonymous and indexable '+path,not s.cookies and b'content="index,follow"' in r.content and 'noindex' not in r.headers.get('X-Robots-Tag','').lower())
 for path in ['/player-guide.html','/player-guide/']:
  r=s.get(LIVE+path,timeout=(10,30)); ck('Public guide alias '+path,r.status_code==200 and r.content==built('/player-guide'))
 r=s.get(LIVE+'/player-guide',timeout=(10,30)); ck('Guide CSP retained',"connect-src 'none'" in r.headers.get('Content-Security-Policy','') and "script-src 'self'" in r.headers.get('Content-Security-Policy',''))
 for path in ['/game','/game.html','/wallet.js','/garden.js','/sui-sdk.bundle.js','/tester-guide','/guide/guide.css','/.netlify/functions/calendar-reminder','/reward-preview/home.html','/prelaunch/unlisted.jpg']:
  r=s.get(LIVE+path,headers={'Accept':'application/json'},allow_redirects=False,timeout=(10,30)); ck('Anonymous blocked '+path,r.status_code in (401,403))
 r=s.get(LIVE+'/robots.txt',timeout=(10,30)); ck('Guide indexing allowed',r.status_code==200 and 'Allow: /player-guide$' in r.text)
 r=s.get(LIVE+'/sitemap.xml',timeout=(10,30)); ck('Public sitemap without private game',r.status_code==200 and 'https://treegrow.xyz/player-guide' in r.text and 'tester-guide' not in r.text and '/game' not in r.text)
 r=s.post(LIVE+'/tester-access',headers={'Origin':LIVE},data={'password':'incorrect-review-code'},allow_redirects=False,timeout=(10,30)); ck('Wrong code rejected',r.status_code==401 and 'set-cookie' not in r.headers)
 r=s.post(LIVE+'/tester-access',headers={'Origin':'https://example.invalid'},data={'password':'incorrect-review-code'},allow_redirects=False,timeout=(10,30)); ck('Foreign Origin rejected',r.status_code==403)
 r=s.post(LIVE+'/tester-access',headers={'Origin':LIVE},data={'password':packet['tester_password']},allow_redirects=False,timeout=(10,30)); ck('Same tester code works',r.status_code==303 and 'HttpOnly' in r.headers.get('set-cookie','') and 'Secure' in r.headers.get('set-cookie',''))
 for name,before in protected.items():
  r=s.get(LIVE+'/'+name,timeout=(10,40)); ck('Private file byte-identical '+name,r.status_code==200 and r.content==before)
 r=s.post(LIVE+'/tester-logout',headers={'Origin':LIVE},data={},allow_redirects=False,timeout=(10,30)); ck('Logout works',r.status_code==303)
 r=s.get(LIVE+'/wallet.js',headers={'Accept':'application/json'},allow_redirects=False,timeout=(10,30)); ck('Private access revoked',r.status_code in (401,403))
 r=s.get(LIVE+'/player-guide',timeout=(10,30)); ck('Guide remains public after logout',r.status_code==200 and b'data-reward-first="true"' in r.content)
 for host in ['https://www.treegrow.xyz','https://arboretum-sui-forest.netlify.app']:
  r=web.get(host+'/',timeout=(10,40)); ck('Approved homepage on '+urllib.parse.urlparse(host).hostname,r.status_code==200 and r.content==built('/'))
  r=web.get(host+'/wallet.js',headers={'Accept':'application/json'},allow_redirects=True,timeout=(10,30)); ck('Private scripts blocked on '+urllib.parse.urlparse(host).hostname,r.status_code in (401,403))
 for script,extra,label in [('scripts/check-reward-first.py',{'REWARD_PREVIEW_URL':LIVE},'Reward-first browser'),('scripts/check-public-player-guide-browser.py',{'HANDBOOK_URL':LIVE,'HANDBOOK_STAGE':'reward-production','HANDBOOK_TESTER_PASSWORD':packet['tester_password']},'Handbook and native login browser')]:
  stage(label)
  r=subprocess.run([sys.executable,script],cwd=ROOT,env=dict(os.environ,**extra),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=300)
  ck(label,r.returncode==0)
 browser=json.loads((ROOT/'reward-results/hosted/browser.json').read_text())
 handbook=json.loads((ROOT/'handbook-results/reward-production/browser.json').read_text())
 assert all(x['passed'] for x in browser+handbook)
 report.update(http_checks=len(checks),reward_browser_assertions=len(browser),handbook_browser_assertions=len(handbook))
 shutil.copytree(ROOT/'reward-results/hosted',OUT/'production',dirs_exist_ok=True)
 shutil.copyfile(ROOT/'handbook-results/reward-production/browser.json',OUT/'handbook-browser.json')
stage('Check no intervening main or production change')
check_main()
for path,before in production_before.items():
 r=web.get(LIVE+path,headers={'Cache-Control':'no-cache'},timeout=(10,40)); assert r.status_code==200 and r.content==before, 'Production changed during preparation'
stage('Publish approved website with production configuration')
d=deploy(source,'Owner-approved reward-first homepage and public Player Guide; game unchanged')
report.update(production_deploy=d['id'],published_at=d['published_at']); save('release.json',report)
try:
 stage('Verify main-domain content and access controls'); verify()
 report['production_verified']=True; save('release.json',report); stage('Production verified')
 print(json.dumps(report,indent=2))
except Exception as exc:
 # Only recover after a deploy actually published. Failed builds do not replace live.
 report.update(verification_failure=type(exc).__name__,previous_source_redeploy_attempted=True); save('release.json',report)
 try:
  stage('Redeploy known-good prior source after failed published-site verification')
  restored=deploy(previous_source,'Restore prior website source after reward-first verification failure')
  r=web.get(LIVE+'/',timeout=(10,40)); report.update(recovery_deploy=restored['id'],recovery_verified=r.status_code==200 and r.content==production_before['/'])
 except Exception as recovery: report.update(recovery_verified=False,recovery_error=type(recovery).__name__)
 save('release.json',report); raise
