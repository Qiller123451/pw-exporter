"""Forest blocks: the trees a map stores as blocks of forest instead of as placed objects (docs/MAP_FORMAT.md).

The level editor's forest mode (Alt+F) marks 32 m squares of the map as forest. The map keeps one small record per
square in the `Frst` chunk; where the trees of a square stand is not in the map at all - the engine has 32 fixed
layouts ("patterns") of 31 spots each built into PWServer.exe / PWClient.exe and picks one per square from the
square's position. The toolkit reads that table from the game's own program file (it ships no game data).

    Frst chunk   u32 width, u32 height        squares of 32 m (map size / 32, rounded down)
                 records, sorted by square    u32 index (= y * width + x), 32 bytes
                 u32 0xffffffff               end
    record       byte 0        unused (0)
                 bytes 1..15   the 15 trees of the square
                 bytes 16..31  the 16 undergrowth plants of the square
    item byte    bits 0-4  amount (6..30; lower towards a side where the forest ends; the client only tests > 0)
                 bits 5-6  state: 2 standing, 1 stump (trees only), 0 gone

    pattern      u32 31, f32 x[31], f32 y[31]   position inside the square (metres)
                 f32 size[31]                    2..5; the editor stores floor(size * 6.2) as the amount
                 i32 random[31]                  tree kind = (random >> 1) % 5, tree heading = -((random >> 4) & 7) * 45 deg
                                                 undergrowth kind = random & 7
                 i32 edge[31]                    0 inside, 1..4 = near one side of the square
    pattern of square (x, y) = table word[(2317 * y + 13 * x) % 4992] & 31   (the table read as 4992 words)

The kinds are the setting's Forest_<Setting>.txt (Scripts/Server/classes/vegetation): Tree0..4 with the standing
model, stump, timber and fall animation, Deco0..7 for the undergrowth. Nothing stands below 16 m (the water level):
the server removes those trees when it loads the map and the client draws neither trees nor undergrowth there.
A worker chops a forest tree like any tree; it then becomes a `<Setting>_Tree_0N_Timber` object.
"""
import math
import os
import struct

import numpy as np

from . import tree as ptree

CELL = 32.0                  # metres per forest square
TREES, ITEMS = 15, 31        # the first 15 spots of a pattern are trees, the other 16 undergrowth
PATTERNS, PSIZE = 32, 624    # 32 patterns of 624 bytes
MIN_HEIGHT = 16.0            # nothing below the water level (hard-coded in the engine)
FILES = {'TestSet': 'Test'}  # setting -> Forest_<name>.txt where the names differ

_cache = {}


class Patterns:
    def __init__(self, raw):
        self.raw = raw
        self.words = np.frombuffer(raw, '<u4')
        f = np.frombuffer(raw, '<f4').reshape(PATTERNS, PSIZE // 4)
        self.x, self.y, self.size = f[:, 1:32], f[:, 32:63], f[:, 63:94]
        w = self.words.reshape(PATTERNS, PSIZE // 4)
        self.random, self.edge = w[:, 94:125], w[:, 125:156]

    def of(self, cx, cy):
        """index of the pattern the engine uses for square (cx, cy)"""
        return int(self.words[(2317 * cy + 13 * cx) % len(self.words)] & 31)


def find_patterns(data):
    """the pattern table inside a program file: 32 records of 624 bytes that each start with the count 31 and hold
    positions inside a 32 m square -> bytes or None"""
    key, n = b'\x1f\x00\x00\x00', PATTERNS * PSIZE
    at = data.find(key)
    while at >= 0:
        if at + n <= len(data) and all(data[at + k * PSIZE:at + k * PSIZE + 4] == key for k in range(PATTERNS)):
            f = np.frombuffer(data, '<f4', n // 4, at).reshape(PATTERNS, PSIZE // 4)
            xy = f[:, 1:63]
            if np.isfinite(xy).all() and xy.min() >= 0 and xy.max() <= CELL:
                return data[at:at + n]
        at = data.find(key, at + 1)
    return None


def program_files(install):
    """the game's program files that hold the pattern table (server first)"""
    out = []
    for d in ('bin', 'Bin', ''):
        p = os.path.join(install.root, d)
        if not os.path.isdir(p):
            continue
        names = {e.lower(): e for e in os.listdir(p)}
        for want in ('pwserver.exe', 'pwclient.exe'):
            if want in names and os.path.join(p, names[want]) not in out:
                out.append(os.path.join(p, names[want]))
    return out


def patterns(install):
    """the engine's forest patterns, read from the game's PWServer.exe / PWClient.exe (None when not found)"""
    key = ('pat', install.root)
    if key not in _cache:
        found = None
        for p in program_files(install):
            try:
                with open(p, 'rb') as f:
                    raw = find_patterns(f.read())
            except OSError:
                raw = None
            if raw:
                found = Patterns(raw)
                break
        _cache[key] = found
    return _cache[key]


def blocks(data):
    """the Frst chunk -> {'w', 'h' (squares), 'blocks': [(x, y, 31 item bytes)]}"""
    if not data or len(data) < 12:
        return {'w': 0, 'h': 0, 'blocks': []}
    w, h = struct.unpack_from('<II', data, 0)
    out, at = [], 8
    if not (0 < w <= 4096 and 0 < h <= 4096):
        return {'w': 0, 'h': 0, 'blocks': []}
    while at + 4 <= len(data):
        i = struct.unpack_from('<I', data, at)[0]
        at += 4
        if i == 0xffffffff or at + 32 > len(data):
            break
        if i < w * h:
            out.append((i % w, i // w, data[at + 1:at + 32]))
        at += 32
    return {'w': int(w), 'h': int(h), 'blocks': out}


def _vec(s):
    try:
        return [float(v) for v in str(s).strip('[] ').split()]
    except ValueError:
        return None


def config(install, setting):
    """Forest_<Setting>.txt -> {'trees': [{'standard', 'stump', 'timber', 'fall', 'size'} x 5], 'deco': [{'standard',
    'size'} x 8], 'fake': billboard texture}; missing kinds are None"""
    key = ('cfg', install.root, tuple(install.mods), setting)        # a mod may bring its own Forest_<Setting>.txt
    if key in _cache:
        return _cache[key]
    rel = 'Scripts/Server/classes/vegetation/Forest_%s.txt' % FILES.get(setting, setting)
    p = install.file(rel)
    cfg = {'setting': setting, 'trees': [None] * 5, 'deco': [None] * 8, 'fake': None}
    if p:
        with open(p, encoding='latin-1') as f:
            root = ptree.parse(f.read(), inherit=True).get('Root') or {}
        for k in range(5):
            t = root.get('Tree%d' % k)
            if isinstance(t, dict) and t.get('Standard'):
                cfg['trees'][k] = {'standard': t.get('Standard'), 'stump': t.get('Stump'), 'timber': t.get('Timber'),
                                   'fall': t.get('FallAnim'), 'size': _vec(t.get('Size'))}
        for k in range(8):
            t = root.get('Deco%d' % k)
            if isinstance(t, dict) and t.get('Standard'):
                cfg['deco'][k] = {'standard': t.get('Standard'), 'size': _vec(t.get('Size'))}
        cfg['fake'] = root.get('FakeTreeTexture')
    _cache[key] = cfg
    return cfg


def items(m, pat, deco=True, min_height=MIN_HEIGHT):
    """every tree (and undergrowth plant) of the map's forest blocks, where the game shows them:
    -> {'trees': [{'x', 'y', 'z', 'rot' (heading, radians CCW), 'kind' 0..4, 'amount', 'stump', 'block': (x, y), 'slot'}],
        'deco': [{'x', 'y', 'z', 'kind' 0..7}]}   (x east, y north, z up; metres, like the placed objects)"""
    out = {'trees': [], 'deco': []}
    if pat is None:
        return out
    for cx, cy, b in m.forest['blocks']:
        p = pat.of(cx, cy)
        px, py, rnd = pat.x[p], pat.y[p], pat.random[p]
        for i in range(ITEMS if deco else TREES):
            v = b[i]
            state = (v >> 5) & 3
            if state not in (2, 3) and not (state == 1 and i < TREES):
                continue
            x, y = cx * CELL + float(px[i]), cy * CELL + float(py[i])
            z = m.height_at(x, y)
            if z <= min_height:
                continue
            r = int(rnd[i])
            if i < TREES:
                if not v & 31:
                    continue
                out['trees'].append({'x': x, 'y': y, 'z': z, 'rot': -((r >> 4) & 7) * math.pi / 4, 'kind': ((r >> 1) & 0x3fffffff) % 5,
                                     'amount': v & 31, 'stump': state == 1, 'block': (cx, cy), 'slot': i})
            else:
                out['deco'].append({'x': x, 'y': y, 'z': z, 'kind': r & 7})
    return out


def objects(m, install, deco=False):
    """the forest as map objects (what mapexport and the viewer draw): trees [{'type': 'TREE', 'name', 'cls', 'gfx',
    'x', 'y', 'z', 'rot', 'quat', 'forest': True, ...}] and, with deco, the undergrowth (type 'VGTN')"""
    pat = patterns(install)
    if pat is None or not m.forest['blocks']:
        return []
    cfg = config(install, m.setting)
    it = items(m, pat, deco=deco)
    out = []
    for k, t in enumerate(it['trees']):
        c = cfg['trees'][t['kind']]
        if not c:
            continue
        name = c['stump'] if t['stump'] else c['standard']
        if not name:
            continue
        h = t['rot'] / 2.0
        out.append({'type': 'TREE', 'name': 'forest_%d' % k, 'cls': name, 'gfx': name, 'x': t['x'], 'y': t['y'], 'z': t['z'],
                    'rot': t['rot'], 'quat': (0.0, 0.0, -math.sin(h), math.cos(h)), 'owner': None, 'attr': {}, 'forest': True,
                    'amount': t['amount']})
    for k, t in enumerate(it['deco']):
        c = cfg['deco'][t['kind']]
        if not c:
            continue
        out.append({'type': 'VGTN', 'name': 'forest_deco_%d' % k, 'cls': c['standard'], 'gfx': c['standard'], 'x': t['x'], 'y': t['y'],
                    'z': t['z'], 'rot': 0.0, 'quat': (0.0, 0.0, 0.0, 1.0), 'owner': None, 'attr': {}, 'forest': True})
    return out


def summary(m, install):
    """counts for the map details: {'blocks', 'trees', 'deco', 'patterns': bool}"""
    pat = patterns(install)
    it = items(m, pat) if pat is not None else {'trees': [], 'deco': []}
    return {'blocks': len(m.forest['blocks']), 'trees': len(it['trees']), 'deco': len(it['deco']), 'patterns': pat is not None}


def main(argv=None):
    """python -m pwexport.forest <game folder> [expected.json]: the forest blocks of every map (counts); with a file
    name also the reference values of a few maps for remake/tests/forest_blocks.mjs"""
    import json
    import sys
    from . import ula
    from .install import Install
    argv = sys.argv[1:] if argv is None else argv
    inst = Install(argv[0])
    pat = patterns(inst)
    print('tree layouts: %s' % ('found in ' + os.path.basename(program_files(inst)[0]) if pat else 'NOT FOUND (bin/PWServer.exe, PWClient.exe)'))
    ref, total = {}, [0, 0, 0, 0]
    for e in inst.maps():
        try:
            m = ula.Map.load(e['path'])
        except Exception:
            continue
        if not m.forest['blocks']:
            continue
        it = items(m, pat)
        total = [total[0] + 1, total[1] + len(m.forest['blocks']), total[2] + len(it['trees']), total[3] + len(it['deco'])]
        print('%-58s %-10s %5d blocks %6d trees %6d undergrowth' % (e['pack'] + '/' + e['rel'], m.setting, len(m.forest['blocks']), len(it['trees']), len(it['deco'])))
        base = os.path.basename(e['rel']).lower()
        if len(argv) > 1 and base in ('ausbildungslager.ula', 'antarctica.ula', 'canyon.ula', 'berg.ula') and it['trees']:
            t = it['trees'][0]
            ref[base] = {'path': e['path'], 'blocks': len(m.forest['blocks']), 'trees': len(it['trees']), 'deco': len(it['deco']),
                         'sum': [sum(t['x'] for t in it['trees']), sum(t['y'] for t in it['trees'])], 'first': [t['x'], t['y'], t['kind'], t['rot']]}
    print('%d maps with forest blocks: %d blocks, %d trees, %d undergrowth plants' % tuple(total))
    if len(argv) > 1:
        with open(argv[1], 'w', encoding='utf-8') as f:
            json.dump(ref, f)


if __name__ == '__main__':
    main()
