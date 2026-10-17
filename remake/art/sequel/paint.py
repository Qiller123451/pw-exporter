"""Image helpers of the painted look (no Blender needed): used by kit.py on the baked textures and by roads.py."""
import numpy as np


def kuwahara(img, r):
    """Kuwahara filter (an oil-paint look): each pixel takes the mean of the least varied of the four (r+1)^2
    squares around it"""
    h, w, _ = img.shape
    lum = img @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    pad = r
    P = np.pad(img, ((pad, pad), (pad, pad), (0, 0)), mode='edge')
    L = np.pad(lum, ((pad, pad), (pad, pad)), mode='edge')
    def integral(a):
        return np.pad(a.cumsum(0).cumsum(1), ((1, 0), (1, 0)) + ((0, 0),) * (a.ndim - 2))
    IP, IL, IL2 = integral(P), integral(L), integral(L * L)
    n = (r + 1) ** 2
    best_v = np.full((h, w), np.inf, dtype=np.float32)
    out = np.zeros_like(img)
    ys, xs = np.mgrid[0:h, 0:w]
    for dy, dx in ((0, 0), (0, r), (r, 0), (r, r)):
        y0, x0 = ys + dy, xs + dx              # the square [y0, y0 + r] x [x0, x0 + r] in the padded image
        y1, x1 = y0 + r + 1, x0 + r + 1
        def box(I):
            return I[y1, x1] - I[y0, x1] - I[y1, x0] + I[y0, x0]
        m = box(IL) / n
        v = box(IL2) / n - m * m
        mean = box(IP) / n
        sel = v < best_v
        best_v = np.where(sel, v, best_v)
        out[sel] = mean[sel]
    return out


def grade(c, contrast=1.25, sat=1.22, warm=0.035):
    """ParaWorld's textures are warmer, more saturated and contrasty than photos: a gentle S around the middle,
    more colour, a little warmth"""
    c = np.clip(c, 0, 1)
    lum = (c * [0.299, 0.587, 0.114]).sum(-1, keepdims=True)
    c = lum + (c - lum) * sat
    c = 0.5 + (c - 0.5) * contrast
    c = c * [1 + warm, 1.0, 1 - warm]
    return np.clip(c, 0, 1)
