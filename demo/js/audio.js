// Generative WebAudio engine — each track id seeds a deterministic pattern.
// No audio files: mood -> scale+timbre, bpm -> tempo, energy -> layer density.
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const MOODS = {
  calm:        { scale: [0, 4, 7, 11, 14], root: 48, pad: 'sawtooth', arp: 'sine',     hats: false, kick: false, stab: false },
  warm:        { scale: [0, 5, 7, 12, 16], root: 45, pad: 'triangle', arp: 'sine',     hats: false, kick: false, stab: false },
  bright:      { scale: [0, 4, 6, 7, 11],  root: 50, pad: 'sawtooth', arp: 'triangle', hats: true,  kick: false, stab: false },
  driving:     { scale: [0, 3, 5, 7, 10],  root: 43, pad: 'sawtooth', arp: 'square',   hats: true,  kick: true,  stab: false },
  celebratory: { scale: [0, 4, 7, 12, 16], root: 48, pad: 'sawtooth', arp: 'triangle', hats: true,  kick: true,  stab: true  },
  late:        { scale: [0, 3, 7, 8, 10],  root: 41, pad: 'triangle', arp: 'sine',     hats: false, kick: false, stab: false },
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
    const g = ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(0.9, t, 0.8); g.connect(this.master);
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 500 + (d.energy ?? 0.5) * 4200; flt.connect(g);
    const deck = { id: d.track, cfg, r, gain: g, flt, nodes: [], stepDur: 60 / (d.bpm || 96) / 4 };
    // seeded 4-chord progression over scale degrees
    const deg = cfg.scale;
    deck.chords = [0, 1, 2, 3].map(() => Math.floor(r() * (deg.length - 2)));
    deck.arpPat = Array.from({ length: 16 }, () => Math.floor(r() * deg.length));
    deck.bassPat = cfg.stab ? [1,0,0,1, 0,0,1,0, 0,0,1,0, 1,0,0,0] : [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0];
    // pad voices always running (chord held 4 steps of 16 = 1 bar)
    deck.padOsc = [0, 1].map(i => {
      const o = ctx.createOscillator(); o.type = cfg.pad; o.detune.value = i ? 7 : -6;
      const og = ctx.createGain(); og.gain.value = 0.05;
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
    if (st === 0) dk.padOsc.forEach((o, i) => o.frequency.setTargetAtTime(mtof(chordRoot + [0, 7][i]), t, 0.08));
    // bass
    if (dk.bassPat[st]) this.tone('sine', mtof(chordRoot - 12), t, dk.stepDur * 2.2, 0.30);
    // arp (energy-gated)
    if ((this.want.energy ?? 0) > 0.35 && st % 2 === 0) {
      const note = cfg.root + 12 + deg[dk.arpPat[st] % deg.length] + (cfg.stab ? 12 : 0);
      this.tone(cfg.arp, mtof(note), t, dk.stepDur * 1.6, 0.06 + (this.want.energy ?? 0.5) * 0.10);
    }
    // hats
    if (cfg.hats && st % 2 === 1) this.hat(t, st % 4 === 3 ? 0.10 : 0.05);
    // kick
    if (cfg.kick && st % 4 === 0) this.kick(t);
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
