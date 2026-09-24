#!/usr/bin/env python3
"""Build the self-contained hart artifacts.

  dist/tonada-edge-device.html — virtual device: bundled app (three.js inlined by
    esbuild) + edge-core.wasm + GLB embedded as base64. Strict-CSP clean: no
    fetch/XHR/WS, no external refs.
  dist/tonada-edge-fleet.html  — fleet dashboard template; live data arrives via
    window.HART_DATA (hart refresh --url -> bkn fleet hook).

Usage: ./build-hart.py   (needs `npm i` once for esbuild+three)
"""
import base64, pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent
DIST = ROOT / "dist"
DIST.mkdir(exist_ok=True)

def b64(p): return base64.b64encode(pathlib.Path(p).read_bytes()).decode()

# --- device artifact ---------------------------------------------------------
subprocess.run(
    ["npx", "esbuild", "demo/js/app.js", "--bundle", "--format=esm",
     "--minify", "--outfile=dist/app.bundle.js"],
    cwd=ROOT, check=True)

index = (ROOT / "demo/index.html").read_text()
bundle = (DIST / "app.bundle.js").read_text()

assets = (
    "<script>window.__ASSETS__={\n"
    f"'edge-core.wasm':'{b64(ROOT / 'assets/edge-core.wasm')}',\n"
    f"'tonada-edge-box.glb':'{b64(ROOT / 'assets/tonada-edge-box.glb')}'"
    "};</script>")

# generated MusicGen clips (assets/clips/<track>.mp3) — embedded so the box can
# play real generated audio instead of the synth stand-in
clips_dir = ROOT / "assets/clips"
clips = ""
if clips_dir.is_dir():
    entries = ",\n".join(
        f"'{p.stem}':'{b64(p)}'" for p in sorted(clips_dir.glob("*.mp3")))
    if entries:
        clips = f"<script>window.__CLIPS__={{\n{entries}\n}};</script>"
        print(f"embedded {len(list(clips_dir.glob('*.mp3')))} clips "
              f"({sum(p.stat().st_size for p in clips_dir.glob('*.mp3'))/1e3:.0f} KB)")

# strip the importmap + module script tag, splice in assets + bundle
index = re.sub(r'<script type="importmap">.*?</script>', "", index, flags=re.S)
index = index.replace('<script type="module" src="js/app.js"></script>',
                      assets + clips + "\n<script type=\"module\">" + bundle + "</script>")
out = DIST / "tonada-edge-device.html"
out.write_text(index)
print(f"{out}  {out.stat().st_size/1e6:.2f} MB")

# --- fleet artifact ----------------------------------------------------------
out = DIST / "tonada-edge-fleet.html"
out.write_text((ROOT / "demo/fleet.html").read_text())
print(f"{out}  {out.stat().st_size/1e3:.1f} KB")
