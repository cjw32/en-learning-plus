#!/usr/bin/env python3
"""Replace only Feishu credentials, with hidden terminal input and API validation."""
import getpass
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import urllib.error
import urllib.request

APP_ID = "cli_aa20d86dddb9dbb5"
ENV_PATH = Path("/opt/cjw-ai-blog/secrets/openclaw.env")


def main():
    if not sys.stdin.isatty():
        raise SystemExit("Run this script in an interactive server terminal.")
    print("Configure CJW blog bot:", APP_ID)
    secret = getpass.getpass("Paste the NEW Feishu App Secret (input is hidden): ")
    if not re.fullmatch(r"[A-Za-z0-9_-]{16,256}", secret):
        raise SystemExit("Unexpected secret format; credentials were not changed.")
    request = urllib.request.Request(
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        data=json.dumps({"app_id": APP_ID, "app_secret": secret}).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            result = json.load(response)
    except (OSError, ValueError, urllib.error.URLError):
        raise SystemExit("Feishu validation request failed; credentials were not changed.")
    if result.get("code") != 0 or not result.get("tenant_access_token"):
        raise SystemExit("Feishu rejected these credentials; no changes made.")
    stat = ENV_PATH.stat()
    lines = ENV_PATH.read_text().splitlines()
    replacements = {"FEISHU_APP_ID": APP_ID, "FEISHU_APP_SECRET": secret}
    output = []
    for line in lines:
        key = line.split("=", 1)[0]
        if key not in replacements:
            output.append(line)
    output.extend(f"{key}={value}" for key, value in replacements.items())
    fd, temporary = tempfile.mkstemp(prefix=".feishu-", dir=ENV_PATH.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            os.fchmod(stream.fileno(), 0o600)
            if os.geteuid() == 0:
                os.fchown(stream.fileno(), stat.st_uid, stat.st_gid)
            stream.write("\n".join(output) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, ENV_PATH)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print("CJW_FEISHU_CREDENTIALS_READY — validated and saved; bot not started yet.")


if __name__ == "__main__":
    main()
