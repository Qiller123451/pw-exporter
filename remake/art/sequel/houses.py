"""London's houses (the city of the opening film, hs_1000.bik): rows of town houses that differ from house to house -
their width, storeys, roof, front and colour - and the corner buildings of the blocks (art/sequel/kit.py; the front
looks along +y, a row's houses stand side by side along x).

The film's city (the flight over the roofs, 0 - 20 s): terraces of three to six storeys in cream and grey stucco,
Portland stone, yellow London stock brick and red brick; slate mansards with dormers, pitched roofs, flat roofs behind
parapets and balustrades with skylights, Dutch gables on the red brick mansions; shops on the ground floors; corner
buildings with a dome over a round corner, a turret, a long curve under glazed roofs, a cut corner under a pediment.
A row is either a terrace (houses of one kind built together: one front, a storey more here and there) or a street
that grew (every house its own).

    row(width, seed, mood, kind)   a row of houses `width` m long, 12 m deep (a block's edges are filled with rows of
                                   14, 21 and 28 m); the front wall at y = 6, the area railings 1.9 m in front of it
    corner(kind, seed)             a 14 x 14 m corner building, the corner at +x +y: 'dome', 'turret', 'curve',
                                   'chamfer'
Both return the pathfinder rectangles of the model (london.py).

Railings are bars and rails, balconies stand on brackets: no solid black panels. A row's houses share their party
walls (a wall is only built where a house stands higher than its neighbour); neighbouring houses with the same roof
at the same height share it."""
import math, random
import bmesh
from mathutils import Vector
from .kit import box, cyl, prism, paint, tex, _obj
from .london import LM, Face, sash, chimney, mansard, mansard_poly, dome

DEPTH = 12.0                 # a row's houses, front to back
CORNER = 14.0                # the corner buildings' square


# ------------------------------------------------------------------------------------------------ materials
def HM():
    """London's materials (london.LM) and the colours of the houses, shop fronts and doors"""
    m = LM()
    for name, tint in (('stucco_pink', (0.93, 0.82, 0.76)), ('stucco_ochre', (0.90, 0.80, 0.60)),
                       ('stucco_grey', (0.80, 0.81, 0.80)), ('stucco_blue', (0.80, 0.84, 0.88))):
        m[name] = tex(name, 'PaintedPlaster017', tint=tint, strength=0.7, scale=3.0, grime=0.45)
    m['brown_brick'] = tex('brown_brick', 'Bricks085', tint=(0.52, 0.38, 0.30), strength=0.5, scale=1.6, grime=0.35)
    for name, c in (('fascia_green', (0.10, 0.24, 0.16)), ('fascia_red', (0.40, 0.08, 0.07)), ('fascia_blue', (0.08, 0.12, 0.26)),
                    ('fascia_black', (0.07, 0.07, 0.07))):
        m[name] = paint(name, c, grime=0.1, rough=0.4)
    for name, c in (('awning_green', (0.20, 0.40, 0.24)), ('awning_red', (0.62, 0.18, 0.13)), ('awning_tan', (0.72, 0.60, 0.42))):
        m[name] = paint(name, c, grime=0.25)
    for name, c in (('door_black', (0.05, 0.05, 0.05)), ('door_blue', (0.08, 0.14, 0.30)), ('door_red', (0.42, 0.06, 0.05)),
                    ('door_green', (0.06, 0.20, 0.12))):
        m[name] = paint(name, c, grime=0.15, rough=0.35)
    m['board'] = paint('board', (0.86, 0.78, 0.55), grime=0.2)
    return m


DOORS = ('door_wood', 'door_black', 'door_blue', 'door_red', 'door_green')
FASCIAS = ('fascia_green', 'fascia_red', 'fascia_blue', 'fascia_black')
AWNINGS = ('awning_green', 'awning_red', 'awning_tan')
STUCCO = ('stucco', 'stucco_pink', 'stucco_ochre', 'stucco_grey', 'stucco_blue')


# ------------------------------------------------------------------------------------------------ geometry
def quad(pts, out, mat):
    """a face through four points, turned to look along `out`"""
    a, b, c = (Vector(p) for p in pts[:3])
    if (b - a).cross(c - a).dot(Vector(out)) < 0:
        pts = pts[::-1]
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(p) for p in pts])
    return _obj(bm, mat)


def offset(pts, g):
    """a convex polygon (counter-clockwise) grown by g (shrunk for g < 0)"""
    n = len(pts)
    lines = []
    for i in range(n):
        a, b = Vector((*pts[i], 0)), Vector((*pts[(i + 1) % n], 0))
        d = (b - a).normalized()
        lines.append((a + Vector((d.y, -d.x, 0)) * g, d))
    out = []
    for i in range(n):
        (p1, d1), (p2, d2) = lines[i - 1], lines[i]
        den = d1.x * d2.y - d1.y * d2.x
        if abs(den) < 1e-9:
            out.append((p2.x, p2.y))
            continue
        t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / den
        q = p1 + d1 * t
        out.append((q.x, q.y))
    return out


def extrude(pts, z0, z1, mat, top=True):
    """a prism over a polygon (counter-clockwise) from z0 to z1: its walls and its top (no bottom)"""
    bm = bmesh.new()
    a = [bm.verts.new((x, y, z0)) for x, y in pts]
    b = [bm.verts.new((x, y, z1)) for x, y in pts]
    n = len(pts)
    for i in range(n):
        bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    if top:
        bm.faces.new(b)
    return _obj(bm, mat)


def ring(pts, t, z0, z1, mat, cap=None):
    """a parapet round a polygon (counter-clockwise): t thick inwards from its edge, from z0 to z1; a coping on top"""
    def band(o, i, za, zb, m_, bottom=False):
        bm = bmesh.new()
        n = len(o)
        oa = [bm.verts.new((x, y, za)) for x, y in o]
        ob = [bm.verts.new((x, y, zb)) for x, y in o]
        ia = [bm.verts.new((x, y, za)) for x, y in i]
        ib = [bm.verts.new((x, y, zb)) for x, y in i]
        for k in range(n):
            j = (k + 1) % n
            bm.faces.new((oa[k], oa[j], ob[j], ob[k]))
            bm.faces.new((ib[k], ib[j], ia[j], ia[k]))
            bm.faces.new((ob[k], ob[j], ib[j], ib[k]))
            if bottom:
                bm.faces.new((ia[k], ia[j], oa[j], oa[k]))
        _obj(bm, m_)
    band(pts, offset(pts, -t), z0, z1, mat)
    if cap is not None:
        band(offset(pts, 0.08), offset(pts, -t - 0.08), z1, z1 + 0.12, cap, bottom=True)


def vault(o, r, half, h, z, glass, iron, n=12):
    """a glazed ridge roof along a quarter circle (radius r about (o, o)) from +x to +y: the glass, iron ribs"""
    bm = bmesh.new()
    rows = []
    for k in range(n + 1):
        a = math.pi / 2 * k / n
        ca, sa = math.cos(a), math.sin(a)
        rows.append([bm.verts.new((o + (r + dr) * ca, o + (r + dr) * sa, z + dz)) for dr, dz in ((-half, 0), (0, h), (half, 0))])
    for p, q in zip(rows, rows[1:]):
        bm.faces.new((p[0], q[0], q[1], p[1]))
        bm.faces.new((p[1], q[1], q[2], p[2]))
    for e in (rows[0], rows[-1]):
        bm.faces.new(e)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    _obj(bm, glass)
    for k in range(0, n + 1, 2):
        a = math.pi / 2 * k / n
        Face(a, 0, o + r * math.cos(a), o + r * math.sin(a)).gable(2 * half + 0.1, h + 0.05, 0.08, 0, -0.04, z, iron)


def spire(pts, z, h, mat):
    """a pointed roof over a polygon"""
    bm = bmesh.new()
    a = [bm.verts.new((x, y, z)) for x, y in pts]
    cx, cy = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
    t = bm.verts.new((cx, cy, z + h))
    for i in range(len(a)):
        bm.faces.new((a[i], a[(i + 1) % len(a)], t))
    return _obj(bm, mat, uvscale=2.2)


def hip(x0, x1, y0, y1, z, h, mat):
    """a hipped roof over the rectangle, its ridge along the longer side (a pyramid over a square)"""
    bm = bmesh.new()
    a = [bm.verts.new(p) for p in ((x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z))]
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    r = abs((x1 - x0) - (y1 - y0)) / 2
    if r < 0.05:
        t = bm.verts.new((cx, cy, z + h))
        for i in range(4):
            bm.faces.new((a[i], a[(i + 1) % 4], t))
    else:
        if x1 - x0 > y1 - y0:
            t = [bm.verts.new((cx - r, cy, z + h)), bm.verts.new((cx + r, cy, z + h))]
            faces = ((a[0], a[1], t[1], t[0]), (a[2], a[3], t[0], t[1]), (a[1], a[2], t[1]), (a[3], a[0], t[0]))
        else:
            t = [bm.verts.new((cx, cy - r, z + h)), bm.verts.new((cx, cy + r, z + h))]
            faces = ((a[1], a[2], t[1], t[0]), (a[3], a[0], t[0], t[1]), (a[0], a[1], t[0]), (a[2], a[3], t[1]))
        for f in faces:
            bm.faces.new(f)
    for f in bm.faces:                       # outwards: away from the roof's centre line
        c = f.calc_center_median()
        if f.normal.dot(c - Vector((cx, cy, z))) < 0:
            f.normal_flip()
    return _obj(bm, mat, uvscale=2.2)


# ------------------------------------------------------------------------------------------------ dressings
def rail(F, m, u0, u1, d, z, h=1.0, gap=0.22):
    """iron railings from u0 to u1, d out from the wall, standing on z: bars, a bottom and a top rail"""
    n = max(1, round(abs(u1 - u0) / gap))
    for k in range(n + 1):
        F.box(0.04, 0.04, h, u0 + (u1 - u0) * k / n, d, z, m['iron'])
    F.box(abs(u1 - u0) + 0.04, 0.06, 0.05, (u0 + u1) / 2, d - 0.01, z + h, m['iron'])
    F.box(abs(u1 - u0) + 0.04, 0.05, 0.04, (u0 + u1) / 2, d - 0.005, z + 0.12, m['iron'])


def balcony(F, m, dress, u0, u1, z, deep=0.8):
    """a stone balcony on brackets, iron railings round its front"""
    u = (u0 + u1) / 2
    F.box(u1 - u0, deep, 0.16, u, 0.0, z, dress)
    for b in (u0 + 0.25, u1 - 0.25):
        F.box(0.18, deep - 0.15, 0.32, b, 0.0, z - 0.32, dress)
    rail(F, m, u0 + 0.06, u1 - 0.06, deep - 0.08, z + 0.16, 0.85)


def window(F, m, u, z, w, h, head, lit, dress):
    """a sash window with its surround and head: flat, pediment, arch (round head) or segment (a shallow arch)"""
    if head == 'segment':
        sash(F, m, u, z, w, h, lit, dress, head='flat')
        F.segment(w + 0.55, 0.32, 0.14, u, 0.0, z + h + 0.22, dress)
    else:
        sash(F, m, u, z, w, h, lit, dress, head=head)


def dormer(F, m, u, d, z, dress, lit, w=1.4):
    """a dormer in a roof slope: its front d out from F's wall plane, standing on z, under a gabled slate roof"""
    F.box(w, 1.4, 1.9, u, d - 1.4, z, dress)
    F.gable(w + 0.4, 0.65, 1.55, u, d - 1.45, z + 1.9, m['slate'])
    F.box(w - 0.6, 0.04, 1.2, u, d, z + 0.3, m['win_lit'] if lit else m['win_dark'])
    F.box(0.05, 0.04, 1.2, u, d + 0.03, z + 0.3, m['trim'])


def shopfront(F, m, rnd, u0, u1, z, h, fascia, awning, door_left):
    """a shop over the ground floor from u0 to u1: the window lit at night, the door, the fascia and its name board,
    pilasters with consoles, an awning on some (door_left None: no door, a window only)"""
    w, cu = u1 - u0, (u0 + u1) / 2
    du = u0 + 0.9 if door_left else u1 - 0.9
    g0, g1 = (u0 + 0.3, u1 - 0.3) if door_left is None else (u0 + 1.75, u1 - 0.3) if door_left else (u0 + 0.3, u1 - 1.75)
    gw = g1 - g0
    F.box(w, 0.06, h - 0.15, cu, 0.0, z, fascia)                                    # the frame
    F.box(gw, 0.05, h - 1.75, (g0 + g1) / 2, 0.06, z + 0.65, m['win_warm'] if rnd.random() < 0.75 else m['win_dark'])
    F.box(gw + 0.1, 0.14, 0.55, (g0 + g1) / 2, 0.06, z + 0.1, fascia)               # the stall riser
    n = max(2, round(gw / 1.3))
    for k in range(1, n):
        F.box(0.07, 0.06, h - 1.75, g0 + gw * k / n, 0.1, z + 0.65, fascia)
    if door_left is not None:
        F.box(1.0, 0.1, 2.6, du, 0.06, z, m['door_wood'] if fascia is m['fascia_black'] else m['door_black'])
    F.box(w + 0.1, 0.3, 0.7, cu, 0.06, z + h - 1.05, fascia)                        # the fascia
    F.box(w * 0.6, 0.04, 0.34, cu, 0.36, z + h - 0.87, m['board'])                  # its name board
    for b in (u0 + 0.12, u1 - 0.12):                                                # pilasters, consoles
        F.box(0.24, 0.16, h - 1.05, b, 0.06, z, fascia)
        F.box(0.3, 0.42, 0.75, b, 0.06, z + h - 1.08, fascia)
    if awning is not None:
        prism([(0, 0), (0, 0.12), (1.6, -0.6), (1.6, -0.72)], w - 0.7, F.at(cu, 0.06, z + h - 1.2), awning, axis='x', rot=(0, 0, F.yaw))


def columns_on(u0, u1, step=2.3, margin=1.1):
    """the window columns along a wall from u0 to u1"""
    n = max(1, int((u1 - u0 - 2 * margin) / step) + 1)
    span = (n - 1) * step
    return [(u0 + u1) / 2 - span / 2 + k * step for k in range(n)]


def stack(m, x, z0, z1, y=0.0):
    """a chimney stack from z0 (hidden in the roof) up to z1"""
    chimney(m, x, y, z0, 1.2, z1 - z0, pots=3)


# ------------------------------------------------------------------------------------------------ the kinds of house
# storeys, the ground floor raised over an area (steps, railings) or at the street, roofs, walls, the ground floor's
# wall, dressings, window heads (ground floor, first floor, above), bays, balconies, string courses, porticos, shops
KINDS = {
    'georgian': dict(storeys=(4, 4, 5), raised=True, roofs=('mansard', 'mansard', 'parapet'),
                     walls=('london_brick', 'london_brick', 'brown_brick', 'stucco_grey'), base=('stucco_base',), dress='dressing',
                     heads=('flat', 'flat', 'flat'), balcony=0.7),
    'italianate': dict(storeys=(3, 4, 4), raised=True, roofs=('balustrade', 'pitched', 'parapet'), walls=STUCCO, base=None, dress='trim',
                       heads=('flat', 'pediment', 'segment'), portico=True, bay=0.55, balcony=0.5),
    'mansion': dict(storeys=(4, 5, 5), raised=False, roofs=('gables',), walls=('red_brick', 'red_brick', 'brown_brick'), base=('ashlar_sand',),
                    dress='ashlar_sand', heads=('arch', 'segment', 'segment'), bay=0.7, bands=True),
    'chambers': dict(storeys=(5, 5, 6), raised=False, roofs=('hipped', 'mansard', 'balustrade'), walls=('ashlar', 'ashlar_grey', 'ashlar_sand'),
                     base=('rustic',), dress='dressing', heads=('arch', 'pediment', 'flat'), bands=True, balcony=0.4),
    'shops': dict(storeys=(3, 4, 4, 5), raised=False, shop=True, roofs=('parapet', 'mansard', 'pitched'),
                  walls=('london_brick', 'stucco', 'stucco_ochre', 'red_brick', 'stucco_grey', 'brown_brick'), base=None, dress='dressing',
                  heads=('flat', 'flat', 'segment')),
}
GROUND = {True: (0.9, 3.8), False: (0.15, 4.4)}            # (floor, height) of the ground floor: raised or at the street
UPPER = (3.6, 3.2, 3.1, 3.0, 2.9)                           # the storeys above it


def storeys(z, h, n):
    """the floors [(level, height)] of n storeys over a ground floor at z, h high; and the eaves"""
    out = [(z, h)]
    for k in range(n - 1):
        z += h
        h = UPPER[min(k, len(UPPER) - 1)]
        out.append((z, h))
    return out, z + h


class House:
    """one house of a row: where it stands (x0, w), what it is and how it looks"""
    def __init__(self, m, rnd, x0, w, kind, like=None):
        K = KINDS[kind]
        L = like or {}
        self.x0, self.x1, self.w, self.kind, self.K = x0, x0 + w, w, kind, K
        self.cx = x0 + w / 2
        self.shop = K.get('shop', False)
        self.raised = K['raised'] and not self.shop
        self.roof = L.get('roof') or rnd.choice(K['roofs'])
        self.wall_k = L.get('wall') or rnd.choice(K['walls'])
        self.wall = m[self.wall_k]
        self.base = m[rnd.choice(K['base'])] if K['base'] else self.wall
        dk = K['dress']
        if dk == 'dressing' and self.wall_k.startswith('stucco'):
            dk = 'trim'                                     # stucco fronts: white dressings
        self.dress = m[dk]
        self.door = m[rnd.choice(DOORS)]
        self.fascia = m[rnd.choice(FASCIAS)]
        self.awning = m[rnd.choice(AWNINGS)] if rnd.random() < 0.6 else None
        self.bay = w >= 6.0 and rnd.random() < K.get('bay', 0)
        self.balcony = not self.bay and rnd.random() < K.get('balcony', 0)
        self.door_left = L['door_left'] if 'door_left' in L else rnd.random() < 0.5
        self.floors, self.eaves = storeys(*GROUND[self.raised], L.get('storeys') or rnd.choice(K['storeys']))
        n = max(2, int((w - 0.6) / 2.1))
        self.cols = [x0 + w * (k + 0.5) / n for k in range(n)]
        self.lit = rnd.random() * 0.35 + 0.15               # how many of its windows are lit
        self.top = self.eaves                               # where its chimney stacks clear the roof (set by it)


# ------------------------------------------------------------------------------------------------ one house
def body(m, H, left, right, D=DEPTH):
    """the house's walls: front and back; the ends only where it stands higher than its neighbours"""
    y0, y1 = -D / 2, D / 2
    z1 = H.floors[1][0]
    zf = 0.9 if H.raised else 0.15
    for za, zb, mat in ((0.0, zf, m['found']), (zf, z1, H.base), (z1, H.eaves, H.wall)):
        quad([(H.x0, y1, za), (H.x1, y1, za), (H.x1, y1, zb), (H.x0, y1, zb)], (0, 1, 0), mat)
        quad([(H.x0, y0, za), (H.x1, y0, za), (H.x1, y0, zb), (H.x0, y0, zb)], (0, -1, 0), mat)
        for x, s, nb in ((H.x0, -1, left), (H.x1, 1, right)):
            lo = max(za, nb.eaves if nb else 0.0)
            if lo < zb - 0.01:
                quad([(x, y0, lo), (x, y1, lo), (x, y1, zb), (x, y0, zb)], (s, 0, 0), mat)


def house(m, rnd, H, left, right, D=DEPTH):
    """a house of a row: its walls, string courses, the windows of the front and the back, its door or its shop"""
    body(m, H, left, right, D)
    e0 = 0.0 if left and left.eaves >= H.eaves - 0.01 else 0.15
    e1 = 0.0 if right and right.eaves >= H.eaves - 0.01 else 0.15
    bw, bx = H.w + e0 + e1, H.cx + (e1 - e0) / 2
    z1 = H.floors[1][0]
    box((bw, D + 0.24, 0.26), (bx, 0, z1 - 0.13), H.dress)                     # the course over the ground floor
    if H.K.get('bands'):
        for fz, _ in H.floors[2:]:
            box((bw, D + 0.14, 0.16), (bx, 0, fz - 0.06), H.dress)
    front, back = Face(0, D / 2), Face(math.pi, D / 2)
    door_col = H.cols[0] if H.door_left else H.cols[-1]
    bay_col = H.cols[-1] if H.door_left else H.cols[0]
    bay_top = len(H.floors) - 1 if H.kind == 'mansion' else 2     # the bay rises to (not through) this storey
    heads = H.K['heads']
    ww = min(1.15, H.w / len(H.cols) * 0.48)
    for fi, (fz, fh) in enumerate(H.floors):
        for u in H.cols:
            if fi == 0 and (H.shop or u == door_col):
                continue
            if H.bay and u == bay_col and fi < bay_top:
                continue
            wh = fh * (0.66 if fi == 1 else 0.58)
            window(front, m, u, fz + (0.6 if fi else 0.75), ww, wh, heads[min(fi, 2)], rnd.random() < H.lit, H.dress)
    if H.bay:
        bay(front, m, rnd, H, bay_col, H.floors[0][0], H.floors[bay_top][0] - 0.25, min(2.7, H.w / len(H.cols) * 1.2))
    if H.balcony:
        balcony(front, m, H.dress, H.x0 + 0.35, H.x1 - 0.35, H.floors[1][0] + 0.05)
    if H.shop:
        shopfront(front, m, rnd, H.x0 + 0.1, H.x1 - 0.1, H.floors[0][0], H.floors[0][1], H.fascia, H.awning, H.door_left)
    else:
        entrance(front, m, rnd, H, door_col)
    # the back: plain windows, the back door
    bwin = min(1.0, H.w / len(H.cols) * 0.42)
    for fi, (fz, fh) in enumerate(H.floors):
        for u in H.cols:
            if fi == 0 and u == H.cols[0]:
                back.box(1.0, 0.1, 2.3, -u, 0.0, fz + 0.05, H.door)
                continue
            sash(back, m, -u, fz + 0.7, bwin, fh * 0.52, rnd.random() < H.lit * 0.7, None)
            back.box(bwin + 0.3, 0.16, 0.1, -u, 0.0, fz + 0.6, H.dress)                       # the sill


def bay(F, m, rnd, H, u, z0, z1, wf):
    """a canted bay window from z0 up to z1: glazed on its three sides, standing 0.8 m out, a lead cap"""
    d, e = 0.8, 0.5
    ws = wf - 2 * e
    prof = [(-wf / 2, 0), (-ws / 2, d), (ws / 2, d), (wf / 2, 0)]
    back = Vector(F.at(u, -2.0, 0))
    for (a0, b0), (a1, b1) in zip(prof, prof[1:]):
        p = [F.at(u + a0, b0, z0), F.at(u + a1, b1, z0), F.at(u + a1, b1, z1), F.at(u + a0, b0, z1)]
        c = sum((Vector(q) for q in p), Vector()) / 4
        quad(p, (c - back) * Vector((1, 1, 0)), H.dress)
    F.box(wf + 0.25, d + 0.2, 0.22, u, 0.0, z1, m['lead'])                    # the cap
    Fo = Face(F.yaw, F.dist + d, F.cx, F.cy)
    side = math.atan2(d, e)
    sl = math.hypot(d, e)
    for fz, fh in H.floors:
        if fz < z0 - 0.01 or fz + 0.6 > z1 - 1.0:
            continue
        zw, hw = fz + 0.6, min(fh - 1.0, z1 - fz - 0.9)
        sash(Fo, m, u, zw, ws - 0.45, hw, rnd.random() < H.lit, None)
        Fo.box(ws + 0.04, 0.12, 0.12, u, 0.0, zw - 0.2, H.dress)             # the sill
        for s in (-1, 1):
            c = F.at(u + s * (wf + ws) / 4, d / 2, 0)
            S = Face(F.yaw - s * side, 0, c[0], c[1])
            S.box(sl - 0.4, 0.04, hw, 0, 0.02, zw, m['win_lit'] if rnd.random() < H.lit else m['win_dark'])


def entrance(F, m, rnd, H, u):
    """the front door: up its steps between the area railings when the ground floor is raised, a fanlight; a portico
    on columns on the stucco houses"""
    z = H.floors[0][0]
    F.box(1.7, 0.1, 3.4, u, 0.0, z - 0.05, H.dress)
    F.box(1.2, 0.1, 2.45, u, 0.06, z + 0.05, H.door)
    F.arch(0.6, 0.05, u, 0.06, z + 2.5, m['win_lit'] if rnd.random() < 0.5 else m['win_dark'], segs=10)
    if H.K.get('portico') and H.raised:
        for k in (-1, 1):
            cyl(0.17, 3.0, F.at(u + k * 0.95, 1.3, z), m['trim'], segs=10)
        F.box(2.5, 1.6, 0.42, u, 0.0, z + 3.0, m['trim'])
        rail(F, m, u - 1.15, u + 1.15, 1.45, z + 3.42, 0.7)
    if H.raised:
        steps = 4
        for s in range(steps):
            F.box(1.8, 0.42, z * (steps - s) / steps, u, s * 0.42, 0.0, m['concrete'])
        for p, q in ((H.x0 + 0.08, u - 1.0), (u + 1.0, H.x1 - 0.08)):
            if q - p > 0.3:
                rail(F, m, p, q, 1.9, 0.0, 1.05)
    else:
        F.box(1.6, 0.4, 0.15, u, 0.0, 0.0, m['concrete'])


# ------------------------------------------------------------------------------------------------ roofs (by runs)
def runs(houses):
    """neighbouring houses with the same roof at the same height share it"""
    out = []
    for H in houses:
        if out and out[-1][-1].roof == H.roof and abs(out[-1][-1].eaves - H.eaves) < 0.01:
            out[-1].append(H)
        else:
            out.append([H])
    return out


def roof(m, rnd, run, D=DEPTH):
    """the roof over a run of houses with its dormers or skylights; sets the houses' `top` (where their chimney
    stacks clear the roof)"""
    x0, x1 = run[0].x0, run[-1].x1
    w, cx, H0 = x1 - x0, (x0 + x1) / 2, run[0]
    z = H0.eaves
    kind = H0.roof
    F, B = Face(0, D / 2), Face(math.pi, D / 2)
    if kind in ('mansard', 'pitched', 'hipped', 'gables'):
        box((w + 0.2, D + 0.5, 0.32), (cx, 0, z - 0.32), H0.dress, bevel=0.04)          # the eaves cornice
    if kind == 'mansard':
        mansard(m['slate'], w, D + 0.3, 3.2, 1.2, (cx, 0, z), top=False)
        box((w - 2.4, D - 2.1, 0.12), (cx, 0, z + 3.2), m['lead'])
        for H in run:
            us = H.cols if len(H.cols) <= 2 else H.cols[::2]
            for G, sg in ((F, 1), (B, -1)):
                for u in us:
                    dormer(G, m, u * sg, 0.15, z + 0.35, H.dress, rnd.random() < H.lit)
            H.top = z + 2.6
    elif kind in ('pitched', 'gables'):
        h = 4.0 if kind == 'pitched' else 4.6
        prism([(-D / 2 - 0.3, 0), (D / 2 + 0.3, 0), (0, h)], w, (cx, 0, z), m['slate'], axis='x')
        for xe, s in ((x0, 1), (x1, -1)):                    # the gable ends: a little proud of the roof's end
            prism([(-D / 2, 0), (D / 2, 0), (0, h - 0.15)], 0.25, (xe + s * 0.105, 0, z), H0.wall, axis='x')
        for H in run:
            if kind == 'gables':
                dutch(F, m, rnd, H, z)
            elif H.shop or rnd.random() < 0.5:
                for u in (H.cols[::2] if len(H.cols) > 2 else H.cols[:1]):
                    dormer(F, m, u, -0.6, z + 0.4, H.dress, rnd.random() < H.lit, w=1.2)
            H.top = z + h - 1.2
    elif kind == 'hipped':
        hip(x0 - 0.3, x1 + 0.3, -D / 2 - 0.3, D / 2 + 0.3, z, 4.2, m['slate'])
        for H in run:
            for u in H.cols[::2]:
                dormer(F, m, u, -0.9, z + 0.35, H.dress, rnd.random() < H.lit, w=1.2)
            H.top = z + 2.6
    else:                                                                               # parapet, balustrade
        box((w, D, 0.1), (cx, 0, z), m['lead'])
        for G, sg in ((F, 1), (B, -1)):
            G.box(w + 0.1, 0.34, 0.3, cx * sg, -0.3, z, H0.dress)                       # the cornice
            if kind == 'balustrade' and G is F:
                n = max(2, round(w / 0.36))
                for k in range(n):
                    cyl(0.08, 0.62, G.at(x0 + (k + 0.5) * w / n, -0.15, z + 0.3), H0.dress, segs=6, r2=0.055)
                for xp in [x0 + 0.18] + [H.x1 for H in run[:-1]] + [x1 - 0.18]:          # its piers
                    G.box(0.36, 0.34, 0.66, xp, -0.32, z + 0.3, H0.dress)
                G.box(w + 0.1, 0.4, 0.14, cx, -0.35, z + 0.92, H0.dress)
            else:
                G.box(w, 0.25, 0.75, cx * sg, -0.28, z + 0.3, H0.wall)
                G.box(w + 0.1, 0.35, 0.12, cx * sg, -0.33, z + 1.05, H0.dress)
        for xe, s in ((x0, 1), (x1, -1)):
            box((0.25, D - 0.6, 0.9), (xe + s * 0.125, 0, z), H0.wall)
        for H in run:                                                                   # skylights, hatches
            if rnd.random() < 0.65:
                prism([(-0.9, 0), (0.9, 0), (0, 0.6)], min(2.8, H.w - 2.0), (H.cx, -0.8, z + 0.1), m['glass'], axis='x')
            if rnd.random() < 0.4:
                box((0.8, 0.8, 0.45), (H.cx + 1.2 * rnd.choice((-1, 1)), 3.2, z + 0.1), m['lead'])
            H.top = z + 0.9


def dutch(F, m, rnd, H, z):
    """a shaped gable over a red brick front: stepped shoulders, a pediment, a round-headed window, stone copings"""
    a, b = H.w / 2 - 0.35, max(1.1, H.w / 4)
    h1, h2 = 2.1, 3.7
    prof = [(-a, 0), (a, 0), (a, h1), (b, h1), (b, h2), (-b, h2), (-b, h1), (-a, h1)]
    prism(prof, 0.5, F.at(H.cx, -0.25, z), H.wall, axis='y', rot=(0, 0, F.yaw))
    for hw, zz in ((a, h1), (b, h2)):
        F.box(2 * hw + 0.16, 0.6, 0.14, H.cx, -0.28, z + zz, H.dress)
    for s in (-1, 1):
        F.box(0.16, 0.6, h2 - h1, H.cx + s * b, -0.28, z + h1, H.dress)
    F.gable(2 * b + 0.3, 0.7, 0.6, H.cx, -0.28, z + h2 + 0.14, H.dress)
    window(F, m, H.cx, z + 0.5, 0.95, 1.6, 'arch', rnd.random() < H.lit, H.dress)


# ------------------------------------------------------------------------------------------------ rows
def widths(width, rnd):
    """the houses of a row: 5.8 - 8.4 m each"""
    n = max(2, round(width / 7.0))
    ws = [rnd.uniform(5.8, 8.4) for _ in range(n)]
    k = width / sum(ws)
    return [x * k for x in ws]


def row(width, seed, mood='street', kind=None):
    """a row of houses `width` m long. mood 'terrace': houses of one kind built together (one front, a storey more
    here and there); 'street': every house its own"""
    m = HM()
    rnd = random.Random(seed)
    kind = kind or rnd.choice(list(KINDS))
    houses, x = [], -width / 2
    if mood == 'terrace':
        K = KINDS[kind]
        like = {'storeys': rnd.choice(K['storeys']), 'roof': rnd.choice(K['roofs']), 'wall': rnd.choice(K['walls']),
                'door_left': rnd.random() < 0.5}
    for i, w in enumerate(widths(width, rnd)):
        if mood == 'terrace':
            L = dict(like)
            if i and rnd.random() < 0.2:
                L['storeys'] = L['storeys'] + 1
            houses.append(House(m, rnd, x, w, kind, L))
        else:
            houses.append(House(m, rnd, x, w, kind if i == 0 else rnd.choice(list(KINDS))))
        x += w
    n = len(houses)
    for r in runs(houses):
        roof(m, rnd, r)
    for i, H in enumerate(houses):
        house(m, rnd, H, houses[i - 1] if i else None, houses[i + 1] if i + 1 < n else None)
    # chimney stacks on the party walls and at the row's ends: from the higher eaves (inside the roofs, which slope
    # down to the party walls at the end of a run) up past the higher roof
    for a, b in zip(houses, houses[1:]):
        stack(m, a.x1, max(a.eaves, b.eaves), max(a.top, b.top) + 1.8)
    stack(m, houses[0].x0 + 0.6, houses[0].eaves, houses[0].top + 1.8)
    stack(m, houses[-1].x1 - 0.6, houses[-1].eaves, houses[-1].top + 1.8)
    # the row's end walls: blind, a window here and there
    for F, H in ((Face(math.pi / 2, width / 2), houses[0]), (Face(-math.pi / 2, width / 2), houses[-1])):
        for fz, fh in H.floors[1:]:
            if rnd.random() < 0.4:
                sash(F, m, rnd.choice((-2.5, 2.5)), fz + 0.6, 0.95, fh * 0.52, rnd.random() < H.lit, H.dress)
    return [(-width / 2, -DEPTH / 2, width / 2, DEPTH / 2 + 1.0)]


# ------------------------------------------------------------------------------------------------ corners
CORNERS = {
    # the corner ('round' with its radius, 'chamfer' with the cut), storeys, walls, the ground floor's wall,
    # dressings, roof, window heads (ground, first, above), shops on the ground floor
    'dome': dict(cut=('round', 4.5), storeys=5, walls=('ashlar', 'stucco'), base='rustic', dress='dressing', roof='mansard',
                 heads=('arch', 'pediment', 'flat')),
    'turret': dict(cut=('chamfer', 3.4), storeys=5, walls=('red_brick',), base='ashlar_sand', dress='ashlar_sand', roof='turret',
                   heads=('segment', 'arch', 'segment'), shop=True),
    'curve': dict(cut=('round', 8.0), storeys=4, walls=STUCCO, base=None, dress='trim', roof='glazed',
                  heads=('flat', 'segment', 'flat'), shop=True),
    'chamfer': dict(cut=('chamfer', 4.6), storeys=6, walls=('ashlar', 'ashlar_grey'), base='rustic', dress='dressing', roof='balustrade',
                    heads=('arch', 'pediment', 'flat')),
}


def corner_plan(cut, S=CORNER):
    """the corner building's plan (counter-clockwise) and the walls of its corner [(yaw, dist, cx, cy, width)]"""
    h = S / 2
    kind, c = cut
    if kind == 'round':
        o = h - c
        arc = [(o + c * math.cos(math.pi / 2 * k / 8), o + c * math.sin(math.pi / 2 * k / 8)) for k in range(9)]
        pts = [(-h, -h), (h, -h)] + arc + [(-h, h)]
        n = 3 if c < 6 else 5
        walls = [(-math.pi / 2 + math.pi / 2 * (k + 0.5) / n, c, o, o, c * math.pi / 2 / n) for k in range(n)]
    else:
        pts = [(-h, -h), (h, -h), (h, h - c), (h - c, h), (-h, h)]
        walls = [(-math.pi / 4, (S - c) / math.sqrt(2), 0, 0, c * math.sqrt(2))]
    return pts, walls


def corner(kind='dome', seed=3):
    """a corner building of a block, 14 x 14 m: the corner at +x +y rounded or cut, both street fronts windowed and
    dressed, the backs blind below the top storey (the rows stand against them)"""
    m = HM()
    rnd = random.Random(seed)
    C = CORNERS[kind]
    h, c = CORNER / 2, C['cut'][1]
    wall = m[rnd.choice(C['walls'])]
    base = m[C['base']] if C['base'] else wall
    dress = m[C['dress']]
    lit = 0.25 + rnd.random() * 0.2
    shop = C.get('shop', False)
    pts, cwalls = corner_plan(C['cut'])
    zg, hg = GROUND[not shop]
    floors, eaves = storeys(zg, hg, C['storeys'])
    z1 = floors[1][0]
    extrude(pts, 0, zg, m['found'], top=False)
    extrude(pts, zg, z1, base, top=False)
    extrude(pts, z1, eaves, wall, top=False)
    extrude(offset(pts, 0.14), z1 - 0.13, z1 + 0.13, dress)                         # the string courses
    if kind in ('chamfer', 'turret'):
        for fz, _ in floors[2:]:
            extrude(offset(pts, 0.08), fz - 0.06, fz + 0.1, dress)
    # the street fronts: (wall, from, to, the corner's end)
    fronts = [(Face(0, h), -h, h - c, h - c), (Face(-math.pi / 2, h), -(h - c), h, -(h - c))]
    heads = C['heads']
    door = m[rnd.choice(DOORS)]
    fascia = m[rnd.choice(FASCIAS)]
    for F, u0, u1, _ in fronts:
        cols = columns_on(u0, u1, 2.35, 1.0)
        for fi, (fz, fh) in enumerate(floors):
            if fi == 0 and shop:
                continue
            for u in cols:
                window(F, m, u, fz + (0.75 if fi == 0 else 0.6), 1.05, fh * (0.62 if fi == 1 else 0.56), heads[min(fi, 2)], rnd.random() < lit, dress)
        if shop:
            shopfront(F, m, rnd, u0 + 0.2, u1 - 0.2, zg, hg, fascia, m[rnd.choice(AWNINGS)] if rnd.random() < 0.6 else None, F.yaw != 0)
        if kind == 'chamfer':                                                       # a balcony along the first floor
            balcony(F, m, dress, cols[0] - 0.7, cols[-1] + 0.7, floors[1][0] + 0.05, 0.7)
    for yaw, dist, cx, cy, cw in cwalls:
        G = Face(yaw, dist, cx, cy)
        for fi, (fz, fh) in enumerate(floors):
            if fi == 0:
                if kind == 'curve':
                    shopfront(G, m, rnd, -cw / 2 + 0.15, cw / 2 - 0.15, zg, hg, fascia, None, None)
                elif len(cwalls) == 1 or abs(yaw + math.pi / 4) < 0.01:
                    corner_door(G, m, rnd, kind, door, dress, zg)
                else:
                    window(G, m, 0, fz + 0.75, 1.0, fh * 0.56, heads[0], rnd.random() < lit, dress)
            elif kind != 'turret':
                window(G, m, 0, fz + 0.6, min(1.1, cw * 0.4), fh * (0.62 if fi == 1 else 0.56), heads[min(fi, 2)], rnd.random() < lit, dress)
    # the backs: the top storey's windows
    fz, fh = floors[-1]
    for F in (Face(math.pi, h), Face(math.pi / 2, h)):
        for u in columns_on(-h, h, 2.6, 1.6):
            sash(F, m, u, fz + 0.6, 0.95, fh * 0.52, rnd.random() < lit, dress)

    def dormers(d, z, skip, w=1.4, step=2.6):
        for F, u0, u1, uc in fronts:
            for u in columns_on(u0, u1, step, 1.6):
                if abs(u - uc) > skip:
                    dormer(F, m, u, d, z, dress, rnd.random() < lit, w)

    # the roofs
    if C['roof'] == 'mansard':
        extrude(offset(pts, 0.3), eaves - 0.35, eaves, dress)                       # the cornice
        mansard_poly(m['slate'], offset(pts, 0.15), eaves, 3.3, 1.3)
        o = h - c
        cyl(c - 0.6, 4.6, (o, o, eaves), dress, segs=24)                            # the drum, the dome, its lantern
        cyl(c - 0.35, 0.28, (o, o, eaves + 4.6), m['dressing'], segs=24)
        dome(c - 0.5, 3.2, (o, o, eaves + 4.88), m['slate'], segs=24)
        cyl(0.45, 0.9, (o, o, eaves + 8.0), dress, segs=8)
        cyl(0.55, 0.12, (o, o, eaves + 8.9), m['lead'], segs=8)
        cyl(0.07, 1.2, (o, o, eaves + 9.02), m['iron'], segs=6)
        for k in (-1, 0, 1):                                                        # the drum's windows
            Gd = Face(k * 0.5 - math.pi / 4, c - 0.6, o, o)
            g = m['win_lit'] if rnd.random() < 0.6 else m['win_dark']
            Gd.box(0.7, 0.05, 1.4, 0, 0.0, eaves + 2.2, g)
            Gd.arch(0.35, 0.05, 0, 0.0, eaves + 3.6, g, segs=8)
            Gd.box(1.1, 0.12, 0.12, 0, 0.0, eaves + 2.05, dress)
        dormers(0.15, eaves + 0.4, 3.2)
        stack(m, -h + 0.8, eaves, eaves + 4.4, -2.0)
    elif C['roof'] == 'turret':
        extrude(offset(pts, 0.28), eaves - 0.32, eaves, dress)
        mansard_poly(m['slate'], offset(pts, 0.2), eaves, 4.0, 3.0)                 # a steep hipped roof, flat on top
        dormers(-0.9, eaves + 0.35, 2.8, w=1.2, step=3.0)
        # the turret on the cut corner: corbelled out over the ground floor, up past the eaves, a slate spire
        yaw, dist, cx, cy, cw = cwalls[0]
        tc = Face(yaw, dist, cx, cy).at(0, 0.9, 0)
        R = 2.1
        octo = [(tc[0] + R * math.cos(math.pi / 8 + k * math.pi / 4), tc[1] + R * math.sin(math.pi / 8 + k * math.pi / 4)) for k in range(8)]
        extrude(octo, z1, eaves + 3.2, wall)
        extrude(offset(octo, 0.2), z1 - 0.6, z1, dress)                              # the corbel
        extrude(offset(octo, 0.14), eaves - 0.3, eaves, dress)
        extrude(offset(octo, 0.25), eaves + 3.2, eaves + 3.45, dress)
        spire(offset(octo, 0.3), eaves + 3.45, 5.0, m['slate'])
        cyl(0.06, 1.0, (tc[0], tc[1], eaves + 8.3), m['iron'], segs=6)
        ap = R * math.cos(math.pi / 8)
        tf = floors[1:] + [(eaves + 0.3, 2.6)]
        for k in (-1, 0, 1):                                                         # its windows on every storey
            Gt = Face(yaw + k * math.pi / 4, ap, tc[0], tc[1])
            for fi, (fz, fh) in enumerate(tf):
                sash(Gt, m, 0, fz + 0.6, 0.75, fh * 0.55, rnd.random() < lit, dress, head='arch' if fi == len(tf) - 1 else 'flat')
        stack(m, -h + 0.8, eaves, eaves + 4.8, -1.5)
    elif C['roof'] == 'glazed':
        extrude(offset(pts, 0.3), eaves - 0.3, eaves, dress)
        extrude(pts, eaves, eaves + 0.1, m['lead'])
        ring(pts, 0.3, eaves, eaves + 0.9, wall, cap=dress)
        # the glazed roofs along the curve (the film's): a ridge of glass following it, more over the back
        vault(h - c, c - 2.6, 1.3, 1.1, eaves + 0.1, m['glass'], m['iron'])
        for k in range(2):
            prism([(-1.1, 0), (1.1, 0), (0, 0.9)], 3.2, (-4.6 + k * 3.6, -3.4, eaves + 0.1), m['glass'], axis='y')
        for x in (-h + 0.8, h - 0.8):
            stack(m, x, eaves, eaves + 2.7, -h + 0.7)
    else:                                                                            # balustrade, a pediment on the cut
        extrude(offset(pts, 0.32), eaves - 0.36, eaves, dress)
        extrude(pts, eaves, eaves + 0.1, m['lead'])
        for F, u0, u1, _ in fronts:
            n = max(2, round((u1 - u0) / 0.36))
            for k in range(n):
                cyl(0.08, 0.62, F.at(u0 + (k + 0.5) * (u1 - u0) / n, -0.18, eaves + 0.3), dress, segs=6, r2=0.055)
            F.box(u1 - u0, 0.4, 0.3, (u0 + u1) / 2, -0.38, eaves, dress)
            F.box(u1 - u0, 0.42, 0.14, (u0 + u1) / 2, -0.4, eaves + 0.92, dress)
        for F in (Face(math.pi, h), Face(math.pi / 2, h)):
            F.box(2 * h, 0.3, 1.06, 0, -0.3, eaves, wall)
        yaw, dist, cx, cy, cw = cwalls[0]
        G = Face(yaw, dist, cx, cy)
        G.box(cw + 0.4, 0.5, 1.4, 0, -0.4, eaves, dress)
        G.gable(cw + 0.8, 1.6, 0.6, 0, -0.45, eaves + 1.4, dress)
        G.disc(0.5, 0.05, 0, 0.15, eaves + 2.0, m['dark'], segs=14)
        hip(-h + 1.2, h - 2.4, -h + 1.2, h - 2.4, eaves + 0.1, 2.6, m['slate'])
        stack(m, -h + 0.8, eaves, eaves + 3.5, -h + 1.0)
    return [(-h, -h, h, h)]


def corner_door(G, m, rnd, kind, door, dress, z):
    """the entrance on the corner: a door under a fanlight in a stone surround; columns and a cornice on the stone
    buildings"""
    G.box(2.0, 0.1, 3.6, 0, 0.0, z - 0.05, dress)
    G.box(1.4, 0.1, 2.6, 0, 0.06, z, door)
    G.arch(0.7, 0.05, 0, 0.06, z + 2.6, m['win_lit'] if rnd.random() < 0.6 else m['win_dark'], segs=10)
    if kind in ('chamfer', 'dome'):
        for k in (-1, 1):
            cyl(0.2, 3.5, G.at(k * 1.25, 0.3, z), dress, segs=10)
        G.box(3.0, 0.7, 0.4, 0, 0.0, z + 3.5, dress)
    if z > 0.5:
        for s in range(3):
            G.box(2.4, 0.4, z * (3 - s) / 3, 0, s * 0.4, 0.0, m['concrete'])
