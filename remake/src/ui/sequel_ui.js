// The sequel campaign's interface (docs/SEQUEL.md): the briefing, the objectives, the radio box with the speaker's
// portrait (a card of the game's portraits), the command powers and the mission markers on the minimap. G.sequelUI;
// game/sequel/runtime.js is the model it shows.
import * as THREE from 'three';
import { CAST } from '../game/sequel/cast.js';
import { POWERS, RIFT_RANGE } from '../game/sequel/runtime.js';
import { attachHeight } from '../game/sequel/power.js';
import { SEQUEL_CLASSES, tagsOf } from '../game/sequel/rules.js';
import { spriteCss } from './atlas.js';

const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
const esc = (t) => String(t == null ? '' : t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
// the warp gate's vortex emitters (aje_warpgate.glb: the swirl, its sparks and the ground fog)
const VORTEX = /^particles_(particle0\d|bodennebel)/i;
// rotors turning on buildings: the rotor model, its hub in the building model's frame (glTF: y up, front -z), turns/s
const ROTORS = {
  sq_windmill: { model: 'sq_windmill_rotor', at: [0, 13.05, -1.45], axis: 'z', speed: 3.5 },
  sq_watermill: { model: 'sq_waterwheel', at: [0, 2.2, 4.0], axis: 'x', speed: -0.8 },
};
// the searchlight (art/sequel/works.py searchlight, searchlamp): the lamp's pivot height, its tilt below the horizon,
// how far out the beam meets the ground, the lit spot's radius, the glow around the tower (the 26 m it dazzles in:
// game/sequel/runtime.js nightTick) and how fast the beam sweeps (rad/s)
const LAMP = { y: 9.2, tilt: 0.5, reach: 17, spot: 6, area: 28, sweep: 0.5 };
let softTex = null;
// a soft round light (white in the middle, nothing at the rim): lit spots, lamp glows
function soft() {
  if (softTex || typeof document === 'undefined') return softTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  softTex = new THREE.CanvasTexture(c); softTex.colorSpace = THREE.SRGBColorSpace;
  return softTex;
}
const lightMat = (color, map = soft()) => new THREE.MeshBasicMaterial({ map, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false });
// a disc of light laid on the ground (its vertices follow the terrain: drape)
function groundLight(color, n = 12) {
  const g = new THREE.PlaneGeometry(2, 2, n, n); g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, lightMat(color)); m.renderOrder = 4; m.frustumCulled = false;
  m.userData.base = g.attributes.position.array.slice();
  return m;
}
function drape(m, W, x, z, r, lift = 0.25) {
  const a = m.geometry.attributes.position, b = m.userData.base;
  for (let i = 0; i < a.count; i++) { const px = x + b[i * 3] * r, pz = z + b[i * 3 + 2] * r; a.setXYZ(i, px, W.height(px, pz) + lift, pz); }
  a.needsUpdate = true;
}
// a ring on the ground (the reach of a rift's stabilizer while one is being placed)
function groundRing(W, x, z, r, color) {
  const pts = [];
  for (let i = 0; i <= 72; i++) { const a = i / 72 * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; pts.push(new THREE.Vector3(px, W.height(px, pz) + 0.5, pz)); }
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, fog: false }));
}
const clock = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

export class SequelUI {
  constructor(G, M) {
    this.G = G; this.M = M;
    this.line = null; this.lineT = 0;
    this.objKey = ''; this.powKey = ''; this.pwKey = ''; this.wireKey = '';
    if (typeof document === 'undefined' || !G.hud || !G.hud.root) return;
    const root = G.hud.root, col = G.hud.rcol || root;
    // the objectives and the command powers in the HUD's right column (under the menu buttons, down to the minimap:
    // the army pyramid has the left side)
    this.obj = el('div', 'sqobj', col);
    this.radio = el('div', 'sqradio hidden', root);
    this.radio.innerHTML = '<i class="rpor"></i><div><b></b><span></span></div>';
    this.radio.onclick = () => { this.lineT = 0; };
    this.pow = el('div', 'sqpow', col);
    this.pw = el('div', 'pw', this.pow);      // electricity (game/sequel/power.js), at the top of the powers column
    this.timer = el('div', 'sqtimer hidden', root);
  }
  // the briefing before the mission starts (the game waits)
  briefing() {
    const G = this.G, M = this.M, d = M.def;
    if (M.started) return;
    if (typeof document === 'undefined' || new URLSearchParams(location.search).has('manual')) { M.started = true; return; }
    G.setPaused(true);
    const news = (d.unlocks || []).map((u) => (SEQUEL_CLASSES[Array.isArray(u) ? u[0] : u] || {}).desc).filter(Boolean).join(', ');   // (missions.js unlocks)
    const box = el('div', 'sqbrief', document.body);
    box.innerHTML = `<div class="in"><small>ParaWorld: Containment · Mission ${d.id} of 10</small><h2>${esc(d.title)}</h2>
      <p class="where">${esc(d.place)} — ${esc(d.date)}</p>${d.briefing.map((p) => `<p>${esc(p)}</p>`).join('')}${news ? `<p class="where">New: ${esc(news)}</p>` : ''}
      <button class="pwbtn">Begin</button></div>`;
    box.querySelector('button').onclick = () => { box.remove(); M.started = true; G.setPaused(false); };
  }
  update(dt) {
    const M = this.M;
    if (!this.obj) return;
    this.effects(dt);
    // radio
    this.lineT -= dt;
    if (this.lineT <= 0) {
      const next = M.lines.shift();
      if (next) {
        const c = CAST[next.who] || CAST.radio;
        this.line = next;
        this.lineT = 3 + next.text.split(/\s+/).length * 0.33;
        M.said.push({ who: next.who, text: next.text, t: Math.round(M.time) });
        this.radio.classList.remove('hidden');
        this.radio.style.borderColor = c.color;
        // the speaker's card from the game's portraits (game/sequel/cast.js), else a framed initial
        const por = this.radio.querySelector('.rpor'), css = spriteCss(c.card, 4, 76, 72);
        por.style.cssText = css || '';
        por.textContent = css ? '' : c.name.replace(/^\w+\.\s*/, '')[0];
        this.radio.querySelector('b').textContent = c.name;
        this.radio.querySelector('b').style.color = c.color;
        this.radio.querySelector('span').textContent = next.text;
        if (this.G.audio && this.G.audio.play) try { this.G.audio.play('UI_click'); } catch (e) { /* no sound */ }
      } else if (this.line) { this.line = null; this.radio.classList.add('hidden'); }
    }
    // objectives
    const sealing = M.rifts.filter((r) => r.open && r.seal > 0).map((r) => Math.floor(100 * r.seal / r.sealTime));
    const key = M.objectives.map((o) => `${o.id}${o.done}${o.failed}${o.count}/${o.of}${o.note || ''}`).join('|') + M.cp + '#' + sealing.join(',');
    if (key !== this.objKey) {
      this.objKey = key;
      this.obj.innerHTML = `<h4>Objectives</h4>` + M.objectives.map((o) => `<div class="${o.done ? 'done' : o.failed ? 'failed' : ''} ${o.secondary ? 'sec' : ''}">` +
        `<i>${o.done ? '✔' : o.failed ? '✘' : '•'}</i>${esc(o.text)}${o.of ? ` <em>${o.count}/${o.of}</em>` : ''}` +
        `${o.note && !o.done && !o.failed ? `<small>${esc(o.note)}</small>` : ''}</div>`).join('') +
        // a rift being sealed: how far (it falls back while no stabilizer stands by it)
        sealing.map((p) => `<div class="seal"><i>⟳</i>Sealing the rift <em>${p}%</em><b style="width:${p}%"></b></div>`).join('');
    }
    // a mission clock (missions with a countdown keep it in state.dawn / launch / full)
    const end = M.state.dawn || M.state.launch || M.state.full || M.state.extract;
    if (end && !M.ended && M.time < end) { this.timer.classList.remove('hidden'); this.timer.textContent = clock(end - M.time); } else this.timer.classList.add('hidden');
    // electricity: the stock, what the connected plants make, plants cut off from the grid
    const R = M.grid.rates(), stock = Math.floor(this.G.me.res.power || 0);
    const pk2 = `${stock}|${R.on}|${R.cut}|${R.plants}`;
    if (pk2 !== this.pwKey) {
      this.pwKey = pk2;
      this.pw.title = 'Electricity: made by plants (workers in generating stations, generators and water wheels; windmills by themselves) and carried to your headquarters by power poles, at most 40 m apart. Spent on electric units and structures.';
      this.pw.innerHTML = `<span class="pwicon"></span> ${stock}<small>${R.plants ? `+${R.on}/min` : 'no plants'}</small>${R.cut ? `<small class="cut">${R.cut} plant${R.cut > 1 ? 's' : ''} cut off</small>` : ''}`;
    }
    // command powers
    const ids = Object.keys(POWERS).filter((id) => M.powerState(id) !== 'off');
    const pk = ids.map((id) => id + M.powerState(id) + Math.ceil(Math.max(0, (M.powerReady[id] || 0) - M.time))).join('|') + '#' + M.cp;
    if (pk !== this.powKey) {
      this.powKey = pk;
      this.pow.innerHTML = `<div class="cp" title="Command points: earned by objectives, sealed rifts and captures">${M.cp}<small>CP</small></div>` +
        ids.map((id) => { const P = POWERS[id], st = M.powerState(id), cd = Math.ceil(Math.max(0, (M.powerReady[id] || 0) - M.time));
          return `<button class="sqp ${st}" data-p="${id}" title="${esc(P.name)} (${P.cost} CP): ${esc(P.text)}"><b>${esc(P.name)}</b><small>${st === 'cooldown' ? cd + ' s' : P.cost + ' CP'}</small></button>`; }).join('');
      this.pow.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => this.power(b.dataset.p); });
      this.pow.prepend(this.pw);
    }
  }
  // what only the eye sees: the rifts pulse, searchlight beams sweep at night
  effects(dt) {
    const G = this.G, M = this.M, W = G.world, t = performance.now() / 1000;
    for (const b of W.buildings) {
      if (!b.alive || !b.obj) continue;
      if (b.name === 'sq_rift') this.rift(b, t, dt);
      if (b.name === 'sq_searchlight') this.searchlight(b, t);
    }
    // the lights of searchlights that are gone
    for (const [id, L] of this.lights || []) if (!L.b.alive) { for (const o of L.world) { G.scene.remove(o); o.geometry.dispose(); } this.lights.delete(id); }
    this.placeRings();
    for (const u of W.units) if (u.sqScale && u.obj && u.obj.scale.x !== u.sqScale) u.obj.scale.setScalar(u.sqScale);
    this.wires();
    this.arcs(dt);
    // the windmills' rotors and the water wheels turn (separate models on the building: art/sequel/works.py)
    for (const b of W.buildings) {
      const R = ROTORS[b.name];
      if (!R || !b.alive || !b.obj || !b.built) continue;
      let r = b.obj.userData.sqRotor;
      if (!r && W.template(R.model, true)) {
        r = W.cloneModel(W.template(R.model, true));
        r.position.set(R.at[0], R.at[1], R.at[2]);
        b.obj.add(r); b.obj.userData.sqRotor = r; b.obj.userData.live = true;     // (main.js freezeStill: not frozen)
      }
      if (r) r.rotation[R.axis] += dt * R.speed;
    }
    // mission 5: the rocket on its pad, and its flight after the count reaches zero
    const pad = M.state.pad;
    if (pad && pad.alive && pad.obj) {
      let r = this.rocket;
      if (!r && W.template('sq_rocket_body', true)) {
        r = this.rocket = W.cloneModel(W.template('sq_rocket_body', true));
        r.position.copy(pad.origin);
        r.position.y = W.height(pad.origin.x, pad.origin.z) + 5.0;      // on the launch table (art/sequel/works.py TABLE_TOP)
        G.scene.add(r); this.rocketY = r.position.y;
      }
      if (r && M.state.won) {
        this.flight = (this.flight || 0) + dt;
        r.position.y = this.rocketY + 2 * this.flight * this.flight;
        if (G.fx && Math.random() < 0.6) G.fx.dust(r.position.clone(), 4);
      }
    }
  }
  // the power lines: a sagging wire between each pole and the one it hangs on (Grid.links), rebuilt when they change
  wires() {
    const G = this.G, links = this.M.grid.links;
    const key = links.map(([a, b]) => a.id + '-' + b.id).join(',');
    if (key === this.wireKey) return;
    this.wireKey = key;
    if (this.wireObj) { G.scene.remove(this.wireObj); this.wireObj.geometry.dispose(); }
    const pts = [];
    const top = (e) => new THREE.Vector3(e.pos.x, G.world.height(e.pos.x, e.pos.z) + attachHeight(e), e.pos.z);
    for (const [a, b] of links) {
      const p = top(a), q = top(b), n = 10, sag = Math.min(2.5, p.distanceTo(q) * 0.05);
      for (const side of [-0.6, 0.6]) {
        let prev = null;
        for (let i = 0; i <= n; i++) {
          const t = i / n, v = p.clone().lerp(q, t);
          v.y -= sag * 4 * t * (1 - t);
          const dx = q.z - p.z, dz = p.x - q.x, l = Math.hypot(dx, dz) || 1;
          v.x += dx / l * side; v.z += dz / l * side;
          if (prev) pts.push(prev, v);
          prev = v;
        }
      }
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    this.wireObj = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x1a1a18 }));
    G.scene.add(this.wireObj);
  }
  // a rift pulses; while a stabilizer seals it, lightning runs from the stabilizer into it and it shrinks
  rift(b, t, dt) {
    const M = this.M, W = this.G.world, r = M.rifts.find((x) => x.e === b);
    // the vortex of the warp gate the SEAS come out of in the campaign (single_04's aje_warpgate): that model's
    // swirl, ground fog and sparks (its emitters Particle01..03, bodennebel03) without the building and its damage fires
    if (!b.obj.userData.sqVortex && W.template('aje_warpgate', true)) {
      const v = W.cloneModel(W.template('aje_warpgate', true));
      v.traverse((o) => { if (o !== v && (o.isMesh || (o.userData.kind === 'particles' && !VORTEX.test(o.name)))) o.visible = false; });
      b.obj.add(v); b.obj.userData.sqVortex = v; b.obj.userData.live = true;
    }
    b.model.traverse((o) => { if (o.isMesh && o.material && o.material.emissiveIntensity !== undefined && o.material.emissive && o.material.emissive.r > 0.3) o.material.emissiveIntensity = 1 + 0.6 * Math.sin(t * 3); });
    if (!r) return;
    const base = b.obj.userData.sqScale ?? (b.obj.userData.sqScale = b.obj.scale.x);
    b.obj.scale.setScalar(base * (1 - 0.45 * Math.min(1, r.seal / r.sealTime)));
    const st = r.stab;
    if (!st || !st.alive || !st.obj) return;
    if ((st.sqArcT = (st.sqArcT || 0) - dt) > 0) return;
    st.sqArcT = 0.12;
    if (st.sqTop === undefined) { const bb = new THREE.Box3().setFromObject(st.obj); st.sqTop = bb.isEmpty() ? 6 : bb.max.y - st.obj.position.y; }
    (M.arcs || (M.arcs = [])).push({ a: [st.pos.x, W.height(st.pos.x, st.pos.z) + st.sqTop * 0.9, st.pos.z], b: [r.x, W.height(r.x, r.z) + 4, r.z], t: 0.18 });
  }
  // a searchlight at night: the lamp turns, its beam reaches down to a lit spot sweeping around the tower, and the
  // ground it dazzles in glows (the gameplay: game/sequel/runtime.js nightTick, viewers)
  searchlight(b, t) {
    const G = this.G, M = this.M, W = G.world;
    if (!b.obj) return;
    const lights = this.lights || (this.lights = new Map());
    let L = lights.get(b.id);
    if (!L) {
      L = { b, world: [] };
      lights.set(b.id, L);
      if (W.template('sq_searchlamp', true)) { L.lamp = W.cloneModel(W.template('sq_searchlamp', true)); L.lamp.position.set(0, LAMP.y, 0); b.obj.add(L.lamp); b.obj.userData.live = true; }
      const g = new THREE.ConeGeometry(1, 1, 20, 1, true);
      g.translate(0, -0.5, 0); g.rotateX(-Math.PI / 2);            // the apex at the lamp, the open end 1 m along +z
      const p = g.attributes.position, col = [];
      for (let i = 0; i < p.count; i++) { const k = 0.3 * (1 - p.getZ(i)) + 0.05; col.push(k, k, k); }
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      L.beam = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xfff0c8, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false }));
      L.beam.renderOrder = 5; L.beam.frustumCulled = false;
      L.spot = groundLight(0x84765a);
      L.area = groundLight(0x3a3426, 16);
      drape(L.area, W, b.pos.x, b.pos.z, LAMP.area);
      L.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft(), color: 0xfff4d0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      L.glow.scale.setScalar(5);
      L.world.push(L.beam, L.spot, L.area, L.glow);
      for (const o of L.world) G.scene.add(o);
    }
    const on = M.nightOn && b.built;
    for (const o of L.world) o.visible = on;
    if (!on) return;
    const yaw = t * LAMP.sweep + b.id;                                 // the beam's heading (the lamp's front is -z)
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (L.lamp) L.lamp.rotation.y = yaw - b.obj.rotation.y;
    const gy = W.height(b.pos.x, b.pos.z);
    const lamp = new THREE.Vector3(b.pos.x + fx * 0.6, gy + LAMP.y - 0.3, b.pos.z + fz * 0.6);
    const sx = b.pos.x + fx * LAMP.reach, sz = b.pos.z + fz * LAMP.reach, spot = new THREE.Vector3(sx, W.height(sx, sz), sz);
    L.beam.position.copy(lamp);
    L.beam.lookAt(spot);
    L.beam.scale.set(LAMP.spot * 0.8, LAMP.spot * 0.8, lamp.distanceTo(spot));
    drape(L.spot, W, sx, sz, LAMP.spot * (1 + 0.04 * Math.sin(t * 7)));
    L.glow.position.copy(lamp);
  }
  // while a Rift Stabilizer is being placed: the reach of every open rift (green where the ghost is within it)
  placeRings() {
    const G = this.G, M = this.M, inp = G.input, gh = inp && inp.mode === 'place' && inp.ghost;
    const want = gh && tagsOf(gh.name).includes('stabilizer') ? M.rifts.filter((r) => r.open) : [];
    const inside = (r) => Math.hypot(gh.x - r.x, gh.z - r.z) < RIFT_RANGE;
    const key = want.map((r) => r.id + inside(r)).join('|');
    if (key === this.ringKey) return;
    this.ringKey = key;
    for (const o of this.rings || []) { G.scene.remove(o); o.geometry.dispose(); }
    this.rings = want.map((r) => groundRing(G.world, r.x, r.z, RIFT_RANGE - 2, inside(r) ? 0x60ff60 : 0x60e0ff));
    for (const o of this.rings) G.scene.add(o);
  }
  // lightning: jagged blue lines of the electric weapons (Sequel.electric), each lives a moment
  arcs(dt) {
    const G = this.G, M = this.M;
    const list = (M.arcs || []).filter((a) => (a.t -= dt) > 0);
    M.arcs = list;
    if (this.arcObj) { G.scene.remove(this.arcObj); this.arcObj.geometry.dispose(); this.arcObj = null; }
    if (!list.length) return;
    const pts = [];
    for (const a of list) {
      const p = new THREE.Vector3(...a.a), q = new THREE.Vector3(...a.b), n = 8;
      let prev = p;
      for (let i = 1; i <= n; i++) {
        const v = p.clone().lerp(q, i / n);
        if (i < n) v.add(new THREE.Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2));
        pts.push(prev, v); prev = v;
      }
    }
    this.arcObj = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xa8e0ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    G.scene.add(this.arcObj);
  }
  power(id) {
    const G = this.G, M = this.M, P = POWERS[id];
    if (M.powerState(id) !== 'ready') { G.hud.message(M.powerState(id) === 'cost' ? `Not enough command points (${P.cost} needed)` : 'Not ready yet', 'bad'); return; }
    if (!P.target) { M.usePower(id); return; }
    G.hud.message(`${P.name}: click the place`);
    G.input.setMode('callback', { onPoint: (x, z) => M.usePower(id, x, z) });
  }
  drawMinimap(ctx, mm) {
    const t = performance.now() / 1000;
    for (const m of this.M.markers) {
      const [x, y] = mm.w2m(m.x, m.z);
      ctx.strokeStyle = hex(m.color); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 4 + 2 * Math.sin(t * 4), 0, Math.PI * 2); ctx.stroke();
    }
  }
}
