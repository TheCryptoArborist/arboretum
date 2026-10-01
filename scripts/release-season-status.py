"""Deploy and verify the approved season panel, preview before production.
Never connect a wallet, submit a blockchain transaction, or change season state.
"""
from pathlib import Path
import base64,hashlib,io,json,os,subprocess,sys,time,traceback,urllib.parse,zipfile
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from cryptography.hazmat.primitives.asymmetric import rsa,padding
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'season-status-results';OUT.mkdir(exist_ok=True)
SITE='a344fb31-10b4-4eea-9562-067d90a39607';BASE='ab5e0fa0e70ede69af6450658c79591e7364dbaa';OLD='6abbe7b634a0e3e47818988a'
LIVE='https://treegrow.xyz';RUN=os.environ['GITHUB_RUN_ID'];ATTEMPT=os.environ.get('GITHUB_RUN_ATTEMPT','1')
KEY=Path(os.environ['RUNNER_TEMP'])/'season-status-key.pem';operation='start'
def save(name,obj):(OUT/name).write_text(json.dumps(obj,indent=2)+'\n')
def sha(data):return hashlib.sha256(data).hexdigest()
def stage(name):
 global operation
 operation=name;save('progress.json',{'operation':name})
def error(kind,value,tb):
 save('failure.json',{'type':kind.__name__,'operation':operation,'frames':[{'file':Path(x.filename).name,'line':x.lineno} for x in traceback.extract_tb(tb)][-8:]})
 print('Season panel release stopped; see failure.json.',file=sys.stderr)
sys.excepthook=error
def git(*a):return subprocess.check_output(['git',*a],cwd=ROOT)
def session():
 s=requests.Session();s.mount('https://',HTTPAdapter(max_retries=Retry(total=3,backoff_factor=.5,allowed_methods=frozenset(['GET','HEAD']),status_forcelist=[429,500,502,503,504])));return s
if os.environ.get('SEASON_RELEASE_MODE')=='key':
 key=rsa.generate_private_key(public_exponent=65537,key_size=3072);KEY.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()));KEY.chmod(0o600)
 save('public-key.json',{'run_id':RUN,'attempt':ATTEMPT,'site_id':SITE,'public_key':key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo).decode()});raise SystemExit(0)
api=session();api.headers.update({'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json'});http=session()
def check_main():
 r=api.get('https://api.github.com/repos/TheCryptoArborist/arboretum/git/ref/heads/main',timeout=30);assert r.ok and r.json()['object']['sha']==BASE,'Main changed'
stage('Source and current main checks');check_main()
protected_sources=['index.html','wallet.js','garden.js','sdk-entry.js','sui-sdk.bundle.js','contract/sources/arboretum.move','netlify/edge-functions/tester-gate.ts','netlify/edge-functions/public-player-guide.ts','netlify/functions/calendar-reminder.js','scripts/build-reward-first.py']
for f in protected_sources:assert (ROOT/f).read_bytes()==git('show',BASE+':'+f),'Out-of-scope source change'
old_toml=git('show',BASE+':netlify.toml').decode();new_toml=(ROOT/'netlify.toml').read_text()
assert new_toml==old_toml.replace(' && python3 scripts/build-reward-first.py"',' && python3 scripts/build-reward-first.py && node scripts/build-season-status.mjs"')
key=serialization.load_pem_private_key(KEY.read_bytes(),None);packet=None;stage('Wait for run-bound encrypted capability')
for _ in range(100):
 r=api.get('https://api.github.com/repos/TheCryptoArborist/arboretum/contents/docs/season-release-envelope.json?ref=fix/garden-season-status',timeout=30)
 if r.ok:
  e=json.loads(base64.b64decode(r.json()['content']))
  if e.get('run_id')==RUN and e.get('attempt')==ATTEMPT:
   if e.get('cancelled'):raise SystemExit('Release handoff withdrawn; no deployment attempted.')
   aes=key.decrypt(base64.b64decode(e['wrapped_key']),padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),algorithm=hashes.SHA256(),label=None))
   packet=json.loads(AESGCM(aes).decrypt(base64.b64decode(e['nonce']),base64.b64decode(e['ciphertext']),(RUN+':'+ATTEMPT).encode()));break
 time.sleep(6)
KEY.unlink(missing_ok=True)
if packet is None:raise SystemExit('No matching capability; no deploy attempted.')
proxy=packet['proxy_url'].rstrip('/');u=urllib.parse.urlsplit(proxy)
assert u.scheme=='https' and u.hostname in ['netlify-mcp.netlify.app','mcp.netlify.com','netlify-mcp.netlify.com'] and u.path.startswith('/proxy/')
# Deployment capabilities permit only build POSTs and individual deploy GETs.
# Current-site identity is checked through the Netlify project connector, then
# carried in this run-bound envelope. Served bytes are checked again below.
assert packet.get('confirmed_deploy_id')==OLD,'Current deployment was not confirmed'
def verify_pinned_deploy():
 stage('Verify pinned prior deployment through the allowed deploy endpoint')
 r=http.get(proxy+'/api/v1/deploys/'+OLD,timeout=30)
 assert r.ok,'Prior deployment metadata unavailable'
 d=r.json()
 assert d['id']==OLD and d['site_id']==SITE and d['state']=='ready' and d['context']=='production' and d.get('published_at')
 assert [x['n'] for x in d.get('available_functions',[])]==['calendar-reminder'] and d.get('function_schedules',[])==[]
verify_pinned_deploy()
pubpaths=['/','/player-guide','/prelaunch/site.css','/prelaunch/shop-pool.css','/guide/player-guide.css','/guide/player-guide.js','/prelaunch/mark.png','/prelaunch/hero.png','/prelaunch/boom-chest.png','/prelaunch/victory-chest.png']
public={}
for path in pubpaths:
 r=http.get(LIVE+path,timeout=40);assert r.status_code==200;public[path]=r.content
s=session();r=s.post(LIVE+'/tester-access',headers={'Origin':LIVE},data={'password':packet['tester_password']},allow_redirects=False,timeout=30);assert r.status_code==303
private={}
for name in ['game.html','wallet.js','garden.js','sui-sdk.bundle.js','tester-guide.html','guide/guide.css']:
 r=s.get(LIVE+'/'+name,timeout=40);assert r.status_code==200 and len(r.content)>1000;private[name]=r.content
s.post(LIVE+'/tester-logout',headers={'Origin':LIVE},data={},allow_redirects=False,timeout=30)
# Compare current responses with the connector-confirmed production permalink.
PINNED='https://'+OLD+'--arboretum-sui-forest.netlify.app'
pinned=session()
r=pinned.post(PINNED+'/tester-access',headers={'Origin':PINNED},data={'password':packet['tester_password']},allow_redirects=False,timeout=30);assert r.status_code==303
for path,before in public.items():
 r=pinned.get(PINNED+path,timeout=40);assert r.status_code==200 and r.content==before,'Public production differs from pinned release'
for name,before in private.items():
 r=pinned.get(PINNED+'/'+name,timeout=40);assert r.status_code==200 and r.content==before,'Private production differs from pinned release'
pinned.post(PINNED+'/tester-logout',headers={'Origin':PINNED},data={},allow_redirects=False,timeout=30)
baseline_path=Path(os.environ['RUNNER_TEMP'])/'previous-game.html';baseline_path.write_bytes(private['game.html'])
expected_game=subprocess.check_output(['node','scripts/build-season-status.mjs','--transform',str(baseline_path)],cwd=ROOT)
save('baseline.json',{'main':BASE,'deploy_checked_via_project_connector':OLD,'pinned_response_parity':True,'public':{k:sha(v) for k,v in public.items()},'private':{k:sha(v) for k,v in private.items()},'expected_game_sha256':sha(expected_game)})
def archive(ref):
 b=io.BytesIO()
 with zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z:
  for n in git('ls-tree','-r','--name-only',ref).decode().splitlines():
   if n.startswith(('.git','.env','docs/','contract/')) or '-results/' in n:continue
   z.writestr(n,git('show',ref+':'+n))
 return b.getvalue()
source=archive('HEAD');rollback=archive(BASE)
report={'source_sha':os.environ['GITHUB_SHA'],'previous_production':OLD,'production_verified':False,'wallet_connections':0,'chain_transactions':0};save('release.json',report)
def deploy(data,title,branch=None):
 qs={'title':title}
 if branch:qs['branch']=branch
 r=requests.post(proxy+'/api/v1/sites/'+SITE+'/builds?'+urllib.parse.urlencode(qs),files={'zip':('source.zip',data,'application/zip')},timeout=(15,120))
 if not r.ok:raise RuntimeError('Build rejected '+str(r.status_code))
 j=r.json();j=j[0] if isinstance(j,list) else j;ident=j['deploy_id'];report['last_attempted_deploy']=ident;save('release.json',report)
 for _ in range(120):
  r=http.get(proxy+'/api/v1/deploys/'+ident,timeout=30);assert r.ok;d=r.json()
  if d['state']=='error':raise RuntimeError('Netlify build failed')
  if d['state']=='ready':
   assert d['context']==('branch-deploy' if branch else 'production')
   assert bool(d.get('published_at'))==bool(not branch)
   assert [x['n'] for x in d.get('available_functions',[])]==['calendar-reminder'] and d.get('function_schedules',[])==[]
   return d
  time.sleep(5)
 raise RuntimeError('Deployment status incomplete; inspect before retry')
def verify(base,label,prod=False):
 checks=[]
 def ck(name,ok):
  checks.append({'check':name,'passed':bool(ok)});save(label+'-http.json',checks)
  if not ok:raise AssertionError(name)
 s=session()
 for path,before in public.items():
  r=s.get(base+path,timeout=40)
  expected=before if prod or path not in ['/','/player-guide'] else before.replace(b'content="index,follow"',b'content="noindex,nofollow"')
  ck('Preserved public '+path,r.status_code==200 and r.content==expected)
 for path in ['/game.html','/wallet.js','/tester-guide','/season-status/garden-status.mjs','/season-status/model.mjs','/season-status/panel.css','/season-status/panel.html']:
  r=s.get(base+path,headers={'Accept':'application/json'},allow_redirects=False,timeout=30);ck('Anonymous blocked '+path,r.status_code in (401,403))
 r=s.post(base+'/tester-access',headers={'Origin':base},data={'password':packet['tester_password']},allow_redirects=False,timeout=30);ck('Existing tester login',r.status_code==303 and 'HttpOnly' in r.headers.get('set-cookie',''))
 for name,before in private.items():
  r=s.get(base+'/'+name,timeout=40);expected=expected_game if name=='game.html' else before
  ck('Only approved game additions '+name,r.status_code==200 and r.content==expected)
 for name in ['model.mjs','garden-status.mjs','panel.css']:
  r=s.get(base+'/season-status/'+name,timeout=30);ck('Exact protected asset '+name,r.status_code==200 and r.content==(ROOT/'season-status'/name).read_bytes())
  if name.endswith('mjs'):ck('JavaScript MIME '+name,'javascript' in r.headers.get('Content-Type',''))
 r=s.post(base+'/tester-logout',headers={'Origin':base},data={},allow_redirects=False,timeout=30);ck('Logout',r.status_code==303)
 r=s.get(base+'/season-status/model.mjs',headers={'Accept':'application/json'},allow_redirects=False,timeout=30);ck('New assets denied after logout',r.status_code in (401,403))
 stage(label+' real-script browser integration')
 env=dict(os.environ,SEASON_STATUS_URL=base,SEASON_STATUS_STAGE=label,SEASON_TESTER_PASSWORD=packet['tester_password'])
 run=subprocess.run([sys.executable,'scripts/check-season-status-hosted.py'],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=420)
 log=run.stdout+run.stderr
 for secret in [packet['tester_password'],proxy]:log=log.replace(secret.encode(),b'[REDACTED]')
 (OUT/(label+'-browser-log.txt')).write_bytes(log)
 ck('Hosted season browser integration',run.returncode==0)
 env=dict(os.environ,HANDBOOK_URL=base,HANDBOOK_STAGE='season-'+label,HANDBOOK_TESTER_PASSWORD=packet['tester_password'])
 run=subprocess.run([sys.executable,'scripts/check-public-player-guide-browser.py'],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=300)
 ck('Retained public guide and native login',run.returncode==0)
 retained=json.loads((ROOT/'handbook-results'/('season-'+label)/'browser.json').read_text());save(label+'-handbook.json',retained)
 report[label]={'http_checks':len(checks),'season_browser_checks':len(json.loads((OUT/label/'browser.json').read_text())),'handbook_browser_checks':len(retained)};save('release.json',report)
stage('Deploy non-production candidate')
p=deploy(source,'Approved My Garden season status — hosted verification','garden-season-status-20261001');report.update(preview_deploy=p['id'],preview_url=p['deploy_ssl_url']);save('release.json',report)
verify(p['deploy_ssl_url'],'preview')
stage('Check unchanged production before publication');check_main();verify_pinned_deploy()
for path,before in public.items():
 r=http.get(LIVE+path,timeout=40);assert r.status_code==200 and r.content==before
s=session();r=s.post(LIVE+'/tester-access',headers={'Origin':LIVE},data={'password':packet['tester_password']},allow_redirects=False,timeout=30);assert r.status_code==303
for name,before in private.items():
 r=s.get(LIVE+'/'+name,timeout=40);assert r.status_code==200 and r.content==before
s.post(LIVE+'/tester-logout',headers={'Origin':LIVE},data={},allow_redirects=False,timeout=30)
stage('Publish approved season-status update')
d=deploy(source,'Approved My Garden season status, countdown and rewards navigation');report.update(production_deploy=d['id'],published_at=d['published_at']);save('release.json',report)
try:
 verify(LIVE,'production',True);report['production_verified']=True;save('release.json',report);stage('Production verified')
except Exception as e:
 report['failure_after_publication']=type(e).__name__;save('release.json',report)
 try:
  restored=deploy(rollback,'Restore prior source after season-status verification failure');report['restored_deploy']=restored['id']
  r=http.get(LIVE+'/',timeout=40);report['restore_verified']=r.content==public['/']
 except Exception as r:report['restore_verified']=False
 save('release.json',report);raise
print(json.dumps(report,indent=2))
