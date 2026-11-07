"""Publish the Season 1 owner claim review and verify its exact deployment.

Uses the existing authorized Netlify account internally. Never prints credentials.
The only remote mutation is one journaled source-build submission to the fixed site.
It cannot connect a wallet or submit blockchain transactions.
"""
from pathlib import Path
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SITE = 'd425445d-4980-49be-8ab2-12e7527ba281'
ORIGINAL = 'a344fb31-10b4-4eea-9562-067d90a39607'
OLD = '6ae678179e4a049e68a01cae'
ORIGINAL_DEPLOY = '6abe81174b61a8e3dd53b333'
ORIGIN = 'https://www.treegrow.xyz'
API = 'https://api.netlify.com/api/v1'
FUNCTION_DIGEST = 'e11353817de886625c0f037e5b341f1506b51b3477a227281527bd9bf496de98'
NEW = ['admin/claim-test/index.html', 'admin/claim-test/admin.css', 'admin/claim-test/admin.mjs']
NAVIGATION_ADDITIONS = {
    'admin/gameplay-test/index.html': (
        '      <p class="small-text"><a class="back-link" href="/admin/claim-test/">'
        'Review your Season 1 reward and claim window <span aria-hidden="true">→</span></a></p>\n').encode(),
    'admin/watering-test/index.html': (
        '        <p class="small-text"><a class="back-link" href="/admin/claim-test/">'
        'Season finished? Review your reward and claim window <span aria-hidden="true">→</span></a></p>\n').encode(),
}
CHANGED = set(NAVIGATION_ADDITIONS)
BASELINE = ROOT / 'settlement-watering/verification/hosted/hosted-assets.json'

if not __debug__:
    raise RuntimeError('Release safety checks require Python without optimization.')


def now():
    return datetime.now(timezone.utc).isoformat()


def sha(data, algorithm='sha256'):
    return hashlib.new(algorithm, data).hexdigest()


def save(folder, name, value, exclusive=False):
    data = (json.dumps(value, indent=2) + '\n').encode()
    if exclusive:
        with (folder / name).open('xb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
    else:
        with tempfile.NamedTemporaryFile(dir=folder, prefix=name + '.', delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, folder / name)
    directory = os.open(folder, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def authorized_request(path, data=None, headers=None, method='GET'):
    assert path.startswith(('/sites/', '/deploys/')) and '://' not in path
    assert method in ('GET', 'POST')
    if method == 'POST':
        assert path.startswith('/sites/' + SITE + '/builds?')
    cfg = json.loads((Path.home() / '.config/netlify/config.json').read_text())
    token = cfg['users'][cfg['userId']]['auth']['token']
    request_headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/json'}
    request_headers.update(headers or {})
    request = urllib.request.Request(API + path, data=data, headers=request_headers, method=method)
    # Never forward the account bearer token to a redirect destination.
    with urllib.request.build_opener(NoRedirect).open(request, timeout=45) as response:
        raw = response.read()
        return raw, response.status


def api(path):
    raw, code = authorized_request(path)
    assert code == 200
    return json.loads(raw)


def deploy_summary(value):
    return {key: value.get(key) for key in ['id', 'site_id', 'build_id', 'state', 'context',
        'title', 'created_at', 'published_at', 'error_message', 'deploy_source', 'has_source_zip',
        'edge_functions_present', 'function_schedules']}


def backend_snapshot(expected_deploy):
    site = api('/sites/' + SITE)
    assert site['id'] == SITE and site['name'] == 'arboretum-preview'
    assert site['custom_domain'] == 'www.treegrow.xyz'
    assert site['published_deploy']['id'] == expected_deploy, 'Published deploy changed'
    settings = site.get('build_settings') or {}
    assert not settings.get('repo_url') and not settings.get('repo_path') and not settings.get('provider'), 'Git CD was reconnected'
    deploy = api('/deploys/' + expected_deploy)
    assert deploy['site_id'] == SITE and deploy['state'] == 'ready'
    assert deploy['context'] == 'production' and deploy.get('published_at')
    assert deploy.get('function_schedules') == []
    assert sorted(item['n'] for item in deploy['available_functions']) == ['calendar-reminder']
    assert deploy['available_functions'][0]['d'] == FUNCTION_DIGEST
    function = deploy['available_functions'][0]
    function_fields = {key: function.get(key) for key in ['n', 'd', 'r', 'm', 'rg', 's', 'p', 'bd']}
    assert function_fields == {'n': 'calendar-reminder', 'd': FUNCTION_DIGEST,
        'r': 'nodejs24.x', 'm': 1024, 'rg': 'us-east-2', 's': 279384,
        'p': 10, 'bd': {'runtimeAPIVersion': 1}}, 'Calendar bundle or runtime configuration changed'
    original = api('/sites/' + ORIGINAL)
    assert original['published_deploy']['id'] == ORIGINAL_DEPLOY
    # The deployed internal manifest establishes the actual edge function names.
    raw, _ = authorized_request('/deploys/' + expected_deploy + '/files/.netlify/internal/edge-functions/manifest.json',
        headers={'Content-Type': 'application/vnd.bitballoon.v1.raw'})
    manifest = json.loads(raw)
    routes = manifest.get('routes', [])
    edge_names = sorted({item['function'] for item in routes})
    assert edge_names == ['public-player-guide', 'tester-gate'], 'Edge function inventory changed'
    return {'checkedAt': now(), 'siteId': SITE, 'siteName': site['name'], 'domain': site['custom_domain'],
        'publishedDeployId': expected_deploy, 'deployment': deploy_summary(deploy),
        'gitContinuousDeploymentConnected': False, 'edgeFunctionNames': edge_names,
        'calendarFunction': function_fields,
        'calendarBundleDigest': FUNCTION_DIGEST, 'functionSchedules': [],
        'retainedOriginalDeployId': ORIGINAL_DEPLOY, 'credentialsPrinted': False}


def baseline_record():
    baseline = json.loads(BASELINE.read_text())
    assert baseline['siteId'] == SITE and baseline['publishedDeployId'] == OLD
    paths = [item['path'] for item in baseline['completePublishedInventory']]
    assert len(paths) == len(set(paths)) == 100, 'Unexpected recorded watering baseline'
    assert CHANGED <= set(paths) and not set(NEW) & set(paths)
    return baseline


def preflight():
    backend = backend_snapshot(OLD)
    baseline = baseline_record()
    inventory = api('/deploys/' + OLD + '/files')
    indexed = {item['path'].lstrip('/'): item for item in inventory}
    assert len(indexed) == len(inventory), 'Duplicate deploy file path'
    for old in baseline['completePublishedInventory']:
        item = indexed.pop(old.get('deployedPath', old['path']))
        assert item['sha'] == old['sha1'] and item['size'] == old['bytes'], old['path']
    assert 'netlify.toml' in indexed
    indexed.pop('netlify.toml')
    assert len(indexed) == 3 and all(name.startswith('.netlify/internal/edge-functions/') for name in indexed)
    return {**backend, 'baselineApplicationInventoryMatches': True,
        'existingApplicationFileCount': 100,
        'baselineSourceCommit': baseline['sourceUpload']['sourceCommit']}


def application_inventory():
    dist = ROOT / 'dist'
    files = [file for file in dist.rglob('*') if file.is_file()]
    assert files and all(not file.is_symlink() for file in files), 'Build output must contain regular files'
    return [{'path': str(file.relative_to(dist)), 'sha1': sha(file.read_bytes(), 'sha1'),
        'sha256': sha(file.read_bytes()), 'bytes': file.stat().st_size} for file in sorted(files)]


def preservation():
    baseline = baseline_record()
    old_paths = {item['path'] for item in baseline['completePublishedInventory']}
    current_paths = {str(p.relative_to(ROOT / 'dist')) for p in (ROOT / 'dist').rglob('*') if p.is_file()}
    assert current_paths == old_paths | set(NEW), 'Unexpected application file inventory'
    recorded_sha256 = {item['path']: item['sha256'] for item in baseline['rawDeployedAssets']}
    for item in baseline['completePublishedInventory']:
        data = (ROOT / 'dist' / item['path']).read_bytes()
        if item['path'] in CHANGED:
            addition = NAVIGATION_ADDITIONS[item['path']]
            assert data.count(addition) == 1, 'Expected one exact claim navigation addition: ' + item['path']
            data = data.replace(addition, b'', 1)
        assert sha(data, 'sha1') == item['sha1'] and len(data) == item['bytes'], item['path']
        if item['path'] in recorded_sha256:
            assert sha(data) == recorded_sha256[item['path']], item['path']
    assert all((ROOT / 'dist' / name).stat().st_size > 0 for name in NEW)
    return {'existingApplicationFilesPreserved': len(old_paths - CHANGED),
        'changedApplicationFiles': sorted(CHANGED), 'navigationOnlyChangesVerified': True,
        'addedRuntimeFiles': NEW,
        'completeApplicationFileCount': len(current_paths)}


def assert_no_pending_submission(title):
    recent = api('/sites/' + SITE + '/deploys?per_page=30')
    assert isinstance(recent, list)
    assert not any(item.get('title') == title for item in recent), \
        'A deploy for this source is already recorded; recover its existing deployment instead of resubmitting'
    pending = [item['id'] for item in recent if item.get('state') not in ('ready', 'error', 'skipped', 'rejected', 'canceled')]
    assert not pending, 'A deployment is still pending; inspect it before any new submission: ' + ', '.join(pending)


def saved_submission(folder):
    submission = json.loads((folder / 'submission.json').read_text())
    assert submission['siteId'] == SITE and submission['previousPublishedDeployId'] == OLD
    assert submission['originalPublishedDeployId'] == ORIGINAL_DEPLOY
    assert submission['submissionAttempted'] is True
    assert re.fullmatch(r'[0-9a-f]{40}', submission['sourceCommit'])
    assert submission.get('responseReceived') is True and re.fullmatch(r'[0-9a-f]{24}', submission.get('deployId', '')), \
        'Submission outcome is unknown; recover the existing deploy instead of submitting again'
    return submission


def submit(folder, commit):
    assert len(commit or '') == 40 and all(c in '0123456789abcdef' for c in commit)
    assert not folder.resolve().is_relative_to(ROOT), 'Keep the persistent release journal outside the source checkout'
    assert not (folder / 'submission.json').exists(), 'Submission already journaled; inspect it instead of repeating'
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip() == commit
    assert subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT).strip() == b'', 'Save source before publication'
    prior = preflight()
    saved = preservation()
    title = 'Add Season 1 owner reward claim · ' + commit[:12]
    assert_no_pending_submission(title)
    save(folder, 'preflight-before-submit.json', {**prior, **saved}, exclusive=True)
    candidate = {'sourceCommit': commit,
        'sourceTree': subprocess.check_output(['git', 'rev-parse', commit + '^{tree}'], cwd=ROOT).decode().strip(),
        'applicationFiles': application_inventory(),
        'sourceConfigSha256': sha((ROOT / 'netlify.toml').read_bytes())}
    save(folder, 'candidate.json', candidate, exclusive=True)
    archive = subprocess.check_output(['git', 'archive', '--format=zip', commit], cwd=ROOT)
    with (folder / 'source.zip').open('xb') as stream:
        stream.write(archive)
        stream.flush()
        os.fsync(stream.fileno())
    assert api('/sites/' + SITE)['published_deploy']['id'] == OLD, 'Published deploy changed before submission'
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip() == commit
    assert subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT).strip() == b'', 'Source changed before publication'
    assert application_inventory() == candidate['applicationFiles'], 'Build output changed before submission'
    record = {'siteId': SITE, 'sourceCommit': commit, 'sourceTree': candidate['sourceTree'],
        'candidateEvidenceSha256': sha((folder / 'candidate.json').read_bytes()), 'archiveSha256': sha(archive),
        'archiveBytes': len(archive), 'requestedAt': now(), 'previousPublishedDeployId': OLD,
        'originalPublishedDeployId': ORIGINAL_DEPLOY, 'submissionAttempted': True, 'responseReceived': False}
    save(folder, 'submission.json', record, exclusive=True)
    boundary = 'ArboretumClaimSource' + sha(archive)[:24]
    body = ('--' + boundary + '\r\nContent-Disposition: form-data; name="zip"; filename="source.zip"\r\n'
        'Content-Type: application/zip\r\n\r\n').encode() + archive + ('\r\n--' + boundary + '--\r\n').encode()
    try:
        raw, status = authorized_request('/sites/' + SITE + '/builds?' + urllib.parse.urlencode({'title': title}),
            data=body, headers={'Content-Type': 'multipart/form-data; boundary=' + boundary}, method='POST')
        result = json.loads(raw)
        if isinstance(result, list):
            assert len(result) == 1
            result = result[0]
        record.update(responseReceived=True, responseHttpStatus=status,
            deployId=result['deploy_id'], buildId=result['id'])
        save(folder, 'submission.json', record)
        print(json.dumps(record))
    except Exception as error:
        record['responseError'] = type(error).__name__
        save(folder, 'submission.json', record)
        raise


def verify(folder):
    submission = saved_submission(folder)
    assert sha((folder / 'source.zip').read_bytes()) == submission['archiveSha256'], 'Source archive changed'
    assert sha((folder / 'candidate.json').read_bytes()) == submission['candidateEvidenceSha256'], 'Candidate evidence changed'
    candidate = json.loads((folder / 'candidate.json').read_text())
    assert candidate['sourceCommit'] == submission['sourceCommit'] and candidate['sourceTree'] == submission['sourceTree']
    assert application_inventory() == candidate['applicationFiles'], 'Local output no longer matches the submitted candidate'
    assert sha((ROOT / 'netlify.toml').read_bytes()) == candidate['sourceConfigSha256']
    deploy_id = submission['deployId']
    backend = backend_snapshot(deploy_id)
    preserved = preservation()
    inventory = api('/deploys/' + deploy_id + '/files')
    indexed = {item['path'].lstrip('/'): item for item in inventory}
    assert len(indexed) == len(inventory), 'Duplicate deploy file path'
    expected = {str(p.relative_to(ROOT / 'dist')): p for p in (ROOT / 'dist').rglob('*') if p.is_file()}
    checks = []
    for name, file in sorted(expected.items()):
        deployed_name = 'backgrounda.jpg' if name == 'backgroundA.jpg' else name
        item = indexed.pop(deployed_name)
        data = file.read_bytes()
        assert item['sha'] == sha(data, 'sha1') and item['size'] == len(data), name
        checks.append({'path': name, 'deployedPath': deployed_name, 'sha1': item['sha'], 'bytes': len(data), 'matches': True})
    config = indexed.pop('netlify.toml')
    assert config['sha'] == sha((ROOT / 'netlify.toml').read_bytes(), 'sha1')
    assert len(indexed) == 3 and all(name.startswith('.netlify/internal/edge-functions/') for name in indexed)
    baseline = baseline_record()
    raw_paths = [item['path'] for item in baseline['rawDeployedAssets']] + NEW
    def check_raw(name):
        raw, code = authorized_request('/deploys/' + deploy_id + '/files/' + name,
            headers={'Content-Type': 'application/vnd.bitballoon.v1.raw'})
        assert code == 200 and raw == (ROOT / 'dist' / name).read_bytes(), name
        return {'path': name, 'sha256': sha(raw), 'matches': True}
    with ThreadPoolExecutor(max_workers=6) as pool:
        raw_checks = list(pool.map(check_raw, raw_paths))
    assert api('/sites/' + SITE)['published_deploy']['id'] == deploy_id, 'Published deploy changed during verification'
    assert api('/sites/' + ORIGINAL)['published_deploy']['id'] == ORIGINAL_DEPLOY, 'Original site changed during verification'
    record = {'schemaVersion': 1, 'verifiedAt': now(), 'sourceUpload': submission,
        **backend, **preserved, 'rawDeployedAssets': raw_checks, 'completePublishedInventory': checks,
        'additionalPublishedSourceConfig': {'path': 'netlify.toml', 'sha256': sha((ROOT / 'netlify.toml').read_bytes()), 'matchesSource': True},
        'realWalletConnections': 0, 'realSignaturesRequested': 0, 'realTransactionsSubmitted': 0}
    save(folder, 'hosted-assets.json', record)
    print(json.dumps({'deployId': deploy_id, 'rawAssetsMatched': len(raw_checks),
        'completeInventoryMatched': len(checks), **preserved}))


def http_checks(folder):
    submission = saved_submission(folder)
    assert api('/sites/' + SITE)['published_deploy']['id'] == submission['deployId']
    opener = urllib.request.build_opener(NoRedirect)
    checks = []
    def request(path, accept='text/html'):
        assert path.startswith('/') and not path.startswith('//')
        req = urllib.request.Request(ORIGIN + path, headers={'Accept': accept})
        try:
            response = opener.open(req, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.code, response.read(), response.headers
    def check(name, condition):
        checks.append({'check': name, 'passed': bool(condition)})
        assert condition, name
    for path in ['/admin/claim-test', '/admin/claim-test/', '/admin/claim-test/index.html']:
        code, body, headers = request(path)
        check('Protected document return: ' + path, code == 303 and urllib.parse.urljoin(ORIGIN, headers.get('Location', '')) == ORIGIN + '/tester-access?next=claim-test')
    for destination in ['gameplay-test', 'watering-test']:
        code, _, headers = request('/admin/' + destination + '/')
        check('Previous owner document remains protected: ' + destination,
            code == 303 and urllib.parse.urljoin(ORIGIN, headers.get('Location', '')) == ORIGIN + '/tester-access?next=' + destination)
    for name in NEW + ['game.html', 'settlement-game.html', 'wallet.js', 'settlement-wallet.js']:
        code, _, _ = request('/' + name, accept='application/json')
        check('Anonymous asset denied: ' + name, code in (401, 403))
    code, body, _ = request('/tester-access?next=claim-test')
    check('Native form retains fixed claim destination', code == 200 and b'name="next" value="claim-test"' in body)
    for path in ['/', '/player-guide']:
        code, _, _ = request(path)
        check('Public page remains available: ' + path, code == 200)
    assert api('/sites/' + SITE)['published_deploy']['id'] == submission['deployId'], 'Published deploy changed during HTTP checks'
    record = {'verifiedAt': now(), 'origin': ORIGIN, 'deployId': submission['deployId'],
        'checks': checks, 'passed': True, 'anonymousOnly': True, 'testerLoginAttempted': False,
        'credentialsWritten': False, 'walletConnections': 0, 'signaturesRequested': 0, 'transactionsSubmitted': 0,
        'limits': ['Anonymous HTTP checks do not establish tester login, native browser SameSite behavior, or JavaScript execution.',
            'Exact protected runtime bytes are verified separately through the authenticated deployment API.']}
    save(folder, 'hosted-http.json', record)
    print(json.dumps({'httpChecks': len(checks), 'passed': True}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['preflight', 'submit', 'status', 'verify', 'http'])
    parser.add_argument('output', type=Path)
    parser.add_argument('--commit')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    if args.operation == 'preflight':
        record = preflight()
        save(args.output, 'preflight.json', record)
        print(json.dumps(record))
    elif args.operation == 'submit':
        submit(args.output, args.commit)
    elif args.operation == 'status':
        submission = saved_submission(args.output)
        deployed = api('/deploys/' + submission['deployId'])
        assert deployed['id'] == submission['deployId'] and deployed['site_id'] == SITE
        record = deploy_summary(deployed)
        save(args.output, 'status.json', record)
        print(json.dumps(record))
    elif args.operation == 'verify':
        verify(args.output)
    else:
        http_checks(args.output)


if __name__ == '__main__':
    main()
