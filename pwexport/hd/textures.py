"""The HD textures: the model's pictures enlarged 4x (Real-ESRGAN, esrgan.py), with a normal map and a height
picture made from their relief, all put into the .glb (an HD model needs no files next to it).

The relief is guessed from the brightness: the picture's fine detail (brightness minus its blur over 24 texels -
panel lines, seams, rivets, folds) is the height, its slopes the normal map. Effect pictures (blood, muzzle rays,
particles) go in unchanged. Results are cached by file and date: both variants and later runs reuse them.
"""
import io
import os

import numpy as np

from . import esrgan

EFFECT_FLAG = 0x100


def _box(a, r, axis):
    """running mean over 2r+1 samples along an axis, the edges repeated"""
    if r < 1:
        return a
    p = np.pad(a, [(r + 1, r) if k == axis else (0, 0) for k in range(a.ndim)], mode='edge')
    c = np.cumsum(p, axis=axis, dtype=np.float64)
    n = a.shape[axis]
    hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
    lo = np.take(c, np.arange(0, n), axis=axis)
    return ((hi - lo) / (2 * r + 1)).astype(np.float32)


def _blur(a, sigma):
    """Gaussian blur (three box blurs, the usual approximation)"""
    r = max(0, int(round(np.sqrt(12 * sigma * sigma / 3 + 1) / 2 - 0.5)))
    if r == 0:
        return a.astype(np.float32)
    for _ in range(3):
        a = _box(_box(a, r, 0), r, 1)
    return a


def relief(img):
    """height (0..1, 0.5 = flat) and normal map (RGB) of a picture's fine detail"""
    from PIL import Image
    rgb = np.asarray(img.convert('RGB'), np.float32) / 255.0
    lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    detail = _blur(lum, 1.0) - _blur(lum, 24.0)
    h = np.clip(0.5 + detail * 1.6, 0, 1)
    # slopes (texels): Sobel; strength so that a 0.1 step over a few texels tilts the normal noticeably
    hp = np.pad(_blur(h, 0.8), 1, mode='edge')
    gx = (hp[1:-1, 2:] - hp[1:-1, :-2]) * 2 + (hp[:-2, 2:] - hp[:-2, :-2]) + (hp[2:, 2:] - hp[2:, :-2])
    gy = (hp[2:, 1:-1] - hp[:-2, 1:-1]) * 2 + (hp[2:, :-2] - hp[:-2, :-2]) + (hp[2:, 2:] - hp[:-2, 2:])
    k = 2.0
    n = np.stack([-gx * k, gy * k, np.ones_like(gx)], -1)          # (+y up in the picture: rows run down)
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    nm = ((n * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8)
    return Image.fromarray((h * 255 + 0.5).astype(np.uint8), 'L'), Image.fromarray(nm, 'RGB')


def enhanced(path, cache, log=print):
    """(4x picture, displacement picture path, normal map) of a texture file, cached. The displacement is the height
    blurred over 6 texels: carved into a mesh of a few vertices per rivet, the fine detail would come out as odd
    shapes - it stays in the normal map."""
    from PIL import Image
    stem = os.path.splitext(os.path.basename(path))[0]
    tag = '%s_%d' % (stem, int(os.path.getmtime(path)))
    up_p, h_p, n_p = (os.path.join(cache, '%s_%s.png' % (tag, s)) for s in ('x4', 'disp', 'normal'))
    if not os.path.exists(up_p):
        log('  Real-ESRGAN x4: %s' % os.path.basename(path))
        im = Image.open(path)
        im.load()
        esrgan.upscale(im, cache).save(up_p + '.part.png')
        os.replace(up_p + '.part.png', up_p)
    up = Image.open(up_p)
    up.load()
    if not (os.path.exists(h_p) and os.path.exists(n_p)):
        h, n = relief(up)
        d = _blur(np.asarray(h, np.float32), 6.0)
        Image.fromarray(np.clip(d + 0.5, 0, 255).astype(np.uint8), 'L').save(h_p)
        n.save(n_p)
    return up, h_p, Image.open(n_p)


def _encode(img, alpha):
    b = io.BytesIO()
    if alpha:
        img.save(b, 'PNG', optimize=True)
        return b.getvalue(), 'image/png'
    img.convert('RGB').save(b, 'JPEG', quality=92)
    return b.getvalue(), 'image/jpeg'


def embed(g, tex_dir, cache, log=print):
    """put every picture of the model into g: enlarged ones (+ normal maps on their materials) for the model's own
    textures, the originals for effects. -> {image index: {'height': path of its displacement picture}}"""
    from PIL import Image
    from . import is_effect
    j = g.j
    body = set()
    for m in j.get('materials', []):
        bct = (m.get('pbrMetallicRoughness') or {}).get('baseColorTexture')
        if bct and not is_effect(m):
            body.add(j['textures'][bct['index']]['source'])
    out, normals = {}, {}
    for i, im in enumerate(list(j.get('images', []))):
        uri = im.get('uri')
        if not uri:
            continue
        path = os.path.join(tex_dir, os.path.basename(uri))
        if not os.path.isfile(path):
            log('  missing texture %s' % path)
            continue
        if i in body:
            up, h_p, nmap = enhanced(path, cache, log)
            data, mime = _encode(up, up.mode in ('RGBA', 'LA'))
            nd, nmime = _encode(nmap, False)
            normals[i] = g.add_texture(nd, nmime, name=os.path.splitext(os.path.basename(path))[0] + '_normal')
            out[i] = {'height': h_p}
        else:
            data = open(path, 'rb').read()
            mime = 'image/png' if path.lower().endswith('.png') else 'image/jpeg'
        im.pop('uri')
        im['bufferView'] = g._view(data)
        im['mimeType'] = mime
    for m in j.get('materials', []):
        bct = (m.get('pbrMetallicRoughness') or {}).get('baseColorTexture')
        if bct and not is_effect(m):
            src = j['textures'][bct['index']]['source']
            if src in normals:
                m['normalTexture'] = {'index': normals[src], 'scale': 1.0}
    return out
