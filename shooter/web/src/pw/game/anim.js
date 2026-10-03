import * as THREE from 'three';

// Small animation controller: named clips, cross-fading, fallbacks.
//
// Start / loop / end ("S/L/E"): a clip with loop marks comes with its parts as clips "<name>#s", "#l", "#e"
// (engine/assets.js splitLoops; clips.loops = {name: [t0, t1]}). Played looping, such a clip runs its start once and
// then repeats the loop part; when another looping clip takes over (walk -> stand), the end part plays first. Played
// once (loop: false) it runs as a whole. curName stays the name that was asked for; phase is 's', 'l', 'e' or ''.
export class AnimCtl {
  constructor(root, clips) {
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    this.byName = new Map();
    for (const c of clips) this.byName.set(c.name.toLowerCase(), c);
    this.loops = {};
    for (const k in clips.loops || {}) this.loops[k.toLowerCase()] = clips.loops[k];
    this.actions = new Map();
    this.cur = null; this.curName = null; this.phase = '';
    this.onceCb = null; this.next = null;
    this.mixer.addEventListener('finished', (e) => {
      if (e.action !== this.cur) return;
      if (this.phase === 's') return this.start(this.curName + '#l', true, this.ts, 0.12, 'l');
      if (this.phase === 'e' && this.next) { const nx = this.next; this.next = null; this.phase = ''; this.curName = null; return this.play(nx.name, nx.opts); }
      if (this.onceCb) { const cb = this.onceCb; this.onceCb = null; cb(); }
    });
  }
  has(name) { return !!name && this.byName.has(name.toLowerCase()); }
  pick(...names) { for (const n of names) if (this.has(n)) return n.toLowerCase(); return null; }
  duration(name) { const c = name && this.byName.get(name.toLowerCase()); return c ? c.duration : 0; }
  action(name) {
    const n = name.toLowerCase();
    let a = this.actions.get(n);
    if (!a) { const c = this.byName.get(n); if (!c) return null; a = this.mixer.clipAction(c); this.actions.set(n, a); }
    return a;
  }
  // start one action (a whole clip or a part)
  start(n, loop, ts, fade, phase) {
    const a = this.action(n);
    if (!a) return null;
    a.reset();
    a.timeScale = ts;
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    a.clampWhenFinished = !loop;
    a.enabled = true;
    a.setEffectiveWeight(1);
    a.play();
    if (this.cur && this.cur !== a && fade > 0) a.crossFadeFrom(this.cur, fade, false);
    else if (this.cur && this.cur !== a) this.cur.stop();
    this.cur = a; this.phase = phase;
    return a;
  }
  // play a clip; opts: loop, ts (time scale), fade, restart, onDone, cut (no end part of the clip before)
  play(name, opts = {}) {
    if (!name) return null;
    const n = name.toLowerCase();
    if (!this.byName.has(n)) return null;
    const loop = opts.loop !== false;
    const ts = opts.ts ?? 1;
    const parts = loop && this.byName.has(n + '#l');
    if (this.curName === n && !opts.restart) {
      this.ts = ts;
      // its end part was running (the unit stopped and goes on again): back into the loop
      if (this.phase === 'e') { this.next = null; return this.start(n + '#l', true, ts, 0.15, 'l'); }
      if (this.cur) this.cur.timeScale = ts;
      return this.cur;
    }
    const plain = loop && !opts.restart && !opts.onDone && !opts.cut;      // cut: start at once (a unit moving off)
    // an end part is running: the clip asked for follows it
    if (this.phase === 'e' && plain) { this.next = { name, opts }; return this.cur; }
    // leaving a start / loop / end clip for another looping clip: its end part first
    if (plain && (this.phase === 'l' || this.phase === 's') && this.byName.has(this.curName + '#e')) {
      this.next = { name, opts };
      return this.start(this.curName + '#e', false, this.ts || 1, 0.12, 'e');
    }
    this.next = null;
    this.ts = ts;
    this.curName = n;
    this.onceCb = opts.onDone || null;
    const fade = opts.fade ?? 0.2;
    if (parts) return this.byName.has(n + '#s') ? this.start(n + '#s', false, ts, fade, 's') : this.start(n + '#l', true, ts, fade, 'l');
    return this.start(n, loop, ts, fade, '');
  }
  // animation sound events: { clipName: [[time, wav, volume, maxHear, group], ...] } (GSF sound table).
  // Entries sharing a time are alternatives - one of them is played.
  setEvents(map, cb) {
    this.events = new Map();
    for (const k in map || {}) {
      const byT = new Map();
      for (const e of map[k]) { const t = e[0]; if (!byT.has(t)) byT.set(t, []); byT.get(t).push(e); }
      this.events.set(k.toLowerCase(), [...byT.entries()].sort((a, b) => a[0] - b[0]));
    }
    this.onEvent = cb;
  }
  update(dt) {
    const a = this.cur;
    const t0 = a ? a.time : 0;
    this.mixer.update(dt);
    if (!this.onEvent || !a || !this.events || !a.isRunning()) return;
    const list = this.events.get(this.curName);
    if (!list) return;
    const t1 = a.time, dur = a.getClip().duration;
    // a part of a start / loop / end clip: its events are timed on the whole clip
    const lp = this.phase && this.loops[this.curName];
    const off = !lp ? 0 : this.phase === 'l' ? lp[0] : this.phase === 'e' ? lp[1] : 0;
    const fire = (lo, hi) => { for (const [t, alts] of list) if (t - off > lo && t - off <= hi) this.onEvent(alts[Math.floor(Math.random() * alts.length)]); };
    if (t1 >= t0) fire(t0, t1);
    else { fire(t0, dur + 1e-3); fire(-1, t1); }     // wrapped around (looping clip)
  }
  dispose() { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root); }
}
