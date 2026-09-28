#!/usr/bin/env python3
"""Release the two requested homepage changes after preview checks.
No chain calls or wallet signing. One-use capability is encrypted to this runner.
"""
import base64,hashlib,io,json,os,pathlib,subprocess,sys,time,urllib.parse,zipfile
import requests
from cryptography.hazmat.primitives.asymmetric import rsa,padding
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=ROOT/'partner-results';OUT.mkdir(exist_ok=True)
BASE='e84ccdc87d5f62242fa9101b469afec90c79832a';OLD='6ab9e01839e44cd50bf1273a'
SITE='a344fb31-10b4-4eea-9562-067d90a39607';RUN=os.environ['GITHUB_RUN_ID']
KEY=pathlib.Path(os.environ['RUNNER_TEMP'])/'partner-handoff.pem'
sys.excepthook=lambda kind,value,tb:print('Partner preview release stopped: '+kind.__name__+'. Inspect the non-secret results.',file=sys.stderr)
def save(name,obj):(OUT/name).write_text(json.dumps(obj,indent=2)+'\n')
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT)
def sha(data):return hashlib.sha256(data).hexdigest()
if os.environ.get('PARTNER_MODE')=='key':
 key=rsa.generate_private_key(public_exponent=65537,key_size=3072)
 KEY.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()));KEY.chmod(0o600)
 save('public-key.json',{'run_id':RUN,'site_id':SITE,'public_key':key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo).decode()})
 print('One-use public key ready.');raise SystemExit(0)
api=requests.Session();api.headers.update({'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json'})
def check_main():
 r=api.get('https://api.github.com/repos/TheCryptoArborist/arboretum/git/ref/heads/main',timeout=30)
 assert r.ok and r.json()['object']['sha']==BASE,'Main changed; reconcile'
check_main()
unchanged=['index.html','wallet.js','garden.js','sui-sdk.bundle.js','sdk-entry.js','contract/sources/arboretum.move','scripts/build-player-guide.py','scripts/build-guide-site.mjs','scripts/polish-player-guide.mjs','scripts/build-public-guide.py','content/public-player-guide.html','content/public-player-guide.css','content/public-player-guide.js','netlify/edge-functions/public-player-guide.ts','netlify/functions/calendar-reminder.js','prelaunch/site.css','netlify.toml']
for f in unchanged:assert git('show',BASE+':'+f)==(ROOT/f).read_bytes(),'Unrelated source changed'
added=',\n    "/prelaunch/boom-chest.png", "/prelaunch/victory-chest.png"'
assert (ROOT/'netlify/edge-functions/tester-gate.ts').read_text().replace(added,'')==git('show',BASE+':netlify/edge-functions/tester-gate.ts').decode(),'Authentication changed'
key=serialization.load_pem_private_key(KEY.read_bytes(),password=None);packet=None
for _ in range(100):
 r=api.get('https://api.github.com/repos/TheCryptoArborist/arboretum/contents/docs/partner-release-envelope.json?ref=feature/partner-chest-preview',timeout=20)
 if r.ok:
  env=json.loads(base64.b64decode(r.json()['content']))
  if env.get('run_id')==RUN:
   aes=key.decrypt(base64.b64decode(env['wrapped_key']),padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),algorithm=hashes.SHA256(),label=None))
   packet=json.loads(AESGCM(aes).decrypt(base64.b64decode(env['nonce']),base64.b64decode(env['ciphertext']),RUN.encode()));break
 time.sleep(6)
KEY.unlink(missing_ok=True)
if packet is None:raise SystemExit('No run-bound capability received; nothing deployed.')
proxy=packet['proxy_url'].rstrip('/');u=urllib.parse.urlparse(proxy)
assert u.scheme=='https' and u.hostname in ['netlify-mcp.netlify.app','mcp.netlify.com','netlify-mcp.netlify.com'] and u.path.startswith('/proxy/')
prior=requests.Session();r=prior.get('https://treegrow.xyz/',timeout=30)
assert r.status_code==200 and 'Enter the Garden' in r.text and 'Player Guide: open to everyone.' in r.text
home_before=r.content
r=prior.post('https://treegrow.xyz/tester-access',headers={'Origin':'https://treegrow.xyz'},data={'password':packet['tester_password']},allow_redirects=False,timeout=30)
assert r.status_code==303 and 'HttpOnly' in r.headers.get('set-cookie',''),'Prior login failed'
previous={}
for n in ['game.html','wallet.js','garden.js','sui-sdk.bundle.js','tester-guide.html','player-guide.html','guide/player-guide.css','guide/player-guide.js']:
 r=prior.get('https://treegrow.xyz/'+n,timeout=30);assert r.status_code==200 and len(r.content)>500
 if n=='game.html':assert 'id="garden-sec"' in r.text
 if n=='player-guide.html':assert 'data-guide-audience="players"' in r.text
 previous[n]=r.content
save('baseline.json',{'deploy_checked_via_connector':OLD,'homepage_sha256':sha(home_before),'preserved_files':{k:sha(v) for k,v in previous.items()}})
prior.post('https://treegrow.xyz/tester-logout',headers={'Origin':'https://treegrow.xyz'},data={},timeout=30)
def unchanged_live():
 r=requests.get('https://treegrow.xyz/',params={'partner-check':RUN},headers={'Cache-Control':'no-cache'},timeout=30)
 assert r.status_code==200 and r.content==home_before,'Live homepage changed'
def archive(ref=None):
 buf=io.BytesIO();names=git('ls-tree','-r','--name-only',ref or 'HEAD').decode().splitlines()
 with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as z:
  for n in names:
   if n.startswith(('.git','.env','docs/','contract/','partner-results/','handbook-results/','guide-results/','prelaunch-results/','showcase-results/')):continue
   z.writestr(n,git('show',ref+':'+n) if ref else (ROOT/n).read_bytes())
 return buf.getvalue()
candidate=archive();rollback=archive(BASE)
report={'base_commit':BASE,'source_commit':os.environ['GITHUB_SHA'],'old_production':OLD,'unchanged_sources':unchanged,'production_verified':False,'wallet_transactions':0};save('release.json',report)
def deploy(source,title,branch=None):
 qs={'title':title}
 if branch:qs['branch']=branch
 r=requests.post(proxy+'/api/v1/sites/'+SITE+'/builds?'+urllib.parse.urlencode(qs),files={'zip':('source.zip',source,'application/zip')},timeout=120)
 if not r.ok:raise RuntimeError('Build rejected: '+str(r.status_code))
 j=r.json();j=j[0] if isinstance(j,list) else j;ident=j['deploy_id']
 for _ in range(120):
  r=requests.get(proxy+'/api/v1/deploys/'+ident,timeout=30)
  if not r.ok:raise RuntimeError('Deploy status failed: '+str(r.status_code))
  d=r.json()
  if d['state']=='ready':return d
  if d['state']=='error':raise RuntimeError('Netlify build failed')
  time.sleep(5)
 raise RuntimeError('Build not completed')
def verify(base,stage,prod=False):
 checks=[]
 def ck(n,ok):
  checks.append({'check':n,'passed':bool(ok)});save(stage+'-http.json',checks)
  if not ok:raise RuntimeError(n)
 s=requests.Session();r=s.get(base+'/',timeout=30)
 ck('Homepage has visible partner cards',r.status_code==200 and r.text.count('class="partner-preview-card ')==2)
 ck('Enter the Garden removed; Tester access kept','Enter the Garden' not in r.text and 'class="tester-link" href="/tester-access"' in r.text)
 ck('Public page remains wallet free','<script' not in r.text and '0.01 SUI' not in r.text)
 ck('Indexing context',('content="index,follow"' if prod else 'content="noindex,nofollow"') in r.text)
 for n in ['boom','victory']:
  r=s.get(base+'/prelaunch/'+n+'-chest.png',timeout=30)
  ck('Original public '+n+' artwork',r.status_code==200 and r.content==(ROOT/'assets/shop/crates'/(n+'-chest.png')).read_bytes())
 for n in ['player-guide.html','guide/player-guide.css','guide/player-guide.js']:
  r=s.get(base+'/'+n,timeout=30)
  # Preview indexing differs only in guide HTML; all content and other assets remain identical.
  observed=r.content
  if not prod and n=='player-guide.html':observed=observed.replace(b'content="noindex,nofollow"',b'content="index,follow"')
  ck('Unchanged public '+n,r.status_code==200 and observed==previous[n] and not s.cookies)
 for path in ['/game.html','/game','/tester-guide','/tester-guide.html','/wallet.js','/garden.js','/sui-sdk.bundle.js','/guide/guide.css','/prelaunch/boom-private.png','/prelaunch/victory-private.png','/.netlify/functions/calendar-reminder']:
  r=s.get(base+path,headers={'Accept':'application/json'},allow_redirects=False,timeout=30);ck('Private '+path,r.status_code in (401,403))
 r=s.post(base+'/tester-access',headers={'Origin':base},data={'password':packet['tester_password']},allow_redirects=False,timeout=30);ck('Tester login unchanged',r.status_code==303)
 for n in ['game.html','wallet.js','garden.js','sui-sdk.bundle.js','tester-guide.html']:
  r=s.get(base+'/'+n,timeout=30);ck('Unchanged private '+n,r.status_code==200 and r.content==previous[n])
 r=s.post(base+'/tester-logout',headers={'Origin':base},data={},allow_redirects=False,timeout=30);ck('Logout',r.status_code==303)
 r=s.get(base+'/game.html',headers={'Accept':'application/json'},allow_redirects=False,timeout=30);ck('Private game blocked after logout',r.status_code in (401,403))
 for script,extra,label in [('scripts/check-partner-preview.py',{'PARTNER_URL':base,'PARTNER_STAGE':stage},'Homepage browser checks'),('scripts/check-public-player-guide-browser.py',{'HANDBOOK_URL':base,'HANDBOOK_STAGE':stage,'HANDBOOK_TESTER_PASSWORD':packet['tester_password']},'Retained handbook and native login checks')]:
  result=subprocess.run([sys.executable,script],cwd=ROOT,env=dict(os.environ,**extra),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=300)
  ck(label,result.returncode==0)
 return len(checks)
unchanged_live();p=deploy(candidate,'BOOM and Victory chest preview — review','partner-chests-20260928');assert p['context']=='branch-deploy' and not p.get('published_at')
report.update(preview_deploy=p['id'],preview_url=p['deploy_ssl_url']);save('release.json',report)
report['preview_http_checks']=verify(p['deploy_ssl_url'],'preview');save('release.json',report)
check_main();unchanged_live()
try:
 d=deploy(candidate,'Feature BOOM and Victory chests; remove public Enter the Garden CTA');assert d['context']=='production' and d.get('published_at')
 report.update(production_deploy=d['id'],published_at=d['published_at']);save('release.json',report)
 report['production_http_checks']=verify('https://treegrow.xyz','production',True);report['production_verified']=True;save('release.json',report);print(json.dumps(report,indent=2))
except Exception as exc:
 report.update(failure=type(exc).__name__,rollback_attempted=True)
 try:
  back=deploy(rollback,'Restore prior public homepage after partner preview verification failure');r=requests.get('https://treegrow.xyz/',timeout=30)
  report.update(rollback_deploy=back['id'],rollback_verified=r.status_code==200 and r.content==home_before)
 except Exception as re:report.update(rollback_verified=False,rollback_failure=type(re).__name__)
 save('release.json',report);raise SystemExit('Production verification failed; inspect release.json.')
