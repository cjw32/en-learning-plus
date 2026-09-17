#!/usr/bin/env bash
# Run once in the SERVER root terminal. Safe to repeat; never prints .env.
set -Eeuo pipefail
umask 077
app_dir=/home/cjw-deploy/reactive-resume
backup_root=/var/backups/cjw-resume
swap_file=/swap-cjw-resume
swap_bytes=$((2 * 1024 * 1024 * 1024))
[[ $(id -u) == 0 ]] || { echo 'Run this script as root in the SERVER terminal.'; exit 1; }
exec 9>/run/lock/cjw-resume-finish.lock
flock -n 9 || { echo 'Another resume deployment is running.'; exit 1; }
trap 'echo "CJW_RESUME_FINISH_FAILED: stop and report the last error; existing data was not deleted." >&2' ERR
cd "$app_dir"
[[ -f .env && $(stat -c %U .env) == cjw-deploy ]] || { echo 'Existing private app configuration is required.'; exit 1; }
runuser -u cjw-deploy -- python3 verify-images.py
runuser -u cjw-deploy -- docker compose config --quiet

# Review the existing gateway before making system changes.
vhost=/www/server/panel/vhost/nginx/resume.cjw32.xyz.conf
if [[ -e "$vhost" ]] && ! cmp -s "$vhost" nginx-http.conf && ! cmp -s "$vhost" nginx-https.conf; then
    echo 'Resume vhost has changed since preparation; stop for review.'
    exit 1
fi
/www/server/nginx/sbin/nginx -t
backup_dir="$backup_root/finish-$(date +%Y%m%d-%H%M%S)"
install -d -m 700 "$backup_dir"
cp -p /etc/fstab "$backup_dir/fstab"
cp -p compose.yaml setup-server.sh nginx-http.conf nginx-https.conf "$backup_dir/"
[[ ! -f "$vhost" ]] || cp -p "$vhost" "$backup_dir/resume-vhost.conf"
echo "Configuration backup: $backup_dir"

# This shared 4 GiB host has no swap. Add a bounded buffer without stopping apps.
if [[ $(awk '/^SwapTotal:/ {print $2}' /proc/meminfo) -eq 0 ]]; then
    if [[ -e "$swap_file" ]]; then
        [[ -f "$swap_file" && ! -L "$swap_file" ]] || { echo 'Unexpected swap path; stop for review.'; exit 1; }
        [[ $(stat -c %s "$swap_file") -eq "$swap_bytes" ]] || { echo 'Existing swap file has an unexpected size; stop for review.'; exit 1; }
        [[ $(stat -c %U "$swap_file") == root && $(stat -c %a "$swap_file") == 600 ]] || { echo 'Existing swap permissions need review.'; exit 1; }
        [[ $(blkid -p -s TYPE -o value "$swap_file") == swap ]] || { echo 'Existing path is not a prepared swap file; stop for review.'; exit 1; }
    else
        available_bytes=$(df -B1 --output=avail / | tail -n 1 | tr -d ' ')
        (( available_bytes >= swap_bytes + 4 * 1024 * 1024 * 1024 )) || { echo 'Insufficient disk headroom for the 2 GiB swap file.'; exit 1; }
        install -m 600 /dev/null "$swap_file"
        dd if=/dev/zero of="$swap_file" bs=1M count=2048 status=progress conv=fsync
        mkswap "$swap_file" >/dev/null
    fi
    swapon "$swap_file"
fi
if swapon --noheadings --show=NAME | grep -Fxq "$swap_file"; then
    # Preserve all existing fstab entries and refuse a conflicting entry.
    python3 - "$swap_file" <<'PY'
from pathlib import Path
import sys
p=Path('/etc/fstab'); text=p.read_text(); target=sys.argv[1]
entries=[line.split() for line in text.splitlines() if line.strip() and not line.lstrip().startswith('#')]
matched=[entry for entry in entries if entry[0]==target]
if matched:
    if len(matched)!=1 or matched[0][1:4] != ['none','swap','sw']:
        raise SystemExit('Conflicting swap fstab entry; stop for review.')
else:
    with p.open('a') as f:
        f.write(('' if text.endswith('\n') else '\n')+f'{target} none swap sw 0 0\n')
PY
fi
free -m
echo 'CJW_RESUME_MEMORY_READY'
# Existing script preserves credentials/certificate and only switches HTTPS after health checks.
bash "$app_dir/setup-server.sh"
runuser -u cjw-deploy -- docker compose ps
curl --fail --silent --show-error --max-time 15 --resolve resume.cjw32.xyz:443:127.0.0.1 https://resume.cjw32.xyz/api/health
printf '\nCJW_RESUME_DEPLOYMENT_READY\n'
