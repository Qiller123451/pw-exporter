"""Variant "HD": the same model with more detail - curved PN triangles (Vlachos et al. 2001, "Curved PN Triangles").

Every triangle becomes level^2 smaller ones lying on a cubic patch through its corners, bent the way the corner
normals say. The original vertices stay where they are, so the model keeps its look and proportions; where the
model is smooth (one normal per place) the facets round off, where it has a hard edge (two normals at one place:
a crease the artist made) the edge stays straight so nothing cracks open. Texture coordinates follow linearly, the
skin weights are blended from the corners (the four strongest joints).
"""
import numpy as np

from .gltf import weld_keys, blend_skin


def _grid(level):
    """barycentric (w, u, v) of the points of a triangle split level x level, and the small triangles"""
    pts, idx = [], {}
    for i in range(level + 1):
        for j in range(level + 1 - i):
            idx[(i, j)] = len(pts)
            pts.append(((level - i - j) / level, i / level, j / level))
    tris = []
    for i in range(level):
        for j in range(level - i):
            tris.append((idx[(i, j)], idx[(i + 1, j)], idx[(i, j + 1)]))
            if j < level - i - 1:
                tris.append((idx[(i + 1, j)], idx[(i + 1, j + 1)], idx[(i, j + 1)]))
    return np.array(pts), np.array(tris)


def smooth_edges(tri, pos, nrm, eps=1e-3):
    """per triangle edge (k: from corner k to corner k+1) whether it is smooth: at both ends every vertex at that place
    has the same normal"""
    key = weld_keys(pos)
    nq = np.round(nrm / eps).astype(np.int64)
    # for each place: is there only one normal?
    order = np.lexsort((nq[:, 2], nq[:, 1], nq[:, 0], key))
    k_s, n_s = key[order], nq[order]
    first = np.ones(len(order), bool)
    first[1:] = k_s[1:] != k_s[:-1]
    differs = np.zeros(len(order), bool)
    differs[1:] = (~first[1:]) & np.any(n_s[1:] != n_s[:-1], axis=1)
    hard = np.zeros(key.max() + 1, bool)
    np.logical_or.at(hard, k_s, differs)
    hv = hard[key]                                        # per vertex: its place has a crease
    a, b = tri, np.roll(tri, -1, axis=1)
    return ~(hv[a] | hv[b])


def pn_tessellate(v, level=3, bend=0.6):
    """v: {'POSITION', 'NORMAL', 'TEXCOORD_0', ..., 'JOINTS_0', 'WEIGHTS_0', 'indices'} -> the same for the curved,
    finer mesh. bend: how much of the curve to take (1 = the full PN patch; less keeps thin layers such as a coat
    over the legs from sinking into what is under them)"""
    tri = v['indices']
    P, N = v['POSITION'], v['NORMAL']
    N = N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
    smooth = smooth_edges(tri, P, N)
    p1, p2, p3 = P[tri[:, 0]], P[tri[:, 1]], P[tri[:, 2]]
    n1, n2, n3 = N[tri[:, 0]], N[tri[:, 1]], N[tri[:, 2]]
    dot = lambda a, b: np.sum(a * b, axis=1, keepdims=True)

    def edge(pa, pb, na, s):
        """the control point next to pa on the edge pa-pb: on the tangent plane where smooth, a third along the edge
        where hard"""
        bent = (2 * pa + pb - dot(pb - pa, na) * na) / 3
        flat = (2 * pa + pb) / 3
        return np.where(s[:, None], bent, flat)
    s12, s23, s31 = smooth[:, 0], smooth[:, 1], smooth[:, 2]
    b210, b120 = edge(p1, p2, n1, s12), edge(p2, p1, n2, s12)
    b021, b012 = edge(p2, p3, n2, s23), edge(p3, p2, n3, s23)
    b102, b201 = edge(p3, p1, n3, s31), edge(p1, p3, n1, s31)
    E = (b210 + b120 + b021 + b012 + b102 + b201) / 6
    V = (p1 + p2 + p3) / 3
    b111 = E + (E - V) / 2
    bary, small = _grid(level)
    w, u, t = bary[:, 0], bary[:, 1], bary[:, 2]           # weights of corners 1, 2, 3
    nt, npt = len(tri), len(bary)
    # cubic Bezier triangle at every grid point: (nt, npt, 3)
    W, U, T = w[None, :, None], u[None, :, None], t[None, :, None]
    e = lambda x: x[:, None, :]
    pos = (e(p1) * W ** 3 + e(p2) * U ** 3 + e(p3) * T ** 3 +
           3 * e(b210) * W ** 2 * U + 3 * e(b120) * W * U ** 2 + 3 * e(b201) * W ** 2 * T +
           3 * e(b021) * U ** 2 * T + 3 * e(b102) * W * T ** 2 + 3 * e(b012) * U * T ** 2 + 6 * e(b111) * W * U * T)
    flat = e(p1) * W + e(p2) * U + e(p3) * T
    pos = flat + (pos - flat) * bend
    out = {'POSITION': pos.reshape(-1, 3)}
    nrm = e(n1) * W + e(n2) * U + e(n3) * T
    nrm /= np.maximum(np.linalg.norm(nrm, axis=2, keepdims=True), 1e-9)
    out['NORMAL'] = nrm.reshape(-1, 3)
    for k, x in v.items():
        if k.startswith('TEXCOORD') or k.startswith('COLOR'):
            out[k] = (e(x[tri[:, 0]]) * W + e(x[tri[:, 1]]) * U + e(x[tri[:, 2]]) * T).reshape(-1, x.shape[1])
    if 'JOINTS_0' in v:
        J, Wt = v['JOINTS_0'], v['WEIGHTS_0']
        cj = np.stack([J[tri[:, 0]], J[tri[:, 1]], J[tri[:, 2]]], 1)          # (nt, 3, 4)
        cw = np.stack([Wt[tri[:, 0]], Wt[tri[:, 1]], Wt[tri[:, 2]]], 1)
        cj = np.repeat(cj[:, None], npt, 1).reshape(-1, 3, cj.shape[2])
        cw = np.repeat(cw[:, None], npt, 1).reshape(-1, 3, cw.shape[2])
        bb = np.tile(bary, (nt, 1))
        out['JOINTS_0'], out['WEIGHTS_0'] = blend_skin(cj, cw, bb)
    out['indices'] = (small[None, :, :] + (np.arange(nt) * npt)[:, None, None]).reshape(-1, 3)
    return out
