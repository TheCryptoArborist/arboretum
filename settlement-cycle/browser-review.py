#!/usr/bin/env python3
"""Render the compiled Season 2 page with fresh, scoped read-only mainnet data.

Only the exact proof and input GraphQL queries exported by common.mjs may be
forwarded. Static assets are frozen from dist; every other request is blocked.
No wallet is installed, connected, simulated or asked to sign. Future Season 2
care is covered by separate offline tests, never described as live execution.
"""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import mimetypes
import shutil
import subprocess
import urllib.request
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'settlement-cycle/verification/browser'


def stamp():
    return datetime.now(timezone.utc).isoformat()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    config = json.loads(subprocess.check_output(['node', '--input-type=module', '--eval', '''
      const c = await import('./settlement-cycle/common.mjs');
      console.log(JSON.stringify({ origin: c.EXPECTED.origin,
        endpoint: c.EXPECTED.graphqlEndpoint || c.EXPECTED.endpoint,
        proofQuery: c.PROOF_QUERY, proofVariables: c.PROOF_VARIABLES,
        inputsQuery: c.INPUTS_QUERY, inputVariables: c.INPUT_VARIABLES,
        registryId: c.EXPECTED.registryId, priorClaimDigest: c.EXPECTED.previousClaimDigest,
        nftId: c.EXPECTED.previousNftId }));
    '''], cwd=ROOT))
    assert config['origin'] == 'https://www.treegrow.xyz'
    assert urlsplit(config['endpoint']).scheme == 'https'
    allowed_queries = {
        config['proofQuery']: ('proof', config['proofVariables']),
        config['inputsQuery']: ('inputs', config['inputVariables']),
    }
    assert len(allowed_queries) == 2
    assert all('simulateTransaction' not in query and not query.lstrip().startswith('mutation') for query in allowed_queries)
    names = ['admin/season-two/index.html', 'admin/season-two/admin.css', 'admin/season-two/admin.mjs',
        'prelaunch/hero.png', 'prelaunch/mark.png']
    compiled = {name: (ROOT / 'dist' / name).read_bytes() for name in names}
    source_names = ['settlement-cycle/' + name for name in
        ['index.html', 'admin.css', 'admin.mjs', 'common.mjs', 'rollover-core.mjs', 'care-core.mjs', 'build.mjs']]
    source_hashes = {name: sha((ROOT / name).read_bytes()) for name in source_names}
    network, observations = [], []
    record = {'schemaVersion': 1, 'startedAt': stamp(), 'passed': False,
        'method': 'Local compiled bytes at the authorized origin; exact scoped proof/input queries freshly forwarded to public mainnet GraphQL using normal TLS. All other browser traffic blocked.',
        'origin': config['origin'], 'route': '/admin/season-two/', 'registryId': config['registryId'],
        'priorClaimDigest': config['priorClaimDigest'], 'scopedNftId': config['nftId'],
        'sourceSha256': source_hashes, 'compiledSha256': {name: sha(raw) for name, raw in compiled.items()},
        'observations': observations, 'realWalletConnections': 0, 'signaturesRequested': 0,
        'transactionsSubmitted': 0, 'unsignedSimulations': 0, 'futureCareLiveTested': False,
        'limits': ['This checks current read-only mainnet rendering and responsive layout, not a hosted deployment.',
            'No synthetic future Season 2 state is used here. Transaction and future-care paths have separate offline tests.']}
    error = None
    try:
        with sync_playwright() as playwright:
            executable = shutil.which('chromium')
            if executable is None and Path(playwright.chromium.executable_path).is_file():
                executable = playwright.chromium.executable_path
            assert executable, 'An installed Chromium is required.'
            browser = playwright.chromium.launch(executable_path=executable, headless=True, args=[
                '--no-sandbox', '--disable-dev-shm-usage', '--proxy-server=http://127.0.0.1:9',
                '--proxy-bypass-list=<-loopback>', '--disable-background-networking'])
            record['browserVersion'] = browser.version
            for width, label in [(1440, 'desktop'), (390, 'mobile')]:
                context = browser.new_context(viewport={'width': width, 'height': 1000 if width == 1440 else 844},
                    device_scale_factor=1, service_workers='block', ignore_https_errors=False)
                errors, blocked, read_counts, checkpoints = [], [], {'proof': 0, 'inputs': 0}, {}

                def route_request(route):
                    request = route.request
                    url = urlsplit(request.url)
                    if request.url == config['endpoint'] and request.method == 'OPTIONS':
                        route.fulfill(status=204, headers={'Access-Control-Allow-Origin': config['origin'],
                            'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'content-type'})
                        return
                    if request.url == config['endpoint'] and request.method == 'POST':
                        body = json.loads(request.post_data or '{}')
                        item = allowed_queries.get(body.get('query'))
                        assert item and set(body) == {'query', 'variables'} and body['variables'] == item[1], 'Unexpected mainnet request'
                        name = item[0]
                        payload = json.dumps(body).encode()
                        live_request = urllib.request.Request(config['endpoint'], data=payload,
                            headers={'Content-Type': 'application/json', 'Accept': 'application/json', 'Cache-Control': 'no-store'}, method='POST')
                        with urllib.request.urlopen(live_request, timeout=30) as response:
                            assert response.status == 200
                            raw = response.read()
                        parsed = json.loads(raw)
                        assert parsed.get('data') and not parsed.get('errors'), 'Mainnet returned an incomplete read'
                        checkpoint = parsed['data'].get('checkpoint')
                        checkpoints[name] = checkpoint
                        read_counts[name] += 1
                        (OUTPUT / (label + '-' + name + '.json')).write_bytes(raw)
                        network.append({'viewport': width, 'kind': 'fresh-mainnet-read', 'query': name,
                            'requestedAt': stamp(), 'url': config['endpoint'], 'method': 'POST',
                            'responseSha256': sha(raw), 'checkpoint': checkpoint})
                        route.fulfill(status=200, body=raw, headers={'Content-Type': 'application/json',
                            'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': config['origin']})
                        return
                    if url.scheme + '://' + url.netloc == config['origin'] and request.method in ('GET', 'HEAD'):
                        name = 'admin/season-two/index.html' if url.path == '/admin/season-two/' else url.path.lstrip('/')
                        if name in compiled:
                            mime = 'text/javascript' if name.endswith('.mjs') else mimetypes.guess_type(name)[0] or 'application/octet-stream'
                            route.fulfill(status=200, body=compiled[name] if request.method == 'GET' else b'',
                                headers={'Content-Type': mime, 'Cache-Control': 'no-store'})
                            return
                    blocked.append({'url': request.url, 'method': request.method})
                    route.abort('blockedbyclient')

                context.route('**/*', route_request)
                page = context.new_page()
                page.on('pageerror', lambda exc: errors.append(str(exc)))
                page.goto(config['origin'] + '/admin/season-two/', wait_until='domcontentloaded')
                page.wait_for_function("document.getElementById('current-stage').textContent !== 'Reading your garden…'", timeout=60000)
                page.wait_for_function("document.getElementById('chain-status').textContent === 'Mainnet verified' || document.getElementById('chain-status').textContent === 'Read unavailable'", timeout=60000)
                observation = page.evaluate('''() => ({
                    stage: document.getElementById('current-stage').textContent,
                    chainStatus: document.getElementById('chain-status').textContent,
                    chainChecked: document.getElementById('chain-checked').textContent,
                    readMessage: document.getElementById('countdown-note').textContent,
                    checkDisabled: document.getElementById('check-action').disabled,
                    submitDisabled: document.getElementById('submit-action').disabled,
                    walletButtons: document.querySelectorAll('#wallet-list button').length,
                    horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
                    viewportWidth: innerWidth,
                })''')
                observation.update(label=label, readCounts=dict(read_counts), checkpoints=dict(checkpoints),
                    pageErrors=list(errors), unexpectedRequests=list(blocked), screenshot=label + '-live-read-only.png')
                page.screenshot(path=str(OUTPUT / observation['screenshot']), full_page=True)
                observations.append(observation)
                assert observation['stage'] == 'Ready for Season 2' and observation['chainStatus'] == 'Mainnet verified', observation
                assert observation['checkDisabled'] and observation['submitDisabled'] and observation['walletButtons'] == 0
                assert not observation['horizontalOverflow'] and not errors and not blocked, observation
                assert read_counts == {'proof': 1, 'inputs': 1}, read_counts
                context.close()
            browser.close()
        assert all(sha((ROOT / 'dist' / name).read_bytes()) == sha(raw) for name, raw in compiled.items()), 'Compiled output changed during review'
        record['sourceUnchangedDuringReview'] = all(sha((ROOT / name).read_bytes()) == digest for name, digest in source_hashes.items())
        assert record['sourceUnchangedDuringReview'], 'Source changed during review; rebuild and rerun the smoke check'
        record['passed'] = True
    except Exception as cause:
        error = cause
        record['error'] = {'type': type(cause).__name__, 'message': str(cause)}
    finally:
        record['verifiedAt'] = stamp()
        (OUTPUT / 'network.json').write_text(json.dumps(network, indent=2) + '\n')
        (OUTPUT / 'summary.json').write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps({'passed': record['passed'], 'viewports': len(observations), 'mainnetReads': len(network),
        'output': str(OUTPUT), 'error': record.get('error')}))
    if error:
        raise error


if __name__ == '__main__':
    main()
