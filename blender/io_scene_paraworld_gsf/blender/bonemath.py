"""Skeleton and bone animation maths (numpy, no Blender API) shared by import and export.

GSF bone local transform (column vectors), sg = -1 for a mirrored bone (rest scale -1 -1 -1), else 1:
    rest      L = T(sg * pos) * sg * R(conj q)
    animated  L = T(sg * (pos + offset)) * R(conj rest q) * R(conj key q) * S(s')
              offset = (dx, 0, 0) for trans / trans_scale tracks, the position offset for root tracks
              s' = key scale (trans_scale / root_scale), -|s| for mirrored bones, -1 / 1 without scale
World = parent world * L. Blender bone matrix (armature space) = M @ World @ M @ D @ A_b, with M the handedness mirror,
D = -I where the world matrix is a reflection (mirrored bones and their children) and A_b the axis change: GSF bones
run along +x towards their children, Blender bones along y. A_b is chosen per bone so that the Blender bone points to
its children whatever the mirror and D (add-on 1.4; armatures imported before keep the old, fixed A - see `legacy`).
"""
import numpy as np

AXIS = np.array([[0.0, 1.0, 0.0, 0.0],      # Rz(-90 deg): Blender bone y -> GSF bone x
                 [-1.0, 0.0, 0.0, 0.0],
                 [0.0, 0.0, 1.0, 0.0],
                 [0.0, 0.0, 0.0, 1.0]])
AXIS_INV = AXIS.T.copy()
FLIP = np.diag([-1.0, -1.0, 1.0, 1.0])     # half turn about the bone's z axis
AXIS_VERSION = 2                          # stored on imported armatures as "gsf_bone_axis"


def bone_axes(det, M, legacy=False):
    """axis matrices A_b (..., 4, 4) for bones with world determinant det (+-1, any shape) under the mirror M.
    The Blender bone's y axis is M @ World @ M @ D @ A_b @ y = M @ World @ (m_x * det_b * s) x with A_b y = s x and
    m_x = M[0][0] (M is diagonal). It points along the GSF bone's +x (towards the children) when s = m_x * det_b:
    the plain AXIS (s = 1) or AXIS @ FLIP (s = -1). legacy: always AXIS (armatures
    imported by add-on versions before 1.4)."""
    det = np.asarray(det, dtype=np.float64)
    A = np.broadcast_to(AXIS, det.shape + (4, 4)).copy()
    if not legacy:
        mx = np.sign(np.asarray(M, dtype=np.float64)[0, 0])       # -1 when the mirror flips the x axis
        A[det * mx < 0] = AXIS @ FLIP
    return A


def _sk_axis(sk, b, M):
    return bone_axes(sk.det[b], M, getattr(sk, 'legacy', False))
KEY_FLOATS = {0: 10, 1: 13, 2: 4, 3: 5, 4: 8}


# ------------------------------------------------------------------------------------------------- quaternions
def gsf_quat_to_mat(q):
    """GSF quaternions (..., 4) x y z w -> rotation matrices R(conj q) (..., 3, 3) for column vectors"""
    q = np.asarray(q, dtype=np.float64)
    n = np.linalg.norm(q, axis=-1, keepdims=True)
    n[n < 1e-12] = 1.0
    q = q / n
    a, b, c, w = -q[..., 0], -q[..., 1], -q[..., 2], q[..., 3]
    R = np.empty(q.shape[:-1] + (3, 3))
    R[..., 0, 0] = 1 - 2 * (b * b + c * c)
    R[..., 0, 1] = 2 * (a * b - c * w)
    R[..., 0, 2] = 2 * (a * c + b * w)
    R[..., 1, 0] = 2 * (a * b + c * w)
    R[..., 1, 1] = 1 - 2 * (a * a + c * c)
    R[..., 1, 2] = 2 * (b * c - a * w)
    R[..., 2, 0] = 2 * (a * c - b * w)
    R[..., 2, 1] = 2 * (b * c + a * w)
    R[..., 2, 2] = 1 - 2 * (a * a + b * b)
    return R


def mat_to_quat_wxyz(R):
    """rotation matrices (..., 3, 3) -> quaternions w x y z (Shepperd, vectorised)"""
    R = np.asarray(R, dtype=np.float64)
    shp = R.shape[:-2]
    m = R.reshape(-1, 3, 3)
    n = len(m)
    out = np.empty((n, 4))
    m00, m11, m22 = m[:, 0, 0], m[:, 1, 1], m[:, 2, 2]
    tr = m00 + m11 + m22
    c0 = tr > 0
    c1 = ~c0 & (m00 > m11) & (m00 > m22)
    c2 = ~c0 & ~c1 & (m11 > m22)
    c3 = ~c0 & ~c1 & ~c2
    if c0.any():
        k = m[c0]
        s = np.sqrt(tr[c0] + 1.0) * 2
        out[c0] = np.stack([0.25 * s, (k[:, 2, 1] - k[:, 1, 2]) / s, (k[:, 0, 2] - k[:, 2, 0]) / s, (k[:, 1, 0] - k[:, 0, 1]) / s], 1)
    if c1.any():
        k = m[c1]
        s = np.sqrt(np.maximum(1.0 + k[:, 0, 0] - k[:, 1, 1] - k[:, 2, 2], 1e-12)) * 2
        out[c1] = np.stack([(k[:, 2, 1] - k[:, 1, 2]) / s, 0.25 * s, (k[:, 0, 1] + k[:, 1, 0]) / s, (k[:, 0, 2] + k[:, 2, 0]) / s], 1)
    if c2.any():
        k = m[c2]
        s = np.sqrt(np.maximum(1.0 + k[:, 1, 1] - k[:, 0, 0] - k[:, 2, 2], 1e-12)) * 2
        out[c2] = np.stack([(k[:, 0, 2] - k[:, 2, 0]) / s, (k[:, 0, 1] + k[:, 1, 0]) / s, 0.25 * s, (k[:, 1, 2] + k[:, 2, 1]) / s], 1)
    if c3.any():
        k = m[c3]
        s = np.sqrt(np.maximum(1.0 + k[:, 2, 2] - k[:, 0, 0] - k[:, 1, 1], 1e-12)) * 2
        out[c3] = np.stack([(k[:, 1, 0] - k[:, 0, 1]) / s, (k[:, 0, 2] + k[:, 2, 0]) / s, (k[:, 1, 2] + k[:, 2, 1]) / s, 0.25 * s], 1)
    out /= np.linalg.norm(out, axis=1, keepdims=True)
    return out.reshape(shp + (4,))


def wxyz_to_mat(q):
    """rotation quaternions w x y z (..., 4) -> matrices (..., 3, 3)"""
    q = np.asarray(q, dtype=np.float64)
    n = np.linalg.norm(q, axis=-1, keepdims=True)
    n[n < 1e-12] = 1.0
    w, x, y, z = np.moveaxis(q / n, -1, 0)
    R = np.empty(q.shape[:-1] + (3, 3))
    R[..., 0, 0] = 1 - 2 * (y * y + z * z)
    R[..., 0, 1] = 2 * (x * y - z * w)
    R[..., 0, 2] = 2 * (x * z + y * w)
    R[..., 1, 0] = 2 * (x * y + z * w)
    R[..., 1, 1] = 1 - 2 * (x * x + z * z)
    R[..., 1, 2] = 2 * (y * z - x * w)
    R[..., 2, 0] = 2 * (x * z - y * w)
    R[..., 2, 1] = 2 * (y * z + x * w)
    R[..., 2, 2] = 1 - 2 * (x * x + y * y)
    return R


def mat_to_gsf_quat(R):
    """rotation matrices -> GSF quaternions x y z w (R = R(conj q))"""
    q = mat_to_quat_wxyz(R)
    return np.stack([-q[..., 1], -q[..., 2], -q[..., 3], q[..., 0]], -1)


def continuous(q):
    """flip signs so consecutive quaternions stay on one hemisphere"""
    q = np.array(q, dtype=np.float64)
    if len(q) < 2:
        return q
    d = np.einsum('ij,ij->i', q[1:], q[:-1])
    sign = np.cumprod(np.where(d < 0, -1.0, 1.0))
    q[1:] *= sign[:, None]
    return q


def fill_invalid(keys):
    """replace keys with NaN, huge or zero-length quaternions by the nearest valid key"""
    k = np.array(keys, dtype=np.float64)
    if not len(k):
        return k
    ok = np.isfinite(k).all(1) & (np.linalg.norm(np.nan_to_num(k[:, :4]), axis=1) > 1e-6) & (np.abs(np.nan_to_num(k)).max(1) < 1e6)
    if ok.all():
        return k
    if not ok.any():
        k[:] = 0
        k[:, 3] = 1
        return k
    good = np.where(ok)[0]
    for i in np.where(~ok)[0]:
        k[i] = k[good[np.argmin(np.abs(good - i))]]
    return k


def orthonormal(M3, s):
    """rotation part of matrices whose columns are scaled by s (columns with zero scale are rebuilt from the
    others)"""
    s = np.asarray(s, dtype=np.float64)
    R = np.array(M3, dtype=np.float64) / np.where(s > 1e-9, s, 1.0)[:, None, :]
    for i in np.where((s <= 1e-9).any(1))[0]:
        R[i] = M3[i]
        cols = [M3[i][:, k] / s[i][k] if s[i][k] > 1e-9 else None for k in range(3)]
        bad = [k for k in range(3) if cols[k] is None]
        if len(bad) == 1:
            k = bad[0]
            cols[k] = np.cross(cols[(k + 1) % 3], cols[(k + 2) % 3])
        elif len(bad) >= 2:
            good = [k for k in range(3) if cols[k] is not None]
            if good:
                g = cols[good[0]]
                h = np.array([1.0, 0, 0]) if abs(g[0]) < 0.9 else np.array([0, 1.0, 0])
                o = np.cross(g, h)
                o /= np.linalg.norm(o)
                k = good[0]
                cols[(k + 1) % 3] = o
                cols[(k + 2) % 3] = np.cross(g, o)
            else:
                cols = [np.array([1.0, 0, 0]), np.array([0, 1.0, 0]), np.array([0, 0, 1.0])]
        R[i] = np.stack(cols, 1)
    return R


def trs(t, R, s=None):
    """(n,3) translations, (n,3,3) rotations, (n,3) scales -> (n,4,4)"""
    n = len(R)
    M = np.zeros((n, 4, 4))
    M[:, :3, :3] = R if s is None else R * s[:, None, :]
    M[:, :3, 3] = t
    M[:, 3, 3] = 1.0
    return M


# ------------------------------------------------------------------------------------------------- skeletons
class Skeleton:
    """depth-first view of a skeleton chunk"""

    def __init__(self, chunk):
        self.chunk = chunk
        bl = chunk.bones()
        self.bones = [b for b, _ in bl]
        self.parent = np.array([p for _, p in bl], dtype=np.int64)
        self.n = len(bl)
        self.pos = np.array([b.v['pos'] for b in self.bones], dtype=np.float64).reshape(-1, 3)
        self.rot = np.array([b.v['rot'] for b in self.bones], dtype=np.float64).reshape(-1, 4)
        self.scale = np.array([b.v['scale'] for b in self.bones], dtype=np.float64).reshape(-1, 3)
        self.sg = np.where((self.scale < 0).all(1), -1.0, 1.0)
        self.R = gsf_quat_to_mat(self.rot)
        self.local = trs(self.sg[:, None] * self.pos, self.sg[:, None, None] * self.R)
        self.world = world_of(self.local, self.parent)
        self.det = np.sign(np.linalg.det(self.world[:, :3, :3]))

    def signature(self):
        return tuple((b.v['guid'],) + tuple(np.round(self.local[i], 4).reshape(-1)) for i, b in enumerate(self.bones))


def world_of(local, parent):
    """local (n_bones, [frames,] 4, 4) -> world, parents first (depth-first order)"""
    world = np.empty_like(local)
    for i in range(len(local)):
        p = parent[i]
        world[i] = local[i] if p < 0 else world[p] @ local[i]
    return world


def to_blender(W, det, M, legacy=False):
    """GSF world matrices (..., 4, 4) of bones -> Blender bone matrices. det: +-1 per matrix (broadcast)"""
    D = np.ones(np.shape(det) + (4,))
    D[..., :3] = np.asarray(det)[..., None]
    Dm = np.zeros(np.shape(det) + (4, 4))
    for k in range(4):
        Dm[..., k, k] = D[..., k]
    return M @ W @ M @ Dm @ bone_axes(det, M, legacy)


def from_blender(B, det, M, legacy=False):
    D = np.ones(np.shape(det) + (4,))
    D[..., :3] = np.asarray(det)[..., None]
    Dm = np.zeros(np.shape(det) + (4, 4))
    for k in range(4):
        Dm[..., k, k] = D[..., k]
    return M @ B @ np.swapaxes(bone_axes(det, M, legacy), -1, -2) @ Dm @ M


# ----------------------------------------------------------------------------------------- import: keys -> local
def track_locals(sk, bone, fmt, constant, keys, nf, is_root):
    """local matrices (nf, 4, 4) of one bone from its track keys"""
    keys = fill_invalid(keys) if len(keys) else np.tile([0, 0, 0, 1.0], (1, 1))
    if constant or len(keys) == 1:
        keys = np.repeat(keys[:1], nf, axis=0)
    keys = keys[:nf]
    if len(keys) < nf:
        keys = np.concatenate([keys, np.repeat(keys[-1:], nf - len(keys), 0)], 0)
    sg = sk.sg[bone]
    R = sk.R[bone][None] @ gsf_quat_to_mat(keys[:, :4])
    t = np.repeat(sk.pos[bone][None], nf, 0)
    s = None
    w = keys.shape[1]
    if not constant:
        if fmt in (0, 1) and w >= 7:
            t = t + keys[:, 4:7]
            if fmt == 1 and w >= 13:
                s = keys[:, 10:13].copy()
        elif fmt in (3, 4) and w >= 5:
            t[:, 0] += keys[:, 4]
            if fmt == 4 and w >= 8:
                s = keys[:, 5:8].copy()
    if sg < 0:
        s = -np.abs(s) if s is not None else -np.ones((nf, 3))
    return trs(sg * t, R, s)


# ----------------------------------------------------------------------------------------- export: local -> keys
def local_to_keys(sk, bone, L, fmt, constant):
    """local matrices (nf, 4, 4) -> key array for the track format; also returns warnings"""
    warn = []
    sg = sk.sg[bone]
    M3 = L[:, :3, :3] * sg
    t = L[:, :3, 3] * sg
    s = np.linalg.norm(M3, axis=1)                          # column norms
    R = orthonormal(M3, s)
    det = np.linalg.det(R)
    if (det < 0).any():
        R[det < 0] = -R[det < 0]
        s[det < 0] = -s[det < 0]
        warn.append('negative scale on bone %d' % bone)
    keyR = np.swapaxes(sk.R[bone], 0, 1)[None] @ R
    q = continuous(mat_to_gsf_quat(keyR))
    nf = len(L)
    off = t - sk.pos[bone][None]
    if constant:
        return q[:1].astype(np.float32), warn
    if fmt == 2:
        if np.abs(off).max(initial=0) > 1e-3:
            warn.append('bone %d moves but its track format has no position' % bone)
        return q.astype(np.float32), warn
    if fmt in (3, 4):
        if np.abs(off[:, 1:]).max(initial=0) > 1e-3:
            warn.append('bone %d moves sideways; its track format only stretches along the bone' % bone)
        k = np.concatenate([q, off[:, :1]] + ([s] if fmt == 4 else []), 1)
        return k.astype(np.float32), warn
    if fmt in (0, 1):
        vel = np.zeros((nf, 3))
        k = np.concatenate([q, off, vel] + ([s] if fmt == 1 else []), 1)
        return k.astype(np.float32), warn
    raise ValueError('track format %d' % fmt)


def auto_format(sk, bone, L):
    """smallest track format that holds this motion"""
    sg = sk.sg[bone]
    M3 = L[:, :3, :3] * sg
    t = L[:, :3, 3] * sg
    s = np.linalg.norm(M3, axis=1)
    off = t - sk.pos[bone][None]
    if np.abs(s - 1).max(initial=0) > 1e-4:
        return 4
    if np.abs(off).max(initial=0) > 1e-4:
        return 3
    return 2


# ------------------------------------------------------------------------------------------- pose basis <-> local
# Blender bone b: B_b = M W_b M D_b A_b. Then B_p^-1 B_b = A_p^-1 D_p M L_b M D_b A_b, so the pose basis (relative to the rest
# relation C_b = Brest_p^-1 Brest_b) follows from the GSF local matrix alone - no inverse of animated matrices (bones
# that scale to zero to hide a part stay exact).
def _D(det):
    return np.diag([det, det, det, 1.0])


def local_to_basis(sk, Brest, b, L, M):
    """GSF local matrices (n,4,4) of bone b -> Blender pose basis matrices (n,4,4)"""
    p = sk.parent[b]
    Db = _D(sk.det[b])
    Ab = _sk_axis(sk, b, M)
    if p < 0:
        Bb = M[None] @ L @ M[None] @ Db[None] @ Ab[None]
        return np.linalg.inv(Brest[b])[None] @ Bb
    X = _sk_axis(sk, p, M).T[None] @ _D(sk.det[p])[None] @ M[None] @ L @ M[None] @ Db[None] @ Ab[None]
    C = np.linalg.inv(Brest[p]) @ Brest[b]
    return np.linalg.inv(C)[None] @ X


def basis_to_local(sk, Brest, b, basis, M):
    """Blender pose basis matrices (n,4,4) of bone b -> GSF local matrices"""
    p = sk.parent[b]
    Db = _D(sk.det[b])
    Ab_inv = _sk_axis(sk, b, M).T
    if p < 0:
        Bb = Brest[b][None] @ basis
        return M[None] @ Bb @ Ab_inv[None] @ Db[None] @ M[None]
    C = np.linalg.inv(Brest[p]) @ Brest[b]
    X = C[None] @ basis
    return M[None] @ _D(sk.det[p])[None] @ _sk_axis(sk, p, M)[None] @ X @ Ab_inv[None] @ Db[None] @ M[None]
