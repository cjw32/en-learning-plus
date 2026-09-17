#!/usr/bin/env bash
# One deployment job: wait for official pinned pulls, verify, start.
set -Eeuo pipefail
cd "$(dirname "$0")"
exec 9>.prepare-images.lock
flock -n 9 || { echo 'A preparation job is already running.'; exit 1; }
trap 'echo "PREPARATION_FAILED: inspect the preceding error before retrying."' ERR
deadline=$((SECONDS + 3600))
echo 'Waiting for official image pulls to finish.'
while true; do
    if python3 verify-images.py >/dev/null 2>&1; then
        python3 verify-images.py
        break
    fi
    if (( SECONDS >= deadline )); then
        echo 'Image transfer wait timed out; no services changed.'
        exit 1
    fi
    sleep 10
done
docker compose up -d --pull never --wait --wait-timeout 180
curl --fail --silent --show-error http://127.0.0.1:18084/api/health
echo
echo 'CJW_RESUME_APP_READY: run setup-server.sh as root to enable HTTPS.'
