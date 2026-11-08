"""Offline release-boundary checks. No request reaches Netlify or a wallet."""
from contextlib import ExitStack, contextmanager
from pathlib import Path
from unittest.mock import patch
import importlib.util
import json
import os
import shutil
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('cycle_release_under_test', Path(__file__).with_name('release.py'))
cycle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cycle)


class ReleaseBoundaryTests(unittest.TestCase):
    def setUp(self):
        cycle.configure_release_mode()
        self.addCleanup(cycle.configure_release_mode)

    def test_baseline_binds_the_published_gate_release_to_exactly_103_source_files(self):
        baseline = cycle.baseline_record()
        self.assertEqual(baseline['publishedDeployId'], '6aeea0b254e028ece344267c')
        self.assertEqual(len(baseline['completePublishedInventory']), 103)
        self.assertEqual(len(baseline['rawDeployedAssets']), 103)
        paths = {item['path'] for item in baseline['completePublishedInventory']}
        self.assertTrue(paths.isdisjoint(cycle.NEW))
        self.assertEqual(next(item['deployedPath'] for item in baseline['completePublishedInventory']
            if item['path'] == 'backgroundA.jpg'), 'backgrounda.jpg')

    def test_modified_baseline_candidate_is_rejected_before_any_network_read(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            for name in ['submission.json', 'candidate.json', 'hosted-assets.json']:
                shutil.copyfile(cycle.BASELINE_DIR / name, folder / name)
            with (folder / 'candidate.json').open('ab') as stream:
                stream.write(b' ')
            with patch.object(cycle, 'BASELINE_DIR', folder), patch.object(cycle.release, 'authorized_request') as network:
                with self.assertRaisesRegex(AssertionError, 'candidate changed'):
                    cycle.baseline_record()
                network.assert_not_called()

    def test_unknown_submission_is_durably_journaled_and_cannot_be_repeated(self):
        for hotfix in [False, True]:
            with self.subTest(hotfix=hotfix):
                cycle.configure_release_mode(hotfix)
                self.check_unknown_submission()

    def check_unknown_submission(self):
        commit, tree = 'a' * 40, 'b' * 40
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root, folder = parent / 'source', parent / 'journal'
            root.mkdir(); folder.mkdir()
            (root / 'netlify.toml').write_text('[build]\n')
            if cycle.RELEASE_MODE == cycle.HOTFIX_MODE:
                (folder / 'ci.json').write_text(json.dumps(ci_record(commit, tree)))

            def command(args, **_kwargs):
                if args == ['git', 'rev-parse', 'HEAD']:
                    return commit.encode() + b'\n'
                if args == ['git', 'rev-parse', commit + '^{tree}']:
                    return tree.encode() + b'\n'
                if args == ['git', 'status', '--porcelain']:
                    return b''
                if args == ['git', 'archive', '--format=zip', commit]:
                    return b'fixture-source-archive'
                self.fail('Unexpected command')

            def lost_response(path, **kwargs):
                self.assertEqual(kwargs['method'], 'POST')
                self.assertTrue(path.startswith('/sites/' + cycle.SITE + '/builds?'))
                saved = json.loads((folder / 'submission.json').read_text())
                self.assertTrue(saved['submissionAttempted'])
                self.assertFalse(saved['responseReceived'])
                self.assertEqual(saved['releaseMode'], cycle.RELEASE_MODE)
                self.assertEqual(saved['previousPublishedDeployId'], cycle.OLD)
                self.assertEqual(saved['archiveSha256'], cycle.sha((folder / 'source.zip').read_bytes()))
                self.assertEqual(saved['candidateEvidenceSha256'], cycle.sha((folder / 'candidate.json').read_bytes()))
                if cycle.RELEASE_MODE == cycle.HOTFIX_MODE:
                    self.assertEqual(saved['ciEvidenceSha256'], cycle.sha((folder / 'ci.json').read_bytes()))
                raise TimeoutError('fixture unknown outcome')

            with ExitStack() as stack:
                stack.enter_context(patch.object(cycle, 'ROOT', root))
                stack.enter_context(patch.object(cycle.subprocess, 'check_output', side_effect=command))
                stack.enter_context(patch.object(cycle, 'preflight', return_value={'passed': True}))
                stack.enter_context(patch.object(cycle, 'preservation', return_value={'existingApplicationFilesPreserved': 103}))
                stack.enter_context(patch.object(cycle.release, 'assert_no_pending_submission'))
                stack.enter_context(patch.object(cycle.release, 'application_inventory', return_value=[]))
                stack.enter_context(patch.object(cycle, 'api', return_value={'published_deploy': {'id': cycle.OLD}}))
                network = stack.enter_context(patch.object(cycle, 'authorized_request', side_effect=lost_response))
                with self.assertRaises(TimeoutError):
                    cycle.submit(folder, commit)
                saved = json.loads((folder / 'submission.json').read_text())
                self.assertEqual(saved['responseError'], 'TimeoutError')
                self.assertFalse(saved['responseReceived'])
                with self.assertRaisesRegex(AssertionError, 'already journaled'):
                    cycle.submit(folder, commit)
                self.assertEqual(network.call_count, 1)
                with self.assertRaisesRegex(AssertionError, 'outcome is unknown'):
                    cycle.release.saved_submission(folder)

    def test_only_the_fixed_target_source_build_can_be_posted(self):
        with patch.object(cycle.urllib.request, 'build_opener') as network:
            for path in ['/sites/' + cycle.ORIGINAL + '/builds?title=test', '/deploys/test', '/sites/' + cycle.SITE + '/deploys']:
                with self.assertRaises(AssertionError):
                    cycle.authorized_request(path, data=b'fixture', method='POST')
            network.assert_not_called()

    def test_absent_normal_auth_stops_before_network_access(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(Path, 'home', return_value=Path(directory)), \
                patch.dict(os.environ, {}, clear=True), patch.object(cycle.urllib.request, 'build_opener') as network:
            with self.assertRaisesRegex(RuntimeError, 'authentication is unavailable'):
                cycle.authorized_request('/sites/' + cycle.SITE)
            network.assert_not_called()

    def test_standard_environment_and_canonical_cli_auth_are_supported(self):
        for use_environment in [True, False]:
            with self.subTest(environment=use_environment), tempfile.TemporaryDirectory() as directory:
                folder = Path(directory)
                token = 'offline-fixture-token'
                config = folder / '.config/netlify/config.json'
                config.parent.mkdir(parents=True)
                config.write_text(json.dumps({'userId': 'fixture', 'users': {'fixture': {'auth': {'token': token}}}}))
                with patch.object(Path, 'home', return_value=folder), \
                        patch.dict(os.environ, {'NETLIFY_AUTH_TOKEN': token} if use_environment else {}, clear=True), \
                        patch.object(cycle.urllib.request, 'build_opener') as opener:
                    response = opener.return_value.open.return_value.__enter__.return_value
                    response.read.return_value, response.status = b'{}', 200
                    self.assertEqual(cycle.authorized_request('/sites/' + cycle.SITE), (b'{}', 200))
                    request = opener.return_value.open.call_args.args[0]
                    self.assertEqual(request.get_header('Authorization'), 'Bearer ' + token)
                    self.assertEqual(request.full_url, cycle.release.API + '/sites/' + cycle.SITE)
                    opener.assert_called_once_with(cycle.release.NoRedirect)

    def test_serving_normalization_accepts_only_the_recorded_anchor_transform(self):
        source = b'<p>Unchanged</p><a href="player-guide.html#watering" class="back">Go</a><script src="/stable.js"></script>'
        served = b"<p>Unchanged</p><a class='back' href='/player-guide#watering'>Go</a><script src=\"/stable.js\"></script>"
        changes = cycle.verify_served_html(source, served, cycle.ORIGIN + '/game.html')
        self.assertEqual(len(changes), 1)
        self.assertEqual(cycle.verify_served_html(source, source, cycle.ORIGIN + '/game.html'), [])
        for changed in [served.replace(b'Unchanged', b'Altered'), served.replace(b'Go</a>', b'Different</a>'),
                served.replace(b"class='back'", b"class='other'"), served.replace(b'/player-guide#watering', b'https://example.invalid/'),
                served.replace(b'/stable.js', b'/changed.js')]:
            with self.subTest(changed=changed), self.assertRaises(AssertionError):
                cycle.verify_served_html(source, changed, cycle.ORIGIN + '/game.html')


def ci_record(commit='a' * 40, tree='b' * 40):
    return {'sourceCommit': commit, 'sourceTree': tree, 'requiredCI': [
        {'id': index, 'event': event, 'conclusion': 'success',
         'url': 'https://github.com/TheCryptoArborist/arboretum/actions/runs/' + str(index)}
        for index, event in [(1, 'push'), (2, 'pull_request')]]}


class PlantFieldsHotfixTests(unittest.TestCase):
    def setUp(self):
        cycle.configure_release_mode(True)
        self.addCleanup(cycle.configure_release_mode)

    @contextmanager
    def application_fixture(self):
        published = cycle.baseline_record()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inventory, raw_assets = [], []
            for item in published['completePublishedInventory']:
                path = root / 'dist' / item['path']; path.parent.mkdir(parents=True, exist_ok=True)
                data = ('fixture for ' + item['path'] + '\n').encode(); path.write_bytes(data)
                inventory.append({'path': item['path'], 'sha1': cycle.sha(data, 'sha1'), 'bytes': len(data)})
                raw_assets.append({'path': item['path'], 'sha256': cycle.sha(data)})
            config = b'[build]\n'; (root / 'netlify.toml').write_bytes(config)
            baseline = {'completePublishedInventory': inventory, 'rawDeployedAssets': raw_assets,
                'additionalPublishedSourceConfig': {'sha256': cycle.sha(config)}}
            with patch.object(cycle, 'ROOT', root), patch.object(cycle.release, 'ROOT', root), \
                    patch.object(cycle, 'baseline_record', return_value=baseline):
                yield root

    def test_hotfix_uses_only_the_verified_initial_season_two_publication(self):
        baseline = cycle.baseline_record()
        self.assertEqual(cycle.OLD, '6af08867e808541bad23b5b2')
        self.assertEqual(cycle.release.OLD, cycle.OLD)
        self.assertEqual(baseline['sourceUpload']['sourceCommit'], cycle.HOTFIX_SOURCE)
        self.assertEqual(baseline['sourceUpload']['sourceTree'], cycle.HOTFIX_TREE)
        self.assertEqual(len(baseline['completePublishedInventory']), 106)
        self.assertEqual(len(baseline['rawDeployedAssets']), 106)
        self.assertEqual(cycle.NEW, [])
        self.assertEqual(cycle.release.CHANGED, {'admin/season-two/admin.mjs'})

    def test_wrong_or_modified_baseline_evidence_is_rejected_without_auth(self):
        for change in ['deployment', 'source', 'candidate-bytes', 'inventory', 'raw-assets']:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                folder = Path(directory)
                for name in ['submission.json', 'candidate.json', 'hosted-assets.json']:
                    shutil.copyfile(cycle.BASELINE_DIR / name, folder / name)
                if change == 'candidate-bytes':
                    with (folder / 'candidate.json').open('ab') as stream: stream.write(b' ')
                else:
                    name = 'submission.json' if change in ['deployment', 'source'] else 'hosted-assets.json'
                    value = json.loads((folder / name).read_text())
                    if change == 'deployment': value['deployId'] = '0' * 24
                    elif change == 'source': value['sourceCommit'] = '0' * 40
                    elif change == 'inventory': value['completePublishedInventory'][0]['sha1'] = '0' * 40
                    else: value['rawDeployedAssets'][0]['sha256'] = '0' * 64
                    (folder / name).write_text(json.dumps(value))
                with patch.object(cycle, 'BASELINE_DIR', folder), \
                        patch.object(cycle.release, 'authorized_request') as network:
                    with self.assertRaises(AssertionError): cycle.baseline_record()
                    network.assert_not_called()

    def test_preflight_uses_the_new_pinned_baseline_and_all_106_records(self):
        baseline = cycle.baseline_record()
        inventory = [{'path': x.get('deployedPath', x['path']), 'sha': x['sha1'], 'size': x['bytes']}
            for x in baseline['completePublishedInventory']]
        inventory.extend([{'path': 'netlify.toml'}] +
            [{'path': '.netlify/internal/edge-functions/' + name} for name in ['manifest.json', 'one.js', 'two.js']])
        with patch.object(cycle.release, 'backend_snapshot', return_value={'publishedDeployId': cycle.HOTFIX_DEPLOY}) as backend, \
                patch.object(cycle.release, 'api', return_value=inventory) as api:
            result = cycle.preflight()
        backend.assert_called_once_with(cycle.HOTFIX_DEPLOY)
        api.assert_called_once_with('/deploys/' + cycle.HOTFIX_DEPLOY + '/files')
        self.assertEqual(result['existingApplicationFileCount'], 106)
        self.assertEqual(result['expectedChangedApplicationFiles'], [cycle.HOTFIX_FILE])
        self.assertEqual(result['expectedAddedRuntimeFiles'], [])

    def test_only_the_changed_bundle_is_allowed_and_105_files_are_preserved(self):
        with self.application_fixture() as root:
            with self.assertRaisesRegex(AssertionError, 'nonempty and changed'): cycle.preservation()
            (root / 'dist' / cycle.HOTFIX_FILE).write_bytes(b'fixture corrected bundle')
            result = cycle.preservation()
            self.assertEqual(result['existingApplicationFilesPreserved'], 105)
            self.assertEqual(result['completeApplicationFileCount'], 106)
            self.assertEqual(result['changedApplicationFiles'], [cycle.HOTFIX_FILE])
            self.assertEqual(result['addedRuntimeFiles'], [])
            self.assertTrue(result['allOtherApplicationBytesUnchanged'])

    def test_changes_to_other_files_inventory_or_source_config_are_rejected(self):
        for change in ['html', 'css', 'added', 'deleted', 'empty-bundle', 'symlink', 'configuration']:
            with self.subTest(change=change), self.application_fixture() as root:
                bundle = root / 'dist' / cycle.HOTFIX_FILE
                bundle.write_bytes(b'fixture corrected bundle')
                if change == 'html': (root / 'dist/admin/season-two/index.html').write_bytes(b'changed')
                elif change == 'css': (root / 'dist/admin/season-two/admin.css').write_bytes(b'changed')
                elif change == 'added': (root / 'dist/extra.js').write_bytes(b'extra')
                elif change == 'deleted': (root / 'dist/game.html').unlink()
                elif change == 'empty-bundle': bundle.write_bytes(b'')
                elif change == 'symlink':
                    bundle.unlink(); bundle.symlink_to(root / 'dist/admin/season-two/admin.css')
                else: (root / 'netlify.toml').write_bytes(b'[build]\ncommand="different"\n')
                with self.assertRaises(AssertionError): cycle.preservation()

    def test_ci_requires_the_exact_source_and_both_successful_events(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            with self.assertRaisesRegex(AssertionError, 'requires ci.json'):
                cycle.ci_evidence_hash(folder, 'a' * 40, 'b' * 40)
            (folder / 'ci.json').write_text(json.dumps(ci_record()))
            self.assertEqual(cycle.ci_evidence_hash(folder, 'a' * 40, 'b' * 40), cycle.sha((folder / 'ci.json').read_bytes()))
            for change in ['commit', 'tree', 'missing-pr', 'failure', 'duplicate-id', 'foreign-url']:
                with self.subTest(change=change):
                    value = ci_record()
                    if change == 'commit': value['sourceCommit'] = 'c' * 40
                    elif change == 'tree': value['sourceTree'] = 'd' * 40
                    elif change == 'missing-pr': value['requiredCI'].pop()
                    elif change == 'failure': value['requiredCI'][1]['conclusion'] = 'failure'
                    elif change == 'duplicate-id':
                        value['requiredCI'][1]['id'] = 1
                        value['requiredCI'][1]['url'] = value['requiredCI'][0]['url']
                    else: value['requiredCI'][1]['url'] = 'https://example.invalid/2'
                    (folder / 'ci.json').write_text(json.dumps(value))
                    with self.assertRaises(AssertionError): cycle.ci_evidence_hash(folder, 'a' * 40, 'b' * 40)

    def test_saved_hotfix_requires_its_mode_and_bound_ci_for_followup_operations(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / 'ci.json').write_text(json.dumps(ci_record()))
            record = {'siteId': cycle.SITE, 'releaseMode': cycle.HOTFIX_MODE,
                'sourceCommit': 'a' * 40, 'sourceTree': 'b' * 40,
                'previousPublishedDeployId': cycle.HOTFIX_DEPLOY, 'originalPublishedDeployId': cycle.ORIGINAL_DEPLOY,
                'submissionAttempted': True, 'responseReceived': True, 'deployId': 'c' * 24,
                'ciEvidenceSha256': cycle.ci_evidence_hash(folder, 'a' * 40, 'b' * 40)}
            (folder / 'submission.json').write_text(json.dumps(record))
            self.assertEqual(cycle.release.saved_submission(folder), record)
            cycle.configure_release_mode()
            with self.assertRaisesRegex(AssertionError, 'use --plant-fields-hotfix'):
                cycle.release.saved_submission(folder)
            cycle.configure_release_mode(True)
            with (folder / 'ci.json').open('ab') as stream: stream.write(b' ')
            with self.assertRaisesRegex(AssertionError, 'CI evidence changed'):
                cycle.release.saved_submission(folder)


if __name__ == '__main__':
    unittest.main()
