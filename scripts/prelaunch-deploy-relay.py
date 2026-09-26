#!/usr/bin/env python3
"""One-use encrypted handoff to an authorized Netlify build proxy. Never publish main.
Private key lives only in this runner's temporary filesystem and is never uploaded.
Only a run-bound RSA/AES encrypted credential envelope is fetched from GitHub.
"""
import base64, io, json, os, pathlib, subprocess, time, urllib.parse, zipfile
import requests
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
# Never serialize exception messages: HTTP exceptions can contain credential URLs.
import sys
sys.excepthook = lambda kind, value, tb: print('Preview relay stopped (' + kind.__name__ + '). Inspect the non-secret status report; no success is claimed.', file=sys.stderr)
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'prelaunch-results';OUT.mkdir(exist_ok=True)
SITE='a344fb31-10b4-4eea-9562-067d90a39607'
BRANCH='prelaunch-preview-20260926'
RUN=os.environ['GITHUB_RUN_ID']
KEY=pathlib.Path(os.environ['RUNNER_TEMP'])/'prelaunch-private.pem'
if os.environ.get('RELAY_MODE')=='key':
    key=rsa.generate_private_key(public_exponent=65537,key_size=3072)
    KEY.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()));KEY.chmod(0o600)
    public={'run_id':RUN,'public_key':key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo).decode(),'branch':BRANCH,'site_id':SITE}
    (OUT/'upload-public-key.json').write_text(json.dumps(public,indent=2))
    print('One-use upload public key ready. No credential has been received.');raise SystemExit(0)
key=serialization.load_pem_private_key(KEY.read_bytes(),password=None)
s=requests.Session();s.headers.update({'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json'})
envelope_url='https://api.github.com/repos/TheCryptoArborist/arboretum/contents/docs/prelaunch-upload-envelope.json?ref=feature/prelaunch-gate'
packet=None
for attempt in range(60):
    r=s.get(envelope_url,timeout=20)
    if r.status_code==200:
        envelope=json.loads(base64.b64decode(r.json()['content']))
        if envelope.get('run_id')==RUN:
            aes=key.decrypt(base64.b64decode(envelope['wrapped_key']),padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),algorithm=hashes.SHA256(),label=None))
            data=AESGCM(aes).decrypt(base64.b64decode(envelope['nonce']),base64.b64decode(envelope['ciphertext']),RUN.encode())
            packet=json.loads(data);break
    time.sleep(10)
KEY.unlink(missing_ok=True)
if packet is None: raise SystemExit('No run-matching credential envelope arrived; no deployment attempted.')
proxy=packet['proxy_url'].rstrip('/')
u=urllib.parse.urlparse(proxy)
assert u.scheme=='https' and u.netloc in ['netlify-mcp.netlify.app','mcp.netlify.com','netlify-mcp.netlify.com'], 'Unexpected proxy host'
assert u.path.startswith('/proxy/'), 'Unexpected proxy route'
# Upload only tracked application source; no key, envelope, artifact, node_modules or local env.
files=subprocess.check_output(['git','ls-files'],cwd=ROOT,text=True).splitlines()
buffer=io.BytesIO()
with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED) as z:
    for name in files:
        if name.startswith(('.git','.env','docs/','contract/','prelaunch-results/')):continue
        z.write(ROOT/name,name)
url=proxy+'/api/v1/sites/'+SITE+'/builds?'+urllib.parse.urlencode({'branch':BRANCH,'title':'Arboretum prelaunch gate preview — not production'})
r=requests.post(url,files={'zip':('prelaunch-source.zip',buffer.getvalue(),'application/zip')},timeout=120)
if not r.ok: raise SystemExit('Preview build request rejected: HTTP '+str(r.status_code))
data=r.json(); data=data[0] if isinstance(data,list) else data
deploy_id=data.get('deploy_id');assert deploy_id, 'Build response has no deploy ID'
(OUT/'netlify-preview.json').write_text(json.dumps({'deploy_id':deploy_id,'build_id':data.get('id'),'requested_branch':BRANCH,'site_id':SITE},indent=2))
print('Preview build started. Deploy ID:',deploy_id)
for attempt in range(100):
    response=requests.get(proxy+'/api/v1/deploys/'+deploy_id,timeout=30)
    if response.ok:
        deploy=response.json()
        if deploy.get('state')=='error':raise SystemExit('Netlify preview build failed. Inspect deploy '+deploy_id)
        if deploy.get('state')=='ready':break
    time.sleep(6)
else:raise SystemExit('Preview build still incomplete; no ready result claimed.')
assert deploy.get('context')=='branch-deploy', 'Unexpected deploy context; do not promote'
base=deploy['deploy_ssl_url'];session=requests.Session()
checks=[]
def check(name,ok):
    checks.append({'check':name,'passed':bool(ok)})
    if not ok:
        (OUT/'hosted-access-checks.json').write_text(json.dumps(checks,indent=2));raise SystemExit('Hosted access check failed: '+name)
r=session.get(base+'/',timeout=30);check('Public landing',r.status_code==200 and 'Your next season' in r.text and '<script' not in r.text)
for path in ['/game.html','/wallet.js','/garden.js','/player-guide','/player-guide.html','/sui-sdk.bundle.js','/sdk-entry.js','/.netlify/functions/calendar-reminder']:
    r=session.get(base+path,headers={'Accept':'application/json'},allow_redirects=False,timeout=30);check('Unauthenticated '+path,r.status_code in (401,403))
r=session.post(base+'/tester-access',headers={'Origin':base},data={'password':'not-the-access-code'},allow_redirects=False,timeout=30);check('Wrong password',r.status_code==401 and 'set-cookie' not in r.headers)
r=session.post(base+'/tester-access',headers={'Origin':base},data={'password':packet['tester_password']},allow_redirects=False,timeout=30);check('Correct login',r.status_code==303 and 'HttpOnly' in r.headers.get('set-cookie','') and 'Secure' in r.headers.get('set-cookie',''))
r=session.get(base+'/game.html',timeout=30);check('Authenticated original game',r.status_code==200 and 'garden-sec' in r.text)
for name in ['wallet.js','garden.js','sui-sdk.bundle.js']:
    import hashlib
    r=session.get(base+'/'+name,timeout=30);check('Unchanged '+name,r.status_code==200 and hashlib.sha256(r.content).digest()==hashlib.sha256((ROOT/name).read_bytes()).digest())
r=session.post(base+'/tester-logout',headers={'Origin':base},allow_redirects=False,timeout=30);check('Logout',r.status_code==303)
r=session.get(base+'/wallet.js',headers={'Accept':'application/json'},allow_redirects=False,timeout=30);check('No access after logout',r.status_code in (401,403))
(OUT/'hosted-access-checks.json').write_text(json.dumps(checks,indent=2))
summary={'deploy_id':deploy_id,'build_id':data.get('id'),'context':deploy['context'],'preview_url':base,'branch':deploy.get('branch'),'state':deploy['state'],'checks_passed':len(checks),'live_site_switched':False}
(OUT/'netlify-preview.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))
