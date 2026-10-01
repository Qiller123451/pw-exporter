"""Put a model and its add-ons together into one glTF scene, and pose it.

    sc = compose([
        {'glb': 'cache/.../aje_allosaurus.glb'},                                  # part 0: the main model
        {'glb': 'cache/.../aje_rider_b.glb', 'parent': 0, 'link': 'Ride', 'anim': 'ride_idle_0'},
    ], animations=['walk_1'])                    # None = all of the main model's animations, [] = none
    sc.j, sc.bin                                 # merged glTF JSON + binary buffer; images still point at files
    posed = sc.pose('walk_1', 0.5)               # [(mesh name, material index, positions, normals, uvs, triangles)]

A part hangs on a link (attachment point, node "link_<name>") of an earlier part, exactly like the game attaches
riders, turrets and weapons: the part's root keeps no rotation of its own (link frames are already the GSF Z-up frame).
Mesh nodes listed in a part's "hide" are left out (the add-on toggles of the app: saddles, damage stages ...).
Each exported animation of the main model also carries the animation every add-on plays (a rider's idle while the
mount walks); add-on animations loop to the length of the main animation.
"""
import copy
import math
import os

import numpy as np

from . import glb as glbmod
from .gsf import qmat


class Scene:
    def __init__(self):
        self.j = {'asset': {'version': '2.0', 'generator': 'ParaWorld Model Exporter (pwexport)'},
                  'scene': 0, 'scenes': [{'nodes': []}], 'nodes': [], 'meshes': [], 'materials': [], 'textures': [],
                  'images': [], 'samplers': [], 'skins': [], 'accessors': [], 'bufferViews': [], 'buffers': [],
                  'animations': []}
        self.bin = bytearray()
        self.image_files = []          # absolute source file of every image (same index as j['images'])
        self.part_nodes = []           # per part: (first node, node count)
        self.part_anims = []           # per part: {name: animation dict (already re-indexed)}
        self.part_roots = []           # per part: its root node

    # ------------------------------------------------------------------ building
    def add_part(self, path, parent=None, link=None, hide=(), prefix=''):
        j, b = glbmod.load(path)
        base_dir = os.path.dirname(os.path.abspath(path))
        o = self.j
        off = {k: len(o[k]) for k in ('nodes', 'meshes', 'materials', 'textures', 'images', 'samplers', 'skins', 'accessors', 'bufferViews')}
        while len(self.bin) % 4:
            self.bin.append(0)
        boff = len(self.bin)
        self.bin += b
        for bv in j.get('bufferViews', []):
            bv = dict(bv); bv['buffer'] = 0; bv['byteOffset'] = bv.get('byteOffset', 0) + boff
            o['bufferViews'].append(bv)
        for a in j.get('accessors', []):
            a = dict(a)
            if 'bufferView' in a: a['bufferView'] += off['bufferViews']
            o['accessors'].append(a)
        for im in j.get('images', []):
            im = dict(im)
            src = None
            if 'uri' in im and not im['uri'].startswith('data:'):
                src = os.path.normpath(os.path.join(base_dir, im['uri']))
            elif 'bufferView' in im:
                im['bufferView'] += off['bufferViews']
            o['images'].append(im)
            self.image_files.append(src)
        for s in j.get('samplers', []):
            o['samplers'].append(dict(s))
        for t in j.get('textures', []):
            t = dict(t)
            if 'source' in t: t['source'] += off['images']
            if 'sampler' in t: t['sampler'] += off['samplers']
            o['textures'].append(t)
        for m in j.get('materials', []):
            m = copy.deepcopy(m)
            pbr = m.get('pbrMetallicRoughness', {})
            if 'baseColorTexture' in pbr: pbr['baseColorTexture']['index'] += off['textures']
            if 'normalTexture' in m: m['normalTexture']['index'] += off['textures']
            o['materials'].append(m)
        for me in j.get('meshes', []):
            me = copy.deepcopy(me)
            for p in me['primitives']:
                p['attributes'] = {k: v + off['accessors'] for k, v in p['attributes'].items()}
                if 'indices' in p: p['indices'] += off['accessors']
                if 'material' in p: p['material'] += off['materials']
            o['meshes'].append(me)
        hide = set(hide or ())
        for n in j.get('nodes', []):
            n = copy.deepcopy(n)
            if 'children' in n: n['children'] = [c + off['nodes'] for c in n['children']]
            if 'mesh' in n:
                if n.get('name') in hide: del n['mesh']; n.pop('skin', None)
                else: n['mesh'] += off['meshes']
            if 'skin' in n: n['skin'] += off['skins']
            if prefix and n.get('name'): n['name'] = prefix + n['name']
            o['nodes'].append(n)
        for s in j.get('skins', []):
            s = dict(s)
            s['joints'] = [x + off['nodes'] for x in s['joints']]
            if 'inverseBindMatrices' in s: s['inverseBindMatrices'] += off['accessors']
            if 'skeleton' in s: s['skeleton'] += off['nodes']
            o['skins'].append(s)
        anims = {}
        for a in j.get('animations', []):
            a = copy.deepcopy(a)
            for s in a['samplers']:
                s['input'] += off['accessors']; s['output'] += off['accessors']
            for c in a['channels']:
                c['target']['node'] += off['nodes']
            anims[a['name']] = a
        self.part_anims.append(anims)
        root = j['scenes'][0]['nodes'][0] + off['nodes']
        self.part_nodes.append((off['nodes'], len(j.get('nodes', []))))
        self.part_roots.append(root)
        if parent is None:
            o['scenes'][0]['nodes'].append(root)
        else:
            first, cnt = self.part_nodes[parent]
            want = 'link_' + link
            host = None
            for i in range(first, first + cnt):
                nm = o['nodes'][i].get('name', '')
                if nm == want or nm.endswith(':' + want):
                    host = i
                    break
            if host is None:            # no such link: hang it on the parent's root (still exported)
                host = self.part_roots[parent]
            o['nodes'][root].pop('rotation', None)        # link frames are the GSF Z-up frame already
            o['nodes'][host].setdefault('children', []).append(root)
        return len(self.part_nodes) - 1

    def set_animations(self, main_anims=None, part_anim=None):
        """main_anims: names of the main model's animations to export (None = all, [] = none);
        part_anim: {part index: animation name} played by the add-ons inside every exported animation"""
        part_anim = part_anim or {}
        main = self.part_anims[0] if self.part_anims else {}
        names = list(main) if main_anims is None else [n for n in main_anims if n in main]
        out = []
        for nm in names:
            a = copy.deepcopy(main[nm])
            dur = self._duration(a)
            for k, an in part_anim.items():
                src = self.part_anims[k].get(an) if 0 < k < len(self.part_anims) else None
                if not src:
                    continue
                self._append_looped(a, src, dur)
            out.append(a)
        if not names and part_anim:        # no main animation: still keep the add-ons' own (a rider idling)
            a = {'name': 'parts', 'channels': [], 'samplers': []}
            dur = max((self._duration(self.part_anims[k][an]) for k, an in part_anim.items()
                       if 0 < k < len(self.part_anims) and an in self.part_anims[k]), default=0)
            for k, an in part_anim.items():
                if 0 < k < len(self.part_anims) and an in self.part_anims[k]:
                    self._append_looped(a, self.part_anims[k][an], dur)
            if a['channels'] and main_anims is None:
                out.append(a)
        self.j['animations'] = out

    def _duration(self, a):
        d = 0.0
        for s in a['samplers']:
            acc = self.j['accessors'][s['input']]
            if 'max' in acc: d = max(d, float(acc['max'][0]))
        return d

    def _append_looped(self, a, src, dur):
        """add src's channels to animation a; if src is shorter, repeat its keys to cover dur"""
        sd = self._duration(src)
        reps = max(1, int(math.ceil(dur / sd))) if sd > 1e-6 and dur > sd + 1e-4 else 1
        for c in src['channels']:
            s = src['samplers'][c['sampler']]
            inp, outp = s['input'], s['output']
            if reps > 1:
                t = self.accessor(inp)[:, 0]
                v = self.accessor(outp)
                ts = np.concatenate([t + sd * r for r in range(reps)])
                vs = np.concatenate([v] * reps)
                keep = ts <= dur + 1e-4
                inp = self.add_accessor(ts[keep].reshape(-1, 1), 'SCALAR', minmax=True)
                outp = self.add_accessor(vs[keep], self.j['accessors'][s['output']]['type'])
            a['samplers'].append({'input': inp, 'output': outp, 'interpolation': s.get('interpolation', 'LINEAR')})
            a['channels'].append({'sampler': len(a['samplers']) - 1, 'target': dict(c['target'])})

    def trim(self, name, t0, t1):
        """keep only [t0, t1] of an animation (the seamless loop of a start + loop + stop walk)"""
        for a in self.j['animations']:
            if a['name'] != name:
                continue
            for s in a['samplers']:
                t = self.accessor(s['input'])[:, 0]
                v = self.accessor(s['output'])
                tt = np.unique(np.concatenate([[t0], t[(t > t0) & (t < t1)], [t1]]))
                vv = np.array([_sample(t, v, x, self.j['accessors'][s['output']]['type'] == 'VEC4') for x in tt])
                s['input'] = self.add_accessor((tt - t0).reshape(-1, 1), 'SCALAR', minmax=True)
                s['output'] = self.add_accessor(vv, self.j['accessors'][s['output']]['type'])

    def tint_party(self, rgb):
        """multiply the party-colour materials (GSF material flag 0x1000) by a player colour (0..1 floats)"""
        for m in self.j['materials']:
            f = (m.get('extras') or {}).get('gsf_flags', '')
            try:
                party = int(str(f).split('/')[0], 16) & 0x1000
            except ValueError:
                party = 0
            if party:
                m.setdefault('pbrMetallicRoughness', {})['baseColorFactor'] = [float(rgb[0]), float(rgb[1]), float(rgb[2]), 1.0]

    # ------------------------------------------------------------------ buffers
    def accessor(self, i):
        return glbmod.accessor(self.j, self.bin, i)

    def add_accessor(self, arr, typ, minmax=False):
        arr = np.asarray(arr, dtype=np.float32)
        while len(self.bin) % 4:
            self.bin.append(0)
        data = arr.astype('<f4').tobytes()
        self.j['bufferViews'].append({'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': len(data)})
        self.bin += data
        a = {'bufferView': len(self.j['bufferViews']) - 1, 'componentType': 5126, 'count': int(arr.shape[0]), 'type': typ}
        if minmax:
            a['min'] = [float(x) for x in arr.min(0)]
            a['max'] = [float(x) for x in arr.max(0)]
        self.j['accessors'].append(a)
        return len(self.j['accessors']) - 1

    # ------------------------------------------------------------------ posing
    def world_matrices(self, anim=None, t=0.0):
        """world matrix of every node with an animation applied at time t (rest pose if anim is None)"""
        N = self.j['nodes']
        loc = []
        for n in N:
            loc.append([np.array(n.get('translation', [0, 0, 0]), float), np.array(n.get('rotation', [0, 0, 0, 1]), float),
                        np.array(n.get('scale', [1, 1, 1]), float)])
        a = None
        if anim is not None:
            a = next((x for x in self.j['animations'] if x['name'] == anim), None)
        if a:
            for c in a['channels']:
                s = a['samplers'][c['sampler']]
                T = self.accessor(s['input'])[:, 0]
                V = self.accessor(s['output'])
                path = c['target']['path']
                if path not in ('translation', 'rotation', 'scale'):
                    continue
                k = {'translation': 0, 'rotation': 1, 'scale': 2}[path]
                tt = t % T[-1] if T[-1] > 0 else 0.0
                loc[c['target']['node']][k] = _sample(T, V, tt, path == 'rotation')
        parent = {}
        for i, n in enumerate(N):
            for ch in n.get('children', []):
                parent[ch] = i
        W = [None] * len(N)

        def w(i):
            if W[i] is not None:
                return W[i]
            tr, q, sc = loc[i]
            M = np.eye(4)
            M[:3, :3] = qmat(q / (np.linalg.norm(q) or 1)) * sc
            M[:3, 3] = tr
            W[i] = M if i not in parent else w(parent[i]) @ M
            return W[i]
        for i in range(len(N)):
            w(i)
        return W

    def pose(self, anim=None, t=0.0):
        """the visible geometry in world space: [dict(name, material, pos, nrm, uv, tri)]"""
        W = self.world_matrices(anim, t)
        out = []
        for ni, n in enumerate(self.j['nodes']):
            if 'mesh' not in n:
                continue
            me = self.j['meshes'][n['mesh']]
            for p in me['primitives']:
                at = p['attributes']
                P = self.accessor(at['POSITION'])[:, :3]
                Nn = self.accessor(at['NORMAL'])[:, :3] if 'NORMAL' in at else np.zeros_like(P)
                UV = self.accessor(at['TEXCOORD_0'])[:, :2] if 'TEXCOORD_0' in at else np.zeros((len(P), 2))
                if 'skin' in n and 'JOINTS_0' in at:
                    sk = self.j['skins'][n['skin']]
                    IB = self.accessor(sk['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
                    M = np.array([W[jn] @ IB[k] for k, jn in enumerate(sk['joints'])])
                    J = self.accessor(at['JOINTS_0']).astype(int)
                    Wt = self.accessor(at['WEIGHTS_0'])
                    Ph = np.c_[P, np.ones(len(P))]
                    pos = np.zeros((len(P), 3)); nrm = np.zeros((len(P), 3))
                    for c in range(4):
                        Mc = M[np.clip(J[:, c], 0, len(M) - 1)]
                        pos += Wt[:, c:c + 1] * np.einsum('nij,nj->ni', Mc, Ph)[:, :3]
                        nrm += Wt[:, c:c + 1] * np.einsum('nij,nj->ni', Mc[:, :3, :3], Nn)
                else:
                    M = W[ni]
                    pos = P @ M[:3, :3].T + M[:3, 3]
                    nrm = Nn @ np.linalg.inv(M[:3, :3])
                nrm = nrm / np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
                tri = self.accessor(p['indices'])[:, 0].astype(np.int64).reshape(-1, 3) if 'indices' in p else \
                    np.arange(len(P)).reshape(-1, 3)
                out.append(dict(name=n.get('name', 'mesh'), material=p.get('material'), pos=pos, nrm=nrm, uv=UV, tri=tri))
        return out


def _sample(T, V, t, rot):
    if t <= T[0]:
        return V[0].copy()
    if t >= T[-1]:
        return V[-1].copy()
    k = int(np.searchsorted(T, t)) - 1
    f = (t - T[k]) / max(T[k + 1] - T[k], 1e-9)
    a, b = V[k], V[k + 1]
    if rot:
        if np.dot(a, b) < 0:
            b = -b
        q = a * (1 - f) + b * f
        return q / (np.linalg.norm(q) or 1)
    return a * (1 - f) + b * f


def compose(parts, animations=None, party=None):
    """parts: [{'glb': path, 'parent': index or None, 'link': name, 'hide': [node names], 'anim': name}]"""
    sc = Scene()
    for k, p in enumerate(parts):
        sc.add_part(p['glb'], parent=None if k == 0 else p.get('parent', 0), link=p.get('link'),
                    hide=p.get('hide') or (), prefix='' if k == 0 else 'part%d:' % k)
    sc.set_animations(animations, {k: p['anim'] for k, p in enumerate(parts) if k and p.get('anim')})
    if party is not None:
        sc.tint_party(party)
    return sc
