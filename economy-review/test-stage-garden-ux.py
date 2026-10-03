"""Offline tests only; no capability, credential, or deploy request."""
import importlib.util,pathlib,unittest
ROOT=pathlib.Path(__file__).parent

def load():
 spec=importlib.util.spec_from_file_location('stagegarden',ROOT/'stage-garden-ux.py')
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 return module

class GardenStageTests(unittest.TestCase):
 def test_default_stage_is_unchanged(self):
  m=load();self.assertEqual(m.stage.BRANCH,'partner-reconciliation-preview-20261003')
 def test_only_branch_and_command_overridden(self):
  m=load();target=m.stage;before=dict(vars(target));m.configure(target)
  changed={k for k,v in before.items() if vars(target).get(k) is not v}
  self.assertEqual(changed,{'BRANCH','preview_config'})
  self.assertEqual(target.SITE,'a344fb31-10b4-4eea-9562-067d90a39607')
  self.assertEqual(target.BRANCH,'garden-ux-preview-20261003')
 def test_exact_build_order_and_single_application(self):
  m=load();m.configure(m.stage)
  original=b'command = "node scripts/build-season-status.mjs"' # missing expected pipeline anchor must fail
  self.assertRaises(ValueError,m.stage.preview_config,original)
  source=b'command = "node scripts/start.mjs && node scripts/build-season-status.mjs"'
  expected=b'command = "node scripts/start.mjs && node scripts/build-season-status.mjs && node economy-review/build-admin-preview.mjs && node economy-review/build-garden-ux-preview.mjs"'
  self.assertEqual(m.stage.preview_config(source),expected)
  self.assertRaises(ValueError,m.stage.preview_config,expected)
 def test_requires_test_evidence_before_stage(self):
  code=(ROOT/'stage-garden-ux.py').read_text()
  self.assertLess(code.index("report['failed']==0"),code.index('stage.main()'))
  self.assertIn("'tester_ready':False",code)
  self.assertNotIn('ARBORETUM_TESTER_PASSWORD',code)
  self.assertNotIn('/restore',code)
  self.assertNotIn('/rollback',code)

if __name__=='__main__':unittest.main(verbosity=2)
