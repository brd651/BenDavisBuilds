#!/usr/bin/env bash
set -euo pipefail
umask 077
root=$(dirname -- "$(readlink -f -- "$0")")
state=${BDB_ANALYTICS_DB:?}
backup_root=$(dirname -- "$state")/backups
mkdir -p "$backup_root"
chmod 700 "$backup_root"
"$root/analyticsd" integrity
"$root/analyticsd" backup "$backup_root/analytics-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
"$root/analyticsd" retention 90
find "$backup_root" -maxdepth 1 -type f -name 'analytics-????????T??????Z.sqlite' -mtime +7 -delete
