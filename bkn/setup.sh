#!/usr/bin/env bash
# tonada-edge bkn control-plane setup — idempotent.
# Run ON the bkn host (dk1):  ./setup.sh
# Or from here:               ssh dk1 'bash -s' < bkn/setup.sh   (files must be on dk1)
set -euo pipefail
cd "$(dirname "$0")"

BKN_BIN="${BKN_BIN:-/opt/bkn/bkn}"
if [ -f /etc/bkn/bkn.env ]; then set -a; . /etc/bkn/bkn.env; set +a; fi
bkn() { "$BKN_BIN" "$@"; }

echo "== scripts =="
bkn script create tonada-hub --file tonada-hub.js --description "tonada-edge device+fleet API" \
  || bkn script update tonada-hub --file tonada-hub.js
bkn script create tonada-sim --file tonada-sim.js --description "tonada-edge signal drift simulator" \
  || bkn script update tonada-sim --file tonada-sim.js

echo "== hooks =="
bkn hooks create tonada --script tonada-hub --rate-limit 600 \
  || bkn hooks update tonada --script tonada-hub --rate-limit 600
bkn hooks create tonada-fleet --script tonada-hub --rate-limit 120 \
  || bkn hooks update tonada-fleet --script tonada-hub --rate-limit 120

echo "== collections + seed =="
bkn store create tonada/hist --retain-last 240 --retain-per zone_id 2>/dev/null || true
python3 - <<'PY' | while IFS= read -r line; do bkn store put tonada/zones --data "$line" >/dev/null; done
import json
for z in json.load(open("zones.json")): print(json.dumps(z))
PY
# default signals per zone (put is upsert; harmless to re-seed)
for z in norrland-sthlm norrland-sg cafeberg-mitte; do
  bkn store put tonada/signals --id "$z" \
    --data '{"occupancy":0.5,"pos_rate":8,"weather":"clouds","event":0,"updated_ms":0}' >/dev/null
done

echo "== cron =="
bkn cron create tonada-sim --schedule '*/2 * * * *' --script tonada-sim \
  || bkn cron update tonada-sim --schedule '*/2 * * * *' --script tonada-sim --enable

echo "== verify =="
bkn store list tonada/zones --limit 5 | python3 -c 'import json,sys; d=json.load(sys.stdin); print([r["id"] for r in d["records"]])' 2>/dev/null || bkn store list tonada/zones --limit 5
echo "hook: POST https://bkn.intrane.fr/v1/hooks/tonada?op=beat"
echo "read: GET  https://bkn.intrane.fr/v1/hooks/tonada-fleet?op=fleet"
