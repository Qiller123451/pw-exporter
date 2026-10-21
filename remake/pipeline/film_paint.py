"""Pipeline step "filmart": the opening film's own pictures painted onto the sequel's London models (docs/SEQUEL.md
"London from the film").

The original's opening film (hs_1000.bik) flies over London; its buildings were never in the game's data. The sequel
has two kinds of them: modelled after the film (art/sequel/london.py, built into the repository) and, for the
models listed in art/sequel/film_paint.json, the plain masses of the same buildings painted with the film's frames.
The frames are the player's own: this step reads the film of their installation with ffmpeg (pwexport.video), so no
picture of the film is in the toolkit - only the cameras fitted to the frames and what stands in front of the
building there (trees). Without the film the masses keep their plain texture and the game uses the modelled ones.

Painting a model: every texel of its texture (the model's first UV set) is a point of its surface; each frame sees
it or not (in the picture, nothing of the model nearer - a depth buffer of the model - and no tree there) and the
frame that sees it most squarely gives its colour. Texels no frame sees well take the colour of the matching point of
another side: the mirror images of the plan (and its quarter turns, sym "square": the same bays all round), except
that the entrance bay of the front (door: half width, shift - model units) is not copied - the bay beside it is.
The painted texture is the base colour and, scaled (glow), the emissive one: the film's light stays on the walls at
night. The manifest marks the model 'painted' (game/sequel/maps.js uses it then, when the player chose so).
"""
import json
import os
import struct
import subprocess

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = '../art/sequel/film_paint.json'


def read_glb(path):
    """positions (Blender axes: z up) and first UVs of the triangles: (tri [n, 3, 3], uv [n, 3, 2])"""
    d = open(path, 'rb').read()
    n = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + n])
    binc = d[20 + n + 8:]

    def acc(i):
        a = j['accessors'][i]
        bv = j['bufferViews'][a['bufferView']]
        comp = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[a['componentType']]
        k = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        x = np.frombuffer(binc, dtype=comp, count=a['count'] * k, offset=bv.get('byteOffset', 0) + a.get('byteOffset', 0))
        return x.reshape(a['count'], k) if k > 1 else x
    tris, uvs = [], []
    for mesh in j['meshes']:
        for prim in mesh['primitives']:
            p = acc(prim['attributes']['POSITION']).astype(np.float64)
            p = np.stack([p[:, 0], -p[:, 2], p[:, 1]], 1)
            uv = acc(prim['attributes']['TEXCOORD_0']).astype(np.float64)
            ix = acc(prim['indices']).astype(np.int64).reshape(-1, 3)
            tris.append(p[ix])
            uvs.append(uv[ix])
    return np.concatenate(tris), np.concatenate(uvs)


def _bary(tri2, x0, y0, x1, y1):
    """the pixel centres of a box and their barycentric coordinates in a 2D triangle (None: degenerate)"""
    gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
    (ax, ay), (bx, by), (cx, cy) = tri2
    den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if abs(den) < 1e-12:
        return None
    l0 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / den
    l1 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / den
    return l0, l1, 1 - l0 - l1


def texels(tri, uv, size):
    """the surface point and the face normal of every texel the UVs cover"""
    pos = np.zeros((size, size, 3))
    nrm = np.zeros((size, size, 3))
    have = np.zeros((size, size), bool)
    fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    fn /= np.linalg.norm(fn, axis=1, keepdims=True) + 1e-12
    for t in range(len(tri)):
        q = uv[t] * size                                   # (glTF: v runs down the image)
        x0, y0 = np.maximum(np.floor(q.min(0)).astype(int) - 1, 0)
        x1, y1 = np.minimum(np.ceil(q.max(0)).astype(int) + 1, size - 1)
        if x1 < x0 or y1 < y0:
            continue
        b = _bary(q, x0, y0, x1, y1)
        if b is None:
            continue
        l0, l1, l2 = b
        inside = (l0 >= -0.02) & (l1 >= -0.02) & (l2 >= -0.02)
        sl = (slice(y0, y1 + 1), slice(x0, x1 + 1))
        m = inside & ~have[sl]
        if not m.any():
            continue
        pt = l0[..., None] * tri[t, 0] + l1[..., None] * tri[t, 1] + l2[..., None] * tri[t, 2]
        pos[sl][m] = pt[m]
        nrm[sl][m] = fn[t]
        have[sl] |= inside
    return pos, nrm, have


class View:
    """a frame and its camera: the picture, the depth of the model in it (nothing farther is seen; -1 where
    something stands in front of it)"""
    def __init__(self, cam, img, tri, hide=()):
        self.R, self.c, self.f = np.array(cam['R']), np.array(cam['pos']), cam['f']
        self.img = img
        h, w = img.shape[:2]
        self.w, self.h = w, h
        D = np.full((h, w), np.inf)
        X = (tri.reshape(-1, 3) - self.c) @ self.R.T
        z = X[:, 2]
        U = np.stack([self.f * X[:, 0] / np.maximum(z, 1e-6) + w / 2, self.f * X[:, 1] / np.maximum(z, 1e-6) + h / 2, z], 1).reshape(-1, 3, 3)
        for q in U:
            if (q[:, 2] <= 0.5).any():
                continue
            x0, y0 = np.maximum(np.floor(q[:, :2].min(0)).astype(int), 0)
            x1, y1 = np.minimum(np.ceil(q[:, :2].max(0)).astype(int), [w - 1, h - 1])
            if x1 < x0 or y1 < y0:
                continue
            b = _bary(q[:, :2], x0, y0, x1, y1)
            if b is None:
                continue
            l0, l1, l2 = b
            ins = (l0 >= 0) & (l1 >= 0) & (l2 >= 0)
            zz = 1 / (l0 / q[0, 2] + l1 / q[1, 2] + l2 / q[2, 2])
            cur = D[y0:y1 + 1, x0:x1 + 1]
            upd = ins & (zz < cur)
            cur[upd] = zz[upd]
        if hide:
            mk = Image.new('L', (w, h), 0)
            dr = ImageDraw.Draw(mk)
            for poly in hide:
                dr.polygon([tuple(p) for p in poly], fill=255)
            D[np.asarray(mk) > 0] = -1.0
        self.D = D

    def look(self, pts, nrm):
        """(colour, weight) of points seen here: the cosine of the view on the face, 0 unseen or seen grazing"""
        X = (pts - self.c) @ self.R.T
        z = X[:, 2]
        u = self.f * X[:, 0] / np.maximum(z, 1e-6) + self.w / 2
        v = self.f * X[:, 1] / np.maximum(z, 1e-6) + self.h / 2
        ok = (z > 1) & (u >= 1) & (u < self.w - 2) & (v >= 1) & (v < self.h - 2)
        vis = np.zeros(len(pts), bool)
        ui, vi = u[ok].astype(int), v[ok].astype(int)
        vis[ok] = z[ok] <= self.D[vi, ui] * 1.01 + 0.3
        vd = pts - self.c
        vd /= np.linalg.norm(vd, axis=1, keepdims=True)
        w = np.clip(-(nrm * vd).sum(1), 0, 1)
        w[(w < 0.12) | ~vis] = 0                              # (grazing views smear)
        col = np.zeros((len(pts), 3))
        if (w > 0).any():
            col[w > 0] = _sample(self.img, u[w > 0], v[w > 0])
        return col, w


def _sample(img, u, v):
    """bilinear"""
    h, w = img.shape[:2]
    u = np.clip(u - 0.5, 0, w - 1.001)
    v = np.clip(v - 0.5, 0, h - 1.001)
    x0, y0 = u.astype(int), v.astype(int)
    fx, fy = (u - x0)[:, None], (v - y0)[:, None]
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy) + img[y0 + 1, x0] * (1 - fx) * fy
            + img[y0 + 1, x0 + 1] * fx * fy)


def best(views, pts, nrm):
    col = np.zeros((len(pts), 3))
    wt = np.zeros(len(pts))
    for vw in views:
        c, w = vw.look(pts, nrm)
        better = w > wt + 1e-6
        col[better], wt[better] = c[better], w[better]
    return col, wt


def paint(glb, base, views, sym='mirror', door=(0.0, 0.0), poor=0.35):
    """the texture `base` (an RGB array) painted from the views; returns (texture, share of the texels painted)"""
    size = base.shape[0]
    tri, uv = read_glb(glb)
    pos, nrm, have = texels(tri, uv, size)
    idx = np.nonzero(have)
    pts, nn = pos[idx], nrm[idx]
    col, wt = best(views, pts, nn)
    # the poorly seen from the plan's symmetries: mirrors (sx, sy) and quarter turns (x and y swapped)
    syms = [(-1, 1, 0), (1, -1, 0), (-1, -1, 0)]
    if sym == 'square':
        syms += [(1, 1, 1), (-1, 1, 1), (1, -1, 1), (-1, -1, 1)]
    for sx, sy, sw in syms:
        sel = np.nonzero(wt < poor)[0]
        if not len(sel):
            break
        q, qn = pts[sel] * [sx, sy, 1], nn[sel] * [sx, sy, 1]
        if sw:
            q, qn = q[:, [1, 0, 2]], qn[:, [1, 0, 2]]
        if door[0] > 0:                         # onto the entrance bay of the front (+y) from elsewhere: the bay beside
            front = (qn[:, 1] > 0.9) & (np.abs(q[:, 0]) < door[0])
            q[front, 0] += np.where(q[front, 0] >= 0, door[1], -door[1])
        c, w = best(views, q, qn)
        take = w > np.maximum(wt[sel] * 1.5, 0.05)
        col[sel[take]], wt[sel[take]] = c[take], w[take]
    good = wt > 0.05
    out = base.astype(np.float64).copy()
    out[idx[0][good], idx[1][good]] = col[good]
    # the painted texels grown a little into the bake's margins (no seams where the filter reaches past an island)
    done = np.zeros(have.shape, bool)
    done[idx[0][good], idx[1][good]] = True
    for _ in range(4):
        acc = np.zeros_like(out)
        cnt = np.zeros(done.shape)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                acc += np.roll(np.roll(out * done[..., None], dy, 0), dx, 1)
                cnt += np.roll(np.roll(done, dy, 0), dx, 1)
        ring = ~done & (cnt > 0)
        out[ring] = acc[ring] / cnt[ring][:, None]
        done |= ring
    return out, float(good.sum()) / max(1, int(have.sum()))


def frames(film, spec, log=print):
    """{time: picture (float RGB array of the cropped frame)} from the film with ffmpeg, or None"""
    from pwexport import video
    exe = video.ffmpeg(log)
    if not exe:
        return None
    W, H = spec['size']
    x, y, w, h = spec['crop']
    out = {}
    for t in spec['frames']:
        r = subprocess.run([exe, '-hide_banner', '-loglevel', 'error', '-ss', t, '-i', film, '-frames:v', '1',
                            '-vf', 'scale=%d:%d,crop=%d:%d:%d:%d' % (W, H, w, h, x, y), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                           capture_output=True)
        if r.returncode or len(r.stdout) != w * h * 3:
            log('the film\'s frame at %s s could not be read: %s' % (t, (r.stderr or b'').decode('utf-8', 'replace').strip()[-300:]))
            return None
        out[t] = np.frombuffer(r.stdout, np.uint8).reshape(h, w, 3).astype(np.float64)
    return out


def install(out_dir, game, log=print):
    """paint the models of the spec in <out_dir>/assets from the installation's film; returns how many"""
    from pwexport import video
    spec = json.load(open(os.path.join(HERE, SPEC)))
    assets = os.path.join(out_dir, 'assets')
    man_path = os.path.join(assets, 'manifest.json')
    man = json.load(open(man_path))
    for name in spec['models']:
        if name in man['models']:
            man['models'][name].pop('painted', None)
    film = video.find(game, spec['film'], '')
    pics = frames(film, spec, log) if film else None
    n = 0
    if not pics:
        if not film:
            log('the opening film (%s) is not in the installation: London keeps its modelled buildings' % spec['film'])
    else:
        for name, m in spec['models'].items():
            glb = os.path.join(assets, 'models', name + '.glb')
            tex = os.path.join(assets, 'tex', name + '.jpg')
            if not (os.path.isfile(glb) and os.path.isfile(tex) and name in man['models']):
                continue
            tri = read_glb(glb)[0]
            views = [View(spec['frames'][t], pics[t], tri, spec['frames'][t].get('hide', ())) for t in m['frames']]
            base = np.asarray(Image.open(tex).convert('RGB'))
            img, share = paint(glb, base, views, m.get('sym', 'mirror'), m.get('door', (0.0, 0.0)))
            Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(tex, quality=92)
            Image.fromarray(np.clip(img * m.get('glow', 0.6), 0, 255).astype(np.uint8)).save(os.path.join(assets, 'tex', name + '_glow.jpg'), quality=90)
            man['models'][name]['painted'] = True
            log('%s: painted from the film (%d%% of its surface)' % (name, round(100 * share)))
            n += 1
    json.dump(man, open(man_path, 'w'), separators=(',', ':'))
    return n


def run(log=print, progress=None):
    from . import paths
    install(paths.OUT, paths.game(), log)


if __name__ == '__main__':
    import sys
    from . import paths
    # python -m remake.pipeline.film_paint <ParaWorld folder> <output folder> [mod]
    print(install(sys.argv[2], paths.install(sys.argv[1], sys.argv[3] if len(sys.argv) > 3 else '')), 'models painted')
