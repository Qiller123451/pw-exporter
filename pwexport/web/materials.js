// Material looks the glTF files cannot carry, set from the GSF material flags the exporter keeps in the material
// extras ("gsf_flags": "attr1/attr2", hex; docs/GSF_FORMAT.md).
import * as THREE from 'three';

const glow = new WeakMap();        // original material -> its additive twin

// Light effects: flag 0x4 = the picture is ADDED to what is behind it (light cones, glowing windows, lava and fire
// glow, weapon trails - 325 models of the game). Their textures are bright shapes on black, so drawn as a normal
// surface they are black sheets. Such a material is not lit and writes no depth; the texture's alpha only counts
// where the flags also ask for alpha (0x1 / 0x2).
export function applyGsfMaterials(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const swap = (m) => {
      const f = m && m.userData && m.userData.gsf_flags;
      const a1 = f ? parseInt(String(f).split('/')[0], 16) : 0;
      if (!(a1 & 0x4) || m.userData.glow) return m;
      if (!glow.has(m)) {
        const g = new THREE.MeshBasicMaterial({ map: m.map, color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide,
          blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: a1 & 0x3 ? THREE.SrcAlphaFactor : THREE.OneFactor, blendDst: THREE.OneFactor,
          toneMapped: false, fog: false });
        g.name = m.name; g.userData = Object.assign({}, m.userData, { glow: true });
        glow.set(m, g);
      }
      return glow.get(m);
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    if ([].concat(o.material).some((m) => m.userData.glow)) { o.castShadow = false; o.renderOrder = 3; }
  });
  return root;
}
