"""Editing a converted model (.glb) in place: read a primitive's vertices, put new ones in, embed pictures.

    g = Gltf(path)
    for mesh, prim in g.primitives(): v = g.vertices(prim)      # {'POSITION': (n, 3), ..., 'indices': (m, 3)}
    g.set_vertices(prim, v)                                      # new accessors (the old ones are dropped on save)
    t = g.add_texture(png_bytes, 'image/png')                    # -> texture index
    g.save(out)

Everything else - nodes and their names, skins, animations, extras (links, flags, sounds) - stays as it is, so the
remake, the shooter and the exporter's viewer treat the result exactly like the original.
"""
import numpy as np

from .. import glb

_CT = {np.dtype('float32'): 5126, np.dtype('uint16'): 5123, np.dtype('uint32'): 5125, np.dtype('uint8'): 5121}
_TYPE = {1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4'}


class Gltf:
    def __init__(self, path):
        self.j, self.b = glb.load(path)
        self.extra = bytearray()

    def primitives(self):
        for m in self.j.get('meshes', []):
            for p in m['primitives']:
                yield m, p

    def material(self, prim):
        i = prim.get('material')
        return self.j['materials'][i] if i is not None else {}

    def vertices(self, prim):
        out = {}
        for k, a in prim['attributes'].items():
            x = glb.accessor(self.j, self.b, a)
            out[k] = x.astype(np.int64) if k.startswith('JOINTS') else x
        idx = glb.accessor(self.j, self.b, prim['indices']).astype(np.int64) if 'indices' in prim else np.arange(len(out['POSITION']))
        out['indices'] = idx.reshape(-1, 3)
        return out

    # ---------------------------------------------------------------- writing
    def _view(self, data, target=None):
        while (len(self.b) + len(self.extra)) % 4:
            self.extra.append(0)
        bv = {'buffer': 0, 'byteOffset': len(self.b) + len(self.extra), 'byteLength': len(data)}
        if target:
            bv['target'] = target
        self.extra += data
        self.j['bufferViews'].append(bv)
        return len(self.j['bufferViews']) - 1

    def add_accessor(self, arr, target=None, normalized=False, minmax=False):
        arr = np.ascontiguousarray(arr)
        n = arr.shape[0]
        comps = 1 if arr.ndim == 1 else arr.shape[1]
        acc = {'bufferView': self._view(arr.tobytes(), target), 'componentType': _CT[arr.dtype], 'count': n, 'type': _TYPE[comps]}
        if normalized:
            acc['normalized'] = True
        if minmax:
            a2 = arr.reshape(n, comps)
            acc['min'] = [float(v) for v in a2.min(0)]
            acc['max'] = [float(v) for v in a2.max(0)]
        self.j['accessors'].append(acc)
        return len(self.j['accessors']) - 1

    def set_vertices(self, prim, v):
        """new vertex data for a primitive: POSITION, NORMAL, TEXCOORD_n (float), JOINTS_0 (int), WEIGHTS_0, indices (m, 3)"""
        attrs = {}
        for k, x in v.items():
            if k == 'indices':
                continue
            if k.startswith('JOINTS'):
                attrs[k] = self.add_accessor(np.asarray(x, np.uint16 if x.max() < 65536 else np.uint32), 34962)
            else:
                attrs[k] = self.add_accessor(np.asarray(x, np.float32), 34962, minmax=(k == 'POSITION'))
        prim['attributes'] = attrs
        ind = np.asarray(v['indices']).reshape(-1)
        prim['indices'] = self.add_accessor(ind.astype(np.uint16 if ind.max() < 65536 else np.uint32), 34963)

    def add_image(self, data, mime, name=None):
        im = {'bufferView': self._view(data), 'mimeType': mime}
        if name:
            im['name'] = name
        self.j.setdefault('images', []).append(im)
        return len(self.j['images']) - 1

    def add_texture(self, data, mime, name=None, sampler=None):
        img = self.add_image(data, mime, name)
        t = {'source': img}
        if sampler is not None:
            t['sampler'] = sampler
        self.j.setdefault('textures', []).append(t)
        return len(self.j['textures']) - 1

    def save(self, path, extras=None):
        if extras:
            root = self.j['nodes'][self.j['scenes'][0]['nodes'][0]]
            root.setdefault('extras', {}).update(extras)
        binc = bytes(self.b) + bytes(self.extra)
        self.j['buffers'] = [{'byteLength': len(binc)}]
        keep = [a['name'] for a in self.j.get('animations', [])]
        # drop the pictures no texture uses any more (glb.repack then drops their data and the replaced accessors)
        used = sorted({t['source'] for t in self.j.get('textures', []) if 'source' in t})
        remap = {o: n for n, o in enumerate(used)}
        if 'images' in self.j:
            self.j['images'] = [self.j['images'][i] for i in used]
            for t in self.j.get('textures', []):
                if 'source' in t:
                    t['source'] = remap[t['source']]
        data = glb.repack(self.j, binc, keep)
        with open(path, 'wb') as f:
            f.write(data)
        return len(data)


def weld_keys(pos, eps=1e-5):
    """an integer key per vertex: vertices at the same place (within eps) share it"""
    q = np.round(np.asarray(pos) / eps).astype(np.int64)
    _, inv = np.unique(q, axis=0, return_inverse=True)
    return inv.reshape(-1)


def blend_skin(joints, weights, bary, k=4):
    """skin weights of new vertices from their corners': joints/weights (n, 3, 4), bary (n, 3) -> the k strongest
    joints (summed over the corners) and their weights, normalized"""
    n = joints.shape[0]
    j = joints.reshape(n, -1)
    w = (weights * bary[:, :, None]).reshape(n, -1)
    # sum the weights of equal joints: sort by joint, add runs
    order = np.argsort(j, axis=1, kind='stable')
    js = np.take_along_axis(j, order, 1)
    ws = np.take_along_axis(w, order, 1)
    same = np.concatenate([np.zeros((n, 1), bool), js[:, 1:] == js[:, :-1]], 1)
    acc = ws.copy()
    for c in range(1, js.shape[1]):
        m = same[:, c]
        acc[m, c] += acc[m, c - 1]
        acc[m, c - 1] = 0
    top = np.argsort(-acc, axis=1)[:, :k]
    out_j = np.take_along_axis(js, top, 1)
    out_w = np.take_along_axis(acc, top, 1)
    s = out_w.sum(1, keepdims=True)
    s[s == 0] = 1
    out_w /= s
    out_j[out_w == 0] = 0
    return out_j, out_w
