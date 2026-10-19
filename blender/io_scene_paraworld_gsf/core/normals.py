"""The normal lookup sphere.

A vertex stores its normal as a 9 bit index into a fixed table of 511 unit vectors (the "normal sphere" of SEK's
tools; the table is not in the archives, it is built into the game). Decoding = table lookup. Encoding works the way
SEK's resource builder prepared normals, followed by the lookup:

  1. face normal = (v0 - v1) x (v0 - v2), NOT normalised - so larger faces weigh more; a degenerate face (length
     below 1e-5) gets (1, 0, 0)                                            (ResourceBuilder.cpp, CResourceBuilder)
  2. normal of a face corner = the face's own normal plus the normals of all other faces at that vertex that share a
     smoothing group with it (faces without smoothing group: only their own normal), then normalised
  3. the stored value is the index of the table vector closest to it (largest dot product)

The table (float32, x y z per entry) comes from the ParaWorld Toolkit (pwexport/gsf.py SPHERE), which took it from
arceusVen1's Paraworld_gsf_viewer (lib/sphere.dart).
"""
import base64
import zlib

import numpy as np

_SPHERE_B64 = (
    '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'
)
SPHERE = np.frombuffer(zlib.decompress(base64.b64decode(_SPHERE_B64)), '<f4').reshape(-1, 3).astype(np.float64)
SPHERE_SIZE = len(SPHERE)      # 511; index 511 (the 9 bit maximum) is not in the table


def decode(indices):
    """normal indices -> unit vectors (indices outside the table give the last entry)"""
    idx = np.clip(np.asarray(indices, dtype=np.int64), 0, SPHERE_SIZE - 1)
    return SPHERE[idx]


def encode(normals, chunk=65536):
    """unit vectors -> index of the closest table entry (largest dot product)"""
    n = np.asarray(normals, dtype=np.float64).reshape(-1, 3)
    out = np.empty(len(n), dtype=np.uint16)
    for s in range(0, len(n), chunk):
        out[s:s + chunk] = np.argmax(n[s:s + chunk] @ SPHERE.T, axis=1)
    return out


def face_normals(positions, triangles):
    """unnormalised face normals the way SEK's exporter computed them: (v0 - v1) x (v0 - v2)"""
    p = np.asarray(positions, dtype=np.float64)
    t = np.asarray(triangles, dtype=np.int64).reshape(-1, 3)
    v0, v1, v2 = p[t[:, 0]], p[t[:, 1]], p[t[:, 2]]
    fn = np.cross(v0 - v1, v0 - v2)
    bad = np.linalg.norm(fn, axis=1) < 1e-5
    fn[bad] = (1.0, 0.0, 0.0)
    return fn


def corner_normals(positions, triangles, smooth_groups=None):
    """normal of every face corner (n_triangles x 3 x 3) as SEK's exporter built them.

    positions      (n, 3) vertex positions (the welded mesh: one entry per position, as in the modelling program)
    triangles      (m, 3) vertex indices
    smooth_groups  (m,) 32 bit smoothing group masks per face (3ds Max semantics; 0 = flat face).
                   None = every face in group 1 (everything smooth).
    """
    t = np.asarray(triangles, dtype=np.int64).reshape(-1, 3)
    m = len(t)
    fn = face_normals(positions, t)
    sg = np.ones(m, dtype=np.uint32) if smooth_groups is None else np.asarray(smooth_groups, dtype=np.uint32)
    out = np.repeat(fn[:, None, :], 3, axis=1).copy()
    # faces around each vertex
    nv = int(t.max()) + 1 if m else 0
    order = np.argsort(t.reshape(-1), kind='stable')
    corner_vert = t.reshape(-1)[order]
    starts = np.searchsorted(corner_vert, np.arange(nv + 1))
    face_of = order // 3
    groups = np.unique(sg)
    if len(groups) == 1 and groups[0] != 0:
        # common case: everything in one smoothing group -> plain area-weighted vertex normals
        vn = np.zeros((nv, 3))
        np.add.at(vn, t.reshape(-1), np.repeat(fn, 3, axis=0))
        out = vn[t]
    else:
        for v in range(nv):
            fs = face_of[starts[v]:starts[v + 1]]
            if len(fs) < 2:
                continue
            g = sg[fs]
            for a, f in enumerate(fs):
                if g[a] == 0:
                    continue
                share = (g & g[a]) != 0
                total = fn[fs[share]].sum(axis=0)
                c = np.nonzero(t[f] == v)[0]
                out[f, c] = total
    ln = np.linalg.norm(out, axis=2, keepdims=True)
    ln[ln < 1e-12] = 1.0
    return out / ln
