#!/usr/bin/env python3
"""Switch one verified application route; preserve unrelated BaoTa configuration."""
import argparse,hashlib,os,re,shutil,subprocess,tempfile
from pathlib import Path
from datetime import datetime,timezone
CONFIG=Path('/www/server/panel/vhost/nginx/html_101.96.211.198.conf')
NGINX='/www/server/nginx/sbin/nginx'

def replace_location(text, selector, body):
    pattern=r'(?m)^\s*location '+re.escape(selector)+r'\s*\{[^{}]*\}'
    matches=list(re.finditer(pattern,text))
    if len(matches)!=1: raise ValueError('Expected exactly one existing location: '+selector)
    return text[:matches[0].start()]+'\n    location '+selector+' {\n'+body+'\n    }'+text[matches[0].end():]

def transform(text, app):
    marker='# CJW Docker routing: '+app
    if marker in text: raise ValueError('Route has already been switched: '+app)
    additions=[]
    if app in ('blog','tool','mindmap'):
        base,port={'blog':('blog',18081),'tool':('tool',18082),'mindmap':('work',18083)}[app]
        text=replace_location(text,'^~ /'+base+'/',f'        proxy_pass http://127.0.0.1:{port};\n        proxy_set_header Host $host;')
        additions.append(f'    location = /{base} {{ return 308 /{base}/; }}')
    if app=='navigation':
        text=replace_location(text,'/','        proxy_pass http://127.0.0.1:18080;\n        proxy_set_header Host $host;')
        additions+=['    location = /app3 { return 308 /tool/; }','    location = /app3/ { return 308 /tool/; }']
    if app=='tool':
        text=replace_location(text,'/tool-api/','''        proxy_pass http://127.0.0.1:13003/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        client_max_body_size 50m;''')
        text=replace_location(text,'/tool-ws/',websocket_body(13003))
    if app=='mindmap':
        if 'location /mindmap-ws/' in text: raise ValueError('Unexpected existing mindmap websocket rule')
        additions.append('    location /mindmap-ws/ {\n'+websocket_body(11234)+'\n    }')
    pos=text.rfind('}')
    return text[:pos]+'\n    '+marker+'\n'+'\n'.join(additions)+'\n'+text[pos:]

def websocket_body(port):
    return f'''        proxy_pass http://127.0.0.1:{port}/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;'''

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('app',choices=['blog','navigation','tool','mindmap'])
    parser.add_argument('--expected-sha256',required=True)
    args=parser.parse_args()
    if os.geteuid()!=0: raise SystemExit('Run as root')
    before=CONFIG.read_bytes()
    if hashlib.sha256(before).hexdigest()!=args.expected_sha256: raise SystemExit('Configuration changed; review before retrying')
    after=transform(before.decode(),args.app).encode()
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup=Path('/opt/cjw-sites/backups')/f'nginx-before-{args.app}-{stamp}.conf'
    shutil.copy2(CONFIG,backup)
    mode=CONFIG.stat().st_mode & 0o777
    def write(content):
        fd,name=tempfile.mkstemp(prefix='.cjw-nginx-',dir=CONFIG.parent)
        try:
            with os.fdopen(fd,'wb') as out: out.write(content)
            os.chmod(name,mode)
            os.replace(name,CONFIG)
        finally:
            if os.path.exists(name): os.unlink(name)
    write(after)
    if subprocess.run([NGINX,'-t']).returncode:
        write(before)
        raise SystemExit('Nginx validation failed; original file restored; no reload performed')
    if subprocess.run([NGINX,'-s','reload']).returncode:
        write(before)
        subprocess.run([NGINX,'-t'],check=True)
        subprocess.run([NGINX,'-s','reload'],check=True)
        raise SystemExit('Reload failed; previous configuration restored')
    print('Switched',args.app,'backup:',backup,'sha256:',hashlib.sha256(after).hexdigest())
if __name__=='__main__': main()
