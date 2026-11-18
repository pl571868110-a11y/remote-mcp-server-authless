import pathlib,shlex,re,os
ROOT=pathlib.Path('/opt/data/petschoice-reporting')
def config():
    p=ROOT/'local-token';s=p.stat()
    if s.st_mode&0o077 or s.st_uid!=os.getuid():raise RuntimeError('LOCAL_AUTH_PERMISSIONS')
    token=p.read_text().strip()
    if not re.fullmatch(r'[a-f0-9]{64}',token):raise RuntimeError('LOCAL_AUTH_INVALID')
    bot=None
    for line in pathlib.Path('/opt/data/.env').read_text().splitlines():
        if line.startswith('TELEGRAM_BOT_TOKEN='):
            values=shlex.split(line.split('=',1)[1],comments=True);bot=values[0] if values else None
    if not bot:raise RuntimeError('BOT_NOT_CONFIGURED')
    return {'Authorization':'Bearer '+token},bot

