"""Offline stage-helper checks. No Netlify request or deployment is performed."""
import importlib.util, pathlib, time, unittest
spec = importlib.util.spec_from_file_location('stage', pathlib.Path(__file__).with_name('stage-preview.py'))
stage = importlib.util.module_from_spec(spec); spec.loader.exec_module(stage)
class StageTests(unittest.TestCase):
    def packet(self):
        return {'proxy_url': 'https://netlify-mcp.netlify.app/proxy/fictional-offline-capability',
                'source_sha': 'a'*40, 'confirmed_deploy_id': stage.OLD,
                'scope': 'stage_gated_preview_only', 'expires_at': int(time.time())+300}
    def test_valid_packet(self):
        self.assertTrue(stage.validate_packet(self.packet(), 'a'*40).startswith('https://'))
    def test_plaintext_tester_password_not_accepted(self):
        p=self.packet();p['tester_password']='fixture';self.assertRaises(ValueError,stage.validate_packet,p,'a'*40)
    def test_wrong_source(self):
        self.assertRaises(ValueError,stage.validate_packet,self.packet(),'b'*40)
    def test_wrong_production(self):
        p=self.packet();p['confirmed_deploy_id']='other';self.assertRaises(ValueError,stage.validate_packet,p,'a'*40)
    def test_expired_packet(self):
        p=self.packet();p['expires_at']=int(time.time())-1;self.assertRaises(ValueError,stage.validate_packet,p,'a'*40)
    def test_scope_cannot_approve_production(self):
        p=self.packet();p['scope']='production';self.assertRaises(ValueError,stage.validate_packet,p,'a'*40)
    def test_untrusted_proxy_rejected(self):
        p=self.packet();p['proxy_url']='https://example.com/proxy/fictional';self.assertRaises(ValueError,stage.validate_packet,p,'a'*40)
    def test_additive_only_source(self):
        stage.validate_delta('A\teconomy-review/new.py\nA\t.github/workflows/economy-accounting-review.yml')
        for line in ['M\twallet.js','A\tnetlify/edge-functions/bypass.ts','M\teconomy-review/example.mjs']:
            with self.subTest(line=line):self.assertRaises(ValueError,stage.validate_delta,line)
    def test_envelope_and_secrets_excluded_from_source_zip(self):
        for name in ['economy-review/hosted-envelope.json','.env','.env.example','economy-review-results/hosted/packet.json','.git/config']:
            with self.subTest(name=name):self.assertFalse(stage.include_source(name))
        self.assertTrue(stage.include_source('netlify/edge-functions/tester-gate.ts'))
    def test_preview_build_injection_is_exact(self):
        src=b'command = "node scripts/x.mjs && node scripts/build-season-status.mjs"'
        changed=stage.preview_config(src)
        self.assertIn(b'node economy-review/build-admin-preview.mjs',changed)
        self.assertRaises(ValueError,stage.preview_config,b'unknown build')
        self.assertRaises(ValueError,stage.preview_config,changed)
    def test_staged_does_not_equal_ready(self):
        code=pathlib.Path(stage.__file__).read_text()
        self.assertIn("'tester_ready': False",code)
        self.assertIn("'verification_complete': False",code)
        self.assertIn("'full_hosted_verification_replaced': False",code)
        self.assertNotIn('/restore',code)
        self.assertNotIn('/rollback',code)
if __name__=='__main__':unittest.main(verbosity=2)
