#!/usr/bin/env bash
# Transfer only a compiled static artifact. No privileged commands are needed.
set -euo pipefail

: "${DEPLOY_HOST:?Set the verified destination host locally}"
: "${DEPLOY_USER:?Set the limited deployment account locally}"
: "${DEPLOY_KEY:?Set a local private-key path}"
: "${DEPLOY_KNOWN_HOSTS:?Set the verified known_hosts path}"
: "${DEPLOY_HEALTH_URL:?Set the canonical URL or authorized HTTP preview URL}"
site_root=${DEPLOY_ROOT:-/srv/bendavisbuilds}
release=${RELEASE_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD)}
artifact=${1:-dist}
[[ $DEPLOY_HOST =~ ^[a-zA-Z0-9.:-]+$ && $DEPLOY_USER =~ ^[a-z_][a-z0-9_-]*$ ]]
[[ $site_root =~ ^/srv/[a-zA-Z0-9_-]+$ && $release =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$ ]]
[[ $release != bootstrap ]]
[[ $DEPLOY_HEALTH_URL =~ ^https?://[a-zA-Z0-9.-]+(:[0-9]{1,5})?/?$ ]]
[[ -s $DEPLOY_KEY && -s $DEPLOY_KNOWN_HOSTS && -s $artifact/index.html && -s $artifact/404.html ]]
if [[ -n $(find "$artifact" -type l -print -quit) ]]; then
  echo 'Artifact must not contain symlinks.' >&2
  exit 1
fi
if [[ -n $(find "$artifact" \( -name .git -o -name .env -o -name package.json -o -name '*.md' -o -name '*.yml' -o -name '*.yaml' \) -print -quit) ]]; then
  echo 'Artifact contains source or private configuration.' >&2
  exit 1
fi
target="$DEPLOY_USER@$DEPLOY_HOST"
ssh_args=(-F /dev/null -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 -o "UserKnownHostsFile=$DEPLOY_KNOWN_HOSTS" -i "$DEPLOY_KEY")
# A remote lock covers transfer, validation, activation and retention.
ssh "${ssh_args[@]}" "$target" "mkdir '$site_root/.deploy-lock'"
previous=''
activated=false
cleanup() {
  status=$?
  if [[ $status -ne 0 && $activated == true && -n $previous ]]; then
    if ssh "${ssh_args[@]}" "$target" "set -eu; ln -s '$previous' '$site_root/current.recovery'; mv -Tf '$site_root/current.recovery' '$site_root/current'"; then
      echo "Deployment failed; restored $previous" >&2
    else
      echo 'Deployment and automatic rollback failed; inspect the current release before retrying.' >&2
    fi
  fi
  ssh "${ssh_args[@]}" "$target" "rmdir '$site_root/.deploy-lock'" || true
}
trap cleanup EXIT
previous=$(ssh "${ssh_args[@]}" "$target" "readlink '$site_root/current'")
[[ $previous =~ ^$site_root/releases/[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$ ]]
ssh "${ssh_args[@]}" "$target" "mkdir '$site_root/releases/$release'"
printf -v rsync_ssh '%q ' ssh "${ssh_args[@]}"
rsync --archive --no-owner --no-group --chmod=D755,F644 -e "$rsync_ssh" "$artifact/" "$target:$site_root/releases/$release/"
ssh "${ssh_args[@]}" "$target" "set -eu; printf '%s\n' '$release' > '$site_root/releases/$release/health.txt'; test -s '$site_root/releases/$release/index.html'; test -s '$site_root/releases/$release/404.html'"
# Compare all transferred files, ignoring the deliberately changed health marker.
differences=$(rsync --dry-run --checksum --recursive --itemize-changes --exclude=health.txt -e "$rsync_ssh" "$artifact/" "$target:$site_root/releases/$release/")
[[ -z $differences ]] || { echo 'Artifact transfer verification failed.' >&2; exit 1; }
activated=true
ssh "${ssh_args[@]}" "$target" "set -eu; ln -s '$site_root/releases/$release' '$site_root/current.next'; mv -Tf '$site_root/current.next' '$site_root/current'"
base=${DEPLOY_HEALTH_URL%/}
served=$(curl --fail --silent --show-error --retry 3 --retry-delay 2 --max-time 15 "$base/health.txt")
[[ $served == "$release" ]]
for route in / /about/ /writing/ /writing/sample/ /writing/archive/ /projects/ /lab/ /mentorship/ /contact/; do
  [[ $(curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code}' "$base$route") == 200 ]]
done
[[ $(curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code}' "$base/nonexistent-release-check/") == 404 ]]
# Keep active, previous, bootstrap and at most one further release (four total).
ssh "${ssh_args[@]}" "$target" "python3 - '$site_root' '$release' '$previous'" <<'PY'
from pathlib import Path
import shutil
import sys
root, active, previous = sys.argv[1:]
releases = Path(root) / 'releases'
protected = {active, Path(previous).name, 'bootstrap'}
others = sorted((p for p in releases.iterdir() if p.is_dir() and not p.is_symlink() and p.name not in protected), key=lambda p: p.stat().st_mtime, reverse=True)
for directory in others[max(0, 4 - len(protected)):]:
    shutil.rmtree(directory)
PY
echo "Activated and verified release $release"
