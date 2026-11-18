import pathlib,re,shutil,json,runpy,urllib.request
root=pathlib.Path('/opt/data/petschoice-reporting')
cfg=runpy.run_path(str(root/'current/client.py'))['config'];headers,_=cfg()
with urllib.request.urlopen(urllib.request.Request('http://petschoice-reporting:8766/health',headers=headers),timeout=240) as r:
    if json.load(r).get('ok') is not True:raise RuntimeError('HEALTH_FAILED')
for name in ('google-ua','meta'):
    p=pathlib.Path('/opt/data/'+name+'-reports/runner.py');s=p.read_text();backup=p.with_name('runner.before-isolated-service.py')
    if not backup.exists():shutil.copy2(p,backup)
    s=re.sub(r"^BASE=.*$","BASE='http://petschoice-reporting:8766/"+('google-ua-report' if name=='google-ua' else 'meta-report')+"'",s,count=1,flags=re.M)
    start=s.index('def config():');end=s.index('class NoRedirect',start)
    s=s[:start]+"def config():\n    import runpy\n    return runpy.run_path('/opt/data/petschoice-reporting/current/client.py')['config']()\n\n"+s[end:]
    compile(s,str(p),'exec');tmp=p.with_suffix('.new');tmp.write_text(s);tmp.chmod(p.stat().st_mode);tmp.replace(p)
print(json.dumps({'activated':True,'sources':'local independent reporting service','delivery_history_preserved':True}))

