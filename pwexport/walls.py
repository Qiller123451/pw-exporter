"""Walls on maps: which arms of each wall piece show (the engine's WallMap, docs/spec/walls.md of the remake).

A wall model (fourcc "Wall": hu_palisade, aje_clay_wall, seas_fence, ninigi_defense_skewer ...) is a hub post with
arms in 8 directions and several geometry variants of every piece. In a game only the arms towards connected
neighbours show, one variant each - drawn with every part, a wall looks like a row of stars.

    tags = arm_tags(gltf_json)            {mesh node name: (arm, variant, variant count)}  arm -1 = hub, 0..7 = E, NE ...
    kinds = wall_kinds(map, index)        {object index: 'wall' | 'gate' | 'tower'}
    layout = arms(map, index)             {object index: {'mask': bits 0..7, 'pick': [hub, arm 0..7]}}
    show(tag, mask, pick)                 does a part with that tag show on a piece with that mask / pick

Rules (as the remake's game/wallmap.js): pieces sit on an 8 m grid (tile centres at x, y = 4 mod 8 in map space) and
never rotate; a piece shows the arm towards a neighbour tile that holds a wall piece, a tower or a gate; two diagonal
neighbours only connect when neither tile of the corner between them is taken (no arm across an L corner). A gate
reaches over the tiles along its length: no arm into it unless there is a gap between the piece and the gate's end.
Variants: the hub by tile, every arm by the edge it shares with its neighbour, so both halves of a segment match.
"""
import math

import numpy as np

TILE = 8.0
# directions in map space (x east, y north): d x 45 degrees counter-clockwise from east, the arm bins of the models
DIRS = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]


def _hash(a, b):
    return (((a * 73856093) ^ (b * 19349663)) & 0xffffffff) % 9973


def _node_world(j):
    """world matrices of the nodes in the model's own (GSF, Z-up) space: the root's Z-up -> Y-up turn left out"""
    N = j['nodes']
    parent = {c: i for i, n in enumerate(N) for c in n.get('children', [])}
    root = j['scenes'][0]['nodes'][0]

    def local(n):
        M = np.eye(4)
        if 'matrix' in n:
            return np.array(n['matrix'], float).reshape(4, 4).T
        x, y, z, w = n.get('rotation', [0, 0, 0, 1])
        M[:3, :3] = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
        M[:3, :3] *= np.array(n.get('scale', [1, 1, 1]), float)
        M[:3, 3] = n.get('translation', [0, 0, 0])
        return M
    W = {}

    def w(i):
        if i not in W:
            W[i] = np.eye(4) if i == root else (w(parent[i]) @ local(N[i]) if i in parent else local(N[i]))
        return W[i]
    return {i: w(i) for i in range(len(N))}


def node_boxes(j):
    """[(node index, min, max)] of the mesh nodes with part flags, in the model's own (GSF, Z-up) space"""
    W = _node_world(j)
    out = []
    for i, n in enumerate(j['nodes']):
        if 'mesh' not in n or 'attr' not in (n.get('extras') or {}):
            continue
        mn, mx = np.full(3, 1e9), np.full(3, -1e9)
        for p in j['meshes'][n['mesh']]['primitives']:
            a = j['accessors'][p['attributes']['POSITION']]
            if 'min' not in a:
                continue
            lo, hi = np.array(a['min'], float), np.array(a['max'], float)
            corners = np.array([[x, y, z, 1] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])])
            P = corners @ W[i].T
            mn, mx = np.minimum(mn, P[:, :3].min(0)), np.maximum(mx, P[:, :3].max(0))
        if mn[0] <= mx[0]:
            out.append((i, mn, mx))
    return out


def arm_tags(j):
    """{mesh node name: (arm, variant, count)} of a wall model (assets.js tagWallArms in the remake)"""
    nodes = []
    for i, mn, mx in node_boxes(j):
        n = j['nodes'][i]
        c = (mn + mx) / 2
        arm = -1 if math.hypot(c[0], c[1]) < 1.2 else int(round(math.atan2(c[1], c[0]) / (math.pi / 4))) % 8
        r = lambda v: round(v * 2) / 2                     # noqa: E731
        key = (arm, (n['extras']['attr'] & 0xffffffff) >> 5, r(mn[0]), r(mn[1]), r(mx[0]), r(mx[1]))
        nodes.append((key, n.get('name'), mn, mx, arm))
    groups = {}
    for e in nodes:
        groups.setdefault(e[0], []).append(e)
    out = {}
    for g in groups.values():
        g.sort(key=lambda e: (e[3][2], e[2][2]))
        for k, e in enumerate(g):
            out[e[1]] = (e[4], k, len(g))
    return out


def is_wall_model(j, fourcc=None):
    """a wall piece model: fourcc Wall with parts in at least 4 arm directions"""
    fourcc = fourcc or ((j['nodes'][j['scenes'][0]['nodes'][0]].get('extras') or {}).get('fourcc', ''))
    if fourcc != 'Wall':
        return False
    return len({t[0] for t in arm_tags(j).values() if t[0] >= 0}) >= 4


def show(tag, mask, pick):
    """does a part with tag (arm, variant, count) show on a piece with this arm mask and variant pick"""
    if not tag:
        return True
    arm, var, cnt = tag
    if arm >= 0 and not (mask >> arm) & 1:
        return False
    if cnt > 1:
        return (pick[arm + 1] if pick else 0) % cnt == var
    return True


def wall_kinds(m, index, model_of):
    """{object index: 'wall' | 'gate' | 'tower'} and {object index: gate half length}"""
    from . import glb as glbmod
    kinds, spans, cache = {}, {}, {}
    for i, o in enumerate(m.objects):
        name = model_of(o)
        if not name:
            continue
        e = index.get(name)
        low = (o.get('cls') or '').lower()
        if e and e['fourcc'] == 'Wall':
            if name not in cache:
                try:
                    j, _ = glbmod.load(index.convert(name))
                except Exception:                        # noqa: BLE001
                    cache[name] = None
                    continue
                tags = arm_tags(j)
                boxes = node_boxes(j)
                half = max(max(abs(b[1][0]), abs(b[2][0])) for b in boxes) if boxes else 12.0
                cache[name] = ('wall' if len({t[0] for t in tags.values() if t[0] >= 0}) >= 4 and 'gate' not in low else 'gate', half)
            if cache[name]:
                kinds[i], spans[i] = cache[name]
        elif o['type'] == 'BLDG' and 'tower' in low:
            kinds[i] = 'tower'
    return kinds, spans


def tile_of(x, y):
    return int(round((x - 4) / TILE)), int(round((y - 4) / TILE))


def arms(m, index, model_of):
    """{object index: {'mask', 'pick'}} for every wall piece of the map"""
    kinds, spans = wall_kinds(m, index, model_of)
    taken = {}                                  # tile -> object index (walls and towers)
    gates = []
    for i, k in kinds.items():
        o = m.objects[i]
        if k == 'gate':
            gates.append(i)
        else:
            t = tile_of(o['x'], o['y'])
            if abs(o['x'] - (t[0] * TILE + 4)) < 1.5 and abs(o['y'] - (t[1] * TILE + 4)) < 1.5:
                taken.setdefault(t, i)
    gate_tiles = {}                             # tile -> gate index (tiles the gate's model reaches over)
    for gi in gates:
        g = m.objects[gi]
        a = g['rot']
        ax, ay = math.cos(a), math.sin(a)
        half = spans.get(gi, 12.0)
        t0 = tile_of(g['x'], g['y'])
        r = int(half / TILE) + 2
        for ti in range(t0[0] - r, t0[0] + r + 1):
            for tj in range(t0[1] - r, t0[1] + r + 1):
                dx, dy = ti * TILE + 4 - g['x'], tj * TILE + 4 - g['y']
                along, across = dx * ax + dy * ay, -dx * ay + dy * ax
                if abs(along) < half - 2 and abs(across) < 2:
                    gate_tiles[(ti, tj)] = gi

    def joint(t):
        return t in taken or t in gate_tiles
    out = {}
    for i, k in kinds.items():
        if k != 'wall':
            continue
        o = m.objects[i]
        ti, tj = tile_of(o['x'], o['y'])
        mask = 0
        for d, (di, dj) in enumerate(DIRS):
            n = (ti + di, tj + dj)
            if not joint(n):
                continue
            if d % 2 == 1 and (joint((ti + di, tj)) or joint((ti, tj + dj))):
                continue                        # L corner: the two straight arms make it
            if n in gate_tiles and n not in taken:
                g = m.objects[gate_tiles[n]]
                a = g['rot']
                along = abs((o['x'] - g['x']) * math.cos(a) + (o['y'] - g['y']) * math.sin(a))
                if along <= spans.get(gate_tiles[n], 12.0) + 1:
                    continue                    # the gate's end post stands on this piece: no arm into the gate
            mask |= 1 << d
        pick = [_hash(ti, tj)] + [_hash(2 * ti + di, 2 * tj + dj) for di, dj in DIRS]
        out[i] = {'mask': mask, 'pick': pick}
    return out
