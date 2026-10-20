"""Offline browser review of the emitted settlement integration build.

Run with the isolated Playwright 1.64.0 environment and an explicit Chromium:
  ARBORETUM_REVIEW_CHROMIUM=/path/to/chrome-headless-shell \
    /path/to/venv/bin/python settlement-integration/browser-review.py

Every page request is fulfilled from dist or an explicit GraphQL fixture, or
aborted. No hosted gate, real wallet, live RPC, signature, or submission is used.
Each run creates a fresh evidence directory so a failed run is not overwritten.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import mimetypes
import os
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "http://127.0.0.1:8991"
PACKAGE = "0x6f13fefeb11114a97c3177b7d4a8cfdacd5b40174ab3f80b07420b456d469a2b"
REGISTRY_ID = "0x73672fd5f19137185a3933ea884aacad31eb7a9d41dab0494e628f3cb9b82d50"
OWNER = "0x" + "d" * 64
SEED_ID = "0x" + "e" * 64
FIXTURE_CHECKPOINT = 335949689
FIXTURE_NOW = 1792459947884
CAPTURE_PATH = ROOT / "settlement-integration/release/evidence/20261020-initial/chain-inputs.json"
WALLET_NAME = "Arboretum Offline Review Wallet"


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def b58(raw):
    alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    value = int.from_bytes(raw, "big")
    result = ""
    while value:
        value, digit = divmod(value, 58)
        result = alphabet[digit] + result
    return "1" * (len(raw) - len(raw.lstrip(b"\0"))) + result


def connection(nodes):
    return {"nodes": nodes, "pageInfo": {"hasNextPage": False, "endCursor": None}}


class Fixtures:
    def __init__(self):
        captured = json.loads(CAPTURE_PATH.read_text())
        self.registry = captured["response"]["data"]["registry"]
        self.fail_owned_seeds = False
        fields = {
            "id": SEED_ID, "owner": OWNER, "sapling_id": "0x" + "f" * 64,
            "season_id": "3", "planted_at_ms": "1788383941401",
            "last_watered_ms": "1790548022735", "watering_streak": "2",
            "growth_points": "188", "state": 0, "fertilizer_charges": 0,
            "miracle_grow_applied": False, "revival_charges": 0,
            "bottomless_can_expiry_ms": "0", "permanent_gp_bonus": "0",
        }
        self.seed = {
            "address": SEED_ID, "version": 1,
            "digest": b58(hashlib.sha256(b"Arboretum offline Seed fixture").digest()),
            "owner": {"__typename": "AddressOwner", "address": {"address": OWNER}},
            "asMoveObject": {"contents": {"type": {"repr": PACKAGE + "::arboretum::Seed"}, "json": fields}},
        }

    @staticmethod
    def scoped(value, variables):
        checkpoint = variables.get("cp")
        if checkpoint is not None and checkpoint != FIXTURE_CHECKPOINT:
            raise ValueError("Fixture received a different checkpoint")
        return {"checkpoint": {"sequenceNumber": FIXTURE_CHECKPOINT, "query": value}}

    def read(self, source, variables):
        match = re.match(r"\s*query\s+([A-Za-z_][A-Za-z_0-9]*)", source)
        if not match:
            raise ValueError("Only named, explicit fixture reads are supported")
        operation = match.group(1)
        clock = {"asMoveObject": {"contents": {"json": {"timestamp_ms": str(FIXTURE_NOW)}}}}
        if operation == "IntegrationState":
            if variables.get("registry") != REGISTRY_ID:
                raise ValueError("Unexpected Registry fixture")
            return self.scoped({"registry": deepcopy(self.registry), "clock": clock}, variables)
        if operation == "IntegrationObject":
            object_id = variables.get("id")
            value = self.registry if object_id == REGISTRY_ID else self.seed if object_id == SEED_ID else None
            return self.scoped({"object": deepcopy(value)}, variables)
        if operation in ("IntegrationOwned", "IntegrationAll"):
            seed_type = PACKAGE + "::arboretum::Seed"
            selected = variables.get("type") == seed_type
            if operation == "IntegrationOwned" and variables.get("owner") != OWNER:
                raise ValueError("Unexpected owned-object wallet fixture")
            if operation == "IntegrationOwned" and selected and self.fail_owned_seeds:
                raise RuntimeError("Synthetic owned-Seed read unavailable")
            nodes = [deepcopy(self.seed)] if selected else []
            if operation == "IntegrationOwned":
                for item in nodes:
                    item["contents"] = item.pop("asMoveObject")["contents"]
                return self.scoped({"address": {"objects": connection(nodes)}}, variables)
            return self.scoped({"objects": connection(nodes)}, variables)
        if operation == "IntegrationEvents":
            return self.scoped({"events": connection([])}, variables)
        if operation == "IntegrationName":
            return {"address": {"defaultNameRecord": None}}
        if operation == "IntegrationBalance":
            return {"address": {"balance": {"totalBalance": "5000000000"}}}
        if operation == "GardenSeasonStatus":
            return {"registry": deepcopy(self.registry), "clock": clock}
        raise ValueError("Unhandled fixture query: " + operation)


FAKE_WALLET = """async ({address,name})=>{
  const {getWallets}=await import('/settlement-sdk.bundle.js');
  window.__walletAudit={connect:0,disconnect:0,sign:0,signMethods:[]};
  const account={address,publicKey:new Uint8Array(32),chains:['sui:mainnet'],
    features:['sui:signAndExecuteTransaction','sui:signTransaction','sui:signPersonalMessage']};
  const disabled=method=>async()=>{
    window.__walletAudit.sign++;window.__walletAudit.signMethods.push(method);
    throw Error('SIGNING DISABLED IN OFFLINE REVIEW');
  };
  const wallet={version:'1.0.0',name,
    icon:'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',
    chains:['sui:mainnet'],accounts:[],features:{
      'standard:connect':{version:'1.0.0',connect:async()=>{
        window.__walletAudit.connect++;wallet.accounts=[account];return {accounts:wallet.accounts};}},
      'standard:disconnect':{version:'1.0.0',disconnect:async()=>{
        window.__walletAudit.disconnect++;wallet.accounts=[];}},
      'standard:events':{version:'1.0.0',on:()=>()=>{}},
      'sui:signAndExecuteTransaction':{version:'2.0.0',signAndExecuteTransaction:disabled('signAndExecuteTransaction')},
      'sui:signTransaction':{version:'2.0.0',signTransaction:disabled('signTransaction')},
      'sui:signPersonalMessage':{version:'1.1.0',signPersonalMessage:disabled('signPersonalMessage')},
    }};
  getWallets().register(wallet);
  return address;
}"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist", type=Path, default=ROOT / "dist")
    parser.add_argument("--output", type=Path)
    options = parser.parse_args()
    dist = options.dist.resolve()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    out = (options.output or ROOT / "settlement-integration/verification/browser" / stamp).resolve()
    if not out.is_relative_to((ROOT / "settlement-integration/verification/browser").resolve()):
        raise ValueError("Browser evidence must stay inside verification/browser")
    out.mkdir(parents=True, exist_ok=False)
    checks, network, screenshots = [], [], []
    launch_error = None
    browser_version = None
    build_path = ROOT / "settlement-integration/verification/build.json"
    build = json.loads(build_path.read_text())
    fixtures = Fixtures()

    def check(name, passed, detail=None):
        result = {"check": name, "passed": bool(passed)}
        if detail is not None:
            result["detail"] = detail
        checks.append(result)
        print(("PASS " if passed else "FAIL ") + name, flush=True)

    def capture(page, name):
        # Let the application's normal transient toast expire. Start a full-page
        # capture at the top so a fixed navigation bar does not appear mid-page.
        page.wait_for_function("!document.querySelector('#toast-wrap .toast')", timeout=15000)
        page.evaluate("window.scrollTo({top:0,left:0,behavior:'instant'})")
        page.wait_for_function("window.scrollY===0")
        page.screenshot(path=str(out / name), full_page=True, animations="disabled")
        screenshots.append({"file": name, "sha256": sha(out / name)})

    def visible_snapshot(page):
        return page.evaluate("""()=>({
          protocol:document.getElementById('sr-protocol').textContent,
          owner:document.getElementById('sr-owner').textContent,
          count:document.getElementById('sr-count').textContent,
          state:document.getElementById('sr-state').textContent,
          readStatus:document.getElementById('sr-read-status').textContent,
          entries:[...document.querySelectorAll('#sr-entries .sr-seed')].map(el=>({
            status:el.dataset.rewardStatus,text:el.textContent})),
          projections:Object.fromEntries(['hero-earn-proj','d-sui','r-proj']
            .map(id=>[id,document.getElementById(id)?.textContent])),
          viewport:innerWidth,pageWidth:document.documentElement.scrollWidth
        })""")

    installed = importlib.metadata.version("playwright")
    check("Pinned isolated Playwright version", installed == "1.64.0", installed)
    check("Compiled build declares review-only and transactions disabled",
          build.get("reviewOnly") is True and build.get("transactionSubmissionEnabled") is False)
    check("New seasons remains unconfigured", build.get("newSeasonsConfigured") is False)
    compiled = {}
    for name, expected in build["emittedSha256"].items():
        compiled[name] = sha(dist / name)
        check("Compiled hash matches build manifest: " + name, compiled[name] == expected)

    if all(item["passed"] for item in checks):
        try:
            with sync_playwright() as playwright:
                launch = {"headless": True, "proxy": {"server": "http://127.0.0.1:9"}}
                if os.environ.get("ARBORETUM_REVIEW_CHROMIUM"):
                    launch["executable_path"] = os.environ["ARBORETUM_REVIEW_CHROMIUM"]
                browser = playwright.chromium.launch(**launch)
                browser_version = browser.version
                for width, height in ((1440, 1000), (390, 844)):
                    fixtures.fail_owned_seeds = False
                    context = browser.new_context(viewport={"width": width, "height": height},
                        device_scale_factor=1, timezone_id="UTC", service_workers="block",
                        is_mobile=width == 390, has_touch=width == 390)
                    errors, unexpected, writes, denied, requests, snapshots = [], [], [], [], [], {}

                    def route(handler):
                        request = handler.request
                        parsed = urlsplit(request.url)
                        row = {"host": parsed.netloc, "path": parsed.path, "method": request.method}
                        requests.append(row)
                        cors = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type"}
                        if parsed.netloc == urlsplit(ORIGIN).netloc and request.method == "GET":
                            if parsed.path.startswith("/api/referral/"):
                                row["fixture"] = "unavailable optional referral backend"
                                handler.fulfill(status=404, json={"error": "Offline optional backend fixture"})
                                return
                            filename = unquote(parsed.path).lstrip("/") or "index.html"
                            candidate = (dist / filename).resolve()
                            if candidate.is_relative_to(dist) and candidate.is_file():
                                mime = "text/javascript" if candidate.suffix == ".mjs" else mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
                                handler.fulfill(status=200, content_type=mime, body=candidate.read_bytes())
                            else:
                                unexpected.append({**row, "reason": "Missing compiled local asset"})
                                handler.fulfill(status=404, body="Missing compiled local asset")
                            return
                        if parsed.hostname == "graphql.mainnet.sui.io" and request.method == "OPTIONS":
                            row["fixture"] = "local GraphQL preflight"
                            handler.fulfill(status=204, headers=cors)
                            return
                        if parsed.hostname == "graphql.mainnet.sui.io" and request.method == "POST":
                            try:
                                body = request.post_data_json
                                query = body.get("query", "")
                                if not query.lstrip().startswith("query ") or re.search(r"\b(mutation|executeTransaction|simulateTransaction|dryRunTransaction)\b", query):
                                    writes.append({**row, "reason": "Write or simulation query attempted"})
                                    handler.abort()
                                    return
                                row["operation"] = re.match(r"\s*query\s+(\w+)", query).group(1)
                                row["variables"] = body.get("variables", {})
                                data = fixtures.read(query, body.get("variables", {}))
                                handler.fulfill(status=200, headers=cors, json={"data": data})
                            except RuntimeError as error:
                                row["fixture"] = str(error)
                                handler.fulfill(status=200, headers=cors, json={"errors": [{"message": str(error)}]})
                            except Exception as error:
                                unexpected.append({**row, "reason": str(error)})
                                handler.fulfill(status=200, headers=cors, json={"errors": [{"message": str(error)}]})
                            return
                        denied.append(row)
                        # The existing optional gRPC lookup is a blocked read; no gRPC
                        # request is answered or sent to an actual endpoint.
                        grpc_read = parsed.hostname == "fullnode.mainnet.sui.io" and re.search(r"/(Get|List|BatchGet)\w+$", parsed.path)
                        if request.method not in ("GET", "HEAD") and not grpc_read:
                            writes.append({**row, "reason": "Unexpected write request"})
                        handler.abort()

                    context.route("**/*", route)
                    context.route_web_socket("**/*", lambda socket: socket.close(code=1008, reason="Offline review"))
                    page = context.new_page()
                    page.set_default_timeout(10000)
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    try:
                        page.goto(ORIGIN + "/game.html", wait_until="load")
                        page.wait_for_function("window._walletReady && window.arb && window.arbSettlementPanel")
                        check(f"{width}: compiled wallet and reward panel load", True)
                        check(f"{width}: starts disconnected", page.evaluate("window.arb.getAddress()===null"))
                        nav = page.locator('.nav-a[href="#rewards-sec"]').first
                        if not nav.is_visible() and page.locator("#menu-toggle").is_visible():
                            page.locator("#menu-toggle").click()
                        nav.click()
                        page.wait_for_function("document.getElementById('rewards-sec').classList.contains('active')")
                        check(f"{width}: Rewards navigation opens the panel", page.locator("#settlement-rewards").is_visible())
                        check(f"{width}: disconnected panel asks for connection", "Connect your wallet" in page.locator("#sr-state").inner_text())
                        page.evaluate(FAKE_WALLET, {"address": OWNER, "name": WALLET_NAME})
                        page.locator("#sr-connect").click()
                        page.wait_for_selector("#wallet-modal.open")
                        page.get_by_text(WALLET_NAME, exact=True).click()
                        page.wait_for_function("address=>window.arb.getAddress()===address", arg=OWNER)
                        page.wait_for_function("document.getElementById('sr-count').textContent==='1'")
                        check(f"{width}: panel connection uses the Wallet Standard flow",
                              page.evaluate("window.__walletAudit.connect===1 && document.getElementById('wallet-btn').classList.contains('connected')"))
                        check(f"{width}: synthetic owner remains non-admin", page.evaluate("!window.arb.isAdmin(window.arb.getAddress())") and not page.locator("#admin-nav").is_visible())
                        # The established connection flow opens My Garden. Reopen
                        # Rewards through navigation before measuring its visible UI.
                        if not nav.is_visible() and page.locator("#menu-toggle").is_visible():
                            page.locator("#menu-toggle").click()
                        nav.click()
                        page.wait_for_function("document.getElementById('rewards-sec').classList.contains('active')")
                        check(f"{width}: connected wallet can reopen Rewards", page.locator("#settlement-rewards").is_visible())
                        snapshots["ready"] = visible_snapshot(page)
                        ready = snapshots["ready"]
                        check(f"{width}: existing Seed reward is Under review", ready["count"] == "1" and len(ready["entries"]) == 1 and ready["entries"][0]["status"] == "legacy" and "Under review" in ready["state"], ready)
                        check(f"{width}: projections do not present an unapproved amount", all(value == "Under review" for value in ready["projections"].values()), ready["projections"])
                        check(f"{width}: New seasons navigation is disabled", page.locator('#sr-routes [data-route="settlement"][aria-disabled="true"]').count() == 1)
                        check(f"{width}: Rewards has no page-width overflow", ready["pageWidth"] <= width, {"viewport": width, "pageWidth": ready["pageWidth"]})
                        page.locator("#settlement-rewards").scroll_into_view_if_needed()
                        capture(page, f"rewards-ready-{width}.png")
                        # The old claim controls are intentionally hidden. Exercise their
                        # actual global handler directly, without fabricating eligibility.
                        await_result = page.evaluate("async()=>{await window.doClaimReward();return document.getElementById('sr-action-note').textContent;}")
                        check(f"{width}: legacy claim entry point displays review-only notice", "Review only" in await_result and "transactions are disabled" in await_result, await_result)
                        check(f"{width}: hidden legacy claim zone remains hidden", not page.locator(".reward-zone.claim").is_visible())
                        capture(page, f"claim-review-notice-{width}.png")
                        fixtures.fail_owned_seeds = True
                        page.locator("#sr-refresh").click()
                        page.wait_for_function("document.getElementById('sr-read-status').textContent==='Reward read failed'")
                        snapshots["unavailable"] = visible_snapshot(page)
                        failed = snapshots["unavailable"]
                        check(f"{width}: failed read clears stale Seed rows", failed["entries"] == [] and failed["count"] == "Unavailable", failed)
                        check(f"{width}: failed read is Unavailable rather than zero", "Unavailable" in failed["state"] and all(value == "Unavailable" for value in failed["projections"].values()), failed["projections"])
                        capture(page, f"rewards-unavailable-{width}.png")
                        fixtures.fail_owned_seeds = False
                        page.locator("#sr-refresh").click()
                        page.wait_for_function("document.getElementById('sr-count').textContent==='1'")
                        check(f"{width}: refresh recovers after the fixture read is restored", "Under review" in page.locator("#sr-state").inner_text())
                        audit = page.evaluate("window.__walletAudit")
                        snapshots["walletAudit"] = audit
                        check(f"{width}: no wallet signing method was called", audit["sign"] == 0, audit)
                        before = len([row for row in requests if row.get("operation")])
                        page.goto(ORIGIN + "/settlement-game.html", wait_until="load")
                        check(f"{width}: disabled new-season page explains activation", "awaiting activation" in page.locator("h1").inner_text().lower())
                        check(f"{width}: disabled page links back to the existing garden", page.get_by_role("link", name="Open the existing garden").get_attribute("href") == "/game.html")
                        check(f"{width}: disabled page has no scripts or wallet actions", page.locator("script,button").count() == 0)
                        check(f"{width}: disabled page starts no GraphQL reads", len([row for row in requests if row.get("operation")]) == before)
                        dims = page.evaluate("({viewport:innerWidth,pageWidth:document.documentElement.scrollWidth})")
                        check(f"{width}: disabled page has no width overflow", dims["pageWidth"] <= width, dims)
                        capture(page, f"new-seasons-disabled-{width}.png")
                    except Exception as error:
                        check(f"{width}: browser scenario completed", False, str(error)[:2500])
                        try:
                            capture(page, f"scenario-failure-{width}.png")
                        except Exception:
                            pass
                    finally:
                        if "walletAudit" not in snapshots:
                            try:
                                audit = page.evaluate("window.__walletAudit??null")
                                if audit is not None:
                                    snapshots["walletAudit"] = audit
                                    check(f"{width}: no signing during the incomplete scenario", audit["sign"] == 0, audit)
                            except Exception:
                                pass
                        check(f"{width}: no unhandled page exceptions", not errors, errors)
                        check(f"{width}: all requested local assets and GraphQL fixtures were known", not unexpected, unexpected)
                        check(f"{width}: no write or simulation request attempted", not writes, writes)
                        record = {"width": width, "requests": requests, "blockedExternalRequests": denied,
                            "blockedWrites": writes, "unexpectedFixtureOrAsset": unexpected,
                            "pageErrors": errors, "snapshots": snapshots}
                        network.append(record)
                        (out / f"network-{width}.json").write_text(json.dumps(record, indent=2) + "\n")
                        context.close()
                browser.close()
        except Exception as error:
            launch_error = str(error)
            check("Chromium browser launched and completed", False, launch_error[:3500])

    for name, expected in compiled.items():
        check("Compiled file stayed unchanged during QA: " + name, sha(dist / name) == expected)
    summary = {
        "schemaVersion": 1, "completedAt": datetime.now(timezone.utc).isoformat(),
        "scope": "Offline Chromium review of exact compiled files, at desktop and 390px viewports",
        "playwrightVersion": installed, "browserVersion": browser_version,
        "runnerSha256": sha(__file__), "buildManifestSha256": sha(build_path),
        "compiledFilesSha256": compiled,
        "fixtures": {"kind": "Explicit synthetic wallet, Seed, balance, empty receipt history and failures; captured public Registry shape",
            "syntheticWallet": OWNER, "syntheticSeed": SEED_ID,
            "checkpoint": FIXTURE_CHECKPOINT, "clockMs": FIXTURE_NOW,
            "registryCapture": str(CAPTURE_PATH.relative_to(ROOT)), "registryCaptureSha256": sha(CAPTURE_PATH)},
        "checked": len(checks), "passed": sum(item["passed"] for item in checks),
        "failed": sum(not item["passed"] for item in checks),
        "checks": checks, "screenshots": screenshots,
        "blockedExternalRequestCount": sum(len(row["blockedExternalRequests"]) for row in network),
        "blockedWriteCount": sum(len(row["blockedWrites"]) for row in network),
        "walletSignRequestCount": sum(row["snapshots"].get("walletAudit", {}).get("sign", 0) for row in network),
        "transactionsSubmitted": 0, "realWalletsConnected": 0, "liveRpcRequests": 0,
        "launchError": launch_error,
        "limitations": [
            "This is an offline fixture test, not a hosted tester-gate or authentication test.",
            "The wallet and Seed ownership are synthetic; no genuine wallet account was connected.",
            "Live provider availability, actual funding and real claim execution were not tested.",
            "External fonts/assets and optional gRPC reads are blocked; screenshots use available local/fallback assets.",
            "The hidden legacy claim handler was invoked directly to verify its review-only notice.",
            "New settlement gameplay is unconfigured and was verified only as an unavailable page.",
        ],
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({"output": str(out), "checked": summary["checked"], "passed": summary["passed"],
        "failed": summary["failed"], "transactionsSubmitted": 0, "walletSignRequests": summary["walletSignRequestCount"]}), flush=True)
    return 1 if summary["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
