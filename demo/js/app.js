// Glue: UI signals -> wasm edge-core -> now-playing card + LED + generative audio.
import { loadEngine } from './wasm.js';
import { initScene } from './scene3d.js';
import { AudioEngine } from './audio.js';

const $ = id => document.getElementById(id);
const log = m => { const el = $('log'); el.textContent = m + '\n' + el.textContent; };

const state = { online: 1, weekday: 1, event: 0, audio: false, playing: false, dayTimer: null };

// dev: fetch from ../assets/ — hart single-file build: bytes embedded in window.__ASSETS__
function asset(name) {
  const b64 = (window.__ASSETS__ || {})[name];
  if (!b64) return '../assets/' + name;
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

const engine = await loadEngine(asset('edge-core.wasm'));
const glb = asset('tonada-edge-box.glb');
// 3D is a presentation layer — never let a WebGL failure take the engine down with it
let scene = { setLED() {}, setPower() {} };
try { scene = initScene($('view'), glb instanceof Uint8Array ? glb.buffer : glb); }
catch (e) { log('3D scene unavailable: ' + e.message); }
const audio = new AudioEngine();

function signals() {
  return {
    time_min:  +$('s-time').value,
    weekday:   state.weekday,
    weather:   $('s-weather').value,
    occupancy: +$('s-occ').value / 100,
    pos_rate:  +$('s-pos').value,
    event:     state.event,
    online:    state.online,
  };
}

let lastTrack = '', queued = false, lastD = null;
function applyDecision(d) {
  lastD = d;
  $('np-title').textContent = d.title || '—';
  $('np-meta').textContent = `${d.track || '—'} · ${d.mood || '—'} · ${d.bpm || '—'} bpm · energy ${(d.energy || 0).toFixed(2)}`;
  $('energy-bar').style.width = ((d.energy || 0) * 100) + '%';
  const src = $('np-src');
  const offline = liveMode() ? !d.online : d.source === 'cache';
  src.textContent = liveMode() ? (d.online ? (d.source === 'cache' ? 'BOX LIVE · ON CACHE' : 'BOX LIVE') : 'BOX OFFLINE')
                             : (d.source === 'cache' ? 'OFFLINE · CACHED' : 'LIVE');
  src.className = 'badge ' + (offline ? 'cache' : 'live');
  $('reason').textContent = d.reason || '';
  scene.setLED(d);
  if (liveMode()) scene.setPower(!!d.online);  // the box itself is playing; audio btn is just a monitor
  if (state.audio && state.playing) audio.setDecision(d);
  if (d.track !== lastTrack) {
    if (lastTrack) log(`♪ ${d.title}  [${d.mood} · e${(d.energy || 0).toFixed(2)}${d.source === 'cache' ? ' · cache' : ''}]`);
    lastTrack = d.track;
  }
}
function decide() {
  if (queued) return; queued = true;
  requestAnimationFrame(() => {
    queued = false;
    applyDecision(engine.decide(signals()));
  });
}

// One page, two modes:
//   sim  — interactive sliders drive the wasm engine (default, no ?zone=)
//   live — mirror a real zone daemon (?zone=<id> or the picker)
// Fleet data arrives via `hart refresh --url <bkn ?op=fleet>` -> HART_DATA.
const fleet = Array.isArray(window.HART_DATA) ? window.HART_DATA : [];
const zones = {};
fleet.forEach(z => zones[z.id] = z);
let current = new URLSearchParams(location.search).get('zone') || 'sim';
const liveMode = () => current !== 'sim' && !!zones[current];
const sel = $('zone-pick');
if (fleet.length) sel.style.display = '';

const paintLive = d => { if (d && d.id) { $('z-name').textContent = d.name + ' · ' + d.city + ', ' + d.country; applyDecision(d); } };
const rebuildSel = () => {
  sel.innerHTML = `<option value="sim" ${current === 'sim' ? 'selected' : ''}>simulator · interactive</option>` +
    fleet.map(z => `<option value="${z.id}" ${z.id === current ? 'selected' : ''}>live · ${z.name} · ${z.city}</option>`).join('');
};
const setMode = () => {
  const live = liveMode();
  $('sim-card').style.display = live ? 'none' : '';
  $('day-btn').style.display = live ? 'none' : '';
  for (const id of ['audio-btn', 'box-audio'])
    $(id).textContent = state.playing ? '⏸ mute' : (live ? '▶ listen to this box' : '▶ start audio');
  if (live) paintLive(zones[current]);
  else {
    $('z-name').textContent = 'simulator · interactive';
    scene.setPower(state.playing);          // LED follows the sim's audio gate again
    decide();
  }
};
rebuildSel();
sel.onchange = () => {
  current = sel.value;
  history.replaceState(null, '', liveMode() ? '?zone=' + current : '?sim');  // shareable deep link
  setMode();
};
addEventListener('hart:data', e => {
  if (!Array.isArray(e.detail)) return;
  fleet.length = 0; e.detail.forEach(z => { fleet.push(z); zones[z.id] = z; });
  rebuildSel();
  if (liveMode()) paintLive(zones[current]);
});
setMode();

// --- wire controls
const fmtT = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
$('s-time').oninput = () => { $('o-time').textContent = fmtT(+$('s-time').value); decide(); };
$('s-occ').oninput  = () => { $('o-occ').textContent = $('s-occ').value + '%'; decide(); };
$('s-pos').oninput  = () => { $('o-pos').textContent = $('s-pos').value; decide(); };
$('s-weather').onchange = decide;
$('s-wd').onclick = e => { state.weekday ^= 1; e.target.classList.toggle('on', state.weekday); e.target.textContent = state.weekday ? 'weekday' : 'weekend'; decide(); };
$('s-ev').onclick = e => { state.event ^= 1; e.target.classList.toggle('on', state.event); decide(); };
$('kill').onclick = e => {
  state.online ^= 1;
  e.target.classList.toggle('on', !state.online);
  e.target.textContent = state.online ? 'CUT THE NETWORK' : 'RECONNECT';
  log(state.online ? '↑ uplink restored' : '✂ uplink cut — running on cached catalog');
  decide();
};

function toggleAudio() {
  if (!state.audio) { audio.start(); state.audio = true; state.playing = true; }
  else state.playing = audio.toggle();
  if (state.playing && lastD) audio.setDecision(lastD);   // feed the engine immediately — don't wait for the next repaint/push
  for (const id of ['audio-btn', 'box-audio']) {
    const b = $(id); if (!b) continue;
    b.textContent = state.playing ? '⏸ mute' : (liveMode() ? '▶ listen to this box' : '▶ start audio');
    b.classList.toggle('on', state.playing);
  }
  if (!liveMode()) scene.setPower(state.playing);
  log(state.playing ? '▶ playing' : (liveMode() ? '⏸ muted' : '⏸ paused — LED off'));
  if (!liveMode()) decide();
}
$('audio-btn').onclick = toggleAudio;
$('box-audio').onclick = e => { e.stopPropagation(); toggleAudio(); };
$('view').onclick = toggleAudio;   // the box itself is the play button

// --- "a day in 60s": scripted sweep 06:00 -> 23:00 with weather + traffic arcs
$('day-btn').onclick = () => {
  if (state.dayTimer) { clearInterval(state.dayTimer); state.dayTimer = null; $('day-btn').textContent = '▶ a day in 60s'; return; }
  const script = t => ({  // t: 0..1 over the day
    time: 360 + Math.floor(t * (1380 - 360)),
    occ: t < 0.15 ? 15 + t * 200 : t < 0.45 ? 45 + Math.sin(t * 9) * 30 : t < 0.7 ? 30 + t * 40 : 85 - t * 60,
    weather: t < 0.4 ? 'rain' : t < 0.75 ? 'clouds' : 'clear',
    pos: t < 0.4 ? 4 + t * 30 : t < 0.6 ? 26 : 8 + Math.sin(t * 20) * 8,
  });
  let t = 0; state.online = 1; $('kill').classList.remove('on'); $('kill').textContent = 'CUT THE NETWORK';
  $('day-btn').textContent = '■ stop day';
  log('— a day in 60s —');
  state.dayTimer = setInterval(() => {
    t += 1 / (60 * 10);                        // 60s at 10fps
    const s = script(Math.min(t, 1));
    $('s-time').value = s.time; $('o-time').textContent = fmtT(s.time);
    $('s-occ').value = Math.round(Math.max(0, Math.min(100, s.occ))); $('o-occ').textContent = $('s-occ').value + '%';
    $('s-pos').value = Math.round(Math.max(0, s.pos)); $('o-pos').textContent = $('s-pos').value;
    $('s-weather').value = s.weather;
    if (t > 0.55 && t < 0.75 && state.online) { $('kill').click(); log('(storm knocks the uplink out)'); }
    if (t >= 0.75 && !state.online) $('kill').click();
    decide();
    if (t >= 1) { clearInterval(state.dayTimer); state.dayTimer = null; $('day-btn').textContent = '▶ a day in 60s'; }
  }, 100);
};

log('edge-core.wasm loaded — ' + engine.catalog().length + ' tracks in catalog' + (liveMode() ? ' · live box mode' : ' · simulator'));
