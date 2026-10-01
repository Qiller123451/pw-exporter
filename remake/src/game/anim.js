import * as THREE from 'three';

// Small animation controller: named clips, cross-fading, fallbacks.
export class AnimCtl {
  constructor(root, clips) {
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    this.byName = new Map();
    for (const c of clips) this.byName.set(c.name.toLowerCase(), c);
    this.actions = new Map();
    this.cur = null; this.curName = null;
    this.onceCb = null;
    this.mixer.addEventListener('finished', (e) => { if (this.onceCb && e.action === this.cur) { const cb = this.onceCb; this.onceCb = null; cb(); } });
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
  // play a clip; opts: loop, ts (time scale), fade, restart, onDone
  play(name, opts = {}) {
    if (!name) return null;
    const n = name.toLowerCase();
    const a = this.action(n);
    if (!a) return null;
    const loop = opts.loop !== false;
    a.timeScale = opts.ts ?? 1;
    if (this.cur === a && !opts.restart) return a;
    a.reset();
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    a.clampWhenFinished = !loop;
    a.enabled = true;
    a.setEffectiveWeight(1);
    a.play();
    const fade = opts.fade ?? 0.2;
    if (this.cur && this.cur !== a && fade > 0) a.crossFadeFrom(this.cur, fade, false);
    else if (this.cur && this.cur !== a) this.cur.stop();
    this.cur = a; this.curName = n;
    this.onceCb = opts.onDone || null;
    return a;
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
    const fire = (lo, hi) => { for (const [t, alts] of list) if (t > lo && t <= hi) this.onEvent(alts[Math.floor(Math.random() * alts.length)]); };
    if (t1 >= t0) fire(t0, t1);
    else { fire(t0, dur + 1e-3); fire(-1, t1); }     // wrapped around (looping clip)
  }
  dispose() { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root); }
}
