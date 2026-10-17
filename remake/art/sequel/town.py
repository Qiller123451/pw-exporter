"""The 1960s town: houses, the diner, cars (art/sequel/kit.py; the front looks along +y)."""
import math
from .kit import box, cyl, prism, loft, tex, paint, mirror, glow

# ------------------------------------------------------------------------------------------------ shared materials
def M():
    return {
        'found': tex('found', 'Concrete031', scale=2.0, grime=0.5),
        'concrete': tex('concrete', 'Concrete034', scale=3.0, grime=0.4),
        'brick': tex('brick', 'red_brick_03', scale=1.6, grime=0.3),
        'brick_pale': tex('brick_pale', 'Bricks060', scale=1.6, grime=0.3),
        'shingle': tex('shingle', 'grey_roof_01', scale=2.5, grime=0.1),
        'trim': paint('trim', (0.93, 0.92, 0.88), grime=0.25),
        'glass': mirror('glass', sky=(0.34, 0.42, 0.52), horizon=(0.05, 0.06, 0.07), ground=(0.09, 0.085, 0.08)),
        'chrome': mirror('chrome'),
        'dark': paint('dark', (0.07, 0.07, 0.075), grime=0.0, noise=0.03),
        'rubber': paint('rubber', (0.05, 0.05, 0.05), grime=0.3, noise=0.08),
        'curtain': paint('curtain', (0.86, 0.80, 0.62), grime=0.0),
    }


# ------------------------------------------------------------------------------------------------ windows, doors
def window(m, x, y, z, w, h, face=1, shutters=None, sill=True):
    """a sash window on the wall plane y (face +1: the wall faces +y), bottom at z"""
    t = 0.11
    box((w, 0.06, h), (x, y - face * 0.01, z), m['glass'])
    box((w * 0.5, 0.03, h * 0.18), (x - w * 0.25, y + face * 0.02, z + h * 0.82), m['curtain'])
    box((w * 0.5, 0.03, h * 0.18), (x + w * 0.25, y + face * 0.02, z + h * 0.82), m['curtain'])
    # frame and the meeting rail
    box((w + 2 * t, 0.12, t), (x, y + face * 0.03, z + h), m['trim'])
    box((w + 2 * t, 0.12, t), (x, y + face * 0.03, z - t), m['trim'])
    box((t, 0.12, h), (x - w / 2 - t / 2, y + face * 0.03, z), m['trim'])
    box((t, 0.12, h), (x + w / 2 + t / 2, y + face * 0.03, z), m['trim'])
    box((w, 0.08, 0.05), (x, y + face * 0.03, z + h * 0.5), m['trim'])
    box((0.04, 0.08, h), (x, y + face * 0.03, z), m['trim'])
    if sill:
        box((w + 0.3, 0.22, 0.06), (x, y + face * 0.08, z - t - 0.06), m['trim'], bevel=0.015)
    if shutters is not None:
        for s in (-1, 1):
            sx = x + s * (w / 2 + t + 0.24)
            box((0.42, 0.05, h + 0.1), (sx, y + face * 0.04, z - 0.05), shutters, bevel=0.01)
            for k in range(5):
                box((0.36, 0.03, 0.03), (sx, y + face * 0.075, z + 0.1 + k * (h - 0.1) / 5), shutters)


def door(m, x, y, z, color, face=1, w=1.0, h=2.15):
    box((w + 0.2, 0.14, h + 0.12), (x, y + face * 0.02, z), m['trim'], bevel=0.02)
    box((w, 0.08, h), (x, y + face * 0.07, z), color, bevel=0.01)
    for k in range(3):     # panels
        box((w * 0.7, 0.02, h * 0.2), (x, y + face * 0.115, z + 0.25 + k * h * 0.27), color, bevel=0.01)
    box((w * 0.5, 0.03, 0.25), (x, y + face * 0.12, z + h * 0.78), m['glass'])
    cyl(0.04, 0.05, (x + face * w * 0.36, y + face * 0.13, z + 1.0), m['chrome'], segs=8, rot=(math.pi / 2 * face * -1, 0, 0))


# ------------------------------------------------------------------------------------------------ the ranch house
SIDING = {'white': (0.92, 0.91, 0.86), 'mint': (0.62, 0.80, 0.70), 'pink': (0.92, 0.70, 0.70), 'sky': (0.62, 0.74, 0.86),
          'butter': (0.95, 0.85, 0.52), 'sage': (0.62, 0.68, 0.52), 'cream': (0.93, 0.88, 0.74)}
ACCENT = {'white': (0.18, 0.30, 0.22), 'mint': (0.88, 0.88, 0.85), 'pink': (0.30, 0.22, 0.24), 'sky': (0.90, 0.90, 0.88),
          'butter': (0.40, 0.25, 0.16), 'sage': (0.85, 0.83, 0.75), 'cream': (0.55, 0.16, 0.14)}


def ranch(color='mint'):
    m = M()
    wall = tex('siding_' + color, 'WoodSiding009', tint=SIDING[color], strength=0.85, scale=2.2, grime=0.35)
    acc = paint('accent_' + color, ACCENT[color], grime=0.2)
    L, D, H = 10.6, 7.2, 2.7        # the main block: length (x), depth (y), wall height (x 1.3 when built)
    G = 3.8                          # the garage, on +x
    fz = 0.45                        # foundation height
    # foundation, walls
    box((L + 0.3, D + 0.3, fz), (0, 0, 0), m['found'], bevel=0.03)
    box((L, D, H), (0, 0, fz), wall)
    box((G + 0.3, D - 1.0 + 0.3, 0.15), (L / 2 + G / 2, -0.5, 0), m['concrete'])
    box((G, D - 1.0, H - 0.2), (L / 2 + G / 2, -0.5, 0.15), wall)
    # brick wainscot along the front, a brick planter under the picture window
    box((L * 0.55, 0.12, 1.0), (-L * 0.2, D / 2 + 0.05, fz), m['brick'])
    box((L * 0.55 + 0.05, 0.22, 0.08), (-L * 0.2, D / 2 + 0.08, fz + 1.0), m['trim'])
    box((3.0, 0.7, 0.55), (-2.7, D / 2 + 0.45, 0), m['brick'], bevel=0.02)
    # corner boards
    for sx in (-1, 1):
        for sy in (-1, 1):
            box((0.14, 0.14, H), (sx * (L / 2 + 0.02), sy * (D / 2 + 0.02), fz), m['trim'])
    # windows: the picture window, two bedroom windows, side and back windows
    window(m, -2.7, D / 2, fz + 1.1, 2.5, 1.35, 1, None)
    for wx in (1.6, 3.9):
        window(m, wx, D / 2, fz + 1.05, 1.15, 1.2, 1, acc)
    for wx in (-3.8, -1.0, 1.8, 4.1):
        window(m, wx, -D / 2, fz + 1.05, 1.0, 1.1, -1, acc)
    # stoop and door, the porch roof on two posts
    box((2.4, 1.4, 0.3), (-0.2, D / 2 + 0.7, 0), m['concrete'], bevel=0.02)
    box((2.4, 0.35, 0.15), (-0.2, D / 2 + 1.55, 0), m['concrete'])
    door(m, -0.2, D / 2, fz, acc)
    for px in (-1.2, 0.8):
        box((0.12, 0.12, H - 0.15), (px, D / 2 + 1.25, 0.3), m['trim'])
    # the garage door (panels) and its trim
    gx = L / 2 + G / 2
    box((3.0, 0.08, 2.3), (gx, D / 2 - 1.0 + 0.04, 0.15), m['trim'], bevel=0.01)
    for k in range(4):
        box((2.9, 0.04, 0.5), (gx, D / 2 - 1.0 + 0.1, 0.25 + k * 0.56), paint('garage_door', (0.86, 0.85, 0.80)), bevel=0.02)
    for k in range(4):
        box((0.4, 0.03, 0.22), (gx - 1.05 + k * 0.7, D / 2 - 1.0 + 0.13, 2.0), m['glass'])
    # roof: a low hip over the house, eaves 0.6 m out; a gable over the garage; fascia boards
    e = 0.6
    rz = fz + H
    hip(m['shingle'], L + 2 * e, D + 2 * e, 1.55, (0, 0, rz))
    box((L + 2 * e + 0.05, D + 2 * e + 0.05, 0.34), (0, 0, rz - 0.30), m['trim'], bevel=0.03)
    gz = 0.15 + H - 0.2
    prism([(-(D - 1.0) / 2 - e, 0), ((D - 1.0) / 2 + e, 0), (0, 1.1)], G + e, (L / 2 + G / 2 + e / 2, -0.5, gz), m['shingle'], axis='x')
    box((G + e, D - 1.0 + 2 * e, 0.3), (L / 2 + G / 2 + e / 2, -0.5, gz - 0.26), m['trim'], bevel=0.03)
    prism([(-(D - 1.0) / 2, 0), ((D - 1.0) / 2, 0), (0, 0.95)], 0.1, (L / 2 + G + 0.0, -0.5, gz), wall, axis='x')
    # chimney (brick, with a cap), a TV aerial
    box((0.9, 0.7, 3.4), (-3.9, -1.4, rz - 0.4), m['brick_pale'])
    box((1.05, 0.85, 0.12), (-3.9, -1.4, rz + 3.0), m['concrete'])
    cyl(0.03, 2.2, (2.5, -1.0, rz + 1.2), m['chrome'], segs=6)
    for k in range(4):
        box((1.4 - k * 0.25, 0.03, 0.03), (2.5, -1.0, rz + 2.4 + k * 0.28), m['chrome'])
    # gutters and a downpipe
    box((L + 2 * e, 0.14, 0.12), (0, D / 2 + e - 0.02, rz - 0.3), paint('gutter', (0.80, 0.80, 0.78)))
    cyl(0.05, rz - 0.3, (L / 2 + e - 0.1, D / 2 + e - 0.05, 0), paint('gutter', (0.80, 0.80, 0.78)), segs=8)
    # the clutter of a lived-in house: flower boxes, a window air conditioner, trash cans, a porch lamp, a hose reel
    flowers = paint('flowers', (0.78, 0.22, 0.20), grime=0.0, noise=0.25)
    for wx in (1.6, 3.9):
        box((1.3, 0.35, 0.3), (wx, D / 2 + 0.2, fz + 0.62), acc, bevel=0.02)
        box((1.2, 0.28, 0.12), (wx, D / 2 + 0.2, fz + 0.92), flowers, bevel=0.04)
    ac_unit(m, -L / 2 - 0.05, 1.5, fz + 1.2, rot=math.pi / 2)
    for k in range(2):
        trash_can(m, L / 2 + G + 0.6, D / 2 - 2.0 - k * 0.75)
    box((0.18, 0.12, 0.3), (-1.4, D / 2 + 0.08, fz + 1.75), m['chrome'], bevel=0.02)
    cyl(0.07, 0.16, (-1.4, D / 2 + 0.14, fz + 1.8), glow('porchlamp', (1.0, 0.9, 0.6), 0.8), segs=8)
    cyl(0.3, 0.12, (-L / 2 + 1.0, D / 2 + 0.25, fz + 0.5), paint('hose', (0.20, 0.42, 0.18)), segs=12, rot=(math.pi / 2, 0, 0))


def trash_can(m, x, y):
    zinc = paint('zinc', (0.62, 0.64, 0.62), grime=0.5, noise=0.12)
    cyl(0.28, 0.85, (x, y, 0), zinc, segs=14)
    for k in range(3):
        cyl(0.295, 0.04, (x, y, 0.15 + k * 0.3), zinc, segs=14)
    cyl(0.31, 0.06, (x, y, 0.85), zinc, segs=14)
    cyl(0.06, 0.08, (x, y, 0.91), zinc, segs=8)


def ac_unit(m, x, y, z, rot=0.0):
    case = paint('ac_case', (0.80, 0.78, 0.70), grime=0.4)
    box((0.7, 0.55, 0.45), (x, y, z), case, rot=(0, 0, rot), bevel=0.03)
    box((0.6, 0.04, 0.3), (x - math.sin(rot) * 0.28, y + math.cos(rot) * 0.28, z + 0.08), m['dark'], rot=(0, 0, rot))


def hip(mat, w, d, h, loc):
    """a hip roof over w x d, ridge along x"""
    from .kit import _obj
    import bmesh
    bm = bmesh.new()
    x, y, z = loc
    r = (w - d) / 2
    v = [bm.verts.new(p) for p in [(x - w / 2, y - d / 2, z), (x + w / 2, y - d / 2, z), (x + w / 2, y + d / 2, z), (x - w / 2, y + d / 2, z),
                                    (x - r, y, z + h), (x + r, y, z + h)]]
    for f in [(v[0], v[1], v[5], v[4]), (v[2], v[3], v[4], v[5]), (v[1], v[2], v[5]), (v[3], v[0], v[4]), (v[3], v[2], v[1], v[0])]:
        bm.faces.new(f)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # some thickness at the eave edge
    return _obj(bm, mat, uvscale=2.5)


# ------------------------------------------------------------------------------------------------ the diner
def diner():
    """a stainless-steel streamline diner car with a sign on the roof, a brick vestibule and stools inside"""
    m = M()
    steel = tex('steel', 'corrugated_iron', scale=3.0, grime=0.15, contrast=1.6, sheen=dict(sky=(0.86, 0.90, 0.95), horizon=(0.30, 0.32, 0.35), ground=(0.42, 0.38, 0.33)))
    red = paint('enamel_red', (0.70, 0.08, 0.07), grime=0.15, rough=0.3)
    cream = paint('enamel_cream', (0.93, 0.88, 0.74), grime=0.2)
    L, D = 16.0, 6.2
    fz = 0.8
    box((L + 0.4, D + 0.4, fz), (0, 0, 0), m['brick'], bevel=0.02)
    # the body: rounded ends (a loft along x via sections in y would do the barrel roof; here a box body and a
    # barrel roof lofted along x)
    body_h = 3.0
    box((L, D, body_h), (0, 0, fz), steel, bevel=0.25, segs=3, uvscale=1.4)
    # the band of windows along the front and the red enamel stripes
    wz = fz + 1.15
    for k in range(9):
        x = -L / 2 + 1.0 + k * (L - 2.0) / 9 + 0.1
        box((1.45, 0.06, 1.2), (x + 0.75, D / 2 + 0.01, wz), m['glass'])
        box((0.1, 0.12, 1.25), (x, D / 2 + 0.03, wz), m['chrome'])
    box((L - 1.6, 0.14, 0.1), (0, D / 2 + 0.04, wz + 1.22), m['chrome'])
    box((L - 1.6, 0.14, 0.1), (0, D / 2 + 0.04, wz - 0.1), m['chrome'])
    box((L - 0.6, 0.1, 0.35), (0, D / 2 + 0.03, fz + 0.45), red, bevel=0.03)
    box((L - 0.6, 0.1, 0.22), (0, D / 2 + 0.03, fz + 2.62), red, bevel=0.03)
    box((L - 0.6, 0.1, 0.35), (0, -D / 2 - 0.03, fz + 0.45), red, bevel=0.03)
    for k in range(6):
        box((1.3, 0.06, 1.0), (-L / 2 + 2.0 + k * 2.4, -D / 2 - 0.01, wz + 0.1), m['glass'])
    # the barrel roof with a monitor (clerestory)
    sec = []
    for i in range(13):
        a = math.pi * i / 12
        sec.append((-math.cos(a) * (D / 2 + 0.15), math.sin(a) * 1.0))
    prism([(y, z) for y, z in sec], L + 0.2, (0, 0, fz + body_h - 0.2), steel, axis='x', uvscale=1.4, smooth=True)
    box((L * 0.7, 1.6, 0.45), (0, 0, fz + body_h + 0.7), cream, bevel=0.05)
    # the vestibule (brick and glass block) at the door
    box((3.0, 2.0, 3.1), (1.0, D / 2 + 1.0, 0), m['brick'])
    box((3.3, 2.3, 0.2), (1.0, D / 2 + 1.0, 3.1), m['concrete'], bevel=0.03)
    door(m, 1.0, D / 2 + 2.0, 0.2, paint('diner_door', (0.75, 0.75, 0.72)))
    box((3.2, 1.2, 0.2), (1.0, D / 2 + 2.6, 0), m['concrete'])
    # the sign on the roof: a red panel with cream letters as blocks, lit
    sign_y = 0.0
    box((0.25, 0.25, 1.4), (-3.5, sign_y, fz + body_h + 0.6), m['chrome'])
    box((0.25, 0.25, 1.4), (3.5, sign_y, fz + body_h + 0.6), m['chrome'])
    box((9.0, 0.35, 2.0), (0, sign_y, fz + body_h + 1.9), red, bevel=0.15, segs=2)
    neon = glow('neon', (1.0, 0.92, 0.62), 1.0)
    letters(neon, 'DINER', 0, sign_y + 0.2, fz + body_h + 2.25, 1.3)
    box((8.4, 0.1, 0.1), (0, sign_y + 0.2, fz + body_h + 2.05), glow('neon_red', (1.0, 0.35, 0.3), 1.0))
    # a coffee cup sign at the end
    cyl(0.6, 0.9, (L / 2 + 0.3, 0, fz + 1.6), cream, segs=16, rot=(0, math.pi / 2, 0))
    # vents, a chimney pipe, steps at the back door
    for vx in (-5, -2, 5):
        cyl(0.22, 0.6, (vx, -1.6, fz + body_h + 0.5), steel, segs=10)
        cyl(0.32, 0.12, (vx, -1.6, fz + body_h + 1.1), steel, segs=10)
    box((1.2, 0.8, 0.6), (-6.0, -D / 2 - 0.6, 0), m['concrete'])
    # behind the kitchen: crates, drums, a propane tank, the exhaust stack; a blade sign at the corner
    for k, (cx, cy) in enumerate([(-3.0, -D / 2 - 1.2), (-2.1, -D / 2 - 1.3), (-2.6, -D / 2 - 1.1)]):
        crate(cx, cy, 0.9 if k < 2 else 0.0, 0.8, rot=0.2 * k)
    drum(-0.8, -D / 2 - 1.1); drum(-0.1, -D / 2 - 1.3, color=(0.20, 0.32, 0.55))
    tank = paint('propane', (0.90, 0.90, 0.86), grime=0.4)
    cyl(0.5, 2.0, (4.5, -D / 2 - 1.2, 0.6), tank, segs=16, rot=(0, math.pi / 2, 0))
    for sx in (3.6, 5.4):
        box((0.12, 0.6, 0.6), (sx, -D / 2 - 1.2, 0), m['concrete'])
    cyl(0.18, 2.6, (-5.5, -1.6, fz + body_h + 0.4), steel, segs=10)
    cyl(0.3, 0.3, (-5.5, -1.6, fz + body_h + 3.0), steel, segs=10, r2=0.05)
    sx, sy = -L / 2 - 1.6, D / 2 + 2.2          # a pylon sign by the road
    cyl(0.12, 6.0, (sx, sy, 0), m['chrome'], segs=10)
    box((1.5, 0.35, 3.9), (sx, sy, 4.0), red, bevel=0.08, segs=2)
    letters_v(glow('neon', (1.0, 0.92, 0.62), 1.0), 'EAT', sx, sy + 0.2, 4.35, 0.85)


def crate(x, y, z, s=0.8, rot=0.0):
    wood = tex('crate_wood', 'blue_painted_planks', tint=(0.55, 0.45, 0.30), strength=0.9, scale=1.2, grime=0.3)
    box((s, s, s), (x, y, z), wood, rot=(0, 0, rot), bevel=0.03)
    for dz in (0.08, s - 0.14):
        box((s + 0.04, s + 0.04, 0.06), (x, y, z + dz), wood, rot=(0, 0, rot))


def drum(x, y, z=0.0, color=(0.55, 0.12, 0.08)):
    p = paint('drum_%d%d%d' % tuple(int(c * 9) for c in color), color, grime=0.5, noise=0.15)
    cyl(0.3, 0.9, (x, y, z), p, segs=14)
    for k in (0.3, 0.6):
        cyl(0.315, 0.04, (x, y, z + k), p, segs=14)


def letters_v(mat, text, x, y, z, h):
    """letters stacked top to bottom on the face y (a blade sign)"""
    for i, ch in enumerate(text):
        letters(mat, ch, x, y, z + (len(text) - 1 - i) * h * 1.25, h)


SEG = {   # 7-segment-ish block letters: strokes (x0, z0, x1, z1) in a 1 x 2 cell
    'D': [(0, 0, 0.15, 2), (0, 1.85, 0.6, 2), (0, 0, 0.6, 0.15), (0.6, 1.7, 0.75, 1.85), (0.6, 0.15, 0.75, 0.3), (0.75, 0.3, 0.9, 1.7)],
    'I': [(0.38, 0, 0.53, 2)],
    'N': [(0, 0, 0.15, 2), (0.75, 0, 0.9, 2), (0.15, 1.5, 0.45, 1.8), (0.45, 1.0, 0.6, 1.5), (0.6, 0.3, 0.75, 1.0)],
    'E': [(0, 0, 0.15, 2), (0, 1.85, 0.9, 2), (0, 0.93, 0.7, 1.08), (0, 0, 0.9, 0.15)],
    'R': [(0, 0, 0.15, 2), (0, 1.85, 0.75, 2), (0.75, 1.1, 0.9, 1.85), (0, 0.95, 0.75, 1.1), (0.45, 0, 0.6, 0.95)],
    'A': [(0, 0, 0.15, 1.85), (0.75, 0, 0.9, 1.85), (0, 1.85, 0.9, 2), (0, 0.95, 0.9, 1.1)],
    'T': [(0, 1.85, 0.9, 2), (0.38, 0, 0.53, 1.85)],
    'S': [(0, 1.85, 0.9, 2), (0, 1.0, 0.15, 1.85), (0, 0.93, 0.9, 1.08), (0.75, 0.15, 0.9, 0.93), (0, 0, 0.9, 0.15)],
    'G': [(0, 0, 0.15, 2), (0, 1.85, 0.9, 2), (0, 0, 0.9, 0.15), (0.75, 0.15, 0.9, 0.9), (0.45, 0.8, 0.9, 0.95)],
    'O': [(0, 0, 0.15, 2), (0.75, 0, 0.9, 2), (0, 1.85, 0.9, 2), (0, 0, 0.9, 0.15)],
    'L': [(0, 0, 0.15, 2), (0, 0, 0.9, 0.15)],
    'M': [(0, 0, 0.15, 2), (0.75, 0, 0.9, 2), (0, 1.85, 0.9, 2), (0.38, 1.0, 0.53, 1.85)],
    'P': [(0, 0, 0.15, 2), (0, 1.85, 0.9, 2), (0.75, 1.0, 0.9, 1.85), (0, 0.93, 0.9, 1.08)],
    'U': [(0, 0, 0.15, 2), (0.75, 0, 0.9, 2), (0, 0, 0.9, 0.15)],
    'C': [(0, 0, 0.15, 2), (0, 1.85, 0.9, 2), (0, 0, 0.9, 0.15)],
    'F': [(0, 0, 0.15, 2), (0, 1.85, 0.9, 2), (0, 0.93, 0.7, 1.08)],
    'H': [(0, 0, 0.15, 2), (0.75, 0, 0.9, 2), (0, 0.93, 0.9, 1.08)],
    'V': [(0, 0.5, 0.15, 2), (0.75, 0.5, 0.9, 2), (0.15, 0, 0.75, 0.5)],
    'Y': [(0, 1.1, 0.15, 2), (0.75, 1.1, 0.9, 2), (0, 0.95, 0.9, 1.1), (0.38, 0, 0.53, 0.95)],
    'K': [(0, 0, 0.15, 2), (0.15, 0.93, 0.5, 1.08), (0.5, 1.08, 0.65, 2), (0.5, 0, 0.65, 0.93)],
    'B': [(0, 0, 0.15, 2), (0, 1.85, 0.75, 2), (0, 0.93, 0.75, 1.08), (0, 0, 0.75, 0.15), (0.75, 0.15, 0.9, 0.93), (0.75, 1.08, 0.9, 1.85)],
    '6': [(0, 0, 0.15, 2), (0, 1.85, 0.9, 2), (0, 0, 0.9, 0.15), (0.75, 0.15, 0.9, 0.93), (0, 0.93, 0.9, 1.08)],
    '1': [(0.38, 0, 0.53, 2)],
    '0': [(0, 0, 0.15, 2), (0.75, 0, 0.9, 2), (0, 1.85, 0.9, 2), (0, 0, 0.9, 0.15)],
}


def letters(mat, text, x, y, z, h):
    s = h / 2
    w = len(text) * 1.15 * s
    for i, ch in enumerate(text):
        cx = x + w / 2 - i * 1.15 * s          # read from the front (+y): the text runs along -x
        for x0, z0, x1, z1 in SEG.get(ch, []):
            box(((x1 - x0) * s, 0.08, (z1 - z0) * s), (cx - (x0 + x1) / 2 * s, y, z + z0 * s), mat)


# ------------------------------------------------------------------------------------------------ the two-storey house
def two_storey(color='white'):
    """a two-storey frame house with a gable roof, a full-width front porch and dormers"""
    m = M()
    wall = tex('siding_' + color, 'WoodSiding009', tint=SIDING[color], strength=0.85, scale=2.2, grime=0.35)
    acc = paint('accent_' + color, ACCENT[color], grime=0.2)
    roofm = m['shingle']
    W, D, H = 8.0, 7.0, 5.6
    fz = 0.5
    box((W + 0.3, D + 0.3, fz), (0, 0, 0), m['found'], bevel=0.03)
    box((W, D, H), (0, 0, fz), wall)
    box((W + 0.1, D + 0.1, 0.18), (0, 0, fz + 2.75), m['trim'])                  # the belt between the floors
    for sx in (-1, 1):
        for sy in (-1, 1):
            box((0.16, 0.16, H), (sx * (W / 2 + 0.02), sy * (D / 2 + 0.02), fz), m['trim'])
    # the gable roof (ridge along x), the gable ends in siding, fascia
    e = 0.5
    rz = fz + H
    prism([(-D / 2 - e, -0.1), (D / 2 + e, -0.1), (0, 2.9)], W + 2 * e, (0, 0, rz), roofm, axis='x', uvscale=2.5)
    for sx in (-1, 1):
        prism([(-D / 2, 0), (D / 2, 0), (0, 2.6)], 0.1, (sx * (W / 2 - 0.05), 0, rz), wall, axis='x')
    for sy in (-1, 1):
        box((W + 2 * e, 0.3, 0.3), (0, sy * (D / 2 + e - 0.1), rz - 0.25), m['trim'], bevel=0.03)
    # windows: three up, two down beside the door; the side windows
    for wx in (-2.6, 0, 2.6):
        window(m, wx, D / 2, fz + 3.4, 1.0, 1.35, 1, acc)
        window(m, wx, -D / 2, fz + 3.4, 1.0, 1.35, -1, acc)
    for wx in (-2.6, 2.6):
        window(m, wx, D / 2, fz + 0.75, 1.1, 1.45, 1, acc)
        window(m, wx, -D / 2, fz + 0.75, 1.0, 1.35, -1, acc)
    door(m, 0, D / 2, fz, acc)
    # the porch: a deck on piers, columns, a shallow roof, railings and steps
    deck = tex('deck', 'Planks037A', tint=(0.55, 0.50, 0.42), strength=0.6, scale=1.5, grime=0.3)
    box((W + 0.4, 2.3, 0.18), (0, D / 2 + 1.15, fz - 0.05), deck)
    for px in (-W / 2, -W / 4, W / 4, W / 2):
        box((0.3, 0.3, fz), (px, D / 2 + 2.15, 0), m['brick'])
        box((0.2, 0.2, 2.6), (px, D / 2 + 2.15, fz + 0.13), m['trim'], bevel=0.02)
    prism([(D / 2, 0), (D / 2 + 2.6, 0), (D / 2 + 2.6, 0.12), (D / 2, 0.7)], W + 0.6, (0, 0, fz + 2.73), roofm, axis='x')
    box((W + 0.6, 0.18, 0.25), (0, D / 2 + 2.5, fz + 2.6), m['trim'])
    for px in (-W / 2 + 1.0, W / 2 - 1.0):
        box((W / 2 - 1.6, 0.08, 0.08), (px, D / 2 + 2.15, fz + 0.95), m['trim'])
        for k in range(10):
            box((0.05, 0.05, 0.8), (px - (W / 2 - 1.6) / 2 + 0.1 + k * (W / 2 - 1.8) / 9, D / 2 + 2.15, fz + 0.15), m['trim'])
    for k in range(3):
        box((1.6, 0.35, 0.17), (0, D / 2 + 2.45 + k * 0.32, (2 - k) * 0.17), m['concrete'])
    # the chimney on the gable end, a dormer over the porch, a swing, a hanging lamp
    box((1.0, 0.8, H + 3.6), (-W / 2 - 0.45, -1.0, 0), m['brick'])
    box((1.15, 0.95, 0.15), (-W / 2 - 0.45, -1.0, H + 3.6), m['concrete'])
    box((2.0, 1.6, 1.4), (0, D / 2 - 0.4, rz + 0.9), wall)
    prism([(-0.4, 0), (1.4, 0), (0.5, 0.9)], 2.3, (0, D / 2 - 0.9, rz + 2.3), roofm, axis='x', rot=(0, 0, 0))
    window(m, 0, D / 2 + 0.4, rz + 1.05, 0.9, 0.9, 1, None, sill=False)
    box((1.5, 0.45, 0.08), (2.2, D / 2 + 0.6, fz + 0.55), acc)
    trash_can(m, W / 2 + 0.8, -D / 2 + 0.5)


# ------------------------------------------------------------------------------------------------ the gas station
def gas_station():
    """a 1960s service station: an office with two service bays, a canopy over two pump islands, a round sign"""
    m = M()
    white = paint('enamel_white', (0.93, 0.92, 0.88), grime=0.4)
    red = paint('enamel_red', (0.70, 0.08, 0.07), grime=0.25, rough=0.3)
    box((19.0, 12.0, 0.15), (0, 0, 0), m['concrete'], uvscale=3.0)
    # the office and the bays
    ox, oy = -5.0, -3.0
    box((6.0, 5.0, 3.6), (ox - 2.0, oy, 0.15), white, bevel=0.03)
    box((5.0, 5.0, 3.6), (ox + 3.5, oy, 0.15), white, bevel=0.03)
    box((11.4, 5.4, 0.55), (ox + 0.5, oy, 3.75), red, bevel=0.04)
    for k in range(2):
        bx = ox + 2.4 + k * 2.3
        box((2.0, 0.08, 2.8), (bx, oy + 2.52, 0.15), m['trim'], bevel=0.01)
        for j in range(5):
            box((1.9, 0.04, 0.5), (bx, oy + 2.57, 0.25 + j * 0.54), white, bevel=0.02)
        for j in range(3):
            box((0.5, 0.03, 0.3), (bx - 0.6 + j * 0.6, oy + 2.6, 2.3), m['glass'])
    box((3.6, 0.06, 1.6), (ox - 2.6, oy + 2.51, 1.2), m['glass'])
    door(m, ox - 0.4, oy + 2.5, 0.15, paint('station_door', (0.75, 0.75, 0.72)))
    # the canopy on two columns, the pump islands with pumps
    box((9.0, 4.6, 0.45), (4.5, 2.5, 4.4), white, bevel=0.06)
    box((9.1, 4.7, 0.2), (4.5, 2.5, 4.3), red)
    for cx in (1.2, 7.8):
        box((0.35, 0.35, 4.3), (cx, 2.5, 0.15), white, bevel=0.03)
    for px in (3.0, 6.0):
        box((1.0, 2.6, 0.2), (px, 2.5, 0.15), m['concrete'], bevel=0.04)
        for py in (1.9, 3.1):
            pump(m, px, py, red, white)
    for k in range(6):
        cyl(0.06, 0.1, (2 + k * 1.1, 4.7, 4.2), glow('canopy_lamp', (1.0, 0.95, 0.8), 0.6), segs=8)
    # the sign on a pole, oil cans, a tyre rack, a cola machine
    cyl(0.18, 7.0, (8.5, -4.5, 0.15), m['chrome'], segs=10)
    cyl(1.4, 0.35, (8.5, -4.5, 7.4), red, segs=24, rot=(math.pi / 2, 0, 0))
    cyl(1.15, 0.38, (8.5, -4.5, 7.4), white, segs=24, rot=(math.pi / 2, 0, 0))
    letters(red, 'GAS', 8.5, -4.25, 7.0, 0.42)
    for k in range(4):
        cyl(0.42, 0.25, (ox + 6.5, oy - 1.0 + k * 0.3, 0.6), m['rubber'], segs=14, rot=(math.pi / 2, 0, 0))
    box((0.8, 0.7, 1.7), (ox - 5.3, oy + 2.0, 0.15), red, bevel=0.06)
    for k in range(6):
        cyl(0.12, 0.3, (ox - 4.2 + (k % 3) * 0.28, oy + 2.75, 0.15 + (k // 3) * 0.3), paint('oilcan', (0.85, 0.65, 0.12)), segs=8)


def pump(m, x, y, red, white):
    box((0.55, 0.5, 1.5), (x, y, 0.35), red, bevel=0.05)
    box((0.6, 0.55, 0.45), (x, y, 1.85), white, bevel=0.08)
    box((0.4, 0.03, 0.25), (x, y + 0.29, 1.95), glow('pump_face', (1.0, 0.95, 0.8), 0.5))
    cyl(0.03, 0.8, (x + 0.3, y, 0.9), m['dark'], segs=6, rot=(0, 0.4, 0))


# ------------------------------------------------------------------------------------------------ the farm
def barn():
    """a gambrel-roofed red barn with white trim, a hay door and a cupola"""
    m = M()
    red = tex('barn_red', 'WoodSiding005', tint=(0.62, 0.12, 0.08), strength=0.7, scale=2.5, grime=0.45)
    W, D, H = 9.5, 14.0, 4.2
    box((W + 0.3, D + 0.3, 0.4), (0, 0, 0), m['found'])
    box((W, D, H), (0, 0, 0.4), red)
    # the gambrel roof: a profile across x extruded along y
    prof = [(-W / 2 - 0.4, -0.2), (W / 2 + 0.4, -0.2), (3.0, 2.6), (0, 3.6), (-3.0, 2.6)]
    prism(prof, D + 0.8, (0, 0, H + 0.4), tex('barn_roof', 'worn_corrugated_iron', scale=2.0, grime=0.2), axis='y')
    for sy in (-1, 1):
        prism([(-W / 2, 0), (W / 2, 0), (3.0, 2.5), (0, 3.4), (-3.0, 2.5)], 0.1, (0, sy * (D / 2 - 0.05), H + 0.4), red, axis='y')
    # the big doors with white X braces, the hay door, the hay hood
    for sy in (-1, 1):
        for sx in (-1, 1):
            dx = sx * 1.3
            box((2.5, 0.1, 3.6), (dx, sy * (D / 2 + 0.03), 0.4), red, bevel=0.01)
            box((2.6, 0.14, 0.14), (dx, sy * (D / 2 + 0.06), 0.4 + 3.55), m['trim'])
            box((2.6, 0.14, 0.14), (dx, sy * (D / 2 + 0.06), 0.4), m['trim'])
            box((0.14, 0.14, 3.6), (dx - sx * 1.25, sy * (D / 2 + 0.06), 0.4), m['trim'])
            a, L = 0.6 * sx, 4.3          # the X brace across the door, centred on it
            box((0.14, 0.12, L), (dx - math.sin(a) * L / 2, sy * (D / 2 + 0.08), 2.2 - math.cos(a) * L / 2), m['trim'], rot=(0, a, 0))
        box((1.8, 0.1, 1.6), (0, sy * (D / 2 + 0.03), H + 0.9), m['dark'])
        box((2.0, 0.14, 0.12), (0, sy * (D / 2 + 0.08), H + 2.5), m['trim'])
        box((0.4, 1.6, 0.4), (0, sy * (D / 2 + 0.6), H + 3.1), red)
    # windows along the sides, the cupola with a weather vane
    for sx in (-1, 1):
        for k in range(4):
            box((0.06, 0.9, 0.9), (sx * (W / 2 + 0.02), -4.5 + k * 3.0, 2.2), m['glass'])
    box((1.8, 1.8, 1.6), (0, 0, H + 3.9), red)
    prism([(-1.2, 0), (1.2, 0), (0, 1.0)], 2.4, (0, 0, H + 5.5), tex('barn_roof', 'worn_corrugated_iron', scale=2.0, grime=0.2), axis='y')
    cyl(0.03, 1.4, (0, 0, H + 6.5), m['dark'], segs=4)
    box((0.9, 0.04, 0.3), (0, 0, H + 7.5), m['dark'])
    # hay bales and a feed trough
    hay = tex('hay', 'hessian_230', tint=(0.80, 0.68, 0.36), strength=0.8, scale=0.8, grime=0.3)
    for k, (hx, hy, hz) in enumerate([(-W / 2 - 1.6, 3.0, 0), (-W / 2 - 1.6, 4.3, 0), (-W / 2 - 1.6, 3.65, 0.8)]):
        box((1.2, 1.1, 0.8), (hx, hy, hz), hay, bevel=0.1, segs=2)
    box((0.7, 3.0, 0.6), (W / 2 + 1.2, -3.0, 0), tex('crate_wood', 'blue_painted_planks', tint=(0.55, 0.45, 0.30), strength=0.9, scale=1.2, grime=0.3))


def silo():
    """a concrete stave silo with steel hoops and a dome"""
    m = M()
    stave = tex('stave', 'Concrete031', tint=(0.78, 0.74, 0.66), strength=0.5, scale=1.5, grime=0.5)
    cyl(2.4, 13.0, (0, 0, 0), stave, segs=24)
    for k in range(12):
        cyl(2.44, 0.06, (0, 0, 0.8 + k * 1.05), m['dark'], segs=24)
    cyl(2.5, 1.6, (0, 0, 13.0), tex('silo_dome', 'worn_corrugated_iron', scale=1.5, grime=0.15), segs=24, r2=0.3)
    box((0.7, 0.4, 13.0), (0, 2.45, 0), tex('barn_red', 'WoodSiding005', tint=(0.62, 0.12, 0.08), strength=0.7, scale=2.5, grime=0.45))
    for k in range(13):
        box((0.6, 0.06, 0.04), (0, 2.68, 0.5 + k * 1.0), m['dark'])


# ------------------------------------------------------------------------------------------------ the water tower
def water_tower(label='COPPER BASIN'):
    """a steel water tower: four braced legs, a riser, a tank with a balcony and the town's name"""
    m = M()
    steel = tex('tower_steel', 'rusty_metal_02', tint=(0.78, 0.80, 0.80), strength=0.35, scale=2.5, grime=0.3)
    H = 13.0
    for a in range(4):
        aa = math.pi / 4 + a * math.pi / 2
        x, y = 3.4 * math.cos(aa), 3.4 * math.sin(aa)
        lean = 0.12
        cyl(0.2, H + 0.4, (x, y, 0), steel, segs=8, rot=(lean * math.sin(aa), -lean * math.cos(aa), 0))
        box((0.9, 0.9, 0.5), (x, y, 0), m['concrete'])
    for z in (4.0, 8.5):
        for a in range(4):
            a0, a1 = math.pi / 4 + a * math.pi / 2, math.pi / 4 + (a + 1) * math.pi / 2
            r = 3.4 - z * 0.11
            p0, p1 = (r * math.cos(a0), r * math.sin(a0)), (r * math.cos(a1), r * math.sin(a1))
            L = math.dist(p0, p1)
            ang = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
            box((L, 0.12, 0.12), ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, z), steel, rot=(0, 0, ang))
    cyl(0.5, H, (0, 0, 0), steel, segs=12)
    # the tank: a cylinder with a conical roof and a rounded bottom, a balcony on brackets
    cyl(1.0, 1.0, (0, 0, H - 0.6), steel, segs=28, r2=3.9)
    cyl(3.9, 4.0, (0, 0, H + 0.4), steel, segs=28)
    cyl(4.0, 1.4, (0, 0, H + 4.4), steel, segs=28, r2=0.3)
    cyl(0.25, 0.6, (0, 0, H + 5.8), steel, segs=8)
    cyl(4.6, 0.1, (0, 0, H + 0.35), m['dark'], segs=28)
    for k in range(28):
        a = 2 * math.pi * k / 28
        cyl(0.03, 1.0, (4.55 * math.cos(a), 4.55 * math.sin(a), H + 0.45), m['dark'], segs=4)
    cyl(4.6, 0.05, (0, 0, H + 1.45), m['dark'], segs=28, cap=False)
    letters(paint('tower_letter', (0.12, 0.18, 0.30), grime=0.0, noise=0.0), label, 0, 3.92, H + 2.0, 0.55)
    for k in range(int(H / 0.4)):          # the ladder up the riser
        box((0.5, 0.04, 0.04), (0, 0.6, 0.4 + k * 0.4), m['dark'])
    box((0.04, 0.04, H), (-0.25, 0.6, 0), m['dark']); box((0.04, 0.04, H), (0.25, 0.6, 0), m['dark'])


# ------------------------------------------------------------------------------------------------ street furniture
def telephone_pole():
    """a wooden telephone pole with two cross-arms, glass insulators and a transformer can"""
    m = M()
    wood = tex('pole_wood', 'Planks037A', tint=(0.40, 0.32, 0.24), strength=0.6, scale=1.0, grime=0.2)
    cyl(0.14, 9.5, (0, 0, 0), wood, segs=10, r2=0.11)
    insul = paint('insulator', (0.45, 0.68, 0.62), grime=0.0)
    for z in (8.4, 7.6):
        box((2.4, 0.12, 0.12), (0, 0, z), wood)
        for x in (-1.05, -0.55, 0.55, 1.05):
            cyl(0.05, 0.16, (x, 0, z + 0.12), insul, segs=8)
    cyl(0.28, 0.75, (0.0, -0.3, 6.2), paint('transformer', (0.45, 0.47, 0.46), grime=0.3), segs=12)
    box((0.06, 0.4, 0.06), (0, -0.15, 6.6), m['dark'])


def street_lamp():
    """a cobra-head street light on a steel pole"""
    m = M()
    steel = paint('lamp_steel', (0.52, 0.54, 0.53), grime=0.3)
    cyl(0.12, 6.3, (0, 0, 0), steel, segs=10, r2=0.07)
    cyl(0.2, 0.4, (0, 0, 0), steel, segs=10)
    box((0.08, 1.8, 0.08), (0, 0.85, 6.2), steel, rot=(0.15, 0, 0))
    box((0.35, 0.75, 0.2), (0, 1.85, 6.35), steel, bevel=0.06)
    box((0.28, 0.6, 0.04), (0, 1.85, 6.24), glow('streetlamp', (1.0, 0.85, 0.55), 1.0))


def picket_fence(n=8):
    """a white picket fence, 4 m"""
    m = M()
    white = paint('picket', (0.92, 0.91, 0.86), grime=0.45)
    for k in range(n * 2):
        x = -2.0 + 0.125 + k * 0.25
        box((0.09, 0.03, 0.95), (x, 0, 0), white)
        prism([(-0.045, 0), (0.045, 0), (0, 0.1)], 0.03, (x, 0, 0.95), white, axis='y')
    for z in (0.25, 0.75):
        box((4.0, 0.05, 0.08), (0, -0.04, z), white)
    for x in (-2.0, 2.0):
        box((0.1, 0.1, 1.05), (x, -0.02, 0), white)


def chain_fence():
    """a chain-link fence panel with steel posts and barbed wire on top, 4 m"""
    m = M()
    steel = paint('fence_steel', (0.62, 0.64, 0.63), grime=0.3)
    mesh = tex('chainlink', 'rusty_metal_grid', tint=(0.58, 0.60, 0.58), strength=0.7, scale=0.5, grime=0.2)
    box((4.0, 0.02, 1.9), (0, 0, 0.05), mesh)
    for x in (-2.0, 2.0):
        cyl(0.05, 2.2, (x, 0, 0), steel, segs=8)
    box((4.0, 0.04, 0.04), (0, 0, 1.95), steel)
    for z in (2.05, 2.15):
        box((4.0, 0.02, 0.02), (0, 0.1, z), m['dark'])


def billboard(text='SEE THE USA'):
    """a billboard on wooden legs: a painted advertisement with a sunny landscape"""
    m = M()
    wood = tex('pole_wood', 'Planks037A', tint=(0.40, 0.32, 0.24), strength=0.6, scale=1.0, grime=0.2)
    board = paint('board', (0.93, 0.88, 0.70), grime=0.25)
    for x in (-3.0, 0, 3.0):
        box((0.22, 0.22, 7.8), (x, -0.1, 0), wood)
        box((0.12, 0.12, 4.0), (x, -1.2, 0), wood, rot=(-0.35, 0, 0))
    box((8.0, 0.15, 3.8), (0, 0, 4.0), board)
    box((8.0, 0.1, 1.5), (0, 0.08, 4.0), paint('board_land', (0.40, 0.55, 0.30), grime=0.0))
    box((8.0, 0.1, 1.0), (0, 0.08, 5.5), paint('board_sky', (0.45, 0.70, 0.88), grime=0.0))
    cyl(0.55, 0.05, (2.6, 0.13, 6.3), paint('board_sun', (0.98, 0.80, 0.25), grime=0.0), segs=16, rot=(-math.pi / 2, 0, 0))
    letters(paint('board_letter', (0.70, 0.10, 0.08), grime=0.0), text, -0.4, 0.15, 6.55, 0.6)
    box((8.4, 0.3, 0.12), (0, 0.0, 7.8), wood)
    box((8.0, 0.5, 0.08), (0, 0.4, 3.9), wood)
    for x in (-2.5, 0, 2.5):          # lamps over the board
        box((0.06, 0.6, 0.06), (x, 0.3, 7.85), m['dark'])
        box((0.3, 0.25, 0.15), (x, 0.6, 7.75), m['dark'])


def mailbox():
    """a rural mailbox on a post, with its red flag"""
    m = M()
    wood = tex('pole_wood', 'Planks037A', tint=(0.40, 0.32, 0.24), strength=0.6, scale=1.0, grime=0.2)
    box((0.12, 0.12, 1.05), (0, 0, 0), wood)
    loft([(-0.25, 0.12, 1.05, 1.35, 0.9, 1.0), (0.25, 0.12, 1.05, 1.35, 0.9, 1.0)], paint('mailbox', (0.60, 0.62, 0.60), grime=0.3), ring=16)
    box((0.02, 0.05, 0.25), (0.13, -0.1, 1.2), paint('flag_red', (0.75, 0.10, 0.08)))
