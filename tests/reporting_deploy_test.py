import importlib.util,sys,pathlib,tempfile,json,hashlib,unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'reporting-service'))
spec=importlib.util.spec_from_file_location('isolated_deploy',ROOT/'reporting-service/deploy.py')
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
class Candidate:
    def poll(self):return None
    def wait(self,timeout=None):return 0
class RolloutTest(unittest.TestCase):
    def exercise(self,failure):
        blob=(ROOT/'reporting-service/bundle.json').read_bytes();b=json.loads(blob)
        pointer={'commit':'a'*40,'bundle_sha256':hashlib.sha256(blob).hexdigest(),'release_id':b['release_id']}
        calls=[];notices=[]
        def call(args,**kw):
            calls.append(args)
            if args[0]=='python3' and 'staging' not in args:
                if len(args)>2 and args[1]=='-c':
                    code=args[2]
                    if 'json.load(sys.stdin)' in code:return '/opt/data/petschoice-reporting/releases/'+b['release_id']
                    if 'p.resolve()' in code:return '/opt/data/petschoice-reporting/releases/old-approved'
                    return ''
                if '--phase' in args:
                    phase=args[args.index('--phase')+1]
                    if phase==failure:raise RuntimeError('synthetic source or delivery failure')
                    return '{"ok":true}'
            return ''
        with tempfile.TemporaryDirectory() as td,patch.object(d,'ROOT',pathlib.Path(td)),patch.object(d,'connect_network'),patch.object(d,'download',side_effect=lambda url:json.dumps(pointer).encode() if url.endswith('approved.json') else blob),patch.object(d,'call',side_effect=call),patch.object(d,'notice',side_effect=lambda *a:notices.append(a)),patch.object(d,'container_command',return_value=['synthetic-candidate']),patch.object(d,'stop_container'),patch.object(d.subprocess,'Popen',return_value=Candidate()),patch.object(d,'run') as system,patch.object(d.time,'sleep'):
            system.return_value.returncode=0
            with self.assertRaises(RuntimeError):d.main()
            switches=[a[2] for a in calls if len(a)>2 and a[1]=='-c' and 'current.next' in a[2]]
            if failure=='pre':
                self.assertEqual(switches,[]);system.assert_not_called()
            else:
                self.assertEqual(len(switches),2);self.assertIn('old-approved',switches[-1])
                self.assertEqual(system.call_count,2)
            self.assertEqual(notices[-1][0],'alert')
    def test_bad_source_does_not_activate(self):self.exercise('pre')
    def test_bad_delivery_rolls_back(self):self.exercise('post')
if __name__=='__main__':unittest.main()

