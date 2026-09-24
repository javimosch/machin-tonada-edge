# tonada-edge — edge player prototype (machin/MFL)

A proof-of-concept of the [Tonada](https://www.tonada.com) Player Box problem,
written in [MFL](https://github.com/javimosch/machin): one decision engine
(`src/edge-core.src`) compiles to **both** a ~63 KB native edge daemon and a
wasm module that runs the *same* logic in your browser.

## Live artifacts

| | |
|---|---|
| **Interactive simulator** (3D box + wasm engine + generative audio) | https://hart.intrane.fr/a/javimosch/tonada-edge |
| **Fleet dashboard** (7 zones, live heartbeats from real daemons) | https://hart.intrane.fr/a/javimosch/tonada-fleet |
| **Live box view** — pick a zone or deep-link: | `https://hart.intrane.fr/a/javimosch/tonada-box?zone=<id>` |
| Stockholm · Norrland Flagship | https://hart.intrane.fr/a/javimosch/tonada-box?zone=norrland-sthlm |
| Singapore · Norrland Orchard | https://hart.intrane.fr/a/javimosch/tonada-box?zone=norrland-sg |
| Berlin · Café Berg Mitte | https://hart.intrane.fr/a/javimosch/tonada-box?zone=cafeberg-mitte |
| Mar del Plata · Café Marea Costa | https://hart.intrane.fr/a/javimosch/tonada-box?zone=cafemarea-mdp |
| Tokyo · Kinu Hi-Fi Shibuya | https://hart.intrane.fr/a/javimosch/tonada-box?zone=kinu-shibuya |
| New York · Meridian Supply SoHo | https://hart.intrane.fr/a/javimosch/tonada-box?zone=meridian-soho |
| Dubai · Dune Beach Club | https://hart.intrane.fr/a/javimosch/tonada-box?zone=dune-marina |

Each live box hart mirrors that zone's daemon: the 3D box shows the real
decision, mood-colored LED, and online/cache state, pushed server-side every
30s (`hart refresh --url` → bkn `op=fleet` hook → `window.HART_DATA`), with a
zone picker and `?zone=` deep links. The fleet
page is strict-CSP: no fetch at all — its data is pushed the same way
(`op=fleet`). Zone names on the fleet page link to their box hart.

## Architecture

```
                 ┌──────────────────────── edge-core.src (MFL) ───────────────────────┐
                 │  signals(time,weekday,weather,occupancy,pos_rate,event,online)      │
                 │  -> decision(track,mood,energy,bpm,volume,source,reason)            │
                 └──────────────┬──────────────────────────────┬──────────────────────┘
                  machin build (native)               machin build --target wasm32-wasi
                          │                                    │
               tonada-edge daemon (~63 KB)            edge-core.wasm (in-browser)
               polls signals, decides locally,        drives 3D box LED + procedural
               caches catalog, heartbeats back,       WebAudio, survives "CUT THE
               keeps playing on cached catalog        NETWORK" on the cached catalog
               when the uplink dies                          │
                          │ POST /v1/hooks/tonada            │
                          ▼                                  ▼
               bkn control plane (dk1)                 hart artifact (strict CSP)
               hooks -> scripts -> store collections   self-contained single HTML
               cron (signal drift) -> fleet hook       three.js + wasm + GLB inlined
                          │ GET ?op=fleet
                          ▼
               hart refresh --url (30s) -> window.HART_DATA -> fleet hart
```

## Layout

- `src/edge-core.src` — shared decision engine (native + wasm exports)
- `src/daemon.src` — edge daemon: poll → decide → beat → offline fallback
- `src/edge-cli.src` — one-shot CLI for the engine (testing)
- `src/control-plane.src` — standalone MFL control plane (dev alternative to bkn)
- `bkn/` — control plane as bkn scripts/hooks/cron (`setup.sh` deploys)
- `demo/` — device page (three.js + WebAudio) and fleet dashboard
- `assets/` — Blender box model, GLB export, wasm build
- `build.sh` — native + wasm builds; `build-hart.py` — self-contained artifacts

## Run it

```sh
./build.sh                                   # builds tonada-edge + edge-core.wasm

# point at a bkn control plane (ops: config|signals|set|beat|fleet)
./tonada-edge run --server=https://bkn.intrane.fr --zone=norrland-sthlm --interval=3000
./tonada-edge status --server=https://bkn.intrane.fr --zone=norrland-sthlm
./tonada-edge health --server=https://bkn.intrane.fr

# local dev without bkn: the MFL control plane + local dashboards
machin encode src/control-plane.src src/edge-core.src > cp.mfl && machin build cp.mfl -o control-plane
./control-plane 8470 &
python3 -m http.server 8471     # demo at /demo/ , fleet at /demo/fleet.html
```

Kill the network on a running daemon and it keeps "playing" — next decisions
come from the cached catalog (`source: cache`) until the uplink returns.

## Honest boundary

This is not Tonada's product and not their generative engine — tracks are a
14-entry placeholder catalog, and the browser audio is deterministic WebAudio
synthesis seeded by track id (the stand-in mirrors their parameter→audio
architecture). What this *is*: the edge/fleet layer — a native binary with zero
runtime deps, a shared decision engine that also runs as wasm, offline-first
playback, and a control plane built entirely on bkn primitives.
