#!/usr/bin/env python3
"""Run interactively on the server; never prints SMTP credentials."""
import getpass
import os
from pathlib import Path
import secrets
import smtplib
import ssl
import sys

os.umask(0o077)
target = Path(__file__).resolve().parent / '.env'
if target.exists():
    sys.exit('Configuration already exists; refusing to replace database/auth secrets.')
if not sys.stdin.isatty():
    sys.exit('Run directly in an interactive server terminal.')
sender = input('163 sender email: ').strip()
if not sender.endswith('@163.com') or any(c.isspace() for c in sender):
    sys.exit('Enter a valid 163.com sender address.')
password = getpass.getpass('163 SMTP authorization code (hidden): ').strip()
if not password or any(c in password for c in "\r\n'\\"):
    sys.exit('Authorization code has an unsupported format.')
try:
    with smtplib.SMTP_SSL('smtp.163.com', 465, context=ssl.create_default_context(), timeout=20) as client:
        client.login(sender, password)
except (OSError, smtplib.SMTPException):
    sys.exit('SMTP login failed. No configuration saved. Check SMTP is enabled and use its authorization code.')
values = {
    'APP_URL': 'https://resume.cjw32.xyz',
    'AUTH_SECRET': secrets.token_hex(32),
    'POSTGRES_PASSWORD': secrets.token_hex(32),
    'SMTP_HOST': 'smtp.163.com',
    'SMTP_PORT': '465',
    'SMTP_USER': sender,
    'SMTP_PASS': password,
    'SMTP_FROM': sender,
    'SMTP_SECURE': 'true',
    'FLAG_DISABLE_SIGNUPS': 'false',
    'FLAG_DISABLE_EMAIL_AUTH': 'false',
    'FLAG_DISABLE_API_RATE_LIMIT': 'false',
    'FLAG_ALLOW_UNSAFE_OAUTH_REDIRECT_URI': 'false',
    'FLAG_ALLOW_UNSAFE_AI_BASE_URL': 'false',
}
with target.open('x') as handle:
    handle.write(''.join(f"{key}='{value}'\n" for key, value in values.items()))
print('SMTP login verified; private configuration saved. No email was sent.')
