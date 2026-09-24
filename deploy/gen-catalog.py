#!/usr/bin/env python3
# Generate one catalog clip per track id with MusicGen small (transformers) on CPU.
# Usage: python3 gen-catalog.py <model_dir> [outdir]
import os, sys, time, json

MODEL = sys.argv[1] if len(sys.argv) > 1 else '/root/musicgen-small'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/root/mg-clips'
os.makedirs(OUT, exist_ok=True)

import torch
torch.set_num_threads(max(1, os.cpu_count() - 1))
from transformers import MusicgenForConditionalGeneration, AutoProcessor
import lameenc

# track_id, mood, bpm -> prompt. Ids must match edge-core.src catalog so the
# browser can swap a clip in for the synth when the engine picks that track.
TRACKS = [
    ('slow-tide',     'calm',        72,  'slow ambient downtempo, soft warm pads, gentle ocean waves, meditative, minimal, 72bpm'),
    ('paper-moon',    'calm',        80,  'dreamy lo-fi chill, soft rhodes piano, vinyl warmth, calm night cafe, 80bpm'),
    ('ember-line',    'warm',        86,  'warm acoustic folk, soft guitar strumming, cozy fireplace, 86bpm'),
    ('rainy-window',  'warm',        88,  'melancholic warm piano, rain on window, gentle strings, cozy cafe, 88bpm'),
    ('morning-glass', 'bright',      100, 'bright uplifting indie pop, sunny morning, light guitar, optimistic, 100bpm'),
    ('seine-glow',    'bright',      106, 'cheerful french cafe jazz, light accordion, bright sunny afternoon, 106bpm'),
    ('warm-wire',     'driving',     116, 'energetic electronic groove, driving beat, funky bass, retail energy, 116bpm'),
    ('rhythm-glow',   'driving',     122, 'upbeat dance groove, punchy kick, bright synths, energetic, 122bpm'),
    ('grand-opening', 'celebratory', 126, 'festive celebratory brass and drums, triumphant opening, joyful, 126bpm'),
    ('last-call',     'late',        96,  'late night jazz bar, smoky saxophone, slow groove, moody, 96bpm'),
    # cached:0 tracks — only picked while online, still need real clips
    ('soft-proud',    'warm',        92,  'gentle warm soul, soft electric piano, mellow afternoon, relaxed, 92bpm'),
    ('aloha-wave',    'bright',      110, 'tropical upbeat house, steel drums, summer beach energy, bright, 110bpm'),
    ('fever',         'driving',     128, 'high energy club track, driving four on the floor, intense synths, 128bpm'),
    ('neon-quiet',    'late',        84,  'quiet late night synthwave, soft neon glow, slow pulse, dreamy, 84bpm'),
]

DURATION_S = 8                    # seconds — clips loop in the box player
MAX_TOKENS = int(DURATION_S * 50) # musicgen emits ~50 audio tokens/sec

proc = AutoProcessor.from_pretrained(MODEL)
model = MusicgenForConditionalGeneration.from_pretrained(MODEL, torch_dtype=torch.float32)
model.eval()

def save_mp3(wav_np, sr, path):
    import numpy as np
    pcm = (np.clip(wav_np, -1, 1) * 32767).astype('<i2').tobytes()
    enc = lameenc.Encoder()
    enc.set_bit_rate(96); enc.set_in_sample_rate(sr); enc.set_channels(1); enc.set_quality(2)
    open(path, 'wb').write(enc.encode(pcm) + enc.flush())

sr = model.config.audio_encoder.sampling_rate
report = []
for tid, mood, bpm, prompt in TRACKS:
    t0 = time.time()
    inputs = proc(text=[prompt], padding=True, return_tensors='pt')
    with torch.no_grad():
        audio = model.generate(**inputs, max_new_tokens=MAX_TOKENS, do_sample=True, guidance_scale=3.0)
    wav = audio[0, 0].cpu().numpy()          # mono
    save_mp3(wav, sr, os.path.join(OUT, tid + '.mp3'))
    report.append({'track': tid, 'mood': mood, 'bpm': bpm, 'gen_s': round(time.time() - t0, 1)})
    print(f'{tid}  {report[-1]["gen_s"]}s', flush=True)

json.dump(report, open(os.path.join(OUT, 'gen-report.json'), 'w'), indent=1)
print('ALL DONE', sum(r['gen_s'] for r in report), 's total')
