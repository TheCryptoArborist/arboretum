#!/usr/bin/env python3
"""Release the owner-requested public handbook, retaining the gated tester reference.
One-use encrypted deployment capability; no secrets in artifacts and no chain calls.
"""
import base64,hashlib,io,json,os,pathlib,subprocess,sys,time,urllib.parse,zipfile
import requests
from cryptography.hazmat.primitives.asymmetric import rsa,padding
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=ROOT/'handbook-results';OUT.mkdir(exist_ok=True)
BASE='779f8789089db5da3f81e6d955f5d7a5b1515633';OLD='6ab9d41e08b0ba53890c73bf';SITE='a344fb31-10b4-4eea-9562-067d90a39607';RUN=os.environ['GITHUB_RUN_ID']
KEY=pathlib.Path(os.environ['RUNNER_TEMP'])/'handbook-handoff.pem'
sys.excepthook=lambda kind,value,tb:print('Handbook release stopped ('+kind.__name__+'). Inspect the non-secret result.',file=sys.stderr)
def save(name,obj):(OUT/name).write_text(json.dumps(obj,indent=2)+'\n')
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT)
def sha(data):return hashlib.sha256(data).hexdigest()
if os.environ.get('HANDBOOK_MODE')=='key':
 key=rsa.generate_private_key(public_exponent=65537,key_size=3072);KEY.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()));KEY.chmod(0o600)
 save('public-key.json',{'run_id':RUN,'site_id':SITE,'public_key':key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo).decode()});print('One-use public key ready.');raise SystemExit(0)
api=requests.Session();api.headers.update({'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json'})
def check_main():
 r=api.get('https://api.github.com/repos/TheCryptoArborist/arboretum/git/ref/heads/main',timeout=30);assert r.ok and r.json()['object']['sha']==BASE,'Main changed; reconcile before release'
check_main()
unchanged=['index.html','wallet.js','garden.js','sui-sdk.bundle.js','sdk-entry.js','contract/sources/arboretum.move','scripts/build-player-guide.py','scripts/build-guide-site.mjs','scripts/polish-player-guide.mjs','content/player-guide-polish.css','prelaunch/index.html','prelaunch/site.css','prelaunch/shop-pool.html','prelaunch/shop-pool.css','netlify/functions/calendar-reminder.js']
for f in unchanged:assert git('show',BASE+':'+f)==(ROOT/f).read_bytes(),'Out-of-scope source modification'
old_gate=git('show',BASE+':netlify/edge-functions/tester-gate.ts').decode();new_gate=(ROOT/'netlify/edge-functions/tester-gate.ts').read_text()
assert old_gate.split('export const config:')[0].rstrip()==new_gate.split('// The public handbook has a dedicated')[0].rstrip(),'Tester authentication changed'
key=serialization.load_pem_private_key(KEY.read_bytes(),password=None);packet=None
for _ in range(100):
 r=api.get('https://api.github.com/repos/TheCryptoArborist/arboretum/contents/docs/handbook-release-envelope.json?ref=feature/public-player-handbook',timeout=20)
 if r.ok:
  env=json.loads(base64.b64decode(r.json()['content']))
  if env.get('run_id')==RUN:
   aes=key.decrypt(base64.b64decode(env['wrapped_key']),padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),algorithm=hashes.SHA256(),label=None))
   packet=json.loads(AESGCM(aes).decrypt(base64.b64decode(env['nonce']),base64.b64decode(env['ciphertext']),RUN.encode()));break
 time.sleep(6)
KEY.unlink(missing_ok=True)
if packet is None:raise SystemExit('No run-bound capability received; no deployment attempted.')
proxy=packet['proxy_url'].rstrip('/');u=urllib.parse.urlparse(proxy)
assert u.scheme=='https' and u.hostname in ['netlify-mcp.netlify.app','mcp.netlify.com','netlify-mcp.netlify.com'] and u.path.startswith('/proxy/')
prior=requests.Session();r=prior.post('https://treegrow.xyz/tester-access',headers={'Origin':'https://treegrow.xyz'},data={'password':packet['tester_password']},allow_redirects=False,timeout=30)
assert r.status_code==303 and 'HttpOnly' in r.headers.get('set-cookie',''),'Prior tester login failed'
previous={}
for name in ['game.html','wallet.js','garden.js','sui-sdk.bundle.js','player-guide.html','guide/guide.css']:
 r=prior.get('https://treegrow.xyz/'+name,timeout=30);assert r.status_code==200 and len(r.content)>1000,'Prior protected file not available'
 if name=='game.html':assert 'id="garden-sec"' in r.text
 if name=='player-guide.html':assert 'Read this before testing' in r.text
 previous[name]=r.content
r=prior.get('https://treegrow.xyz/',timeout=30);assert r.status_code==200 and 'Garden &amp; guide: invited testers only.' in r.text;home_before=r.content
save('baseline.json',{'deploy_checked_via_connector':OLD,'homepage_sha256':sha(home_before),'protected_files':{k:sha(v) for k,v in previous.items()}})
prior.post('https://treegrow.xyz/tester-logout',headers={'Origin':'https://treegrow.xyz'},data={},timeout=30)
def unchanged_live():
 r=requests.get('https://treegrow.xyz/',params={'handbook-check':RUN},headers={'Cache-Control':'no-cache'},timeout=30);assert r.status_code==200 and r.content==home_before,'Live homepage changed'
def archive(ref=None):
 buf=io.BytesIO();names=git('ls-tree','-r','--name-only',ref or 'HEAD').decode().splitlines()
 with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as z:
  for n in names:
   if n.startswith(('.git','.env','docs/','contract/','handbook-results/','guide-results/','prelaunch-results/','showcase-results/')):continue
   z.writestr(n,git('show',ref+':'+n) if ref else (ROOT/n).read_bytes())
 return buf.getvalue()
candidate=archive();rollback=archive(BASE)
report={'base_commit':BASE,'source_commit':os.environ['GITHUB_SHA'],'old_production':OLD,'unchanged_sources':unchanged,'production_verified':False,'wallet_transactions':0};save('release.json',report)
def deploy(source,title,branch=None):
 qs={'title':title}
 if branch:qs['branch']=branch
 r=requests.post(proxy+'/api/v1/sites/'+SITE+'/builds?'+urllib.parse.urlencode(qs),files={'zip':('source.zip',source,'application/zip')},timeout=120)
 if not r.ok:raise RuntimeError('Build creation rejected: '+str(r.status_code))
 j=r.json();j=j[0] if isinstance(j,list) else j;ident=j['deploy_id']
 for _ in range(120):
  r=requests.get(proxy+'/api/v1/deploys/'+ident,timeout=30)
  if not r.ok:raise RuntimeError('Deploy status failed: '+str(r.status_code))
  d=r.json()
  if d['state']=='ready':return d
  if d['state']=='error':raise RuntimeError('Netlify build failed')
  time.sleep(5)
 raise RuntimeError('Netlify build not finished')
def verify(base,stage,prod=False):
 checks=[]
 def ck(name,ok):
  checks.append({'check':name,'passed':bool(ok)});save(stage+'-http.json',checks)
  if not ok:raise RuntimeError(name)
 s=requests.Session()
 for path in ['/player-guide','/player-guide.html','/player-guide/']:
  r=s.get(base+path,timeout=30);ck('Anonymous '+path,r.status_code==200 and 'data-guide-audience="players"' in r.text and 'Read this before testing' not in r.text)
  ck('Handbook CSP '+path,"connect-src 'none'" in r.headers.get('Content-Security-Policy','') and "script-src 'self'" in r.headers.get('Content-Security-Policy',''))
  ck('No authentication cookie '+path,'Set-Cookie' not in r.headers and not s.cookies)
 r=s.get(base+'/player-guide',timeout=30);ck('Guide indexing context',('content="index,follow"' if prod else 'content="noindex,nofollow"') in r.text)
 for path in ['/guide/player-guide.css','/guide/player-guide.js']:
  r=s.get(base+path,timeout=30);ck('Anonymous resource '+path,r.status_code==200 and r.content==(ROOT/'dist'/path.lstrip('/')).read_bytes())
 for path in ['/tester-guide','/tester-guide.html','/guide/guide.css','/game.html','/game','/wallet.js','/garden.js','/sui-sdk.bundle.js','/.netlify/functions/calendar-reminder','/guide/not-public.js']:
  r=s.get(base+path,headers={'Accept':'application/json'},allow_redirects=False,timeout=30);ck('Protected '+path,r.status_code in (401,403))
 r=s.get(base+'/',timeout=30);ck('Homepage only updates access note',r.status_code==200 and r.content==home_before.replace(b'Garden &amp; guide: invited testers only.',b'Player Guide: open to everyone. Garden: invited testers only.') if prod else r.status_code==200 and 'Player Guide: open to everyone.' in r.text)
 r=s.get(base+'/robots.txt',timeout=30);ck('Robots context',r.status_code==200 and ('Allow: /player-guide$' in r.text if prod else 'Allow: /player-guide$' not in r.text))
 if prod:
  r=s.get(base+'/sitemap.xml',timeout=30);ck('Guide listed in sitemap','https://treegrow.xyz/player-guide' in r.text and 'tester-guide' not in r.text)
 r=s.post(base+'/tester-access',headers={'Origin':base},data={'password':packet['tester_password']},allow_redirects=False,timeout=30);ck('Tester login unchanged',r.status_code==303)
 for new,old in [('tester-guide.html','player-guide.html'),('guide/guide.css','guide/guide.css'),('game.html','game.html'),('wallet.js','wallet.js'),('garden.js','garden.js'),('sui-sdk.bundle.js','sui-sdk.bundle.js')]:
  r=s.get(base+'/'+new,timeout=30);ck('Preserved '+new,r.status_code==200 and r.content==previous[old])
 r=s.post(base+'/tester-logout',headers={'Origin':base},data={},allow_redirects=False,timeout=30);ck('Logout',r.status_code==303)
 r=s.get(base+'/tester-guide',headers={'Accept':'application/json'},allow_redirects=False,timeout=30);ck('Private reference denied after logout',r.status_code in (401,403))
 env=dict(os.environ,HANDBOOK_URL=base,HANDBOOK_STAGE=stage,HANDBOOK_TESTER_PASSWORD=packet['tester_password'])
 result=subprocess.run([sys.executable,'scripts/check-public-player-guide-browser.py'],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=300)
 ck('Native browser and public guide controls',result.returncode==0)
 return len(checks)
unchanged_live();p=deploy(candidate,'Public player handbook — verify before production','public-handbook-20260928');assert p['context']=='branch-deploy' and not p.get('published_at')
report.update(preview_deploy=p['id'],preview_url=p['deploy_ssl_url']);save('release.json',report)
report['preview_http_checks']=verify(p['deploy_ssl_url'],'preview');save('release.json',report)
check_main();unchanged_live()
try:
 d=deploy(candidate,'Public player handbook; tester reference and gameplay remain gated');assert d['context']=='production' and d.get('published_at')
 report.update(production_deploy=d['id'],published_at=d['published_at']);save('release.json',report)
 report['production_http_checks']=verify('https://treegrow.xyz','production',True);report['production_verified']=True;save('release.json',report);print(json.dumps(report,indent=2))
except Exception as exc:
 report.update(failure=type(exc).__name__,rollback_attempted=True)
 try:
  back=deploy(rollback,'Restore prior gated guide after handbook release verification failed');r=requests.get('https://treegrow.xyz/player-guide',headers={'Accept':'application/json'},allow_redirects=False,timeout=30)
  report.update(rollback_deploy=back['id'],rollback_verified=r.status_code in (401,403))
 except Exception as re:report.update(rollback_verified=False,rollback_failure=type(re).__name__)
 save('release.json',report);raise SystemExit('Production verification did not pass; inspect release.json.')
