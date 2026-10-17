"""Camps, works and the SEAS structures of the sequel: the Army's camp, the power station and the dam, the launch
site, the rift and Taslov's machines (art/sequel/kit.py; the front looks along +y)."""
import math
from .kit import box, cyl, prism, loft, tex, paint, mirror, glow, party
from .town import M, window, door, letters, crate, drum
from .vehicles import olive, seas_red, plate, rivets


def canvas():
    return tex('canvas', 'hessian_230', tint=(0.40, 0.40, 0.26), strength=0.75, scale=1.0, grime=0.35)


def sandbag_mat():
    return tex('sandbag', 'hessian_230', tint=(0.66, 0.58, 0.40), strength=0.7, scale=0.6, grime=0.4)


def _bag(mat, x, y, z, rot, w):
    """one sandbag, a rounded pillow w long, lying along x turned by rot, at (x, y, z)"""
    from .kit import PARTS
    import mathutils
    loft([(-w / 2, 0.20, 0, 0.22, 0.9, 0.8), (-w / 2 + 0.08, 0.25, 0, 0.32, 0.9, 0.85), (w / 2 - 0.08, 0.25, 0, 0.32, 0.9, 0.85), (w / 2, 0.20, 0, 0.22, 0.9, 0.8)], mat, ring=10)
    ob = PARTS[-1]
    # the loft runs along y: turn it to run along x, then place it
    ob.data.transform(mathutils.Matrix.Rotation(math.pi / 2 + rot, 4, 'Z'))
    ob.data.transform(mathutils.Matrix.Translation((x, y, z)))


# ------------------------------------------------------------------------------------------------ the Army's camp
def quonset(L=16.0):
    """a corrugated-steel Quonset hut: a half-round tunnel, plank end walls with a door and windows"""
    m = M()
    steel = tex('quonset_steel', 'worn_corrugated_iron', scale=1.8, grime=0.35)
    R = 4.6
    box((2 * R + 0.6, L + 0.6, 0.25), (0, 0, 0), m['concrete'])
    # the shell (the corrugations run round it: the texture is mapped along the tunnel)
    prof = [(R * math.cos(math.pi * i / 16), R * math.sin(math.pi * i / 16)) for i in range(17)]
    inner = [(x * 0.97, z * 0.97) for x, z in reversed(prof)]
    prism(prof + inner, L, (0, 0, 0.25), steel, axis='y', uvscale=1.8, smooth=True)
    ends = tex('quonset_end', 'Planks037A', tint=(0.40, 0.38, 0.30), strength=0.7, scale=1.5, grime=0.4)
    for sy in (-1, 1):
        prism(prof, 0.12, (0, sy * (L / 2 - 0.06), 0.25), ends, axis='y')
    door(m, 0, L / 2 + 0.04, 0.25, olive(), w=1.4, h=2.3)
    for sx in (-2.6, 2.6):
        window(m, sx, L / 2 + 0.04, 1.4, 1.0, 0.8, 1, None, sill=False)
    for k in range(5):          # the vents on the ridge, a stovepipe
        cyl(0.18, 0.5, (0, -L / 2 + 2 + k * 3.0, R + 0.1), steel, segs=8)
    cyl(0.12, 1.5, (2.5, -3.0, 4.0), m['dark'], segs=8)
    letters(paint('stencil', (0.92, 0.92, 0.88), grime=0.2), 'HQ', 0, L / 2 + 0.12, 3.0, 0.55)
    for k in range(3):
        crate(R + 0.9, L / 2 - 1.5 - k * 0.9, 0, 0.8, rot=0.1 * k)


def tent():
    """a squad tent: olive canvas on poles, the walls rolled up at the door, guy lines and stakes"""
    m = M()
    c = canvas()
    W, D = 5.0, 6.0
    prism([(-W / 2, 1.3), (W / 2, 1.3), (0, 3.1)], D, (0, 0, 0), c, axis='y')
    for sx in (-1, 1):
        box((0.05, D, 1.3), (sx * W / 2, 0, 0), c)
        for k in range(4):
            box((0.03, 0.03, 1.4), (sx * (W / 2 + 0.9), -D / 2 + 0.5 + k * 1.65, 0), m['dark'], rot=(0, sx * -0.9, 0))
    prism([(-W / 2, 0), (W / 2, 0), (W / 2, 1.3), (0, 3.1), (-W / 2, 1.3)], 0.05, (0, -D / 2, 0), c, axis='y')
    cyl(0.35, 0.25, (-W / 2 + 0.3, D / 2 + 0.2, 1.2), c, segs=10, rot=(0, math.pi / 2, 0))     # the door flap, rolled up
    for y in (-D / 2, D / 2):
        cyl(0.05, 3.15, (0, y, 0), tex('pole_wood', 'Planks037A', tint=(0.40, 0.32, 0.24), strength=0.6, scale=1.0, grime=0.2), segs=6)
    box((0.9, 2.0, 0.35), (1.4, 1.0, 0), olive(), bevel=0.02)       # a cot inside the door


def sandbags(n=6):
    """a sandbag wall: three courses, staggered"""
    mat = sandbag_mat()
    for row in range(3):
        for i in range(n - (row % 2)):
            _bag(mat, -n * 0.45 + 0.45 + i * 0.9 + (row % 2) * 0.45, 0, row * 0.3, 0.0, 0.9)


def barricade():
    """a sawhorse road barricade: striped boards on trestles, a warning lamp"""
    m = M()
    white = paint('bar_white', (0.92, 0.91, 0.86), grime=0.45)
    red = paint('bar_red', (0.78, 0.12, 0.08), grime=0.35)
    for x in (-1.3, 1.3):
        for sy in (-1, 1):
            box((0.08, 0.08, 1.15), (x, sy * 0.18, 0), white, rot=(sy * 0.3, 0, 0))
    for z, k in ((0.85, 0), (0.45, 1)):
        box((3.0, 0.05, 0.25), (0, 0.0, z), white)
        for j in range(5):
            prism([(0, 0), (0.25, 0), (0.55, 0.25), (0.3, 0.25)], 0.06, (-1.4 + j * 0.62 + k * 0.3, 0.01, z), red, axis='y')
    cyl(0.1, 0.14, (1.3, 0, 1.15), glow('warn_lamp', (1.0, 0.6, 0.1), 0.8), segs=10)


def watchtower():
    """a timber guard tower: braced legs, a ladder, a railed cab with a hip roof and a searchlight"""
    m = M()
    wood = tex('tower_wood', 'Planks037A', tint=(0.48, 0.40, 0.30), strength=0.6, scale=1.5, grime=0.45)
    H = 7.0
    for sx in (-1, 1):
        for sy in (-1, 1):
            box((0.3, 0.3, H + 2.5), (sx * 1.6, sy * 1.6, 0), wood, rot=(-sy * 0.03, sx * 0.03, 0))
    for z in (1.5, 4.2):
        for sy in (-1, 1):
            box((3.3, 0.12, 0.2), (0, sy * 1.6, z), wood)
            box((4.4, 0.1, 0.16), (0, sy * 1.62, z + 1.3), wood, rot=(0, 0.62 * sy, 0))
        for sx in (-1, 1):
            box((0.12, 3.3, 0.2), (sx * 1.6, 0, z), wood)
    box((4.0, 4.0, 0.25), (0, 0, H), wood)
    for sy in (-1, 1):
        box((4.0, 0.08, 1.0), (0, sy * 1.98, H + 0.25), wood)
    for sx in (-1, 1):
        box((0.08, 4.0, 1.0), (sx * 1.98, 0, H + 0.25), wood)
    from .town import hip
    hip(tex('shingle', 'grey_roof_01', scale=2.5, grime=0.1), 4.6, 4.6, 1.5, (0, 0, H + 2.5))
    box((4.7, 4.7, 0.2), (0, 0, H + 2.35), wood)
    for k in range(int(H / 0.35)):
        box((0.6, 0.05, 0.05), (0, 1.95, 0.3 + k * 0.35), wood)
    for sx in (-0.3, 0.3):
        box((0.06, 0.06, H + 1.0), (sx, 1.95, 0), wood)
    box((0.5, 0.5, 0.4), (1.3, 1.3, H + 1.25), m['dark'], bevel=0.05)
    cyl(0.18, 0.05, (1.3, 1.56, H + 1.45), glow('lamp', (1.0, 0.95, 0.75), 0.8), segs=10, rot=(-math.pi / 2, 0, 0))


def checkpoint():
    """a road checkpoint: a guard hut, a striped boom gate, a stop sign and sandbags"""
    m = M()
    white = paint('bar_white', (0.92, 0.91, 0.86), grime=0.45)
    red = paint('bar_red', (0.78, 0.12, 0.08), grime=0.35)
    box((2.2, 2.2, 2.5), (-1.0, 0, 0), white, bevel=0.03)
    box((2.6, 2.6, 0.2), (-1.0, 0, 2.5), red, bevel=0.03)
    for sy in (-1, 1):
        box((1.6, 0.06, 0.8), (-1.0, sy * 1.1, 1.3), m['glass'])
    box((0.06, 1.6, 0.8), (0.1, 0, 1.3), m['glass'])
    box((0.4, 0.4, 1.1), (0.8, 0, 0), red)
    for k in range(7):
        box((0.85, 0.14, 0.14), (1.3 + k * 0.85, 0, 1.0), red if k % 2 == 0 else white)
    box((0.12, 0.12, 0.9), (7.0, 0, 0), white)
    cyl(0.04, 2.2, (-2.6, 1.5, 0), m['dark'], segs=6)
    cyl(0.35, 0.04, (-2.6, 1.53, 2.0), red, segs=8, rot=(-math.pi / 2, 0, 0))
    letters(white, 'STOP', -2.6, 1.56, 1.88, 0.12)
    mat = sandbag_mat()
    for row in range(2):
        for i in range(3):
            _bag(mat, -2.8 + i * 0.9 + (row % 2) * 0.3, -1.6, row * 0.3, 0.0, 0.9)


def drums(n=4):
    """a cluster of oil drums, one on its side"""
    cols = [(0.55, 0.12, 0.08), (0.33, 0.36, 0.22), (0.20, 0.32, 0.55), (0.75, 0.62, 0.15)]
    for i in range(n - 1):
        drum((i % 2) * 0.65, (i // 2) * 0.65, color=cols[i % 4])
    from .kit import PARTS
    import mathutils
    before = len(PARTS)
    drum(0, 0, color=cols[3])
    for ob in PARTS[before:]:
        ob.data.transform(mathutils.Matrix.Translation((0, 0, -0.45)))
        ob.data.transform(mathutils.Matrix.Rotation(math.pi / 2, 4, 'Y'))
        ob.data.transform(mathutils.Matrix.Translation((1.3, 0.9, 0.3)))


def crates():
    """a stack of supply crates and a tarp"""
    crate(0, 0, 0, 1.2)
    crate(1.25, 0.1, 0, 1.2, rot=0.08)
    crate(0.6, 0.05, 1.2, 1.0, rot=-0.1)
    box((0.5, 0.35, 0.3), (1.6, 0.9, 0), olive(), bevel=0.02)
    box((0.5, 0.35, 0.3), (1.6, 0.9, 0.3), olive(), bevel=0.02)


def pen():
    """a containment pen: concrete posts, heavy steel rails, an open gate at +x and a control hut"""
    m = M()
    steel = tex('pen_steel', 'rusty_metal_02', tint=(0.50, 0.50, 0.48), strength=0.4, scale=2.0, grime=0.3)
    R, n = 12.0, 16
    for i in range(1, n):
        a, a2 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        x, y = R * math.cos(a), R * math.sin(a)
        box((0.6, 0.6, 3.5), (x, y, 0), m['concrete'], rot=(0, 0, a), bevel=0.04)
        if i + 1 != n:
            x2, y2 = R * math.cos(a2), R * math.sin(a2)
            L = math.dist((x, y), (x2, y2))
            ang = math.atan2(y2 - y, x2 - x)
            for z in (1.0, 2.0, 3.0):
                box((L, 0.16, 0.22), ((x + x2) / 2, (y + y2) / 2, z), steel, rot=(0, 0, ang))
    hut = seas_red()
    box((3.0, 2.5, 2.8), (R + 3, 0, 0), hut, bevel=0.04)
    box((3.3, 2.8, 0.2), (R + 3, 0, 2.8), plate())
    box((0.06, 1.4, 0.7), (R + 1.47, 0, 1.4), m['glass'])
    for k in range(4):          # feed troughs and a water tank inside
        box((0.8, 2.4, 0.5), (-6 + k * 3.5, -8, 0), m['concrete'], bevel=0.05)
    cyl(1.2, 1.5, (-7, 6, 0), steel, segs=16)


# ------------------------------------------------------------------------------------------------ power and water
def power_station(label=True):
    """a coal-fired generating station: a brick turbine hall with tall windows, three stacks, a transformer yard"""
    m = M()
    brick = tex('ps_brick', 'Bricks097', scale=2.5, grime=0.5)
    W, D, H = 28.0, 14.0, 11.0
    box((W + 1, D + 1, 0.5), (0, 0, 0), m['concrete'])
    box((W, D, H), (0, 0, 0.5), brick)
    box((W + 0.4, D + 0.4, 0.6), (0, 0, H + 0.5), m['concrete'], bevel=0.05)
    for i in range(7):
        x = -W / 2 + 2.5 + i * (W - 5) / 6
        box((2.0, 0.08, 7.0), (x, D / 2 + 0.02, 2.5), m['glass'])
        for k in range(6):
            box((2.1, 0.12, 0.08), (x, D / 2 + 0.05, 2.5 + k * 1.4), m['dark'])
        box((0.6, 0.3, H), (x + 1.75, D / 2 + 0.1, 0.5), brick)
    for x in (-8, 0, 8):
        cyl(1.6, 16.0, (x, -3.0, H + 1.1), brick, segs=16, r2=1.25)
        cyl(1.4, 0.6, (x, -3.0, H + 17.0), m['dark'], segs=16)
    # the coal bunker and conveyor, the transformer yard (fenced, insulators), the big doors
    box((6.0, 5.0, 6.0), (W / 2 + 3.5, -2, 0.5), tex('quonset_steel', 'worn_corrugated_iron', scale=1.8, grime=0.35))
    box((1.4, 12.0, 1.2), (W / 2 + 2, -10, 6.0), m['dark'], rot=(0.35, 0, 0))
    yard = paint('transformer', (0.45, 0.47, 0.46), grime=0.3)
    for x in (-10, -4, 2, 8):
        box((2.4, 2.0, 2.6), (x, D / 2 + 6, 0.5), yard, bevel=0.05)
        for k in range(3):
            cyl(0.15, 1.2, (x - 0.7 + k * 0.7, D / 2 + 6, 3.1), paint('insulator_brown', (0.45, 0.25, 0.15)), segs=8)
    box((W, 0.05, 2.4), (0, D / 2 + 9, 0.5), tex('chainlink', 'rusty_metal_grid', tint=(0.58, 0.60, 0.58), strength=0.7, scale=0.5, grime=0.2))
    box((4.0, 0.1, 5.0), (-W / 2 + 4, D / 2 + 0.05, 0.5), tex('shutter', 'painted_metal_shutter', scale=2.0, grime=0.4))
    if label:
        letters(paint('ps_letter', (0.92, 0.90, 0.84), grime=0.3), 'BLACK CANYON', 3.0, D / 2 + 0.15, H - 1.3, 0.8)


def pylon():
    """a steel lattice transmission tower with three cross-arms and insulator strings"""
    m = M()
    steel = paint('pylon_steel', (0.55, 0.57, 0.56), grime=0.25)
    H = 22.0

    def strut(p, q, r=0.07):
        d = [q[i] - p[i] for i in range(3)]
        L = math.sqrt(sum(x * x for x in d))
        yaw = math.atan2(d[1], d[0])
        pitch = math.acos(max(-1, min(1, d[2] / L)))
        cyl(r, L, p, steel, segs=4, rot=(0, pitch, yaw), smooth=False)

    levels = [(0.0, 3.2), (8.0, 1.6), (16.0, 0.9), (H, 0.6)]
    for (z0, w0), (z1, w1) in zip(levels, levels[1:]):
        for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
            strut((sx * w0, sy * w0, z0), (sx * w1, sy * w1, z1), 0.1)
        for (ax, ay), (bx, by) in (((1, 1), (-1, 1)), ((-1, 1), (-1, -1)), ((-1, -1), (1, -1)), ((1, -1), (1, 1))):
            strut((ax * w0, ay * w0, z0), (bx * w1, by * w1, z1))
            strut((bx * w0, by * w0, z0), (ax * w1, ay * w1, z1))
    for z, half in ((12.0, 5.5), (16.5, 4.5), (20.5, 3.5)):
        box((2 * half, 0.25, 0.3), (0, 0, z), steel)
        for sx in (-1, 1):
            strut((sx * 1.0, 0, z - 1.5), (sx * half, 0, z), 0.06)
            cyl(0.12, 1.4, (sx * (half - 0.2), 0, z - 1.4), paint('insulator_brown', (0.45, 0.25, 0.15)), segs=8)
    for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
        box((1.0, 1.0, 0.5), (sx * 3.2, sy * 3.2, 0), M()['concrete'])


def dam_section():
    """a piece of a concrete gravity dam, 40 m wide and 30 m high: the sloped downstream face toward +y, a road on
    the crest with parapets and lamp posts, spillway gates"""
    m = M()
    conc = tex('dam_conc', 'Concrete031', tint=(0.74, 0.72, 0.66), strength=0.5, scale=4.0, grime=0.7)
    prism([(-6, 0), (10, 0), (1, 30), (-3, 30)], 40.0, (0, 0, 0), conc, axis='x', uvscale=4.0)
    for sy in (-3.2, 1.0):
        box((40.0, 0.4, 1.2), (0, sy, 30), conc)
    for x in (-15, -5, 5, 15):
        cyl(0.1, 4.0, (x, -3.2, 31.2), m['dark'], segs=6)
        box((0.25, 0.6, 0.18), (x, -2.95, 35.1), m['dark'])
    for x in (-12, -4, 4, 12):           # the spillway gates and their piers
        box((1.5, 4.0, 4.5), (x, -1.0, 30), conc)
        box((5.0, 0.3, 3.5), (x + 3.25, 0.6, 26.0), tex('dam_gate', 'rusty_metal_02', scale=2.0, grime=0.3))


# ------------------------------------------------------------------------------------------------ the launch site
def rocket_body():
    """a two-stage rocket of 1964: white with black roll bands, red fins, the payload fairing; its origin is the base
    of the first stage (the engine bells hang below it, into the launch table: TABLE_TOP)"""
    m = M()
    white = paint('rocket_white', (0.93, 0.93, 0.90), grime=0.25, noise=0.03)
    black = paint('rocket_black', (0.08, 0.08, 0.08), grime=0.0)
    red = paint('rocket_red', (0.75, 0.10, 0.08), grime=0.2)
    cyl(2.0, 20, (0, 0, 0), white, segs=28)
    cyl(2.0, 0.6, (0, 0, 20), white, segs=28, r2=1.7)
    cyl(1.7, 10, (0, 0, 20.6), white, segs=28)
    cyl(1.7, 5.5, (0, 0, 30.6), white, segs=28, r2=0.25)
    cyl(0.12, 2.0, (0, 0, 36.0), m['dark'], segs=6)                   # the escape tower spike
    for z, h, r in ((6, 1.6, 2.02), (14, 1.6, 2.02), (24.5, 1.2, 1.72)):
        cyl(r, h, (0, 0, z), black, segs=28)
    cyl(2.04, 0.5, (0, 0, 0), m['dark'], segs=28)                      # the thrust ring
    for a in range(4):
        aa = a * math.pi / 2 + math.pi / 4
        prism([(0, 0), (2.6, 0), (2.6, 1.2), (0, 5.0)], 0.22, (math.cos(aa) * 1.95, math.sin(aa) * 1.95, 0), red, axis='y', rot=(0, 0, aa))
    for a in range(4):          # four engine bells under the first stage
        aa = a * math.pi / 2
        cyl(0.75, 1.4, (0.8 * math.cos(aa), 0.8 * math.sin(aa), -1.4), m['dark'], segs=12, r2=0.4)
    letters(paint('rocket_letter', (0.10, 0.18, 0.40), grime=0.0), 'SEAS', 0, 2.02, 9.0, 1.2)


TABLE_TOP = 5.0            # where the rocket stands on its pad (the launch table's deck; sequel_ui.js puts it there)


def launch_pad():
    """Launch Complex 34: the concrete pad with the flame trench, the launch table on four legs (the rocket stands on
    it as its own model, sequel_ui.js), the red umbilical tower with swing arms, propellant tanks beside the pad"""
    m = M()
    conc = tex('pad_conc', 'Concrete031', tint=(0.78, 0.76, 0.70), strength=0.5, scale=4.0, grime=0.6)
    steel = tex('pen_steel', 'rusty_metal_02', tint=(0.50, 0.50, 0.48), strength=0.4, scale=2.0, grime=0.3)
    box((14.0, 14.0, 0.6), (0, 0, 0), conc)
    box((4.0, 16.0, 0.12), (0, 0, 0.55), M()['dark'])                  # the flame trench
    for sx in (-1, 1):
        for sy in (-1, 1):
            box((1.4, 1.4, TABLE_TOP - 0.6), (sx * 2.8, sy * 2.8, 0.6), conc, bevel=0.05)
    # the table: a steel deck with a round opening (four plates round the hole) and hold-down arms
    for sx in (-1, 1):
        box((7.4, 2.2, 0.5), (0, sx * 2.6, TABLE_TOP - 0.5), steel)
        box((2.2, 3.0, 0.5), (sx * 2.6, 0, TABLE_TOP - 0.5), steel)
    for a in range(4):
        aa = a * math.pi / 2 + math.pi / 4
        box((0.5, 1.0, 0.9), (2.3 * math.cos(aa), 2.3 * math.sin(aa), TABLE_TOP), steel, rot=(0, 0, aa))
    red = paint('tower_red', (0.72, 0.18, 0.10), grime=0.45)
    tx = 6.5
    for sx in (-1, 1):
        for sy in (-1, 1):
            box((0.35, 0.35, 40.0), (tx + sx * 1.6, sy * 1.6, 0.6), red)
    for k in range(20):
        z = 2.6 + k * 2.0
        for sy in (-1, 1):
            box((3.5, 0.2, 0.2), (tx, sy * 1.6, z), red)
            box((0.2, 3.5, 0.2), (tx + sy * 1.6, 0, z), red)
            box((4.4, 0.12, 0.12), (tx, sy * 1.6, z - 1.0), red, rot=(0, 0.75 * sy * (1 if k % 2 else -1), 0))
    for z in (TABLE_TOP + 10.0, TABLE_TOP + 20.0, TABLE_TOP + 29.0):     # the swing arms toward the rocket
        box((3.6, 1.0, 0.3), (tx - 3.4, 0, z), red)
        box((3.6, 0.06, 0.8), (tx - 3.4, 0.5, z + 0.3), M()['dark'])
    cyl(0.9, 2.0, (tx, 0, 40.6), red, segs=12)
    box((2.5, 2.5, 3.0), (tx + 3.5, 4.0, 0.6), plate(), bevel=0.05)
    # propellant tanks lying on cradles beside the pad, piped to the tower
    for k in range(2):
        y = -4.5 + k * 3.0
        cyl(1.0, 5.0, (-9.5, y, 1.5), paint('lox_tank', (0.90, 0.90, 0.86), grime=0.35), segs=18, rot=(0, math.pi / 2, 0))
        for x in (-11.0, -8.0):
            box((0.4, 1.6, 1.0), (x, y, 0), conc)
    box((0.2, 0.2, 12.0), (-7.0, -3.0, 0.9), M()['dark'], rot=(0, math.pi / 2, 0))


# ------------------------------------------------------------------------------------------------ the rift
def rift():
    """a tear between the worlds: a standing ring of fractured light over scorched, cracked ground, shards of
    ParaWorld's rock and jungle roots pushed through"""
    m = M()
    scorch = tex('scorch', 'Concrete031', tint=(0.18, 0.14, 0.12), strength=0.8, scale=3.0, grime=0.0)
    cyl(9.0, 0.08, (0, 0, 0), scorch, segs=32)
    core = glow('riftcore', (0.55, 0.85, 1.0), 1.0)
    edge = glow('riftglow', (0.75, 0.40, 1.0), 1.0)
    # the ring: shards around an ellipse, standing upright across x
    n = 22
    for i in range(n):
        a = 2 * math.pi * i / n
        x, z = 4.4 * math.cos(a), 6.0 + 5.4 * math.sin(a)
        s = 0.5 + 0.35 * ((i * 7) % 5) / 4
        box((s, 0.5 + 0.3 * (i % 3), s * 1.6), (x, 0, z - s * 0.8), edge, rot=(0.3 * (i % 4), a, 0.2 * (i % 3)))
    # the core: an upright disc of light
    cyl(4.0, 0.12, (0, 0.0, 6.0), core, segs=24, rot=(math.pi / 2, 0, 0))
    m_rock = tex('rift_rock', 'Rust009', tint=(0.30, 0.26, 0.24), strength=0.7, scale=2.0, grime=0.0)
    for i in range(9):           # rock shards thrust up around the tear
        a = 2 * math.pi * i / 9 + 0.3
        r = 6.0 + (i % 3) * 0.9
        h = 1.2 + (i * 5 % 4) * 0.7
        cyl(0.7 + (i % 2) * 0.3, h, (r * math.cos(a), r * math.sin(a), -0.2), m_rock, segs=5, r2=0.1, rot=(0.3 * math.sin(a), -0.3 * math.cos(a), a), smooth=False)
    root = paint('root', (0.25, 0.20, 0.14), grime=0.0)
    for i in range(6):
        a = 2 * math.pi * i / 6
        cyl(0.18, 4.0, (2.5 * math.cos(a), 2.5 * math.sin(a), 0), root, segs=6, r2=0.04, rot=(0.9 * math.sin(a), -0.9 * math.cos(a), 0))


# ------------------------------------------------------------------------------------------------ Taslov's machines (SEAS buildings)
def stabilizer():
    """Taslov's rift stabilizer: a copper coil tower on a riveted SEAS base, a glowing crown"""
    m = M()
    red = seas_red()
    pc = party('party', 0.85)
    copper = tex('copper', 'rusty_metal_02', tint=(0.78, 0.45, 0.22), strength=0.85, scale=1.0, grime=0.2)
    box((6.0, 6.0, 1.2), (0, 0, 0), plate(), bevel=0.08)
    box((6.1, 6.1, 0.3), (0, 0, 1.2), pc, bevel=0.03)
    cyl(1.8, 2.2, (0, 0, 1.5), red, segs=16)
    for sx in (-1, 1):
        rivets(m['dark'], -2.7, 2.7, sx * 3.0, 0.9, 10, axis='y', face=sx)
    cyl(0.8, 7.0, (0, 0, 3.5), copper, segs=16)
    for k in range(8):
        cyl(1.15, 0.28, (0, 0, 4.0 + k * 0.8), copper, segs=20)
    cyl(1.4, 0.6, (0, 0, 10.4), red, segs=16)
    cyl(1.5, 1.3, (0, 0, 11.0), m['chrome'], segs=20, r2=0.6)
    cyl(0.55, 0.8, (0, 0, 12.0), glow('coilglow', (0.55, 0.85, 1.0), 1.0), segs=12, r2=0.2)
    for a in range(3):
        aa = a * 2 * math.pi / 3
        cyl(0.13, 8.2, (2.6 * math.cos(aa), 2.6 * math.sin(aa), 1.2), red, segs=6, rot=(0.21 * math.sin(aa), -0.21 * math.cos(aa), 0))
    for a in range(4):
        aa = a * math.pi / 2 + math.pi / 4
        box((0.9, 0.6, 1.0), (3.6 * math.cos(aa), 3.6 * math.sin(aa), 0), red, rot=(0, 0, aa), bevel=0.04)


def searchlight():
    """a searchlight tower: a riveted steel trestle, a railed platform and the lamp's pivot. The lamp is its own
    model, sq_searchlamp, that the game turns with the beam at night (ui/sequel_ui.js: 9.2 m up)"""
    m = M()
    red = seas_red()
    pc = party('party', 0.85)
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(0.14, 8.1, (sx * 1.5, sy * 1.5, 0), red, segs=6, rot=(-sy * 0.07, sx * 0.07, 0))
    for z in (2.5, 5.0):
        for sy in (-1, 1):
            box((2.8, 0.1, 0.12), (0, sy * (1.5 - z * 0.06), z), m['dark'])
            box((3.6, 0.08, 0.08), (0, sy * (1.5 - z * 0.06), z - 1.2), m['dark'], rot=(0, 0.7 * sy, 0))
        for sx in (-1, 1):
            box((0.1, 2.8, 0.12), (sx * (1.5 - z * 0.06), 0, z), m['dark'])
    box((3.2, 3.2, 0.3), (0, 0, 8.0), tex('grate', 'metal_grate_rusty', scale=1.0, grime=0.4))
    for sy in (-1, 1):
        box((3.2, 0.06, 0.06), (0, sy * 1.6, 9.0), m['dark'])
        box((3.2, 0.25, 0.4), (0, sy * 1.6, 8.3), pc)
    for sx in (-1, 1):
        box((0.06, 3.2, 0.06), (sx * 1.6, 0, 9.0), m['dark'])
    cyl(0.3, 0.6, (0, 0, 8.3), red, segs=10)
    for k in range(int(8.0 / 0.4)):
        box((0.5, 0.04, 0.04), (1.0, 1.75, 0.3 + k * 0.4), m['dark'])


SEARCHLAMP_TILT = 0.5           # rad below the horizon: the beam meets the ground ~17 m out (ui/sequel_ui.js)


def searchlamp():
    """the searchlight's lamp on its fork, the origin at the pivot, the glass to the front (Blender +y, glTF -z),
    tilted down to the ground"""
    m = M()
    red = seas_red()
    d = SEARCHLAMP_TILT
    ax = (0, math.cos(d), -math.sin(d))
    rot = (-(math.pi / 2 + d), 0, 0)
    cyl(0.12, 0.5, (0, 0, -0.9), m['dark'], segs=8)
    box((1.9, 0.25, 0.12), (0, 0, -0.45), red)
    for sx in (-1, 1):
        box((0.12, 0.25, 0.9), (sx * 0.9, 0, -0.45), red)
    cyl(0.75, 1.1, tuple(-0.45 * a for a in ax), red, segs=18, rot=rot)
    cyl(0.68, 0.05, tuple(0.66 * a for a in ax), glow('searchlamp', (1.0, 0.97, 0.80), 1.0), segs=18, rot=rot)


def flak():
    """an anti-aircraft emplacement: a sandbag ring, a twin 40 mm gun on its mount, ammunition boxes"""
    m = M()
    red = seas_red()
    pc = party('party', 0.85)
    mat = sandbag_mat()
    for row in range(3):
        for i in range(14):
            a = 2 * math.pi * (i + 0.5 * (row % 2)) / 14
            if abs(math.sin(a / 2)) < 0.12:
                continue
            _bag(mat, 2.7 * math.cos(a), 2.7 * math.sin(a), row * 0.3, a, 1.1)
    cyl(1.0, 0.8, (0, 0, 0), plate(), segs=16)
    box((1.6, 1.2, 0.9), (0, 0, 0.8), red, bevel=0.06)
    box((1.7, 1.25, 0.15), (0, 0, 1.7), pc)
    for sx in (-0.3, 0.3):
        cyl(0.07, 2.8, (sx, 0.2, 1.6), m['dark'], segs=8, rot=(-math.pi / 2 + 0.75, 0, 0))
        cyl(0.13, 0.35, (sx, 2.0, 3.25), m['dark'], segs=8, rot=(-math.pi / 2 + 0.75, 0, 0))
    box((0.4, 0.5, 0.5), (0.7, -0.6, 0.8), m['dark'])
    for k in range(3):
        box((0.5, 0.3, 0.3), (-1.6 + k * 0.55, -1.6, 0), olive(), bevel=0.02)


def radar():
    """a radar post: an equipment shelter, a mast and a rotating parabolic dish"""
    m = M()
    red = seas_red()
    pc = party('party', 0.85)
    box((4.0, 4.0, 3.0), (0, 0, 0), red, bevel=0.06)
    box((4.1, 4.1, 0.3), (0, 0, 2.6), pc)
    box((4.3, 4.3, 0.2), (0, 0, 3.0), plate())
    door(m, -0.8, 2.0, 0, plate(), w=0.9, h=2.0)
    for sx in (-1, 1):
        rivets(m['dark'], -1.8, 1.8, sx * 2.0, 2.3, 8, axis='y', face=sx)
    box((0.7, 0.5, 0.5), (1.2, 2.1, 1.6), m['dark'])
    cyl(0.35, 3.0, (0, 0, 3.2), plate(), segs=10)
    # the dish: a shallow paraboloid of rings, the feed horn on struts
    dish = mirror('dish', sky=(0.80, 0.82, 0.84), horizon=(0.40, 0.42, 0.44), ground=(0.45, 0.42, 0.38))
    secs = []
    for i in range(7):
        r = 0.2 + 2.6 * i / 6
        secs.append((0.25 * (r / 2.8) ** 2 * 2.0 - 0.1, r, r, 0, 0, 0))
    import bmesh
    from .kit import _obj
    bm = bmesh.new()
    rings = []
    for d, r, *_ in secs:
        rings.append([bm.verts.new((r * math.cos(2 * math.pi * k / 20), d, r * math.sin(2 * math.pi * k / 20))) for k in range(20)])
    for a, b in zip(rings, rings[1:]):
        for k in range(20):
            bm.faces.new((a[k], a[(k + 1) % 20], b[(k + 1) % 20], b[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.08)
    import mathutils
    bmesh.ops.transform(bm, matrix=mathutils.Matrix.Translation((0, 0, 7.2)) @ mathutils.Matrix.Rotation(-0.5, 4, 'X'), verts=bm.verts)
    _obj(bm, dish)
    for a in range(3):
        aa = a * 2 * math.pi / 3
        cyl(0.04, 2.0, (1.5 * math.cos(aa), 0.3, 7.2 + 1.5 * math.sin(aa)), m['dark'], segs=4, rot=(-1.2, 0, 0))
    box((0.3, 0.4, 0.3), (0, 1.9, 8.2), m['dark'])


def field_hq():
    """the SEAS mobile command post: a riveted trailer with a canvas awning, radio masts and the owner's flag"""
    m = M()
    red = seas_red()
    pc = party('party', 0.85)
    box((9.0, 3.0, 3.0), (0, 0, 0.6), red, bevel=0.1, segs=2)
    box((9.05, 3.05, 0.35), (0, 0, 2.7), pc)
    box((9.2, 3.2, 0.2), (0, 0, 3.6), plate())
    for sy in (-1, 1):
        rivets(m['dark'], -4.2, 4.2, sy * 1.5, 1.0, 16, axis='x', face=sy)
    for x in (-2.5, 0.5, 3.0):
        window(m, x, 1.5, 1.6, 1.2, 0.8, 1, None, sill=False)
    door(m, -0.9, 1.5, 0.6, plate(), w=0.9, h=2.0)
    box((0.5, 0.6, 0.6), (-0.9, 2.0, 0.0), plate())
    box((0.3, 1.5, 0.3), (-4.9, 0, 0.6), m['dark'])
    for x in (-2.5, 3.0):
        for sy in (-1, 1):
            cyl(0.55, 0.3, (x, sy * 1.2, 0.55), m['rubber'], segs=16, rot=(math.pi / 2 * sy, 0, 0))
    c = canvas()
    box((5.0, 2.6, 0.06), (1.0, 2.8, 2.9), c, rot=(-0.18, 0, 0))
    for x in (-1.4, 3.4):
        cyl(0.04, 2.6, (x, 4.0, 0), m['dark'], segs=6)
    cyl(0.06, 9.0, (3.8, -1.0, 3.8), m['dark'], segs=6)
    cyl(0.04, 4.0, (-3.8, -1.0, 3.8), m['dark'], segs=6)
    box((0.03, 1.2, 0.8), (-3.8, -1.65, 7.0), pc)
    for k in range(3):
        crate(-3.2 + k * 0.9, 2.7, 0, 0.8, rot=0.1 * k)
    cyl(0.6, 1.0, (4.6, 2.4, 0), plate(), segs=12)          # the generator


def electric_net():
    """Taslov's electrified net: four insulated masts with glowing caps, a steel net on the ground, the generator"""
    m = M()
    red = seas_red()
    pc = party('party', 0.85)
    steel = tex('pen_steel', 'rusty_metal_02', tint=(0.50, 0.50, 0.48), strength=0.4, scale=2.0, grime=0.3)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box((0.8, 0.8, 0.4), (sx * 6, sy * 6, 0), plate())
            cyl(0.18, 4.0, (sx * 6, sy * 6, 0.4), red, segs=8)
            for k in range(4):
                cyl(0.32, 0.12, (sx * 6, sy * 6, 2.6 + k * 0.35), paint('insulator_brown', (0.45, 0.25, 0.15)), segs=10)
            cyl(0.35, 0.5, (sx * 6, sy * 6, 4.4), glow('coilglow', (0.55, 0.85, 1.0), 1.0), segs=10, r2=0.1)
    for i in range(7):
        t = -6 + i * 2
        box((0.07, 12.0, 0.07), (t, 0, 0.12), steel)
        box((12.0, 0.07, 0.07), (0, t, 0.12), steel)
    for sy in (-1, 1):
        box((12.0, 0.05, 0.05), (0, sy * 6, 4.2), m['dark'])
    box((1.2, 1.0, 1.1), (7.6, 0, 0), red, bevel=0.05)
    box((1.25, 1.05, 0.2), (7.6, 0, 1.1), pc)
    cyl(0.08, 0.8, (7.6, 0.3, 1.3), m['dark'], segs=6)


def gate_machine():
    """Taslov's Gate machine: three stabilizer coils round a great copper ring on a concrete pad, the owner's band
    round the pad, cables and the control cabin"""
    import mathutils
    from .kit import PARTS
    m = M()
    conc = tex('pad_conc', 'Concrete031', tint=(0.78, 0.76, 0.70), strength=0.5, scale=4.0, grime=0.6)
    pc = party('party', 0.85)
    cyl(16.0, 1.0, (0, 0, 0), conc, segs=40)
    cyl(15.6, 0.3, (0, 0, 1.0), pc, segs=40)
    for a in range(3):
        aa = a * 2 * math.pi / 3 + math.pi / 2
        before = len(PARTS)
        stabilizer()
        for ob in PARTS[before:]:
            ob.data.transform(mathutils.Matrix.Translation((10 * math.cos(aa), 10 * math.sin(aa), 1.0)) @ mathutils.Matrix.Scale(1.3, 4))
    copper = tex('copper', 'rusty_metal_02', tint=(0.78, 0.45, 0.22), strength=0.85, scale=1.0, grime=0.2)
    n = 24
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        p0, p1 = (6 * math.cos(a0), 9 + 6 * math.sin(a0)), (6 * math.cos(a1), 9 + 6 * math.sin(a1))
        L = math.dist(p0, p1)
        ang = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
        box((L + 0.05, 1.1, 1.1), ((p0[0] + p1[0]) / 2, 0, (p0[1] + p1[1]) / 2 - 0.55), copper, rot=(0, -ang, 0))
    cyl(5.4, 0.15, (0, 0, 9.0), glow('riftcore', (0.55, 0.85, 1.0), 0.6), segs=32, rot=(math.pi / 2, 0, 0))
    red = seas_red()
    for sx in (-1, 1):
        box((1.4, 1.4, 4.0), (sx * 6.6, 0, 1.0), red, bevel=0.05)
    box((4.0, 3.0, 3.0), (0, -12.0, 1.0), red, bevel=0.06)
    box((3.0, 0.06, 1.0), (0, -10.48, 2.4), m['glass'])
    for a in range(3):
        aa = a * 2 * math.pi / 3 + math.pi / 2
        box((0.3, 8.0, 0.25), (5 * math.cos(aa), 5 * math.sin(aa), 1.05), m['dark'], rot=(0, 0, aa + math.pi / 2))


def rocket_on_pad():
    """the launch site's decoration: the pad with a rocket standing on it"""
    import mathutils
    from .kit import PARTS
    launch_pad()
    before = len(PARTS)
    rocket_body()
    for ob in PARTS[before:]:
        ob.data.transform(mathutils.Matrix.Translation((0, 0, TABLE_TOP)))


# ------------------------------------------------------------------------------------------------ electricity (power.js)
def power_pole():
    """a wooden H-frame power pole: two poles, a cross-arm with insulators, a transformer can (the line's attach
    points are at 10.8 m: game/sequel/power.js ATTACH)"""
    m = M()
    wood = tex('pole_wood', 'Planks037A', tint=(0.40, 0.32, 0.24), strength=0.6, scale=1.0, grime=0.2)
    pc = party('party', 0.85)
    for sx in (-0.9, 0.9):
        cyl(0.16, 11.2, (sx, 0, 0), wood, segs=10, r2=0.13)
    box((3.0, 0.16, 0.18), (0, 0, 10.3), wood)
    box((2.0, 0.1, 0.1), (0, 0, 8.4), wood)
    for sx in (-0.9, 0.9):
        box((0.08, 0.08, 2.4), (sx * 0.5, 0, 8.4), wood, rot=(0, 0.75 * (1 if sx > 0 else -1), 0))
    insul = paint('insulator', (0.45, 0.68, 0.62), grime=0.0)
    for x in (-1.3, 0, 1.3):
        cyl(0.07, 0.3, (x, 0, 10.48), insul, segs=8)
    cyl(0.3, 0.8, (0, -0.35, 6.4), paint('transformer', (0.45, 0.47, 0.46), grime=0.3), segs=12)
    box((0.8, 0.04, 0.25), (0, 0.12, 3.0), pc)        # the owner's band (a painted sign board)
    for sx in (-0.9, 0.9):
        box((0.5, 0.5, 0.2), (sx, 0, 0), M()['concrete'])


def generator():
    """a skid-mounted diesel generator: the engine casing with louvres, the exhaust stack, fuel drums, a switch box"""
    m = M()
    olv = olive()
    pc = party('party', 0.85)
    box((4.2, 2.2, 0.3), (0, 0, 0), m['dark'])
    box((2.6, 1.8, 1.6), (-0.5, 0, 0.3), olv, bevel=0.06)
    for k in range(6):
        box((1.5, 0.04, 0.06), (-0.5, 0.92, 0.6 + k * 0.18), m['dark'])
    box((1.2, 1.6, 1.3), (1.4, 0, 0.3), plate(), bevel=0.04)                 # the alternator
    box((2.62, 1.82, 0.12), (-0.5, 0, 1.9), pc)
    cyl(0.12, 2.0, (-1.4, -0.5, 1.9), m['dark'], segs=8)
    cyl(0.16, 0.3, (-1.4, -0.5, 3.9), m['dark'], segs=8, r2=0.2)
    box((0.6, 0.35, 0.8), (2.2, 0.7, 0.3), paint('switchbox', (0.55, 0.57, 0.56), grime=0.3), bevel=0.03)
    drum(-2.6, -0.4); drum(-2.6, 0.35, color=(0.33, 0.36, 0.22))
    cyl(0.25, 0.05, (1.4, 0.82, 1.0), m['chrome'], segs=12, rot=(-math.pi / 2, 0, 0))     # the gauge


def windmill():
    """a wind charger: a steel lattice tower with a platform, the generator housing and tail vane on top (the
    three-bladed rotor is its own model, sq_windmill_rotor, turned by the game at the hub: 13.05 m up, 1.45 m in front)"""
    m = M()
    steel = paint('pylon_steel', (0.55, 0.57, 0.56), grime=0.3)
    pc = party('party', 0.85)
    H = 12.4

    def strut(p, q, r=0.06):
        d = [q[i] - p[i] for i in range(3)]
        L = math.sqrt(sum(x * x for x in d))
        cyl(r, L, p, steel, segs=4, rot=(0, math.acos(max(-1, min(1, d[2] / L))), math.atan2(d[1], d[0])), smooth=False)
    levels = [(0.0, 1.6), (4.0, 1.1), (8.0, 0.7), (H, 0.35)]
    for (z0, w0), (z1, w1) in zip(levels, levels[1:]):
        for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
            strut((sx * w0, sy * w0, z0), (sx * w1, sy * w1, z1), 0.08)
        for (ax, ay), (bx, by) in (((1, 1), (-1, 1)), ((-1, 1), (-1, -1)), ((-1, -1), (1, -1)), ((1, -1), (1, 1))):
            strut((ax * w0, ay * w0, z0), (bx * w1, by * w1, z1))
    box((1.4, 1.4, 0.1), (0, 0, H), tex('grate', 'metal_grate_rusty', scale=1.0, grime=0.4))
    # the nacelle (towards the front, +y) and the tail vane (back)
    loft([(1.3, 0.12, H + 0.3, H + 0.55, 0.9, 1.0), (0.8, 0.35, H + 0.25, H + 1.05, 0.9, 1.0), (-0.6, 0.32, H + 0.3, H + 1.0, 0.9, 1.0), (-0.9, 0.2, H + 0.45, H + 0.85, 0.9, 1.0)], olive(), ring=12)
    box((0.06, 2.6, 0.06), (0, -2.0, H + 0.65), steel)
    box((0.04, 1.2, 1.0), (0, -3.4, H + 0.3), pc)
    box((0.6, 0.5, 0.9), (1.2, 1.2, 0), paint('switchbox', (0.55, 0.57, 0.56), grime=0.3), bevel=0.03)
    for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
        box((0.6, 0.6, 0.3), (sx * 1.6, sy * 1.6, 0), M()['concrete'])


def windmill_rotor():
    """the wind charger's rotor: three wooden blades on a hub, the origin at the hub, turning about y (glTF z)"""
    wood = tex('blade_wood', 'Planks037A', tint=(0.70, 0.66, 0.58), strength=0.6, scale=1.0, grime=0.1)
    cyl(0.22, 0.5, (0, -0.2, 0), M()['chrome'], segs=12, rot=(-math.pi / 2, 0, 0))
    for k in range(3):
        a = k * 2 * math.pi / 3
        prism([(0.2, -0.12), (3.6, -0.06), (3.6, 0.06), (0.2, 0.18)], 0.04, (0, 0.1, 0), wood, axis='y', rot=(0, a, 0))


def watermill():
    """a water wheel powerhouse: a stone mill house on the bank, the wheel turning in a timber race at the back
    (the wheel is its own model, sq_waterwheel: the game turns it, its axle 2.2 m up and 4 m behind)"""
    m = M()
    stone = tex('mill_stone', 'Bricks089', scale=2.0, grime=0.4)
    wood = tex('tower_wood', 'Planks037A', tint=(0.48, 0.40, 0.30), strength=0.6, scale=1.5, grime=0.45)
    pc = party('party', 0.85)
    box((6.0, 5.0, 4.2), (0, 0.5, 0), stone)
    prism([(-2.8, 0), (3.8, 0), (0.5, 2.2)], 6.6, (0, 0, 4.2), tex('barn_roof', 'rusty_corrugated_iron', scale=2.0, grime=0.2), axis='x')
    for sx in (-1, 1):
        prism([(-2.0, 0), (3.0, 0), (0.5, 1.9)], 0.1, (sx * 2.95, 0, 4.2), wood, axis='x')
    door(m, 0, 3.0, 0, wood, w=1.2, h=2.2)
    for sx in (-2.0, 2.0):
        window(m, sx, 3.0, 1.4, 0.9, 1.0, 1, None)
    box((6.2, 0.15, 0.4), (0, 3.05, 3.7), pc)
    # the race: timber walls each side of the wheel, the axle into the house
    for sx in (-1.6, 1.6):
        box((0.3, 4.0, 3.2), (sx, -4.2, -0.6), wood)
    cyl(0.18, 2.6, (-1.3, -4.0, 2.2), m['dark'], segs=10, rot=(0, math.pi / 2, 0))
    box((1.0, 1.2, 1.0), (2.2, -1.7, 4.0), wood)
    cyl(0.12, 2.0, (2.2, -1.7, 5.0), m['dark'], segs=8)


def waterwheel():
    """the water wheel: two rims, spokes and paddles, the origin on the axle, turning about x"""
    wood = tex('tower_wood', 'Planks037A', tint=(0.48, 0.40, 0.30), strength=0.6, scale=1.5, grime=0.45)
    R = 2.4
    for sx in (-0.7, 0.7):
        cyl(R, 0.12, (sx, 0, 0), wood, segs=24, rot=(0, math.pi / 2, 0), cap=False)
        cyl(R - 0.2, 0.12, (sx, 0, 0), wood, segs=24, rot=(0, math.pi / 2, 0), cap=False)
    for k in range(16):
        a = 2 * math.pi * k / 16
        box((1.5, 0.08, 0.5), (0, (R - 0.05) * math.cos(a), (R - 0.05) * math.sin(a) - 0.25), wood, rot=(a, 0, 0))
    for k in range(6):
        a = 2 * math.pi * k / 6
        for sx in (-0.7, 0.7):
            box((0.1, 0.12, R), (sx, 0, 0), wood, rot=(a, 0, 0))
    cyl(0.25, 1.8, (-0.9, 0, 0), M()['dark'], segs=10, rot=(0, math.pi / 2, 0))


def tesla_coil():
    """the Tesla coil: a toroid on a tall copper coil, the SEAS base with insulators and the capacitor bank"""
    m = M()
    red = seas_red()
    pc = party('party', 0.85)
    copper = tex('copper', 'rusty_metal_02', tint=(0.78, 0.45, 0.22), strength=0.85, scale=1.0, grime=0.2)
    box((5.0, 5.0, 1.0), (0, 0, 0), plate(), bevel=0.06)
    box((5.1, 5.1, 0.25), (0, 0, 1.0), pc)
    for sx in (-1, 1):
        rivets(m['dark'], -2.2, 2.2, sx * 2.5, 0.7, 9, axis='y', face=sx)
    cyl(1.4, 1.4, (0, 0, 1.25), red, segs=16)
    for k in range(4):
        cyl(1.0 - k * 0.05, 0.35, (0, 0, 2.65 + k * 0.4), paint('insulator_brown', (0.45, 0.25, 0.15)), segs=14)
    cyl(0.75, 5.5, (0, 0, 4.25), copper, segs=18)
    for k in range(18):
        cyl(0.8, 0.08, (0, 0, 4.4 + k * 0.29), m['dark'], segs=18)
    # the toroid: a ring of short cylinders
    n = 14
    for i in range(n):
        a = 2 * math.pi * i / n
        cyl(0.55, 1.05, (1.45 * math.cos(a), 1.45 * math.sin(a), 10.0), m['chrome'], segs=10, rot=(math.pi / 2, 0, a + math.pi / 2))
    cyl(0.4, 0.6, (0, 0, 10.3), glow('coilglow', (0.55, 0.85, 1.0), 1.0), segs=12)
    for sx in (-1, 1):            # capacitor jars
        for k in range(3):
            cyl(0.25, 0.9, (sx * 1.9, -1.2 + k * 0.8, 1.25), paint('jar', (0.35, 0.50, 0.45), grime=0.1), segs=10)
