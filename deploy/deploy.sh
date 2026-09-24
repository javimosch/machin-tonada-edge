#!/bin/sh
# Build the daemon and (re)deploy the fleet on vps1.
# Usage: ./deploy/deploy.sh [zone ...]   — defaults to every zone in bkn/zones.json
set -e
cd "$(dirname "$0")/.."
./build.sh
ssh vps1 'mkdir -p ~/tonada-edge/state'
scp tonada-edge vps1:~/tonada-edge/tonada-edge
scp deploy/tonada-edge@.service vps1:/tmp/tonada-edge@.service
ssh vps1 'sudo install -m644 /tmp/tonada-edge@.service /etc/systemd/system/tonada-edge@.service && sudo systemctl daemon-reload'
ZONES="${@:-$(python3 -c 'import json; print(" ".join(z["id"] for z in json.load(open("bkn/zones.json"))))')}"
for z in $ZONES; do ssh vps1 "sudo systemctl enable --now tonada-edge@$z && sudo systemctl restart tonada-edge@$z"; done
ssh vps1 'systemctl is-active tonada-edge@* | sort | uniq -c'
