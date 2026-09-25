// tonada-hub — device + fleet API for the tonada-edge POC, served by a bkn hook.
// Bound hooks: tonada (daemon ops, higher rate limit) and tonada-fleet (public read).
//
//   GET/POST /v1/hooks/tonada?op=<op>[&zone=<id>]
//   ops: config | signals | set | beat | fleet
//
// Collections: tonada/zones (seeded), tonada/signals, tonada/beats, tonada/hist.
function parseBody(d) {
  try { return JSON.parse(d.body || "{}"); } catch (e) { return {}; }
}

function getSignals(zid) {
  return bkn.store.get("tonada/signals", zid) ||
    { occupancy: 0.4, pos_rate: 5, weather: "clouds", event: 0 };
}

function sigOut(s) {
  return { occupancy: s.occupancy, pos_rate: s.pos_rate, weather: s.weather, event: s.event || 0 };
}

function main(d) {
  const b = parseBody(d);
  const op = (d.query && d.query.op) || b.op || "";
  const zid = (d.query && d.query.zone) || b.zone || "";

  if (op === "config") {
    const z = bkn.store.get("tonada/zones", zid);
    if (!z) return { status: 404, body: { ok: false, error: "unknown zone " + zid } };
    return { status: 200, body: { zone: z } };
  }

  if (op === "signals") {
    if (!zid) return { status: 400, body: { ok: false, error: "zone required" } };
    // array shape: the edge daemon parses []SigIn from the raw body
    return { status: 200, body: [sigOut(getSignals(zid))] };
  }

  if (op === "set") { // POST signal override {op:"set", zone, set:{occupancy?,pos_rate?,weather?,event?}}
    if (!bkn.store.get("tonada/zones", zid)) return { status: 404, body: { ok: false, error: "unknown zone " + zid } };
    const next = sigOut(getSignals(zid));
    const set = b.set || {};
    for (const k of ["occupancy", "pos_rate", "weather", "event"])
      if (set[k] !== undefined) next[k] = set[k];
    next.updated_ms = Date.now();
    bkn.store.put("tonada/signals", next, zid);
    return { status: 200, body: { ok: true, signals: sigOut(next) } };
  }

  if (op === "beat") { // POST the daemon's local decision {op:"beat", zone, track, title, mood, energy, bpm, source, reason, uptime_s}
    if (!zid || !b.track) return { status: 400, body: { ok: false, error: "zone + track required" } };
    const ts = Date.now();
    const beat = { ts: ts, track: b.track, title: b.title, mood: b.mood, energy: b.energy,
                   bpm: b.bpm, source: b.source, reason: b.reason, uptime_s: b.uptime_s || 0 };
    bkn.store.put("tonada/beats", beat, zid);
    bkn.store.put("tonada/hist", { zone_id: zid, ts: ts, energy: b.energy, mood: b.mood, track: b.track }, "");
    return { status: 200, body: { ok: true } };
  }

  if (op === "zone") { // one zone's composed record — per-box hart data source
    const z = bkn.store.get("tonada/zones", zid);
    if (!z) return { status: 404, body: { ok: false, error: "unknown zone " + zid } };
    const s = getSignals(zid);
    const beat = bkn.store.get("tonada/beats", zid);
    const fresh = !!(beat && beat.ts && (Date.now() - beat.ts < 90000));
    const it = { id: z.id, name: z.name, brand: z.brand, city: z.city, country: z.country,
      tz_off: z.tz_off, online: fresh, last_seen: beat ? beat.ts : 0,
      weather: s.weather, occupancy: s.occupancy, pos_rate: s.pos_rate, event: s.event || 0 };
    if (beat) { it.track = beat.track; it.title = beat.title; it.mood = beat.mood;
                it.energy = beat.energy; it.bpm = beat.bpm; it.source = beat.source;
                it.reason = beat.reason; it.uptime_s = beat.uptime_s; }
    return { status: 200, body: it };
  }

  if (op === "fleet") { // composed read for the dashboard / hart data push
    const zones = bkn.store.list("tonada/zones", { limit: 50, order_by: "id" });
    const now = Date.now();
    const out = zones.map(function (z) {
      const s = getSignals(z.id);
      const beat = bkn.store.get("tonada/beats", z.id);
      const fresh = !!(beat && beat.ts && (now - beat.ts < 90000));
      const hist = bkn.store.list("tonada/hist", { where: { zone_id: z.id }, limit: 40 })
        .map(function (h) { return { energy: h.energy }; });
      const it = { id: z.id, name: z.name, brand: z.brand, city: z.city, country: z.country,
        tz_off: z.tz_off, online: fresh, last_seen: beat ? beat.ts : 0,
        weather: s.weather, occupancy: s.occupancy, pos_rate: s.pos_rate, event: s.event || 0,
        hist: hist };
      if (beat) { it.track = beat.track; it.title = beat.title; it.mood = beat.mood;
                  it.energy = beat.energy; it.bpm = beat.bpm; it.source = beat.source; it.reason = beat.reason; }
      return it;
    });
    return { status: 200, body: out };
  }

  return { status: 400, body: { ok: false, error: "unknown op — use config|signals|set|beat|fleet" } };
}
