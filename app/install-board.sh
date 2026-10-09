#!/bin/bash
set -euo pipefail
export PATH_REDPITAYA=/opt/redpitaya
stage=$(cd -- "$(dirname -- "$0")" && pwd)
target=/opt/redpitaya/www/apps/hann_scope
backup_root=/opt/redpitaya/hann_scope_backups
data=/home/redpitaya/hann_scope_data
if [[ "$stage" != /tmp/hann_scope-stage-* ]]; then echo 'Install must run from a staged /tmp/hann_scope-stage-* directory'; exit 1; fi
python3 -c 'import sys; assert sys.version_info >= (3,10), "Python >=3.10 is required"; import numpy; print(sys.version, numpy.__version__)'
test -f /opt/redpitaya/include/rp.h
make -C "$stage" INSTALL_DIR=/opt/redpitaya
test -s "$stage/controllerhf.so"
test -s "$stage/hann-hardware"
python3 -m compileall -q "$stage/redscope"
stamp=$(date +%Y%m%d-%H%M%S)
backup="$backup_root/$stamp"
/opt/redpitaya/sbin/rw
trap '/opt/redpitaya/sbin/ro || true' EXIT
mkdir -p "$backup" "$data"
if [[ -d "$target" ]]; then cp -a "$target" "$backup/app"; fi
for unit in hann-scope.target hann-scope-hardware.service hann-scope-web.service; do
  if [[ -f "/etc/systemd/system/$unit" ]]; then cp -a "/etc/systemd/system/$unit" "$backup/$unit"; fi
done
if [[ -d "$target/data" ]]; then cp -an "$target/data/." "$data/"; fi
curl -fsS 'http://127.0.0.1/bazaar?stop=hann_scope' >/dev/null || true
systemctl stop hann-scope.target 2>/dev/null || true
displaced="/opt/redpitaya/www/apps/.hann_scope-previous-$stamp"
if [[ -e "$target" ]]; then mv "$target" "$displaced"; fi
restore() {
  echo "Upgrade failed. Restoring previous app from $backup"
  systemctl stop hann-scope.target 2>/dev/null || true
  if [[ -e "$target" ]]; then mv "$target" "$backup/failed-app"; fi
  if [[ -e "$displaced" ]]; then mv "$displaced" "$target"; fi
  for unit in hann-scope.target hann-scope-hardware.service hann-scope-web.service; do
    if [[ -f "$backup/$unit" ]]; then cp -a "$backup/$unit" "/etc/systemd/system/$unit";
    elif [[ -f "/etc/systemd/system/$unit" ]]; then mv "/etc/systemd/system/$unit" "$backup/failed-$unit"; fi
  done
  systemctl daemon-reload
}
trap 'restore; /opt/redpitaya/sbin/ro || true' ERR
cp -a "$stage" "$target"
chmod +x "$target/fpga.sh" "$target/hann-hardware"
cp "$target"/services/* /etc/systemd/system/
chmod 644 /etc/systemd/system/hann-scope.target /etc/systemd/system/hann-scope-hardware.service /etc/systemd/system/hann-scope-web.service
systemctl daemon-reload
# Starting the web endpoint directly does not load/reset the FPGA. Bazaar owns hardware start.
python3 -c 'print("Installed: open http://192.168.10.68/hann_scope/")'
printf '%s\n' "$backup" > /opt/redpitaya/hann_scope_last_backup
if [[ -e "$displaced" ]]; then mv "$displaced" "$backup/displaced-app"; fi
echo "Backup: $backup; data: $data"
