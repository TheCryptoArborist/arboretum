"""Opt-in Garden UX configuration for the existing gated staging runner.
Only the review branch name and ZIP build command differ. The production,
source, API-scope, ephemeral capability, and tester-gate checks stay intact.
This is staging, never tester-readiness approval.
"""
from pathlib import Path
import hashlib, importlib.util, json, sys, traceback

ROOT=Path(__file__).resolve().parents[1]
SPEC=importlib.util.spec_from_file_location('garden_stage',Path(__file__).with_name('stage-preview.py'))
stage=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(stage)
BRANCH='garden-ux-preview-20261003'

def configure(target):
    original=target.preview_config
    def garden_config(data):
        base=original(data)
        anchor=b' && node economy-review/build-admin-preview.mjs"'
        target.require(base.count(anchor)==1,'Unexpected partner review build command')
        return base.replace(anchor,b' && node economy-review/build-admin-preview.mjs && node economy-review/build-garden-ux-preview.mjs"')
    target.BRANCH=BRANCH
    target.preview_config=garden_config

def run():
    # The stage cannot be used as a shortcut around this build's browser tests.
    report=json.loads((ROOT/'economy-review-results/garden-ux/summary.json').read_text())
    stage.require(report['failed']==0 and report['checked']>=180 and not report['blockedWrites'], 'Garden UX browser review must pass first')
    stage.require(report['transactionsSubmitted']==0 and report['realWalletsConnected']==0, 'Unexpected test effects')
    build=json.loads((ROOT/'economy-review-results/garden-ux-build.json').read_text())
    stage.require(hashlib.sha256((ROOT/'dist/game.html').read_bytes()).hexdigest()==build['gameSha256'], 'Reviewed build changed before staging')
    configure(stage)
    stage.main()
    record=json.loads((stage.OUT/'staged-deployment.json').read_text())
    stage.require(record['branch']==BRANCH and record['tester_ready'] is False, 'Wrong stage record')
    # These reads are deliberately anonymous. No tester secret or session bypass.
    import requests
    from urllib.parse import urlsplit
    u=urlsplit(record['preview_url']);origin=u.scheme+'://'+u.netloc
    checks=[]
    for path in ['/economy-review/garden-ux.mjs','/economy-review/garden-ux-model.mjs','/economy-review/garden-ux.css']:
        r=requests.get(origin+path,headers={'Accept':'application/json'},allow_redirects=False,timeout=30)
        ok=r.status_code in [401,403]
        checks.append({'path':path,'status':r.status_code,'anonymous_access_blocked':ok})
        stage.save('garden-stage-gate-checks.json',checks)
        stage.require(ok,'Garden asset must remain behind the tester gate')
    record.update({'garden_ux':True,'review_build':build,'additional_garden_gate_checks':len(checks),
                   'authenticated_garden_owner_review':'pending','tester_ready':False})
    stage.save('staged-deployment.json',record)
    print('Garden UX staged for owner review; no Telegram readiness approval.')

if __name__=='__main__':
    try:run()
    except Exception as e:
        stage.save('garden-stage-failure.json',{'operation':stage.operation,'type':type(e).__name__,
            'frames':[{'file':Path(f.filename).name,'line':f.lineno} for f in traceback.extract_tb(e.__traceback__)][-7:]})
        print('Garden review staging stopped. See sanitized failure record.',file=sys.stderr)
        sys.exit(1)
