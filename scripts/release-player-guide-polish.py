#!/usr/bin/env python3
"""Bounded website-only release. All game, auth and economic sources stay unchanged.
The capability is encrypted to this run; keys/credentials never enter artifacts.
"""
from pathlib import Path
import base64,hashlib,io,json,os,re,subprocess,sys,time,urllib.parse,zipfile
import requests
from bs4 import BeautifulSoup
from cryptography.hazmat.primitives.asymmetric import rsa,padding
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'guide-results';OUT.mkdir(exist_ok=True)
BASE='cf01641d11edc9171be73d125cd9ef04cc6449b6';OLD='6ab9cb0bc9d95d525c521d23';SITE='a344fb31-10b4-4eea-9562-067d90a39607'
RUN=os.environ['GITHUB_RUN_ID'];KEY=Path(os.environ['RUNNER_TEMP'])/'guide-release-private.pem'
sys.excepthook=lambda t,v,tb:print('Guide release stopped: '+t.__name__+'. See the non-secret result report.',file=sys.stderr)
def save(n,x):(OUT/n).write_text(json.dumps(x,indent=2)+'\n')
def sha(b):return hashlib.sha256(b).hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT)
def require(r,step):
 if not r.ok:
  save('http-failure.json',{'operation':step,'status':r.status_code});raise RuntimeError(step)
if os.environ.get('GUIDE_RELEASE_MODE')=='key':
 key=rsa.generate_private_key(public_exponent=65537,key_size=3072)
 KEY.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()));KEY.chmod(0o600)
 save('public-key.json',{'run_id':RUN,'site_id':SITE,'public_key':key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo).decode()})
 print('One-use guide release public key ready.');raise SystemExit(0)
unchanged=['index.html','wallet.js','garden.js','sui-sdk.bundle.js','sdk-entry.js','contract/sources/arboretum.move','netlify/functions/calendar-reminder.js','netlify/edge-functions/tester-gate.ts','prelaunch/index.html','prelaunch/site.css','prelaunch/shop-pool.html','prelaunch/shop-pool.css','scripts/build-player-guide.py','scripts/build-guide-site.mjs','scripts/build-prelaunch.mjs','content/player-guide-first-purchase.html']
for name in unchanged:assert git('show',BASE+':'+name)==(ROOT/name).read_bytes(),'Out-of-scope source changed'
api=requests.Session();api.headers.update({'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json'})
def assert_main():
 r=api.get('https://api.github.com/repos/TheCryptoArborist/arboretum/git/ref/heads/main',timeout=20);require(r,'Read main');assert r.json()['object']['sha']==BASE,'Main drifted'
assert_main();key=serialization.load_pem_private_key(KEY.read_bytes(),password=None);packet=None
for _ in range(80):
 r=api.get('https://api.github.com/repos/TheCryptoArborist/arboretum/contents/docs/guide-release-envelope.json?ref=style/player-guide-polish',timeout=20)
 if r.ok:
  e=json.loads(base64.b64decode(r.json()['content']))
  if e.get('run_id')==RUN:
   aes=key.decrypt(base64.b64decode(e['wrapped_key']),padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),algorithm=hashes.SHA256(),label=None))
   packet=json.loads(AESGCM(aes).decrypt(base64.b64decode(e['nonce']),base64.b64decode(e['ciphertext']),RUN.encode()));break
 time.sleep(6)
KEY.unlink(missing_ok=True)
if packet is None:raise SystemExit('No run-bound capability received. No deployment attempted.')
proxy=packet['proxy_url'].rstrip('/');u=urllib.parse.urlparse(proxy)
assert u.scheme=='https' and u.hostname in ['netlify-mcp.netlify.app','mcp.netlify.com','netlify-mcp.netlify.com'] and u.path.startswith('/proxy/')
secret=packet['tester_password'];live='https://treegrow.xyz'
s=requests.Session();r=s.get(live+'/',timeout=30);require(r,'Read current homepage');home=r.content
assert 'id="item-shop"' in r.text and 'id="growth-pool"' in r.text,'Unexpected homepage baseline'
r=s.post(live+'/tester-access',headers={'Origin':live},data={'password':secret},allow_redirects=False,timeout=30)
assert r.status_code==303 and 'HttpOnly' in r.headers.get('set-cookie',''),'Cannot authenticate baseline'
previous={}
for f in ['game.html','wallet.js','garden.js','sui-sdk.bundle.js','player-guide.html']:
 r=s.get(live+'/'+f,timeout=30);require(r,'Read prior '+f);assert len(r.content)>1000;previous[f]=r.content
assert 'What do I need to buy first?' in previous['player-guide.html'].decode()
assert 'data-guide-polish=' not in previous['player-guide.html'].decode(),'Guide already changed; reconcile'
s.post(live+'/tester-logout',headers={'Origin':live},data={},allow_redirects=False,timeout=30)
save('baseline.json',{'home_sha256':sha(home),'prior_deploy':OLD,'files':{k:sha(v) for k,v in previous.items()}})
def semantic(data):
 soup=BeautifulSoup(data,'html.parser')
 for n in soup.select('style,script,.brand-icon'):n.decompose()
 return ' '.join(soup.get_text(' ',strip=True).split())
def scripts(data):return [str(x) for x in BeautifulSoup(data,'html.parser').select('script')]
def source_zip(ref=None):
 buff=io.BytesIO()
 with zipfile.ZipFile(buff,'w',zipfile.ZIP_DEFLATED) as z:
  for n in git('ls-tree','-r','--name-only',ref or 'HEAD').decode().splitlines():
   if n.startswith(('.git','.env','docs/','contract/','guide-results/','prelaunch-results/','showcase-results/')):continue
   z.writestr(n,git('show',ref+':'+n) if ref else (ROOT/n).read_bytes())
 return buff.getvalue()
candidate=source_zip();rollback=source_zip(BASE)
report={'source_commit':os.environ['GITHUB_SHA'],'base':BASE,'old_deploy':OLD,'unchanged_source':unchanged,'wallet_transactions':0,'production_verified':False};save('release.json',report)
def deploy(data,title,branch=None):
 qs={'title':title}
 if branch:qs['branch']=branch
 r=requests.post(proxy+'/api/v1/sites/'+SITE+'/builds?'+urllib.parse.urlencode(qs),files={'zip':('guide-source.zip',data,'application/zip')},timeout=120);require(r,'Create Netlify build');j=r.json();j=j[0] if isinstance(j,list) else j;ident=j['deploy_id']
 for _ in range(100):
  r=requests.get(proxy+'/api/v1/deploys/'+ident,timeout=30);require(r,'Read Netlify deploy');d=r.json()
  if d['state']=='error':raise RuntimeError('Netlify build failed')
  if d['state']=='ready':return d
  time.sleep(5)
 raise RuntimeError('Deployment timeout')
def verify(base,stage,production=False):
 checks=[]
 def check(n,ok):
  checks.append({'check':n,'passed':bool(ok)});save(stage+'-http.json',checks)
  if not ok:raise RuntimeError(n)
 session=requests.Session();r=session.get(base+'/',timeout=30)
 expected=home if production else home.replace(b'content="index,follow"',b'content="noindex,nofollow"')
 check('Marketing homepage unchanged',r.status_code==200 and r.content==expected)
 for name in ['/player-guide','/player-guide.html','/guide/guide.css','/game.html','/wallet.js','/garden.js','/sui-sdk.bundle.js']:
  r=session.get(base+name,headers={'Accept':'application/json'},allow_redirects=False,timeout=30);check('Tester protection '+name,r.status_code in (401,403))
 r=session.post(base+'/tester-access',headers={'Origin':base},data={'password':secret},allow_redirects=False,timeout=30);check('Login',r.status_code==303)
 for f in ['game.html','wallet.js','garden.js','sui-sdk.bundle.js']:
  r=session.get(base+'/'+f,timeout=30);check('Unchanged gameplay '+f,r.status_code==200 and r.content==previous[f])
 r=session.get(base+'/player-guide',timeout=30);check('Polished guide delivered',r.status_code==200 and 'data-guide-polish="1"' in r.text)
 check('Every original guide word retained',semantic(r.content)==semantic(previous['player-guide.html']))
 check('Original guide scripts retained',scripts(r.content)==scripts(previous['player-guide.html']))
 soup=BeautifulSoup(r.content,'html.parser');check('20 tools retained',len(soup.select('.tool'))==20)
 check('Back to game corrected',soup.select_one('.top-actions a')['href']=='/game.html')
 check('All original section and tool anchors',sorted(n['id'] for n in soup.select('[id]'))==sorted(n['id'] for n in BeautifulSoup(previous['player-guide.html'],'html.parser').select('[id]')))
 r=session.get(base+'/guide/guide.css',timeout=30);check('Stylesheet matches source',r.status_code==200 and r.content==(ROOT/'content/player-guide-polish.css').read_bytes())
 session.post(base+'/tester-logout',headers={'Origin':base},data={},allow_redirects=False,timeout=30)
 r=session.get(base+'/player-guide',headers={'Accept':'application/json'},allow_redirects=False,timeout=30);check('Guide denied after logout',r.status_code in (401,403))
 env=dict(os.environ,GUIDE_URL=base,GUIDE_STAGE=stage,GUIDE_TESTER_PASSWORD=secret)
 result=subprocess.run([sys.executable,'scripts/check-player-guide-browser.py'],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=300)
 check('Native browser guide checks',result.returncode==0)
 return len(checks)
p=deploy(candidate,'Polished Arboretum Player Guide — isolated review','guide-polish-20260928');assert p['context']=='branch-deploy' and not p.get('published_at')
report.update({'preview_deploy':p['id'],'preview_url':p['deploy_ssl_url']});save('release.json',report)
report['preview_checks']=verify(p['deploy_ssl_url'],'preview');save('release.json',report)
assert_main();r=requests.get(live+'/',timeout=30);assert r.status_code==200 and r.content==home,'Production drifted'
attempted=False
try:
 attempted=True;d=deploy(candidate,'Polish Player Guide presentation — rules and game unchanged');assert d['context']=='production' and d.get('published_at')
 report.update({'production_deploy':d['id'],'published_at':d['published_at']});save('release.json',report)
 report['production_checks']=verify(live,'production',True);report['production_verified']=True;save('release.json',report);print(json.dumps(report,indent=2))
except Exception as exc:
 report.update({'failure':type(exc).__name__,'rollback_attempted':attempted});save('release.json',report)
 if attempted:
  try:
   b=deploy(rollback,'Restore prior Arboretum guide after presentation check failure')
   rr=requests.get(live+'/',timeout=30);report.update({'rollback_deploy':b['id'],'rollback_homepage_verified':rr.status_code==200 and rr.content==home})
  except Exception as re:report['rollback_failure']=type(re).__name__
 save('release.json',report);raise SystemExit('Guide release not verified; inspect release.json.')
