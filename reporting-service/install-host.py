import os,pathlib,subprocess,sys
if os.getuid()!=0:raise SystemExit('ROOT_REQUIRED_FOR_SYSTEMD')
SYSTEM=pathlib.Path('/etc/systemd/system')
units={
'petschoice-reporting.service':"""[Unit]
Description=PetsChoice isolated Google and Meta reporting
After=docker.service network-online.target
Requires=docker.service
StartLimitIntervalSec=0
OnFailure=petschoice-reporting-alert.service
[Service]
Type=simple
ExecStart=/usr/bin/python3 /opt/petschoice-reporting/run.py
ExecStop=-/usr/bin/docker stop -t 15 petschoice-reporting
Restart=always
RestartSec=20
TimeoutStopSec=30
[Install]
WantedBy=multi-user.target
""",
'petschoice-reporting-deploy.service':"""[Unit]
Description=Verified rollout of approved PetsChoice reporting release
After=docker.service network-online.target
OnFailure=petschoice-reporting-alert.service
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /opt/petschoice-reporting/deploy.py
TimeoutStartSec=1800
""",
'petschoice-reporting-deploy.timer':"""[Unit]
Description=Check approved reporting releases
[Timer]
OnCalendar=*-*-* *:00,15,30,45:00 Europe/Warsaw
RandomizedDelaySec=20
Persistent=true
[Install]
WantedBy=timers.target
""",
'petschoice-reporting-alert.service':"""[Unit]
Description=Notify existing report groups about reporting failure
After=docker.service
[Service]
Type=oneshot
ExecStart=/usr/bin/docker exec --user hermes valera-hermes python3 /opt/data/petschoice-reporting/migration/verify.py --phase alert
TimeoutStartSec=120
"""
}
for name,text in units.items():(SYSTEM/name).write_text(text)
if '--activate-monitoring' in sys.argv:
    p=SYSTEM/'petschoice-report-watchdog.service.d';p.mkdir(exist_ok=True)
    (p/'isolated-reporting.conf').write_text("""[Unit]
OnFailure=petschoice-reporting-alert.service
[Service]
ExecStartPre=/usr/bin/python3 /opt/petschoice-reporting/run.py --connect
ExecStartPost=/usr/bin/docker exec --user hermes valera-hermes python3 /opt/data/petschoice-reporting/current/verify.py --phase monitor
""")
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','enable','petschoice-reporting.service'],check=True)
if '--activate-monitoring' in sys.argv:
    subprocess.run(['systemctl','enable','--now','petschoice-reporting-deploy.timer'],check=True)
print('ISOLATED_REPORTING_UNITS_READY')

