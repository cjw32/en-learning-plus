#!/usr/bin/env bash
# Run only in a disposable Linux container, with this bundle mounted at /bundle.
set -euo pipefail
[[ -f /.dockerenv && -d /bundle/repositories ]] || exit 2
mkdir -p /test-bin
cat > /test-bin/docker <<'MOCK'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$CALL_LOG"
if [[ "$1" == login ]]; then cat >/dev/null; exit 0; fi
if [[ " $* " == *' pull '* && "$TEST_CASE" == pull_failure ]]; then exit 1; fi
if [[ " $* " == *' up '* && " $* " == *'/releases/new/'* && "$TEST_CASE" == health_failure ]]; then exit 1; fi
MOCK
chmod +x /test-bin/docker
export PATH="/test-bin:$PATH"
export CALL_LOG=/tmp/docker-calls
for repo in navigation-Page blog-page vue-tool vue-mindmap; do
  app="${repo,,}"
  root="/opt/cjw-sites/$app"
  mkdir -p "$root/releases/new" "$root/releases/old"
  touch "$root/READY"
  cp "/bundle/repositories/$repo/deploy/deploy.sh" "$root/releases/new/"
  for version in old new; do
    touch "$root/releases/$version/compose.yaml"
    printf 'WEB_IMAGE=ghcr.io/cjw260/%s-web@sha256:%064d\n' "$app" 1 > "$root/releases/$version/images.env"
    if [[ "$app" == vue-* ]]; then
      printf 'API_IMAGE=ghcr.io/cjw260/%s-api@sha256:%064d\n' "$app" 2 >> "$root/releases/$version/images.env"
    fi
  done
  export TEST_CASE=success
  : > "$CALL_LOG"
  printf 'test-token\n' | bash "$root/releases/new/deploy.sh" cjw260
  [[ "$(readlink -f "$root/current")" == "$root/releases/new" ]]
  ln -sfn "$root/releases/old" "$root/current"
  export TEST_CASE=pull_failure
  : > "$CALL_LOG"
  if printf 'test-token\n' | bash "$root/releases/new/deploy.sh" cjw260; then exit 1; fi
  ! grep -q ' up ' "$CALL_LOG"
  [[ "$(readlink -f "$root/current")" == "$root/releases/old" ]]
  export TEST_CASE=health_failure
  : > "$CALL_LOG"
  if printf 'test-token\n' | bash "$root/releases/new/deploy.sh" cjw260; then exit 1; fi
  grep -q '/releases/old/.* up ' "$CALL_LOG"
  [[ "$(readlink -f "$root/current")" == "$root/releases/old" ]]
  rm "$root/current"
  : > "$CALL_LOG"
  if printf 'test-token\n' | bash "$root/releases/new/deploy.sh" cjw260; then exit 1; fi
  grep -q ' down$' "$CALL_LOG"
  ! grep -q -- ' -v' "$CALL_LOG"
  printf 'WEB_IMAGE=untrusted:latest\n' > "$root/releases/new/images.env"
  : > "$CALL_LOG"
  if printf 'test-token\n' | bash "$root/releases/new/deploy.sh" cjw260; then exit 1; fi
  [[ ! -s "$CALL_LOG" ]]
  echo "$repo: success, pull failure, rollback, first-release failure, manifest rejection PASS"
done
