#!/usr/bin/env python3
"""Public read-only HTTP/GraphQL evidence. No mutations, simulations or transactions."""
import hashlib,json,re
from pathlib import Path
from urllib.request import Request,urlopen
OUT=Path('step2-results/evidence');OUT.mkdir(parents=True,exist_ok=True)
package='0xdfcde7bc9271a7952dcb1c4ddd199c7d526bb286e09c6d1f528fec8e1ecf6724'
query='query($a:SuiAddress!){object(address:$a){address asMovePackage{module(name:"arboretum"){name disassembly}}}}'
req=Request('https://graphql.mainnet.sui.io/graphql',data=json.dumps({'query':query,'variables':{'a':package}}).encode(),headers={'Content-Type':'application/json','User-Agent':'Arboretum-isolated-source-check'})
with urlopen(req,timeout=30) as response:obj=json.load(response)
assert not obj.get('errors'), obj.get('errors')
assembly=obj['data']['object']['asMovePackage']['module']['disassembly']
a=assembly.index('entry open_crate(');b=assembly.index('\nroll_common(',a)
body=assembly[a:b]
sha=hashlib.sha256(body.encode()).hexdigest()
assert sha=='f602180c86c7acb2e9a00662b9cc04f75e96bc779b5e03b354031c847fda49ca', 'Deployed open_crate evidence changed; reconcile before proceeding'
# Check constant meanings too; the function body uses numeric constant slots.
expected={64:'growth_tonic',66:'mulch',67:'rain_barrel',69:'sunstone',70:'revival_kit',71:'double_dose',72:'drought_shield',73:'ancient_bark',76:'bottomless_can',80:'forest_heart'}
for i,label in expected.items():assert f'{i} => vector<u8>: "{label}"' in assembly
(OUT/'deployed-module.json').write_text(json.dumps(obj,indent=2))
(OUT/'deployed-open-crate.asm').write_text(body)
summary={'package':package,'open_crate_sha256':sha,'matches_september19_read':True,
 'basis':'Instruction-level review of open_crate branches 334-424 and resolved constant table; not frontend descriptions',
 'boom':{'guaranteed':[['ancient_bark',1],['sunstone',1],['double_dose',2]],'fourth_item':{'roll_0_to_9':['forest_heart',1],'roll_10_to_99':['growth_tonic',2]}},
 'victory':{'guaranteed':[['drought_shield',2],['rain_barrel',2],['mulch',2]],'fourth_item':{'roll_0_to_24':['bottomless_can',1],'roll_25_to_99':['revival_kit',1]}},
 'limitation':'This proves the immutable observed function and reviewed constant meanings, not whole-package source equivalence or live gameplay balance.'}
(OUT/'partner-tables.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
