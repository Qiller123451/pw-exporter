"""Ground textures of the landscape ("scape"): the 8 ground materials of every setting.

Texture/Scape/<Setting>/ScapeTexture<Q>.dat (gzip) lists, for every map cell pattern, one atlas tile per material;
column k of the table only ever points at tiles of material k, so the values of a column are the material's
interchangeable variant tiles (64 x 64 px plus a border, in ScapeTexture<Q>_000n.dds atlases). A random mosaic of
those variants (weighted by how often the table uses each) tiles seamlessly: that is the material's texture.

    tex = material_textures(install, 'Jungle')    # [8 x PIL.Image 512 x 512] (cached on disk)
    material_colors(install, 'Jungle')             # [8 x (r, g, b)] average colours (minimap)
In the game a 64 px tile covers one 4 m map cell; the mosaics here are 8 x 8 tiles.
"""
import collections
import gzip
import os
import random
import struct

from .config import cache_dir

FOLDERS = {'Northland': 'Northland', 'Savanna': 'Savanna', 'Jungle': 'Jungle', 'Icewaste': 'Icewaste',
           'Ashvalley': 'Ashvalley', 'Cave1': 'Cave1', 'Cave2': 'Cave1', 'Cave3': 'Cave1', 'TestSet': 'Jungle'}
GRID = 8                    # tiles per side of a material texture
METRES_PER_TILE = 4.0       # one tile = one 4 m material cell in the game


def read_dat(path):
    d = gzip.open(path).read()
    ver, n = struct.unpack_from('<II', d, 0)
    o = 8
    names = []
    for _ in range(n):
        ln = struct.unpack_from('<I', d, o)[0]; o += 4
        names.append(d[o:o + ln].rstrip(b'\0').decode('latin1')); o += ln
    tile, atlas, _ = struct.unpack_from('<III', d, o); o += 12
    rows = [struct.unpack_from('<8H', d, o + 16 * i) for i in range(6144) if o + 16 * i + 16 <= len(d)]
    return names, tile, atlas, rows


def _folder(install, setting):
    sub = FOLDERS.get(setting, 'Jungle')
    return install.dir('Texture/Scape/%s' % sub)


def _quality(folder):
    for q in (5, 4, 3, 2, 1):
        if os.path.exists(os.path.join(folder, 'ScapeTexture%d.dat' % q)):
            return q
    return None


def material_textures(install, setting, size=512):
    """8 seamless ground textures of the setting (PIL images, size x size); cached as .jpg"""
    from PIL import Image
    sub = FOLDERS.get(setting, 'Jungle')
    out_dir = cache_dir('scape', sub)
    files = [os.path.join(out_dir, 'material_%d.jpg' % k) for k in range(8)]
    if all(os.path.exists(f) for f in files):
        return [Image.open(f).convert('RGB').resize((size, size)) if size != 512 else Image.open(f).convert('RGB') for f in files]
    folder = _folder(install, setting)
    q = _quality(folder) if folder else None
    if not q:
        # no scape data: flat colours
        cols = [(96, 120, 60), (120, 110, 80), (90, 80, 60), (130, 130, 120), (70, 100, 50), (150, 140, 100), (60, 80, 40), (110, 100, 90)]
        imgs = [Image.new('RGB', (512, 512), c) for c in cols]
    else:
        names, tile, atlas, rows = read_dat(os.path.join(folder, 'ScapeTexture%d.dat' % q))
        per_row = atlas // tile
        per_atlas = per_row * per_row
        border = (tile - 64) // 2

        def atlas_img(n):
            p = os.path.join(folder, n.replace('.tga', '.dds'))
            if not os.path.exists(p):
                hit = [e for e in os.listdir(folder) if e.lower() == os.path.basename(p).lower()]
                p = os.path.join(folder, hit[0]) if hit else p
            return Image.open(p).convert('RGB')
        atl = [atlas_img(n) for n in names]

        def tile_img(i):
            a, r = divmod(i, per_atlas)
            y, x = divmod(r, per_row)
            return atl[a].crop((x * tile + border, y * tile + border, x * tile + border + 64, y * tile + border + 64))

        def mean(v):
            return tile_img(v).resize((1, 1), Image.BILINEAR).getpixel((0, 0))
        imgs = []
        for k in range(8):
            freq = collections.Counter(r[k] for r in rows[::2])
            variants, weights = zip(*freq.most_common())
            # keep the tiles close to the most used one in colour (some materials mix two looks)
            m0 = mean(variants[0])
            keep = [(v, w) for v, w in zip(variants, weights) if sum((a - b) ** 2 for a, b in zip(mean(v), m0)) ** 0.5 < 16]
            variants, weights = zip(*keep)
            rnd = random.Random(k)
            img = Image.new('RGB', (GRID * 64, GRID * 64))
            for gy in range(GRID):
                for gx in range(GRID):
                    img.paste(tile_img(rnd.choices(variants, weights)[0]), (gx * 64, gy * 64))
            imgs.append(img)
    for img, f in zip(imgs, files):
        img.save(f, quality=90)
    return [i.resize((size, size)) if size != 512 else i for i in imgs]


def material_colors(install, setting):
    return [tuple(int(c) for c in t.resize((1, 1), 2).getpixel((0, 0))) for t in material_textures(install, setting)]


def bake(install, setting, mats, w, h, px_per_m=2.0, max_side=4096):
    """one texture of the whole map: the materials of the 4 m cells (mats[y, x], row 0 = south) blended with their
    neighbours and textured. Returns a PIL image (row 0 = north edge, as an image)."""
    import numpy as np
    from PIL import Image
    s = min(px_per_m, max_side / max(w, h))
    W, H = max(1, int(round(w * s))), max(1, int(round(h * s)))
    tile_px = max(4, int(round(GRID * METRES_PER_TILE * s)))        # a mosaic (8 tiles = 32 m) in pixels
    tex = [np.asarray(t.resize((tile_px, tile_px), Image.LANCZOS), dtype=np.float32) for t in material_textures(install, setting)]
    my, mx = mats.shape
    out = np.zeros((H, W, 3), np.float32)
    # weight of material k at a pixel: bilinear blend of the cell centres (smooth transitions over one cell)
    xs = (np.arange(W) + 0.5) / s / METRES_PER_TILE - 0.5
    x0 = np.clip(np.floor(xs).astype(int), 0, mx - 1); x1 = np.clip(x0 + 1, 0, mx - 1); fx = np.clip(xs - np.floor(xs), 0, 1)
    step = 256
    for r0 in range(0, H, step):
        rows = np.arange(r0, min(H, r0 + step))
        ys = (H - 0.5 - rows) / s / METRES_PER_TILE - 0.5            # image row 0 = north edge
        y0 = np.clip(np.floor(ys).astype(int), 0, my - 1); y1 = np.clip(y0 + 1, 0, my - 1); fy = np.clip(ys - np.floor(ys), 0, 1)
        acc = np.zeros((len(rows), W, 3), np.float32)
        for k in range(8):
            m = (mats == k).astype(np.float32)
            wk = (m[y0][:, x0] * (1 - fx) + m[y0][:, x1] * fx) * (1 - fy)[:, None] + \
                 (m[y1][:, x0] * (1 - fx) + m[y1][:, x1] * fx) * fy[:, None]
            if not wk.any():
                continue
            t = tex[k]
            ty = rows % tile_px
            tx = np.arange(W) % tile_px
            acc += wk[:, :, None] * t[ty][:, tx]
        out[rows] = acc
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
