"""Models of the sequel campaign's 1960s world (docs/SEQUEL.md), built from shapes in code: houses, a diner, a gas
station, barns, water towers, poles, fences, cars, buses, army trucks, the SEAS field machines, rifts and
stabilizers. Low-poly and flat-shaded, coloured by material (no textures).

    python3 -m remake.pipeline.sequel_models <data dir>     -> <data>/assets/models/sq_*.glb + manifest entries
    (pipeline step "sequel", after "assets": it adds its entries to the manifest that step writes)

Coordinates: metres, y up, the model's front towards -z (the remake's heading 0). Every mesh node carries the
attribute 0x801F (all levels of detail, no state bits: engine/assets.js keeps it as plain geometry).
"""
import json
import math
import os
import sys

import numpy as np

from pwexport.glb import pack

ATTR = 0x801F


# ------------------------------------------------------------------------------------------------ shapes
class Part:
    """triangles of one material: v (n, 3) float, t (m, 3) int"""

    def __init__(self, v, t, mat):
        self.v = np.asarray(v, float).reshape(-1, 3)
        self.t = np.asarray(t, int).reshape(-1, 3)
        self.mat = mat

    def at(self, x=0, y=0, z=0):
        self.v = self.v + [x, y, z]
        return self

    def rot(self, axis, a):
        c, s = math.cos(a), math.sin(a)
        R = {'x': [[1, 0, 0], [0, c, -s], [0, s, c]], 'y': [[c, 0, s], [0, 1, 0], [-s, 0, c]], 'z': [[c, -s, 0], [s, c, 0], [0, 0, 1]]}[axis]
        self.v = self.v @ np.array(R).T
        return self

    def ry(self, a): return self.rot('y', a)
    def rx(self, a): return self.rot('x', a)
    def rz(self, a): return self.rot('z', a)

    def scale(self, sx, sy=None, sz=None):
        self.v = self.v * [sx, sx if sy is None else sy, sx if sz is None else sz]
        return self


def quads(v, qs, mat):
    t = []
    for a, b, c, d in qs:
        t += [(a, b, c), (a, c, d)]
    return Part(v, t, mat)


def box(w, h, d, mat, x=0, y=0, z=0):
    """a box standing on y, centred on x / z"""
    X, Z = w / 2, d / 2
    v = [(-X, 0, -Z), (X, 0, -Z), (X, 0, Z), (-X, 0, Z), (-X, h, -Z), (X, h, -Z), (X, h, Z), (-X, h, Z)]
    q = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    return quads(v, q, mat).at(x, y, z)


def cyl(r, h, mat, seg=12, r2=None, x=0, y=0, z=0, cap=True):
    """a cylinder (or cone / frustum with r2) standing on y"""
    r2 = r if r2 is None else r2
    v, t = [], []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        v += [(r * math.cos(a), 0, r * math.sin(a)), (r2 * math.cos(a), h, r2 * math.sin(a))]
    for i in range(seg):
        j = (i + 1) % seg
        t += [(2 * i, 2 * i + 1, 2 * j + 1), (2 * i, 2 * j + 1, 2 * j)]
    if cap:
        b, c = len(v), len(v) + 1
        v += [(0, 0, 0), (0, h, 0)]
        for i in range(seg):
            j = (i + 1) % seg
            t += [(b, 2 * j, 2 * i)]
            if r2 > 1e-6:
                t += [(c, 2 * i + 1, 2 * j + 1)]
    return Part(v, t, mat).at(x, y, z)


def sphere(r, mat, seg=10, rings=6, x=0, y=0, z=0, half=False):
    v, t = [], []
    rr = rings if not half else rings // 2
    for k in range(rr + 1):
        th = math.pi * k / rings
        for i in range(seg):
            a = 2 * math.pi * i / seg
            v.append((r * math.sin(th) * math.cos(a), r * math.cos(th), r * math.sin(th) * math.sin(a)))
    for k in range(rr):
        for i in range(seg):
            j = (i + 1) % seg
            a, b, c, d = k * seg + i, k * seg + j, (k + 1) * seg + j, (k + 1) * seg + i
            t += [(a, c, b), (a, d, c)]
    return Part(v, t, mat).at(x, y, z)


def gable(w, h, d, mat, x=0, y=0, z=0, over=0.4):
    """a gable roof: ridge along x, eaves overhang"""
    W, D = w / 2 + over, d / 2 + over
    v = [(-W, 0, -D), (W, 0, -D), (W, 0, D), (-W, 0, D), (-W, h, 0), (W, h, 0)]
    t = [(0, 4, 5), (0, 5, 1), (3, 2, 5), (3, 5, 4), (0, 3, 4), (1, 5, 2), (0, 1, 2), (0, 2, 3)]
    return Part(v, t, mat).at(x, y, z)


def gable_ends(w, h, d, mat, y=0):
    """the two triangle walls under a gable roof whose ridge runs along x (w wide, d deep)"""
    X, D = w / 2, d / 2
    v = [(-X, 0, -D), (-X, 0, D), (-X, h, 0), (X, 0, -D), (X, 0, D), (X, h, 0)]
    return Part(v, [(0, 1, 2), (3, 5, 4)], mat).at(0, y, 0)


def hip(w, h, d, mat, x=0, y=0, z=0, over=0.4):
    W, D = w / 2 + over, d / 2 + over
    r = max(0.0, W - D)
    v = [(-W, 0, -D), (W, 0, -D), (W, 0, D), (-W, 0, D), (-r, h, 0), (r, h, 0)]
    t = [(0, 4, 5), (0, 5, 1), (3, 2, 5), (3, 5, 4), (0, 3, 4), (1, 5, 2), (0, 1, 2), (0, 2, 3)]
    return Part(v, t, mat).at(x, y, z)


def beam(p, q, r, mat, seg=6):
    """a round bar from p to q"""
    p, q = np.array(p, float), np.array(q, float)
    d = q - p
    L = float(np.linalg.norm(d))
    c = cyl(r, L, mat, seg)
    # turn y onto d
    y = np.array([0, 1, 0.0])
    n = d / L
    ax = np.cross(y, n)
    s, co = np.linalg.norm(ax), float(np.dot(y, n))
    if s > 1e-9:
        ax = ax / s
        a = math.atan2(s, co)
        K = np.array([[0, -ax[2], ax[1]], [ax[2], 0, -ax[0]], [-ax[1], ax[0], 0]])
        R = np.eye(3) + math.sin(a) * K + (1 - math.cos(a)) * K @ K
        c.v = c.v @ R.T
    elif co < 0:
        c.v = c.v * [1, -1, 1]
    return c.at(*p)


def wheel(r, w, mat, x, y, z, seg=10):
    return cyl(r, w, mat, seg).rz(math.pi / 2).at(x + w / 2, y, z)


# ------------------------------------------------------------------------------------------------ materials
def rgb(h):
    return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]


MATS = {}


def mat(name, color, party=False, rough=0.9, metal=0.0, emissive=None):
    MATS[name] = dict(color=rgb(color), party=party, rough=rough, metal=metal, emissive=emissive)
    return name


for n, c in {'white': 0xEDE8DC, 'cream': 0xF0E2BC, 'mint': 0xA8D8C0, 'pink': 0xE8B4B8, 'sky': 0x9CC4DC, 'butter': 0xEFD27A,
             'sage': 0x9DB08A, 'brick': 0x9C4B36, 'redbarn': 0x8E2A22, 'wood': 0x8A6440, 'darkwood': 0x5A3F28, 'shingle': 0x5C5650,
             'roofred': 0x7A3A30, 'roofgreen': 0x4A5E48, 'roofblue': 0x4A5868, 'concrete': 0xB4B0A6, 'asphalt': 0x3E3E40,
             'steel': 0x8C9094, 'darksteel': 0x55595E, 'chrome': 0xD8DCE0, 'glass': 0x6E8EA8, 'black': 0x222222, 'tire': 0x1C1C1C,
             'olive': 0x5B6438, 'canvas': 0x8A8A60, 'khaki': 0xB8A878, 'yellow': 0xE8B820, 'red': 0xC03028, 'orange': 0xD8702A,
             'teal': 0x2E8A8A, 'navy': 0x2A3A5C, 'cherry': 0xA82830, 'aqua': 0x6CC8C0, 'tan': 0xC8B08C, 'sand': 0xD8C8A0,
             'sandbag': 0xA89870, 'grass': 0x6B8A3A, 'neon': 0xFF5A78, 'bulb': 0xFFF2B0, 'rust': 0x8A4A2A, 'copper': 0xB87333,
             'seas': 0x6A7A86, 'seasdark': 0x3A444C}.items():
    mat(n, c, rough=0.4 if n in ('chrome', 'glass') else 0.9, metal=0.6 if n in ('chrome', 'steel', 'darksteel') else 0.0)
mat('party', 0xD0D0D0, party=True)
mat('riftglow', 0x9AF0FF, emissive=[0.45, 0.95, 1.0])
mat('riftcore', 0xF0FFFF, emissive=[1.0, 1.0, 1.0])
mat('coilglow', 0x80D0FF, emissive=[0.4, 0.8, 1.0])
mat('lamp', 0xFFF4C0, emissive=[1.0, 0.95, 0.7])


# ------------------------------------------------------------------------------------------------ glb
def write_glb(path, parts, extras=None):
    by = {}
    for p in parts:
        by.setdefault(p.mat, []).append(p)
    binc = bytearray()
    j = {'asset': {'version': '2.0', 'generator': 'pwtk sequel_models'}, 'scene': 0, 'scenes': [{'nodes': [0]}],
         'nodes': [], 'meshes': [], 'materials': [], 'accessors': [], 'bufferViews': [], 'buffers': []}
    prims = []
    lo, hi = np.full(3, 1e9), np.full(3, -1e9)
    for mname, ps in by.items():
        V = []
        for p in ps:
            tri = p.v[p.t]                                   # (m, 3, 3)
            V.append(tri.reshape(-1, 3))
        P = np.concatenate(V).astype(np.float32)
        T = P.reshape(-1, 3, 3)
        n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
        ln = np.linalg.norm(n, axis=1, keepdims=True)
        n = np.where(ln > 1e-12, n / np.maximum(ln, 1e-12), [0, 1, 0])
        N = np.repeat(n, 3, axis=0).astype(np.float32)
        lo, hi = np.minimum(lo, P.min(0)), np.maximum(hi, P.max(0))
        acc = []
        for arr, typ in ((P, 'VEC3'), (N, 'VEC3')):
            off = len(binc)
            binc += arr.tobytes()
            binc += b'\0' * ((-len(binc)) % 4)
            j['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': arr.nbytes, 'target': 34962})
            a = {'bufferView': len(j['bufferViews']) - 1, 'componentType': 5126, 'count': len(arr), 'type': typ}
            if arr is P:
                a['min'] = [float(x) for x in P.min(0)]
                a['max'] = [float(x) for x in P.max(0)]
            j['accessors'].append(a)
            acc.append(len(j['accessors']) - 1)
        M = MATS[mname]
        m = {'name': 'sq_' + mname, 'pbrMetallicRoughness': {'baseColorFactor': M['color'] + [1.0], 'metallicFactor': M['metal'], 'roughnessFactor': M['rough']}}
        if M['party']:
            m['extras'] = {'gsf_flags': '1000'}
        if M['emissive']:
            m['emissiveFactor'] = M['emissive']
        j['materials'].append(m)
        prims.append({'attributes': {'POSITION': acc[0], 'NORMAL': acc[1]}, 'material': len(j['materials']) - 1})
    j['meshes'].append({'name': 'body', 'primitives': prims})
    j['nodes'] = [{'name': os.path.basename(path)[:-4], 'children': [1], 'extras': dict(extras or {})},
                  {'name': 'body', 'mesh': 0, 'extras': {'attr': ATTR}}]
    j['buffers'] = [{'byteLength': len(binc)}]
    open(path, 'wb').write(pack(j, binc))
    return lo, hi


# ------------------------------------------------------------------------------------------------ the 1960s town
def window_row(w, z, y, n, mat_='glass', h=1.1, ww=1.0, face=-1, x0=None):
    """n windows evenly along x on the wall at z (face -1: the front)"""
    out = []
    step = w / (n + 1)
    for i in range(n):
        x = -w / 2 + step * (i + 1)
        out.append(box(ww, h, 0.08, mat_, x, y, z + face * 0.04))
    return out


def house_ranch(wall, roof, seed=0):
    w, d, h = 12.0, 8.0, 3.0
    ps = [box(w, 0.4, d + 0.4, 'concrete'), box(w, h, d, wall, y=0.4), gable(w, 1.8, d, roof, y=h + 0.4), gable_ends(w, 1.8, d, wall, y=h + 0.4)]
    ps += window_row(w, -d / 2, 1.4, 3)
    ps += window_row(w, d / 2, 1.4, 3, face=1)
    ps.append(box(1.1, 2.2, 0.1, 'darkwood', x=-1.5, y=0.4, z=-d / 2 - 0.05))                   # door
    ps.append(box(3.5, 0.15, 2.0, 'concrete', x=-1.5, y=0.0, z=-d / 2 - 1.0))                   # step
    ps.append(box(0.9, 1.2, 0.9, 'brick', x=w / 2 - 2, y=h + 1.0, z=1.0))                         # chimney
    # carport on the side
    ps.append(box(4.5, 0.15, d, roof, x=w / 2 + 2.25, y=2.6))
    for zz in (-d / 2 + 0.3, d / 2 - 0.3):
        ps.append(box(0.2, 2.6, 0.2, 'white', x=w / 2 + 4.3, z=zz))
    return ps


def house_two(wall, roof):
    w, d = 9.0, 8.0
    ps = [box(w + 0.4, 0.4, d + 0.4, 'concrete'), box(w, 6.0, d, wall, y=0.4), gable(w, 2.6, d, roof, y=6.4), gable_ends(w, 2.6, d, wall, y=6.4)]
    for y in (1.3, 4.3):
        ps += window_row(w, -d / 2, y, 3)
        ps += window_row(w, d / 2, y, 3, face=1)
    ps.append(box(1.1, 2.2, 0.1, 'darkwood', y=0.4, z=-d / 2 - 0.05))
    ps.append(box(w, 0.2, 2.4, 'white', y=2.9, z=-d / 2 - 1.2))                             # porch roof
    for x in (-w / 2 + 0.3, -1.5, 1.5, w / 2 - 0.3):
        ps.append(box(0.2, 2.5, 0.2, 'white', x=x, y=0.4, z=-d / 2 - 2.2))
    ps.append(box(w, 0.35, 2.4, 'wood', y=0.05, z=-d / 2 - 1.2))
    ps.append(box(0.9, 1.6, 0.9, 'brick', x=-w / 2 + 1.5, y=7.3, z=1.5))
    return ps


def diner():
    w, d, h = 16.0, 7.0, 3.6
    ps = [box(w + 1, 0.3, d + 1, 'concrete'), box(w, h, d, 'chrome', y=0.3), box(w + 0.2, 0.6, d + 0.2, 'cherry', y=1.0),
          box(w + 0.4, 0.4, d + 0.4, 'white', y=h + 0.3)]
    ps += window_row(w, -d / 2, 1.8, 6, h=1.4, ww=1.8)
    ps.append(box(1.4, 2.4, 0.1, 'glass', x=-5.5, y=0.3, z=-d / 2 - 0.08))
    # sign on a pole
    ps.append(box(0.3, 7.0, 0.3, 'steel', x=w / 2 + 2, z=-d / 2 - 2))
    ps.append(box(4.0, 2.0, 0.4, 'neon', x=w / 2 + 2, y=7.0, z=-d / 2 - 2))
    ps.append(box(3.6, 1.6, 0.45, 'cream', x=w / 2 + 2, y=7.2, z=-d / 2 - 2))
    return ps


def gas_station():
    ps = [box(24, 0.2, 16, 'concrete'), box(8, 3.6, 6, 'white', x=-6, y=0.2, z=4), box(8.4, 0.6, 6.4, 'red', x=-6, y=3.8, z=4)]
    ps += [box(1.2, 2.2, 0.08, 'glass', x=-6, y=0.2, z=0.96), box(2.4, 1.2, 0.08, 'glass', x=-8.5, y=1.2, z=0.96), box(2.4, 1.2, 0.08, 'glass', x=-3.5, y=1.2, z=0.96)]
    # canopy and pumps
    ps.append(box(12, 0.5, 6, 'white', x=5, y=4.5, z=-3))
    ps.append(box(12.2, 0.3, 6.2, 'red', x=5, y=4.4, z=-3))
    for x in (1.0, 9.0):
        ps.append(box(0.4, 4.5, 0.4, 'white', x=x, z=-3))
    for x in (3.0, 7.0):
        ps.append(box(1.0, 0.2, 2.0, 'concrete', x=x, y=0.2, z=-3))
        ps.append(box(0.6, 1.6, 0.5, 'red', x=x, y=0.4, z=-3))
        ps.append(sphere(0.3, 'white', 8, 6, x=x, y=2.2, z=-3))
    # tall sign
    ps.append(box(0.35, 8, 0.35, 'steel', x=11, z=6))
    ps.append(box(3.2, 3.2, 0.4, 'orange', x=11, y=8, z=6))
    return ps


def barn():
    w, d = 12.0, 18.0
    ps = [box(w, 5.0, d, 'redbarn')]
    # gambrel roof: two slopes per side
    for s in (-1, 1):
        ps.append(Part([(s * w / 2 + s * 0.3, 5, -d / 2 - 0.3), (s * w / 2 + s * 0.3, 5, d / 2 + 0.3), (s * 3.2, 8.0, d / 2 + 0.3), (s * 3.2, 8.0, -d / 2 - 0.3)],
                       [(0, 2, 1), (0, 3, 2)] if s > 0 else [(0, 1, 2), (0, 2, 3)], 'shingle'))
        ps.append(Part([(s * 3.2, 8.0, -d / 2 - 0.3), (s * 3.2, 8.0, d / 2 + 0.3), (0, 9.2, d / 2 + 0.3), (0, 9.2, -d / 2 - 0.3)],
                       [(0, 2, 1), (0, 3, 2)] if s > 0 else [(0, 1, 2), (0, 2, 3)], 'shingle'))
    for z in (-d / 2 - 0.01, d / 2 + 0.01):
        sgn = -1 if z < 0 else 1
        pts = [(-w / 2, 5, z), (w / 2, 5, z), (3.2, 8, z), (0, 9.2, z), (-3.2, 8, z)]
        tri = [(0, 1, 2), (0, 2, 4), (4, 2, 3)]
        ps.append(Part(pts, tri if sgn > 0 else [(a, c, b) for a, b, c in tri], 'redbarn'))
    ps.append(box(4.5, 4.2, 0.12, 'white', z=-d / 2 - 0.06))
    ps.append(box(3.9, 3.6, 0.14, 'redbarn', z=-d / 2 - 0.08, y=0.3))
    ps.append(beam((-1.95, 0.3, -d / 2 - 0.16), (1.95, 3.9, -d / 2 - 0.16), 0.08, 'white', 4))
    ps.append(beam((1.95, 0.3, -d / 2 - 0.16), (-1.95, 3.9, -d / 2 - 0.16), 0.08, 'white', 4))
    return ps


def silo():
    return [cyl(3.0, 16, 'concrete', 16), sphere(3.0, 'steel', 16, 8, y=16, half=True), cyl(0.1, 16, 'darksteel', 4, x=3.05)]


def water_tower(label=True):
    ps = []
    for a in range(4):
        x, z = 4 * math.cos(a * math.pi / 2 + math.pi / 4), 4 * math.sin(a * math.pi / 2 + math.pi / 4)
        ps.append(beam((x, 0, z), (x * 0.7, 14, z * 0.7), 0.25, 'steel'))
    ps.append(beam((-2.8, 7, -2.8), (2.8, 7, 2.8), 0.1, 'steel', 4))
    ps.append(beam((2.8, 7, -2.8), (-2.8, 7, 2.8), 0.1, 'steel', 4))
    ps.append(cyl(4.2, 5.5, 'sky', 18, y=14))
    ps.append(cyl(4.4, 1.8, 'sky', 18, r2=0.3, y=19.5))
    ps.append(cyl(4.3, 0.15, 'steel', 18, y=13.8))
    ps.append(cyl(0.3, 14, 'steel', 6))
    return ps


def telephone_pole():
    return [cyl(0.16, 9.5, 'darkwood', 6), box(2.4, 0.18, 0.18, 'darkwood', y=8.6), box(1.6, 0.16, 0.16, 'darkwood', y=7.9),
            *[cyl(0.07, 0.3, 'glass', 5, x=x, y=8.78) for x in (-1.0, -0.4, 0.4, 1.0)],
            cyl(0.28, 0.7, 'steel', 8, x=0.35, y=6.8)]


def pylon():
    ps = []
    for sx in (-1, 1):
        for sz in (-1, 1):
            ps.append(beam((sx * 3, 0, sz * 3), (sx * 0.8, 24, sz * 0.8), 0.18, 'steel', 4))
    for y, w in ((8, 2.3), (16, 1.6), (22, 1.0)):
        for sx in (-1, 1):
            ps.append(beam((sx * w, y, -w), (sx * w, y, w), 0.1, 'steel', 4))
            ps.append(beam((-w, y, sx * w), (w, y, sx * w), 0.1, 'steel', 4))
    ps.append(box(12, 0.4, 0.4, 'steel', y=20))
    ps.append(box(8, 0.4, 0.4, 'steel', y=24))
    for x in (-5.5, 0, 5.5):
        ps.append(cyl(0.12, 1.2, 'glass', 6, x=x, y=18.8))
    return ps


def street_lamp():
    return [cyl(0.12, 6.5, 'darksteel', 6), beam((0, 6.4, 0), (0, 6.6, -1.6), 0.08, 'darksteel', 5),
            box(0.5, 0.25, 0.8, 'darksteel', y=6.35, z=-1.8), box(0.4, 0.05, 0.6, 'lamp', y=6.33, z=-1.8)]


def picket_fence(n=8):
    ps = [box(n * 0.5, 0.08, 0.05, 'white', y=0.4), box(n * 0.5, 0.08, 0.05, 'white', y=0.9)]
    for i in range(n):
        ps.append(box(0.12, 1.1, 0.04, 'white', x=-n * 0.25 + 0.25 + i * 0.5, z=0.04))
    return ps


def chain_fence():
    ps = [cyl(0.05, 2.2, 'steel', 5, x=-2), cyl(0.05, 2.2, 'steel', 5, x=2), box(4, 0.05, 0.05, 'steel', y=2.15)]
    ps.append(box(4, 2.1, 0.02, 'darksteel', y=0.05))
    return ps


def billboard():
    return [box(0.3, 5, 0.3, 'darkwood', x=-3), box(0.3, 5, 0.3, 'darkwood', x=3), box(8, 3.5, 0.25, 'cream', y=4.5),
            box(7.2, 1.0, 0.27, 'red', y=6.6), box(3.0, 1.4, 0.27, 'sky', x=-1.8, y=5.0)]


def mailbox():
    return [cyl(0.05, 1.0, 'darkwood', 5), box(0.3, 0.3, 0.5, 'navy', y=1.0)]


def car(body, roof=None, kind='sedan'):
    roof = roof or body
    L, W = (5.2, 2.0) if kind != 'wagon' else (5.4, 2.0)
    ps = [box(W, 0.7, L, body, y=0.45), box(W - 0.05, 0.12, L + 0.1, 'chrome', y=0.4)]
    if kind == 'pickup':
        ps += [box(W - 0.1, 0.75, 1.8, roof, y=1.15, z=-0.6), box(W - 0.06, 0.55, 0.05, 'glass', y=1.25, z=-1.5)]
        ps += [box(0.1, 0.5, 2.4, body, x=W / 2 - 0.05, y=1.15, z=1.4), box(0.1, 0.5, 2.4, body, x=-W / 2 + 0.05, y=1.15, z=1.4), box(W, 0.5, 0.1, body, y=1.15, z=2.6)]
    else:
        rl = 2.4 if kind == 'sedan' else 3.6
        rz = 0.2 if kind == 'sedan' else 0.7
        ps += [box(W - 0.2, 0.7, rl, roof, y=1.15, z=rz), box(W - 0.16, 0.5, rl - 0.4, 'glass', y=1.2, z=rz)]
        # tail fins
        ps += [box(0.15, 0.3, 1.2, body, x=W / 2 - 0.1, y=1.1, z=L / 2 - 0.6), box(0.15, 0.3, 1.2, body, x=-W / 2 + 0.1, y=1.1, z=L / 2 - 0.6)]
    ps += [box(1.6, 0.25, 0.1, 'chrome', y=0.55, z=-L / 2 - 0.05)]
    for x in (-W / 2 - 0.02, W / 2 - 0.23):
        for z in (-L / 2 + 0.9, L / 2 - 0.9):
            ps.append(wheel(0.38, 0.25, 'tire', x, 0.38, z))
    for x in (-0.6, 0.6):
        ps.append(box(0.3, 0.2, 0.05, 'lamp', x=x, y=0.75, z=-L / 2 - 0.03))
    return ps


def bus():
    L, W = 11.0, 2.5
    ps = [box(W, 2.6, L, 'yellow', y=0.6), box(W + 0.02, 0.15, L, 'black', y=1.4), box(W - 0.1, 0.25, L - 0.4, 'white', y=3.2)]
    for side in (-1, 1):
        for i in range(8):
            ps.append(box(0.05, 0.8, 0.9, 'glass', x=side * (W / 2 + 0.01), y=2.0, z=-L / 2 + 1.6 + i * 1.15))
    ps.append(box(2.2, 1.0, 0.05, 'glass', y=2.0, z=-L / 2 - 0.02))
    ps.append(box(W - 0.2, 1.0, 1.6, 'yellow', y=0.6, z=-L / 2 - 0.8))
    for x in (-W / 2 - 0.02, W / 2 - 0.3):
        for z in (-L / 2 + 1.0, L / 2 - 2.0):
            ps.append(wheel(0.55, 0.3, 'tire', x, 0.55, z))
    return ps


def army_truck(cover='canvas', body='olive'):
    L, W = 7.5, 2.4
    ps = [box(W, 0.4, L, 'darksteel', y=0.7), box(W, 1.4, 2.0, body, y=1.1, z=-L / 2 + 1.0), box(W - 0.3, 0.6, 0.05, 'glass', y=1.9, z=-L / 2 + 0.0),
          box(W - 0.4, 1.0, 1.2, body, y=0.7, z=-L / 2 - 0.4)]
    ps.append(box(W, 0.5, 5.0, body, y=1.1, z=1.2))
    if cover:
        ps.append(cyl(1.3, 5.0, cover, 10, r2=1.3).rx(math.pi / 2).scale(0.95, 1, 1).at(0, 1.6, -1.3))
    for x in (-W / 2 - 0.02, W / 2 - 0.32):
        for z in (-L / 2 + 0.6, L / 2 - 2.0, L / 2 - 0.8):
            ps.append(wheel(0.55, 0.32, 'tire', x, 0.55, z))
    ps.append(box(0.5, 0.5, 0.05, 'white', x=0.0, y=1.4, z=-L / 2 - 1.01))
    return ps


def jeep():
    """SEAS field jeep (a unit: party colour stripes)"""
    L, W = 3.6, 1.7
    ps = [box(W, 0.6, L, 'seas', y=0.45), box(W - 0.05, 0.2, L - 0.2, 'party', y=1.05), box(W - 0.2, 0.55, 1.1, 'seas', y=0.45, z=-L / 2 - 0.3),
          box(W, 0.6, 0.05, 'glass', y=1.25, z=-0.4), box(W, 0.06, 0.06, 'seasdark', y=1.85, z=-0.4)]
    ps.append(beam((0, 1.05, 0.6), (0, 1.9, 0.6), 0.06, 'darksteel'))
    ps.append(box(0.15, 0.15, 1.4, 'darksteel', y=1.9, z=0.0))                             # mounted gun
    ps.append(cyl(0.3, 0.12, 'tire', 10).rx(math.pi / 2).at(0, 1.0, L / 2 + 0.06))           # spare wheel
    for x in (-W / 2 - 0.05, W / 2 - 0.2):
        for z in (-L / 2 + 0.6, L / 2 - 0.6):
            ps.append(wheel(0.42, 0.25, 'tire', x, 0.42, z))
    return ps


def capture_truck():
    """SEAS capture truck: flatbed with a winch and a cage"""
    L, W = 7.0, 2.5
    ps = [box(W, 0.5, L, 'seasdark', y=0.7), box(W, 1.5, 2.0, 'seas', y=1.2, z=-L / 2 + 1.0), box(W - 0.3, 0.6, 0.05, 'glass', y=2.0, z=-L / 2 - 0.01),
          box(W, 0.3, 2.0, 'party', y=2.7, z=-L / 2 + 1.0)]
    for x in (-W / 2 + 0.1, W / 2 - 0.1):
        for z in (0.5, 1.7, 2.9):
            ps.append(box(0.08, 2.0, 0.08, 'steel', x=x, y=1.2, z=z))
        ps.append(box(0.08, 0.08, 2.5, 'steel', x=x, y=3.2, z=1.7))
    for z in (0.5, 2.9):
        ps.append(box(W - 0.2, 0.08, 0.08, 'steel', y=3.2, z=z))
    ps.append(cyl(0.35, 1.2, 'yellow', 8).rz(math.pi / 2).at(0.6, 1.6, -0.3))
    for x in (-W / 2 - 0.02, W / 2 - 0.32):
        for z in (-L / 2 + 0.7, L / 2 - 1.4, L / 2 - 0.5):
            ps.append(wheel(0.55, 0.32, 'tire', x, 0.55, z))
    return ps


def aa_halftrack():
    L, W = 6.0, 2.3
    ps = [box(W, 1.2, L, 'seas', y=0.6), box(W + 0.02, 0.2, L, 'party', y=1.4), box(W - 0.4, 0.8, 1.4, 'seas', y=1.8, z=-L / 2 + 0.9)]
    ps.append(box(0.4, 1.0, 0.05, 'glass', x=0.4, y=2.0, z=-L / 2 + 0.18))
    # tracks
    for x in (-W / 2 - 0.15, W / 2 + 0.15):
        ps.append(box(0.35, 0.8, 3.5, 'tire', x=x, z=1.0))
    for x in (-W / 2 - 0.02, W / 2 - 0.3):
        ps.append(wheel(0.45, 0.3, 'tire', x, 0.45, -L / 2 + 0.8))
    # quad AA mount
    ps.append(cyl(0.8, 0.4, 'seasdark', 10, y=1.8, z=1.2))
    for dx in (-0.35, 0.35):
        for dy in (0.0, 0.35):
            ps.append(beam((dx, 2.4 + dy, 1.2), (dx, 3.6 + dy, -0.4), 0.06, 'darksteel'))
    ps.append(box(1.2, 0.6, 0.6, 'seasdark', y=2.2, z=1.3))
    return ps


def fuel_tanker():
    L, W = 8.0, 2.4
    ps = [box(W, 0.4, L, 'darksteel', y=0.7), box(W, 1.6, 2.0, 'red', y=1.1, z=-L / 2 + 1.0), box(W - 0.3, 0.6, 0.05, 'glass', y=2.0, z=-L / 2 - 0.01),
          cyl(1.2, 5.5, 'chrome', 14).rx(math.pi / 2).at(0, 2.3, -1.4)]
    for x in (-W / 2 - 0.02, W / 2 - 0.32):
        for z in (-L / 2 + 0.7, L / 2 - 1.8, L / 2 - 0.6):
            ps.append(wheel(0.55, 0.32, 'tire', x, 0.55, z))
    return ps


# ------------------------------------------------------------------------------------------------ military, industry
def quonset(L=20.0):
    ps = [cyl(6.0, L, 'steel', 16, cap=False).rx(math.pi / 2).at(0, 0, -L / 2)]
    ps = [Part(p.v[:, :] * [1, 1, 1], p.t, p.mat) for p in ps]
    # keep the upper half: squash the lower half flat at y = 0
    p = ps[0]
    p.v[:, 1] = np.maximum(p.v[:, 1], 0)
    ps.append(box(12, 0.2, L + 0.4, 'concrete'))
    for z in (-L / 2, L / 2):
        ps.append(Part([(math.cos(a) * 6, max(0, math.sin(a) * 6), z) for a in np.linspace(0, math.pi, 13)] + [(0, 0, z)],
                       [(13, i, i + 1) if z > 0 else (13, i + 1, i) for i in range(12)], 'darksteel'))
    ps.append(box(5, 4, 0.1, 'olive', z=-L / 2 - 0.05))
    return ps


def tent():
    return [box(5, 0.05, 6, 'canvas'), gable(5, 3.0, 6, 'olive', over=0.1).ry(math.pi / 2), cyl(0.06, 3.0, 'darkwood', 4, z=-2.9), cyl(0.06, 3.0, 'darkwood', 4, z=2.9)]


def sandbags(n=6):
    ps = []
    for row in range(3):
        for i in range(n - (row % 2)):
            ps.append(box(0.9, 0.35, 0.5, 'sandbag', x=-n * 0.45 + 0.45 + i * 0.9 + (row % 2) * 0.45, y=row * 0.33))
    return ps


def barricade():
    return [box(3.0, 0.3, 0.1, 'white', y=0.8), box(3.0, 0.3, 0.11, 'red', y=0.8, x=0.0).scale(0.33, 1, 1), box(0.1, 1.1, 0.6, 'white', x=-1.3),
            box(0.1, 1.1, 0.6, 'white', x=1.3)]


def radar():
    ps = [box(4, 3, 4, 'seas'), cyl(0.4, 3, 'darksteel', 8, y=3)]
    dish = sphere(3.0, 'chrome', 14, 8, half=True).scale(1, 0.35, 1).rx(-1.1).at(0, 6.5, 0)
    ps.append(dish)
    ps.append(beam((0, 6.2, 0), (0, 7.5, -1.6), 0.07, 'darksteel'))
    return ps


def searchlight_tower():
    ps = []
    for sx in (-1, 1):
        for sz in (-1, 1):
            ps.append(beam((sx * 1.6, 0, sz * 1.6), (sx * 1.0, 8, sz * 1.0), 0.12, 'seasdark', 4))
    ps += [box(3.0, 0.3, 3.0, 'seasdark', y=8), box(3.0, 1.0, 0.08, 'seas', y=8.3, z=-1.5), box(3.0, 1.0, 0.08, 'seas', y=8.3, z=1.5),
           box(0.08, 1.0, 3.0, 'seas', x=-1.5, y=8.3), box(0.08, 1.0, 3.0, 'seas', x=1.5, y=8.3)]
    ps.append(cyl(0.7, 1.1, 'darksteel', 12).rx(math.pi / 2 - 0.25).at(0, 9.3, 0.4))
    ps.append(cyl(0.62, 0.05, 'lamp', 12).rx(math.pi / 2 - 0.25).at(0, 9.03, -0.68))
    ps.append(box(0.5, 0.5, 0.5, 'party', y=8.3, x=1.0, z=1.0))
    return ps


def flak():
    ps = [cyl(3.0, 1.0, 'sandbag', 14), cyl(1.0, 1.2, 'seasdark', 10, y=1.0)]
    for dx in (-0.3, 0.3):
        ps.append(beam((dx, 2.0, 0.0), (dx, 4.2, -1.8), 0.1, 'darksteel'))
    ps.append(box(1.4, 0.8, 1.0, 'seas', y=1.8))
    ps.append(box(1.6, 0.2, 1.1, 'party', y=2.6))
    return ps


def watchtower():
    ps = []
    for sx in (-1, 1):
        for sz in (-1, 1):
            ps.append(cyl(0.15, 7, 'wood', 5, x=sx * 1.5, z=sz * 1.5))
    ps += [box(4, 0.3, 4, 'wood', y=7), box(4, 1.0, 0.1, 'wood', y=7.3, z=-2), box(4, 1.0, 0.1, 'wood', y=7.3, z=2),
           box(0.1, 1.0, 4, 'wood', x=-2, y=7.3), box(0.1, 1.0, 4, 'wood', x=2, y=7.3), hip(4.6, 1.6, 4.6, 'shingle', y=9.6, over=0.1)]
    for sx in (-1, 1):
        for sz in (-1, 1):
            ps.append(cyl(0.08, 2.3, 'wood', 4, x=sx * 1.9, y=7.3, z=sz * 1.9))
    return ps


def checkpoint():
    return [box(2.2, 2.6, 2.2, 'white'), box(2.4, 0.2, 2.4, 'red', y=2.6), box(1.8, 0.8, 0.05, 'glass', y=1.3, z=-1.12),
            box(0.3, 1.0, 0.3, 'red', x=2.0), box(6.0, 0.15, 0.15, 'white', x=5.0, y=1.0)]


def drums(n=4):
    ps = []
    for i in range(n):
        ps.append(cyl(0.3, 0.9, ['red', 'olive', 'steel', 'yellow'][i % 4], 10, x=(i % 2) * 0.65, z=(i // 2) * 0.65))
    return ps


def crates():
    return [box(1.2, 1.2, 1.2, 'wood'), box(1.2, 1.2, 1.2, 'wood', x=1.25), box(1.0, 1.0, 1.0, 'darkwood', x=0.6, y=1.2)]


def power_station():
    ps = [box(30, 12, 16, 'concrete'), box(30.4, 0.6, 16.4, 'darksteel', y=12)]
    for i in range(6):
        ps.append(box(2.0, 6.0, 0.1, 'glass', x=-12.5 + i * 5, y=4, z=-8.05))
    for x in (-8, 0, 8):
        ps.append(cyl(1.4, 14, 'brick', 12, x=x, y=12, z=4))
    # transformer yard
    for x in (-10, -4, 2, 8):
        ps.append(box(2.5, 3, 2, 'darksteel', x=x, z=-14))
        for dx in (-0.8, 0, 0.8):
            ps.append(cyl(0.12, 1.2, 'glass', 6, x=x + dx, y=3, z=-14))
    return ps


def dam_section():
    """a piece of a concrete gravity dam, 40 m wide, 30 m high"""
    ps = [Part([(-20, 0, -10), (20, 0, -10), (20, 0, 6), (-20, 0, 6), (-20, 30, -1), (20, 30, -1), (20, 30, 3), (-20, 30, 3)],
               [(0, 1, 2), (0, 2, 3), (4, 7, 6), (4, 6, 5), (0, 4, 5), (0, 5, 1), (1, 5, 6), (1, 6, 2), (2, 6, 7), (2, 7, 3), (3, 7, 4), (3, 4, 0)], 'concrete')]
    ps.append(box(40, 1.2, 0.4, 'concrete', y=30, z=-1.0))
    ps.append(box(40, 1.2, 0.4, 'concrete', y=30, z=3.0))
    for x in (-15, -5, 5, 15):
        ps.append(street_lamp_part(x, 30, 3.2))
    return ps


def street_lamp_part(x, y, z):
    p = cyl(0.1, 4, 'darksteel', 5, x=x, y=y, z=z)
    return p


def rocket_body():
    ps = [cyl(2.0, 30, 'white', 16, y=4), cyl(2.0, 6, 'white', 16, r2=0.0, y=34), cyl(2.0, 2, 'black', 16, y=12), cyl(2.0, 1.5, 'black', 16, y=24)]
    for a in range(4):
        ps.append(box(0.2, 5, 2.5, 'red', y=4, z=2.6).ry(a * math.pi / 2))
    ps.append(cyl(1.6, 4, 'darksteel', 12, r2=2.0))
    return ps


def rocket(with_body=True):
    ps = rocket_body() if with_body else []
    ps.append(box(14, 0.6, 14, 'concrete'))
    # gantry
    for sx in (-1, 1):
        for sz in (-1, 1):
            ps.append(beam((8 + sx * 2, 2, sz * 2), (8 + sx * 2, 40, sz * 2), 0.25, 'red', 4))
    for y in range(4, 40, 4):
        ps.append(box(4.4, 0.2, 4.4, 'red', x=8, y=y))
        ps.append(box(3.6, 0.2, 0.4, 'steel', x=4.4, y=y))
    return ps


# ------------------------------------------------------------------------------------------------ rifts and SEAS machines
def rift():
    """a tear between the worlds: a standing ring of light over scorched ground"""
    ps = [cyl(9.0, 0.08, 'black', 24), cyl(6.5, 0.1, 'rust', 20, y=0.02)]
    for i in range(14):
        a0, a1 = i * 2 * math.pi / 14, (i + 1) * 2 * math.pi / 14
        p = lambda a, r: (r * math.cos(a), 6 + r * math.sin(a) * 1.25, 0)
        ps.append(beam(p(a0, 4.5), p(a1, 4.5), 0.45, 'riftglow', 6))
    disk = cyl(4.2, 0.1, 'riftcore', 18).rx(math.pi / 2).scale(1, 1.25, 1).at(0, 6, 0.05)
    ps.append(disk)
    for a in np.linspace(0, 2 * math.pi, 9)[:-1]:
        ps.append(box(0.8, 1.4, 1.2, 'darkwood', x=7.5 * math.cos(a), z=7.5 * math.sin(a)).ry(a))
    return ps


def stabilizer():
    """Taslov's rift stabilizer: a coil tower on a tracked base"""
    ps = [box(6, 1.2, 6, 'seasdark'), box(6.1, 0.3, 6.1, 'party', y=1.2), cyl(1.6, 2.0, 'seas', 12, y=1.5), cyl(0.8, 7.0, 'copper', 12, y=3.5)]
    for y in np.arange(4.0, 10.0, 0.8):
        ps.append(cyl(1.1, 0.25, 'copper', 14, y=float(y)))
    ps.append(sphere(1.6, 'chrome', 14, 8, y=11.5))
    ps.append(sphere(0.6, 'coilglow', 10, 6, y=11.5))
    for a in range(3):
        aa = a * 2 * math.pi / 3
        ps.append(beam((2.6 * math.cos(aa), 1.2, 2.6 * math.sin(aa)), (0.9 * math.cos(aa), 9.0, 0.9 * math.sin(aa)), 0.12, 'seasdark', 5))
    return ps


def electric_net():
    """Taslov's electrified net trap: four poles and a net"""
    ps = []
    for sx in (-1, 1):
        for sz in (-1, 1):
            ps.append(cyl(0.18, 4.0, 'seasdark', 6, x=sx * 6, z=sz * 6))
            ps.append(sphere(0.35, 'coilglow', 8, 5, x=sx * 6, y=4.1, z=sz * 6))
    for i in range(7):
        t = -6 + i * 2
        ps.append(beam((t, 0.15, -6), (t, 0.15, 6), 0.04, 'steel', 4))
        ps.append(beam((-6, 0.15, t), (6, 0.15, t), 0.04, 'steel', 4))
    ps.append(box(1.2, 1.0, 0.8, 'seas', x=7.5))
    return ps


def pen():
    """a containment pen: concrete posts, steel rails"""
    ps = []
    R = 12
    n = 16
    for i in range(n):
        a = 2 * math.pi * i / n
        x, z = R * math.cos(a), R * math.sin(a)
        if i in (0,):
            continue
        ps.append(box(0.6, 3.5, 0.6, 'concrete', x=x, z=z))
        a2 = 2 * math.pi * (i + 1) / n
        if i + 1 != n:
            for y in (1.0, 2.0, 3.0):
                ps.append(beam((x, y, z), (R * math.cos(a2), y, R * math.sin(a2)), 0.08, 'steel', 4))
    ps.append(box(3, 2.8, 2.5, 'seas', x=R + 3, z=0))
    return ps


def field_hq():
    """SEAS mobile command post: trailer, antenna, flag"""
    ps = [box(10, 3.2, 3.2, 'seas', y=0.6), box(10.05, 0.4, 3.25, 'party', y=2.6), box(0.4, 0.6, 3.0, 'darksteel', x=-5.2, y=0.3)]
    for x in (-3, 3.5):
        for z in (-1.75, 1.45):
            ps.append(cyl(0.55, 0.3, 'tire', 10).rx(math.pi / 2).at(x, 0.55, z + 0.3))
    ps.append(cyl(0.06, 9, 'steel', 5, x=4, y=3.8, z=1.0))
    ps.append(beam((-4, 3.8, 1.2), (-4, 7.8, 1.2), 0.05, 'steel', 4))
    ps.append(box(1.2, 0.8, 0.03, 'party', x=-3.4, y=7.0, z=1.2))
    ps.append(box(3, 2.2, 0.1, 'glass', x=-0.5, y=1.6, z=-1.62))
    return ps


def gate_machine():
    """Taslov's Gate machine: three stabilizer coils around a ring, on a concrete pad"""
    ps = [cyl(16, 1.0, 'concrete', 24), cyl(15.6, 0.3, 'party', 24, y=1.0)]
    for a in range(3):
        aa = a * 2 * math.pi / 3
        for p in stabilizer():
            q = Part(p.v.copy(), p.t, p.mat).scale(1.3).at(10 * math.cos(aa), 1.0, 10 * math.sin(aa))
            ps.append(q)
    for i in range(16):
        a0, a1 = i * 2 * math.pi / 16, (i + 1) * 2 * math.pi / 16
        ps.append(beam((6 * math.cos(a0), 9 + 6 * math.sin(a0), 0), (6 * math.cos(a1), 9 + 6 * math.sin(a1), 0), 0.55, 'copper', 6))
    ps.append(box(1.2, 4, 1.2, 'seasdark', x=-6.5, y=1.0))
    ps.append(box(1.2, 4, 1.2, 'seasdark', x=6.5, y=1.0))
    ps.append(cyl(5.4, 0.12, 'coilglow', 18).rx(math.pi / 2).at(0, 9, 0.05))
    return ps


# ------------------------------------------------------------------------------------------------ catalogue
WALLS = {'white': 'roofgreen', 'mint': 'roofred', 'pink': 'shingle', 'sky': 'roofblue', 'butter': 'roofred', 'sage': 'shingle', 'cream': 'roofblue'}
CARS = {'cherry': 'white', 'aqua': 'white', 'butter': 'white', 'navy': 'cream', 'sage': 'cream', 'pink': 'white'}

# name -> (builder, kind): kind decides the manifest entry (prop = landscape object, unit = moving machine, building)
CATALOGUE = {}
for i, (w, r) in enumerate(WALLS.items()):
    CATALOGUE[f'sq_house_ranch_{w}'] = (lambda w=w, r=r: house_ranch(w, r), 'prop')
    CATALOGUE[f'sq_house_two_{w}'] = (lambda w=w, r=r: house_two(w, r), 'prop')
for i, (b, r) in enumerate(CARS.items()):
    CATALOGUE[f'sq_car_sedan_{b}'] = (lambda b=b, r=r: car(b, r, 'sedan'), 'prop')
    CATALOGUE[f'sq_car_wagon_{b}'] = (lambda b=b, r=r: car(b, r, 'wagon'), 'prop')
    CATALOGUE[f'sq_car_pickup_{b}'] = (lambda b=b, r=r: car(b, r, 'pickup'), 'prop')
CATALOGUE.update({
    'sq_diner': (diner, 'prop'), 'sq_gas_station': (gas_station, 'prop'), 'sq_barn': (barn, 'prop'), 'sq_silo': (silo, 'prop'),
    'sq_water_tower': (water_tower, 'prop'), 'sq_telephone_pole': (telephone_pole, 'prop'), 'sq_pylon': (pylon, 'prop'),
    'sq_street_lamp': (street_lamp, 'prop'), 'sq_picket_fence': (picket_fence, 'prop'), 'sq_chain_fence': (chain_fence, 'prop'),
    'sq_billboard': (billboard, 'prop'), 'sq_mailbox': (mailbox, 'prop'), 'sq_bus': (bus, 'prop'), 'sq_army_truck': (army_truck, 'prop'),
    'sq_fuel_tanker': (fuel_tanker, 'prop'), 'sq_quonset': (quonset, 'prop'), 'sq_tent': (tent, 'prop'), 'sq_sandbags': (sandbags, 'prop'),
    'sq_barricade': (barricade, 'prop'), 'sq_watchtower': (watchtower, 'prop'), 'sq_checkpoint': (checkpoint, 'prop'),
    'sq_drums': (drums, 'prop'), 'sq_crates': (crates, 'prop'), 'sq_power_station': (power_station, 'prop'), 'sq_dam': (dam_section, 'prop'),
    'sq_rocket': (rocket, 'prop'), 'sq_rift': (rift, 'prop'), 'sq_pen': (pen, 'prop'),
    # SEAS machines and structures of the sequel (units and buildings: game/sequel/rules.js)
    'sq_jeep': (jeep, 'unit'), 'sq_capture_truck': (capture_truck, 'unit'), 'sq_aa_halftrack': (aa_halftrack, 'unit'),
    'sq_stabilizer': (stabilizer, 'building'), 'sq_searchlight': (searchlight_tower, 'building'), 'sq_flak': (flak, 'building'),
    'sq_radar': (radar, 'building'), 'sq_field_hq': (field_hq, 'building'), 'sq_electric_net': (electric_net, 'building'),
    'sq_gate_machine': (gate_machine, 'building'), 'sq_power_station_b': (power_station, 'building'), 'sq_launch_pad': (lambda: rocket(False), 'building'),
    'sq_rocket_body': (rocket_body, 'prop'),
    'sq_rift_b': (rift, 'building'),
})


def build(data_dir, only=None):
    out = os.path.join(data_dir, 'assets', 'models')
    os.makedirs(out, exist_ok=True)
    man_path = os.path.join(data_dir, 'assets', 'manifest.json')
    man = json.load(open(man_path))
    for name, (fn, kind) in CATALOGUE.items():
        if only and name not in only:
            continue
        lo, hi = write_glb(os.path.join(out, name + '.glb'), fn(), {'fourcc': 'Sqel', 'kind': kind})
        cx, cz = float(lo[0] + hi[0]) / 2, float(lo[2] + hi[2]) / 2
        e = {'arch': 'sequel', 'anims': None, 'foliage': False, 'nanims': 0, 'speeds': {}, 'sequel': kind,
             'size': [round(float(hi[0] - lo[0]), 2), round(float(hi[1] - lo[1]), 2), round(float(hi[2] - lo[2]), 2)]}
        if kind == 'building':
            e['foot'] = [round(cx, 2), round(cz, 2), round(float(hi[0] - lo[0]) / 2, 2), round(float(hi[2] - lo[2]) / 2, 2)]
        man['models'][name] = e
    json.dump(man, open(man_path, 'w'), separators=(',', ':'))
    return len(CATALOGUE)


def run(log=print, progress=None):
    from . import paths
    n = build(paths.OUT)
    log('sequel campaign: %d models' % n)


if __name__ == '__main__':
    n = build(sys.argv[1], set(sys.argv[2:]) or None)
    print(f'{n} sequel models')
