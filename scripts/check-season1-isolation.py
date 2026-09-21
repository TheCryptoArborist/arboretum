#!/usr/bin/env python3
"""Local VM/compiler checks only. Never sign, publish, or run a client transaction."""
from pathlib import Path
import hashlib,json,os,re,runpy,shutil,subprocess
ROOT=Path(__file__).resolve().parents[1]
ns=runpy.run_path(str(ROOT/'scripts/prepare-season1-isolation.py'))
OUT=ns['OUT']; RESULTS=ns['RESULTS']; src=ns['src']

def run(args,name,success=True):
 p=subprocess.run(args,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=480)
 text=p.stdout
 if 'secret recovery phrase' in text.lower() or 'Generated new keypair' in text:
  raise RuntimeError('Unexpected signing material generated; do not upload logs')
 (RESULTS/(name+'.txt')).write_text(text)
 if success and p.returncode!=0:
  print(text[-14000:]);raise SystemExit(name+' failed')
 return p

# Keep Step 1 evidence intact; this suite additionally tests its integrated form.
p=run(['sui','move','test','--build-env','mainnet','--path',str(OUT)],'move-tests')
m=re.search(r'Total tests:\s*(\d+);\s*passed:\s*(\d+);\s*failed:\s*(\d+)',p.stdout)
assert m and int(m[3])==0 and int(m[1])==40+ns['report']['new_test_count'], 'Missing exact expected test total'
negative=[]
for kind in ['Tool','Crate','Seed','Registry']:
 dest=ns['AREA']/('negative-'+kind.lower())
 (dest/'sources').mkdir(parents=True,exist_ok=True);(dest/'tests').mkdir(exist_ok=True)
 (dest/'Move.toml').write_text(ns['manifest'].replace('arboretum_season1_isolated','negative_legacy_'+kind.lower()))
 (dest/'sources/arboretum.move').write_text(src)
 (dest/'tests/fixtures.move').write_text((ns['AREA']/'fixtures.move').read_text())
 attack=f'''#[test_only]
module season1::legacy_attack {{
    public fun attempt(value: &legacy_fixture::arboretum::{kind}) {{
        season1::arboretum::step2_type_{kind.lower()}(value);
    }}
}}
'''
 (dest/'tests/attack.move').write_text(attack)
 p=run(['sui','move','test','--build-env','mainnet','--path',str(dest)],'reject-legacy-'+kind.lower(),False)
 text=p.stdout
 # E04007 is Move's incompatible-types diagnostic. A generic build failure
 # must never be reported as successful legacy isolation.
 assert p.returncode!=0 and 'E04007' in text and 'legacy_attack' in text, text[-9000:]
 negative.append({'case':'legacy '+kind,'rejected':True,'layer':'Move type checker','diagnostic':'E04007'})
# Borrowed canonical NFT cannot satisfy a by-value owned-input entry signature.
dest=ns['AREA']/'negative-borrowed-nft'
(dest/'sources').mkdir(parents=True,exist_ok=True);(dest/'tests').mkdir(exist_ok=True)
(dest/'Move.toml').write_text(ns['manifest'].replace('arboretum_season1_isolated','negative_borrowed_nft'))
attack='''
    #[test_only]
    fun attack_borrowed_nft(registry: &mut Registry, nft: &canonical_fixture::collection::NFT,
        payment: Coin<SUI>, clock: &Clock, ctx: &mut TxContext) {
        plant_seed_with_nftree(registry, nft, payment, option::none(), clock, ctx);
    }
'''
(dest/'sources/arboretum.move').write_text(src.rstrip()[:-1]+attack+'\n}\n')
(dest/'tests/fixtures.move').write_text((ns['AREA']/'fixtures.move').read_text())
p=run(['sui','move','test','--build-env','mainnet','--path',str(dest)],'reject-borrowed-nft',False)
assert p.returncode!=0 and ('E04007' in p.stdout or 'E02004' in p.stdout or 'E04010' in p.stdout) and 'attack_borrowed_nft' in p.stdout, p.stdout[-9000:]
negative.append({'case':'borrowed NFT proof','rejected':True,'layer':'Move type/ability checker'})
# Rebuild without tests in a clean build directory. No fixture module may
# appear among the production modules of this package.
shutil.rmtree(OUT/'build',ignore_errors=True)
run(['sui','move','build','--build-env','mainnet','--path',str(OUT)],'production-build')
module_files=list((OUT/'build').glob('*/bytecode_modules/*.mv'))
assert len(module_files)==1 and module_files[0].name=='arboretum.mv', [str(x) for x in module_files]
keystore=Path.home()/'.sui/sui_config/empty.keystore'
assert json.loads(keystore.read_text())==[], 'Tests must not create signing keys'
report={'passed':int(m[2]),'failed':0,'step1_regressions_retained':40,'isolation_tests':int(m[1])-40,
 'negative_compile_checks':negative,'non_test_build_passed':True,'production_modules':[x.name for x in module_files],
 'empty_keystore':True,'execution':'Local Sui Move VM and compiler only; no chain transaction',
 'candidate_sha256':hashlib.sha256(src.encode()).hexdigest(),'mainnet_publish':False,'live_mitigation':False}
(RESULTS/'verification.json').write_text(json.dumps(report,indent=2)+'\n')
(RESULTS/'candidate-arboretum.move').write_text(src)
(RESULTS/'Move.toml').write_text(ns['manifest'])
print(json.dumps(report,indent=2))
