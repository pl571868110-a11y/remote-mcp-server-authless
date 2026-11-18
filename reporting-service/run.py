import json,pathlib,re,subprocess,sys
ROOT=pathlib.Path('/opt/petschoice-reporting')
DATA='/opt/data/petschoice-reporting'
NETWORK='petschoice-reporting'
def config():
    image=(ROOT/'runtime-image').read_text().strip()
    if not re.fullmatch(r'node@sha256:[a-f0-9]{64}',image):raise RuntimeError('UNPINNED_RUNTIME')
    info=json.loads(subprocess.check_output(['docker','inspect','valera-hermes','--format','{{json .Mounts}}']))
    mount=next(x['Source'] for x in info if x['Destination']=='/opt/data')+'/petschoice-reporting'
    if subprocess.run(['docker','network','inspect',NETWORK],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode:
        subprocess.run(['docker','network','create',NETWORK],check=True,stdout=subprocess.DEVNULL)
    subprocess.run(['docker','network','connect',NETWORK,'valera-hermes'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    return image,mount
def command(name,script,port):
    image,mount=config()
    return ['docker','run','--rm','--name',name,'--label','com.petschoice.reporting=true','--network',NETWORK,'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--user','10000:10000','--mount','type=bind,src='+mount+',dst='+DATA+',readonly','--tmpfs','/tmp:rw,noexec,nosuid,size=16m','-e','PCC_REPORT_BIND=0.0.0.0','-e','PCC_REPORT_PORT='+str(port),image,'node',script]
def stop(name):
    r=subprocess.run(['docker','inspect',name,'--format','{{index .Config.Labels "com.petschoice.reporting"}}'],capture_output=True,text=True)
    if not r.returncode:
        if r.stdout.strip()!='true':raise RuntimeError('UNOWNED_CONTAINER')
        subprocess.run(['docker','stop','-t','15',name],check=True,stdout=subprocess.DEVNULL)
if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='--connect':config()
    else:raise SystemExit(subprocess.call(command('petschoice-reporting',DATA+'/current/server.mjs',8766)))

