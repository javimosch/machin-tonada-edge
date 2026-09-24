// Generative WebAudio engine — each track id seeds a deterministic pattern.
// No audio files: mood -> scale+timbre, bpm -> tempo, energy -> layer density.
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const MOODS = {
  // pads/arps = candidate waveforms (track seed picks); arpRate = arp note every N 16ths; res = filter Q
  calm:        { scale: [0, 4, 7, 11, 14], root: 48, pads: ['sine', 'triangle'],     arps: ['sine', 'triangle'],     hats: false, kick: false, stab: false, arpRate: 4, res: 1.2 },
  warm:        { scale: [0, 5, 7, 12, 16], root: 45, pads: ['triangle', 'sawtooth'], arps: ['sine', 'triangle'],     hats: false, kick: false, stab: false, arpRate: 2, res: 0.7 },
  bright:      { scale: [0, 4, 6, 7, 11],  root: 50, pads: ['sawtooth', 'triangle'], arps: ['triangle', 'square'],   hats: true,  kick: false, stab: false, arpRate: 1, res: 0.8 },
  driving:     { scale: [0, 3, 5, 7, 10],  root: 43, pads: ['sawtooth', 'square'],   arps: ['square', 'sawtooth'],   hats: true,  kick: true,  stab: false, arpRate: 1, res: 1.6 },
  celebratory: { scale: [0, 4, 7, 12, 16], root: 48, pads: ['sawtooth', 'square'],   arps: ['triangle', 'square'],   hats: true,  kick: true,  stab: true,  arpRate: 1, res: 1.0 },
  late:        { scale: [0, 3, 7, 8, 10],  root: 41, pads: ['triangle', 'sine'],     arps: ['sine'],                 hats: false, kick: false, stab: false, arpRate: 8, res: 2.8 },
};
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

export class AudioEngine {
  constructor() { this.ctx = null; this.deck = null; this.master = null; }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    // (first call only: build graph)
    const ctx = this.ctx = new AudioContext();
    this.master = ctx.createGain(); this.master.gain.value = 0.6;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(ctx.destination);
    const len = ctx.sampleRate * 0.5, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    this.step = 0; this.nextT = 0;
    this.timer = setInterval(() => this.schedule(), 30);
  }

  toggle() {
    if (!this.ctx) return false;
    if (this.ctx.state === 'running') { this.ctx.suspend(); return false; }
    this.ctx.resume(); return true;
  }

  setDecision(d) {
    if (!this.ctx) return;
    this.want = d;
    this.master.gain.setTargetAtTime(0.6 * (d.volume ?? 0.6), this.ctx.currentTime, 0.4);
    if (!this.deck || this.deck.id !== d.track) this.swapDeck(d);
  }

  swapDeck(d) {
    const ctx = this.ctx, t = ctx.currentTime;
    if (this.deck) {
      const old = this.deck; this.deck = null;
      old.gain.gain.setTargetAtTime(0, t, 0.5);
      setTimeout(() => old.nodes.forEach(n => { try { n.stop ? n.stop() : n.disconnect(); } catch {} }), 2500);
    }
    const cfg = MOODS[d.mood] || MOODS.calm;
    const r = rng(hash(d.track));
    const pick = a => a[Math.floor(r() * a.length)];
    const g = ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(0.9, t, 0.8); g.connect(this.master);
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 500 + (d.energy ?? 0.5) * 4200; flt.Q.value = cfg.res;
    // per-track stereo placement — cheap but very audible differentiation
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = (r() * 2 - 1) * 0.55; flt.connect(p); p.connect(g); }
    else flt.connect(g);
    const deck = { id: d.track, cfg, r, gain: g, flt, nodes: [], stepDur: 60 / (d.bpm || 96) / 4 };
    const deg = cfg.scale;
    deck.chords = [0, 1, 2, 3].map(() => Math.floor(r() * (deg.length - 2)));
    deck.arpPat = Array.from({ length: 16 }, () => Math.floor(r() * deg.length));
    // per-track voice: timbre, register, rhythm feel
    deck.arpWave = pick(cfg.arps);
    deck.padWave = pick(cfg.pads);
    deck.oct = pick([-12, 0, 0, 12]);
    deck.swing = r() * 0.22;
    deck.arpGate = Array.from({ length: 16 }, () => r() < 0.35 + r() * 0.6);
    deck.arpLen = 0.9 + r() * 1.8;
    deck.detune = 2 + r() * 14;
    deck.padGain = 0.035 + r() * 0.05;
    deck.padVoicing = pick([[0, 7], [0, 12], [0, 3], [0, 10]]);
    deck.bassPat = cfg.stab ? [1,0,0,1, 0,0,1,0, 0,0,1,0, 1,0,0,0]
      : pick([[1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
              [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
              [1,0,0,0, 0,0,0,1, 0,0,1,0, 0,0,0,0],
              [1,0,0,1, 0,0,1,0, 0,0,1,0, 0,0,1,0]]);
    // pad voices always running (chord held 4 steps of 16 = 1 bar)
    deck.padOsc = [0, 1].map(i => {
      const o = ctx.createOscillator(); o.type = deck.padWave; o.detune.value = i ? deck.detune : -deck.detune;
      const og = ctx.createGain(); og.gain.value = deck.padGain;
      o.connect(og); og.connect(flt); o.start(); deck.nodes.push(o); return o;
    });
    this.deck = deck;
  }

  schedule() {
    const ctx = this.ctx;
    if (!this.deck || !this.want) return;
    const dk = this.deck;
    if (this.nextT < ctx.currentTime) this.nextT = ctx.currentTime + 0.05;
    while (this.nextT < ctx.currentTime + 0.18) {
      this.playStep(this.step, this.nextT);
      this.step = (this.step + 1) % 64;         // 4 bars of 16ths
      this.nextT += dk.stepDur;
    }
  }

  playStep(s, t) {
    const ctx = this.ctx, dk = this.deck, cfg = dk.cfg, deg = cfg.scale, r = dk.r;
    const bar = Math.floor(s / 16), st = s % 16;
    const chordRoot = cfg.root + deg[dk.chords[bar]];
    const tt = t + (st % 2 === 1 ? dk.stepDur * dk.swing : 0);   // per-track swing on off-16ths
    if (st === 0) dk.padOsc.forEach((o, i) => o.frequency.setTargetAtTime(mtof(chordRoot + dk.padVoicing[i]), t, 0.08));
    // bass
    if (dk.bassPat[st]) this.tone('sine', mtof(chordRoot - 12), tt, dk.stepDur * 2.2, 0.30);
    // arp (energy-gated; rate/density/octave/wave all per-track)
    if ((this.want.energy ?? 0) > 0.35 && st % cfg.arpRate === 0 && dk.arpGate[st]) {
      const note = cfg.root + 12 + dk.oct + deg[dk.arpPat[st] % deg.length] + (cfg.stab ? 12 : 0);
      this.tone(dk.arpWave, mtof(note), tt, dk.stepDur * dk.arpLen, 0.06 + (this.want.energy ?? 0.5) * 0.10);
    }
    // hats
    if (cfg.hats && st % 2 === 1) this.hat(tt, st % 4 === 3 ? 0.10 : 0.05);
    // kick
    if (cfg.kick && st % 4 === 0) this.kick(tt);
  }

  tone(type, f, t, dur, vol) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.setTargetAtTime(0, t + dur * 0.5, dur * 0.25);
    o.connect(g); g.connect(this.deck.flt); o.start(t); o.stop(t + dur * 1.4);
  }

  hat(t, vol) {
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.setTargetAtTime(0, t, 0.02);
    src.connect(f); f.connect(g); g.connect(this.deck.flt); src.start(t); src.stop(t + 0.08);
  }

  kick(t) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(0.5, t); g.gain.setTargetAtTime(0, t, 0.09);
    o.connect(g); g.connect(this.deck.flt); o.start(t); o.stop(t + 0.3);
  }
}
