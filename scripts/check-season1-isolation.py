#!/usr/bin/env python3
"""Local VM/compiler checks only. Never sign, publish, or run a client transaction."""
from pathlib import Path
import hashlib,json,re,runpy,shutil,subprocess
ROOT=Path(__file__).resolve().parents[1]
ns=runpy.run_path(str(ROOT/'scripts/prepare-season1-isolation.py'))
OUT=ns['OUT']; RESULTS=ns['RESULTS']; src=ns['src']

# Keep same-named canonical/fake/legacy test stand-ins in separate packages.
# These dependencies are removed before the production build.
fixture_text=(ns['AREA']/'fixtures.move').read_text()
fixtures=[]
for alias,pkg,addr in [('canonical_fixture','CanonicalFixture','0xf6c6d439ea0da2f3e9ba79e4992a7a4c113215fbf54c442ac9020c315f953705'),('fake_fixture','CounterfeitFixture','0xbad'),('legacy_fixture','LegacyFixture','0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b')]:
 a=fixture_text.index('module '+alias+'::');brace=fixture_text.index('{',a);depth=0
 for i in range(brace,len(fixture_text)):
  if fixture_text[i]=='{':depth+=1
  elif fixture_text[i]=='}':depth-=1
  if depth==0:b=i+1;break
 d=ns['AREA']/'test-fixture-packages'/pkg
 (d/'sources').mkdir(parents=True,exist_ok=True)
 (d/'sources/fixture.move').write_text(fixture_text[a:b]+'\n')
 (d/'Move.toml').write_text(f'''[package]
name = "{pkg}"
edition = "2024.beta"
[dependencies]
Sui = {{ git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "58386edc269ef88ff0f40ab0a9d50e87cba80ca8" }}
[addresses]
{alias} = "{addr}"
''')
 fixtures.append((pkg,d))

def test_manifest(dest,name):
 manifest=ns['manifest'].replace('arboretum_season1_isolated',name)
 deps=''.join(f'{pkg} = {{ local = "{d.as_posix()}" }}\n' for pkg,d in fixtures)
 (dest/'Move.toml').write_text(manifest.replace('[dependencies]\n','[dependencies]\n'+deps))
 (dest/'tests/fixtures.move').unlink(missing_ok=True)

def run(args,name,success=True):
 p=subprocess.run(args,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=480)
 text=p.stdout
 if 'secret recovery phrase' in text.lower() or 'Generated new keypair' in text:
  raise RuntimeError('Unexpected signing material generated; do not upload logs')
 (RESULTS/(name+'.txt')).write_text(text)
 if success and p.returncode!=0:
  print(text[-14000:]);raise SystemExit(name+' failed')
 return p

test_manifest(OUT,'arboretum_season1_isolated')
p=run(['sui','move','test','--build-env','mainnet','--path',str(OUT)],'move-tests')
m=re.search(r'Total tests:\s*(\d+);\s*passed:\s*(\d+);\s*failed:\s*(\d+)',p.stdout)
assert m and int(m[3])==0 and int(m[1])==40+ns['report']['new_test_count'], 'Missing exact expected test total'
negative=[]
for kind in ['Tool','Crate','Seed','Registry']:
 dest=ns['AREA']/('negative-'+kind.lower())
 (dest/'sources').mkdir(parents=True,exist_ok=True);(dest/'tests').mkdir(exist_ok=True)
 test_manifest(dest,'negative_legacy_'+kind.lower())
 (dest/'sources/arboretum.move').write_text(src)
 attack=f'''#[test_only]
module season1::legacy_attack {{
    public fun attempt(value: &legacy_fixture::arboretum::{kind}) {{
        season1::arboretum::step2_type_{kind.lower()}(value);
    }}
}}
'''
 (dest/'tests/attack.move').write_text(attack)
 p=run(['sui','move','test','--build-env','mainnet','--path',str(dest)],'reject-legacy-'+kind.lower(),False)
 assert p.returncode!=0 and re.search(r'E(?:C)?04007',p.stdout) and 'tests/attack.move' in p.stdout and 'Invalid call' in p.stdout, p.stdout[-9000:]
 negative.append({'case':'legacy '+kind,'rejected':True,'layer':'Move type checker','diagnostic':'incompatible types'})
dest=ns['AREA']/'negative-borrowed-nft'
(dest/'sources').mkdir(parents=True,exist_ok=True);(dest/'tests').mkdir(exist_ok=True)
test_manifest(dest,'negative_borrowed_nft')
attack='''
    #[test_only]
    fun attack_borrowed_nft(registry: &mut Registry, nft: &canonical_fixture::collection::NFT,
        payment: Coin<SUI>, clock: &Clock, ctx: &mut TxContext) {
        plant_seed_with_nftree(registry, nft, payment, option::none(), clock, ctx);
    }
'''
(dest/'sources/arboretum.move').write_text(src.rstrip()[:-1]+attack+'\n}\n')
p=run(['sui','move','test','--build-env','mainnet','--path',str(dest)],'reject-borrowed-nft',False)
assert p.returncode!=0 and re.search(r'E(?:C)?05001',p.stdout) and re.search(r'E(?:C)?04004',p.stdout) and 'attack_borrowed_nft' in p.stdout and 'plant_seed_with_nftree(registry, nft' in p.stdout, p.stdout[-9000:]
negative.append({'case':'borrowed NFT proof','rejected':True,'layer':'Move type/ability checker','diagnostics':['ability constraint not satisfied','expected a single non-reference type']})
# No fake collection/legacy modules or dependencies in the production build.
(OUT/'Move.toml').write_text(ns['manifest'])
shutil.rmtree(OUT/'build',ignore_errors=True)
run(['sui','move','build','--build-env','mainnet','--path',str(OUT)],'production-build')
module_files=list((OUT/'build').glob('*/bytecode_modules/*.mv'))
assert len(module_files)==1 and module_files[0].name=='arboretum.mv', [str(x) for x in module_files]
assert not any(label in (OUT/'Move.toml').read_text() for label in ['CanonicalFixture','CounterfeitFixture','LegacyFixture'])
keystore=Path.home()/'.sui/sui_config/empty.keystore'
assert json.loads(keystore.read_text())==[], 'Tests must not create signing keys'
report={'passed':int(m[2]),'failed':0,'step1_regressions_retained':40,'isolation_tests':int(m[1])-40,
 'negative_compile_checks':negative,'non_test_build_passed':True,'production_modules':[x.name for x in module_files],
 'fixture_dependencies_in_production':False,'empty_keystore':True,'execution':'Local Sui Move VM and compiler only; no chain transaction',
 'candidate_sha256':hashlib.sha256(src.encode()).hexdigest(),'mainnet_publish':False,'live_mitigation':False}
(RESULTS/'verification.json').write_text(json.dumps(report,indent=2)+'\n')
(RESULTS/'candidate-arboretum.move').write_text(src)
(RESULTS/'Move.toml').write_text(ns['manifest'])
print(json.dumps(report,indent=2))
