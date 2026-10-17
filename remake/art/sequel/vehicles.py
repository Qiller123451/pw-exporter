"""Vehicles of 1964: the family cars, the school bus, the Army's trucks and the SEAS machines of the sequel
(art/sequel/kit.py; the front looks along +y, built at life size and scaled by build.py)."""
import math
from .kit import box, cyl, prism, loft, tex, paint, mirror, glow, party
from .town import M

CAR_PAINT = {'cherry': (0.62, 0.06, 0.07), 'aqua': (0.36, 0.72, 0.70), 'butter': (0.93, 0.80, 0.42), 'navy': (0.10, 0.16, 0.34),
             'sage': (0.52, 0.60, 0.46), 'pink': (0.92, 0.62, 0.66)}


def wheel(m, x, y, r, w, side, hub=None, white=None, z=None):
    """a tyre on the axle at (x, y), its outer face on the side `side` (+1 / -1)"""
    z = r if z is None else z
    rot = (0, math.pi / 2 * side, 0)
    cyl(r, w, (x - side * w, y, z), m['rubber'], segs=20, rot=rot, bevel=0.03)
    if white is not None:
        cyl(r * 0.74, 0.02, (x, y, z), white, segs=20, rot=rot)
    cyl(r * 0.5, 0.05, (x, y, z), hub or m['chrome'], segs=16, rot=rot)
    cyl(r * 0.16, 0.08, (x, y, z), hub or m['chrome'], segs=8, rot=rot)


def olive(grime=0.6):
    return tex('olive', 'green_metal_rust', tint=(0.33, 0.36, 0.22), strength=0.7, scale=2.0, grime=grime)


# ------------------------------------------------------------------------------------------------ the family cars
def _car_body(m, body, length=5.3, fins=True):
    WF, WR, R = 1.62, -1.48, 0.37
    half = length / 2

    def arch(y):
        for wy in (WF, WR):
            d = abs(y - wy)
            if d < 0.48:
                return 0.30 + (0.74 - 0.30) * math.sqrt(max(0, 1 - (d / 0.48) ** 2))
        return 0.30

    def top_z(y):
        if fins and y < -1.9:
            return 0.92 + (y + 1.9) / -0.76 * 0.10
        if y > 1.4:
            return 0.86 + (y - 1.4) * 0.02
        return 0.90 - (y + 1.9) * 0.012
    ys = sorted(set([-half, -half + 0.08, -half + 0.21, -2.2, -1.96, -1.80, -1.64, -1.48, -1.32, -1.16, -1.0, -0.5, 0.0, 0.5, 1.0, 1.14, 1.30, 1.46, 1.62, 1.78, 1.94, 2.10, 2.35, half - 0.11, half]))
    sections = []
    for y in ys:
        hw = 0.98 - (0.10 if abs(y) > half - 0.15 else 0.0) - (0.04 if abs(y) > half - 0.35 else 0.0)
        zb = arch(y) if abs(y) < half - 0.35 else 0.36
        zt = top_z(y) if abs(y) < half - 0.05 else top_z(y) - 0.08
        sections.append((y, hw, zb, zt, 0.12, 0.93))
    loft(sections, body, ring=24)
    return WF, WR, R


def _car_trim(m, top, half=2.65):
    for sx in (-1, 1):
        box((0.03, 3.9, 0.04), (sx * 0.985, -0.1, 0.70), m['chrome'])
    for y, s in ((half + 0.05, 1), (-half - 0.05, -1)):
        loft([(y - s * 0.10, 0.97, 0.30, 0.47, 0.5, 1.0), (y + s * 0.04, 0.93, 0.32, 0.45, 0.5, 1.0)], m['chrome'], ring=12)
    box((1.3, 0.06, 0.24), (0, half - 0.01, 0.47), m['dark'])
    for k in range(6):
        box((1.24, 0.03, 0.02), (0, half + 0.02, 0.49 + k * 0.035), m['chrome'])
    for sx in (-1, 1):
        cyl(0.13, 0.08, (sx * 0.70, half - 0.07, 0.70), m['chrome'], segs=14, rot=(-math.pi / 2, 0, 0))
        cyl(0.10, 0.04, (sx * 0.70, half, 0.70), glow('headlamp', (1.0, 0.97, 0.85), 0.6), segs=14, rot=(-math.pi / 2, 0, 0))
        box((0.10, 0.06, 0.26), (sx * 0.80, -half + 0.01, 0.66), glow('taillamp', (0.85, 0.08, 0.06), 0.5), bevel=0.02)


def _car_wheels(m, WF, WR, R):
    white = paint('whitewall', (0.92, 0.92, 0.9), grime=0.2)
    for wy in (WF, WR):
        for sx in (-1, 1):
            wheel(m, sx * 0.94, wy, R, 0.24, sx, white=white)
    box((1.6, 4.6, 0.08), (0, 0, 0.24), m['dark'])


def sedan(color='aqua', roof=(0.93, 0.92, 0.88)):
    """a 1957-ish sedan: long hood, tail fins, a two-tone roof, chrome bumpers and whitewall tyres (5.3 m)"""
    m = M()
    body = paint('car_' + color, CAR_PAINT[color], grime=0.4, rough=0.25, noise=0.04)
    top = paint('car_roof', roof, grime=0.3, rough=0.3, noise=0.04)
    WF, WR, R = _car_body(m, body)
    g = [(-1.62, 0.84, 0.86, 0.90, 0.25, 0.86), (-1.10, 0.84, 0.86, 1.40, 0.25, 0.80), (-0.42, 0.84, 0.86, 1.43, 0.25, 0.80)]
    loft(g, m['glass'], ring=16)
    loft([(-0.42, 0.85, 0.86, 1.43, 0.25, 0.80), (-0.30, 0.85, 0.86, 1.43, 0.25, 0.80)], top, ring=16)
    loft([(-0.30, 0.84, 0.86, 1.43, 0.25, 0.80), (0.35, 0.84, 0.86, 1.42, 0.25, 0.80), (1.00, 0.84, 0.86, 0.90, 0.25, 0.86)], m['glass'], ring=16)
    loft([(-1.12, 0.70, 1.39, 1.46, 0.2, 0.94), (-0.4, 0.71, 1.41, 1.48, 0.2, 0.94), (0.37, 0.70, 1.40, 1.47, 0.2, 0.94)], top, ring=16)
    for sx in (-1, 1):
        box((0.02, 1.1, 0.16), (sx * 0.975, -2.05, 0.68), top)
    _car_trim(m, top)
    _car_wheels(m, WF, WR, R)


def wagon(color='sage', roof=(0.55, 0.38, 0.22)):
    """a station wagon: the long roof to the tailgate, wood-grain sides"""
    m = M()
    body = paint('car_' + color, CAR_PAINT[color], grime=0.4, rough=0.25, noise=0.04)
    top = paint('car_roof_light', (0.90, 0.89, 0.85), grime=0.3, rough=0.3, noise=0.04)
    wood = tex('woodgrain', 'Planks037A', tint=(0.55, 0.36, 0.20), strength=0.6, scale=1.4, grime=0.2)
    WF, WR, R = _car_body(m, body, fins=False)
    loft([(-2.55, 0.84, 0.86, 1.36, 0.22, 0.84), (-0.42, 0.84, 0.86, 1.43, 0.22, 0.80)], m['glass'], ring=16)
    loft([(-0.42, 0.85, 0.86, 1.43, 0.22, 0.80), (-0.30, 0.85, 0.86, 1.43, 0.22, 0.80)], top, ring=16)
    loft([(-1.6, 0.85, 0.86, 1.40, 0.22, 0.81), (-1.48, 0.85, 0.86, 1.40, 0.22, 0.81)], top, ring=16)
    loft([(-0.30, 0.84, 0.86, 1.43, 0.22, 0.80), (0.35, 0.84, 0.86, 1.42, 0.22, 0.80), (1.00, 0.84, 0.86, 0.90, 0.22, 0.86)], m['glass'], ring=16)
    loft([(-2.58, 0.71, 1.36, 1.44, 0.2, 0.94), (-0.4, 0.71, 1.41, 1.48, 0.2, 0.94), (0.37, 0.70, 1.40, 1.47, 0.2, 0.94)], top, ring=16)
    for sx in (-1, 1):
        box((0.02, 4.0, 0.34), (sx * 0.985, -0.35, 0.40), wood)
        box((1.5, 0.4, 0.05), (0, -1.6 + sx * 0.6, 1.49), m['chrome'])     # the roof rack
    _car_trim(m, top)
    _car_wheels(m, WF, WR, R)


def pickup(color='navy'):
    """a stepside pickup truck: rounded cab, a short hood, the bed with planks and a spare wheel"""
    m = M()
    body = paint('car_' + color, CAR_PAINT[color], grime=0.35, rough=0.4, noise=0.02)
    wood = tex('bedwood', 'Planks037A', scale=1.2, grime=0.4)
    R = 0.38
    # hood and front fenders
    loft([(2.45, 0.70, 0.55, 1.05, 0.25, 0.9), (2.55, 0.66, 0.60, 1.00, 0.35, 0.9), (0.85, 0.72, 0.55, 1.15, 0.2, 0.9)], body, ring=16)
    for sx in (-1, 1):
        loft([(2.5, 0.20, 0.55, 0.90, 0.6, 0.8), (1.6, 0.24, 0.45, 1.00, 0.6, 0.8), (0.7, 0.22, 0.45, 0.75, 0.6, 0.8)], body, loc=(sx * 0.82, 0, 0), ring=12)
    # the cab
    loft([(0.85, 0.88, 0.50, 1.20, 0.2, 0.92), (0.75, 0.88, 0.50, 1.95, 0.25, 0.86), (-0.55, 0.88, 0.50, 1.98, 0.25, 0.86), (-0.62, 0.88, 0.50, 1.90, 0.2, 0.86)], body, ring=16)
    box((1.36, 0.06, 0.55), (0, 0.80, 1.28), m['glass'], rot=(-0.25, 0, 0))
    for sx in (-1, 1):
        box((0.04, 0.8, 0.5), (sx * 0.87, 0.1, 1.30), m['glass'])
    box((1.0, 0.04, 0.35), (0, -0.62, 1.40), m['glass'])
    # the bed
    box((1.6, 2.4, 0.08), (0, -1.9, 0.75), wood)
    for sx in (-1, 1):
        box((0.06, 2.4, 0.55), (sx * 0.8, -1.9, 0.78), body)
        loft([(-0.9, 0.22, 0.45, 0.85, 0.6, 0.8), (-1.7, 0.26, 0.40, 1.00, 0.6, 0.8), (-2.5, 0.22, 0.45, 0.8, 0.6, 0.8)], body, loc=(sx * 0.98, 0, 0), ring=12)
    box((1.6, 0.06, 0.55), (0, -3.1, 0.78), body)
    box((1.6, 0.06, 0.55), (0, -0.7, 0.78), body)
    cyl(0.34, 0.22, (0.3, -2.2, 0.83), m['rubber'], segs=18)        # a spare wheel lying in the bed
    # grille, lamps, bumpers
    box((1.0, 0.06, 0.4), (0, 2.56, 0.6), m['chrome'])
    for k in range(5):
        box((0.9, 0.03, 0.03), (0, 2.6, 0.64 + k * 0.07), m['dark'])
    for sx in (-1, 1):
        cyl(0.12, 0.1, (sx * 0.82, 2.35, 0.95), m['chrome'], segs=12, rot=(-math.pi / 2, 0, 0))
        cyl(0.09, 0.04, (sx * 0.82, 2.45, 0.95), glow('headlamp', (1.0, 0.97, 0.85), 0.6), segs=12, rot=(-math.pi / 2, 0, 0))
    box((1.9, 0.12, 0.16), (0, 2.65, 0.4), m['chrome'], bevel=0.03)
    box((1.8, 0.12, 0.14), (0, -3.18, 0.45), m['chrome'], bevel=0.03)
    for wy in (1.6, -1.7):
        for sx in (-1, 1):
            wheel(m, sx * 0.98, wy, R, 0.24, sx, hub=paint('hub_red', (0.6, 0.12, 0.08)))
    box((1.5, 5.4, 0.1), (0, -0.3, 0.3), m['dark'])


# ------------------------------------------------------------------------------------------------ the school bus
def bus():
    """a 1960s conventional school bus: chrome-yellow, black rub rails, a row of windows, the hood in front"""
    m = M()
    yellow = paint('bus_yellow', (0.95, 0.68, 0.10), grime=0.45, rough=0.5, noise=0.03)
    L = 9.8
    # the body (rounded roof)
    loft([(-L / 2, 1.18, 0.75, 3.0, 0.18, 0.92), (-L / 2 + 0.15, 1.20, 0.65, 3.1, 0.18, 0.92), (2.6, 1.20, 0.65, 3.1, 0.18, 0.92), (2.75, 1.18, 0.75, 3.0, 0.18, 0.92)], yellow, ring=20)
    # hood, fenders, grille
    loft([(2.7, 0.75, 0.75, 1.75, 0.2, 0.9), (4.2, 0.72, 0.75, 1.60, 0.25, 0.85), (4.35, 0.68, 0.80, 1.50, 0.35, 0.85)], yellow, ring=16)
    for sx in (-1, 1):
        loft([(4.3, 0.24, 0.65, 1.05, 0.5, 0.8), (3.5, 0.30, 0.55, 1.25, 0.5, 0.8), (2.75, 0.28, 0.55, 1.00, 0.5, 0.8)], yellow, loc=(sx * 0.98, 0, 0), ring=12)
    box((1.1, 0.06, 0.7), (0, 4.36, 0.85), m['chrome'], bevel=0.02)
    for k in range(8):
        box((1.0, 0.03, 0.03), (0, 4.4, 0.9 + k * 0.08), m['dark'])
    # windows down both sides, the windscreen, the door
    for sx in (-1, 1):
        for k in range(8):
            y = 1.9 - k * 0.98
            box((0.06, 0.82, 0.62), (sx * 1.205, y, 1.95), m['glass'])
            box((0.08, 0.1, 0.7), (sx * 1.21, y - 0.48, 1.92), yellow)
        for z in (1.0, 1.55, 2.75):
            box((0.05, 2.75 + L / 2 - 0.2, 0.09), (sx * 1.225, (2.75 - L / 2) / 2, z), m['dark'])
    box((2.1, 0.06, 0.75), (0, 2.76, 2.05), m['glass'], rot=(-0.12, 0, 0))
    box((0.06, 0.85, 1.9), (1.21, 2.25, 0.62), m['glass'])          # the folding door
    box((2.0, 0.06, 0.8), (0, -L / 2 - 0.01, 1.75), m['glass'])      # the emergency door window
    # lamps on the roof (red flashers), mirrors, bumpers
    for sx in (-0.6, 0.6):
        cyl(0.12, 0.1, (sx, 2.73, 2.85), glow('flasher', (0.95, 0.15, 0.08), 0.7), segs=10, rot=(-math.pi / 2, 0, 0))
        cyl(0.12, 0.1, (sx, -L / 2 - 0.05, 2.85), glow('flasher', (0.95, 0.15, 0.08), 0.7), segs=10, rot=(math.pi / 2, 0, 0))
    for sx in (-1, 1):
        cyl(0.13, 0.08, (sx * 0.62, 4.15, 1.35), m['chrome'], segs=12, rot=(-math.pi / 2, 0, 0))
        box((0.05, 0.05, 0.6), (sx * 1.45, 3.0, 1.6), m['dark'])
        box((0.06, 0.18, 0.35), (sx * 1.48, 3.0, 2.15), m['chrome'])
    box((2.4, 0.18, 0.22), (0, 4.45, 0.5), m['dark'], bevel=0.03)
    box((2.4, 0.18, 0.22), (0, -L / 2 - 0.1, 0.55), m['dark'], bevel=0.03)
    letters_side(m, yellow)
    for wy in (3.4, -2.8):
        for sx in (-1, 1):
            wheel(m, sx * 1.12, wy, 0.48, 0.3, sx, hub=paint('hub_black', (0.12, 0.12, 0.12)))
    box((1.8, L, 0.15), (0, -0.4, 0.42), m['dark'])


def letters_side(m, yellow):
    """'SCHOOL BUS' over the windscreen"""
    from .town import letters
    black = paint('letter_black', (0.06, 0.06, 0.06), grime=0.0, noise=0.0)
    letters(black, 'SCHOOL BUS', 0, 2.78, 2.62, 0.22)


# ------------------------------------------------------------------------------------------------ the Army's trucks
def _army_cab(m, body, y0=1.6):
    """the cab and hood of a 2 1/2-ton cargo truck, the windscreen at y0"""
    # hood and the flat fenders
    box((1.2, 1.7, 0.85), (0, y0 + 1.05, 1.05), body, bevel=0.05)
    box((1.25, 0.12, 0.85), (0, y0 + 1.95, 1.05), m['dark'])                       # the grille guard
    for k in range(6):
        box((0.05, 0.14, 0.75), (-0.5 + k * 0.2, y0 + 1.98, 1.1), body)
    for sx in (-1, 1):
        prism([(y0 + 2.1, 1.25), (y0 + 1.75, 1.45), (y0 + 0.2, 1.45), (y0 + 0.2, 1.15), (y0 + 2.1, 1.15)], 0.62, (sx * 0.95, 0, 0), body, axis='x')
        cyl(0.13, 0.1, (sx * 0.45, y0 + 1.97, 1.62), m['chrome'], segs=12, rot=(-math.pi / 2, 0, 0))
        cyl(0.10, 0.04, (sx * 0.45, y0 + 2.04, 1.62), glow('headlamp', (1.0, 0.97, 0.85), 0.5), segs=12, rot=(-math.pi / 2, 0, 0))
    # the cab: open sides with a canvas top, the folding windscreen
    box((2.1, 1.3, 0.75), (0, y0 - 0.55, 1.05), body, bevel=0.03)
    box((2.0, 0.08, 0.7), (0, y0 + 0.1, 1.8), m['glass'], rot=(-0.05, 0, 0))
    box((2.1, 0.1, 0.08), (0, y0 + 0.1, 2.5), body)
    for sx in (-1, 1):
        box((0.08, 0.1, 0.78), (sx * 1.02, y0 + 0.1, 1.78), body)
    canvas = tex('canvas', 'hessian_230', tint=(0.40, 0.40, 0.26), strength=0.75, scale=1.0, grime=0.35)
    box((2.15, 1.35, 0.1), (0, y0 - 0.55, 2.5), canvas, bevel=0.03)
    for sx in (-1, 1):
        box((0.04, 1.2, 0.7), (sx * 1.06, y0 - 0.6, 1.8), canvas)
        box((0.06, 0.06, 0.4), (sx * 1.2, y0 + 0.05, 1.9), m['dark'])
        box((0.05, 0.22, 0.32), (sx * 1.25, y0 + 0.05, 2.15), m['chrome'])
    # the white star of the Army
    star(paint('star_white', (0.92, 0.92, 0.88), grime=0.2), 0, y0 + 1.06, 1.91, 0.3)


def star(mat, x, y, z, r):
    """a five-pointed star lying on the surface at height z"""
    pts = []
    for i in range(10):
        a = math.pi / 2 + i * math.pi / 5
        rr = r if i % 2 == 0 else r * 0.4
        pts.append((x + rr * math.cos(a), y + rr * math.sin(a)))
    from .kit import _obj
    import bmesh
    bm = bmesh.new()
    vs = [bm.verts.new((px, py, z)) for px, py in pts]
    c = bm.verts.new((x, y, z))
    for i in range(10):
        bm.faces.new((c, vs[i], vs[(i + 1) % 10]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    return _obj(bm, mat)


def _six_wheels(m, ys, x=0.98, r=0.5):
    for wy in ys:
        for sx in (-1, 1):
            wheel(m, sx * x, wy, r, 0.32, sx, hub=olive())
    box((1.1, 6.6, 0.3), (0, -0.3, 0.55), m['dark'])


def army_truck():
    """an M35 2 1/2-ton cargo truck: olive drab, a canvas cover over the bed on bows"""
    m = M()
    body = olive()
    _army_cab(m, body)
    canvas = tex('canvas', 'hessian_230', tint=(0.40, 0.40, 0.26), strength=0.75, scale=1.0, grime=0.35)
    wood = tex('bedwood', 'Planks037A', scale=1.2, grime=0.4)
    # the bed and its cover
    box((2.3, 3.9, 0.12), (0, -1.15, 1.05), wood)
    for sx in (-1, 1):
        box((0.08, 3.9, 0.6), (sx * 1.13, -1.15, 1.15), body)
    box((2.3, 0.08, 0.6), (0, -3.1, 1.15), body)
    _cover(canvas, -3.05, 0.75, 1.15)
    _six_wheels(m, (2.65, -0.9, -2.2))
    box((2.4, 0.15, 0.2), (0, 3.7, 0.75), body, bevel=0.03)     # bumper
    cyl(0.07, 1.2, (0.95, 0.85, 1.9), m['dark'], segs=8)        # the exhaust stack behind the cab


def _cover(mat, y0, y1, z0, hw=1.18, h=2.05):
    """a canvas cover (a rounded tunnel) over the bed from y0 to y1, standing on z0"""
    sections = []
    for y in (y0, y0 + 0.05, (y0 + y1) / 2, y1 - 0.05, y1):
        sections.append((y, hw, z0, z0 + h, 0.55, 0.92))
    loft(sections, mat, ring=20)


def fuel_tanker():
    """an M49 fuel tanker: the same cab, an oval tank with a catwalk and hose boxes"""
    m = M()
    body = olive()
    _army_cab(m, body)
    tank = olive(0.7)
    sections = [(y, 1.12, 1.05, 2.45, 0.85, 0.95) for y in (-3.05, -2.95, 0.6, 0.7)]
    loft(sections, tank, ring=24)
    for y in (-2.5, -1.3, -0.1):
        loft([(y - 0.05, 1.16, 1.0, 2.5, 0.85, 0.95), (y + 0.05, 1.16, 1.0, 2.5, 0.85, 0.95)], m['dark'], ring=24)
    box((0.6, 3.6, 0.06), (0, -1.15, 2.47), m['dark'])
    for y in (-2.2, -0.6):
        cyl(0.22, 0.12, (0, y, 2.45), tank, segs=12)
    for sx in (-1, 1):
        box((0.4, 1.0, 0.45), (sx * 1.0, -3.0, 0.75), tank, bevel=0.03)
    box((1.6, 0.04, 0.4), (0, -3.07, 1.9), paint('placard', (0.85, 0.15, 0.10)))
    _six_wheels(m, (2.65, -0.9, -2.2))
    box((2.4, 0.15, 0.2), (0, 3.7, 0.75), body, bevel=0.03)


# ------------------------------------------------------------------------------------------------ SEAS machines
def seas_red(grime=0.55):
    """SEAS' rust-red painted steel (the faction's look in the original)"""
    return tex('seas_red', 'Rust009', tint=(0.50, 0.14, 0.09), strength=0.75, scale=2.5, grime=grime, contrast=1.15)


def plate(grime=0.5):
    return tex('plate', 'metal_plate', tint=(0.40, 0.38, 0.34), strength=0.5, scale=1.2, grime=grime)


def rivets(mat, x0, x1, y, z, n, axis='x', face=1, r=0.035):
    """a row of rivet heads along x (or y) on a surface facing +y (face) / +x"""
    for i in range(n):
        t = x0 + (x1 - x0) * i / max(1, n - 1)
        if axis == 'x':
            cyl(r, 0.03, (t, y, z), mat, segs=6, rot=(-math.pi / 2 * face, 0, 0))
        else:
            cyl(r, 0.03, (y, t, z), mat, segs=6, rot=(0, math.pi / 2 * face, 0))


def jeep():
    """the SEAS field car: a Willys-style jeep in SEAS red with riveted plating, a whip antenna with the owner's
    pennant, a spare wheel and jerrycans"""
    m = M()
    red = seas_red()
    pc = party('party', 0.85)
    # the tub
    loft([(-1.55, 0.72, 0.45, 1.05, 0.12, 0.98), (-1.45, 0.75, 0.42, 1.08, 0.12, 0.98), (0.65, 0.75, 0.42, 1.08, 0.12, 0.98)], red, ring=16)
    # hood and the flat fenders
    box((1.1, 1.3, 0.48), (0, 1.3, 0.62), red, bevel=0.04)
    for sx in (-1, 1):
        box((0.36, 1.45, 0.06), (sx * 0.74, 1.25, 0.95), red, bevel=0.01)
        box((0.36, 0.06, 0.4), (sx * 0.74, 1.95, 0.6), red)
        box((0.36, 1.0, 0.06), (sx * 0.74, -1.0, 0.98), red, bevel=0.01)
    box((1.1, 0.08, 0.5), (0, 1.97, 0.6), m['dark'])
    for k in range(7):
        box((0.04, 0.1, 0.42), (-0.39 + k * 0.13, 2.0, 0.64), red)
    for sx in (-1, 1):
        cyl(0.11, 0.06, (sx * 0.42, 1.98, 0.92), m['chrome'], segs=12, rot=(-math.pi / 2, 0, 0))
        cyl(0.085, 0.03, (sx * 0.42, 2.02, 0.92), glow('headlamp', (1.0, 0.97, 0.85), 0.5), segs=12, rot=(-math.pi / 2, 0, 0))
    # the owner's colour: a band round the tub and the hood panel
    box((1.12, 0.9, 0.02), (0, 1.3, 1.1), pc)
    for sx in (-1, 1):
        box((0.02, 2.1, 0.16), (sx * 0.765, -0.45, 0.8), pc)
    # windscreen frame, seats, steering wheel
    box((1.4, 0.06, 0.5), (0, 0.62, 1.08), m['glass'], rot=(-0.15, 0, 0))
    box((1.45, 0.06, 0.06), (0, 0.66, 1.58), red)
    for sx in (-1, 1):
        box((0.06, 0.06, 0.52), (sx * 0.72, 0.62, 1.08), red)
    seat = paint('seat', (0.25, 0.18, 0.12), grime=0.3)
    for sx in (-0.38, 0.38):
        box((0.48, 0.45, 0.14), (sx, -0.1, 0.78), seat, bevel=0.04)
        box((0.48, 0.1, 0.45), (sx, -0.33, 0.85), seat, bevel=0.04)
    box((1.2, 0.45, 0.14), (0, -1.05, 0.78), seat, bevel=0.04)
    cyl(0.16, 0.03, (-0.38, 0.35, 1.08), m['dark'], segs=12, rot=(-1.0, 0, 0))
    # riveted plates on the sides, a spare wheel and jerrycans at the back, the antenna with a pennant
    for sx in (-1, 1):
        rivets(m['dark'], -1.4, 0.55, sx * 0.76, 1.0, 9, axis='y', face=sx)
    cyl(0.36, 0.2, (0, -1.56, 0.85), m['rubber'], segs=18, rot=(math.pi / 2, 0, 0))
    cyl(0.18, 0.05, (0, -1.77, 0.85), red, segs=12, rot=(math.pi / 2, 0, 0))
    for sx in (-0.55, 0.55):
        box((0.18, 0.32, 0.45), (sx, -1.6, 0.55), olive(), bevel=0.02)
    cyl(0.012, 2.2, (0.6, -1.4, 1.05), m['dark'], segs=4)
    box((0.02, 0.5, 0.25), (0.6, -1.65, 2.95), pc)
    for wy in (1.25, -1.0):
        for sx in (-1, 1):
            wheel(m, sx * 0.82, wy, 0.37, 0.24, sx, hub=red)
    box((0.9, 3.2, 0.12), (0, 0.1, 0.3), m['dark'])


def capture_truck():
    """the capture truck: a SEAS heavy truck with a steel cage on the flatbed, a winch crane and floodlights"""
    m = M()
    red = seas_red()
    pc = party('party', 0.85)
    grate = tex('grate', 'metal_grate_rusty', scale=1.0, grime=0.4)
    # cab (a tall forward-control cab)
    box((2.3, 1.6, 1.5), (0, 2.25, 0.95), red, bevel=0.08, segs=2)
    box((2.1, 0.08, 0.8), (0, 3.07, 1.65), m['glass'], rot=(-0.1, 0, 0))
    for sx in (-1, 1):
        box((0.06, 0.8, 0.6), (sx * 1.16, 2.35, 1.7), m['glass'])
        box((0.04, 1.3, 0.35), (sx * 1.16, 2.25, 1.05), pc)       # the owner's colour on the doors
        rivets(m['dark'], 1.6, 2.9, sx * 1.16, 1.5, 8, axis='y', face=sx)
    box((2.1, 0.1, 0.5), (0, 3.08, 1.0), m['dark'])
    for k in range(9):
        box((2.0, 0.12, 0.04), (0, 3.1, 1.02 + k * 0.05), red)
    for sx in (-1, 1):
        cyl(0.14, 0.1, (sx * 0.8, 3.05, 0.75), m['chrome'], segs=12, rot=(-math.pi / 2, 0, 0))
        cyl(0.11, 0.04, (sx * 0.8, 3.12, 0.75), glow('headlamp', (1.0, 0.97, 0.85), 0.5), segs=12, rot=(-math.pi / 2, 0, 0))
    box((2.4, 1.7, 0.12), (0, 2.25, 2.45), plate(), bevel=0.03)
    for sx in (-0.7, 0.7):        # floodlights on the cab roof
        box((0.1, 0.1, 0.25), (sx, 2.6, 2.57), m['dark'])
        box((0.35, 0.25, 0.25), (sx, 2.65, 2.8), m['dark'], bevel=0.03)
        box((0.28, 0.04, 0.18), (sx, 2.79, 2.83), glow('flood', (1.0, 0.95, 0.75), 0.8))
    # the flatbed and the cage
    box((2.4, 4.4, 0.18), (0, -0.85, 0.95), plate())
    for sx in (-1, 1):
        box((0.12, 4.4, 0.25), (sx * 1.14, -0.85, 0.8), red)
    H = 2.0
    for x in (-1.1, 1.1):
        for k in range(9):
            cyl(0.04, H, (x, 1.25 - k * 0.52, 1.13), m['dark'], segs=6)
        box((0.12, 4.3, 0.12), (x, -0.85, 1.13 + H - 0.06), red)
        box((0.12, 4.3, 0.12), (x, -0.85, 1.13 + H * 0.5), red)
    for k in range(5):
        cyl(0.04, H, (-0.9 + k * 0.45, -3.0, 1.13), m['dark'], segs=6)
    box((2.3, 4.3, 0.08), (0, -0.85, 1.13 + H), grate)
    # the winch crane over the cage
    box((0.4, 0.4, 0.5), (0, 1.1, 3.2), red, bevel=0.03)
    box((0.22, 3.6, 0.22), (0, -0.5, 3.6), red, rot=(0.12, 0, 0))
    cyl(0.03, 1.0, (0, -2.1, 2.9), m['dark'], segs=6)
    box((0.3, 0.2, 0.25), (0, -2.1, 2.75), m['dark'])
    for wy in (2.2, -1.2, -2.4):
        for sx in (-1, 1):
            wheel(m, sx * 1.1, wy, 0.52, 0.34, sx, hub=red)
    box((1.2, 6.0, 0.3), (0, -0.2, 0.5), m['dark'])


def aa_halftrack():
    """the anti-air halftrack: an M16-style armoured halftrack with a quad gun mount, SEAS plating"""
    m = M()
    red = seas_red()
    pc = party('party', 0.85)
    arm = plate(0.55)
    # front: wheels, the armoured hood and a radiator louvre
    for sx in (-1, 1):
        wheel(m, sx * 0.95, 1.9, 0.48, 0.3, sx, hub=red)
    prism([(1.0, 0.75), (2.75, 0.75), (2.75, 1.45), (1.0, 1.75)], 1.5, (0, 0, 0), red, axis='x')
    box((1.4, 0.08, 0.6), (0, 2.76, 0.8), m['dark'])
    for k in range(6):
        box((1.3, 0.1, 0.04), (0, 2.79, 0.84 + k * 0.09), arm)
    for sx in (-1, 1):
        prism([(2.95, 0.9), (2.4, 1.25), (1.2, 1.25), (1.2, 0.95), (2.95, 0.8)], 0.5, (sx * 1.0, 0, 0), red, axis='x')
    # the armoured body (sloped plates), the owner's colour band
    box((2.2, 3.8, 1.45), (0, -0.9, 0.7), arm, bevel=0.04)
    for sx in (-1, 1):
        box((0.04, 3.8, 0.22), (sx * 1.115, -0.9, 1.65), pc)
        rivets(m['dark'], -2.7, 0.9, sx * 1.12, 1.2, 12, axis='y', face=sx)
        rivets(m['dark'], -2.7, 0.9, sx * 1.12, 0.85, 12, axis='y', face=sx)
    box((2.2, 0.1, 0.6), (0, 1.0, 2.15), arm, rot=(0.3, 0, 0))        # the armoured windscreen
    for sx in (-0.5, 0.5):
        box((0.35, 0.04, 0.12), (sx, 1.08, 2.3), m['dark'], rot=(0.3, 0, 0))
    # the tracks: a rubber band round road wheels
    for sx in (-1, 1):
        loft([(y, 0.18, 0.05, 0.85, 0.95, 1.0) for y in (-2.9, -2.8, -0.2, -0.1)], m['rubber'], loc=(sx * 1.0, 0, 0), ring=20)
        for k in range(4):
            cyl(0.3, 0.06, (sx * 1.2, -2.5 + k * 0.7, 0.38), arm, segs=12, rot=(0, math.pi / 2 * sx, 0))
    # the quad mount: a turret ring, the shield, four barrels
    cyl(0.85, 0.2, (0, -1.2, 2.15), arm, segs=20)
    box((1.6, 0.9, 0.9), (0, -1.1, 2.35), red, bevel=0.05)
    box((1.9, 0.1, 0.8), (0, -0.62, 2.45), arm, rot=(0.25, 0, 0))
    for sx in (-0.55, -0.32, 0.32, 0.55):
        for sz in (2.85,):
            cyl(0.045, 1.8, (sx, -0.7, sz), m['dark'], segs=8, rot=(-math.pi / 2 + 0.6, 0, 0))
            cyl(0.13, 0.5, (sx, -1.0, sz - 0.25), m['dark'], segs=10, rot=(-math.pi / 2 + 0.6, 0, 0))
    box((0.5, 0.4, 0.5), (0, -1.5, 2.7), m['dark'])          # the gunner's seat and ammunition boxes
    for sx in (-0.75, 0.75):
        box((0.35, 0.5, 0.35), (sx, -1.6, 2.4), olive(), bevel=0.02)
    box((1.4, 5.4, 0.3), (0, -0.3, 0.45), m['dark'])


def arc_halftrack():
    """the Arc Halftrack: the halftrack chassis with a Tesla coil on a turntable in place of the guns, cable reels"""
    m = M()
    red = seas_red()
    pc = party('party', 0.85)
    arm = plate(0.55)
    copper = tex('copper', 'rusty_metal_02', tint=(0.78, 0.45, 0.22), strength=0.85, scale=1.0, grime=0.2)
    for sx in (-1, 1):
        wheel(m, sx * 0.95, 1.9, 0.48, 0.3, sx, hub=red)
    prism([(1.0, 0.75), (2.75, 0.75), (2.75, 1.45), (1.0, 1.75)], 1.5, (0, 0, 0), red, axis='x')
    box((1.4, 0.08, 0.6), (0, 2.76, 0.8), m['dark'])
    for sx in (-1, 1):
        prism([(2.95, 0.9), (2.4, 1.25), (1.2, 1.25), (1.2, 0.95), (2.95, 0.8)], 0.5, (sx * 1.0, 0, 0), red, axis='x')
    box((2.2, 3.8, 1.45), (0, -0.9, 0.7), arm, bevel=0.04)
    for sx in (-1, 1):
        box((0.04, 3.8, 0.22), (sx * 1.115, -0.9, 1.65), pc)
        rivets(m['dark'], -2.7, 0.9, sx * 1.12, 1.2, 12, axis='y', face=sx)
        loft([(y, 0.18, 0.05, 0.85, 0.95, 1.0) for y in (-2.9, -2.8, -0.2, -0.1)], m['rubber'], loc=(sx * 1.0, 0, 0), ring=20)
        for k in range(4):
            cyl(0.3, 0.06, (sx * 1.2, -2.5 + k * 0.7, 0.38), arm, segs=12, rot=(0, math.pi / 2 * sx, 0))
    box((2.2, 0.1, 0.6), (0, 1.0, 2.15), arm, rot=(0.3, 0, 0))
    # the coil on its turntable
    cyl(0.9, 0.25, (0, -1.2, 2.15), arm, segs=20)
    for k in range(3):
        cyl(0.55 - k * 0.04, 0.3, (0, -1.2, 2.4 + k * 0.32), paint('insulator_brown', (0.45, 0.25, 0.15)), segs=12)
    cyl(0.38, 2.0, (0, -1.2, 3.35), copper, segs=14)
    for k in range(7):
        cyl(0.42, 0.06, (0, -1.2, 3.5 + k * 0.26), m['dark'], segs=14)
    for i in range(10):
        a = 2 * math.pi * i / 10
        cyl(0.3, 0.55, (0.75 * math.cos(a), -1.2 + 0.75 * math.sin(a), 5.45), m['chrome'], segs=8, rot=(math.pi / 2, 0, a + math.pi / 2))
    cyl(0.22, 0.35, (0, -1.2, 5.55), glow('coilglow', (0.55, 0.85, 1.0), 1.0), segs=10)
    for sx in (-0.75, 0.75):
        cyl(0.35, 0.5, (sx, -2.5, 2.15), m['dark'], segs=12, rot=(0, math.pi / 2, 0))
    box((1.4, 5.4, 0.3), (0, -0.3, 0.45), m['dark'])
