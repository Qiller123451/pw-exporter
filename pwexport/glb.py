"""Small helpers for binary glTF (.glb) files written by pwexport.gsf.

    j, bin_chunk = load(path)              # JSON dict + BIN chunk bytes
    save(path, j, bin_chunk)
    data = repack(j, bin_chunk, keep)      # drop animations not in `keep`, compact buffers -> .glb bytes
    loops = walk_loops(j, bin_chunk)       # {'walk_2': [t0, t1]} for walk clips made as start + loop + stop
    links(j)                               # ['HndR', 'Ride', ...] attachment points (nodes named link_<name>)
"""
import json
import struct

import numpy as np

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942


def load(path_or_bytes):
    b = path_or_bytes if isinstance(path_or_bytes, (bytes, bytearray)) else open(path_or_bytes, 'rb').read()
    jl = struct.unpack_from('<I', b, 12)[0]
    j = json.loads(b[20:20 + jl])
    if len(b) >= 28 + jl:
        bl = struct.unpack_from('<I', b, 20 + jl)[0]
        return j, bytes(b[28 + jl:28 + jl + bl])
    return j, b''


def pack(j, binc):
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    binc = bytes(binc) + b'\0' * ((-len(binc)) % 4)
    out = struct.pack('<III', GLB_MAGIC, 2, 20 + len(js) + (8 + len(binc) if binc else 0))
    out += struct.pack('<II', len(js), CHUNK_JSON) + js
    if binc:
        out += struct.pack('<II', len(binc), CHUNK_BIN) + binc
    return out


def save(path, j, binc):
    with open(path, 'wb') as f:
        f.write(pack(j, binc))


def repack(j, binc, keep_anims):
    """keep only the animations named in keep_anims and drop the buffer data nothing uses any more"""
    j['animations'] = [a for a in j.get('animations', []) if a['name'] in keep_anims]
    if not j['animations']:
        j.pop('animations')
    used_acc = set()
    for m in j.get('meshes', []):
        for p in m['primitives']:
            used_acc.update(p['attributes'].values())
            if 'indices' in p: used_acc.add(p['indices'])
    for s in j.get('skins', []):
        if 'inverseBindMatrices' in s: used_acc.add(s['inverseBindMatrices'])
    for a in j.get('animations', []):
        for s in a['samplers']:
            used_acc.update([s['input'], s['output']])
    acc_map, new_acc = {}, []
    for i, a in enumerate(j['accessors']):
        if i in used_acc:
            acc_map[i] = len(new_acc); new_acc.append(a)
    used_bv = sorted(set(a['bufferView'] for a in new_acc if 'bufferView' in a) |
                     set(im['bufferView'] for im in j.get('images', []) if 'bufferView' in im))
    bv_map, out, new_bv = {}, bytearray(), []
    for i in used_bv:
        bv = dict(j['bufferViews'][i])
        data = binc[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
        while len(out) % 4: out.append(0)
        bv['byteOffset'] = len(out)
        out += data
        bv_map[i] = len(new_bv); new_bv.append(bv)
    for a in new_acc:
        if 'bufferView' in a: a['bufferView'] = bv_map[a['bufferView']]
    for im in j.get('images', []):
        if 'bufferView' in im: im['bufferView'] = bv_map[im['bufferView']]
    for m in j.get('meshes', []):
        for p in m['primitives']:
            p['attributes'] = {k: acc_map[v] for k, v in p['attributes'].items()}
            if 'indices' in p: p['indices'] = acc_map[p['indices']]
    for s in j.get('skins', []):
        if 'inverseBindMatrices' in s: s['inverseBindMatrices'] = acc_map[s['inverseBindMatrices']]
    for a in j.get('animations', []):
        for s in a['samplers']:
            s['input'] = acc_map[s['input']]; s['output'] = acc_map[s['output']]
    j['accessors'] = new_acc
    j['bufferViews'] = new_bv
    while len(out) % 4: out.append(0)
    j['buffers'] = [{'byteLength': len(out)}]
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    return (struct.pack('<III', GLB_MAGIC, 2, 28 + len(js) + len(out)) + struct.pack('<II', len(js), CHUNK_JSON) + js +
            struct.pack('<II', len(out), CHUNK_BIN) + bytes(out))


def links(j):
    """attachment point names of a converted model"""
    return [n['name'][5:] for n in j.get('nodes', []) if n.get('name', '').startswith('link_')]


def root_extras(j):
    try:
        return j['nodes'][j['scenes'][0]['nodes'][0]].get('extras') or {}
    except (KeyError, IndexError):
        return {}


# ------------------------------------------------------------------ animation analysis
def accessor(j, b, i):
    a = j['accessors'][i]
    bv = j['bufferViews'][a['bufferView']]
    comp = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    dt = {5126: '<f4', 5122: '<i2', 5123: '<u2', 5120: 'i1', 5121: 'u1', 5125: '<u4'}[a['componentType']]
    x = np.frombuffer(b, dt, a['count'] * comp, off).reshape(a['count'], comp).astype(np.float64)
    if a.get('normalized'):
        x = x / {5122: 32767., 5123: 65535., 5120: 127., 5121: 255.}[a['componentType']]
    return x


def _rot_tracks(j, b, an):
    out = {}
    for ch in an['channels']:
        if ch['target']['path'] != 'rotation': continue
        s = an['samplers'][ch['sampler']]
        out[ch['target']['node']] = (accessor(j, b, s['input'])[:, 0], accessor(j, b, s['output']))
    return out


def _pose(tr, t):
    return {k: V[min(len(T) - 1, int(np.searchsorted(T, t - 1e-6)))] for k, (T, V) in tr.items()}


def _dist(p, q):
    ks = set(p) & set(q)
    if not ks: return 0.0
    return float(np.mean([1 - abs(np.dot(p[k], q[k]) / (np.linalg.norm(p[k]) * np.linalg.norm(q[k]) + 1e-9)) for k in ks]) * 1000)


def walk_loops(j, b):
    """Walk/run clips that are "start + loop + stop" in one (e.g. the SEAS Black widow): the clip begins and ends in
    the stand pose and a stretch in the middle loops seamlessly. The original engine loops only that stretch.
    Returns {clip name: [t0, t1]} (seconds)."""
    anims = {a['name']: a for a in j.get('animations', [])}
    st = anims.get('standanim')
    if not st:
        return {}
    sp = _pose(_rot_tracks(j, b, st), 0)
    loops = {}
    for cn, a in anims.items():
        if not (cn.startswith('walk') or cn.startswith('run')) or '_end' in cn: continue
        tr = _rot_tracks(j, b, a)
        if not tr: continue
        T = max(t[-1] for t, _ in tr.values())
        N = 60
        P = [_pose(tr, T * i / N) for i in range(N + 1)]
        peak = max(_dist(x, sp) for x in P)
        # the whole clip starts and ends at the stand pose while the middle is far from it
        if peak < 20 or _dist(P[0], sp) > peak * 0.05 or _dist(P[N], sp) > peak * 0.05: continue
        best = None
        for i in range(1, N // 2):
            for k in range(i + int(0.3 * N), N):
                d = _dist(P[i], P[k])
                if _dist(P[i], sp) > peak * 0.5 and (best is None or d < best[0]): best = (d, i, k)
        if best and best[0] < peak * 0.02:
            loops[cn] = [round(T * best[1] / N, 4), round(T * best[2] / N, 4)]
    return loops
