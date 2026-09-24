#!/usr/bin/env bash
# Build tonada-edge (native daemon) + edge-core.wasm (browser engine).
set -euo pipefail
cd "$(dirname "$0")"

machin encode src/edge-core.src src/daemon.src > tonada-edge.mfl
machin build tonada-edge.mfl -o tonada-edge
echo "built tonada-edge ($(stat -c%s tonada-edge) bytes)"

machin encode src/edge-core.src > edge-core.mfl
machin build edge-core.mfl --target wasm32-wasi -o assets/edge-core.wasm
echo "built assets/edge-core.wasm ($(stat -c%s assets/edge-core.wasm) bytes)"

# one-shot engine CLI (optional): machin encode src/edge-core.src src/edge-cli.src > cli.mfl
