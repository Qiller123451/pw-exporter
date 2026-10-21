"""The sequel's road surfaces (game/sequel/maps.js roadMeshes): long tiling textures, painted from CC0 materials in
ParaWorld's look - worn asphalt with tyre tracks, cracks, patches and faded paint, gravel shoulders whose edge fades
into the ground (alpha), dirt roads with ruts. u runs across the road and its shoulders, v along it; one texture is
LENGTH metres of road and repeats seamlessly.
    python3 -m remake.art.sequel.roads [--out <folder>]      (default art/sequel/built: tex/sq_road_*.png)"""
import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from .paint import kuwahara, grade

HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.environ.get('PW_ART_LIB', os.path.join(HERE, '_lib'))
W, H = 256, 1024
LENGTH = 48.0                    # metres of road in one texture (v 0..1)
# kind -> road width (m) and the shoulder each side; maps.js widens the strip by the shoulders
ROADS = {'highway': (9.0, 1.6), 'street': (7.0, 1.0), 'dirt': (6.0, 1.4),
         'city': (15.0, 0.3), 'pave': (24.0, 0.4)}       # London (london.py): a street with kerbs and pavements, a paved embankment
CITY_ROAD = 9.0                  # the roadway of a 'city' street; the rest the pavements


def load(lib, size_m, px_per_m, out_w, out_h, tint=None, strength=1.0):
    """a material's colour tiled at size_m metres per tile onto an out_w x out_h image"""
    im = Image.open(os.path.join(LIB, lib, 'color.jpg')).convert('RGB')
    t = max(8, int(round(size_m * px_per_m)))
    tile = np.asarray(im.resize((t, t), Image.LANCZOS), dtype=np.float32) / 255
    reps = (out_h // t + 2, out_w // t + 2, 1)
    a = np.tile(tile, reps)[:out_h, :out_w]
    if tint is not None:
        lum = a.mean(-1, keepdims=True)
        a = a * (1 - strength) + lum / max(1e-3, lum.mean()) * np.array(tint, dtype=np.float32) * strength
    return a


def noise(rng, cells_x, cells_y, w=W, h=H):
    """smooth noise 0..1 that repeats along v (and across u)"""
    small = rng.random((cells_y, cells_x)).astype(np.float32)
    big = np.tile(small, (3, 3))
    im = Image.fromarray((big * 255).astype(np.uint8)).resize((w * 3, h * 3), Image.BICUBIC)
    return np.asarray(im, dtype=np.float32)[h:2 * h, w:2 * w] / 255


def flags(px_per_m, w, h, rng, size=0.9):
    """stone flags: a grid of slabs, each a little lighter or darker, dark joints"""
    base = load('Concrete034', 3.0, px_per_m, w, h, tint=(0.52, 0.51, 0.49), strength=0.7)
    t = max(4, int(round(size * px_per_m)))
    ny, nx = h // t + 2, w // t + 2
    shade = rng.uniform(0.86, 1.10, (ny, nx)).astype(np.float32)
    grid = np.kron(shade, np.ones((t, t), dtype=np.float32))[:h, :w][..., None]
    yy, xx = np.mgrid[0:h, 0:w]
    joint = (((yy % t) < 1) | ((xx % t) < 1)).astype(np.float32)[..., None]
    return base * grid * (1 - 0.35 * joint)


def london(kind, seed=5):
    """a London street (asphalt between granite kerbs, flagged pavements) or the flagged embankment"""
    rng = np.random.default_rng(seed)
    width, sh = ROADS[kind]
    total = width + 2 * sh
    vpm = H / LENGTH
    u = (np.arange(W) + 0.5) / W * total - total / 2
    au = np.abs(u)[None, :, None]
    if kind == 'pave':
        img = flags(vpm, W, H, rng, size=1.6) * 0.92
        img *= 0.9 + 0.2 * noise(rng, 6, 30)[..., None]
    else:
        asphalt = load('Asphalt031', 4.0, vpm, W, H, tint=(0.27, 0.27, 0.28), strength=0.85)
        pave = flags(vpm, W, H, rng)
        kerb = load('Concrete034', 1.0, vpm, W, H, tint=(0.62, 0.62, 0.62), strength=0.8)
        r = CITY_ROAD / 2
        on = np.clip((r - au) * 6.0, 0, 1)
        k = np.clip(1 - np.abs(au - r - 0.15) * 6.0, 0, 1)
        img = asphalt * on + pave * (1 - on)
        img = img * (1 - k) + kerb * k
        gutter = np.exp(-((au - r + 0.25) / 0.2) ** 2)
        img *= 1 - 0.25 * gutter
        for c in (-CITY_ROAD / 4, CITY_ROAD / 4):
            img *= 1 - 0.10 * np.exp(-((u[None, :, None] - c) / 0.6) ** 2) * noise(rng, 6, 40)[..., None]
    blot = noise(rng, 4, 16)[..., None]
    img = 0.55 * kuwahara(img.astype(np.float32), 1) + 0.45 * img
    img = grade(img * (0.9 + 0.2 * blot), contrast=1.1, sat=0.9)
    fade = np.broadcast_to(np.clip((total / 2 - au) / max(0.05, sh), 0, 1), img.shape[:2] + (1,))
    rgba = np.concatenate([img, fade], -1)
    return Image.fromarray((np.clip(rgba, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA')


def road(kind, seed=3):
    if kind in ('city', 'pave'):
        return london(kind)
    rng = np.random.default_rng(seed)
    width, sh = ROADS[kind]
    total = width + 2 * sh
    ppm = W / total                                   # pixels per metre across
    vpm = H / LENGTH                                  # pixels per metre along
    u = (np.arange(W) + 0.5) / W * total - total / 2  # metres from the centre line
    au = np.abs(u)[None, :, None]
    if kind == 'dirt':
        surf = load('Ground079S', 3.0, vpm, W, H)
    else:
        surf = load('Asphalt031', 4.0, vpm, W, H, tint=(0.30, 0.30, 0.31) if kind == 'highway' else (0.38, 0.37, 0.36), strength=0.85)
    gravel = load('Gravel023', 2.0, vpm, W, H, tint=(0.52, 0.48, 0.42), strength=0.8)
    # where the surface ends: the edge wanders and crumbles
    wob = (noise(rng, 6, 24) - 0.5) * 0.7 + (noise(rng, 24, 160) - 0.5) * 0.35
    edge = width / 2 + wob[..., None]
    on = np.clip((edge - au) * 3.0, 0, 1)
    img = surf * on + gravel * (1 - on)
    # tyre tracks: the wheel paths of each lane darker (dirt: ruts)
    lanes = [-width / 4, width / 4] if kind != 'dirt' else [0.0]
    track = np.zeros((1, W, 1), dtype=np.float32)
    for c in lanes:
        for off in (-0.85, 0.85):
            track += np.exp(-((u[None, :, None] - c - off) / (0.35 if kind != 'dirt' else 0.3)) ** 2)
    tn = noise(rng, 8, 64)[..., None]
    img *= 1 - (0.16 if kind != 'dirt' else 0.28) * np.clip(track, 0, 1) * (0.6 + 0.4 * tn) * on
    # oil and dirt down the middle of each lane, patches of newer asphalt
    if kind != 'dirt':
        for c in lanes:
            img *= 1 - 0.10 * np.exp(-((u[None, :, None] - c) / 0.5) ** 2) * noise(rng, 6, 40)[..., None]
        pim = Image.new('L', (W, H), 0)
        d = ImageDraw.Draw(pim)
        for k in range(5 if kind == 'street' else 3):
            x0 = rng.uniform(-width / 2 + 0.3, width / 2 - 2.5); y0 = rng.uniform(0, H)
            w_, h_ = rng.uniform(1.0, 2.6) * ppm, rng.uniform(1.0, 4.0) * vpm
            for dy in (-H, 0, H):
                d.rectangle([(x0 + total / 2) * ppm, y0 + dy, (x0 + total / 2) * ppm + w_, y0 + dy + h_], fill=255)
        patch = np.asarray(pim.filter(ImageFilter.GaussianBlur(1.2)), dtype=np.float32)[..., None] / 255
        img = img * (1 - 0.25 * patch) + np.array([0.16, 0.16, 0.17]) * 0.25 * patch
    # paint: a dashed yellow centre line and white edge lines on highways (faded, worn through in places)
    wear = np.clip((noise(rng, 30, 400) - 0.25) * 2.0, 0, 1)[..., None]
    if kind == 'highway':
        v = np.arange(H)[:, None, None] / vpm
        dash = ((v % 12.0) < 3.5).astype(np.float32)
        centre = np.clip(1 - (np.abs(u[None, :, None]) - 0.07) * ppm * 0.9, 0, 1) * dash
        img = img * (1 - 0.85 * centre * wear) + np.array([0.86, 0.68, 0.18]) * 0.85 * centre * wear
        side = np.clip(1 - (np.abs(au - (width / 2 - 0.35)) - 0.06) * ppm * 0.9, 0, 1)
        img = img * (1 - 0.7 * side * wear) + np.array([0.86, 0.85, 0.80]) * 0.7 * side * wear
    # cracks: dark wandering lines, more toward the edges
    if kind != 'dirt':
        cim = Image.new('L', (W, H), 0)
        d = ImageDraw.Draw(cim)
        for k in range(26 if kind == 'street' else 16):
            x = rng.uniform(-width / 2, width / 2); y = rng.uniform(0, H)
            if rng.random() < 0.5:
                x = np.sign(x or 1) * rng.uniform(width / 2 - 1.5, width / 2)
            pts = [((x + total / 2) * ppm, y)]
            for s in range(int(rng.integers(6, 18))):
                a = rng.uniform(0, 2 * np.pi)
                px, py = pts[-1]
                pts.append((px + np.cos(a) * 4, py + np.sin(a) * 6 + 3))
            for dy in (-H, 0, H):
                d.line([(px, py + dy) for px, py in pts], fill=255, width=1)
        crack = np.asarray(cim, dtype=np.float32)[..., None] / 255
        img *= 1 - 0.45 * crack * on
    # the painted look: brushy, blotchy, graded
    blot = noise(rng, 4, 16)[..., None]
    img = 0.55 * kuwahara(img.astype(np.float32), 1) + 0.45 * img
    img = grade(img * (0.9 + 0.2 * blot), contrast=1.15, sat=1.1)
    # alpha: the shoulder fades into the ground, ragged
    fade = np.clip((total / 2 - au - 0.15 + (noise(rng, 10, 90)[..., None] - 0.5) * 0.9) / 0.9, 0, 1)
    rgba = np.concatenate([img, fade], -1)
    return Image.fromarray((np.clip(rgba, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA')


def build(out):
    os.makedirs(os.path.join(out, 'tex'), exist_ok=True)
    for kind in ROADS:
        road(kind).save(os.path.join(out, 'tex', f'sq_road_{kind}.png'), optimize=True)
    return list(ROADS)


if __name__ == '__main__':
    args = sys.argv[1:]
    out = args[1] if args[:1] == ['--out'] else os.path.join(HERE, 'built')
    print(build(out))
