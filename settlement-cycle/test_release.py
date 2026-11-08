"""Offline release-boundary checks. No request reaches Netlify or a wallet."""
from contextlib import ExitStack
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
        commit, tree = 'a' * 40, 'b' * 40
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root, folder = parent / 'source', parent / 'journal'
            root.mkdir(); folder.mkdir()
            (root / 'netlify.toml').write_text('[build]\n')

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
                self.assertEqual(saved['archiveSha256'], cycle.sha((folder / 'source.zip').read_bytes()))
                self.assertEqual(saved['candidateEvidenceSha256'], cycle.sha((folder / 'candidate.json').read_bytes()))
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


if __name__ == '__main__':
    unittest.main()
