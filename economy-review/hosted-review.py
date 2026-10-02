"""Branch preview only. No production release or blockchain transaction path."""
from pathlib import Path
import base64,hashlib,io,json,os,subprocess,sys,time,urllib.parse,zipfile,traceback
import requests
from cryptography.hazmat.primitives.asymmetric import rsa,padding
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'economy-review-results'/'hosted';OUT.mkdir(parents=True,exist_ok=True)
SITE='a344fb31-10b4-4eea-9562-067d90a39607';OLD='6abe81174b61a8e3dd53b333';BASE='84b08fdb4bc0ec0417ced7be21f29aae914939f7';LIVE='https://treegrow.xyz';BRANCH='partner-season-preview-20261002'
RUN=os.environ['GITHUB_RUN_ID'];ATTEMPT=os.environ.get('GITHUB_RUN_ATTEMPT','1');SHA=os.environ['GITHUB_SHA'];KEY=Path(os.environ['RUNNER_TEMP'])/'partner-preview-key.pem'
operation='initializing'
def save(n,j):(OUT/n).write_text(json.dumps(j,indent=2)+'\n')
def sha(b):return hashlib.sha256(b).hexdigest()
def git(*a):return subprocess.check_output(['git',*a],cwd=ROOT)
def failure(kind,value,tb):
 save('failure.json',{'operation':operation,'type':kind.__name__,'frames':[{'file':Path(f.filename).name,'line':f.lineno} for f in traceback.extract_tb(tb)][-7:]});print('Preview verification stopped. See sanitized failure report.',file=sys.stderr)
sys.excepthook=failure
if os.environ.get('PARTNER_HOST_MODE')=='key':
 k=rsa.generate_private_key(public_exponent=65537,key_size=3072);KEY.write_bytes(k.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()));KEY.chmod(0o600)
 save('public-key.json',{'run_id':RUN,'attempt':ATTEMPT,'source_sha':SHA,'site_id':SITE,'public_key':k.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo).decode()});raise SystemExit(0)
api=requests.Session();api.headers.update({'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json'})
r=api.get('https://api.github.com/repos/TheCryptoArborist/arboretum/git/ref/heads/main',timeout=30);assert r.ok and r.json()['object']['sha']==BASE
for line in git('diff','--name-status',BASE,'HEAD').decode().splitlines():
 status,path=line.split('\t');assert status=='A' and (path.startswith('economy-review/') or path=='.github/workflows/economy-accounting-review.yml')
operation='waiting for encrypted preview capability';key=serialization.load_pem_private_key(KEY.read_bytes(),None);packet=None
for _ in range(100):
 r=api.get('https://api.github.com/repos/TheCryptoArborist/arboretum/contents/economy-review/hosted-envelope.json?ref=feature/economy-accounting-review',timeout=20)
 if r.ok:
  e=json.loads(base64.b64decode(r.json()['content']))
  if e.get('run_id')==RUN and e.get('attempt')==ATTEMPT:
   aes=key.decrypt(base64.b64decode(e['wrapped_key']),padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),algorithm=hashes.SHA256(),label=None))
   packet=json.loads(AESGCM(aes).decrypt(base64.b64decode(e['nonce']),base64.b64decode(e['ciphertext']),(RUN+':'+ATTEMPT).encode()));break
 time.sleep(5)
KEY.unlink(missing_ok=True);assert packet is not None
proxy=packet['proxy_url'].rstrip('/');url=urllib.parse.urlsplit(proxy)
assert url.scheme=='https' and url.hostname in ['netlify-mcp.netlify.app','mcp.netlify.com','netlify-mcp.netlify.com'] and url.path.startswith('/proxy/')
assert packet['source_sha']==SHA and packet['confirmed_deploy_id']==OLD
operation='checking pinned production baseline'
r=requests.get(proxy+'/api/v1/deploys/'+OLD,timeout=30);assert r.ok;d=r.json();assert d['site_id']==SITE and d['context']=='production' and d['state']=='ready'
expected_functions=[x['n'] for x in d.get('available_functions',[])];assert expected_functions==['calendar-reminder'] and not d.get('function_schedules')
password=packet['tester_password'];s=requests.Session()
r=s.post(LIVE+'/tester-access',headers={'Origin':LIVE},data={'password':password},allow_redirects=False,timeout=30);assert r.status_code==303
paths=['/','/player-guide','/wallet.js','/garden.js','/sui-sdk.bundle.js','/game.html','/season-status/model.mjs']
baseline={}
for path in paths:
 r=s.get(LIVE+path,timeout=40);assert r.status_code==200;baseline[path]=r.content
s.post(LIVE+'/tester-logout',headers={'Origin':LIVE},data={},timeout=20)
baseline_game=Path(os.environ['RUNNER_TEMP'])/'partner-before-game.html';baseline_game.write_bytes(baseline['/game.html'])
expected_game=subprocess.check_output(['node','--input-type=module','-e',"import fs from 'node:fs';import {applyPartnerReport} from './economy-review/build-admin-preview.mjs';process.stdout.write(applyPartnerReport(fs.readFileSync(process.argv[1],'utf8')));",str(baseline_game)],cwd=ROOT)
save('baseline.json',{'production_deploy':OLD,'main':BASE,'hashes':{k:sha(v) for k,v in baseline.items()}})
# Only the build command in the uploaded preview source changes. Repo and
# production netlify.toml remain byte-identical to the approved baseline.
b=io.BytesIO()
with zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z:
 for name in git('ls-tree','-r','--name-only','HEAD').decode().splitlines():
  if name.startswith(('.git','.env','docs/')) or name.endswith('hosted-envelope.json') or '-results/' in name:continue
  data=git('show','HEAD:'+name)
  if name=='netlify.toml':
   old=b' && node scripts/build-season-status.mjs"';assert data.count(old)==1
   data=data.replace(old,b' && node scripts/build-season-status.mjs && node economy-review/build-admin-preview.mjs"')
  z.writestr(name,data)
operation='submitting branch-only preview build'
r=requests.post(proxy+'/api/v1/sites/'+SITE+'/builds?'+urllib.parse.urlencode({'branch':BRANCH,'title':'Seasonal partner archive accounting review'}),files={'zip':('source.zip',b.getvalue(),'application/zip')},timeout=(15,120));assert r.ok
v=r.json();v=v[0] if isinstance(v,list) else v;deploy=v['deploy_id'];save('deployment.json',{'deploy_id':deploy,'source_sha':SHA,'branch':BRANCH,'production_changed':False,'verification_complete':False})
for _ in range(120):
 r=requests.get(proxy+'/api/v1/deploys/'+deploy,timeout=30);assert r.ok;d=r.json()
 if d['state']=='error':raise RuntimeError('Preview build failed')
 if d['state']=='ready':break
 time.sleep(5)
assert d['state']=='ready' and d['context']=='branch-deploy' and not d.get('published_at')
assert [x['n'] for x in d.get('available_functions',[])]==expected_functions and not d.get('function_schedules')
base='https://'+deploy+'--arboretum-sui-forest.netlify.app';alias='https://'+BRANCH+'--arboretum-sui-forest.netlify.app'
save('deployment.json',{'deploy_id':deploy,'source_sha':SHA,'preview_url':base,'preview_alias':alias,'context':d['context'],'production_changed':False,'verification_complete':False})
operation='verifying hosted delivery and native tester access';checks=[]
def ck(n,ok):
 checks.append({'check':n,'passed':bool(ok)});save('http-checks.json',checks)
 if not ok:raise AssertionError(n)
t=requests.Session()
for p in ['/game.html','/wallet.js','/economy-review/season-reader.mjs','/economy-review/partner-panel.mjs']:
 r=t.get(base+p,headers={'Accept':'application/json'},allow_redirects=False,timeout=30);ck('Anonymous blocked '+p,r.status_code in [401,403])
r=t.post(base+'/tester-access',headers={'Origin':base},data={'password':'invalid-tester-code'},allow_redirects=False,timeout=30);ck('Wrong code rejected',r.status_code==401)
r=t.post(base+'/tester-access',headers={'Origin':base},data={'password':password},allow_redirects=False,timeout=30);ck('Existing tester code accepted',r.status_code==303 and 'HttpOnly' in r.headers.get('set-cookie',''))
for p,old in baseline.items():
 r=t.get(base+p,timeout=40);ck('HTTP success '+p,r.status_code==200)
 if p=='/game.html':ck('Only expected game overlay added',r.content==expected_game)
 else:ck('Preserved content '+p,r.content==old or p in ['/','/player-guide'] and r.content==old.replace(b'content="index,follow"',b'content="noindex,nofollow"'))
for name in ['ledger.mjs','live-reader.mjs','read-queries.mjs','season-reader.mjs','partner-panel.mjs','partner-panel.css']:
 r=t.get(base+'/economy-review/'+name,timeout=30);ck('Exact module '+name,r.status_code==200 and r.content==(ROOT/'economy-review'/name).read_bytes())
# No runtime source envelopes or deployment helpers are copied into dist.
for name in ['hosted-envelope.json','hosted-review.py']:
 r=t.get(base+'/economy-review/'+name,allow_redirects=False,timeout=20);ck('Capability/helper not published '+name,r.status_code==404)
r=t.post(base+'/tester-logout',headers={'Origin':base},data={},allow_redirects=False,timeout=20);ck('Logout works',r.status_code==303)
r=t.get(base+'/game.html',headers={'Accept':'application/json'},allow_redirects=False,timeout=20);ck('Access removed after logout',r.status_code in [401,403])
operation='hosted browser checks'
env={**os.environ,'PARTNER_URL':base,'PARTNER_TESTER_PASSWORD':password}
subprocess.run([sys.executable,'economy-review/check-hosted.py'],cwd=ROOT,env=env,check=True,timeout=240)
operation='verify production unchanged'
s=requests.Session();r=s.post(LIVE+'/tester-access',headers={'Origin':LIVE},data={'password':password},allow_redirects=False,timeout=20);assert r.status_code==303
for p,old in baseline.items():
 r=s.get(LIVE+p,timeout=40);ck('Production still unchanged '+p,r.ok and r.content==old)
s.post(LIVE+'/tester-logout',headers={'Origin':LIVE},data={},timeout=20)
r=api.get('https://api.github.com/repos/TheCryptoArborist/arboretum/git/ref/heads/main',timeout=20);ck('Main unchanged',r.ok and r.json()['object']['sha']==BASE)
save('deployment.json',{'deploy_id':deploy,'source_sha':SHA,'preview_url':base,'preview_alias':alias,'context':'branch-deploy','production_changed':False,'verification_complete':True,'blockchain_transactions':0,'wallet_connections':0})
print('Branch preview verified:',base)
