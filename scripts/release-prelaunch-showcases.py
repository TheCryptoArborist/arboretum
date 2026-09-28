#!/usr/bin/env python3
"""Publish only the two requested public previews after isolated hosted checks.
No blockchain calls, no wallet signing, no credential logs. Encrypted capability
handoff is single-use and run-bound; the private key stays in runner temp.
"""
import base64,hashlib,io,json,os,pathlib,subprocess,sys,time,urllib.parse,zipfile
import requests
from cryptography.hazmat.primitives.asymmetric import rsa,padding
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=ROOT/'showcase-results';OUT.mkdir(exist_ok=True)
BASE='f688cd8c7e07fba1b46b8d34cc9d5998eb1306b3';OLD='6ab9bfabfb745b0ff61e07f6'
SITE='a344fb31-10b4-4eea-9562-067d90a39607';RUN=os.environ['GITHUB_RUN_ID'];KEY=pathlib.Path(os.environ['RUNNER_TEMP'])/'showcase-handoff.pem'
sys.excepthook=lambda kind,value,tb:print('Showcase release stopped: '+kind.__name__+'. Inspect non-secret report.',file=sys.stderr)
def save(name,x):(OUT/name).write_text(json.dumps(x,indent=2)+'\n')
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT)
def sha(b):return hashlib.sha256(b).hexdigest()
if os.environ.get('SHOWCASE_MODE')=='key':
 key=rsa.generate_private_key(public_exponent=65537,key_size=3072);KEY.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()));KEY.chmod(0o600)
 save('public-key.json',{'run_id':RUN,'site_id':SITE,'public_key':key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo).decode()});print('One-use public key ready.');raise SystemExit(0)
unchanged=['index.html','wallet.js','garden.js','sui-sdk.bundle.js','sdk-entry.js','contract/sources/arboretum.move','netlify/functions/calendar-reminder.js','prelaunch/index.html','prelaunch/site.css']
for f in unchanged:assert git('show',BASE+':'+f)==(ROOT/f).read_bytes(),'Out-of-scope source changed'
old_gate=git('show',BASE+':netlify/edge-functions/tester-gate.ts').decode();new_gate=(ROOT/'netlify/edge-functions/tester-gate.ts').read_text()
addition=',\n    "/prelaunch/shop-pool.css", "/prelaunch/seedling-crate.jpg", "/prelaunch/grove-crate.jpg",\n    "/prelaunch/canopy-crate.jpg", "/prelaunch/mythic-crate.jpg"'
assert new_gate.replace(addition,'')==old_gate,'Authentication logic changed'
api=requests.Session();api.headers.update({'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json'})
def assert_main():
 r=api.get('https://api.github.com/repos/TheCryptoArborist/arboretum/git/ref/heads/main',timeout=20);r.raise_for_status();assert r.json()['object']['sha']==BASE,'Main changed; reconcile'
assert_main();key=serialization.load_pem_private_key(KEY.read_bytes(),password=None);packet=None
url='https://api.github.com/repos/TheCryptoArborist/arboretum/contents/docs/showcase-release-envelope.json?ref=feature/shop-pool-previews'
for _ in range(60):
 r=api.get(url,timeout=20)
 if r.ok:
  envelope=json.loads(base64.b64decode(r.json()['content']))
  if envelope.get('run_id')==RUN:
   aes=key.decrypt(base64.b64decode(envelope['wrapped_key']),padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),algorithm=hashes.SHA256(),label=None));packet=json.loads(AESGCM(aes).decrypt(base64.b64decode(envelope['nonce']),base64.b64decode(envelope['ciphertext']),RUN.encode()));break
 time.sleep(6)
KEY.unlink(missing_ok=True)
if packet is None:raise SystemExit('No capability received; no deployment attempted.')
proxy=packet['proxy_url'].rstrip('/');u=urllib.parse.urlparse(proxy);assert u.scheme=='https' and u.hostname in ['netlify-mcp.netlify.app','mcp.netlify.com','netlify-mcp.netlify.com'] and u.path.startswith('/proxy/')
def current_deploy():
 r=requests.get(proxy+'/api/v1/sites/'+SITE,timeout=30);r.raise_for_status();return r.json()['published_deploy']['id']
assert current_deploy()==OLD,'Production changed; reconcile'
def source_zip(ref=None):
 names=git('ls-tree','-r','--name-only',ref or 'HEAD').decode().splitlines();buff=io.BytesIO()
 with zipfile.ZipFile(buff,'w',zipfile.ZIP_DEFLATED) as z:
  for n in names:
   if n.startswith(('.git','.env','docs/','contract/','showcase-results/','prelaunch-results/')):continue
   z.writestr(n,git('show',ref+':'+n) if ref else (ROOT/n).read_bytes())
 return buff.getvalue()
candidate=source_zip();rollback=source_zip(BASE)
report={'base_commit':BASE,'source_commit':os.environ['GITHUB_SHA'],'old_production':OLD,'unchanged_source':unchanged,'wallet_transactions':0,'production_verified':False};save('release.json',report)
def deploy(data,title,branch=None):
 qs={'title':title}
 if branch:qs['branch']=branch
 r=requests.post(proxy+'/api/v1/sites/'+SITE+'/builds?'+urllib.parse.urlencode(qs),files={'zip':('source.zip',data,'application/zip')},timeout=120);r.raise_for_status();j=r.json();j=j[0] if isinstance(j,list) else j;ident=j['deploy_id']
 for _ in range(100):
  r=requests.get(proxy+'/api/v1/deploys/'+ident,timeout=30);r.raise_for_status();d=r.json()
  if d['state']=='error':raise RuntimeError('Hosting build failed')
  if d['state']=='ready':return d
  time.sleep(5)
 raise RuntimeError('Hosting build not completed')
def verify(base,stage,production=False):
 checks=[]
 def check(n,ok):
  checks.append({'check':n,'passed':bool(ok)});save(stage+'-http.json',checks)
  if not ok:raise RuntimeError(n)
 s=requests.Session();r=s.get(base+'/',timeout=30)
 check('Homepage includes both new previews',r.status_code==200 and 'id="item-shop"' in r.text and 'id="growth-pool"' in r.text)
 check('No public wallet scripts or testing prices','<script' not in r.text and '0.01 SUI' not in r.text)
 check('Correct indexing context',('content="index,follow"' if production else 'content="noindex,nofollow"') in r.text)
 for f in ['seedling-crate.jpg','grove-crate.jpg','canopy-crate.jpg','mythic-crate.jpg','ancient.jpg','shop-pool.css','garden-preview.avif']:
  r=s.get(base+'/prelaunch/'+f,timeout=30);check('Public asset '+f,r.status_code==200 and r.content==(ROOT/'dist/prelaunch'/f).read_bytes())
 for f in ['/game.html','/wallet.js','/garden.js','/player-guide','/sui-sdk.bundle.js','/.netlify/functions/calendar-reminder','/prelaunch/shop-pool.html']:
  r=s.get(base+f,headers={'Accept':'application/json'},allow_redirects=False,timeout=30);check('Anonymous blocked '+f,r.status_code in (401,403))
 r=s.post(base+'/tester-access',headers={'Origin':base},data={'password':packet['tester_password']},allow_redirects=False,timeout=30);check('Tester login',r.status_code==303)
 for f in ['game.html','wallet.js','garden.js','sui-sdk.bundle.js','player-guide.html']:
  r=s.get(base+'/'+f,timeout=30);check('Preserved '+f,r.status_code==200 and r.content==(ROOT/'dist'/f).read_bytes())
 r=s.post(base+'/tester-logout',headers={'Origin':base},data={},allow_redirects=False,timeout=30);check('Logout',r.status_code==303)
 r=s.get(base+'/wallet.js',headers={'Accept':'application/json'},allow_redirects=False,timeout=30);check('Access revoked',r.status_code in (401,403))
 env=dict(os.environ,SHOWCASE_URL=base,SHOWCASE_STAGE=stage,SHOWCASE_TESTER_PASSWORD=packet['tester_password'])
 result=subprocess.run([sys.executable,'scripts/check-showcase-browser.py'],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=300)
 check('Hosted native-browser checks',result.returncode==0)
 return len(checks)
p=deploy(candidate,'Arboretum Item Shop and Growth Pool previews — review','shop-pool-preview-20260928');assert p['context']=='branch-deploy' and not p.get('published_at')
report.update({'preview_deploy':p['id'],'preview_url':p['deploy_ssl_url']});save('release.json',report)
report['preview_checks']=verify(p['deploy_ssl_url'],'preview');save('release.json',report)
assert_main();assert current_deploy()==OLD,'Production changed during preview'
production_attempted=False
try:
 production_attempted=True;d=deploy(candidate,'Add requested Item Shop and SUI Growth Pool previews — no gameplay changes');assert d['context']=='production' and d.get('published_at')
 report.update({'production_deploy':d['id'],'published_at':d['published_at']});save('release.json',report)
 report['production_checks']=verify('https://treegrow.xyz','production',True);report['production_verified']=True;save('release.json',report);print(json.dumps(report,indent=2))
except Exception as exc:
 report.update({'failure':type(exc).__name__,'rollback_attempted':production_attempted});save('release.json',report)
 if production_attempted:
  try:
   back=deploy(rollback,'Restore prior gated Arboretum homepage after showcase verification failure');rr=requests.get('https://treegrow.xyz/',timeout=30);rg=requests.get('https://treegrow.xyz/wallet.js',headers={'Accept':'application/json'},timeout=30)
   report.update({'rollback_deploy':back['id'],'rollback_verified':rr.status_code==200 and 'id="item-shop"' not in rr.text and rg.status_code in (401,403)})
  except Exception as re:report.update({'rollback_verified':False,'rollback_failure':type(re).__name__})
 save('release.json',report);raise SystemExit('Release did not pass all checks. Inspect release.json.')
