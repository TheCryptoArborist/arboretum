"""Publish only the three focused Season 3 owner-test assets.

All 106 published application files, backend/edge source and dependency locks
remain unchanged. The established source-build, backend, raw-asset and HTML
verification helpers are reused. One durable journal permits at most one POST.
No operation connects a wallet, signs, resets a season or submits a Sui transaction.
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

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('arboretum_focused_cycle_release_helpers', ROOT / 'settlement-cycle/release.py')
previous = importlib.util.module_from_spec(spec)
spec.loader.exec_module(previous)
release = previous.release
SITE, ORIGINAL, ORIGINAL_DEPLOY, ORIGIN = previous.SITE, previous.ORIGINAL, previous.ORIGINAL_DEPLOY, previous.ORIGIN
OLD = '6af09274b50143d105dbb63a'
BASELINE_SOURCE = '1062f33c881939de53ca10529ef81b5d8dbabc89'
BASELINE_TREE = '84bf53034518c3e749411fb8a2fea948c3b4c8c3'
BASELINE_CANDIDATE_SHA256 = 'cc01f1c900a368f9a3eb369a69fc25cd582863d7f9121ba8f90443172a6c05fd'
BASELINE_DIR = ROOT / 'settlement-cycle/verification/plant-fields-fix/hosted'
RELEASE_MODE = 'season-three-focused-watering'
NEW = ['admin/season-three/index.html', 'admin/season-three/admin.css', 'admin/season-three/admin.mjs']
PRESERVED_SOURCE_SHA256 = {
    'netlify/edge-functions/public-player-guide.ts': '8664278a0f1ded172b7b30ea561e17f87e281ce9bdcb7231daf5467108b5acaf',
    'netlify/edge-functions/tester-gate.ts': 'b4128957ab70780f4a1e8e041f1e675152392bda5699e5fb7cb4a2886612f791',
    'netlify/functions/calendar-reminder.js': 'ed53a654cb71429168c58b04fd5db31c8d7838176c87f7808eeb57e12ba86a68',
    'netlify.toml': 'fb10df6b1a49ce69f130cc3103a4816a785f5bbab2781738af07bb195331c1f7',
    'package.json': '6c5cac221980b459104e6bf7cb94260cc048f9b60abc4659c44dcb3efa7941ec',
    'package-lock.json': 'ccfa19eac136fae7871619589369821939ec40579fc0749302fc5972100d0caa',
}
release.OLD, release.NEW, release.CHANGED, release.NAVIGATION_ADDITIONS = OLD, NEW, set(), {}
sha, save, now = release.sha, release.save, release.now
authorized_request, verify_served_html = previous.authorized_request, previous.verify_served_html
release.authorized_request = authorized_request
api = release.api


def baseline_record():
    """Bind the last authenticated 106-file publication to its exact saved source."""
    submission = json.loads((BASELINE_DIR / 'submission.json').read_text())
    raw = (BASELINE_DIR / 'candidate.json').read_bytes()
    candidate = json.loads(raw)
    observed = json.loads((BASELINE_DIR / 'hosted-assets.json').read_text())
    assert submission['siteId'] == SITE and submission['deployId'] == OLD
    assert submission['sourceCommit'] == candidate['sourceCommit'] == BASELINE_SOURCE
    assert submission['sourceTree'] == candidate['sourceTree'] == BASELINE_TREE
    assert sha(raw) == BASELINE_CANDIDATE_SHA256 == submission['candidateEvidenceSha256'], 'Recorded baseline candidate changed'
    assert submission['releaseMode'] == 'plant-fields-hotfix'
    assert submission['responseReceived'] is True and submission['submissionAttempted'] is True
    assert submission['previousPublishedDeployId'] == '6af08867e808541bad23b5b2'
    assert submission['originalPublishedDeployId'] == ORIGINAL_DEPLOY
    assert observed['siteId'] == SITE and observed['publishedDeployId'] == OLD
    assert observed['sourceUpload'] == submission and observed['retainedOriginalDeployId'] == ORIGINAL_DEPLOY
    deployed = observed['deployment']
    assert deployed['id'] == OLD and deployed['site_id'] == SITE
    assert deployed['state'] == 'ready' and deployed['context'] == 'production' and deployed['published_at']
    assert observed['additionalPublishedSourceConfig']['sha256'] == candidate['sourceConfigSha256'] == PRESERVED_SOURCE_SHA256['netlify.toml']
    files = candidate['applicationFiles']
    inventory, raw_assets = observed['completePublishedInventory'], observed['rawDeployedAssets']
    paths = {item['path'] for item in files}
    indexed = {item['path']: item for item in inventory}
    raw_indexed = {item['path']: item for item in raw_assets}
    assert len(files) == len(paths) == len(inventory) == len(indexed) == len(raw_assets) == len(raw_indexed) == 106
    assert paths == set(indexed) == set(raw_indexed) and not paths & set(NEW)
    assert {'admin/season-two/index.html', 'admin/season-two/admin.css', 'admin/season-two/admin.mjs'} <= paths
    assert all(not Path(name).is_absolute() and '..' not in Path(name).parts for name in paths)
    for item in files:
        deployed, raw_asset = indexed[item['path']], raw_indexed[item['path']]
        assert deployed['matches'] is True and raw_asset['matches'] is True
        assert deployed['sha1'] == item['sha1'] and deployed['bytes'] == item['bytes'], item['path']
        assert raw_asset['sha256'] == item['sha256'], item['path']
        assert deployed.get('deployedPath', item['path']) == ('backgrounda.jpg' if item['path'] == 'backgroundA.jpg' else item['path'])
    return observed


def preserved_sources():
    entries = list((ROOT / 'netlify').rglob('*'))
    assert all(not file.is_symlink() for file in entries), 'Backend source must contain no symlinks'
    actual = {str(file.relative_to(ROOT)) for file in entries if file.is_file()}
    assert actual == {name for name in PRESERVED_SOURCE_SHA256 if name.startswith('netlify/')}, 'Backend or edge source inventory changed'
    for name, expected in PRESERVED_SOURCE_SHA256.items():
        file = ROOT / name
        assert not file.is_symlink() and file.is_file(), 'Expected a regular preserved source file: ' + name
        assert sha(file.read_bytes()) == expected, 'Preserved backend, configuration or dependency source changed: ' + name
    return dict(PRESERVED_SOURCE_SHA256)


release.baseline_record = baseline_record


def preflight():
    baseline_record()
    sources = preserved_sources()
    result = previous.original_preflight()
    return {**result, 'releaseMode': RELEASE_MODE, 'existingApplicationFileCount': 106,
        'expectedChangedApplicationFiles': [], 'expectedAddedRuntimeFiles': NEW,
        'preservedBackendAndDependencySha256': sources,
        'baselineInventoryMethod': 'Authenticated 106-file publication bound to its exact source candidate and checked again against the live Netlify inventory.'}


def preservation():
    sources = preserved_sources()
    assert all(not file.is_symlink() for file in (ROOT / 'dist').rglob('*')), 'Build output must contain no symlinks'
    release.application_inventory()
    result = previous.original_preservation()
    assert result['existingApplicationFilesPreserved'] == 106 and result['completeApplicationFileCount'] == 109
    assert result['changedApplicationFiles'] == [] and result['addedRuntimeFiles'] == NEW
    result.pop('navigationOnlyChangesVerified', None)
    return {**result, 'releaseMode': RELEASE_MODE, 'allPreviousApplicationBytesUnchanged': True,
        'preservedBackendAndDependencySha256': sources}


release.preflight, release.preservation = preflight, preservation


def ci_evidence_hash(folder, commit, tree):
    """Require both completed required-workflow runs for the exact saved source."""
    path = folder / 'ci.json'
    assert path.is_file(), 'Submission requires ci.json for its exact saved source'
    raw = path.read_bytes()
    evidence = json.loads(raw)
    assert evidence['sourceCommit'] == commit and evidence['sourceTree'] == tree, 'Required CI is for different source'
    runs = evidence['requiredCI']
    assert len(runs) == 2 and {item['event'] for item in runs} == {'push', 'pull_request'}, 'Both required CI events must pass'
    assert all(type(item['id']) is int and item['id'] > 0 and item['conclusion'] == 'success'
        and item['status'] == 'completed' and item['headSha'] == commit
        and item['name'] == 'Settlement app integration review' and item['path'] == '.github/workflows/settlement-integration.yml'
        and item['url'] == 'https://github.com/TheCryptoArborist/arboretum/actions/runs/' + str(item['id']) for item in runs), 'Required exact-source CI did not pass'
    assert len({item['id'] for item in runs}) == 2, 'Required CI run IDs must be distinct'
    return sha(raw)


def saved_submission(folder):
    record = json.loads((folder / 'submission.json').read_text())
    assert record.get('releaseMode') == RELEASE_MODE, 'This journal belongs to a different release boundary'
    record = previous.original_saved_submission(folder)
    assert record.get('ciEvidenceSha256') == ci_evidence_hash(folder, record['sourceCommit'], record['sourceTree']), 'Required CI evidence changed after submission'
    return record


release.saved_submission = saved_submission


def submit(folder, commit):
    assert len(commit or '') == 40 and all(c in '0123456789abcdef' for c in commit)
    assert not folder.resolve().is_relative_to(ROOT), 'Keep the release journal outside the source checkout'
    assert not (folder / 'submission.json').exists(), 'Submission already journaled; inspect it instead of repeating'
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip() == commit
    assert subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT).strip() == b'', 'Save source before publication'
    tree = subprocess.check_output(['git', 'rev-parse', commit + '^{tree}'], cwd=ROOT).decode().strip()
    ci_hash = ci_evidence_hash(folder, commit, tree)
    prior, preserved = preflight(), preservation()
    title = 'Add focused Season 3 owner watering test · ' + commit[:12]
    release.assert_no_pending_submission(title)
    save(folder, 'preflight-before-submit.json', {**prior, **preserved}, exclusive=True)
    candidate = {'sourceCommit': commit, 'sourceTree': tree,
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
    assert ci_evidence_hash(folder, commit, tree) == ci_hash, 'Required CI evidence changed before submission'
    record = {'siteId': SITE, 'releaseMode': RELEASE_MODE, 'sourceCommit': commit, 'sourceTree': tree,
        'candidateEvidenceSha256': sha((folder / 'candidate.json').read_bytes()), 'archiveSha256': sha(archive),
        'archiveBytes': len(archive), 'requestedAt': now(), 'previousPublishedDeployId': OLD,
        'originalPublishedDeployId': ORIGINAL_DEPLOY, 'submissionAttempted': True, 'responseReceived': False,
        'ciEvidenceSha256': ci_hash}
    save(folder, 'submission.json', record, exclusive=True)
    boundary = 'ArboretumSeasonThreeSource' + sha(archive)[:24]
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


def http_checks(folder):
    submission = saved_submission(folder)
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

    direct = {'/admin/season-three/': 'admin/season-three/index.html',
        '/admin/season-three/admin.mjs': 'admin/season-three/admin.mjs', '/admin/season-three/admin.css': 'admin/season-three/admin.css',
        '/admin/season-two/': 'admin/season-two/index.html', '/game.html': 'game.html', '/admin/claim-test/': 'admin/claim-test/index.html'}
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
            check('Existing Season 2 entrance retained ' + method + ': ' + path,
                code == 303 and secured(headers) and urllib.parse.urljoin(ORIGIN, headers.get('Location', '')) == ORIGIN + '/admin/season-two/')
    for query in ['next=season-three', 'next=https://example.invalid/', 'next=season-two&next=season-two']:
        code, _, headers = request('/tester-access?' + query)
        check('Unchanged destination policy falls back: ' + query,
            code == 303 and urllib.parse.urljoin(ORIGIN, headers.get('Location', '')) == ORIGIN + '/game.html')
    code, _, headers = request('/admin/season-three/', 'POST')
    check('Direct Season 3 writes rejected', code == 405 and secured(headers))
    code, body, headers = request('/.netlify/functions/calendar-reminder?start=1794402000000&end=1794402900000')
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
        submission = saved_submission(args.output)
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
