#!/usr/bin/env python3
"""Deploy only the approved preview branch with a run-bound encrypted capability.
No production promotion, signer access, private-key artifact or wallet transaction.
"""
import base64,hashlib,io,json,os,pathlib,subprocess,sys,time,urllib.parse,zipfile
import requests
from cryptography.hazmat.primitives.asymmetric import rsa,padding
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
sys.excepthook=lambda kind,value,tb:print('Preview redesign stopped ('+kind.__name__+'). Review non-secret results; no success is claimed.',file=sys.stderr)
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'prelaunch-results';OUT.mkdir(exist_ok=True)
SITE='a344fb31-10b4-4eea-9562-067d90a39607'
BRANCH='prelaunch-preview-20260926'
RUN=os.environ['GITHUB_RUN_ID']
KEY=pathlib.Path(os.environ['RUNNER_TEMP'])/'prelaunch-redesign-private.pem'
if os.environ.get('REDESIGN_RELAY_MODE')=='key':
 key=rsa.generate_private_key(public_exponent=65537,key_size=3072)
 KEY.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()));KEY.chmod(0o600)
 public={'run_id':RUN,'public_key':key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo).decode(),'branch':BRANCH,'site_id':SITE}
 (OUT/'redesign-public-key.json').write_text(json.dumps(public,indent=2))
 print('Preview-only public encryption key ready. No credential received.');raise SystemExit(0)
key=serialization.load_pem_private_key(KEY.read_bytes(),password=None)
s=requests.Session();s.headers.update({'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json'})
endpoint='https://api.github.com/repos/TheCryptoArborist/arboretum/contents/docs/prelaunch-redesign-envelope.json?ref=feature/prelaunch-gate'
packet=None
for attempt in range(60):
 r=s.get(endpoint,timeout=20)
 if r.status_code==200:
  envelope=json.loads(base64.b64decode(r.json()['content']))
  if envelope.get('run_id')==RUN:
   aes=key.decrypt(base64.b64decode(envelope['wrapped_key']),padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),algorithm=hashes.SHA256(),label=None))
   packet=json.loads(AESGCM(aes).decrypt(base64.b64decode(envelope['nonce']),base64.b64decode(envelope['ciphertext']),RUN.encode()));break
 time.sleep(10)
KEY.unlink(missing_ok=True)
if packet is None:raise SystemExit('No matching envelope received. No deployment attempted.')
proxy=packet['proxy_url'].rstrip('/');u=urllib.parse.urlparse(proxy)
assert u.scheme=='https' and u.netloc in ['netlify-mcp.netlify.app','mcp.netlify.com','netlify-mcp.netlify.com'] and u.path.startswith('/proxy/')
files=subprocess.check_output(['git','ls-files'],cwd=ROOT,text=True).splitlines()
buffer=io.BytesIO()
with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED) as z:
 for name in files:
  if name.startswith(('.git','.env','docs/','contract/','prelaunch-results/')):continue
  z.write(ROOT/name,name)
url=proxy+'/api/v1/sites/'+SITE+'/builds?'+urllib.parse.urlencode({'branch':BRANCH,'title':'Arboretum rewards-led homepage redesign — preview only'})
r=requests.post(url,files={'zip':('prelaunch-redesign.zip',buffer.getvalue(),'application/zip')},timeout=120)
if not r.ok:raise SystemExit('Preview build rejected: HTTP '+str(r.status_code))
data=r.json();data=data[0] if isinstance(data,list) else data
deploy_id=data.get('deploy_id');assert deploy_id
report={'deploy_id':deploy_id,'build_id':data.get('id'),'requested_branch':BRANCH,'site_id':SITE,'source_commit':os.environ['GITHUB_SHA'],'production_promoted':False}
(OUT/'redesign-deploy.json').write_text(json.dumps(report,indent=2));print('Branch build started:',deploy_id)
for attempt in range(100):
 r=requests.get(proxy+'/api/v1/deploys/'+deploy_id,timeout=30)
 if r.ok:
  deploy=r.json()
  if deploy.get('state')=='error':raise SystemExit('Preview build failed; inspect deploy '+deploy_id)
  if deploy.get('state')=='ready':break
 time.sleep(6)
else:raise SystemExit('Preview build did not finish within this check.')
assert deploy.get('context')=='branch-deploy' and not deploy.get('published_at')
base=deploy['deploy_ssl_url'];session=requests.Session();checks=[]
def check(name,ok):
 checks.append({'check':name,'passed':bool(ok)})
 (OUT/'redesign-http.json').write_text(json.dumps(checks,indent=2))
 if not ok:raise RuntimeError(name)
r=session.get(base+'/',timeout=30);check('Public redesigned page',r.status_code==200 and 'data-prelaunch-version="2"' in r.text and '<script' not in r.text)
check('Public referral rates',all(x in r.text for x in ['DIRECT PLANTS','CRATE BUYS','10%','1%']))
check('Preview is noindex','noindex' in r.text)
r=session.get(base+'/prelaunch/garden-preview.avif',timeout=30);check('Actual garden crop integrity',r.status_code==200 and hashlib.sha256(r.content).hexdigest()=='15cbeb1b0ee0f8466e3e8202c71843bd63dbd793c9f8bd1040edcfc533c6a782')
for path in ['/game.html','/wallet.js','/garden.js','/player-guide','/player-guide.html','/sui-sdk.bundle.js','/sdk-entry.js','/.netlify/functions/calendar-reminder']:
 r=session.get(base+path,headers={'Accept':'application/json'},allow_redirects=False,timeout=30);check('Unauthorized '+path,r.status_code in (401,403))
r=session.get(base+'/tester-access',timeout=30);check('Native-login Referrer-Policy retained',r.status_code==200 and r.headers.get('Referrer-Policy')=='same-origin')
r=session.post(base+'/tester-access',headers={'Origin':base},data={'password':'invalid-test-code'},allow_redirects=False,timeout=30);check('Wrong code denied',r.status_code==401 and 'set-cookie' not in r.headers)
r=session.post(base+'/tester-access',headers={'Origin':base},data={'password':packet['tester_password']},allow_redirects=False,timeout=30);check('Same tester code works',r.status_code==303 and 'HttpOnly' in r.headers.get('set-cookie','') and 'Secure' in r.headers.get('set-cookie',''))
r=session.get(base+'/game.html',timeout=30);check('Original game remains accessible',r.status_code==200 and 'garden-sec' in r.text)
for name in ['wallet.js','garden.js','sui-sdk.bundle.js']:
 r=session.get(base+'/'+name,timeout=30);check('Byte-identical '+name,r.status_code==200 and hashlib.sha256(r.content).digest()==hashlib.sha256((ROOT/name).read_bytes()).digest())
r=session.post(base+'/tester-logout',headers={'Origin':base},allow_redirects=False,timeout=30);check('Logout',r.status_code==303)
r=session.get(base+'/wallet.js',headers={'Accept':'application/json'},allow_redirects=False,timeout=30);check('Denied after logout',r.status_code in (401,403))
report.update({'preview_url':base,'context':deploy['context'],'state':deploy['state'],'http_checks':len(checks)})
(OUT/'redesign-deploy.json').write_text(json.dumps(report,indent=2))
env=dict(os.environ,REDESIGN_PREVIEW_URL=base,REDESIGN_TESTER_PASSWORD=packet['tester_password'])
result=subprocess.run([sys.executable,'scripts/check-prelaunch-redesign-browser.py'],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=300)
if result.returncode!=0:
 report['browser_passed']=False;(OUT/'redesign-deploy.json').write_text(json.dumps(report,indent=2))
 raise SystemExit('Hosted browser verification failed. Non-secret assertions were saved; no full success claimed.')
browser_checks=json.loads((OUT/'redesign-browser.json').read_text())
report.update({'browser_passed':all(x['passed'] for x in browser_checks),'browser_assertions':len(browser_checks),'wallet_transactions':0})
(OUT/'redesign-deploy.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
