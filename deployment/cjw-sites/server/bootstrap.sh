#!/usr/bin/env bash
# Run as root after the owner authorizes the dedicated deployment identity.
# Usage: bash bootstrap.sh /path/to/deploy-public-key.pub
set -euo pipefail
umask 077
[[ $(id -u) == 0 ]] || { echo 'Run as root'; exit 2; }
key_file="${1:?Path to deployment public key required}"
[[ -f "$key_file" ]] || exit 2
ssh-keygen -lf "$key_file" >/dev/null
[[ $(wc -l < "$key_file") -eq 1 ]] || exit 2
[[ $(cut -d' ' -f1 "$key_file") == ssh-ed25519 ]] || exit 2
if id cjw-deploy >/dev/null 2>&1; then
  echo 'cjw-deploy already exists; inspect it before changing its access.' >&2
  exit 2
fi
command -v docker >/dev/null
docker compose version >/dev/null
getent group docker >/dev/null
useradd --create-home --shell /bin/bash cjw-deploy
usermod --append --groups docker cjw-deploy
install -d -m 700 -o cjw-deploy -g cjw-deploy /home/cjw-deploy/.ssh
{ printf 'restrict '; cat "$key_file"; } > /home/cjw-deploy/.ssh/authorized_keys
chown cjw-deploy:cjw-deploy /home/cjw-deploy/.ssh/authorized_keys
chmod 600 /home/cjw-deploy/.ssh/authorized_keys
for app in navigation-page blog-page vue-tool vue-mindmap; do
  install -d -m 750 -o cjw-deploy -g cjw-deploy "/opt/cjw-sites/$app" "/opt/cjw-sites/$app/releases"
done
install -d -m 700 /opt/cjw-sites/backups
backup="/opt/cjw-sites/backups/nginx-before-containers-$(date -u +%Y%m%dT%H%M%SZ).conf"
cp -a /www/server/panel/vhost/nginx/html_101.96.211.198.conf "$backup"
echo "Deployment identity created; Nginx backup: $backup"
echo 'No production traffic changed. Runtime configuration and READY markers are not created yet.'
