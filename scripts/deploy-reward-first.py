#!/usr/bin/env python3
"""Deploy a non-production review branch only. No promotion or chain operations.
A short-lived capability is encrypted to this run. Never log credentials.
"""
from pathlib import Path
import base64,hashlib,io,json,os,subprocess,sys,time,urllib.parse,zipfile
import requests
from cryptography.hazmat.primitives.asymmetric import rsa,padding
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'reward-results';OUT.mkdir(exist_ok=True)
RUN=os.environ['GITHUB_RUN_ID'];BASE='781caf03d17bda0d4c618cdf486e1c77756d8e6a';SITE='a344fb31-10b4-4eea-9562-067d90a39607';BRANCH='reward-first-preview-20260929'
KEY=Path(os.environ['RUNNER_TEMP'])/'reward-preview-key.pem'
sys.excepthook=lambda kind,value,tb:print('Preview stopped: '+kind.__name__+'. Consult non-secret results.',file=sys.stderr)
def save(name,obj):(OUT/name).write_text(json.dumps(obj,indent=2)+'\n')
def sha(data):return hashlib.sha256(data).hexdigest()
if os.environ.get('REWARD_MODE')=='key':
 key=rsa.generate_private_key(public_exponent=65537,key_size=3072);KEY.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()));KEY.chmod(0o600)
 save('public-key.json',{'run_id':RUN,'site_id':SITE,'public_key':key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo).decode()});raise SystemExit(0)
api=requests.Session();api.headers.update({'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json'})
def main_sha():
 r=api.get('https://api.github.com/repos/TheCryptoArborist/arboretum/git/ref/heads/main',timeout=30);assert r.ok;return r.json()['object']['sha']
assert main_sha()==BASE,'Production source changed; reconcile first'
key=serialization.load_pem_private_key(KEY.read_bytes(),password=None);packet=None
for _ in range(100):
 r=api.get('https://api.github.com/repos/TheCryptoArborist/arboretum/contents/docs/reward-preview-envelope.json?ref=feature/reward-first-preview',timeout=20)
 if r.ok:
  envelope=json.loads(base64.b64decode(r.json()['content']))
  if envelope.get('run_id')==RUN:
   aes=key.decrypt(base64.b64decode(envelope['wrapped_key']),padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),algorithm=hashes.SHA256(),label=None));packet=json.loads(AESGCM(aes).decrypt(base64.b64decode(envelope['nonce']),base64.b64decode(envelope['ciphertext']),RUN.encode()));break
 time.sleep(6)
KEY.unlink(missing_ok=True)
if packet is None:raise SystemExit('No run-bound capability received. No deploy attempted.')
proxy=packet['proxy_url'].rstrip('/');u=urllib.parse.urlparse(proxy)
assert u.scheme=='https' and u.hostname in ['netlify-mcp.netlify.app','mcp.netlify.com','netlify-mcp.netlify.com'] and u.path.startswith('/proxy/')
assert BRANCH!='main'
production={}
for path in ['/','/player-guide']:
 r=requests.get('https://treegrow.xyz'+path,timeout=30);assert r.status_code==200;production[path]=r.content
prior=requests.Session();r=prior.post('https://treegrow.xyz/tester-access',headers={'Origin':'https://treegrow.xyz'},data={'password':packet['tester_password']},allow_redirects=False,timeout=30);assert r.status_code==303
protected={}
for name in ['game.html','wallet.js','garden.js','sui-sdk.bundle.js','tester-guide.html']:
 r=prior.get('https://treegrow.xyz/'+name,timeout=30);assert r.status_code==200 and len(r.content)>1000
 if name=='game.html':assert 'id="garden-sec"' in r.text
 protected[name]=r.content
prior.post('https://treegrow.xyz/tester-logout',headers={'Origin':'https://treegrow.xyz'},data={},allow_redirects=False,timeout=30)
save('production-baseline.json',{'public':{n:sha(d) for n,d in production.items()},'protected':{n:sha(d) for n,d in protected.items()},'main_sha':BASE})
names=subprocess.check_output(['git','ls-files'],cwd=ROOT,text=True).splitlines();buf=io.BytesIO()
with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as z:
 for n in names:
  if n.startswith(('.git','.env','docs/','contract/','reward-results/')):continue
  z.write(ROOT/n,n)
qs=urllib.parse.urlencode({'branch':BRANCH,'title':'Reward-first homepage and handbook — review only, not production'})
r=requests.post(proxy+'/api/v1/sites/'+SITE+'/builds?'+qs,files={'zip':('source.zip',buf.getvalue(),'application/zip')},timeout=120)
if not r.ok:raise RuntimeError('Preview build request returned HTTP '+str(r.status_code))
j=r.json();j=j[0] if isinstance(j,list) else j;ident=j['deploy_id'];save('deploy.json',{'deploy_id':ident,'requested_branch':BRANCH,'production_changed':False,'verified':False})
for _ in range(120):
 r=requests.get(proxy+'/api/v1/deploys/'+ident,timeout=30)
 if not r.ok:raise RuntimeError('Preview status returned HTTP '+str(r.status_code))
 d=r.json()
 if d['state']=='error':raise RuntimeError('Netlify preview build failed')
 if d['state']=='ready':break
 time.sleep(5)
else:raise RuntimeError('Preview build unfinished')
assert d['context']=='branch-deploy' and not d.get('published_at'),'Unexpected production context'
url=d['deploy_ssl_url'];checks=[]
def ck(name,ok):
 checks.append({'check':name,'passed':bool(ok)});save('http.json',checks)
 if not ok:raise RuntimeError(name)
s=requests.Session()
for path,marker in [('/', 'data-prelaunch-version="3"'),('/player-guide','data-reward-first="true"')]:
 r=s.get(url+path,timeout=30);ck('Anonymous '+path,r.status_code==200 and marker in r.text);ck('No session for '+path,not s.cookies);ck('Noindex '+path,'noindex,nofollow' in r.text)
for name in ['mark.png','hero.png','boom-chest.png','victory-chest.png','supply-drop.jpg','garden-preview.avif','seedling-crate.jpg','grove-crate.jpg','canopy-crate.jpg','ancient.jpg','mythic-crate.jpg']:
 r=s.get(url+'/prelaunch/'+name,timeout=30);ck('Original asset '+name,r.status_code==200 and r.content==(ROOT/'dist/prelaunch'/name).read_bytes())
for path in ['/game','/wallet.js','/garden.js','/tester-guide','/guide/guide.css','/.netlify/functions/calendar-reminder','/reward-preview/home.html','/prelaunch/unlisted.jpg']:
 r=s.get(url+path,headers={'Accept':'application/json'},allow_redirects=False,timeout=30);ck('Blocked '+path,r.status_code in (401,403))
r=s.post(url+'/tester-access',headers={'Origin':url},data={'password':packet['tester_password']},allow_redirects=False,timeout=30);ck('Existing tester code works',r.status_code==303)
for name,before in protected.items():
 r=s.get(url+'/'+name,timeout=30);ck('Original protected bytes '+name,r.status_code==200 and r.content==before)
r=s.post(url+'/tester-logout',headers={'Origin':url},data={},allow_redirects=False,timeout=30);ck('Logout works',r.status_code==303)
r=s.get(url+'/wallet.js',headers={'Accept':'application/json'},allow_redirects=False,timeout=30);ck('Logout revokes website access',r.status_code in (401,403))
for script,extras,name in [('scripts/check-reward-first.py',{'REWARD_PREVIEW_URL':url},'Reward-first browser checks'),('scripts/check-public-player-guide-browser.py',{'HANDBOOK_URL':url,'HANDBOOK_STAGE':'reward-first-preview','HANDBOOK_TESTER_PASSWORD':packet['tester_password']},'Retained guide and native login checks')]:
 result=subprocess.run([sys.executable,script],cwd=ROOT,env=dict(os.environ,**extras),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=300)
 ck(name,result.returncode==0)
for path,before in production.items():
 r=requests.get('https://treegrow.xyz'+path,headers={'Cache-Control':'no-cache'},timeout=30);ck('Production unchanged '+path,r.status_code==200 and r.content==before)
ck('Main remains unchanged',main_sha()==BASE)
report={'deploy_id':ident,'preview_url':url,'branch':BRANCH,'context':d['context'],'published_at':d.get('published_at'),'source_sha':os.environ['GITHUB_SHA'],'http_checks':len(checks),'verified':True,'production_changed':False,'wallet_transactions':0}
save('deploy.json',report);print(json.dumps(report,indent=2))
