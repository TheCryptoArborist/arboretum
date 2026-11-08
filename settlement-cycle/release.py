"""Release the isolated Season 2 page through one journaled source build.

Reuse the audited backend, inventory, source-binding and verification helpers.
The prior 103 application assets stay byte-identical; exactly three are added.
No operation connects a wallet or submits a blockchain transaction.
"""
from pathlib import Path
import argparse
import importlib.util
import json
import os
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('arboretum_cycle_release_helpers', ROOT / 'settlement-claim/release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
SITE, ORIGINAL, ORIGINAL_DEPLOY, ORIGIN = release.SITE, release.ORIGINAL, release.ORIGINAL_DEPLOY, release.ORIGIN
OLD = release.OLD = '6aeea0b254e028ece344267c'
BASELINE_DIR = ROOT / 'tester-access-release/verification/hosted'
NEW = release.NEW = ['admin/season-two/index.html', 'admin/season-two/admin.css', 'admin/season-two/admin.mjs']
release.CHANGED = set()
release.NAVIGATION_ADDITIONS = {}
sha, save, now = release.sha, release.save, release.now


def authorized_request(path, data=None, headers=None, method='GET'):
    assert path.startswith(('/sites/', '/deploys/')) and '://' not in path
    assert method in ('GET', 'POST')
    if method == 'POST':
        assert path.startswith('/sites/' + SITE + '/builds?')
    # Netlify records this established application file with a lowercase basename.
    if method == 'GET' and path.endswith('/files/backgroundA.jpg'):
        path = path[:-len('backgroundA.jpg')] + 'backgrounda.jpg'
    token = os.environ.get('NETLIFY_AUTH_TOKEN')
    if not token:
        config = Path.home() / '.config/netlify/config.json'
        if not config.is_file():
            raise RuntimeError('Netlify authentication is unavailable: use the normal CLI login or NETLIFY_AUTH_TOKEN.')
        cfg = json.loads(config.read_text())
        token = cfg['users'][cfg['userId']]['auth']['token']
    assert isinstance(token, str) and token, 'Netlify authentication is unavailable.'
    request_headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/json'}
    request_headers.update(headers or {})
    request = urllib.request.Request(release.API + path, data=data, headers=request_headers, method=method)
    # Credentials must never follow redirects to another host.
    with urllib.request.build_opener(release.NoRedirect).open(request, timeout=45) as response:
        return response.read(), response.status


release.authorized_request = authorized_request
api = release.api


def baseline_record():
    """Bind the published gate-only release to its recorded source inventory.

    That release had public-byte verification, including exact HTML serving
    transformations, rather than a post-publication authenticated file listing.
    preflight() independently checks this inventory against the current API.
    """
    submission = json.loads((BASELINE_DIR / 'submission.json').read_text())
    raw = (BASELINE_DIR / 'candidate.json').read_bytes()
    candidate = json.loads(raw)
    observed = json.loads((BASELINE_DIR / 'hosted-assets.json').read_text())
    assert submission['siteId'] == SITE and submission['deployId'] == OLD
    assert submission['sourceCommit'] == '05c0a9d9799ba6bc096051650320099db3def8a8'
    assert submission['responseReceived'] is True and submission['originalPublishedDeployId'] == ORIGINAL_DEPLOY
    assert sha(raw) == submission['candidateEvidenceSha256'], 'Recorded baseline candidate changed'
    assert candidate['sourceCommit'] == submission['sourceCommit'] and candidate['sourceTree'] == submission['sourceTree']
    assert observed['siteId'] == SITE and observed['publishedDeployId'] == OLD and observed['passed'] is True
    assert observed['sourceUpload'] == submission and observed['localCandidateMatchesSubmission'] is True
    files = candidate['applicationFiles']
    paths = {item['path'] for item in files}
    assert len(files) == len(paths) == 103 and not paths & set(NEW)
    assert paths == {item['path'] for item in observed['publicApplicationAssetChecks']}
    assert all(not Path(name).is_absolute() and '..' not in Path(name).parts for name in paths)
    return {'siteId': SITE, 'publishedDeployId': OLD, 'sourceUpload': submission,
        'completePublishedInventory': [{'path': item['path'],
            'deployedPath': 'backgrounda.jpg' if item['path'] == 'backgroundA.jpg' else item['path'],
            'sha1': item['sha1'], 'bytes': item['bytes']} for item in files],
        'rawDeployedAssets': [{'path': item['path'], 'sha256': item['sha256']} for item in files],
        'additionalPublishedSourceConfig': {'sha256': candidate['sourceConfigSha256']}}


release.baseline_record = baseline_record
original_preflight, original_preservation = release.preflight, release.preservation


def preflight():
    result = original_preflight()
    return {**result, 'existingApplicationFileCount': 103, 'expectedChangedApplicationFiles': [],
        'expectedAddedRuntimeFiles': NEW,
        'baselineInventoryMethod': 'Saved source candidate, now independently matched against the authenticated published deployment file inventory.'}


def preservation():
    result = original_preservation()
    assert result['existingApplicationFilesPreserved'] == 103 and result['completeApplicationFileCount'] == 106
    assert result['changedApplicationFiles'] == [] and result['addedRuntimeFiles'] == NEW
    assert sha((ROOT / 'netlify.toml').read_bytes()) == baseline_record()['additionalPublishedSourceConfig']['sha256'], 'Source configuration changed'
    result.pop('navigationOnlyChangesVerified', None)
    return {**result, 'allPreviousApplicationBytesUnchanged': True}


release.preflight, release.preservation = preflight, preservation


def submit(folder, commit):
    assert len(commit or '') == 40 and all(c in '0123456789abcdef' for c in commit)
    assert not folder.resolve().is_relative_to(ROOT), 'Keep the release journal outside the source checkout'
    assert not (folder / 'submission.json').exists(), 'Submission already journaled; inspect it instead of repeating'
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip() == commit
    assert subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT).strip() == b'', 'Save source before publication'
    prior, preserved = preflight(), preservation()
    title = 'Add 48-hour Season 2 owner flow · ' + commit[:12]
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
    boundary = 'ArboretumSeasonTwoSource' + sha(archive)[:24]
    body = ('--' + boundary + '\r\nContent-Disposition: form-data; name="zip"; filename="source.zip"\r\n'
        'Content-Type: application/zip\r\n\r\n').encode() + archive + ('\r\n--' + boundary + '--\r\n').encode()
    try:
        raw, status = authorized_request('/sites/' + SITE + '/builds?' + urllib.parse.urlencode({'title': title}),
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


def verify_served_html(source, served, url):
    """Allow only the exact Netlify anchor pretty-URL transform seen previously."""
    if source == served:
        return []

    class Anchors(HTMLParser):
        def __init__(self, text):
            super().__init__(convert_charrefs=False)
            self.tags, self.lines = [], [0]
            self.lines.extend(i + 1 for i, value in enumerate(text) if value == '\n')
            self.feed(text)

        def handle_starttag(self, tag, attrs):
            if tag != 'a':
                return
            assert len(dict(attrs)) == len(attrs), 'Duplicate anchor attribute'
            line, column = self.getpos()
            raw = self.get_starttag_text()
            start = self.lines[line - 1] + column
            self.tags.append((start, start + len(raw), raw, dict(attrs)))

    original, public = source.decode('utf-8'), served.decode('utf-8')
    before, after = Anchors(original).tags, Anchors(public).tags
    assert len(before) == len(after), 'Published anchor count changed'
    changes, parts, cursor = [], [], 0
    for first, second in zip(before, after):
        if first[2] == second[2]:
            continue
        old_attrs, new_attrs = first[3].copy(), second[3].copy()
        old_href, new_href = old_attrs.pop('href', None), new_attrs.pop('href', None)
        assert old_attrs == new_attrs and isinstance(old_href, str) and isinstance(new_href, str)
        resolved = urllib.parse.urlsplit(urllib.parse.urljoin(url, old_href))
        assert resolved.scheme == 'https' and resolved.netloc == urllib.parse.urlsplit(ORIGIN).netloc
        assert resolved.path.endswith('.html'), 'Unexpected HTML transformation'
        expected = urllib.parse.urlunsplit(('', '', resolved.path[:-5], resolved.query, resolved.fragment))
        assert new_href == expected, 'Published anchor destination changed'
        parts.extend([public[cursor:second[0]], first[2]])
        cursor = second[1]
        changes.append({'sourceTag': first[2], 'publicTag': second[2], 'sourceHref': old_href, 'publicHref': new_href})
    parts.append(public[cursor:])
    assert ''.join(parts).encode('utf-8') == source, 'Published bytes changed outside verified anchor rewrites'
    return changes


def http_checks(folder):
    submission = release.saved_submission(folder)
    assert api('/sites/' + SITE)['published_deploy']['id'] == submission['deployId']
    opener, checks, html_checks = urllib.request.build_opener(release.NoRedirect), [], []

    def request(path, method='GET'):
        assert path.startswith('/') and not path.startswith('//')
        req = urllib.request.Request(ORIGIN + path, headers={'Accept': 'text/html'}, method=method)
        try:
            response = opener.open(req, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.code, response.read(), response.headers

    def check(name, condition):
        checks.append({'check': name, 'passed': bool(condition)})
        assert condition, name

    def secured(headers):
        return ('no-store' in headers.get('Cache-Control', '') and
            all(tag in headers.get('X-Robots-Tag', '') for tag in ['noindex', 'nofollow', 'noarchive']) and
            headers.get('X-Content-Type-Options') == 'nosniff' and headers.get('X-Frame-Options') == 'DENY' and
            headers.get('Referrer-Policy') == 'no-referrer')

    direct = {'/admin/season-two/': 'admin/season-two/index.html',
        '/admin/season-two/admin.mjs': 'admin/season-two/admin.mjs', '/admin/season-two/admin.css': 'admin/season-two/admin.css',
        '/game.html': 'game.html', '/admin/claim-test/': 'admin/claim-test/index.html'}
    for path, file in direct.items():
        for method in ['GET', 'HEAD']:
            code, body, headers = request(path, method)
            check('Anonymous direct ' + method + ': ' + path, code == 200 and secured(headers) and not headers.get('Set-Cookie'))
            if method == 'HEAD':
                assert body == b''
            elif file.endswith('.html'):
                source = (ROOT / 'dist' / file).read_bytes()
                changes = verify_served_html(source, body, ORIGIN + path)
                html_checks.append({'path': file, 'sourceSha256': sha(source), 'publicSha256': sha(body),
                    'rawBytesIdentical': source == body, 'verifiedAnchorRewrites': changes, 'allOtherBytesIdentical': True})
            else:
                assert body == (ROOT / 'dist' / file).read_bytes(), file
    for path in ['/tester-access', '/tester-access/', '/tester-access.html']:
        for method in ['GET', 'HEAD']:
            code, _, headers = request(path + '?next=season-two', method)
            check('Fixed Season 2 entrance ' + method + ': ' + path,
                code == 303 and secured(headers) and urllib.parse.urljoin(ORIGIN, headers.get('Location', '')) == ORIGIN + '/admin/season-two/')
    for query in ['next=https://example.invalid/', 'next=season-two&next=season-two']:
        code, _, headers = request('/tester-access?' + query)
        check('Unknown or duplicate destination falls back: ' + query,
            code == 303 and urllib.parse.urljoin(ORIGIN, headers.get('Location', '')) == ORIGIN + '/game.html')
    code, _, headers = request('/admin/season-two/', 'POST')
    check('Direct Season 2 writes rejected', code == 405 and secured(headers))
    code, body, headers = request('/.netlify/functions/calendar-reminder?start=1794171600000&end=1794172500000')
    check('Calendar download preserved', code == 200 and b'BEGIN:VCALENDAR' in body and secured(headers))
    for path in ['/', '/player-guide']:
        code, _, _ = request(path)
        check('Public page preserved: ' + path, code == 200)
    check('Target remains on submitted deployment', api('/sites/' + SITE)['published_deploy']['id'] == submission['deployId'])
    check('Original site remains unchanged', api('/sites/' + ORIGINAL)['published_deploy']['id'] == ORIGINAL_DEPLOY)
    save(folder, 'hosted-http.json', {'verifiedAt': now(), 'origin': ORIGIN, 'deployId': submission['deployId'],
        'checks': checks, 'htmlServingChecks': html_checks, 'passed': True, 'anonymousOnly': True,
        'credentialsWritten': False, 'walletConnections': 0, 'signaturesRequested': 0, 'transactionsSubmitted': 0,
        'limits': ['HTTP checks establish response behavior, not browser JavaScript or wallet execution.',
            'HTML may have narrowly verified Netlify anchor rewrites. Authenticated raw assets and complete inventory are checked by verify.']})
    print(json.dumps({'httpChecks': len(checks), 'passed': True}))


release.submit, release.http_checks = submit, http_checks
verify = release.verify


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['preserve', 'preflight', 'submit', 'status', 'verify', 'http'])
    parser.add_argument('output', type=Path)
    parser.add_argument('--commit')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    if args.operation in ('preserve', 'preflight'):
        record = preservation() if args.operation == 'preserve' else preflight()
        save(args.output, args.operation + '.json', record)
        print(json.dumps(record))
    elif args.operation == 'submit':
        submit(args.output, args.commit)
    elif args.operation == 'status':
        submission = release.saved_submission(args.output)
        deployed = api('/deploys/' + submission['deployId'])
        assert deployed['id'] == submission['deployId'] and deployed['site_id'] == SITE
        record = release.deploy_summary(deployed)
        save(args.output, 'status.json', record)
        print(json.dumps(record))
    elif args.operation == 'verify':
        verify(args.output)
    else:
        http_checks(args.output)


if __name__ == '__main__':
    main()
