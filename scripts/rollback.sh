#!/usr/bin/env bash
set -euo pipefail
: "${DEPLOY_HOST:?}"
: "${DEPLOY_USER:?}"
: "${DEPLOY_KEY:?}"
: "${DEPLOY_KNOWN_HOSTS:?}"
: "${DEPLOY_HEALTH_URL:?}"
root=${DEPLOY_ROOT:-/srv/bendavisbuilds}
release=${1:?Provide an existing release ID}
[[ $root =~ ^/srv/[a-zA-Z0-9_-]+$ && $release =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$ ]]
[[ $DEPLOY_HOST =~ ^[a-zA-Z0-9.:-]+$ && $DEPLOY_USER =~ ^[a-z_][a-z0-9_-]*$ ]]
[[ $DEPLOY_HEALTH_URL =~ ^https?://[a-zA-Z0-9.-]+(:[0-9]{1,5})?/?$ ]]
ssh_args=(-F /dev/null -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 -o "UserKnownHostsFile=$DEPLOY_KNOWN_HOSTS" -i "$DEPLOY_KEY")
target="$DEPLOY_USER@$DEPLOY_HOST"
ssh "${ssh_args[@]}" "$target" "mkdir '$root/.deploy-lock'"
previous=''
activated=false
cleanup() {
  status=$?
  if [[ $status -ne 0 && $activated == true && -n $previous ]]; then
    ssh "${ssh_args[@]}" "$target" "set -eu; ln -s '$previous' '$root/current.recovery'; mv -Tf '$root/current.recovery' '$root/current'" || true
  fi
  ssh "${ssh_args[@]}" "$target" "rmdir '$root/.deploy-lock'" || true
}
trap cleanup EXIT
previous=$(ssh "${ssh_args[@]}" "$target" "readlink '$root/current'")
[[ $previous =~ ^$root/releases/[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$ ]]
ssh "${ssh_args[@]}" "$target" "set -eu; test -s '$root/releases/$release/index.html'; test -s '$root/releases/$release/health.txt'"
activated=true
ssh "${ssh_args[@]}" "$target" "set -eu; ln -s '$root/releases/$release' '$root/current.next'; mv -Tf '$root/current.next' '$root/current'"
[[ $(curl --fail --silent --show-error --max-time 15 "${DEPLOY_HEALTH_URL%/}/health.txt") == "$release" ]]
[[ $(curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code}' "${DEPLOY_HEALTH_URL%/}/") == 200 ]]
echo "Verified rollback to $release"
