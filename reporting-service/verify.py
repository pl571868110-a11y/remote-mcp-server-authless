import argparse,datetime as dt,json,pathlib,runpy,uuid,urllib.request,urllib.error,time
ROOT=pathlib.Path('/opt/data/petschoice-reporting')
def modules():
    return [(name,runpy.run_path('/opt/data/'+name+'-reports/runner.py')) for name in ('google-ua','meta')]
def send_notice(phase,release,context='service'):
    statefile=ROOT/('notice-'+context+'.json')
    state=json.loads(statefile.read_text()) if statefile.exists() else {}
    if phase=='alert':
        if state.get('open'):return []
        state={'open':True,'incident':uuid.uuid4().hex};statefile.write_text(json.dumps(state));statefile.chmod(0o600)
        key='REPORTING_ALERT:'+context+':'+state['incident']
    elif phase=='recovered':
        if not state.get('open'):return []
        key='REPORTING_RECOVERED:'+context+':'+state['incident']
    else:key='REPORTING_RELEASE:'+release
    receipts=[]
    for name,m in modules():
        _,bot=m['config']()
        if name=='google-ua':
            text={'post':'Технічна перевірка: окремий сервіс звітності оновлено. Дані Google та Meta доступні. Доставку підтверджено. Розклад: 14:00 Europe/Warsaw.','alert':'Перевірка сервісу звітності не пройшла. Невдале оновлення не повинно замінювати робочу версію; старі цифри не підставляються.','recovered':'Сервіс звітності відновлено. Перевірку джерел пройдено.'}[phase]
        else:
            text={'post':'Техническая проверка: отдельный сервис отчётности обновлён. Данные Google и Meta доступны. Доставка подтверждена. Расписание: 14:00 Europe/Warsaw.','alert':'Проверка сервиса отчётности не прошла. Неудачное обновление не должно заменять рабочую версию; старые цифры не подставляются.','recovered':'Сервис отчётности восстановлен. Проверка источников пройдена.'}[phase]
        db=(m.get('open_db') or m.get('dbopen'))()
        r=m['send'](db,key,text,bot,{'technical_check':True,'phase':phase,'release':release})
        receipts.append({'source':name,**r})
        if not(r.get('success') is True or r.get('status')=='SKIPPED_SENT'):raise RuntimeError('DELIVERY_UNCONFIRMED')
    if phase=='recovered':state['open']=False;statefile.write_text(json.dumps(state))
    return receipts
def check(port,host):
    config=runpy.run_path(str(pathlib.Path(__file__).with_name('client.py')))['config']
    headers,bot=config()
    req=urllib.request.Request('http://'+host+':'+str(port)+'/health',headers=headers)
    for attempt in range(30):
        try:
            with urllib.request.urlopen(req,timeout=240) as response:data=json.load(response)
            break
        except urllib.error.HTTPError:raise
        except urllib.error.URLError:
            if attempt==29:raise
            time.sleep(1)
    if data.get('ok') is not True:raise RuntimeError('SOURCE_CHECK_FAILED')
    for name,m in modules():
        result=m['request']('https://api.telegram.org/bot'+bot+'/getChat?chat_id='+m['TARGET'],{})
        if result.get('ok') is not True or str(result.get('result',{}).get('id'))!=m['TARGET']:raise RuntimeError('DESTINATION_MISMATCH')
    return data
def main():
    p=argparse.ArgumentParser();p.add_argument('--phase',choices=['pre','post','monitor','alert','recovered'],required=True);p.add_argument('--port',type=int,default=8766);p.add_argument('--host',choices=['petschoice-reporting','petschoice-reporting-candidate'],default='petschoice-reporting');p.add_argument('--release',default='monitor');p.add_argument('--context',default='service');a=p.parse_args()
    if a.port not in (8766,8767):raise RuntimeError('PORT')
    if a.phase in ('alert','recovered'):print(json.dumps({'ok':True,'notices':send_notice(a.phase,a.release,a.context)}));return
    d=check(a.port,a.host);notices=send_notice('post',a.release) if a.phase=='post' else []
    if a.phase in ('post','monitor'):notices+=send_notice('recovered',a.release)
    print(json.dumps({'ok':True,'phase':a.phase,'checked_at':d['checked_at'],'sources':d['sources'],'notices':notices}))
if __name__=='__main__':
    try:main()
    except Exception:print(json.dumps({'ok':False,'error':'REPORTING_CHECK_FAILED'}));raise SystemExit(1)

