import hashlib,json,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
bundle=json.loads((root/'reporting-service/bundle.json').read_text())
files=bundle['files']
assert len(files)==11
assert hashlib.sha256(json.dumps(files,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()==bundle['release_id']
for name,value in files.items():
    assert pathlib.Path(name).name==name
    source=(root/'reporting-service'/name).read_bytes()
    assert source.decode()==value['source']
    assert hashlib.sha256(source).hexdigest()==value['sha256']
    if name.endswith('.py'):compile(source,str(name),'exec')
print('REPORTING_BUNDLE_INTEGRITY_PASS')

