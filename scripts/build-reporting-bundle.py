import hashlib,json,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
files={}
for p in sorted((root/'reporting-service').iterdir()):
    if p.suffix in ('.mjs','.py') and not p.name.endswith('.test.mjs'):
        files[p.name]={'source':p.read_text(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
release=hashlib.sha256(json.dumps(files,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
blob=json.dumps({'release_id':release,'files':files},sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
(root/'reporting-service/bundle.json').write_bytes(blob)
print(json.dumps({'release_id':release,'bundle_sha256':hashlib.sha256(blob).hexdigest()}))

