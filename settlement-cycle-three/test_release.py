"""Offline checks for the 106-preserved-plus-three source-build boundary."""
from contextlib import ExitStack, contextmanager
from pathlib import Path
from unittest.mock import patch
import importlib.util
import json
import os
import shutil
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('focused_cycle_release_under_test', Path(__file__).with_name('release.py'))
cycle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cycle)


def ci_record(commit='a' * 40, tree='b' * 40):
    return {'sourceCommit': commit, 'sourceTree': tree, 'requiredCI': [
        {'id': index, 'event': event, 'conclusion': 'success', 'status': 'completed',
         'headSha': commit, 'name': 'Settlement app integration review',
         'path': '.github/workflows/settlement-integration.yml',
         'url': 'https://github.com/TheCryptoArborist/arboretum/actions/runs/' + str(index)}
        for index, event in [(1, 'push'), (2, 'pull_request')]]}


class FocusedCycleReleaseTests(unittest.TestCase):
    def test_fixed_baseline_is_the_verified_hotfix_publication_with_106_assets(self):
        baseline = cycle.baseline_record()
        self.assertEqual(cycle.OLD, '6af09274b50143d105dbb63a')
        self.assertEqual(cycle.release.OLD, cycle.OLD)
        self.assertEqual(baseline['sourceUpload']['sourceCommit'], cycle.BASELINE_SOURCE)
        self.assertEqual(baseline['sourceUpload']['sourceTree'], cycle.BASELINE_TREE)
        self.assertEqual(len(baseline['completePublishedInventory']), 106)
        self.assertEqual(len(baseline['rawDeployedAssets']), 106)
        self.assertTrue(set(cycle.NEW).isdisjoint(item['path'] for item in baseline['completePublishedInventory']))
        self.assertEqual(cycle.release.CHANGED, set())
        self.assertEqual(cycle.release.NAVIGATION_ADDITIONS, {})
        self.assertEqual(next(item['deployedPath'] for item in baseline['completePublishedInventory']
            if item['path'] == 'backgroundA.jpg'), 'backgrounda.jpg')

    def test_tampered_baseline_is_rejected_before_any_network_access(self):
        for change in ['deploy', 'source', 'candidate-bytes', 'inventory', 'raw-assets']:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                folder = Path(directory)
                for name in ['submission.json', 'candidate.json', 'hosted-assets.json']:
                    shutil.copyfile(cycle.BASELINE_DIR / name, folder / name)
                if change == 'candidate-bytes':
                    with (folder / 'candidate.json').open('ab') as stream: stream.write(b' ')
                else:
                    name = 'submission.json' if change in ['deploy', 'source'] else 'hosted-assets.json'
                    value = json.loads((folder / name).read_text())
                    if change == 'deploy': value['deployId'] = '0' * 24
                    elif change == 'source': value['sourceCommit'] = '0' * 40
                    elif change == 'inventory': value['completePublishedInventory'][0]['sha1'] = '0' * 40
                    else: value['rawDeployedAssets'][0]['sha256'] = '0' * 64
                    (folder / name).write_text(json.dumps(value))
                with patch.object(cycle, 'BASELINE_DIR', folder), patch.object(cycle.release, 'authorized_request') as network:
                    with self.assertRaises(AssertionError): cycle.preflight()
                    network.assert_not_called()

    def test_preflight_checks_the_fixed_backend_and_complete_published_inventory(self):
        baseline = cycle.baseline_record()
        inventory = [{'path': x.get('deployedPath', x['path']), 'sha': x['sha1'], 'size': x['bytes']}
            for x in baseline['completePublishedInventory']]
        inventory.extend([{'path': 'netlify.toml'}] +
            [{'path': '.netlify/internal/edge-functions/' + name} for name in ['manifest.json', 'one.js', 'two.js']])
        with patch.object(cycle.release, 'backend_snapshot', return_value={'publishedDeployId': cycle.OLD}) as backend, \
                patch.object(cycle.release, 'api', return_value=inventory) as api:
            result = cycle.preflight()
        backend.assert_called_once_with(cycle.OLD)
        api.assert_called_once_with('/deploys/' + cycle.OLD + '/files')
        self.assertEqual(result['existingApplicationFileCount'], 106)
        self.assertEqual(result['expectedChangedApplicationFiles'], [])
        self.assertEqual(result['expectedAddedRuntimeFiles'], cycle.NEW)
        self.assertEqual(result['preservedBackendAndDependencySha256'], cycle.PRESERVED_SOURCE_SHA256)

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
            for name in cycle.NEW:
                path = root / 'dist' / name; path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(('new fixture for ' + name).encode())
            baseline = {'completePublishedInventory': inventory, 'rawDeployedAssets': raw_assets}
            with patch.object(cycle, 'ROOT', root), patch.object(cycle.release, 'ROOT', root), \
                    patch.object(cycle.release, 'baseline_record', return_value=baseline), \
                    patch.object(cycle, 'preserved_sources', return_value=cycle.PRESERVED_SOURCE_SHA256):
                yield root

    def test_only_three_additions_preserve_every_existing_asset(self):
        with self.application_fixture():
            result = cycle.preservation()
            self.assertEqual(result['existingApplicationFilesPreserved'], 106)
            self.assertEqual(result['completeApplicationFileCount'], 109)
            self.assertEqual(result['changedApplicationFiles'], [])
            self.assertEqual(result['addedRuntimeFiles'], cycle.NEW)
            self.assertTrue(result['allPreviousApplicationBytesUnchanged'])

    def test_existing_changes_missing_files_extra_files_and_symlinks_are_rejected(self):
        for change in ['season-two-js', 'season-two-html', 'css', 'added', 'deleted', 'empty-new', 'file-symlink', 'directory-symlink']:
            with self.subTest(change=change), self.application_fixture() as root:
                if change == 'season-two-js': (root / 'dist/admin/season-two/admin.mjs').write_bytes(b'changed')
                elif change == 'season-two-html': (root / 'dist/admin/season-two/index.html').write_bytes(b'changed')
                elif change == 'css': (root / 'dist/admin/season-two/admin.css').write_bytes(b'changed')
                elif change == 'added': (root / 'dist/extra.js').write_bytes(b'extra')
                elif change == 'deleted': (root / 'dist/game.html').unlink()
                elif change == 'empty-new': (root / 'dist' / cycle.NEW[2]).write_bytes(b'')
                elif change == 'file-symlink':
                    file = root / 'dist' / cycle.NEW[2]
                    file.unlink(); file.symlink_to(root / 'dist/admin/season-two/admin.mjs')
                else: (root / 'dist/linked-dir').symlink_to(root / 'dist/admin/season-two', target_is_directory=True)
                with self.assertRaises(AssertionError): cycle.preservation()

    def test_backend_edge_config_and_locked_dependencies_are_pinned(self):
        real_root = cycle.ROOT
        for change in [None, *cycle.PRESERVED_SOURCE_SHA256, 'new-backend-file', 'symlink']:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                for name in cycle.PRESERVED_SOURCE_SHA256:
                    file = root / name; file.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(real_root / name, file)
                if change in cycle.PRESERVED_SOURCE_SHA256:
                    with (root / change).open('ab') as stream: stream.write(b'\n')
                elif change == 'new-backend-file': (root / 'netlify/functions/extra.js').write_text('export default () => null;')
                elif change == 'symlink':
                    file = root / 'netlify.toml'; file.unlink(); file.symlink_to(real_root / 'netlify.toml')
                with patch.object(cycle, 'ROOT', root):
                    if change is None: self.assertEqual(cycle.preserved_sources(), cycle.PRESERVED_SOURCE_SHA256)
                    else:
                        with self.assertRaises(AssertionError): cycle.preserved_sources()

    def test_required_ci_binds_workflow_events_status_and_exact_source(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            with self.assertRaisesRegex(AssertionError, 'requires ci.json'):
                cycle.ci_evidence_hash(folder, 'a' * 40, 'b' * 40)
            (folder / 'ci.json').write_text(json.dumps(ci_record()))
            self.assertEqual(cycle.ci_evidence_hash(folder, 'a' * 40, 'b' * 40), cycle.sha((folder / 'ci.json').read_bytes()))
            for change in ['commit', 'tree', 'missing-pr', 'failure', 'duplicate-id', 'foreign-url', 'head', 'name', 'path', 'pending']:
                with self.subTest(change=change):
                    value = ci_record()
                    if change == 'commit': value['sourceCommit'] = 'c' * 40
                    elif change == 'tree': value['sourceTree'] = 'd' * 40
                    elif change == 'missing-pr': value['requiredCI'].pop()
                    elif change == 'failure': value['requiredCI'][1]['conclusion'] = 'failure'
                    elif change == 'duplicate-id':
                        value['requiredCI'][1]['id'] = 1
                        value['requiredCI'][1]['url'] = value['requiredCI'][0]['url']
                    elif change == 'foreign-url': value['requiredCI'][1]['url'] = 'https://example.invalid/2'
                    elif change == 'head': value['requiredCI'][1]['headSha'] = 'c' * 40
                    elif change == 'name': value['requiredCI'][1]['name'] = 'Some unrelated workflow'
                    elif change == 'path': value['requiredCI'][1]['path'] = '.github/workflows/another.yml'
                    else: value['requiredCI'][1]['status'] = 'in_progress'
                    (folder / 'ci.json').write_text(json.dumps(value))
                    with self.assertRaises(AssertionError): cycle.ci_evidence_hash(folder, 'a' * 40, 'b' * 40)

    def test_unknown_submission_is_durably_journaled_and_cannot_be_repeated(self):
        commit, tree = 'a' * 40, 'b' * 40
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root, folder = parent / 'source', parent / 'journal'
            root.mkdir(); folder.mkdir()
            (root / 'netlify.toml').write_text('[build]\n')
            (folder / 'ci.json').write_text(json.dumps(ci_record(commit, tree)))

            def command(args, **_kwargs):
                if args == ['git', 'rev-parse', 'HEAD']: return commit.encode() + b'\n'
                if args == ['git', 'rev-parse', commit + '^{tree}']: return tree.encode() + b'\n'
                if args == ['git', 'status', '--porcelain']: return b''
                if args == ['git', 'archive', '--format=zip', commit]: return b'fixture-source-archive'
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
                self.assertEqual(saved['ciEvidenceSha256'], cycle.sha((folder / 'ci.json').read_bytes()))
                raise TimeoutError('fixture unknown outcome')

            with ExitStack() as stack:
                stack.enter_context(patch.object(cycle, 'ROOT', root))
                stack.enter_context(patch.object(cycle.subprocess, 'check_output', side_effect=command))
                stack.enter_context(patch.object(cycle, 'preflight', return_value={'passed': True}))
                stack.enter_context(patch.object(cycle, 'preservation', return_value={'existingApplicationFilesPreserved': 106}))
                stack.enter_context(patch.object(cycle.release, 'assert_no_pending_submission'))
                stack.enter_context(patch.object(cycle.release, 'application_inventory', return_value=[]))
                stack.enter_context(patch.object(cycle, 'api', return_value={'published_deploy': {'id': cycle.OLD}}))
                network = stack.enter_context(patch.object(cycle, 'authorized_request', side_effect=lost_response))
                with self.assertRaises(TimeoutError): cycle.submit(folder, commit)
                saved = json.loads((folder / 'submission.json').read_text())
                self.assertEqual(saved['responseError'], 'TimeoutError')
                self.assertFalse(saved['responseReceived'])
                with self.assertRaisesRegex(AssertionError, 'already journaled'): cycle.submit(folder, commit)
                self.assertEqual(network.call_count, 1)
                with self.assertRaisesRegex(AssertionError, 'outcome is unknown'): cycle.saved_submission(folder)

    def test_only_the_fixed_target_source_build_can_be_posted(self):
        with patch.object(cycle.urllib.request, 'build_opener') as network:
            for path in ['/sites/' + cycle.ORIGINAL + '/builds?title=test', '/deploys/test', '/sites/' + cycle.SITE + '/deploys']:
                with self.assertRaises(AssertionError): cycle.authorized_request(path, data=b'fixture', method='POST')
            network.assert_not_called()

    def test_missing_normal_auth_stops_without_network_or_other_credential_sources(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(Path, 'home', return_value=Path(directory)), \
                patch.dict(os.environ, {}, clear=True), patch.object(cycle.urllib.request, 'build_opener') as network:
            with self.assertRaisesRegex(RuntimeError, 'authentication is unavailable'):
                cycle.authorized_request('/sites/' + cycle.SITE)
            network.assert_not_called()

    def test_saved_submission_requires_its_boundary_and_unchanged_ci_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / 'ci.json').write_text(json.dumps(ci_record()))
            record = {'siteId': cycle.SITE, 'releaseMode': cycle.RELEASE_MODE,
                'sourceCommit': 'a' * 40, 'sourceTree': 'b' * 40,
                'previousPublishedDeployId': cycle.OLD, 'originalPublishedDeployId': cycle.ORIGINAL_DEPLOY,
                'submissionAttempted': True, 'responseReceived': True, 'deployId': 'c' * 24,
                'ciEvidenceSha256': cycle.ci_evidence_hash(folder, 'a' * 40, 'b' * 40)}
            (folder / 'submission.json').write_text(json.dumps(record))
            self.assertEqual(cycle.saved_submission(folder), record)
            for mode in ['initial', 'plant-fields-hotfix']:
                (folder / 'submission.json').write_text(json.dumps({**record, 'releaseMode': mode}))
                with self.assertRaisesRegex(AssertionError, 'different release boundary'): cycle.saved_submission(folder)
            (folder / 'submission.json').write_text(json.dumps(record))
            with (folder / 'ci.json').open('ab') as stream: stream.write(b' ')
            with self.assertRaisesRegex(AssertionError, 'CI evidence changed'): cycle.saved_submission(folder)


if __name__ == '__main__':
    unittest.main()
