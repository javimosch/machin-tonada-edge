// wasm host glue for edge-core.wasm (machin wasm32-wasi reactor module).
export async function loadEngine(src) {
  let mem;
  const dec = new TextDecoder(), enc = new TextEncoder();
  const cstr = p => { const b = new Uint8Array(mem.buffer); let e = Number(p); while (b[e]) e++; return dec.decode(b.subarray(Number(p), e)); };
  const wasi = new Proxy({}, { get: () => () => 0 });
  // src: URL string (dev) or Uint8Array (embedded single-file build — no fetch under strict CSP)
  const bytes = typeof src === 'string' ? await (await fetch(src)).arrayBuffer() : src;
  const { instance } = await WebAssembly.instantiate(bytes, { env: {}, wasi_snapshot_preview1: wasi });
  mem = instance.exports.memory;
  instance.exports._initialize?.();
  const ex = instance.exports;

  function call_str(fn, arg) {
    const b = enc.encode(arg);
    const p = Number(ex.input_buf(BigInt(b.length)));
    new Uint8Array(mem.buffer).set(b, p);
    return cstr(fn(BigInt(p)));
  }
  return {
    decide: (signals) => JSON.parse(call_str(ex.decide, JSON.stringify(signals))),
    catalog: () => JSON.parse(cstr(ex.catalog_json())),
  };
}
