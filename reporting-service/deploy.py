#!/usr/bin/env python3
import fcntl,hashlib,json,os,pathlib,re,subprocess,sys,tempfile,time,urllib.request
from run import command as container_command,stop as stop_container,config as connect_network
ROOT=pathlib.Path('/opt/petschoice-reporting')
DATA='/opt/data/petschoice-reporting'
REPO='https://raw.githubusercontent.com/pl571868110-a11y/remote-mcp-server-authless/'
DOCKER=['docker','exec','--user','hermes','valera-hermes']
def run(args,**kw):return subprocess.run(args,capture_output=True,text=True,timeout=480,**kw)
def call(args,**kw):
    r=run(DOCKER+args,**kw)
    if r.returncode:raise RuntimeError('CONTAINER_STEP_FAILED')
    return r.stdout
def download(url):
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'PetsChoiceReportingUpdater/1.0'}),timeout=60) as r:return r.read(4*1024*1024)
def notice(phase,version):
    try:print(call(['python3',DATA+'/current/verify.py','--phase',phase,'--release',version,'--context','deployment']))
    except Exception:print(json.dumps({'notification':'UNCONFIRMED','phase':phase}))
def main():
    ROOT.mkdir(mode=0o700,parents=True,exist_ok=True)
    lock=open(ROOT/'deploy.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    connect_network()
    pointer=json.loads(download(REPO+'main/reporting-service/approved.json'))
    commit=pointer['commit'];digest=pointer['bundle_sha256'];version=pointer['release_id']
    if not re.fullmatch('[a-f0-9]{40}',commit) or not all(re.fullmatch('[a-f0-9]{64}',v) for v in (digest,version)):raise RuntimeError('POINTER_INVALID')
    state=ROOT/'active.json'
    if state.exists() and json.loads(state.read_text()).get('release_id')==version:print('REPORTING_ALREADY_CURRENT');return
    blob=download(REPO+commit+'/reporting-service/bundle.json')
    if hashlib.sha256(blob).hexdigest()!=digest:raise RuntimeError('BUNDLE_HASH')
    bundle=json.loads(blob)
    canonical=json.dumps(bundle['files'],sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
    if hashlib.sha256(canonical).hexdigest()!=version or bundle['release_id']!=version:raise RuntimeError('RELEASE_ID')
    needed={'server.mjs','policy.mjs','google-ua-collector.mjs','google-ua-token-store.mjs','meta-report.mjs','client.py','verify.py','activate.py'}
    if not needed.issubset(bundle['files']) or len(bundle['files'])>16:raise RuntimeError('INVENTORY')
    for n,f in bundle['files'].items():
        if not re.fullmatch('[a-z0-9-]+[.](mjs|py)',n) or hashlib.sha256(f['source'].encode()).hexdigest()!=f['sha256']:raise RuntimeError('FILE_HASH')
    staging="""import pathlib,json,sys
r=pathlib.Path('/opt/data/petschoice-reporting');b=json.load(sys.stdin);p=r/'releases'/b['release_id'];p.mkdir(parents=True,exist_ok=True,mode=448)
for n,v in b['files'].items():(p/n).write_text(v['source'])
(p/'release.json').write_text(json.dumps({'release_id':b['release_id'],'sha256':{n:v['sha256'] for n,v in b['files'].items()}}))
print(str(p))
"""
    directory=call(['python3','-c',staging],input=blob.decode()).strip()
    previous=call(['python3','-c',"import pathlib;p=pathlib.Path('/opt/data/petschoice-reporting/current');print(str(p.resolve()) if p.exists() else '')"]).strip()
    stop_container('petschoice-reporting-candidate')
    candidate=subprocess.Popen(container_command('petschoice-reporting-candidate',directory+'/server.mjs',8767),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    switched=False
    def switch(path):
        call(['python3','-c',"import pathlib,os;r=pathlib.Path('/opt/data/petschoice-reporting');p=r/'current.next';p.unlink(missing_ok=True);p.symlink_to("+repr(path)+");os.replace(p,r/'current')"])
    try:
        time.sleep(1)
        print(call(['python3',directory+'/verify.py','--phase','pre','--host','petschoice-reporting-candidate','--port','8767','--release',version]))
        stop_container('petschoice-reporting-candidate');candidate.wait(timeout=20)
        switch(directory);switched=True
        if run(['systemctl','restart','petschoice-reporting.service']).returncode:raise RuntimeError('SERVICE_START')
        print(call(['python3',directory+'/verify.py','--phase','post','--release',version]))
        print(call(['python3',directory+'/activate.py']))
        for name in ('google-ua','meta'):
            result=call(['python3','/opt/data/'+name+'-reports/runner.py','--probe'])
            d=json.loads(result)
            ok=d.get('complete') is True if name=='google-ua' else bool(d.get('runs')) and all(len(x.get('accounts',[]))==2 and all(a.get('complete') is True and a.get('status')=='VERIFIED' for a in x['accounts']) for x in d['runs'])
            if not ok:raise RuntimeError('RUNNER_CHECK')
        state.write_text(json.dumps({'release_id':version,'commit':commit,'bundle_sha256':digest,'activated_at':time.time()}));state.chmod(0o600)
        notice('recovered',version)
        print(json.dumps({'ok':True,'release_id':version,'sources':'direct Google Ads and Meta APIs','runners_verified':True}))
    except Exception:
        if candidate.poll() is None:stop_container('petschoice-reporting-candidate')
        if switched:
            if previous:switch(previous);run(['systemctl','restart','petschoice-reporting.service'])
            else:
                run(['systemctl','stop','petschoice-reporting.service'])
                call(['python3','-c',"import pathlib,shutil;[(shutil.copy2(p.with_name('runner.before-isolated-service.py'),p)) for p in [pathlib.Path('/opt/data/google-ua-reports/runner.py'),pathlib.Path('/opt/data/meta-reports/runner.py')] if p.with_name('runner.before-isolated-service.py').exists()]"])
        notice('alert',version);raise
if __name__=='__main__':
    try:main()
    except BlockingIOError:print('DEPLOY_ALREADY_RUNNING')
    except Exception:print(json.dumps({'ok':False,'error':'REPORTING_RELEASE_BLOCKED_OR_ROLLED_BACK'}));sys.exit(1)

