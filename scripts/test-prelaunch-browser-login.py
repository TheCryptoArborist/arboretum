#!/usr/bin/env python3
"""Hosted native form checks. Never set Origin manually or log codes/cookies.
JavaScript is disabled: login needs none; game HTML verification must not make
wallet or on-chain calls. This is not a full game/wallet integration test.
"""
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'prelaunch-results'
OUT.mkdir(exist_ok=True)
MODE = sys.argv[1]
BASE = sys.argv[2].rstrip('/')
assert MODE in ('before', 'after')
assert urlparse(BASE).scheme == 'https'
assert urlparse(BASE).hostname in ('6ab80d492c4a388d8f76e319--arboretum-sui-forest.netlify.app', 'prelaunch-preview-20260926--arboretum-sui-forest.netlify.app')
PASSWORD = sys.stdin.read().strip() if MODE == 'after' else ''
if MODE == 'after':
    assert len(PASSWORD) >= 32
REPORT = {'mode': MODE, 'url': BASE, 'scope': 'Native Chromium HTML forms over HTTPS; browser-generated request headers; no JavaScript, wallet or transaction execution', 'checks': []}

def check(name, condition):
    REPORT['checks'].append({'check': name, 'passed': bool(condition)})
    if not condition:
        raise RuntimeError(name)

def submit(page, label):
    with page.expect_response(lambda r: r.request.method == 'POST' and urlparse(r.url).path in ('/tester-access', '/tester-logout')) as event:
        page.get_by_role('button', name=label).click()
    response = event.value
    response.finished()
    page.wait_for_load_state('domcontentloaded')
    headers = response.request.all_headers()
    REPORT.setdefault('form_requests', []).append({'path': urlparse(response.url).path, 'status': response.status, 'origin': headers.get('origin'), 'fetch_site': headers.get('sec-fetch-site')})
    return response, headers

def main():
    with sync_playwright() as p:
        executable = os.environ.get('BROWSER_EXECUTABLE')
        browser = p.chromium.launch(headless=True, **({'executable_path': executable} if executable else {}))
        REPORT['browser_version'] = browser.version
        cases = [('desktop', 1440, 1000)] if MODE == 'before' else [('desktop', 1440, 1000), ('mobile', 390, 844)]
        for label, width, height in cases:
            context = browser.new_context(viewport={'width': width, 'height': height}, java_script_enabled=False)
            page = context.new_page()
            page.set_default_timeout(20000)
            response = page.goto(BASE + '/', wait_until='domcontentloaded')
            check(label + ': public landing loads', response.status == 200)
            page.locator('header a.tester-link').click()
            page.wait_for_url('**/tester-access')
            check(label + ': tester form appears', page.locator('input[name=password]').count() == 1)
            page.locator('input[name=password]').fill('intentionally-invalid-browser-probe')
            response, headers = submit(page, 'Enter the testing garden')
            if MODE == 'before':
                check('Old native form reproduces 403', response.status == 403)
                check('Old native form sends null Origin', headers.get('origin') == 'null')
                check('Old response matches user screenshot', page.locator('body').inner_text().strip() == 'Not permitted')
                check('Old attempt issues no tester session', not any(c['name'] == '__Host-arboretum_tester' for c in context.cookies()))
                page.screenshot(path=str(OUT / 'browser-login-before.png'))
                context.close()
                continue
            check(label + ': wrong code reaches password validation', response.status == 401)
            check(label + ': native form preserves correct Origin', headers.get('origin') == BASE)
            check(label + ': wrong code issues no tester session', not any(c['name'] == '__Host-arboretum_tester' for c in context.cookies()))
            check(label + ': error form retains same-origin policy', response.headers.get('referrer-policy') == 'same-origin')
            page.locator('input[name=password]').fill(PASSWORD)
            response, headers = submit(page, 'Enter the testing garden')
            check(label + ': valid native login redirects', response.status == 303)
            check(label + ': valid login sends correct Origin', headers.get('origin') == BASE)
            page.wait_for_url('**/game*')
            check(label + ': original game HTML loads', page.locator('#garden-sec').count() == 1)
            cookies = [c for c in context.cookies() if c['name'] == '__Host-arboretum_tester']
            check(label + ': secure HttpOnly Strict session', len(cookies) == 1 and cookies[0]['httpOnly'] and cookies[0]['secure'] and cookies[0]['sameSite'] == 'Strict')
            response = page.reload(wait_until='domcontentloaded')
            check(label + ': game reload retains authorization', response.status == 200 and page.locator('#garden-sec').count() == 1)
            page.screenshot(path=str(OUT / ('browser-login-after-' + label + '.png')))
            page.goto(BASE + '/tester-access', wait_until='domcontentloaded')
            response, headers = submit(page, "End this browser's tester session")
            check(label + ': native logout redirects', response.status == 303)
            check(label + ': native logout sends correct Origin', headers.get('origin') == BASE)
            check(label + ': logout removes tester cookie', not any(c['name'] == '__Host-arboretum_tester' for c in context.cookies()))
            page.goto(BASE + '/game.html', wait_until='domcontentloaded')
            check(label + ': private navigation denied after logout', urlparse(page.url).path == '/tester-access' and page.locator('#garden-sec').count() == 0)
            context.close()
        browser.close()
    REPORT['passed'] = True

try:
    main()
except Exception as exc:
    REPORT['passed'] = False
    REPORT['error_type'] = type(exc).__name__
finally:
    (OUT / ('browser-login-' + MODE + '.json')).write_text(json.dumps(REPORT, indent=2))
print(json.dumps(REPORT, indent=2))
raise SystemExit(0 if REPORT['passed'] else 1)
