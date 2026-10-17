// The ambience of a level - the client's CAtmoSoundMgr (PWClient.exe 0x432d80 .. 0x436e9d), driven by the level's
// atmosphere template (Root/Base/material_atmos "jungle.txt" ...; "No Atmos": silence) from Audio/AtmoTemplates
// (pipeline/build_sounds.py atmo -> sounds.json "atmo").
//
// A template has 36 states: the ground material of the 32 m square in the middle of the view (the most frequent of
// its 4 m ground materials; a square of forest counts as forest: index 8), whether the camera is more than 12 m
// above the ground ("HeightBreakPoint") and day or night. The state's bed (wav1, or the wav its playlist names) loops
// at the state's volume; when the state changes the new bed fades in and the old one out (after FadeDelay 0.5 s for
// another material, at once for height or daytime). Its event playlist plays one entry at a time: the entry's wav,
// a .. b times, every c .. d s, at volume e .. f (0: silent - most entries are pauses) and pan g .. h - 100 %; then a
// random other entry.
// The ambience has its own volume (SOUND_VOLTRACK_ATMO: Options, "Ambience").
const FADE_DELAY = 0.5, FADE_TIME = 1.5;
const rnd = (a, b) => a + Math.random() * (b - a);

export class Atmo {
  constructor(audio) {
    this.A = audio;
    this.T = null;           // the template's 36 states
    this.cur = -1;           // the state playing
    this.want = -1; this.wantT = 0;
    this.beds = [];          // {src, gain, state}
    this.ev = null;          // the event playlist's place: {i, left, next}
  }
  // name = the level's material_atmos ("jungle.txt"; "No Atmos" or unknown: silence)
  start(name) {
    this.stop();
    const key = String(name || '').toLowerCase().replace(/[._]txt$/, '');
    const all = this.A.db && this.A.db.atmo;
    this.T = all && all[key] ? all[key] : null;
  }
  stop() {
    for (const b of this.beds) this.fadeOut(b, 0.2);
    this.beds = []; this.cur = -1; this.want = -1; this.ev = null;
  }
  // the state for the ground material (0 .. 8), the camera's height above the ground and the daytime
  static state(mat, high, day) { return mat + 9 * ((high ? 1 : 0) + 2 * (day ? 1 : 0)); }
  update(dt, state, time) {
    const A = this.A;
    if (!this.T || !A.ctx || A.muted) return;
    if (state !== this.want) {
      // another material waits FadeDelay, the height or daytime of the same material switches at once
      const sameMat = this.cur >= 0 && state % 9 === this.cur % 9;
      this.want = state; this.wantT = sameMat ? 0 : FADE_DELAY;
    }
    if (this.want !== this.cur && (this.wantT -= dt) <= 0) this.switchTo(this.want);
    this.events(time);
  }
  switchTo(i) {
    const S = this.T[i];
    for (const b of this.beds) this.fadeOut(b, FADE_TIME);
    this.beds = [];
    this.cur = i; this.ev = null;
    if (!S) return;
    // the bed: wav1, or the wav of the playlist's W entry (the templates' playlists are '' or "W1")
    const w = S.p.find((e) => e[0] === 'W');
    const file = S.w[Math.max(0, Math.min(2, (w ? w[1] : 1) - 1))];
    if (file) this.bed(file, S.v / 100, S.r || 1);
  }
  async bed(file, vol, rate) {
    const A = this.A, buf = await A.buffer(file), cur = this.cur;
    if (!buf || !A.ctx || this.cur !== cur) return;
    const src = A.ctx.createBufferSource();
    src.buffer = buf; src.loop = true; src.playbackRate.value = rate;
    const g = A.ctx.createGain(), t = A.ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + FADE_TIME);
    src.connect(g); g.connect(A.bus.atmo);
    src.start();
    this.beds.push({ src, gain: g });
  }
  fadeOut(b, sec) {
    try {
      const t = this.A.ctx.currentTime;
      b.gain.gain.cancelScheduledValues(t); b.gain.gain.setValueAtTime(b.gain.gain.value, t); b.gain.gain.linearRampToValueAtTime(0.0001, t + sec);
      b.src.stop(t + sec + 0.05);
    } catch (e) { /* already stopped */ }
  }
  // the event playlist of the state (0x4332a0): the entry's repeats, its delays, then a random entry
  events(time) {
    const S = this.cur >= 0 ? this.T[this.cur] : null;
    if (!S || !S.e.length) return;
    let ev = this.ev;
    if (!ev) ev = this.ev = { i: 0, left: -1, next: -1 };
    const e = S.e[ev.i];
    if (ev.next < 0) ev.next = time + rnd(e[3], e[4]);
    if (ev.left < 0) ev.left = Math.round(rnd(e[1], e[2]));
    if (time < ev.next) return;
    const vol = rnd(e[7], e[8]), pan = (rnd(e[5], e[6]) - 100) / 100;
    ev.next = time + rnd(e[3], e[4]);
    const file = S.w[e[0] - 1];
    if (file && vol > 0) this.A.playFile(file, vol, null, 0, 'atmo', 1, pan);
    if (--ev.left <= 0) { ev.i = Math.floor(Math.random() * S.e.length); ev.left = -1; ev.next = -1; }
  }
}
