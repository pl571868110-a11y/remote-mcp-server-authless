import { execFileSync } from 'node:child_process';
const files = execFileSync('git', ['ls-files', '-z'], {encoding: 'utf8'}).split('\0').filter(Boolean);
const forbidden = /(^|\/)(?:output|security-backup|node_modules|\.build)\/|(^|\/)\.env(?:\.|$)|(^|\/)\.dev\.vars|\.bak(?:[.-]|$)|\.(?:dpapi|zip|tar\.gz|sqlite|csv|xlsx)$/i;
const bad = files.filter(f => forbidden.test(f));
if (bad.length) {
  console.error('Forbidden publication paths:', bad.join(', '));
  process.exit(1);
}
console.log('PASS: no credential files, financial exports or recovery artifacts tracked');
