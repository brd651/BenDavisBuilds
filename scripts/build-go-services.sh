#!/usr/bin/env bash
# Compile on the controller/CI, never on the web host. Output stays separate from static assets.
set -euo pipefail
artifact=${1:?Supply a private absolute artifact directory}
root=$(git rev-parse --show-toplevel)
[[ $artifact == /* ]]
mkdir -p "$artifact"
artifact=$(realpath "$artifact")
[[ $artifact != "$root" && $artifact != "$root/"* ]]
[[ -s "$root/dist/analytics-routes.json" ]]
for service in analyticsd contactd sheetsexport; do
  (cd "$root/services/go" && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags='-s -w' -o "$artifact/$service" "./cmd/$service")
done
cp "$root/services/go/ops/maintenance.sh" "$artifact/maintenance.sh"
cp "$root/dist/analytics-routes.json" "$artifact/routes.json"
chmod 755 "$artifact/analyticsd" "$artifact/contactd" "$artifact/sheetsexport" "$artifact/maintenance.sh"
(cd "$artifact" && sha256sum analyticsd contactd sheetsexport maintenance.sh routes.json > SHA256SUMS)
printf '%s\n' "$(git rev-parse HEAD)" > "$artifact/source-commit.txt"
