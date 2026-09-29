#!/usr/bin/env python3
"""Deploy a non-production review branch only. No promotion or chain operations.
A short-lived capability is encrypted to this run. Never log credentials.
"""
from pathlib import Path
import base64,hashlib,io,json,os,subprocess,sys,time,urllib.parse,zipfile,traceback
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from cryptography.hazmat.primitives.asymmetric import rsa,padding
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'reward-results';OUT.mkdir(exist_ok=True)
RUN=os.environ['GITHUB_RUN_ID'];BASE='781caf03d17bda0d4c618cdf486e1c77756d8e6a';SITE='a344fb31-10b4-4eea-9562-067d90a39607';BRANCH='reward-first-preview-20260929'
KEY=Path(os.environ['RUNNER_TEMP'])/'reward-preview-key.pem'
def save(name,obj):(OUT/name).write_text(json.dumps(obj,indent=2)+'\n')
def sha(data):return hashlib.sha256(data).hexdigest()
progress={'operation':'start'}
def stage(operation):
 progress['operation']=operation;save('progress.json',progress)
def failure(kind,value,tb):
 frames=[{'file':Path(f.filename).name,'line':f.lineno,'function':f.name} for f in traceback.extract_tb(tb)]
 save('failure.json',{'exception_type':kind.__name__,'last_operation':progress['operation'],'frames':frames[-8:]})
 print('Preview stopped: '+kind.__name__+'. Consult failure.json.',file=sys.stderr)
sys.excepthook=failure
def read_session():
 s=requests.Session();retry=Retry(total=3,connect=2,read=2,status=2,backoff_factor=0.6,allowed_methods=frozenset(['GET','HEAD']),status_forcelist=[429,500,502,503,504])
 s.mount('https://',HTTPAdapter(max_retries=retry));return s
public=read_session()
if os.environ.get('REWARD_MODE')=='key':
 key=rsa.generate_private_key(public_exponent=65537,key_size=3072);KEY.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()));KEY.chmod(0o600)
 save('public-key.json',{'run_id':RUN,'site_id':SITE,'public_key':key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo).decode()});raise SystemExit(0)
api=read_session();api.headers.update({'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json'})
def main_sha():
 stage('Read production source ref')
 r=api.get('https://api.github.com/repos/TheCryptoArborist/arboretum/git/ref/heads/main',timeout=(10,30));assert r.ok;return r.json()['object']['sha']
assert main_sha()==BASE,'Production source changed; reconcile first'
key=serialization.load_pem_private_key(KEY.read_bytes(),password=None);packet=None
stage('Wait for matching encrypted handoff')
for _ in range(100):
 r=api.get('https://api.github.com/repos/TheCryptoArborist/arboretum/contents/docs/reward-preview-envelope.json?ref=feature/reward-first-preview',timeout=(10,20))
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
 stage('Read production public page '+path)
 r=public.get('https://treegrow.xyz'+path,timeout=(10,30));assert r.status_code==200;production[path]=r.content
prior=read_session();stage('Authenticate existing production tester entrance')
r=prior.post('https://treegrow.xyz/tester-access',headers={'Origin':'https://treegrow.xyz'},data={'password':packet['tester_password']},allow_redirects=False,timeout=(10,30));assert r.status_code==303
protected={}
for name in ['game.html','wallet.js','garden.js','sui-sdk.bundle.js','tester-guide.html']:
 stage('Read production protected baseline '+name)
 r=prior.get('https://treegrow.xyz/'+name,timeout=(10,30));assert r.status_code==200 and len(r.content)>1000
 if name=='game.html':assert 'id="garden-sec"' in r.text
 protected[name]=r.content
stage('End production tester browser session')
prior.post('https://treegrow.xyz/tester-logout',headers={'Origin':'https://treegrow.xyz'},data={},allow_redirects=False,timeout=(10,30))
save('production-baseline.json',{'public':{n:sha(d) for n,d in production.items()},'protected':{n:sha(d) for n,d in protected.items()},'main_sha':BASE})
names=subprocess.check_output(['git','ls-files'],cwd=ROOT,text=True).splitlines();buf=io.BytesIO()
with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as z:
 for n in names:
  if n.startswith(('.git','.env','docs/','contract/','reward-results/')):continue
  z.write(ROOT/n,n)
qs=urllib.parse.urlencode({'branch':BRANCH,'title':'Reward-first homepage and handbook — review only, not production'})
stage('Create explicit non-production preview build')
# Never auto-retry deployment POSTs, which could create duplicate builds.
r=requests.post(proxy+'/api/v1/sites/'+SITE+'/builds?'+qs,files={'zip':('source.zip',buf.getvalue(),'application/zip')},timeout=(15,120))
if not r.ok:raise RuntimeError('Preview build request returned HTTP '+str(r.status_code))
j=r.json();j=j[0] if isinstance(j,list) else j;ident=j['deploy_id'];save('deploy.json',{'deploy_id':ident,'requested_branch':BRANCH,'production_changed':False,'verified':False})
stage('Wait for branch preview build')
for _ in range(120):
 r=public.get(proxy+'/api/v1/deploys/'+ident,timeout=(10,30))
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
s=read_session();stage('Verify anonymous preview and exact original artwork')
for path,marker in [('/', 'data-prelaunch-version="3"'),('/player-guide','data-reward-first="true"')]:
 r=s.get(url+path,timeout=(10,30));ck('Anonymous '+path,r.status_code==200 and marker in r.text);ck('No session for '+path,not s.cookies);ck('Noindex '+path,'noindex,nofollow' in r.text)
for name in ['mark.png','hero.png','boom-chest.png','victory-chest.png','supply-drop.jpg','garden-preview.avif','seedling-crate.jpg','grove-crate.jpg','canopy-crate.jpg','ancient.jpg','mythic-crate.jpg']:
 r=s.get(url+'/prelaunch/'+name,timeout=(10,30));ck('Original asset '+name,r.status_code==200 and r.content==(ROOT/'dist/prelaunch'/name).read_bytes())
for path in ['/game','/wallet.js','/garden.js','/tester-guide','/guide/guide.css','/.netlify/functions/calendar-reminder','/reward-preview/home.html','/prelaunch/unlisted.jpg']:
 r=s.get(url+path,headers={'Accept':'application/json'},allow_redirects=False,timeout=(10,30));ck('Blocked '+path,r.status_code in (401,403))
stage('Verify preview tester session and unchanged private files')
r=s.post(url+'/tester-access',headers={'Origin':url},data={'password':packet['tester_password']},allow_redirects=False,timeout=(10,30));ck('Existing tester code works',r.status_code==303)
for name,before in protected.items():
 r=s.get(url+'/'+name,timeout=(10,30));ck('Original protected bytes '+name,r.status_code==200 and r.content==before)
r=s.post(url+'/tester-logout',headers={'Origin':url},data={},allow_redirects=False,timeout=(10,30));ck('Logout works',r.status_code==303)
r=s.get(url+'/wallet.js',headers={'Accept':'application/json'},allow_redirects=False,timeout=(10,30));ck('Logout revokes website access',r.status_code in (401,403))
for script,extras,name in [('scripts/check-reward-first.py',{'REWARD_PREVIEW_URL':url},'Reward-first browser checks'),('scripts/check-public-player-guide-browser.py',{'HANDBOOK_URL':url,'HANDBOOK_STAGE':'reward-first-preview','HANDBOOK_TESTER_PASSWORD':packet['tester_password']},'Retained guide and native login checks')]:
 stage(name)
 result=subprocess.run([sys.executable,script],cwd=ROOT,env=dict(os.environ,**extras),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=300)
 ck(name,result.returncode==0)
for path,before in production.items():
 stage('Confirm unchanged production page '+path)
 r=public.get('https://treegrow.xyz'+path,headers={'Cache-Control':'no-cache'},timeout=(10,30));ck('Production unchanged '+path,r.status_code==200 and r.content==before)
ck('Main remains unchanged',main_sha()==BASE)
report={'deploy_id':ident,'preview_url':url,'branch':BRANCH,'context':d['context'],'published_at':d.get('published_at'),'source_sha':os.environ['GITHUB_SHA'],'http_checks':len(checks),'verified':True,'production_changed':False,'wallet_transactions':0}
save('deploy.json',report);stage('Completed verified branch preview');print(json.dumps(report,indent=2))
