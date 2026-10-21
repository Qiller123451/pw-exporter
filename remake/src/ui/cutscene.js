// An in-engine cutscene played as the original's sequencer does (docs/SEQUENCE_FORMAT.md §9; the data:
// pwexport/campaign.py seq_play; the actors: game/campaign/sequence.js).
//
//   * The game stands still (the server skips the world update while a sequence runs); only the scene's actors move.
//   * Camera: the cut covering the moment picks a camera; its position, turn and field-of-view keys are evaluated as
//     the client does (segment helpers below), it looks along its local +y with the world's up (map space, +z up),
//     its field of view is vertical in radians. Camera shake items shake it, day time items set the clock.
//   * Actors: the bound world objects and, for an actor nothing in the world matches, a model drawn for the scene
//     only. Walks and recorded paths move them, the animation items play on their models (a walk plays the walk of
//     its speed), attribute items hide and show them.
//   * Speech: each lip-sync item plays its .mp3 (assets/SeqSounds) and shows its subtitle for its length;
//     sounds, particle effects, fades to and from black, the wide-screen bars and the time skips of cut items.
// Objects inside the scene's region are hidden while it plays when the file asks for it.
import * as THREE from 'three';
import { cloneModel, toLinkFrame } from '../engine/assets.js';
import { AnimCtl } from '../game/anim.js';
import { SeqActors } from '../game/campaign/sequence.js';

const lerp = (a, b, f) => a + (b - a) * f;
// Camera tracks as the client evaluates them (_notes/re_seq_camera.md; PWClient 0x43b980 / 0x438150 / 0x4389a0 /
// 0x439cb0). Keys: position [t, x, y, z, interp, tcb0, tcb1, ease0, ease1], turn [t, qx, qy, qz, qw, interp, ...],
// field of view [t, fov, interp, ...]. Before the first key its value, after the last the last one's; segment i (key
// i-1 to key i, t_(i-1) < t <= t_i) uses key i's interpolation.
function segment(K, t) {
  if (t <= K[0][0]) return { i: 0, s: 0 };
  const L = K.length;
  if (t > K[L - 1][0]) return { i: L - 1, s: 1 };
  let i = 1;
  while (K[i][0] < t) i++;
  return { i, s: (t - K[i - 1][0]) / Math.max(1e-6, K[i][0] - K[i - 1][0]) };
}
const hermite = (p0, p1, t0, t1, s) => { const s2 = s * s, s3 = s2 * s; return p0 * (2 * s3 - 3 * s2 + 1) + p1 * (3 * s2 - 2 * s3) + t0 * (s3 - 2 * s2 + s) + t1 * (s3 - s2); };
// one segment of a value track: vals(k) = the values of key k, o = index of the key's interp in a key; types 1 linear,
// 2 cosine, 3 smoothstep, 4 Catmull-Rom, 5 cardinal with key i's tcb0, 8 (position only) Hermite with per-key
// tangent scales (tcb0 in, tcb1 out) and outer-chord weights (ease0 in, ease1 out); any other type: key i's value
function trackValue(K, t, vals, o, eight) {
  const { i, s } = segment(K, t);
  if (i === 0 || s >= 1) return vals(i);
  const L = K.length, k = K[i], type = k[o];
  const P0 = vals(i - 1), P1 = vals(i), Pm = vals(Math.max(i - 2, 0)), P2 = vals(Math.min(i + 1, L - 1));
  if (type === 1 || type === 2 || type === 3) {
    const w = type === 1 ? s : type === 2 ? (1 - Math.cos(Math.PI * s)) / 2 : 3 * s * s - 2 * s * s * s;
    return P0.map((v, j) => lerp(v, P1[j], w));
  }
  if (type === 4 || type === 5) {
    const c = type === 4 ? 0.5 : k[o + 1];
    return P0.map((v, j) => hermite(v, P1[j], c * (P1[j] - Pm[j]), c * (P2[j] - v), s));
  }
  if (type === 8 && eight) {
    const kp = K[i - 1], c = k[o + 1], d = k[o + 3];
    const a = kp[o] === 8 ? kp[o + 2] : 0.5, b = kp[o] === 8 ? kp[o + 4] : 1;
    return P0.map((v, j) => hermite(v, P1[j], a * ((P1[j] - v) + b * (v - Pm[j])), c * ((P1[j] - v) + d * (P2[j] - P1[j])), s));
  }
  return P1;
}
// the forward (local +y) and up (local +z) columns of ula.rotation_matrix(q), q = [x, y, z, w] not normalized
const fwdOf = (q) => [2 * (q[0] * q[1] + q[2] * q[3]), 1 - 2 * (q[0] * q[0] + q[2] * q[2]), 2 * (q[1] * q[2] - q[3] * q[0])];
const upOf = (q) => [2 * (q[0] * q[2] - q[1] * q[3]), 2 * (q[1] * q[2] + q[0] * q[3]), 1 - 2 * (q[0] * q[0] + q[1] * q[1])];
const norm3 = (v) => { const n = Math.hypot(v[0], v[1], v[2]); return n > 1e-12 ? v.map((x) => x / n) : v; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const quat = (k) => k.slice(1, 5);
// SQUAD inner quaternion (0x43b5e0, type 7; no file uses it)
const Q = (q) => new THREE.Quaternion(q[0], q[1], q[2], q[3]).normalize();
function qlog(q) { const v = Math.hypot(q.x, q.y, q.z), a = Math.atan2(v, q.w), f = v > 1e-9 ? a / v : 1; return [q.x * f, q.y * f, q.z * f]; }
function qexp(v) { const a = Math.hypot(v[0], v[1], v[2]), f = a > 1e-9 ? Math.sin(a) / a : 1; return new THREE.Quaternion(v[0] * f, v[1] * f, v[2] * f, Math.cos(a)); }
function inner(q0, q1, q2) {
  const inv = q1.clone().invert();
  const a = qlog(inv.clone().multiply(q2)), b = qlog(inv.clone().multiply(q0));
  return q1.clone().multiply(qexp([-(a[0] + b[0]) / 4, -(a[1] + b[1]) / 4, -(a[2] + b[2]) / 4]));
}
// the camera's view direction in map space from its turn keys: only the direction is used (the view's up is the
// world's, roll is dropped). Types 1 unnormalized lerp the short way, 4 / 5 cardinal on the rotation matrices
// re-orthonormalized about their up column, 6 slerp, 7 SQUAD, other types key i's turn.
function viewDir(K, t) {
  const { i, s } = segment(K, t);
  if (i === 0 || s >= 1) return fwdOf(quat(K[i]));
  const L = K.length, k = K[i], type = k[5];
  const q0 = quat(K[i - 1]), q1 = quat(K[i]);
  if (type === 1) {
    const sg = q0[0] * q1[0] + q0[1] * q1[1] + q0[2] * q1[2] + q0[3] * q1[3] < 0 ? -1 : 1;
    return fwdOf(q0.map((v, j) => (1 - s) * v + s * sg * q1[j]));
  }
  if (type === 4 || type === 5) {
    const c = type === 4 ? 0.5 : k[6];
    const qm = quat(K[Math.max(i - 2, 0)]), q2 = quat(K[Math.min(i + 1, L - 1)]);
    const H = (f) => { const m = f(qm), a = f(q0), b = f(q1), n = f(q2); return a.map((v, j) => hermite(v, b[j], c * (b[j] - m[j]), c * (n[j] - v), s)); };
    const z = norm3(H(upOf)), x = norm3(cross3(H(fwdOf), z));
    return cross3(z, x);
  }
  if (type === 6 || type === 7) {
    const a = Q(q0), b = Q(q1);
    if (a.dot(b) < 0) b.set(-b.x, -b.y, -b.z, -b.w);
    let r = a.clone().slerp(b, s);
    if (type === 7) {
      const m = Q(quat(K[Math.max(i - 2, 0)])), n = Q(quat(K[Math.min(i + 1, L - 1)]));
      r = r.slerp(inner(m, a, b).slerp(inner(a, b, n), s), 2 * s * (1 - s));
    }
    return fwdOf([r.x, r.y, r.z, r.w]);
  }
  return fwdOf(q1);
}

// Lip sync (_notes/re_lipsync.md; Data/Base/Sequences/Setup.ini LipSyncSetup, PWClient 0x7aadb0 / 0x6e6090): the
// .lsd next to a speech file holds the weights of the phonemes it uses (gzip: f32 fps, u32 n, n x {u32 frame, u32 k,
// k x {u32 phoneme, f32 weight}}); each phoneme is a layer turning the character's jaw towards a frame of its
// two-frame "faceanim" clip. Setup.ini's phoneme -> frame table (ids: PWClient 0x7acc70); a layer whose frame the
// clip does not have is not drawn - with the shipped clips only frame 1 (IY, IH, h, y) shows.
const PHONEME_FRAME = { 0: 0, 1: 1, 2: 1, 39: 1, 17: 1, 3: 2, 4: 2, 10: 2, 11: 2, 5: 3, 8: 3, 9: 3, 7: 4, 6: 4, 13: 5, 12: 6, 14: 6, 38: 6,
  18: 7, 20: 8, 26: 9, 29: 9, 34: 10, 35: 10, 16: 11, 19: 11, 21: 11, 22: 11, 28: 11, 31: 11, 15: 11, 23: 12, 32: 12, 33: 12, 36: 12, 37: 12, 24: 12,
  25: 13, 30: 13, 27: 13 };
async function readLsd(url) {
  const r = await fetch(url);
  if (!r.ok || typeof DecompressionStream === 'undefined') return null;
  const b = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const v = new DataView(b), fps = v.getFloat32(0, true), n = v.getUint32(4, true), out = [];
  let o = 8;
  for (let i = 0; i < n && o + 8 <= b.byteLength; i++) {
    const frame = v.getUint32(o, true), k = v.getUint32(o + 4, true); o += 8;
    const ws = [];
    for (let j = 0; j < k; j++, o += 8) ws.push([v.getUint32(o, true), v.getFloat32(o + 4, true)]);
    out.push([frame / (fps || 25), ws]);
  }
  return out;
}

export class Cutscene {
  constructor(G, M, q) {
    this.G = G; this.M = M; this.q = q;
    this.seq = q.seq; this.P = q.seq.play;
    this.C = G.campaign;
    this.actors = (q.opts && q.opts.actors) || new SeqActors(this.C, this.P);
    this.t = this.P.start || 0;
    this.done = false;
    this.started = new Set();       // items begun (speech, sounds, effects, animations)
    this.hiddenObjs = [];
    this.sounds = [];
  }
  start() {
    const G = this.G, W = G.world, P = this.P;
    this.actors.moved = true;
    // what the camera was
    const cam = G.camera;
    this.camSave = { fov: cam.fov, up: cam.up.clone() };
    // a black screen for the fades
    const fade = this.fadeEl = document.createElement('div');
    fade.style.cssText = 'position:fixed;inset:0;background:#000;pointer-events:none;z-index:40;opacity:0';
    document.body.appendChild(fade);
    // actors nothing in the world matched: drawn for the scene only
    for (const A of this.actors.list) {
      if (!A.temp) { if (A.e && A.e.anim) A.e.busyAnim = true; continue; }
      const name = W.unitModel ? W.unitModel(A.a.cls, 1, null) : null;
      const tpl = name && W.template(name, true);
      if (!tpl) continue;
      const obj = cloneModel(tpl);
      G.scene.add(obj);
      A.tobj = obj;
      A.tanim = tpl.clips && tpl.clips.length ? new AnimCtl(obj, tpl.clips) : null;
      // its attachments (the actor state's slot -> model: the spear in HndR, the buckler on Shld)
      const links = {};
      obj.traverse((o) => { if (o.name.startsWith('link_')) links[o.name.slice(5)] = o; });
      for (const [slot, model] of A.a.attach || []) {
        const at = W.template(String(model).toLowerCase(), true) || W.template(model, true);
        if (!links[slot] || !at) continue;
        const m = cloneModel(at);
        toLinkFrame(m);
        links[slot].add(m);
      }
      A.tidle = A.tanim && A.tanim.pick('standanim', 'idle_0', 'idle');
      if (A.tidle) A.tanim.play(A.tidle);
    }
    // the region's other objects are not shown (sequence flag 4)
    if (P.hide_region && P.region.length) {
      const inside = (x, z) => { const [mx, my] = this.C.toMap(x, z); return P.region.some((r) => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h); };
      const mine = new Set(this.actors.list.map((A) => A.e || A.prop).filter(Boolean));
      for (const u of W.units) if (u.alive && u.obj && u.obj.visible && !mine.has(u) && inside(u.pos.x, u.pos.z)) { u.obj.visible = false; this.hiddenObjs.push(u.obj); }
    }
    G.seqCam = () => this.camera();
    this.apply(0);
  }
  // one frame: dt real seconds
  update(dt) {
    if (this.done) return;
    const P = this.P;
    const t0 = this.t;
    this.t += dt;
    // a cut item skips its time range
    for (const it of P.items) if (it.k === 'skip' && it.len > 0 && this.t >= it.t && t0 < it.t + it.len && this.t < it.t + it.len) this.t = it.t + it.len;
    this.apply(dt);
    if (this.t >= P.end) this.done = true;
  }
  apply(dt) {
    const G = this.G, W = G.world, P = this.P, t = this.t;
    // global items
    let fadeA = 0, bars = null;
    for (const it of P.items) {
      if (it.t > t) continue;
      const k = it.k + ':' + P.items.indexOf(it);
      if (it.k === 'fade') {
        const f = it.len > 0 ? Math.min(1, (t - it.t) / it.len) : 1;
        fadeA = it.dir === 'in' ? 1 - f : f;
      } else if (it.k === 'bars') bars = it.on;
      else if (!this.started.has(k)) {
        this.started.add(k);
        if (it.k === 'sound' && G.audio && it.t + Math.max(0.2, it.len) > t) {
          const pos = it.pos ? (() => { const [x, z] = this.C.toGame(it.pos[0], it.pos[1]); return new THREE.Vector3(x, it.pos[2], z); })() : null;
          const file = String(it.path).replace(/^\/?(data\/base\/audio\/)?sound\//i, '').toLowerCase();
          G.audio.playFile(file, it.vol, pos, 80, 'sfx').then((src) => { if (!src) return; if (this.done) { try { src.stop(); } catch (e) { /* over */ } } else { if (it.loop) { src.loop = true; } this.sounds.push([src, it.t + it.len]); } }).catch(() => {});
        } else if (it.k === 'fx' && G.mfx && G.mfx.at) {
          const [x, z] = this.C.toGame(it.pos[0], it.pos[1]);
          G.mfx.at(String(it.path).split('/').pop().toLowerCase(), new THREE.Vector3(x, it.pos[2], z), Math.max(0.5, it.len));
        }
      }
    }
    this.dayItems(t);
    if (this.fadeEl) this.fadeEl.style.opacity = String(Math.max(0, Math.min(1, fadeA)));
    if (bars !== null && this.M.cineEl) this.M.cineEl.classList.toggle('on', bars);
    for (const s of this.sounds) if (s[1] <= t && s[0]) { try { s[0].stop(); } catch (e) { /* over */ } s[0] = null; }
    // actors
    let line = null;
    for (const A of this.actors.list) {
      const obj = A.e ? A.e.obj : A.prop ? A.prop.obj : A.tobj;
      if (!obj) continue;
      const p = this.actors.pose(A, t), y = p.ground ? W.height(p.x, p.z) : p.mz;
      const hid = this.actors.hidden(A, t);
      if (A.e) {
        const e = A.e;
        if (e.kind === 'unit') { e.pos.set(p.x, 0, p.z); e.pos.y = p.ground ? W.groundY(e) : p.mz; e.heading = p.h; e.syncObj(); }
      } else if (A.prop) {
        A.prop.pos.set(p.x, y, p.z); obj.position.copy(A.prop.pos); obj.rotation.y = p.h;
      } else { obj.position.set(p.x, y, p.z); obj.rotation.y = p.h; }
      if (hid !== null) obj.visible = !hid;
      else if (A.temp) obj.visible = true;
      // the animation items
      const an = A.e ? A.e.anim : A.tanim;
      if (an) {
        let cur = null;
        for (const it of A.a.items) if ((it.k === 'act' || it.k === 'anim') && it.t <= t && (t < it.t + Math.max(it.len, 0.05) || (it.k === 'anim' && it.rep === 0))) cur = it;
        let want = null, opts = {};
        const str = (x) => (typeof x === 'string' ? x : null);      // (a building's idleAnim is its method)
        if (cur && an.has(cur.anim)) { want = cur.anim; opts = { restart: !this.started.has(cur), loop: !(cur.k === 'anim' && cur.rep === 1) }; this.started.add(cur); }
        else if (p.walk && (!A.e || A.e.kind === 'unit')) want = an.pick('walk_' + p.walk.speed, 'walk_' + Math.max(0, p.walk.speed - 1), str(A.e && A.e.walkAnim), 'walk_1');
        else if (!A.e || A.e.kind === 'unit') want = str(A.e && A.e.idleAnim) || A.tidle;
        if (want && (an.curName !== String(want).toLowerCase() || opts.restart)) an.play(want, opts);
        if (dt) { an.update(dt); this.jaw(A, t); }
      }
      // speech
      for (const it of A.a.items) {
        if (it.k !== 'say' || it.t > t) continue;
        if (!this.started.has(it)) { this.started.add(it); if (it.mp3 && t < it.t + it.len) { this.say(it); if (!it.music) this.lip(A, it); } }
        if (!it.music && t < it.t + it.len + 0.3) line = it;
      }
    }
    this.subtitle(line);
  }
  // the lip-sync layers of a speech item for its actor: the jaw bone, its turn to faceanim's frame 1 and the weight
  // keys of the phonemes on frame 1 (the only frame the clips have besides the rest pose)
  lip(A, it) {
    const an = A.e ? A.e.anim : A.tanim, obj = A.e ? A.e.model || A.e.obj : A.tobj;
    const clip = an && an.byName.get('faceanim');
    const tr = clip && clip.tracks.find((x) => x.name.endsWith('.quaternion') && x.values.length >= 8);
    if (!tr || !obj) return;
    const bone = obj.getObjectByName(tr.name.slice(0, tr.name.lastIndexOf('.')));
    if (!bone) return;
    const frames = Math.max(1, tr.times.length);
    const q0 = new THREE.Quaternion().fromArray(tr.values, 0), q1 = new THREE.Quaternion().fromArray(tr.values, 4);
    const delta = q0.clone().invert().multiply(q1);
    readLsd('assets/SeqSounds/' + it.mp3.replace(/\.mp3$/i, '.lsd')).then((recs) => {
      if (!recs || this.done) return;
      const layers = new Map();
      for (const [lt, ws] of recs) for (const [id, w] of ws) {
        const f = PHONEME_FRAME[id] ?? 0;
        if (f !== 1 || f >= frames) continue;          // (frame 0 is the rest pose; frames the clip lacks are dropped)
        if (!layers.has(id)) layers.set(id, []);
        layers.get(id).push([it.t + lt, w]);
      }
      if (layers.size) A.lip = { bone, delta, layers: [...layers.values()] };
    }).catch(() => {});
  }
  // after the body animation: the jaw turned by the layers' weights (linear between keys, the ends held)
  jaw(A, t) {
    const L = A.lip;
    if (!L) return;
    let w = 0;
    for (const K of L.layers) {
      let v = K[K.length - 1][1];
      if (t <= K[0][0]) v = K[0][1];
      else for (let i = 0; i < K.length - 1; i++) if (t < K[i + 1][0]) { v = lerp(K[i][1], K[i + 1][1], (t - K[i][0]) / Math.max(1e-6, K[i + 1][0] - K[i][0])); break; }
      if (v > 0.01) w += v;
    }
    L.w = w;
    if (w > 0) L.bone.quaternion.multiply(new THREE.Quaternion().slerp(L.delta, Math.min(1, w)));
  }
  say(it) {
    const G = this.G, A = G.audio;
    if (!A || !A.ctx || A.muted || (G.settings && G.settings.sound === false)) return;
    A.playFile('../SeqSounds/' + it.mp3, 100, null, 0, it.music ? 'sfx' : 'voice').then((src) => { if (!src) return; if (this.done) { try { src.stop(); } catch (e) { /* over */ } } else this.sounds.push([src, 1e9]); }).catch(() => {});
  }
  subtitle(it) {
    const M = this.M, el = M.cineEl;
    if (!el) return;
    const l = it && (this.seq.lines || []).find((x) => x.key && it.key && x.key.toLowerCase() === it.key.toLowerCase());
    const key = l ? l.key : '';
    if (key === this.lineKey) return;
    this.lineKey = key;
    const sub = !(G_settings(this.G).subtitles === false);
    el.querySelector('.ctext').textContent = l && sub ? String(l.text).replace(/\s*\n\s*/g, ' ') : '';
    el.querySelector('.cname').textContent = l && sub && l.speaker ? M.speakerName(l.speaker) + M.text('_NT_ACTOR_TEXT_SEPARATOR', ':') : '';
    const por = el.querySelector('.cpor');
    if (por) por.style.display = 'none';
  }
  // the shot of the moment
  camera() {
    const G = this.G, P = this.P, t = this.t, cam = G.camera;
    let cut = null;
    for (const c of P.cuts) if (c[0] <= t) cut = c;
    const C = cut && P.cams[cut[2]];
    if (!C) { G.rtscam.update(0); return; }
    const eye = C.pk && C.pk.length ? trackValue(C.pk, t, (i) => C.pk[i].slice(1, 4), 4, true) : C.eye;
    const f = C.rk && C.rk.length ? viewDir(C.rk, t) : fwdOf(C.q);
    const fov = C.fk && C.fk.length ? trackValue(C.fk, t, (i) => [C.fk[i][1]], 2, false)[0] : C.fov;
    // the view camera: eye, target 10 m ahead, the world's up (map space x east, y south, z up)
    const E = eye.slice(), T = [0, 1, 2].map((j) => eye[j] + 10 * f[j]);
    // camera shakes (ItemCamFX 0x508660): per axis of the mask (side, world up, view) an offset of amplitude (metres,
    // fading out linearly with flag 1) x sin(time x frequency (rad/s)) moves eye and target; mode != 0 does nothing
    for (const it of P.items) {
      if (it.k !== 'shake' || it.mode || t < it.t || t >= it.t + it.len) continue;
      const tl = t - it.t, u = tl / it.len;
      for (let k = 0; k < 3; k++) {
        const sh = it.shake[k];
        if (!((it.axes >> k) & 1) || !sh) continue;
        const v = sh[0] * (sh[2] ? 1 - u : 1) * Math.sin(tl * sh[1]);
        const D = [T[0] - E[0], T[1] - E[1], T[2] - E[2]];
        const ax = norm3(k === 0 ? [D[1], -D[0], 0] : k === 1 ? [0, 0, 1] : D);
        for (let j = 0; j < 3; j++) { E[j] += v * ax[j]; T[j] += v * ax[j]; }
      }
    }
    const [x, z] = this.C.toGame(E[0], E[1]), [tx, tz] = this.C.toGame(T[0], T[1]);
    cam.position.set(x, E[2], z);
    cam.up.set(0, 1, 0);
    cam.lookAt(tx, T[2], tz);
    if (Math.abs(cam.fov - fov * 180 / Math.PI) > 1e-3) { cam.fov = fov * 180 / Math.PI; cam.updateProjectionMatrix(); }
    // (the world's sound listener and the shadows follow the shot)
    if (G.rtscam && G.rtscam.target) { const [gx, gz] = this.C.toGame(E[0] + f[0] * 30, E[1] + f[1] * 30); G.rtscam.target.set(gx, E[2], gz); }
  }
  // day time items (ItemDayTime 0x50a8d0 / 0x50a930): from its start the clock shows the item's time of day, held
  // for its length and running on from there (144 game seconds per second); weather type 0 switches rain and snow
  // off, 1 snow, 2 rain at intensity / 100 (every shipped item has type 0). The world stands still meanwhile, so the scene's clock is put on top of
  // the world's and taken off again at the end (the server's clock is the one that counts afterwards).
  dayItems(t) {
    const W = this.G.world;
    let it = null;
    for (const x of this.P.items) if (x.k === 'daytime' && x.t <= t && x.tod != null && (!it || x.t >= it.t)) it = x;
    if (!it) return;
    if (!this.daySave) this.daySave = { start: W.dayStart };
    const tod = it.tod + Math.max(0, t - (it.t + it.len)) * 144;
    W.dayStart = tod - W.time * 144;
    this.G.seqWeather = it.weather ? { type: it.weather, intensity: it.intensity / 100, wind: 0, strength: 0 } : null;
  }
  stop() {
    const G = this.G;
    if (this.daySave) { G.world.dayStart = this.daySave.start; this.daySave = null; }
    G.seqWeather = undefined;
    this.done = true;
    G.seqCam = null;
    const cam = G.camera;
    if (this.camSave) { cam.fov = this.camSave.fov; cam.up.copy(this.camSave.up); cam.updateProjectionMatrix(); }
    if (this.fadeEl) { this.fadeEl.remove(); this.fadeEl = null; }
    for (const s of this.sounds) if (s[0]) { try { s[0].stop(); } catch (e) { /* over */ } }
    this.sounds = [];
    for (const o of this.hiddenObjs) o.visible = true;
    for (const A of this.actors.list) {
      if (A.tobj) { A.tobj.removeFromParent(); if (A.tanim) A.tanim.dispose(); A.tobj = null; }
      if (A.e && A.e.alive && A.e.kind === 'unit') { A.e.busyAnim = false; if (A.e.anim && A.e.idleAnim) A.e.anim.play(A.e.idleAnim); }
    }
    if (G.rtscam && G.rtscam.update) G.rtscam.update(0);
  }
}
const G_settings = (G) => G.settings || {};
