"""Publish the additive owner gameplay review and verify its exact deployment.

Uses the existing authorized Netlify account internally. Never prints credentials.
The only remote mutation is one journaled source-build submission to the fixed site.
It cannot connect a wallet or submit blockchain transactions.
"""
from pathlib import Path
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
import argparse
import hashlib
import http.cookiejar
import html
import json
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SITE = 'd425445d-4980-49be-8ab2-12e7527ba281'
ORIGINAL = 'a344fb31-10b4-4eea-9562-067d90a39607'
OLD = '6ae58697bc817a22d602d1be'
ORIGINAL_DEPLOY = '6abe81174b61a8e3dd53b333'
ORIGIN = 'https://www.treegrow.xyz'
API = 'https://api.netlify.com/api/v1'
FUNCTION_DIGEST = 'e11353817de886625c0f037e5b341f1506b51b3477a227281527bd9bf496de98'
NEW = ['admin/gameplay-test/index.html', 'admin/gameplay-test/admin.css', 'admin/gameplay-test/admin.mjs']
BASELINE = ROOT / 'settlement-season/verification/hosted-20261031.json'


def now():
    return datetime.now(timezone.utc).isoformat()


def sha(data, algorithm='sha256'):
    return hashlib.new(algorithm, data).hexdigest()


def save(folder, name, value, exclusive=False):
    with (folder / name).open('x' if exclusive else 'w') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


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


def preservation():
    baseline = json.loads(BASELINE.read_text())
    old_paths = {item['path'] for item in baseline['completePublishedInventory']}
    current_paths = {str(p.relative_to(ROOT / 'dist')) for p in (ROOT / 'dist').rglob('*') if p.is_file()}
    assert current_paths == old_paths | set(NEW), 'Unexpected application file inventory'
    for item in baseline['completePublishedInventory']:
        data = (ROOT / 'dist' / item['path']).read_bytes()
        assert sha(data, 'sha1') == item['sha1'] and len(data) == item['bytes'], item['path']
    return {'existingApplicationFilesPreserved': len(old_paths), 'addedRuntimeFiles': NEW,
        'completeApplicationFileCount': len(current_paths)}


def submit(folder, commit):
    assert len(commit or '') == 40 and all(c in '0123456789abcdef' for c in commit)
    assert not (folder / 'submission.json').exists(), 'Submission already journaled; inspect it instead of repeating'
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip() == commit
    assert subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT).strip() == b'', 'Save source before publication'
    prior = backend_snapshot(OLD)
    saved = preservation()
    save(folder, 'preflight-before-submit.json', {**prior, **saved}, exclusive=True)
    archive = subprocess.check_output(['git', 'archive', '--format=zip', commit], cwd=ROOT)
    (folder / 'source.zip').write_bytes(archive)
    record = {'siteId': SITE, 'sourceCommit': commit, 'archiveSha256': sha(archive),
        'archiveBytes': len(archive), 'requestedAt': now(), 'previousPublishedDeployId': OLD,
        'originalPublishedDeployId': ORIGINAL_DEPLOY, 'submissionAttempted': True, 'responseReceived': False}
    save(folder, 'submission.json', record, exclusive=True)
    boundary = 'ArboretumGameplaySource' + sha(archive)[:24]
    body = ('--' + boundary + '\r\nContent-Disposition: form-data; name="zip"; filename="source.zip"\r\n'
        'Content-Type: application/zip\r\n\r\n').encode() + archive + ('\r\n--' + boundary + '--\r\n').encode()
    title = 'Add owner review for first test Seed · ' + commit[:12]
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
    submission = json.loads((folder / 'submission.json').read_text())
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
    baseline = json.loads(BASELINE.read_text())
    raw_paths = [item['path'] for item in baseline['rawDeployedAssets']] + NEW
    def check_raw(name):
        raw, code = authorized_request('/deploys/' + deploy_id + '/files/' + name,
            headers={'Content-Type': 'application/vnd.bitballoon.v1.raw'})
        assert code == 200 and raw == (ROOT / 'dist' / name).read_bytes(), name
        return {'path': name, 'sha256': sha(raw), 'matches': True}
    with ThreadPoolExecutor(max_workers=6) as pool:
        raw_checks = list(pool.map(check_raw, raw_paths))
    record = {'schemaVersion': 1, 'verifiedAt': now(), 'sourceUpload': submission,
        **backend, **preserved, 'rawDeployedAssets': raw_checks, 'completePublishedInventory': checks,
        'additionalPublishedSourceConfig': {'path': 'netlify.toml', 'sha256': sha((ROOT / 'netlify.toml').read_bytes()), 'matchesSource': True},
        'realWalletConnections': 0, 'realSignaturesRequested': 0, 'realTransactionsSubmitted': 0}
    save(folder, 'hosted-assets.json', record)
    print(json.dumps({'deployId': deploy_id, 'rawAssetsMatched': len(raw_checks),
        'completeInventoryMatched': len(checks), **preserved}))


def http_checks(folder):
    password = sys.stdin.readline().rstrip('\r\n')
    assert len(password) >= 20 and '\n' not in password
    cookies = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(NoRedirect, urllib.request.HTTPCookieProcessor(cookies))
    checks = []
    def request(path, data=None, accept='text/html', origin=ORIGIN):
        assert path.startswith('/') and not path.startswith('//')
        headers = {'Accept': accept}
        if data is not None:
            headers.update({'Origin': origin, 'Content-Type': 'application/x-www-form-urlencoded'})
        req = urllib.request.Request(ORIGIN + path, headers=headers,
            data=urllib.parse.urlencode(data).encode() if data is not None else None)
        try:
            response = opener.open(req, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.code, response.read(), response.headers
    def check(name, condition):
        checks.append({'check': name, 'passed': bool(condition)})
        assert condition, name
    for path in ['/admin/gameplay-test', '/admin/gameplay-test/', '/admin/gameplay-test/index.html']:
        code, body, headers = request(path)
        check('Protected document return: ' + path, code == 303 and urllib.parse.urljoin(ORIGIN, headers.get('Location', '')) == ORIGIN + '/tester-access?next=gameplay-test')
    for name in NEW + ['game.html', 'settlement-game.html', 'wallet.js', 'settlement-wallet.js']:
        code, _, _ = request('/' + name, accept='application/json')
        check('Anonymous asset denied: ' + name, code in (401, 403))
    code, body, _ = request('/tester-access?next=gameplay-test')
    check('Native form retains fixed gameplay destination', code == 200 and b'name="next" value="gameplay-test"' in body)
    code, body, _ = request('/tester-access', {'password': 'definitely-invalid-gameplay-test-code', 'next': 'gameplay-test'})
    check('Rejected code retains destination', code == 401 and b'name="next" value="gameplay-test"' in body)
    code, _, headers = request('/tester-access', {'password': password, 'next': 'gameplay-test'})
    check('Existing tester login returns to gameplay', code == 303 and urllib.parse.urljoin(ORIGIN, headers.get('Location', '')) == ORIGIN + '/admin/gameplay-test/')
    cookie = headers.get('Set-Cookie', '')
    check('Session cookie retains security attributes', all(s in cookie for s in ['__Host-arboretum_tester=', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) and 'Domain=' not in cookie)
    code, body, _ = request('/admin/gameplay-test/')
    heading_match = re.search(r'<h1\b[^>]*>(.*?)</h1>', body.decode('utf-8'), re.S | re.I)
    heading = ' '.join(html.unescape(re.sub(r'<[^>]+>', ' ', heading_match.group(1))).split()) if heading_match else ''
    check('Correct gameplay page is live', code == 200 and heading == 'Plant your first test Seed.')
    for name in ['admin/gameplay-test/admin.css', 'admin/gameplay-test/admin.mjs']:
        code, body, _ = request('/' + name)
        check('Authenticated exact asset: ' + name, code == 200 and body == (ROOT / 'dist' / name).read_bytes())
    code, _, _ = request('/tester-logout', {})
    check('Logout succeeds', code == 303)
    code, _, _ = request('/admin/gameplay-test/admin.mjs', accept='application/json')
    check('Asset denied after logout', code in (401, 403))
    record = {'verifiedAt': now(), 'origin': ORIGIN, 'checks': checks, 'passed': True,
        'credentialsWritten': False, 'walletConnections': 0, 'signaturesRequested': 0, 'transactionsSubmitted': 0,
        'limits': ['HTTP checks do not establish native browser SameSite behavior or JavaScript execution.']}
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
        record = backend_snapshot(OLD)
        save(args.output, 'preflight.json', record)
        print(json.dumps(record))
    elif args.operation == 'submit':
        submit(args.output, args.commit)
    elif args.operation == 'status':
        submission = json.loads((args.output / 'submission.json').read_text())
        record = deploy_summary(api('/deploys/' + submission['deployId']))
        save(args.output, 'status.json', record)
        print(json.dumps(record))
    elif args.operation == 'verify':
        verify(args.output)
    else:
        http_checks(args.output)


if __name__ == '__main__':
    main()
