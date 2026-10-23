"""London by night, after the campaign's opening film (Data/locale/<lang>/Video/hs_1000.bik: a bird over the city, the
river with the big wheel, Babbit's Society): the Society with its domed corner towers, the wheel and its pier, the
iron bridge, the embankment, the river boats (art/sequel/kit.py; the front looks along +y); the houses are in
houses.py. The sequel's mission "The Society" (docs/SEQUEL.md) is played there.

The models with a footprint return it from their builder as pathfinder rectangles in Blender's axes
[(x0, y0, x1, y1), ...] (build.py writes them into the model as the GSF's pf boxes, so the houses block along their
walls rather than by a circle)."""
import math, random
import bmesh
from mathutils import Vector, Matrix
from .kit import box, cyl, prism, tex, paint, mirror, glow, _obj, _xf
from .town import M

# ------------------------------------------------------------------------------------------------ materials
STONE = {'portland': (0.86, 0.82, 0.70), 'sand': (0.84, 0.74, 0.55), 'grey': (0.70, 0.70, 0.68)}


def LM():
    m = M()
    m.update({
        'slate': tex('slate', 'RoofingTiles003', tint=(0.22, 0.24, 0.30), strength=0.5, scale=2.2, grime=0.15),
        'lead': paint('lead', (0.30, 0.32, 0.36), grime=0.2),
        'iron': paint('iron', (0.08, 0.085, 0.09), grime=0.15, rough=0.5),
        'stucco': tex('stucco', 'PaintedPlaster017', tint=(0.93, 0.89, 0.79), strength=0.7, scale=3.0, grime=0.45),
        'stucco_base': tex('stucco_base', 'Bricks066', tint=(0.90, 0.87, 0.78), strength=0.75, scale=2.4, grime=0.4),
        'ashlar': tex('ashlar', 'Bricks008', tint=STONE['portland'], strength=0.6, scale=3.5, grime=0.5),
        'ashlar_sand': tex('ashlar_sand', 'Bricks008', tint=STONE['sand'], strength=0.7, scale=3.5, grime=0.45),
        'ashlar_grey': tex('ashlar_grey', 'Bricks008', tint=STONE['grey'], strength=0.4, scale=3.5, grime=0.55),
        'rustic': tex('rustic', 'Bricks008', tint=(0.80, 0.71, 0.54), strength=0.75, scale=2.0, grime=0.4),
        'london_brick': tex('london_brick', 'Bricks085', tint=(0.62, 0.42, 0.30), strength=0.35, scale=1.6, grime=0.35),
        'red_brick': tex('red_brick', 'Bricks085', scale=1.6, grime=0.3),
        'dressing': paint('dressing', (0.90, 0.87, 0.78), grime=0.35),
        'frieze': paint('frieze', (0.55, 0.30, 0.24), grime=0.3),
        'paving': tex('paving', 'PavingStones046', tint=(0.55, 0.55, 0.55), strength=0.3, scale=2.5, grime=0.3),
        'win_dark': mirror('win_dark', sky=(0.26, 0.30, 0.38), horizon=(0.04, 0.045, 0.05), ground=(0.07, 0.07, 0.07)),
        'win_lit': glow('win_lit', (1.0, 0.82, 0.48), 1.0),
        'win_warm': glow('win_warm', (0.95, 0.62, 0.30), 0.9),
        'door_wood': tex('door_wood', 'Planks037A', tint=(0.42, 0.22, 0.10), strength=0.8, scale=1.2, grime=0.2),
        'hedge': paint('hedge', (0.16, 0.26, 0.12), grime=0.1, noise=0.25),
        'lamp': glow('lamp', (1.0, 0.86, 0.58), 1.0),
    })
    return m


# ------------------------------------------------------------------------------------------------ geometry
def rod(p0, p1, r, mat, segs=6):
    """a bar from p0 to p1 (girders, cables, spokes)"""
    a, b = Vector(p0), Vector(p1)
    d = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r, radius2=r, depth=d.length)
    bmesh.ops.translate(bm, vec=Vector((0, 0, d.length / 2)), verts=bm.verts)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bmesh.ops.transform(bm, matrix=Matrix.Translation(a) @ q.to_matrix().to_4x4(), verts=bm.verts)
    return _obj(bm, mat, smooth=True)


def mansard(mat, w, d, h, inset, loc, top=True):
    """a mansard over w x d: four steep slopes up `h` to a flat top `inset` in from the eaves (top False: open, for a
    roof standing on it - a hidden face there would share the roof's island in the baked UVs)"""
    bm = bmesh.new()
    x, y, z = loc
    lo = [(x - w / 2, y - d / 2), (x + w / 2, y - d / 2), (x + w / 2, y + d / 2), (x - w / 2, y + d / 2)]
    hi = [(x - w / 2 + inset, y - d / 2 + inset), (x + w / 2 - inset, y - d / 2 + inset), (x + w / 2 - inset, y + d / 2 - inset), (x - w / 2 + inset, y + d / 2 - inset)]
    a = [bm.verts.new((px, py, z)) for px, py in lo]
    b = [bm.verts.new((px, py, z + h)) for px, py in hi]
    for i in range(4):
        bm.faces.new((a[i], a[(i + 1) % 4], b[(i + 1) % 4], b[i]))       # (outwards as built)
    if top:
        bm.faces.new(b)
    bm.faces.new(list(reversed(a)))
    return _obj(bm, mat, uvscale=2.2)


def mansard_poly(mat, pts, z, h, inset):
    """a mansard over a convex polygon [(x, y), ...] (counter-clockwise): the slopes up `h` to a flat top whose edges
    lie `inset` in from the eaves"""
    n = len(pts)
    lines = []
    for i in range(n):
        a, b = Vector((*pts[i], 0)), Vector((*pts[(i + 1) % n], 0))
        d = (b - a).normalized()
        nrm = Vector((-d.y, d.x, 0))              # inwards for a counter-clockwise polygon
        lines.append((a + nrm * inset, d))
    top = []
    for i in range(n):
        (p1, d1), (p2, d2) = lines[i - 1], lines[i]
        den = d1.x * d2.y - d1.y * d2.x
        t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / den
        top.append(p1 + d1 * t)
    bm = bmesh.new()
    a = [bm.verts.new((x, y, z)) for x, y in pts]
    b = [bm.verts.new((p.x, p.y, z + h)) for p in top]
    for i in range(n):
        bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    bm.faces.new(b)
    bm.faces.new(list(reversed(a)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj(bm, mat, uvscale=2.2)


def dome(r, h, loc, mat, segs=16, rings=5):
    """a dome of radius r and height h standing on loc"""
    x, y, z = loc
    for k in range(rings):
        a0, a1 = k / rings * math.pi / 2, (k + 1) / rings * math.pi / 2
        r0, r1 = r * math.cos(a0), r * math.cos(a1)
        z0, z1 = h * math.sin(a0), h * math.sin(a1)
        cyl(r0, z1 - z0, (x, y, z + z0), mat, segs=segs, r2=max(r1, 0.01), cap=(k == rings - 1))


def segment(w, h, segs=10):
    """the profile of a segmental arch w wide rising h: a curved gable, a window's segmental head"""
    r = (w * w / 4 + h * h) / (2 * h)
    a = math.asin(w / 2 / r)
    return [(r * math.sin(-a + 2 * a * k / segs), h - r + r * math.cos(-a + 2 * a * k / segs)) for k in range(segs + 1)][::-1]


class Face:
    """a wall seen from outside: u runs along it (left to right), d outwards from the wall plane, z up.
    yaw 0: the wall at y = +dist facing +y; pi: at -dist facing -y; -pi/2: at x = +dist facing +x; pi/2: x = -dist"""
    def __init__(self, yaw, dist, cx=0.0, cy=0.0):
        self.yaw, self.dist, self.cx, self.cy = yaw, dist, cx, cy
        self.U = Vector((math.cos(yaw), math.sin(yaw), 0))
        self.N = Vector((-math.sin(yaw), math.cos(yaw), 0))

    def at(self, u, d, z):
        p = Vector((self.cx, self.cy, 0)) + self.U * u + self.N * (self.dist + d)
        return (p.x, p.y, z)

    def box(self, w, t, h, u, d, z, mat, bevel=0.0):
        """a box w along the wall, t out from d, h up from z"""
        return box((w, t, h), self.at(u, d + t / 2, z), mat, rot=(0, 0, self.yaw), bevel=bevel)

    def disc(self, r, t, u, d, z, mat, segs=16):
        """a disc (arch head) centred at (u, z), from d out to d + t"""
        return cyl(r, t, self.at(u, d + t, z), mat, segs=segs, rot=(math.pi / 2, 0, self.yaw), smooth=False)

    def arch(self, r, t, u, d, z, mat, segs=12):
        """a half disc standing on (u, z): the round head of a window or door, from d out to d + t (a full disc
        over the opening would lie in the opening's plane, and the baked occlusion darkens such overlaps)"""
        prof = [(r * math.cos(math.pi * k / segs), r * math.sin(math.pi * k / segs)) for k in range(segs + 1)]
        return prism(prof, t, self.at(u, d + t / 2, z), mat, axis='y', rot=(0, 0, self.yaw))

    def segment(self, w, h, t, u, d, z, mat):
        """a curved gable w wide, rising h (a segment of a circle)"""
        return prism(segment(w, h), t, self.at(u, d + t / 2, z), mat, axis='y', rot=(0, 0, self.yaw))

    def gable(self, w, h, t, u, d, z, mat):
        """a triangular pediment w wide, h high"""
        a = self.at(u, d + t / 2, z)
        return prism([(-w / 2, 0), (w / 2, 0), (0, h)], t, a, mat, axis='y', rot=(0, 0, self.yaw))


def sash(F, m, u, z, w, h, lit, surround=None, head='flat', bars=True, glass=None):
    """a window: glass (lit or dark, or the material given), glazing bars, a stone surround (flat head, round arch or
    segmental head)"""
    glass = glass or (m['win_lit'] if lit else m['win_dark'])
    if surround is not None:
        F.box(w + 0.5, 0.08, h + 0.35, u, 0.0, z - 0.2, surround)
        if head == 'arch':
            F.arch(w / 2 + 0.25, 0.08, u, 0.0, z + h + 0.15, surround)
        elif head == 'pediment':
            F.gable(w + 0.9, 0.55, 0.18, u, 0.0, z + h + 0.18, surround)
            F.box(w + 0.8, 0.2, 0.18, u, 0.0, z + h + 0.02, surround)
        else:
            F.box(w + 0.7, 0.16, 0.22, u, 0.0, z + h + 0.02, surround)
        F.box(w + 0.6, 0.22, 0.12, u, 0.0, z - 0.26, surround)            # the sill
    F.box(w, 0.04, h, u, 0.09, z, glass)
    if head == 'arch':
        F.arch(w / 2, 0.04, u, 0.09, z + h, glass)
    if bars:
        F.box(0.06, 0.05, h, u, 0.12, z, m['trim'])
        F.box(w, 0.05, 0.06, u, 0.12, z + h * 0.5, m['trim'])


def chimney(m, x, y, z, w, h, pots=3, mat=None):
    box((w, 0.9, h), (x, y, z), mat or m['london_brick'])
    box((w + 0.2, 1.1, 0.18), (x, y, z + h), m['dressing'])
    for k in range(pots):
        cyl(0.13, 0.55, (x - w / 2 + (k + 0.5) * w / pots, y, z + h + 0.18), paint('pot', (0.62, 0.38, 0.26), grime=0.4), segs=8)


# ------------------------------------------------------------------------------------------------ the Society
# measured on the film's frames (hs_1000.bik 26 - 41 s: the camera and the proportions fitted together to points
# marked on the frame at 33.8 s - the domes' tops, the towers' cornices and corners, the door, the cornice and a
# dormer's top over it; the side's bays counted on the frames): five bays in front and five at the sides, a slim
# tower over each corner of the hall standing out from both walls; a low ground floor with pedimented windows, a
# main floor with paired round-arched windows (the middle bay: one great arched window over the entrance), a
# cornice, then a steep slate mansard with a dormer under a curved gable over every bay and a hipped roof above it
SOC_BAY, SOC_T, SOC_E = 7.0, 6.2, 3.2      # the bay, the towers' side, how far they stand out from the walls
SOC_NX, SOC_NY = 5, 5                       # bays in front and at the sides
SOC_W = SOC_NX * SOC_BAY + 2 * (SOC_T - SOC_E)      # 41: the hall's walls (the towers over its corners)
SOC_D = SOC_NY * SOC_BAY + 2 * (SOC_T - SOC_E)      # 41
SOC_FORE = 2.0                              # the forecourt in front of the towers


def bands(F, m, u, w, z0, z1, d=0.0, step=0.7):
    """horizontal grooves of banded rustication on a pilaster or a tower's corner (w wide at u, from z0 to z1)"""
    z = z0 + step
    while z < z1 - 0.1:
        F.box(w, 0.06, 0.07, u, d - 0.03, z, m['groove'])
        z += step


def society():
    """the seat of Babbit's Society by the river, as the film shows it: sandstone with banded pilasters and a pink
    frieze, five bays on every side; paired round-arched windows on the main floor (in the middle
    the great arched window over the entrance), pedimented windows below; a slate mansard with a round-headed dormer
    (a curved gable) over every bay under a hipped roof; a slim tower at each corner rising two storeys higher,
    pediments on its faces, a drum with blind arches and a tall dome; the entrance up its steps under a carved pediment between two cypresses; the
    forecourt wall of brick piers and railings with a hedge behind"""
    m = LM()
    m['groove'] = paint('groove', (0.30, 0.25, 0.20), grime=0.0)
    m['win_red'] = glow('win_red', (0.62, 0.22, 0.13), 0.55)         # the red rooms behind the main floor's windows
    # the film's stone: an even warm sandstone, little grime; the frieze a faded pink
    m['soc_stone'] = tex('soc_stone', 'Bricks008', tint=(0.82, 0.74, 0.60), strength=0.75, scale=3.0, grime=0.2, contrast=0.8)
    m['soc_base'] = tex('soc_base', 'Bricks066', tint=(0.78, 0.70, 0.57), strength=0.8, scale=2.2, grime=0.2, contrast=0.8)
    m['soc_dress'] = paint('soc_dress', (0.88, 0.82, 0.70), grime=0.15)
    m['frieze'] = paint('soc_frieze', (0.62, 0.48, 0.42), grime=0.15)
    m['soc_dome'] = paint('soc_dome', (0.33, 0.33, 0.31), grime=0.25)
    m['soc_glass'] = mirror('soc_glass', sky=(0.20, 0.22, 0.27), horizon=(0.05, 0.05, 0.06), ground=(0.08, 0.07, 0.07))
    rnd = random.Random(11)
    B, T, NX, NY, E = SOC_BAY, SOC_T, SOC_NX, SOC_NY, SOC_E
    W, D = SOC_W, SOC_D
    Z0, Z1, Z2, ZC, ZE = 0.9, 4.0, 4.6, 9.9, 10.6       # plinth, frieze bottom, main floor, cornice, eaves
    stone, sand, dress = m['soc_stone'], m['soc_base'], m['soc_dress']
    m['win_dark'] = m['soc_glass']
    # the body (the towers stand over its corners)
    box((W + 0.6, D + 0.6, Z0), (0, 0, 0), sand)
    box((W, D, Z1 - Z0), (0, 0, Z0), sand)
    box((W + 0.3, D + 0.3, Z2 - Z1), (0, 0, Z1), m['frieze'])
    box((W, D, ZC - Z2), (0, 0, Z2), stone)
    box((W + 0.5, D + 0.5, 0.35), (0, 0, Z2 - 0.1), dress)                       # the sill course
    box((W + 0.4, D + 0.4, ZE - ZC), (0, 0, ZC), dress)                          # the entablature
    box((W + 1.1, D + 1.1, 0.35), (0, 0, ZE), dress, bevel=0.06)                 # the cornice
    # the roof: a steep mansard, a hipped roof over it
    MH, MI = 3.0, 1.5
    mansard(m['slate'], W - 1.0, D - 1.0, MH, MI, (0, 0, ZE + 0.35), top=False)
    zr = ZE + 0.35 + MH
    bm = bmesh.new()
    w2, d2, rh = W - 1.0 - 2 * MI, D - 1.0 - 2 * MI, 3.8
    r = max(abs(w2 - d2) / 2, 3.0)                  # the ridge along the longer side (a short one on a square)
    ridge = [(-r, 0, zr + rh), (r, 0, zr + rh)] if w2 >= d2 else [(0, -r, zr + rh), (0, r, zr + rh)]
    v = [bm.verts.new(p) for p in [(-w2 / 2, -d2 / 2, zr), (w2 / 2, -d2 / 2, zr), (w2 / 2, d2 / 2, zr), (-w2 / 2, d2 / 2, zr), *ridge]]
    if w2 < d2:                                    # (corner 0 next to ridge end 0: the faces below stay planar)
        v = [v[1], v[2], v[3], v[0], v[4], v[5]]
    for f in [(v[0], v[1], v[5], v[4]), (v[2], v[3], v[4], v[5]), (v[1], v[2], v[5]), (v[3], v[0], v[4])]:
        bm.faces.new(f)
    _obj(bm, m['slate'], uvscale=2.2)
    # the bays of the four sides
    for F, n in ((Face(0, D / 2), NX), (Face(math.pi, D / 2), NX), (Face(-math.pi / 2, W / 2), NY), (Face(math.pi / 2, W / 2), NY)):
        span = n * B
        for k in range(n + 1):                       # banded pilasters between the bays
            u = -span / 2 + k * B
            F.box(1.1, 0.3, ZC - Z2, u, 0.0, Z2, stone)
            bands(F, m, u, 1.1, Z2, ZC, d=0.3)
            F.box(1.9, 0.35, Z1 - Z0, u, 0.0, Z0, sand)
            F.box(1.0, 0.35, 0.7, u, 0.0, Z1 - 0.05, dress)                      # the panel in the frieze
        for k in range(n):
            u = -span / 2 + (k + 0.5) * B
            front_mid = F.yaw == 0 and k == n // 2
            if front_mid:
                # the great arched window over the entrance
                F.box(4.4, 0.1, 2.55, u, 0.0, Z2 + 0.15, dress)
                F.arch(2.2, 0.1, u, 0.0, Z2 + 2.7, dress, segs=16)
                F.box(3.6, 0.05, 2.4, u, 0.1, Z2 + 0.3, m['win_red'])
                F.arch(1.8, 0.05, u, 0.1, Z2 + 2.7, m['win_red'], segs=16)
                for j in (-1, 0, 1):
                    F.box(0.08, 0.06, 2.4 + (1.7 if j == 0 else 1.3), u + j * 0.9, 0.15, Z2 + 0.3, m['iron'])
                for zz in (0.9, 1.8, 2.7):
                    F.box(3.6 if zz < 2.5 else 3.4, 0.06, 0.08, u, 0.15, Z2 + 0.3 + zz, m['iron'])
                F.box(0.6, 0.25, 0.7, u, 0.1, Z2 + 4.6, dress)                   # the keystone
            else:
                for s in (-1.25, 1.25):                                          # the paired arched windows
                    sash(F, m, u + s, Z2 + 0.4, 1.4, 3.3, False, dress, head='arch', glass=m['win_red'] if rnd.random() < 0.4 else None)
                    F.box(0.5, 0.2, 0.45, u + s, 0.1, Z2 + 4.55, dress)          # a keystone
                # below: a window with a small pediment
                sash(F, m, u, Z0 + 0.4, 1.7, 1.9, rnd.random() < 0.15, dress)
                F.gable(2.4, 0.55, 0.3, u, 0.0, Z0 + 2.55, dress)
            # the dormer: a cross gable over the bay - a stone front under a curved gable with a wide window of a
            # segmental head, its pointed slate roof running back into the mansard (the saw-tooth of the film's roof)
            wd, gh, gr = 5.2, 1.6, 1.9            # a wall dormer: flush with the front, 3.5 m over the cornice
            F.box(wd, 0.5, gr, u, -0.2, ZE + 0.35, stone)
            F.segment(wd, gh, 0.5, u, -0.2, ZE + 0.35 + gr, stone)
            F.segment(wd + 0.7, gh + 0.2, 0.25, u, 0.25, ZE + 0.25 + gr, dress)
            a = F.at(u, -0.2 - 3.0, ZE + 0.35 + gr)
            prism([(-wd / 2 - 0.5, 0), (wd / 2 + 0.5, 0), (0, gh + 1.0)], 6.0, a, m['slate'], axis='y', rot=(0, 0, F.yaw))
            F.box(wd, 6.0, gr, u, -6.2, ZE + 0.35, stone)
            glass = m['win_lit'] if rnd.random() < 0.25 else m['win_dark']
            F.box(wd - 1.4, 0.05, 1.2, u, 0.3, ZE + 0.6, glass)
            F.segment(wd - 1.4, 0.8, 0.05, u, 0.3, ZE + 1.8, glass)
            F.segment(wd - 0.9, 1.0, 0.06, u, 0.3, ZE + 1.75, dress)
            for j in (-1, 0, 1):
                F.box(0.06, 0.05, 2.0 - 0.25 * abs(j), u + j * 0.9, 0.35, ZE + 0.6, m['iron'])
    # the entrance: steps up to the door, the door under its carved pediment, two cypresses in pots
    F = Face(0, D / 2)
    for s in range(4):
        F.box(4.6, 0.5, 0.3, 0, 0.3 + s * 0.5, Z0 + 0.3 - (s + 1) * 0.3, m['ashlar_grey'])
    for k in (-1, 1):
        cyl(0.55, 0.7, F.at(k * 3.0, 1.0, 0.0), m['concrete'], segs=10)
        cyl(0.75, 3.0, F.at(k * 3.0, 1.0, 0.7), m['hedge'], segs=10, r2=0.15)
    entrance(F, m, dress, Z0)
    # the corner towers: banded corners, a pink band at the frieze, tall windows, two storeys above the eaves with a
    # pediment on every face, an attic, a drum with blind arches, the tall dome
    ZT = ZE + 7.3                                  # (the towers' shafts rise well over the dormers)
    for sx in (-1, 1):
        for sy in (-1, 1):
            tx, ty = sx * (W / 2 + E - T / 2), sy * (D / 2 + E - T / 2)
            box((T, T, ZT), (tx, ty, 0), stone)
            box((T + 0.6, T + 0.6, Z0), (tx, ty, 0), sand)
            box((T + 0.3, T + 0.3, Z2 - Z1), (tx, ty, Z1), m['frieze'])
            box((T + 0.4, T + 0.4, 0.4), (tx, ty, ZC), dress)
            box((T + 0.8, T + 0.8, 0.45), (tx, ty, ZT), dress, bevel=0.05)
            for yaw in (0, math.pi, -math.pi / 2, math.pi / 2):
                G = Face(yaw, T / 2, tx, ty)
                tower_face(G, m, rnd, T, Z0, Z2, ZC, ZE, ZT, dress)
                G.gable(T + 0.2, 1.9, 0.5, 0, 0.0, ZT + 0.45, dress)
                G.gable(T - 1.2, 1.3, 0.55, 0, 0.0, ZT + 0.7, stone)
            box((T - 1.0, T - 1.0, 1.0), (tx, ty, ZT + 0.45), stone)
            cyl(2.55, 1.3, (tx, ty, ZT + 1.45), stone, segs=16)
            for k in range(8):                                           # the drum's blind arches
                a = 2 * math.pi * (k + 0.5) / 8
                G = Face(a - math.pi / 2, 2.5, tx, ty)
                G.box(0.9, 0.08, 0.5, 0, 0.0, ZT + 1.6, dress)
                G.arch(0.45, 0.08, 0, 0.0, ZT + 2.1, dress, segs=8)
            cyl(2.75, 0.25, (tx, ty, ZT + 2.75), dress, segs=16)
            dome(2.6, 3.6, (tx, ty, ZT + 3.0), m['soc_dome'], segs=16)
            cyl(0.55, 0.25, (tx, ty, ZT + 6.5), dress, segs=10)
    # the forecourt: the hedge along the front, a low brick wall with iron railings at the street, brick piers with
    # stone caps, the gate's piers with lamps, the paving to the steps
    fy = D / 2 + E + SOC_FORE
    hl = NX * B / 2 - 3.0                        # the hedges between the towers and the steps
    for k in (-1, 1):
        box((hl - 0.5, 1.0, 1.3), (k * (3.0 + hl / 2), D / 2 + 1.0, 0), m['hedge'], bevel=0.3)
    for a, b in ((-W / 2 - E - 1, -3.4), (3.4, W / 2 + E + 1)):
        cx = (a + b) / 2
        box((b - a, 0.6, 1.1), (cx, fy, 0), m['red_brick'])
        box((b - a, 0.7, 0.12), (cx, fy, 1.1), dress)
        box((b - a, 0.05, 1.2), (cx, fy, 1.22), m['iron'])
        for k in range(int((b - a) / 7) + 1):
            px = a + k * (b - a) / max(1, int((b - a) / 7))
            box((0.9, 0.9, 2.2), (px, fy, 0), m['red_brick'])
            box((1.1, 1.1, 0.2), (px, fy, 2.2), dress)
    for k in (-1, 1):
        box((1.6, 1.6, 3.0), (k * 3.4, fy, 0), m['red_brick'])
        box((1.9, 1.9, 0.3), (k * 3.4, fy, 3.0), dress)
        cyl(0.3, 0.8, (k * 3.4, fy, 3.3), m['lamp'], segs=8)
    box((6.0, fy - D / 2, 0.08), (0, D / 2 + (fy - D / 2) / 2, 0), m['paving'])
    e = E + 0.4
    return [(-W / 2 - e, -D / 2 - e, W / 2 + e, D / 2 + e), (-W / 2 - e, fy - 0.8, -3.4, fy + 0.4), (3.4, fy - 0.8, W / 2 + e, fy + 0.4)]


def tower_face(G, m, rnd, T, Z0, Z2, ZC, ZE, ZT, dress):
    """a face of the Society's towers: banded corners, the windows of its storeys, the pink bands"""
    for s in (-T / 2 + 0.4, T / 2 - 0.4):
        bands(G, m, s, 0.8, Z0, ZT, d=0.0)
    sash(G, m, 0, Z0 + 0.6, 0.7, 0.8, rnd.random() < 0.15, dress)
    sash(G, m, 0, Z0 + 2.1, 0.7, 0.8, rnd.random() < 0.15, dress)
    sash(G, m, 0, Z2 + 0.8, 1.0, 3.6, rnd.random() < 0.2, dress)
    sash(G, m, 0, ZE + 1.0, 0.9, 2.0, rnd.random() < 0.2, dress, head='arch')
    sash(G, m, 0, ZE + 4.6, 0.8, 1.0, rnd.random() < 0.2, dress, head='arch')
    G.box(T + 0.3, 0.1, 0.45, 0, 0.0, ZT - 0.6, m['frieze'])
    G.box(T + 0.3, 0.1, 0.45, 0, 0.0, ZE + 3.4, m['frieze'])
    G.box(T + 0.3, 0.1, 0.45, 0, 0.0, ZC + 0.1, m['frieze'])


def entrance(F, m, dress, Z0):
    """the Society's door in a stone surround under a carved pediment (the film's: no porch, the great window over it)"""
    F.box(3.2, 0.2, 2.9, 0, 0.0, Z0 + 0.2, dress)
    F.box(2.2, 0.15, 2.6, 0, 0.12, Z0 + 0.3, m['door_wood'])
    F.box(0.06, 0.05, 2.6, 0, 0.28, Z0 + 0.3, m['dark'])
    F.box(3.8, 0.5, 0.3, 0, 0.0, Z0 + 3.1, dress)
    F.gable(4.0, 0.8, 0.5, 0, 0.0, Z0 + 3.4, dress)
    F.gable(2.8, 0.45, 0.1, 0, 0.5, Z0 + 3.5, m['lamp'])                         # (the lit carving)


# ------------------------------------------------------------------------------------------------ the wheel
WHEEL_R = 30.0          # the rim's radius
WHEEL_HUB = 37.0        # the hub's height over the model's ground


def wheel_frame():
    """the big wheel's A-frame: two raking legs from a plinth on the bank up to the hub, the spindle, the backstays;
    the rim turns on it (wheel_rim, its own model)"""
    m = LM()
    steel = paint('wheel_steel', (0.80, 0.81, 0.82), grime=0.25)
    box((22.0, 12.0, 1.2), (0, -14.0, 0), m['ashlar_grey'], bevel=0.1)
    hub = Vector((0, 0, WHEEL_HUB))
    for sx in (-1, 1):
        foot = Vector((sx * 9.0, -16.0, 1.2))
        rod(foot, hub + Vector((sx * 1.5, -2.2, 0)), 0.9, steel, segs=10)
        for k in range(1, 6):     # the legs' lattice
            p = foot.lerp(hub, k / 6)
            rod(p, Vector((-p.x * 0.85, p.y, p.z)), 0.18, steel)
    rod(Vector((0, -3.0, WHEEL_HUB)), Vector((0, 3.0, WHEEL_HUB)), 1.3, steel, segs=12)        # the spindle
    for sx in (-1, 1):      # the backstays to the anchors behind
        rod(Vector((sx * 1.5, -2.2, WHEEL_HUB)), Vector((sx * 6.0, -19.5, 1.2)), 0.12, m['iron'])
    for sx in (-1, 1):
        box((2.5, 2.5, 1.5), (sx * 6.0, -19.5, 0), m['ashlar_grey'])
    # the boarding platform round the bottom of the rim
    box((14.0, 6.0, 0.6), (0, 0, 2.6), m['paving'])
    for sx in (-1, 1):
        box((0.5, 0.5, 2.6), (sx * 6.5, 0, 0), steel)
        box((14.0, 0.06, 1.0), (0, sx * 3.0, 3.2), m['iron'])
    for k in range(6):
        box((0.6, 0.3, 0.2), (-6.0 + k * 2.4, 2.9, 3.0), m['lamp'])
    return [(-11.0, -20.5, 11.0, -8.0)]


def wheel_rim():
    """the turning rim: a truss of two rings, cable spokes to the hub, thirty-two lit glass capsules outside;
    the axle along y at the origin (the frame's hub)"""
    m = LM()
    steel = paint('rim_steel', (0.82, 0.83, 0.84), grime=0.2)
    cap = glow('capsule', (0.92, 0.94, 0.88), 0.85)
    R, N = WHEEL_R, 48
    for y in (-1.2, 1.2):
        pts = [Vector((R * math.cos(2 * math.pi * k / N), y, R * math.sin(2 * math.pi * k / N))) for k in range(N)]
        for k in range(N):
            rod(pts[k], pts[(k + 1) % N], 0.35, steel, segs=6)
    inner = [Vector((0.92 * R * math.cos(2 * math.pi * k / N), 0, 0.92 * R * math.sin(2 * math.pi * k / N))) for k in range(N)]
    for k in range(N):
        rod(inner[k], inner[(k + 1) % N], 0.25, steel, segs=6)
        for y in (-1.2, 1.2):
            rod(inner[k], Vector((R * math.cos(2 * math.pi * k / N), y, R * math.sin(2 * math.pi * k / N))), 0.1, steel, segs=4)
    for k in range(0, N, 2):    # the spokes: cables from the hub's ends
        a = 2 * math.pi * k / N
        for y in (-1.2, 1.2):
            rod(Vector((0, y * 2.0, 0)), Vector((R * math.cos(a), y, R * math.sin(a))), 0.06, m['iron'], segs=4)
    cyl(2.0, 5.0, (0, 2.5, 0), steel, segs=16, rot=(math.pi / 2, 0, 0))
    for k in range(32):        # the capsules, hung outside the rim
        a = 2 * math.pi * k / 32
        c = Vector(((R + 2.4) * math.cos(a), 0, (R + 2.4) * math.sin(a)))
        rod(Vector((R * math.cos(a), 0, R * math.sin(a))), c, 0.25, steel, segs=6)
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1.0)
        bmesh.ops.scale(bm, vec=Vector((1.3, 3.4, 1.3)), verts=bm.verts)
        bmesh.ops.translate(bm, vec=c, verts=bm.verts)
        _obj(bm, cap, smooth=True)


# ------------------------------------------------------------------------------------------------ the pier
def pier():
    """the long landing pier by the wheel: a deck on lattice legs over the water and a long orange roof over it,
    lamps along its edge (the film's); the model's ground is the deck, the legs reach 6 m down"""
    m = LM()
    steel = paint('pier_steel', (0.62, 0.64, 0.66), grime=0.3)
    orange = paint('pier_roof', (0.86, 0.50, 0.20), grime=0.25)
    L, B = 46.0, 9.0
    box((L, B, 0.5), (0, 0, -0.5), m['paving'])
    box((L, B + 0.4, 0.4), (0, 0, -0.9), steel)
    for x in (-L / 2 + 2, -L / 6, L / 6, L / 2 - 2):
        for sy in (-1, 1):
            rod(Vector((x, sy * 3.5, -7.0)), Vector((x, sy * 3.5, -0.9)), 0.35, steel)
        for z in (-6.0, -3.5):
            rod(Vector((x, -3.5, z)), Vector((x, 3.5, z + 2.5)), 0.12, steel)
            rod(Vector((x, 3.5, z)), Vector((x, -3.5, z + 2.5)), 0.12, steel)
    for x in range(-int(L / 2) + 2, int(L / 2) - 1, 6):
        box((0.3, 0.3, 3.6), (x, -3.6, 0), steel)
        box((0.3, 0.3, 3.6), (x, 3.6, 0), steel)
        box((0.5, 0.3, 0.25), (x + 3, 3.9, 3.0), m['lamp'])
    prism([(-5.2, 0), (5.2, 0), (4.6, 0.7), (0, 1.3), (-4.6, 0.7)], L + 1.0, (0, 0, 3.6), orange, axis='x')
    box((L, 0.05, 1.0), (0, 4.4, 0), m['iron'])
    box((L - 12, 0.05, 1.0), (6, -4.4, 0), m['iron'])
    # the gangway to the bank
    box((4.0, 8.0, 0.4), (-L / 2 + 6, -8.4, -0.4), m['paving'])
    return [(-L / 2, -B / 2, L / 2, B / 2)]


# ------------------------------------------------------------------------------------------------ the bridge
BRIDGE_L = 150.0


def bridge():
    """an iron suspension bridge (the film's, upstream of the wheel): a deck of 150 m with a roadway and pavements,
    two towers of iron columns on stone piers in the river, the chains and the stays between them, lamps along the
    parapets; along x, the deck at the model's ground"""
    m = LM()
    iron = paint('bridge_iron', (0.42, 0.45, 0.48), grime=0.3)
    L, B = BRIDGE_L, 16.0
    box((L, B, 0.8), (0, 0, -0.8), iron)
    box((L, 9.0, 0.06), (0, 0, 0.0), paint('roadway', (0.22, 0.22, 0.23), grime=0.1))
    for sy in (-1, 1):
        box((L, 3.2, 0.25), (0, sy * 6.2, 0.0), m['paving'])
        box((L, 0.3, 1.2), (0, sy * 7.9, 0.0), iron)
        box((L, 0.4, 0.12), (0, sy * 7.9, 1.2), m['dressing'])
    box((L, B - 2, 1.6), (0, 0, -2.4), iron)                                         # the girder under the deck
    towers = (-L / 4, L / 4)
    for tx in towers:
        box((10.0, B + 6, 8.0), (tx, 0, -8.6), m['ashlar_grey'], bevel=0.2)          # the pier
        for sy in (-1, 1):
            box((2.2, 2.2, 24.0), (tx, sy * 8.8, -0.6), iron, bevel=0.15)
            box((2.8, 2.8, 1.0), (tx, sy * 8.8, 23.4), m['dressing'])
            cyl(0.7, 1.4, (tx, sy * 8.8, 24.4), m['lamp'], segs=8)
        for z in (14.0, 21.0):
            box((1.6, B + 2, 1.4), (tx, 0, z), iron)
    # the chains: from the anchors at the ends over the towers' tops, a curve down to the deck between them
    top = 23.0
    for sy in (-1, 1):
        y = sy * 8.6
        pts = [Vector((-L / 2, y, 1.4)), Vector((towers[0], y, top))]
        for k in range(1, 12):
            t = k / 12
            x = towers[0] + (towers[1] - towers[0]) * t
            pts.append(Vector((x, y, 2.5 + (top - 2.5) * (2 * t - 1) ** 2)))
        pts += [Vector((towers[1], y, top)), Vector((L / 2, y, 1.4))]
        for a, b in zip(pts, pts[1:]):
            rod(a, b, 0.3, iron, segs=6)
        for p in pts[2:-2]:
            rod(Vector((p.x, y, 1.2)), p, 0.07, m['iron'], segs=4)            # the hangers
        for tx in towers:      # the stays fanning from the towers' tops
            for k in range(1, 5):
                for s in (-1, 1):
                    rod(Vector((tx, y, top - 1.0)), Vector((tx + s * k * 7.0, y, 1.2)), 0.06, m['iron'], segs=4)
    # lamps along the parapets
    for x in range(-int(L / 2) + 8, int(L / 2), 16):
        for sy in (-1, 1):
            cyl(0.12, 4.0, (x, sy * 7.9, 1.2), m['iron'], segs=6)
            box((0.5, 0.5, 0.7), (x, sy * 7.9, 5.2), m['lamp'])
    return [(-L / 2, -B / 2 - 1, L / 2, -B / 2), (-L / 2, B / 2, L / 2, B / 2 + 1)]


# ------------------------------------------------------------------------------------------------ the embankment
def quay(steps=False):
    """16 m of the embankment wall: granite blocks down to the water (5 m under the street), a coping, a parapet with
    a lamp; with steps: a flight down to the water inside the wall (the river stairs)"""
    m = LM()
    L = 16.0
    box((L, 3.0, 6.0), (0, 1.5, -6.0), m['ashlar_grey'])
    box((L, 1.0, 0.3), (0, 0.6, 0.0), m['dressing'])
    box((L, 0.6, 1.0), (0, 0.5, 0.3), m['ashlar_grey'])
    box((L, 0.8, 0.12), (0, 0.5, 1.3), m['dressing'])
    for x in (-L / 2 + 0.4, L / 2 - 0.4):
        box((0.9, 0.9, 1.6), (x, 0.5, 0.0), m['ashlar_grey'])
    cyl(0.14, 4.2, (0, 0.5, 1.3), m['iron'], segs=8)
    for k in (-1, 1):
        box((0.4, 0.4, 0.6), (k * 0.5, 0.5, 5.2), m['lamp'])
        box((1.4, 0.08, 0.08), (0, 0.5, 5.4), m['iron'])
    for x in (-5.0, 5.0):           # mooring rings and the green of the water line
        cyl(0.3, 0.1, (x, 3.05, -2.0), m['iron'], segs=8, rot=(math.pi / 2, 0, 0))
    box((L, 0.05, 1.2), (0, 3.02, -5.6), paint('weed', (0.16, 0.20, 0.12), grime=0.2))
    if steps:
        for k in range(12):
            box((3.0, 0.45, 0.45), (-L / 2 + 3.0, 0.4 + k * 0.45 * 0.5, -0.45 * (k + 1)), m['ashlar_grey'])
        box((3.4, 3.0, 0.3), (-L / 2 + 3.0, 4.5, -5.5), m['ashlar_grey'])
    return []


def lamp_post():
    """a cast-iron lamp standard of the embankment: fluted column, a scrolled bracket, a lantern"""
    m = LM()
    cyl(0.32, 0.8, (0, 0, 0), m['iron'], segs=10)
    cyl(0.16, 3.6, (0, 0, 0.8), m['iron'], segs=10, r2=0.11)
    cyl(0.22, 0.25, (0, 0, 4.3), m['iron'], segs=10)
    cyl(0.32, 0.8, (0, 0, 4.55), m['lamp'], segs=8, r2=0.24)
    cyl(0.38, 0.35, (0, 0, 5.35), m['iron'], segs=8, r2=0.08)
    return []


def stall():
    """a market stall of the embankment: a counter under a red and white striped awning"""
    m = LM()
    wood = tex('stall_wood', 'Planks037A', tint=(0.50, 0.36, 0.22), strength=0.7, scale=1.2, grime=0.3)
    red, white = paint('awning_red', (0.72, 0.12, 0.10), grime=0.2), paint('awning_white', (0.92, 0.90, 0.84), grime=0.2)
    box((3.0, 1.4, 1.0), (0, 0, 0), wood)
    for x in (-1.4, 1.4):
        for y in (-0.8, 0.8):
            box((0.1, 0.1, 2.3), (x, y, 0), wood)
    for k in range(6):
        prism([(-1.1, 0), (1.1, 0), (1.1, 0.06), (-1.1, 0.5)], 0.52, (-1.3 + k * 0.52, 0.2, 2.3), red if k % 2 == 0 else white, axis='x')
    for k in range(5):
        box((0.4, 0.3, 0.25), (-1.0 + k * 0.5, 0, 1.0), paint(f'goods{k % 3}', [(0.8, 0.6, 0.2), (0.4, 0.6, 0.2), (0.7, 0.3, 0.2)][k % 3], grime=0.2))
    return []


# ------------------------------------------------------------------------------------------------ the boats
def riverboat():
    """a passenger boat of the river: a dark hull, two decks of white cabins with lit windows, a wheelhouse, a funnel;
    the waterline at the model's ground"""
    m = LM()
    hull = paint('hull', (0.12, 0.13, 0.15), grime=0.2)
    white = paint('cabin_white', (0.88, 0.88, 0.84), grime=0.3)
    L, B = 30.0, 7.0
    prism([(-L / 2, -1.2), (L / 2 - 4, -1.2), (L / 2, 1.0), (-L / 2, 1.0)], B, (0, 0, 0), hull, axis='y')
    box((L - 4, B - 0.6, 0.15), (-1, 0, 1.0), m['paving'])
    box((L - 8, B - 1.2, 2.4), (-3, 0, 1.15), white)
    box((L - 12, B - 1.6, 2.0), (-4, 0, 3.55), white)
    box((L - 6, B - 0.4, 0.15), (-3, 0, 3.55), white)
    for z, n, x0, x1 in ((1.6, 9, -L / 2 + 5, L / 2 - 7), (3.9, 7, -L / 2 + 7, L / 2 - 9)):
        for k in range(n):
            x = x0 + (x1 - x0) * k / (n - 1)
            for sy in (-1, 1):
                box((1.2, 0.05, 1.0), (x, sy * ((B - 1.2) / 2 if z < 3 else (B - 1.6) / 2), z), m['win_lit'])
    box((3.0, 3.0, 1.8), (L / 2 - 9.5, 0, 5.55), white)
    box((2.6, 3.1, 0.7), (L / 2 - 9.5, 0, 6.3), m['win_lit'])
    cyl(0.6, 2.6, (-6, 0, 5.55), paint('funnel', (0.55, 0.12, 0.10), grime=0.3), segs=12)
    box((L - 2, 0.06, 0.9), (-1, B / 2 - 0.1, 1.15), m['iron'])
    box((L - 2, 0.06, 0.9), (-1, -B / 2 + 0.1, 1.15), m['iron'])
    return [(-L / 2, -B / 2, L / 2, B / 2)]


def barge():
    """a lighter of the river: a long flat hull under black tarpaulins (the film's), the waterline at the ground"""
    m = LM()
    hull = paint('barge_hull', (0.20, 0.17, 0.15), grime=0.4)
    tarp = paint('tarp', (0.10, 0.11, 0.10), grime=0.2, noise=0.15)
    L, B = 26.0, 7.0
    box((L, B, 1.6), (0, 0, -0.8), hull, bevel=0.3)
    prism([(-B / 2 + 0.4, 0), (B / 2 - 0.4, 0), (B / 2 - 0.6, 0.8), (0, 1.2), (-B / 2 + 0.6, 0.8)], L - 2.0, (0, 0, 0.8), tarp, axis='x')
    for x in range(-11, 12, 3):
        box((0.12, B - 0.6, 0.12), (x, 0, 1.95), m['iron'])
    return [(-L / 2, -B / 2, L / 2, B / 2)]


def tug():
    """a river tug: a black hull with a red band, a wheelhouse with its lamps on, a tall funnel"""
    m = LM()
    hull = paint('tug_hull', (0.10, 0.10, 0.11), grime=0.3)
    red = paint('tug_red', (0.62, 0.14, 0.10), grime=0.3)
    L, B = 12.0, 4.6
    prism([(-L / 2, -1.0), (L / 2 - 2.5, -1.0), (L / 2, 1.2), (-L / 2, 1.2)], B, (0, 0, 0), hull, axis='y')
    box((L - 1.0, B + 0.1, 0.3), (-0.5, 0, 0.9), red)
    box((4.0, 3.2, 2.0), (-0.5, 0, 1.2), paint('tug_cabin', (0.78, 0.72, 0.58), grime=0.4))
    box((3.6, 3.3, 0.8), (-0.5, 0, 2.2), m['win_lit'])
    box((4.4, 3.6, 0.2), (-0.5, 0, 3.2), hull)
    cyl(0.5, 2.8, (-3.2, 0, 1.2), red, segs=10)
    cyl(0.52, 0.5, (-3.2, 0, 4.0), hull, segs=10)
    return [(-L / 2, -B / 2, L / 2, B / 2)]
