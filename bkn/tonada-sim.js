// tonada-sim — cron job: drifts zone signals so the fleet looks alive.
// Traffic follows a local-day curve (7h–19h hump) + noise; POS follows traffic;
// weather occasionally flips. Scheduled: */2 * * * * via bkn cron.
function main() {
  const zones = bkn.store.list("tonada/zones", { limit: 50 });
  const now = Date.now();
  for (const z of zones) {
    const s = bkn.store.get("tonada/signals", z.id) ||
      { occupancy: 0.5, pos_rate: 8, weather: "clouds", event: 0 };
    const hour = new Date(now + (z.tz_off || 0) * 3600e3).getUTCHours() +
                 new Date(now).getUTCMinutes() / 60;
    const curve = Math.max(0, Math.sin((hour - 7) / 12 * Math.PI));
    const occ = Math.min(1, Math.max(0.05,
      0.15 + 0.75 * curve + (Math.random() - 0.5) * 0.15));
    const pos = Math.max(0, Math.round(occ * 30 + (Math.random() - 0.5) * 4));
    let w = s.weather || "clouds";
    if (Math.random() < 0.1)
      w = ["clear", "clouds", "rain"][Math.floor(Math.random() * 3)];
    bkn.store.put("tonada/signals",
      { occupancy: occ, pos_rate: pos, weather: w, event: s.event || 0, updated_ms: now }, z.id);
  }
  return { ok: true, zones: zones.length };
}
