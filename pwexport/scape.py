"""Ground textures of the landscape ("scape"): the 8 ground materials of every setting.

Texture/Scape/<Setting>/ScapeTexture<Q>.dat (gzip) maps every "MatDesc" - the materials at the four corners of a
4 m ground tile, or one material plus its position in a 32 x 32 variant layout - to a tile of the
ScapeTexture<Q>_000n.dds atlases. Q = 1 .. 5 is the game's ground detail: the same tiles at about 10, 20, 36, 40 and
62-68 px (plus a border for the mip-maps). SEK's ScapeTextureCalc tool built these sets: the
pure variants of every material (single tiles, 2 x 2 and 4 x 4 groups laid out by a "macro map"), then every
combination of 2-4 materials pre-blended through blend masks, up to 4 variants each (read_dat has the layout).

    tex = material_textures(install, 'Jungle')    # [8 x PIL.Image 512 x 512] (cached on disk)
    material_colors(install, 'Jungle')             # [8 x (r, g, b)] average colours (minimap)
    img = bake(install, 'Jungle', mats, w, h)      # the ground of a whole map with the game's transition tiles
    ts, ids = tile_layout(install, 'Jungle', mats)  # the same as data: which atlas tile lies where (map viewer)
In the game a tile covers one 4 m map cell; the material textures here are 8 x 8 tiles.
"""
import gzip
import os
import struct
import threading

from .config import cache_dir

FOLDERS = {'Northland': 'Northland', 'Savanna': 'Savanna', 'Jungle': 'Jungle', 'Icewaste': 'Icewaste',
           'Ashvalley': 'Ashvalley', 'Cave1': 'Cave1', 'Cave2': 'Cave2', 'Cave3': 'Cave3', 'TestSet': 'TestSet'}
# a setting whose own folder has no tile set (an incomplete installation) borrows another one's
FALLBACK = {'Cave2': 'Cave1', 'Cave3': 'Cave1', 'TestSet': 'Jungle'}
QUALITIES = (1, 2, 3, 4, 5)  # ScapeTexture<Q>: the game's ground detail levels, 5 = finest
VERSION = '3'               # of the cached material textures
_lock = threading.Lock()    # the server asks for the 8 textures of a setting at once
GRID = 8                    # tiles per side of a material texture
METRES_PER_TILE = 4.0       # one tile = one 4 m material cell in the game


def read_dat(path):
    """the tile table of a ScapeTexture<Q>.dat (gzip; written by SEK's ScapeTextureCalc tool):

    u32 page count, u32 n, n x string (atlas page file names, .tga; the game loads the .dds)
    u32 tile size (px, with the mip-map border), u32 page size (px), u32 mip-map border setting
    u16 tile[65536]                  tile index of every "MatDesc" (below); tile i = page i // (k*k), k = page // tile
    8 x material info:
        u32 single start, single count, double start, double count, quad start, quad count   (tile ranges)
        u32 macro map[32 x 32]       variant layout of a pure-material area (bits below)
        u32 slope lists[32]          (empty in every shipped set)
    1024 bytes                       (unknown)

    MatDesc (u16): bits 14-15 type. 3 = transition ("combo"): bits 0-2 / 3-5 / 6-8 / 9-11 the materials of the
    four corners (top left, top right, bottom left, bottom right of the tile picture), bits 12-13 variant 0..3.
    0 / 1 / 2 = one material (bits 0-2) as a single / double (2 x 2 tiles) / quad (4 x 4 tiles) variant at macro map
    position x = bits 4-8, y = bits 9-13. Macro map entry: bits 0-7 single variant, 8-15 double variant, 24 / 25 its
    tile x / y, bit 30 "part of a double"; 16-23 quad variant, 26-27 / 28-29 its tile x / y, bit 31 "part of a quad".
    """
    d = gzip.open(path).read()
    pages, n = struct.unpack_from('<II', d, 0)
    o = 8
    names = []
    for _ in range(n):
        ln = struct.unpack_from('<I', d, o)[0]; o += 4
        names.append(d[o:o + ln].rstrip(b'\0').decode('latin1')); o += ln
    tile, atlas, border = struct.unpack_from('<III', d, o); o += 12
    table = struct.unpack_from('<65536H', d, o); o += 131072
    mats = []
    for _ in range(8):
        h = struct.unpack_from('<6I', d, o)
        macro = struct.unpack_from('<1024I', d, o + 24)
        mats.append({'single': h[0:2], 'double': h[2:4], 'quad': h[4:6], 'macro': macro})
        o += 24 + 4096 + 128
    return {'names': names, 'tile': tile, 'atlas': atlas, 'border': border, 'table': table, 'mats': mats}


def matdesc(c, x=0, y=0, var=0, mats=None):
    """MatDesc of a tile: c = materials of its corners (top left, top right, bottom left, bottom right);
    a pure tile picks its variant from the material's macro map at (x, y) (mats = read_dat()['mats'])"""
    c = [int(v) for v in c]
    if c[0] == c[1] == c[2] == c[3]:
        t = 0
        if mats is not None:
            v = mats[c[0]]['macro'][(x & 31) + (y & 31) * 32]
            t = 2 if v >> 31 else 1 if (v >> 30) & 1 else 0
        return (t << 14) | c[0] | ((x & 31) << 4) | ((y & 31) << 9)
    return 0xc000 | ((var & 3) << 12) | c[0] | (c[1] << 3) | (c[2] << 6) | (c[3] << 9)


class TileSet:
    """the atlases of a setting: tile(i) -> RGB array of the tile without its border"""
    def __init__(self, folder, q):
        self.folder = folder
        self.q = q
        self.dat = read_dat(os.path.join(folder, 'ScapeTexture%d.dat' % q))
        t = self.dat['tile']
        # the tile itself is TileSize - 2 x MipMapBorder (ScapeTextureCalc: m_iRawTileSize): 62 of 70 px in most Q5
        # sets, 66 or 68 where the border is 2 or 1. The border repeats the neighbours' edge.
        self.border = self.dat['border'] if 0 <= 2 * self.dat['border'] < t - 1 else 0
        self.inner = t - 2 * self.border
        self.per_row = self.dat['atlas'] // t
        self._atl = {}

    def page(self, a):
        if a not in self._atl:
            from PIL import Image
            import numpy as np
            n = self.dat['names'][a]
            p = os.path.join(self.folder, n.replace('.tga', '.dds'))
            if not os.path.exists(p):
                hit = [e for e in os.listdir(self.folder) if e.lower() == os.path.basename(p).lower()]
                p = os.path.join(self.folder, hit[0]) if hit else p
            self._atl[a] = np.asarray(Image.open(p).convert('RGB'))
        return self._atl[a]

    def page_file(self, a):
        """path of atlas page a (.dds), or None"""
        n = os.path.basename(self.dat['names'][a]).rsplit('.', 1)[0].lower() + '.dds'
        hit = [e for e in os.listdir(self.folder) if e.lower() == n]
        return os.path.join(self.folder, hit[0]) if hit else None

    def tile(self, i):
        a, r = divmod(int(i), self.per_row * self.per_row)
        y, x = divmod(r, self.per_row)
        t, b = self.dat['tile'], self.border
        return self.page(a)[y * t + b:y * t + b + self.inner, x * t + b:x * t + b + self.inner]


def tileset(install, setting, q=None):
    """the tile set of a setting at ground detail q (1 .. 5; None = the finest there is; a level the installation
    lacks gives the nearest one below, else above)"""
    folder = _folder(install, setting)
    q = _quality(folder, q) if folder else None
    return TileSet(folder, q) if q else None


def qualities(install, setting):
    """the ground detail levels the installation has for a setting, e.g. [1, 2, 3, 4, 5]"""
    folder = _folder(install, setting)
    return [q for q in QUALITIES if os.path.exists(os.path.join(folder, 'ScapeTexture%d.dat' % q))] if folder else []


def _folder(install, setting):
    sub = FOLDERS.get(setting, 'Jungle')
    for name in (sub, FALLBACK.get(sub)):
        f = install.dir('Texture/Scape/%s' % name) if name else None
        if f and _quality(f):
            return f
    return install.dir('Texture/Scape/%s' % sub)


def _quality(folder, want=None):
    have = [q for q in QUALITIES if os.path.exists(os.path.join(folder, 'ScapeTexture%d.dat' % q))]
    if not have:
        return None
    if want is None:
        return have[-1]
    below = [q for q in have if q <= int(want)]
    return below[-1] if below else have[0]


def material_textures(install, setting, size=512):
    """8 seamless ground textures of the setting (PIL images, size x size), cached as .jpg: the first 8 x 8 cells of
    each material's macro map with the variant tiles the game puts there"""
    with _lock:
        return _material_textures(install, setting, size)


def _material_textures(install, setting, size):
    from PIL import Image
    import numpy as np
    sub = FOLDERS.get(setting, 'Jungle')
    out_dir = cache_dir('scape', sub)
    files = [os.path.join(out_dir, 'material%s_%d.jpg' % (VERSION, k)) for k in range(8)]
    if all(os.path.exists(f) for f in files):
        return [Image.open(f).convert('RGB').resize((size, size)) if size != 512 else Image.open(f).convert('RGB') for f in files]
    ts = tileset(install, setting)
    if not ts:
        # no scape data: flat colours
        cols = [(96, 120, 60), (120, 110, 80), (90, 80, 60), (130, 130, 120), (70, 100, 50), (150, 140, 100), (60, 80, 40), (110, 100, 90)]
        imgs = [Image.new('RGB', (512, 512), c) for c in cols]
    else:
        T, mats = ts.dat['table'], ts.dat['mats']
        imgs = []
        for k in range(8):
            img = Image.new('RGB', (GRID * 64, GRID * 64))
            for gy in range(GRID):
                for gx in range(GRID):
                    t = Image.fromarray(ts.tile(T[matdesc([k] * 4, gx, gy, mats=mats)]))
                    img.paste(t.resize((64, 64)) if t.size != (64, 64) else t, (gx * 64, gy * 64))
            imgs.append(img)
    for img, f in zip(imgs, files):
        img.save(f + '.tmp.jpg', quality=90)
        os.replace(f + '.tmp.jpg', f)
    return [i.resize((size, size)) if size != 512 else i for i in imgs]


def material_colors(install, setting):
    return [tuple(int(c) for c in t.resize((1, 1), 2).getpixel((0, 0))) for t in material_textures(install, setting)]


def tile_ids(ts, mats):
    """which atlas tile lies where: ids[j, i] (int array, (my + 1) x (mx + 1), row 0 = south) for the materials of
    the 4 m cells mats[y, x]. Tile (i, j) spans the square between the cell centres i-1 .. i and j-1 .. j - on the map
    x = 4 i - 2 .. 4 i + 2 m - and shows the transition between their materials, as the game draws it."""
    import numpy as np
    my, mx = mats.shape
    T, info = np.array(ts.dat['table'], np.int64), ts.dat['mats']
    # tile (i, j) spans the cell centres i-1 .. i, j-1 .. j (i = 0 .. mx): corners from the clamped material grid
    ii = np.clip(np.arange(-1, mx)[None, :], 0, mx - 1); jj = np.clip(np.arange(-1, my)[:, None], 0, my - 1)
    ii1 = np.clip(ii + 1, 0, mx - 1); jj1 = np.clip(jj + 1, 0, my - 1)
    m = mats.astype(np.int64)
    sw, se, nw, ne = m[jj, ii], m[jj, ii1], m[jj1, ii], m[jj1, ii1]          # tile picture: top = north
    X = (np.arange(-1, mx)[None, :] + np.zeros_like(jj)) & 31
    Y = (-np.arange(-1, my)[:, None] + np.zeros_like(ii)) & 31        # macro map rows run down the picture: south
    var = ((X * 73856093) ^ (Y * 19349663)) % 4
    pure = (nw == ne) & (nw == sw) & (nw == se)
    macro = np.array([mt['macro'] for mt in info], np.int64)               # [8, 1024]
    mv = macro[nw, X + Y * 32]
    typ = np.where(mv >> 31 & 1, 2, np.where(mv >> 30 & 1, 1, 0))
    d_pure = (typ << 14) | nw | (X << 4) | (Y << 9)
    d_combo = 0xc000 | (var << 12) | nw | (ne << 3) | (sw << 6) | (se << 9)
    return T[np.where(pure, d_pure, d_combo)]


def tile_layout(install, setting, mats, q=None):
    """(TileSet, tile_ids) of a map's ground at detail q, or (None, None) when the setting has no tile set"""
    ts = tileset(install, setting, q)
    return (ts, tile_ids(ts, mats)) if ts else (None, None)


def bake(install, setting, mats, w, h, px_per_m=2.0, max_side=4096, q=None):
    """one texture of the whole map: the materials of the 4 m cells (mats[y, x], row 0 = south) drawn with the
    setting's pre-blended tiles (tile_ids) at ground detail q (None = the finest). Returns a PIL image (row 0 = north
    edge, as an image)."""
    import numpy as np
    from PIL import Image
    ts = tileset(install, setting, q)
    if not ts:
        return bake_blend(install, setting, mats, w, h, px_per_m, max_side)
    s = min(px_per_m, max_side / max(w, h))
    W, H = max(1, int(round(w * s))), max(1, int(round(h * s)))
    p = max(2, min(ts.inner, int(round(METRES_PER_TILE * s))))       # pixels per tile in the bake
    my, mx = mats.shape
    ids = tile_ids(ts, mats)
    uniq, inv = np.unique(ids, return_inverse=True)
    lib = np.stack([np.asarray(Image.fromarray(ts.tile(t)).resize((p, p), Image.LANCZOS)) if p != ts.inner else ts.tile(t) for t in uniq])
    ny, nx = ids.shape
    img = lib[inv.reshape(ny, nx)]                                         # [ny, nx, p, p, 3]
    img = img[::-1].transpose(0, 2, 1, 3, 4).reshape(ny * p, nx * p, 3)    # rows: north first
    half = p // 2                                                          # tiles start half a cell outside the map
    img = img[half:half + my * p, half:half + mx * p]
    out = Image.fromarray(np.ascontiguousarray(img))
    return out.resize((W, H), Image.LANCZOS) if out.size != (W, H) else out


def bake_blend(install, setting, mats, w, h, px_per_m=2.0, max_side=4096):
    """the materials blended over one cell with the seamless material textures (when a setting has no tile table)"""
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
