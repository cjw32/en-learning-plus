#!/usr/bin/env bash
# Run interactively as root in the server terminal.
set -Eeuo pipefail
umask 077
app_dir=/home/cjw-deploy/reactive-resume
nginx=/www/server/nginx/sbin/nginx
vhost=/www/server/panel/vhost/nginx/resume.cjw32.xyz.conf
webroot=/www/wwwroot/resume-acme
backup_dir=/var/backups/cjw-resume

[[ $(id -u) == 0 ]] || { echo 'Run this script as root in the SERVER terminal.'; exit 1; }
cd "$app_dir"

# Only replace a configuration that this deployment generated.
if [[ -e "$vhost" ]] && ! cmp -s "$vhost" nginx-http.conf && ! cmp -s "$vhost" nginx-https.conf; then
    echo 'An existing resume vhost differs from these templates. Stop for review.'
    exit 1
fi

if [[ ! -f .env ]]; then
    [[ -t 0 ]] || { echo 'An interactive terminal is required for initial hidden SMTP entry.'; exit 1; }
    runuser -u cjw-deploy -- python3 "$app_dir/configure.py"
fi
[[ $(stat -c %U .env) == cjw-deploy ]] || { echo 'Unexpected .env owner; stop for review.'; exit 1; }
chmod 600 .env

install_vhost() {
    local source=$1 previous=''
    mkdir -p "$backup_dir"
    if [[ -f "$vhost" ]]; then
        previous=$(mktemp "$backup_dir/nginx.XXXXXX")
        cp -p "$vhost" "$previous"
    fi
    install -m 644 "$source" "$vhost"
    if ! "$nginx" -t; then
        if [[ -n "$previous" ]]; then cp -p "$previous" "$vhost"; else rm -f "$vhost"; fi
        echo 'Nginx validation failed; previous configuration restored.'
        return 1
    fi
    "$nginx" -s reload
}

install -d -m 755 "$webroot" "$webroot/.well-known" "$webroot/.well-known/acme-challenge"
if [[ ! -e "$vhost" ]]; then install_vhost nginx-http.conf; fi

if ! command -v certbot >/dev/null; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends certbot
fi
certbot certonly --webroot -w "$webroot" -d resume.cjw32.xyz \
    --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring

install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/cjw-resume-nginx.sh <<'HOOK'
#!/bin/sh
set -eu
if [ "${RENEWED_LINEAGE:-}" = /etc/letsencrypt/live/resume.cjw32.xyz ]; then
    /www/server/nginx/sbin/nginx -t
    /www/server/nginx/sbin/nginx -s reload
fi
HOOK
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/cjw-resume-nginx.sh
systemctl enable --now certbot.timer
echo 'CJW_RESUME_CERT_READY'

if [[ ${1:-} == --wait ]]; then
    echo 'Waiting up to 60 minutes for official images and the application to become ready.'
    deadline=$((SECONDS + 3600))
    until curl --fail --silent --max-time 5 http://127.0.0.1:18084/api/health >/dev/null; do
        if (( SECONDS >= deadline )); then
            echo 'Application readiness wait timed out. HTTPS entry remains unchanged.'
            exit 1
        fi
        if [[ -f prepare-images.log ]] && grep -q PREPARATION_FAILED prepare-images.log; then
            echo 'Application preparation failed; review prepare-images.log before retrying.'
            exit 1
        fi
        sleep 15
    done
fi

if ! runuser -u cjw-deploy -- python3 verify-images.py; then
    echo 'Images are still downloading. SMTP and certificate setup are complete.'
    echo 'After CJW_RESUME_IMAGES_READY appears in pull-images.log, run this script again.'
    exit 0
fi
runuser -u cjw-deploy -- docker compose config --quiet
runuser -u cjw-deploy -- docker compose up -d --pull never --wait --wait-timeout 180
curl --fail --silent --show-error http://127.0.0.1:18084/api/health
install_vhost nginx-https.conf
curl --fail --silent --show-error --resolve resume.cjw32.xyz:443:127.0.0.1 https://resume.cjw32.xyz/api/health
echo
echo 'CJW_RESUME_HTTPS_READY'
