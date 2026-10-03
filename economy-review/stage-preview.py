"""Stage a gated branch preview. Never certifies authenticated tester readiness.

Uses a run-bound encrypted Netlify capability; does not recover, reset, expose,
or bypass the write-only tester password. The full hosted-review.py path stays
unchanged and its positive-login/browser checks remain required separately.
"""
from pathlib import Path
import base64, io, json, os, subprocess, sys, time, urllib.parse, zipfile, traceback

SITE = 'a344fb31-10b4-4eea-9562-067d90a39607'
OLD = '6abe81174b61a8e3dd53b333'
BASE = '84b08fdb4bc0ec0417ced7be21f29aae914939f7'
BRANCH = 'partner-reconciliation-preview-20261003'
REPO = 'https://api.github.com/repos/TheCryptoArborist/arboretum'
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'economy-review-results' / 'hosted'
operation = 'initializing stage-only preview'

def require(ok, message):
    if not ok:
        raise ValueError(message)

def save(name, value):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(value, indent=2) + '\n')

def validate_delta(lines):
    for line in lines.splitlines():
        status, path = line.split('\t')
        require(status == 'A' and (path.startswith('economy-review/') or
                path == '.github/workflows/economy-accounting-review.yml'),
                'Source changed outside the additive review boundary')

def validate_packet(packet, source_sha):
    require(set(packet) == {'proxy_url', 'source_sha', 'confirmed_deploy_id',
                           'scope', 'expires_at'}, 'Unexpected capability fields')
    require(packet['scope'] == 'stage_gated_preview_only', 'Wrong capability scope')
    require(packet['source_sha'] == source_sha and packet['confirmed_deploy_id'] == OLD,
            'Capability is not bound to this source and production baseline')
    require(type(packet['expires_at']) is int and time.time() < packet['expires_at'] <= time.time() + 1800,
            'Capability expired or has an excessive lifetime')
    url = urllib.parse.urlsplit(packet['proxy_url'])
    require(url.scheme == 'https' and url.hostname in {
        'netlify-mcp.netlify.app', 'mcp.netlify.com', 'netlify-mcp.netlify.com'} and
        url.path.startswith('/proxy/') and len(url.path) > 20 and
        not any((url.query, url.fragment, url.username, url.password, url.port)),
        'Invalid capability endpoint')
    return packet['proxy_url'].rstrip('/')

def include_source(name):
    parts = Path(name).parts
    return (not name.startswith(('.git', '.env', 'docs/')) and
            'hosted-envelope.json' not in parts and not any(p.endswith('-results') for p in parts))

def preview_config(data):
    anchor = b' && node scripts/build-season-status.mjs"'
    require(data.count(anchor) == 1, 'Unexpected build command; refusing to patch')
    return data.replace(anchor, b' && node scripts/build-season-status.mjs && node economy-review/build-admin-preview.mjs"')

def main():
    import requests
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    global operation
    run, attempt, source = os.environ['GITHUB_RUN_ID'], os.environ.get('GITHUB_RUN_ATTEMPT', '1'), os.environ['GITHUB_SHA']
    require(os.environ.get('GITHUB_EVENT_NAME') == 'push', 'Staging requires a reviewed branch push')
    require(os.environ.get('GITHUB_REF') == 'refs/heads/feature/economy-accounting-review', 'Wrong review branch')
    git = lambda *a: subprocess.check_output(['git', *a], cwd=ROOT)
    require(git('rev-parse', 'HEAD').decode().strip() == source, 'Source SHA mismatch')
    validate_delta(git('diff', '--name-status', BASE, 'HEAD').decode())
    gh = requests.Session()
    gh.headers.update({'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'Accept': 'application/vnd.github+json'})
    def github_json(path):
        r = gh.get(REPO + path, timeout=30)
        require(r.ok, 'GitHub read failed')
        return r.json()
    require(github_json('/git/ref/heads/main')['object']['sha'] == BASE, 'Main baseline changed')
    operation = 'waiting for encrypted stage-only capability'
    key_path = Path(os.environ['RUNNER_TEMP']) / 'partner-preview-key.pem'
    key = serialization.load_pem_private_key(key_path.read_bytes(), None)
    packet = None
    try:
        for _ in range(100):
            r = gh.get(REPO + '/contents/economy-review/hosted-envelope.json?ref=feature/economy-accounting-review', timeout=20)
            if r.ok:
                envelope = json.loads(base64.b64decode(r.json()['content']))
                if envelope.get('run_id') == run and envelope.get('attempt') == attempt:
                    aes = key.decrypt(base64.b64decode(envelope['wrapped_key']), padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
                    packet = json.loads(AESGCM(aes).decrypt(base64.b64decode(envelope['nonce']), base64.b64decode(envelope['ciphertext']), (run + ':' + attempt).encode()))
                    break
            time.sleep(5)
    finally:
        key_path.unlink(missing_ok=True)
    require(packet is not None, 'No run-bound deployment capability received')
    proxy = validate_packet(packet, source)
    def netlify_json(path):
        r = requests.get(proxy + '/api/v1' + path, timeout=30, allow_redirects=False)
        require(r.ok and not r.is_redirect, 'Netlify read failed')
        return r.json()
    def assert_production():
        site = netlify_json('/sites/' + SITE)
        require(site['id'] == SITE and site.get('published_deploy', {}).get('id') == OLD, 'Published production baseline changed')
        require(BRANCH != site.get('build_settings', {}).get('repo_branch', 'main') and BRANCH != 'main', 'Production branch forbidden')
        return site
    operation = 'checking production and source preservation'
    assert_production()
    old = netlify_json('/deploys/' + OLD)
    require(old['site_id'] == SITE and old['context'] == 'production' and old['state'] == 'ready', 'Invalid pinned production deploy')
    expected_functions = sorted(x['n'] for x in old.get('available_functions', []))
    require(expected_functions == ['calendar-reminder'] and not old.get('function_schedules'), 'Unexpected backend inventory')
    baseline_files = netlify_json('/sites/' + SITE + '/files')
    require(isinstance(baseline_files, list) and baseline_files, 'Production file inventory unavailable')
    manifest = lambda rows: sorted((x['path'], x['sha'], x['size']) for x in rows)
    before = manifest(baseline_files)
    save('stage-baseline.json', {'production_deploy': OLD, 'main': BASE, 'files': before})
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        for name in git('ls-tree', '-r', '--name-only', 'HEAD').decode().splitlines():
            if not include_source(name):
                continue
            data = git('show', 'HEAD:' + name)
            z.writestr(name, preview_config(data) if name == 'netlify.toml' else data)
    operation = 'submitting isolated branch build'
    assert_production()
    r = requests.post(proxy + '/api/v1/sites/' + SITE + '/builds?' + urllib.parse.urlencode({'branch': BRANCH, 'title': 'Gated reconciliation preview - authenticated review pending'}), files={'zip': ('source.zip', archive.getvalue(), 'application/zip')}, timeout=(15, 120), allow_redirects=False)
    require(r.ok and not r.is_redirect, 'Branch build request failed; do not blindly repeat an ambiguous request')
    created = r.json(); created = created[0] if isinstance(created, list) else created
    deploy_id = created['deploy_id']
    record = {'deploy_id': deploy_id, 'source_sha': source, 'branch': BRANCH,
              'verification_complete': False, 'tester_ready': False,
              'authenticated_review': 'pending_existing_tester_code', 'transactionsSubmitted': 0}
    save('staged-deployment.json', record)
    operation = 'waiting for branch build'
    for _ in range(120):
        d = netlify_json('/deploys/' + deploy_id)
        require(d['state'] != 'error', 'Branch build failed')
        if d['state'] == 'ready':
            break
        time.sleep(5)
    require(d['state'] == 'ready' and d['site_id'] == SITE and d['context'] == 'branch-deploy' and not d.get('published_at'), 'Deploy is not an unpublished branch preview')
    require(sorted(x['n'] for x in d.get('available_functions', [])) == expected_functions and not d.get('function_schedules'), 'Preview backend inventory changed')
    preview = 'https://' + deploy_id + '--arboretum-sui-forest.netlify.app'
    record.update({'preview_url': preview + '/tester-access', 'context': d['context'], 'status': 'STAGED_AWAITING_AUTHENTICATED_REVIEW'})
    save('staged-deployment.json', record)
    operation = 'checking public gate only - no authentication bypass'
    checks = []
    def check(name, ok):
        checks.append({'check': name, 'passed': bool(ok)})
        save('stage-http-checks.json', checks)
        require(ok, 'Public gate check failed')
    s = requests.Session()
    for path in ['/game.html', '/wallet.js', '/economy-review/partner-panel.mjs', '/economy-review/partner-reconciliation-panel.mjs']:
        r = s.get(preview + path, headers={'Accept': 'application/json'}, allow_redirects=False, timeout=30)
        check('Anonymous access blocked: ' + path, r.status_code in [401, 403])
    r = s.get(preview + '/tester-access', timeout=30)
    check('Configured tester entrance served', r.status_code == 200 and 'name="password"' in r.text and 'not been activated' not in r.text)
    r = s.post(preview + '/tester-access', headers={'Origin': preview}, data={'password': 'invalid-tester-code'}, allow_redirects=False, timeout=30)
    check('Invalid tester code rejected', r.status_code == 401)
    operation = 'checking production remains unchanged'
    assert_production()
    check('Production file inventory unchanged', before == manifest(netlify_json('/sites/' + SITE + '/files')))
    check('Main unchanged', github_json('/git/ref/heads/main')['object']['sha'] == BASE)
    record.update({'production_unchanged': True, 'public_gate_checks_passed': len(checks),
                   'pending': ['Genuine tester login and logout', 'Authenticated hosted-module integrity', 'Updated reconciliation UI and wallet checks'],
                   'full_hosted_verification_replaced': False})
    save('staged-deployment.json', record)
    print('Gated preview staged; authenticated review is PENDING:', record['preview_url'])

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        save('stage-failure.json', {'operation': operation, 'type': type(e).__name__,
             'frames': [{'file': Path(f.filename).name, 'line': f.lineno} for f in traceback.extract_tb(e.__traceback__)][-7:]})
        print('Stage-only preview stopped; see sanitized stage-failure.json. No readiness approval.', file=sys.stderr)
        sys.exit(1)
