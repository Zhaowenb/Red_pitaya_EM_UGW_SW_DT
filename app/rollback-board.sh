#!/bin/bash
set -euo pipefail
export PATH_REDPITAYA=/opt/redpitaya
target=/opt/redpitaya/www/apps/hann_scope
backup=$(cat /opt/redpitaya/hann_scope_last_backup)
[[ "$backup" == /opt/redpitaya/hann_scope_backups/* ]] && [[ -d "$backup/app" ]] || { echo 'Invalid backup'; exit 1; }
/opt/redpitaya/sbin/rw
trap '/opt/redpitaya/sbin/ro || true' EXIT
curl -fsS 'http://127.0.0.1/bazaar?stop=hann_scope' >/dev/null || true
systemctl stop hann-scope.target 2>/dev/null || true
mv "$target" "$backup/replaced-$(date +%s)"
cp -a "$backup/app" "$target"
for unit in hann-scope.target hann-scope-hardware.service hann-scope-web.service; do
  if [[ -f "$backup/$unit" ]]; then cp -a "$backup/$unit" "/etc/systemd/system/$unit";
  elif [[ -f "/etc/systemd/system/$unit" ]]; then mv "/etc/systemd/system/$unit" "$backup/rolled-back-$unit"; fi
done
systemctl daemon-reload
echo 'Previous Hann Burst Scope restored. Measurement data was retained.'
