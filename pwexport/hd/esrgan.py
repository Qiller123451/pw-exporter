"""Real-ESRGAN x4 (Wang et al. 2021, https://github.com/xinntao/Real-ESRGAN, BSD-3-Clause) in plain numpy.

    img4 = upscale(img)            # PIL image -> 4x as large (RGB; an alpha channel is enlarged with Lanczos)

The network is RRDBNet (23 residual-in-residual dense blocks, 64 features, nearest-neighbour upsampling twice) with
the published weights RealESRGAN_x4plus.pth, read without PyTorch: the checkpoint is a zip with a pickled state dict
whose tensors point into raw float32 storages. The weights (64 MB) are downloaded once into the toolkit's cache.
Speed: about 36 MFLOP per source pixel - a 512 x 512 texture takes a minute or two on four CPU cores. Without the
weights (no network) upscale() falls back to Lanczos with a light unsharp mask.
"""
import io
import os
import pickle
import urllib.request
import zipfile
from collections import OrderedDict

import numpy as np

URL = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth'
FILE = 'RealESRGAN_x4plus.pth'


# ---------------------------------------------------------------- the checkpoint, without torch
class _Storage:
    def __init__(self, dtype):
        self.dtype = dtype


_DTYPES = {'FloatStorage': np.float32, 'HalfStorage': np.float16, 'DoubleStorage': np.float64, 'LongStorage': np.int64,
           'IntStorage': np.int32, 'ByteStorage': np.uint8}


def _rebuild_tensor(storage, offset, size, stride, *rest):
    a = storage[offset:]
    isz = a.itemsize
    return np.lib.stride_tricks.as_strided(a, shape=tuple(size), strides=tuple(s * isz for s in stride)).astype(np.float32).copy()


class _Unpickler(pickle.Unpickler):
    def __init__(self, f, zf, prefix):
        super().__init__(f)
        self.zf, self.prefix = zf, prefix

    def find_class(self, module, name):
        if module == 'collections' and name == 'OrderedDict':
            return OrderedDict
        if module.startswith('torch') and name in ('_rebuild_tensor_v2', '_rebuild_tensor'):
            return _rebuild_tensor
        if module == 'torch' and name in _DTYPES:
            return _Storage(_DTYPES[name])
        if module == 'torch._utils' and name == '_rebuild_parameter':
            return lambda data, *a: data
        raise pickle.UnpicklingError('unexpected %s.%s in the checkpoint' % (module, name))

    def persistent_load(self, pid):
        _, kind, key, _location, _numel = pid
        raw = self.zf.read('%s/data/%s' % (self.prefix, key))
        return np.frombuffer(raw, kind.dtype if isinstance(kind, _Storage) else np.float32)


def load_state(path):
    """{name: numpy array} of a PyTorch zip checkpoint (the 'params_ema' / 'params' dict if it has one)"""
    zf = zipfile.ZipFile(path)
    pkl = next(n for n in zf.namelist() if n.endswith('data.pkl'))
    st = _Unpickler(io.BytesIO(zf.read(pkl)), zf, pkl.split('/')[0]).load()
    for k in ('params_ema', 'params'):
        if isinstance(st, dict) and k in st:
            return st[k]
    return st


def weights_path(cache, download=True):
    p = os.path.join(cache, FILE)
    if not os.path.exists(p) and download:
        tmp = p + '.part'
        urllib.request.urlretrieve(URL, tmp)
        os.replace(tmp, p)
    return p if os.path.exists(p) else None


# ---------------------------------------------------------------- the network
def _cols(x):
    """3 x 3 neighbourhoods of x (C, H, W), zero padded -> (H*W, C*9)"""
    c, h, w = x.shape
    p = np.pad(x, ((0, 0), (1, 1), (1, 1)))
    v = np.lib.stride_tricks.sliding_window_view(p, (3, 3), axis=(1, 2))      # (C, H, W, 3, 3)
    return np.ascontiguousarray(v.transpose(1, 2, 0, 3, 4)).reshape(h * w, c * 9)


def _lrelu(x):
    return np.where(x > 0, x, x * 0.2)


class RRDBNet:
    def __init__(self, state):
        self.W = {}
        for k, v in state.items():
            if k.endswith('.weight'):
                o, c = v.shape[:2]
                self.W[k[:-7]] = (np.ascontiguousarray(v.reshape(o, c * 9).T), state[k[:-7] + '.bias'].astype(np.float32), c)
        self.blocks = 1 + max(int(k.split('.')[1]) for k in self.W if k.startswith('body.'))

    def conv(self, name, cols, h, w):
        """cols: [(im2col of a part, channels)] in the concatenation order"""
        wt, b, _ = self.W[name]
        out = None
        ofs = 0
        for col, c in cols:
            part = col @ wt[ofs * 9:(ofs + c) * 9]
            out = part if out is None else out + part
            ofs += c
        out += b
        return out.T.reshape(-1, h, w)

    def rdb(self, name, x):
        h, w = x.shape[1:]
        cols = [(_cols(x), x.shape[0])]
        for i in range(1, 5):
            y = _lrelu(self.conv('%s.conv%d' % (name, i), cols, h, w))
            cols.append((_cols(y), y.shape[0]))
        return self.conv(name + '.conv5', cols, h, w) * 0.2 + x

    def __call__(self, img):
        """img: (3, H, W) float32 0..1 -> (3, 4H, 4W)"""
        h, w = img.shape[1:]
        feat = self.conv('conv_first', [(_cols(img), 3)], h, w)
        body = feat
        for i in range(self.blocks):
            y = body
            for r in (1, 2, 3):
                y = self.rdb('body.%d.rdb%d' % (i, r), y)
            body = y * 0.2 + body
        feat = feat + self.conv('conv_body', [(_cols(body), 64)], h, w)
        for name in ('conv_up1', 'conv_up2'):
            feat = feat.repeat(2, axis=1).repeat(2, axis=2)
            hh, ww = feat.shape[1:]
            feat = _lrelu(self.conv(name, [(_cols(feat), 64)], hh, ww))
        hh, ww = feat.shape[1:]
        feat = _lrelu(self.conv('conv_hr', [(_cols(feat), 64)], hh, ww))
        return self.conv('conv_last', [(_cols(feat), 64)], hh, ww)


_net = {}


def network(cache):
    p = weights_path(cache)
    if not p:
        return None
    if p not in _net:
        _net[p] = RRDBNet(load_state(p))
    return _net[p]


def upscale(img, cache, tile=160, pad=12, log=None):
    """a PIL image 4x as large: Real-ESRGAN for the colour, Lanczos for an alpha channel"""
    from PIL import Image, ImageFilter
    w, h = img.size
    alpha = img.getchannel('A') if img.mode in ('RGBA', 'LA') else None
    rgb = img.convert('RGB')
    try:
        net = network(cache)
    except Exception as e:                       # no network, a damaged download
        if log:
            log('Real-ESRGAN not available (%s): Lanczos instead' % e)
        net = None
    if net is None:
        out = rgb.resize((w * 4, h * 4), Image.LANCZOS).filter(ImageFilter.UnsharpMask(2, 60, 2))
    else:
        x = np.asarray(rgb, np.float32).transpose(2, 0, 1) / 255.0
        res = np.zeros((3, h * 4, w * 4), np.float32)
        n = ((h + tile - 1) // tile) * ((w + tile - 1) // tile)
        k = 0
        for y0 in range(0, h, tile):
            for x0 in range(0, w, tile):
                y1, x1 = min(h, y0 + tile), min(w, x0 + tile)
                ya, xa, yb, xb = max(0, y0 - pad), max(0, x0 - pad), min(h, y1 + pad), min(w, x1 + pad)
                o = net(x[:, ya:yb, xa:xb])
                res[:, y0 * 4:y1 * 4, x0 * 4:x1 * 4] = o[:, (y0 - ya) * 4:(y0 - ya + y1 - y0) * 4, (x0 - xa) * 4:(x0 - xa + x1 - x0) * 4]
                k += 1
                if log:
                    log('  tile %d / %d' % (k, n))
        out = Image.fromarray((np.clip(res, 0, 1).transpose(1, 2, 0) * 255 + 0.5).astype(np.uint8))
    if alpha is not None:
        out.putalpha(alpha.resize(out.size, Image.LANCZOS))
    return out
