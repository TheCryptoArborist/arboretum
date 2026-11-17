"""Release only the dedicated site's tester-code removal.

Reuse the audited claim-release backend, archive, journal and verification helpers.
All 103 application assets and the existing backend must remain unchanged.
Only the submit operation makes a deployment request; HTTP checks use no secrets.
"""
from pathlib import Path
import importlib.util
import json
import os
import subprocess
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('arboretum_claim_release', ROOT / 'settlement-claim/release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
SITE, ORIGINAL, ORIGINAL_DEPLOY, ORIGIN = release.SITE, release.ORIGINAL, release.ORIGINAL_DEPLOY, release.ORIGIN
OLD = release.OLD = '6aebf7959ad6e90b6714ca15'
BASELINE = release.BASELINE = ROOT / 'settlement-claim/verification/hosted/hosted-assets.json'
release.NEW = []
release.CHANGED = set()
release.NAVIGATION_ADDITIONS = {}
api, sha, save, now = release.api, release.sha, release.save, release.now


def baseline_record():
    baseline = json.loads(BASELINE.read_text())
    assert baseline['siteId'] == SITE and baseline['publishedDeployId'] == OLD
    paths = [item['path'] for item in baseline['completePublishedInventory']]
    assert len(paths) == len(set(paths)) == 103, 'Unexpected recorded claim baseline'
    return baseline


# The legacy helper validates every file; its old reporting count is replaced here.
release.baseline_record = baseline_record
original_preflight, original_preservation = release.preflight, release.preservation


def preflight():
    result = original_preflight()
    result.update(existingApplicationFileCount=103, expectedChangedApplicationFiles=[], expectedAddedRuntimeFiles=[])
    return result


def preservation():
    result = original_preservation()
    assert result['existingApplicationFilesPreserved'] == result['completeApplicationFileCount'] == 103
    assert result['changedApplicationFiles'] == result['addedRuntimeFiles'] == []
    assert sha((ROOT / 'netlify.toml').read_bytes()) == baseline_record()['additionalPublishedSourceConfig']['sha256'], 'Source configuration changed'
    result.pop('navigationOnlyChangesVerified', None)
    return {**result, 'zeroApplicationAssetChanges': True}


release.preflight, release.preservation = preflight, preservation


def submit(folder, commit):
    assert len(commit or '') == 40 and all(c in '0123456789abcdef' for c in commit)
    assert not folder.resolve().is_relative_to(ROOT), 'Keep the release journal outside the source checkout'
    assert not (folder / 'submission.json').exists(), 'Submission already journaled; inspect it instead of repeating'
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip() == commit
    assert subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT).strip() == b'', 'Save source before publication'
    prior, preserved = preflight(), preservation()
    title = 'Remove dedicated-site tester access code · ' + commit[:12]
    release.assert_no_pending_submission(title)
    save(folder, 'preflight-before-submit.json', {**prior, **preserved}, exclusive=True)
    candidate = {'sourceCommit': commit,
        'sourceTree': subprocess.check_output(['git', 'rev-parse', commit + '^{tree}'], cwd=ROOT).decode().strip(),
        'applicationFiles': release.application_inventory(),
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
    assert release.application_inventory() == candidate['applicationFiles'], 'Build output changed before submission'
    record = {'siteId': SITE, 'sourceCommit': commit, 'sourceTree': candidate['sourceTree'],
        'candidateEvidenceSha256': sha((folder / 'candidate.json').read_bytes()), 'archiveSha256': sha(archive),
        'archiveBytes': len(archive), 'requestedAt': now(), 'previousPublishedDeployId': OLD,
        'originalPublishedDeployId': ORIGINAL_DEPLOY, 'submissionAttempted': True, 'responseReceived': False}
    save(folder, 'submission.json', record, exclusive=True)
    boundary = 'ArboretumAccessSource' + sha(archive)[:24]
    body = ('--' + boundary + '\r\nContent-Disposition: form-data; name="zip"; filename="source.zip"\r\n'
        'Content-Type: application/zip\r\n\r\n').encode() + archive + ('\r\n--' + boundary + '--\r\n').encode()
    try:
        raw, status = release.authorized_request('/sites/' + SITE + '/builds?' + urllib.parse.urlencode({'title': title}),
            data=body, headers={'Content-Type': 'multipart/form-data; boundary=' + boundary}, method='POST')
        result = json.loads(raw)
        if isinstance(result, list):
            assert len(result) == 1
            result = result[0]
        record.update(responseReceived=True, responseHttpStatus=status, deployId=result['deploy_id'], buildId=result['id'])
        save(folder, 'submission.json', record)
        print(json.dumps(record))
    except Exception as error:
        record['responseError'] = type(error).__name__
        save(folder, 'submission.json', record)
        raise


def http_checks(folder):
    submission = release.saved_submission(folder)
    assert api('/sites/' + SITE)['published_deploy']['id'] == submission['deployId']
    opener = urllib.request.build_opener(release.NoRedirect)
    checks = []

    def request(path, method='GET', data=None, origin=None):
        assert path.startswith('/') and not path.startswith('//')
        headers = {'Accept': 'text/html'}
        if origin is not None:
            headers['Origin'] = origin
        if data is not None:
            headers['Content-Type'] = 'application/x-www-form-urlencoded'
            data = urllib.parse.urlencode(data).encode()
        req = urllib.request.Request(ORIGIN + path, headers=headers, data=data, method=method)
        try:
            response = opener.open(req, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.code, response.read(), response.headers

    def check(name, condition):
        checks.append({'check': name, 'passed': bool(condition)})
        assert condition, name

    def protected_headers(headers):
        return ('no-store' in headers.get('Cache-Control', '') and
            all(tag in headers.get('X-Robots-Tag', '') for tag in ['noindex', 'nofollow', 'noarchive']) and
            headers.get('X-Content-Type-Options') == 'nosniff' and headers.get('X-Frame-Options') == 'DENY' and
            headers.get('Referrer-Policy') == 'no-referrer')

    direct = {'/game.html': 'game.html', '/settlement-game.html': 'settlement-game.html',
        '/admin/claim-test/': 'admin/claim-test/index.html', '/admin/claim-test/admin.mjs': 'admin/claim-test/admin.mjs',
        '/admin/claim-test/admin.css': 'admin/claim-test/admin.css', '/wallet.js': 'wallet.js'}
    for path, file in direct.items():
        for method in ['GET', 'HEAD']:
            code, body, headers = request(path, method)
            check('Anonymous direct ' + method + ': ' + path,
                code == 200 and protected_headers(headers) and not headers.get('Set-Cookie') and
                body == ((ROOT / 'dist' / file).read_bytes() if method == 'GET' else b''))
    for path in ['/tester-access', '/tester-access/', '/tester-access.html']:
        for method in ['GET', 'HEAD']:
            code, _, headers = request(path + '?next=claim-test', method)
            check('Legacy claim entrance ' + method + ': ' + path,
                code == 303 and urllib.parse.urljoin(ORIGIN, headers.get('Location', '')) == ORIGIN + '/admin/claim-test/' and protected_headers(headers))
    for query in ['next=https://example.invalid/', 'next=claim-test&next=claim-test']:
        code, _, headers = request('/tester-access?' + query)
        check('Unrecognized legacy destination falls back: ' + query,
            code == 303 and urllib.parse.urljoin(ORIGIN, headers.get('Location', '')) == ORIGIN + '/game.html')
    code, _, headers = request('/play')
    check('Legacy play link', code == 302 and urllib.parse.urljoin(ORIGIN, headers.get('Location', '')) == ORIGIN + '/game.html')
    for path, data, destination in [('/tester-access', {'next': 'claim-test'}, '/admin/claim-test/'), ('/tester-logout', {}, '/game.html')]:
        code, _, headers = request(path, 'POST', data, ORIGIN)
        cookie = headers.get('Set-Cookie', '')
        check('Legacy same-origin POST: ' + path,
            code == 303 and urllib.parse.urljoin(ORIGIN, headers.get('Location', '')) == ORIGIN + destination and
            '__Host-arboretum_tester=;' in cookie and all(value in cookie for value in ['Max-Age=0', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) and 'Domain=' not in cookie)
    for origin in [None, 'null', 'https://example.invalid']:
        code, _, _ = request('/tester-access', 'POST', {'next': 'claim-test'}, origin)
        check('Legacy POST origin rejected: ' + str(origin), code == 403)
    for path, method in [('/game.html', 'POST'), ('/admin/claim-test/', 'PUT'), ('/wallet.js', 'DELETE'),
        ('/.netlify/functions/calendar-reminder', 'POST')]:
        code, _, headers = request(path, method, {}, ORIGIN)
        check('Ordinary write rejected: ' + method + ' ' + path, code == 405 and protected_headers(headers))
    code, body, headers = request('/.netlify/functions/calendar-reminder?start=1794171600000&end=1794172500000')
    check('Calendar download remains available', code == 200 and b'BEGIN:VCALENDAR' in body and protected_headers(headers))
    for path in ['/', '/player-guide']:
        code, _, _ = request(path)
        check('Public page remains available: ' + path, code == 200)
    check('Target remains on submitted deployment', api('/sites/' + SITE)['published_deploy']['id'] == submission['deployId'])
    check('Original site remains unchanged', api('/sites/' + ORIGINAL)['published_deploy']['id'] == ORIGINAL_DEPLOY)
    record = {'verifiedAt': now(), 'origin': ORIGIN, 'deployId': submission['deployId'], 'checks': checks,
        'passed': True, 'anonymousOnly': True, 'testerPasswordUsed': False, 'credentialsWritten': False,
        'walletConnections': 0, 'signaturesRequested': 0, 'transactionsSubmitted': 0,
        'limits': ['HTTP checks establish access and response behavior, not browser JavaScript execution or wallet behavior.',
            'Other-site preservation is established by its unchanged published deployment; context-specific gate behavior is covered by offline tests.']}
    save(folder, 'hosted-http.json', record)
    print(json.dumps({'httpChecks': len(checks), 'passed': True}))


release.submit, release.http_checks = submit, http_checks
verify = release.verify

if __name__ == '__main__':
    release.main()
