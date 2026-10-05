// Original ParaWorld sound events and music.
//
// Data: assets/sounds.json (built by tools/build_sounds.py from Scripts/Server/init/*.txt)
//   events:   { name(lowercase): { g: global?, seq: sequential?, s: [[file, volume 0..100, maxHearingDistance], ...] } }
//   material: MaterialEffects.txt  { weaponFx: { targetFx: [sfxEvent, gfx] } }
//   files:    original wav path (lowercase) -> the file below assets/snd/ (the toolkit's server delivers the game's own
//             Audio/Sound/<path> there; most are IMA ADPCM wavs, which browsers can't decode - decodeWav() does)
// Animation sound events come from the GSF models (manifest.models[x].sounds: { anim: [[time, wav, vol, maxhear, group]] }).
//
// Channels: 'sfx' (3D world sounds), 'ui', 'voice' (one speech ack at a time), 'music' (streamed mp3).
import * as THREE from 'three';

const MUSIC = {
  menu: ['01_maintheme'],
  background: ['11_plain_jungle_1', '12_plain_jungle_2'],
  combat: { SEAS: ['38_combat_seas_1'], Aje: ['36_combat_aje_1', '42_combat_aje_2'], Hu: ['36_combat_aje_1'], Ninigi: ['42_combat_aje_2'] },
  victory: ['02_victory'], defeat: ['03_defeat'],
};
// MusicMgr.txt: combat music after 3 attacks, falls back 10 s after the last one
const COMBAT_TRIGGER = 3, COMBAT_DELAY = 10;

// ---------------------------------------------------------------- IMA ADPCM (wav format 0x11)
const IMA_STEP = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97,
  107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
  1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484,
  7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767];
const IMA_INDEX = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];
// a RIFF/WAVE with IMA ADPCM data -> AudioBuffer (null for other formats: the browser decodes those)
export function decodeWav(ctx, buf) {
  const dv = new DataView(buf);
  if (buf.byteLength < 44 || dv.getUint32(0, false) !== 0x52494646 || dv.getUint32(8, false) !== 0x57415645) return null;
  let o = 12, fmt = null, data = null;
  while (o + 8 <= buf.byteLength) {
    const id = dv.getUint32(o, false), size = dv.getUint32(o + 4, true);
    if (id === 0x666d7420) fmt = { tag: dv.getUint16(o + 8, true), ch: dv.getUint16(o + 10, true), rate: dv.getUint32(o + 12, true), align: dv.getUint16(o + 20, true), bits: dv.getUint16(o + 22, true) };
    else if (id === 0x64617461) data = [o + 8, Math.min(size, buf.byteLength - o - 8)];
    o += 8 + size + (size & 1);
  }
  if (!fmt || !data || fmt.tag !== 0x11 || fmt.bits !== 4) return null;
  const ch = fmt.ch, align = fmt.align, perBlock = (align - 4 * ch) * 2 / ch + 1;
  const blocks = Math.floor(data[1] / align);
  const n = blocks * perBlock;
  const out = ctx.createBuffer(ch, Math.max(1, n), fmt.rate);
  const chans = [...Array(ch).keys()].map((c) => out.getChannelData(c));
  const b = new Uint8Array(buf);
  for (let k = 0; k < blocks; k++) {
    const base = data[0] + k * align;
    const pred = [], idx = [];
    for (let c = 0; c < ch; c++) {
      pred[c] = dv.getInt16(base + 4 * c, true); idx[c] = Math.min(88, b[base + 4 * c + 2]);
      chans[c][k * perBlock] = pred[c] / 32768;
    }
    // then groups of 4 bytes (8 samples, low nibble first) per channel, channels interleaved
    let p = base + 4 * ch, s = 1;
    while (s < perBlock) {
      for (let c = 0; c < ch; c++) {
        for (let i = 0; i < 4; i++) {
          const byte = b[p++];
          for (let h = 0; h < 2; h++) {
            const nib = h ? byte >> 4 : byte & 15;
            const step = IMA_STEP[idx[c]];
            const diff = ((2 * (nib & 7) + 1) * step) >> 3;
            pred[c] = Math.max(-32768, Math.min(32767, pred[c] + (nib & 8 ? -diff : diff)));
            idx[c] = Math.max(0, Math.min(88, idx[c] + IMA_INDEX[nib]));
            const si = s + i * 2 + h;
            if (si < perBlock) chans[c][k * perBlock + si] = pred[c] / 32768;
          }
        }
      }
      s += 8;
    }
  }
  return out;
}

export class Audio {
  constructor(base = 'assets/') {
    this.base = base;
    this.ctx = null;
    this.db = { events: {}, material: {}, files: {} };
    this.buffers = new Map();       // file -> Promise<AudioBuffer>
    this.seqIdx = new Map();
    this.listener = new THREE.Vector3();
    this.hearScale = 1.6;           // original hearing distances are for a closer camera
    this.vol = { master: 0.8, sfx: 0.9, ui: 0.8, voice: 1, music: 0.45 };
    this.muted = false;
    this.voice = null;              // current speech ack source
    this.active = 0;                // playing world sounds (capped)
    this.music = null; this.musicMode = ''; this.combatHits = []; this.lastCombat = -99;
  }
  async load() {
    try { this.db = await (await fetch(this.base + 'sounds.json')).json(); } catch (e) { console.warn('no sounds.json', e); }
  }
  // the AudioContext may only start after a user gesture
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.out = this.ctx.createGain(); this.out.connect(this.ctx.destination);
      this.bus = {};
      for (const k of ['sfx', 'ui', 'voice']) { const g = this.ctx.createGain(); g.connect(this.out); this.bus[k] = g; }
      this.applyVolumes();
    } catch (e) { this.ctx = null; }
  }
  applyVolumes() {
    if (this.out) this.out.gain.value = this.muted ? 0 : this.vol.master;
    if (this.bus) for (const k in this.bus) this.bus[k].gain.value = this.vol[k];
    if (this.music) this.music.volume = this.muted ? 0 : this.vol.music * this.vol.master;
  }
  buffer(file) {
    if (!this.buffers.has(file)) {
      this.buffers.set(file, fetch(this.base + 'snd/' + file).then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((b) => (b ? decodeWav(this.ctx, b) || this.ctx.decodeAudioData(b) : null)).catch(() => null));
    }
    return this.buffers.get(file);
  }
  has(name) { return !!(name && this.db.events[name.toLowerCase()]); }
  // play a sound file; pos = world position (null for 2D), maxHear = original hearing distance
  async playFile(file, vol = 70, pos = null, maxHear = 0, channel = 'sfx', rate = 1) {
    if (!this.ctx || this.muted || !file) return null;
    let gain = vol / 100;
    if (pos) {
      const d = Math.hypot(pos.x - this.listener.x, pos.z - this.listener.z);
      const R = (maxHear || 60) * this.hearScale;
      if (d > R) return null;
      gain *= Math.pow(1 - d / R, 1.5);
      if (gain < 0.01) return null;
      if (this.active > 24) return null;
    }
    const buf = await this.buffer(file);
    if (!buf) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(g);
    if (pos && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      const dx = pos.x - this.listener.x, dz = pos.z - this.listener.z;
      const a = Math.atan2(dx, -dz) - (this.yaw || 0);
      p.pan.value = Math.max(-0.8, Math.min(0.8, Math.sin(a) * Math.min(1, Math.hypot(dx, dz) / 30)));
      g.connect(p); p.connect(this.bus[channel]);
    } else g.connect(this.bus[channel]);
    if (pos) { this.active++; src.onended = () => { this.active--; }; }
    src.start();
    return src;
  }
  // play an event by name (random or sequential choice among its sounds)
  play(name, pos = null, channel) {
    if (!this.ctx || !name) return null;
    const ev = this.db.events[name.toLowerCase()];
    if (!ev || !ev.s.length) return null;
    let i;
    if (ev.seq) { i = (this.seqIdx.get(name) || 0) % ev.s.length; this.seqIdx.set(name, i + 1); } else i = Math.floor(Math.random() * ev.s.length);
    const [file, vol, maxHear] = ev.s[i];
    return this.playFile(file, vol, ev.g ? null : pos, maxHear, channel || (name.startsWith('voice_') ? 'voice' : ev.g ? 'ui' : 'sfx'));
  }
  // first existing event of a list (the UI sound manager's fallback chain)
  playFirst(names, pos, channel) { for (const n of names) if (this.has(n)) return this.play(n, pos, channel); return null; }
  // speech acknowledgements: one at a time, newest wins
  async ack(names) {
    const n = names.find((x) => this.has(x));
    if (!n) return;
    if (this.voice && this.voiceBusy) return;
    this.voiceBusy = true;
    const src = await this.play(n, null, 'voice');
    if (!src) { this.voiceBusy = false; return; }
    this.voice = src;
    src.addEventListener('ended', () => { if (this.voice === src) { this.voiceBusy = false; this.voice = null; } });
  }
  // weapon hit: MaterialEffects[weapon fx][target fx] -> sfx event
  hit(weaponFx, targetFx, pos) {
    const row = this.db.material[weaponFx || ''] || null;
    const e = row && (row[targetFx || 'Unit'] || row.Unit);
    if (e && e[0]) this.play(e[0], pos, 'sfx');
  }
  // animation sound events of a model (see AnimCtl.onEvent)
  animEvent(ev, pos) {
    const f = this.db.files[(ev[1] || '').toLowerCase()];
    if (f) this.playFile(f, ev[2], pos, ev[3] || 50, 'sfx', 0.95 + Math.random() * 0.1);
  }

  // stop everything for good (Exit game): music element, all buffers, the audio context
  shutdown() {
    this.muted = true;
    try { if (this.music) { this.music.pause(); this.music.src = ''; this.music = null; } } catch (e) { /* ignore */ }
    try { if (this.ctx) this.ctx.close(); } catch (e) { /* ignore */ }
    this.ctx = null;
  }

  // ------------------------------------------------------------------ music
  playMusic(mode, tribe) {
    let list = MUSIC[mode];
    if (list && !Array.isArray(list)) list = list[tribe] || list.SEAS;
    if (!list || this.musicMode === mode) return;
    this.musicMode = mode;
    const track = list[Math.floor(Math.random() * list.length)];
    const once = mode === 'victory' || mode === 'defeat';
    const el = new window.Audio(this.base + 'music/' + track + '.mp3');
    el.loop = false;
    el.volume = 0;
    el.addEventListener('ended', () => { if (!once && this.music === el) { this.musicMode = ''; this.playMusic(mode, tribe); } });
    const old = this.music;
    this.music = el;
    el.play().catch(() => {});
    // cross-fade (MusicMgr: 5 s fade in)
    const target = () => (this.muted ? 0 : this.vol.music * this.vol.master);
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / (once ? 500 : 3000));
      if (this.music === el) el.volume = target() * k;
      if (old) old.volume = Math.max(0, old.volume * (1 - k));
      if (k < 1) requestAnimationFrame(step); else if (old) old.pause();
    };
    step();
  }
  // A play list (the shooter): the tracks in a shuffled order, one after the other with a cross-fade, never the same
  // one twice in a row; a file that is missing is skipped. `key` names the list - asking for the one that plays
  // changes nothing, another one fades over to its first track.
  playList(key, tracks) {
    if (!tracks || !tracks.length || this.musicMode === 'list:' + key) return;
    this.musicMode = 'list:' + key;
    let queue = [], fails = 0;
    const next = () => {
      if (this.musicMode !== 'list:' + key) return;
      if (!queue.length) {
        queue = tracks.slice();
        for (let i = queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [queue[i], queue[j]] = [queue[j], queue[i]]; }
        if (queue.length > 1 && queue[0] === this.lastTrack) queue.push(queue.shift());
      }
      const track = this.lastTrack = queue.shift();
      const el = new window.Audio(this.base + 'music/' + track + '.mp3');
      el.loop = false; el.volume = 0;
      el.addEventListener('ended', () => { if (this.music === el) next(); });
      el.addEventListener('error', () => { if (this.music === el && ++fails <= tracks.length) next(); });
      el.addEventListener('playing', () => { fails = 0; });
      const old = this.music;
      this.music = el; this.musicTrack = track;
      el.play().catch(() => {});
      const target = () => (this.muted ? 0 : this.vol.music * this.vol.master), t0 = performance.now();
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / 3000);
        if (this.music === el) el.volume = target() * k;
        if (old) old.volume = Math.max(0, old.volume * (1 - k));
        if (k < 1) requestAnimationFrame(step); else if (old) old.pause();
      };
      step();
    };
    next();
  }
  // called for every hit on the player's units/buildings
  combatEvent(time) {
    this.combatHits.push(time);
    while (this.combatHits.length && this.combatHits[0] < time - 5) this.combatHits.shift();
    if (this.combatHits.length >= COMBAT_TRIGGER) this.lastCombat = time;
  }
  updateMusic(time, tribe) {
    if (this.musicMode === 'victory' || this.musicMode === 'defeat') return;
    const combat = time - this.lastCombat < COMBAT_DELAY;
    if (combat && this.musicMode !== 'combat') this.playMusic('combat', tribe);
    else if (!combat && this.musicMode !== 'background') this.playMusic('background', tribe);
  }
}
