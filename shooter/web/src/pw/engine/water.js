// Sea / lake surface of the original maps: one large plane at the map's water level.
//   * colour from the water depth (terrain height baked into a small texture): clear and light at the shore,
//     dark further out, foam where the ground meets the surface
//   * moving ripples from the original WaterNormalMap (Texture/Scape/Settings/<setting>/WaterNormalMap.tga)
//   * sun glints (Blinn-Phong on the rippled normal) and a fresnel sky reflection
//   * fog of war like the terrain
import * as THREE from 'three';
import { fowUniforms } from './terrain.js';

// hf: HeightField of the terrain, level: water height (m)
export function buildWater(hf, level, normalMap, opts = {}) {
  const size = hf.size;
  // depth texture: 0 = dry land, 1 = 10 m deep or more
  const n = Math.min(1024, hf.n);
  const data = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i / (n - 1) - 0.5) * size, z = (j / (n - 1) - 0.5) * size;
    data[j * n + i] = Math.max(0, Math.min(255, Math.round((level - hf.at(x, z)) / 10 * 255 + 1)));
  }
  const depthTex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.UnsignedByteType);
  depthTex.magFilter = depthTex.minFilter = THREE.LinearFilter;
  depthTex.needsUpdate = true;
  if (normalMap) { normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping; normalMap.colorSpace = THREE.NoColorSpace; }
  const ext = opts.extent || size * 4;
  const geo = new THREE.PlaneGeometry(ext, ext, 1, 1).rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      ...fowUniforms,
      uTime: { value: 0 }, uDepth: { value: depthTex }, uNormal: { value: normalMap }, uHasNormal: { value: normalMap ? 1 : 0 },
      uSize: { value: size }, uSun: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
      uShallow: { value: new THREE.Color(opts.shallow || 0x3f9a8c) }, uDeep: { value: new THREE.Color(opts.deep || 0x0d3550) },
      uSky: { value: new THREE.Color(opts.sky || 0x9cc4dc) },
    },
    vertexShader: `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform float uTime, uSize, uHasNormal, fowOn;
      uniform sampler2D uDepth, uNormal, fowTex;
      uniform vec3 uSun, uShallow, uDeep, uSky;
      uniform vec4 fowScale;
      varying vec3 vW;
      void main() {
        vec2 uv = vW.xz / uSize + 0.5;
        float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
        float d = mix(1.0, texture2D(uDepth, clamp(uv, 0.0, 1.0)).r, inside);
        if (d < 0.003) discard;                                          // dry land
        vec3 nrm = vec3(0.0, 1.0, 0.0);
        if (uHasNormal > 0.5) {
          vec3 a = texture2D(uNormal, vW.xz * 0.018 + vec2(uTime * 0.011, uTime * 0.007)).rgb * 2.0 - 1.0;
          vec3 b = texture2D(uNormal, vW.xz * 0.031 - vec2(uTime * 0.009, -uTime * 0.012)).rgb * 2.0 - 1.0;
          vec3 t = normalize(a + b);
          nrm = normalize(vec3(t.x, t.z * 2.2, t.y));
        }
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(dot(nrm, V), 0.0), 3.0);
        vec3 H = normalize(uSun + V);
        float spec = pow(max(dot(nrm, H), 0.0), 140.0) * 1.4;
        float deep = smoothstep(0.0, 0.85, d);
        vec3 col = mix(uShallow, uDeep, deep);
        col = mix(col, uSky, fres * 0.55) + vec3(spec);
        float foam = (1.0 - smoothstep(0.004, 0.035, d)) * (0.55 + 0.45 * sin(uTime * 1.3 + vW.x * 0.7 + vW.z * 0.5));
        col = mix(col, vec3(0.92, 0.96, 0.95), foam * 0.6);
        float alpha = mix(0.35, 0.92, smoothstep(0.0, 0.35, d)) + fres * 0.08;
        if (fowOn > 0.5 && inside > 0.5) {
          float fv = texture2D(fowTex, (vW.xz - fowScale.xy) * fowScale.zw).r;
          col *= mix(0.0, 1.0, smoothstep(0.0, 0.45, fv)) * mix(0.55, 1.0, smoothstep(0.45, 0.9, fv));
          alpha = mix(1.0, alpha, smoothstep(0.0, 0.45, fv));
        }
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = level;
  mesh.renderOrder = 2;
  mesh.name = 'water';
  mesh.onBeforeRender = () => { mat.uniforms.uTime.value = performance.now() / 1000; };
  return mesh;
}
