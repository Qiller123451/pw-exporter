import * as THREE from 'three';

// ---------------------------------------------------------------- noise helpers
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
export function fbm(x, z, seed, oct = 4) {
  let s = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f, z * f, seed + i * 17); n += amp; amp *= 0.5; f *= 2.03; }
  return s / n;
}
export function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

// ---------------------------------------------------------------- height field
// A sampled height grid (fast lookups) built from an analytic function once.
export class HeightField {
  constructor(size, cell, fn) {
    this.size = size; this.cell = cell;
    this.n = Math.round(size / cell) + 1;
    this.h = new Float32Array(this.n * this.n);
    const half = size / 2;
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) this.h[j * this.n + i] = fn(i * cell - half, j * cell - half);
  }
  at(x, z) {
    const half = this.size / 2, n = this.n;
    let fx = (x + half) / this.cell, fz = (z + half) / this.cell;
    fx = Math.max(0, Math.min(n - 1.001, fx)); fz = Math.max(0, Math.min(n - 1.001, fz));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const a = this.h[j * n + i], b = this.h[j * n + i + 1], c = this.h[(j + 1) * n + i], d = this.h[(j + 1) * n + i + 1];
    // match the triangle split of PlaneGeometry (diagonal from (i,j+1) to (i+1,j))
    if (u + v <= 1) return a + (b - a) * u + (c - a) * v;
    return d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }
  // y component of the ground normal (1 = flat, 0 = vertical), from the slope over one cell
  normalY(x, z) {
    const e = this.cell;
    const dx = (this.at(x + e, z) - this.at(x - e, z)) / (2 * e), dz = (this.at(x, z + e) - this.at(x, z - e)) / (2 * e);
    return 1 / Math.sqrt(1 + dx * dx + dz * dz);
  }
}

// ---------------------------------------------------------------- fog of war shading hook
export const fowUniforms = {
  fowTex: { value: null },
  fowScale: { value: new THREE.Vector4(0, 0, 1, 1) },   // x0, z0, 1/size, 1/size
  fowOn: { value: 1 },
};

// patch a built-in material so it darkens unexplored/fogged areas (uses world position)
export function applyFow(material) {
  if (material.userData.fow) return material;
  material.userData.fow = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, fowUniforms);
    sh.vertexShader = 'varying vec2 vFowUv;\nuniform vec4 fowScale;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      {
        vec4 fw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fw = instanceMatrix * fw;
        #endif
        fw = modelMatrix * fw;
        vFowUv = (fw.xz - fowScale.xy) * fowScale.zw;
      }`);
    sh.fragmentShader = 'varying vec2 vFowUv;\nuniform sampler2D fowTex;\nuniform float fowOn;\n' + sh.fragmentShader.replace('#include <fog_fragment>', `
      if (fowOn > 0.5) {
        float fv = texture2D(fowTex, vFowUv).r;
        gl_FragColor.rgb *= mix(0.0, 1.0, smoothstep(0.0, 0.45, fv)) * mix(0.55, 1.0, smoothstep(0.45, 0.9, fv));
      }
      #include <fog_fragment>`);
  };
  const key = material.customProgramCacheKey ? material.customProgramCacheKey() : '';
  material.customProgramCacheKey = () => key + '|fow';
  material.needsUpdate = true;
  return material;
}

// ---------------------------------------------------------------- terrain mesh with 4- or 8-way splatting
// weightsFn(x, z) returns one weight per texture (4 for the random map, 8 for the original maps' ground materials).
export async function buildTerrain(hf, weightsFn, textures, opts = {}) {
  const size = hf.size, seg = hf.n - 1;
  const N = textures.length > 4 ? 8 : 4;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const w0 = new Float32Array(pos.count * 4), w1 = N > 4 ? new Float32Array(pos.count * 4) : null;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, hf.at(x, z));
    const ws = weightsFn(x, z);
    w0[i * 4] = ws[0]; w0[i * 4 + 1] = ws[1]; w0[i * 4 + 2] = ws[2]; w0[i * 4 + 3] = ws[3];
    if (w1) { w1[i * 4] = ws[4]; w1[i * 4 + 1] = ws[5]; w1[i * 4 + 2] = ws[6]; w1[i * 4 + 3] = ws[7]; }
  }
  geo.setAttribute('splat', new THREE.BufferAttribute(w0, 4));
  if (w1) geo.setAttribute('splat2', new THREE.BufferAttribute(w1, 4));
  geo.computeVertexNormals();
  for (const t of textures) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const scales = opts.scales || [[1 / 14, 1 / 3.8], [1 / 14, 1 / 3.8], [1 / 12, 1 / 4.3], [1 / 12, 1 / 2.0]];
  while (scales.length < N) scales.push(scales[scales.length - 1]);
  mat.onBeforeCompile = (sh) => {
    for (let k = 0; k < N; k++) sh.uniforms['t' + k] = { value: textures[k] };
    sh.uniforms.sc = { value: scales.slice(0, N).map((s) => new THREE.Vector2(s[0], s[1])) };
    const decl = `uniform sampler2D ${[...Array(N).keys()].map((k) => 't' + k).join(', ')};\nuniform vec2 sc[${N}];\nvarying vec4 vSplat;\n` +
      (N > 4 ? 'varying vec4 vSplat2;\n' : '') + 'varying vec3 vWpos;\nvarying vec3 vWn;\n' + `
      // value noise for breaking up the texture repetition
      float pwHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float pwNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(pwHash(i), pwHash(i + vec2(1.0, 0.0)), f.x), mix(pwHash(i + vec2(0.0, 1.0)), pwHash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      // one ground material: two scales (the second rotated) mixed by noise -> no visible tile grid
      vec3 pwSample(sampler2D t, vec2 uv, float n) {
        vec3 a = texture2D(t, uv).rgb;
        vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * uv * 0.43 + 0.37;
        return mix(a, texture2D(t, uv2).rgb, n * 0.55);
      }
      // the texture's average brightness (a very blurred mip) - detail = brightness above/below it
      float pwMean(sampler2D t, vec2 uv) { return dot(texture2D(t, uv, 9.0).rgb, vec3(0.333)); }
      // steep slopes: project from the side (x/z facing) instead of from above, so cliffs don't smear
      vec3 pwTex(sampler2D t, vec2 s, float n, vec3 wp, vec3 nw, float steep) {
        vec3 top = pwSample(t, wp.xz * s, n);
        if (steep < 0.02) return top;
        vec3 side = abs(nw.x) > abs(nw.z) ? pwSample(t, wp.zy * s, n) : pwSample(t, wp.xy * s, n);
        return mix(top, side, steep);
      }
`;
    sh.vertexShader = 'attribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec3 vWpos;\nvarying vec3 vWn;\n' + (N > 4 ? 'attribute vec4 splat2;\nvarying vec4 vSplat2;\n' : '') +
      sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;\n' + (N > 4 ? 'vSplat2 = splat2;\n' : '') +
        'vWpos = (modelMatrix * vec4(position,1.0)).xyz; vWn = normalize(mat3(modelMatrix) * normal);');
    // every material: colour, weighted by splat weight x its own detail (brightness relative to the texture's
    // average), squared - transitions follow the textures' structure (stones, tufts) instead of a soft blur, and a
    // bright material doesn't win over a dark one just for being bright
    const lines = [];
    for (let k = 0; k < N; k++) {
      const w = k < 4 ? 's.' + 'xyzw'[k] : 's2.' + 'xyzw'[k - 4];
      lines.push(`if (${w} > 0.004) { vec3 c${k} = pwTex(t${k}, sc[${k}], nz, vWpos, nw, steep); float h${k} = ${w} * clamp(0.55 + 1.6 * (dot(c${k}, vec3(0.333)) - pwMean(t${k}, vWpos.xz * sc[${k}])), 0.08, 1.0); h${k} *= h${k}; c += c${k} * h${k}; ht += h${k}; }`);
    }
    const body = `vec3 nw = normalize(vWn);
        float steep = smoothstep(0.62, 0.38, nw.y);
        float nz = pwNoise(vWpos.xz * 0.045) * 0.7 + pwNoise(vWpos.xz * 0.011) * 0.3;
        ${N > 4 ? 'float tot = max(0.001, dot(vSplat, vec4(1.0)) + dot(vSplat2, vec4(1.0)));\n        vec4 s = vSplat / tot, s2 = vSplat2 / tot;'
    : 'vec4 s = vSplat / max(0.001, dot(vSplat, vec4(1.0)));'}
        vec3 c = vec3(0.0); float ht = 0.0;
        ${lines.join('\n        ')}
        c /= max(ht, 1e-4);
        c *= 0.9 + 0.2 * pwNoise(vWpos.xz * 0.02);          // large-scale brightness variation`;
    sh.fragmentShader = decl + sh.fragmentShader.replace('#include <map_fragment>', body + '\n        diffuseColor.rgb *= c;');
  };
  mat.customProgramCacheKey = () => 'pw-terrain' + N;
  applyFow(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

// ---------------------------------------------------------------- fog of war grid (per player)
export class FogOfWar {
  constructor(size, cell) {
    this.size = size; this.cell = cell;
    this.n = Math.ceil(size / cell);
    this.vis = new Uint8Array(this.n * this.n);      // currently visible (count of viewers > 0)
    this.explored = new Uint8Array(this.n * this.n);
    this.tex = new THREE.DataTexture(new Uint8Array(this.n * this.n), this.n, this.n, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.LinearFilter; this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    this.discs = new Map();
    const half = size / 2;
    fowUniforms.fowTex.value = this.tex;
    fowUniforms.fowScale.value.set(-half, -half, 1 / size, 1 / size);
    this.revealAll = false;
  }
  disc(r) {
    const k = Math.round(r / this.cell);
    if (this.discs.has(k)) return this.discs.get(k);
    const out = [];
    for (let j = -k; j <= k; j++) {
      const w = Math.floor(Math.sqrt(k * k - j * j));
      out.push([j, -w, w]);
    }
    this.discs.set(k, out);
    return out;
  }
  // viewers: array of [x, z, radius]
  update(viewers) {
    const n = this.n, half = this.size / 2;
    this.vis.fill(0);
    for (const [x, z, r] of viewers) {
      const ci = Math.floor((x + half) / this.cell), cj = Math.floor((z + half) / this.cell);
      for (const [dj, a, b] of this.disc(r)) {
        const j = cj + dj;
        if (j < 0 || j >= n) continue;
        const row = j * n;
        for (let i = Math.max(0, ci + a); i <= Math.min(n - 1, ci + b); i++) { this.vis[row + i] = 1; this.explored[row + i] = 1; }
      }
    }
    const d = this.tex.image.data;
    if (this.revealAll) d.fill(255);
    else for (let i = 0; i < d.length; i++) d[i] = this.vis[i] ? 255 : (this.explored[i] ? 115 : 0);
    this.tex.needsUpdate = true;
  }
  visible(x, z) {
    if (this.revealAll) return true;
    const half = this.size / 2, n = this.n;
    const i = Math.floor((x + half) / this.cell), j = Math.floor((z + half) / this.cell);
    if (i < 0 || j < 0 || i >= n || j >= n) return false;
    return this.vis[j * n + i] === 1;
  }
  explored_(x, z) {
    if (this.revealAll) return true;
    const half = this.size / 2, n = this.n;
    const i = Math.floor((x + half) / this.cell), j = Math.floor((z + half) / this.cell);
    if (i < 0 || j < 0 || i >= n || j >= n) return false;
    return this.explored[j * n + i] === 1;
  }
}
