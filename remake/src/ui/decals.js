import * as THREE from 'three';
import { buffsOf } from '../game/buffs.js';

// The decals on the ground under units (PWClient.exe 0x481900: the object decal list, drawn by 0x6b6e70 / 0x6b71b0):
//   - heroes (the classes starting Stina_, special_eusmilus_, Bela_, Cole_, babbage_, hermit_, tesla_, lovelace_,
//     mayor_, darwin_, schliemann_, livingstone_) stand on a ring in their player's colour: the lower left quarter of
//     Effects/Selection.tga (assets/ui/heroring.png), 3 m around the unit
//   - a unit with buffs (FightingObj "BuffDecals") shows the decal of the first of them in the order of
//     buffdecals.txt - if the viewer may see that one (its own units: all; else by the buff's visibility 1 all,
//     2 enemies, 3 allies): its tile of Effects/UnitDecals.tga (4 x 4 tiles; assets/ui/unitdecals.png), 3 m around
//     the unit. Buffs without a tile (poisoned, invisible, held ...) are skipped when the client loads the table
//     (0x484abf): they never get a decal and never hide another one.
// Only characters, animals and vehicles have them; each is a 3 x 3 vertex grid laid on the ground 0.2 m above it.
// (The client also gives a 1.4 m ring to units with a list at object +0x29c whose meaning is unknown: not done.)
const HERO = /^(stina_|special_eusmilus_|bela_|cole_|babbage_|hermit_|tesla_|lovelace_|mayor_|darwin_|schliemann_|livingstone_)/i;
const CLS = /^(CHTR|ANML|VHCL)$/;
const SIZE = 3, LIFT = 0.2;

function grid() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(27), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(18), 2));
  const idx = [];
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { const a = j * 3 + i; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4); }
  g.setIndex(idx);
  return g;
}

export class UnitDecals {
  constructor(G) {
    this.G = G;
    this.pool = { hero: [], buff: [] };
    this.used = { hero: 0, buff: 0 };
    this.cache = new Map();          // unit -> {t, tile}
    const tl = new THREE.TextureLoader();
    this.missing = {};
    const mat = (file, kind) => {
      const tex = tl.load('assets/ui/' + file, undefined, undefined, () => { this.missing[kind] = true; });
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };
    this.tex = { hero: mat('heroring.png', 'hero'), buff: mat('unitdecals.png', 'buff') };
  }
  mesh(kind) {
    const list = this.pool[kind];
    let m = list[this.used[kind]];
    if (!m) {
      m = new THREE.Mesh(grid(), new THREE.MeshBasicMaterial({ map: this.tex[kind], transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4 }));
      m.renderOrder = 5;
      m.frustumCulled = false;
      this.G.scene.add(m);
      list.push(m);
    }
    this.used[kind]++;
    m.visible = true;
    return m;
  }
  // lays the grid around (x, z); uv rectangle [u0, v0, u1, v1] (three.js: v up)
  lay(m, x, z, r, uv) {
    const H = this.G.world.height, pos = m.geometry.attributes.position, tc = m.geometry.attributes.uv;
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      const k = j * 3 + i, px = x + (i - 1) * r, pz = z + (j - 1) * r;
      pos.setXYZ(k, px, H(px, pz) + LIFT, pz);
      tc.setXY(k, uv[0] + (uv[2] - uv[0]) * i / 2, uv[3] + (uv[1] - uv[3]) * j / 2);
    }
    pos.needsUpdate = true; tc.needsUpdate = true;
  }
  // the tile of the buff decal a viewer sees on e (null: none, -1: the white ring); worked out four times a second
  buffTile(e) {
    const G = this.G, W = G.world;
    let c = this.cache.get(e);
    if (c && W.time - c.t < 0.25 && c.t <= W.time) return c.tile;
    const table = W.data.extra.buffs || [];
    const have = new Set(buffsOf(W, e));
    let tile = null;
    if (have.size) {
      const own = e.owner === G.me, rel = e.owner && !own ? G.me.relation(e.owner) : -1;
      const b = table.find((x) => x.tile >= 0 && have.has(x.attrib));      // (only buffs with a tile compete: 0x484abf)
      if (b && (own || b.vis === 1 || (b.vis === 2 && rel === 0) || (b.vis === 3 && rel === 2))) tile = b.tile;
    }
    this.cache.set(e, c = { t: W.time, tile });
    return tile;
  }
  update(visible) {
    const G = this.G, W = G.world;
    this.used.hero = 0; this.used.buff = 0;
    {
      for (const e of W.units) {
        if (!e.alive || e.inside || !CLS.test(e.cls) || !visible(e)) continue;
        if (HERO.test(e.name) && e.owner && !this.missing.hero) {
          const m = this.mesh('hero');
          m.material.color.setHex(e.owner.color);
          this.lay(m, e.pos.x, e.pos.z, SIZE, [0.02, 0.02, 0.98, 0.98]);
        }
        const tile = this.buffTile(e);
        if (tile != null && tile >= 0 && !this.missing.buff) {
          const u = (tile % 4) * 0.25, v = 1 - (Math.floor(tile / 4) + 1) * 0.25;
          this.lay(this.mesh('buff'), e.pos.x, e.pos.z, SIZE, [u, v, u + 0.25, v + 0.25]);
        }
      }
    }
    for (const k of ['hero', 'buff']) for (let i = this.used[k]; i < this.pool[k].length; i++) this.pool[k][i].visible = false;
    if (this.cache.size > 2 * W.units.length + 64) for (const e of this.cache.keys()) if (!e.alive) this.cache.delete(e);
  }
}
