import importlib.util,json,pathlib,tempfile,unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('notice_verifier',ROOT/'reporting-service/verify.py');v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
class NoticeTest(unittest.TestCase):
    def test_release_canary_closes_both_incidents_without_duplicate_recovery(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(v,'ROOT',pathlib.Path(tmp)),patch.object(v,'modules',return_value=[]):
            for context in ('service','deployment'):
                (v.ROOT/('notice-'+context+'.json')).write_text(json.dumps({'open':True,'incident':context}))
            with patch.object(v,'send_notice',wraps=v.send_notice) as send:
                v.finish_check('post','synthetic-release')
                self.assertEqual([x.args[0] for x in send.call_args_list],['post'])
            for context in ('service','deployment'):
                self.assertFalse(json.loads((v.ROOT/('notice-'+context+'.json')).read_text())['open'])
                self.assertEqual(v.send_notice('recovered','synthetic-release',context),[])
    def test_failed_canary_keeps_incident_open(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(v,'ROOT',pathlib.Path(tmp)):
            p=v.ROOT/'notice-service.json';p.write_text('{"open":true,"incident":"synthetic"}')
            with patch.object(v,'send_notice',side_effect=RuntimeError('DELIVERY_UNCONFIRMED')):
                with self.assertRaises(RuntimeError):v.finish_check('post','synthetic-release')
            self.assertTrue(json.loads(p.read_text())['open'])
