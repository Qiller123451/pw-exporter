"""Packing and unpacking of mesh and billboard vertices.

Mesh vertex, 8 / 9 / 16 / 17 bytes:
    bits 0-38   position, 13 bits per axis: pos = bbox.min + value / 8191 * (bbox.max - bbox.min)
                (bbox = the bounding box of the mesh, then the chunk's transform)
    bits 39-47  normal: index into the lookup sphere (normals.py), bit 39 = high bit, byte 5 = low byte
    byte 6, 7   u, v (v runs bottom-up). The game divides by 255 (PWClient.exe 0x7369e7).
    [bytes 8-11 bone indices (depth-first bone order, 255 = unused), bytes 12-15 weights (255 = 1.0)]  - 16 / 17
    [last byte: baked ambient light (mesh flag 0x10), or the two high bits of u and v (flag 0x08, extended UV:
     u = (hi_u * 256 + u) / 1024)]                                                                   - 9 / 17
Billboard vertex, 5 / 13 bytes: the 39 bit position (bit 39 unused), [bone ids, weights].
"""
import numpy as np

M13 = np.uint64(0x1FFF)


def _pack_u64(raw, nbytes):
    q = np.zeros(len(raw), dtype=np.uint64)
    for k in range(nbytes):
        q |= raw[:, k].astype(np.uint64) << np.uint64(8 * k)
    return q


def _unpack_u64(q, nbytes):
    out = np.empty((len(q), nbytes), dtype=np.uint8)
    for k in range(nbytes):
        out[:, k] = ((q >> np.uint64(8 * k)) & np.uint64(0xFF)).astype(np.uint8)
    return out


def as_raw(data, n, stride):
    return np.frombuffer(bytes(data), dtype=np.uint8, count=n * stride).reshape(n, stride).copy()


# ------------------------------------------------------------------------------------------------- quantisation
def dequantize(q, bbox):
    mn = np.array(bbox[:3], dtype=np.float64)
    mx = np.array(bbox[3:6], dtype=np.float64)
    return mn + np.asarray(q, dtype=np.float64) / 8191.0 * (mx - mn)


def quantize(pos, bbox):
    mn = np.array(bbox[:3], dtype=np.float64)
    ext = np.array(bbox[3:6], dtype=np.float64) - mn
    ext[ext == 0] = 1.0
    q = np.rint((np.asarray(pos, dtype=np.float64) - mn) / ext * 8191.0)
    return np.clip(q, 0, 8191).astype(np.uint16)


def bbox_of(pos):
    p = np.asarray(pos, dtype=np.float64).reshape(-1, 3)
    if not len(p):
        return (0.0,) * 6
    return tuple(float(x) for x in p.min(0)) + tuple(float(x) for x in p.max(0))


# --------------------------------------------------------------------------------------------------- mesh vertices
def decode_mesh(raw):
    """raw (n, stride) uint8 -> dict of fields (all integer, exact)"""
    n, stride = raw.shape
    q = _pack_u64(raw, 6)
    out = {
        'q': np.stack([q & M13, (q >> np.uint64(13)) & M13, (q >> np.uint64(26)) & M13], 1).astype(np.uint16),
        'normal': (((q >> np.uint64(39)) & np.uint64(1)) << np.uint64(8) | ((q >> np.uint64(40)) & np.uint64(0xFF))).astype(np.uint16),
        'uv': raw[:, 6:8].copy(),
    }
    if stride >= 16:
        out['bone_ids'] = raw[:, 8:12].copy()
        out['bone_weights'] = raw[:, 12:16].copy()
    if stride in (9, 17):
        out['extra'] = raw[:, stride - 1].copy()
    return out


def encode_mesh(f, stride):
    q3 = np.asarray(f['q'], dtype=np.uint64)
    n = len(q3)
    nrm = np.asarray(f['normal'], dtype=np.uint64)
    q = (q3[:, 0] & M13) | ((q3[:, 1] & M13) << np.uint64(13)) | ((q3[:, 2] & M13) << np.uint64(26)) \
        | (((nrm >> np.uint64(8)) & np.uint64(1)) << np.uint64(39)) | ((nrm & np.uint64(0xFF)) << np.uint64(40))
    raw = np.zeros((n, stride), dtype=np.uint8)
    raw[:, 0:6] = _unpack_u64(q, 6)
    raw[:, 6:8] = np.asarray(f['uv'], dtype=np.uint8)
    if stride >= 16:
        raw[:, 8:12] = np.asarray(f.get('bone_ids', np.full((n, 4), 255)), dtype=np.uint8)
        raw[:, 12:16] = np.asarray(f.get('bone_weights', np.zeros((n, 4))), dtype=np.uint8)
    if stride in (9, 17):
        raw[:, stride - 1] = np.asarray(f.get('extra', np.zeros(n)), dtype=np.uint8)
    return raw


def uv_to_float(uv8, extra=None, extended=False):
    """byte texture coordinates -> floats, v still bottom-up (as stored)"""
    uv8 = np.asarray(uv8, dtype=np.float64)
    if extended and extra is not None:
        e = np.asarray(extra, dtype=np.int64)
        u = ((e & 3) * 256 + uv8[:, 0]) / 1024.0
        v = (((e >> 2) & 3) * 256 + uv8[:, 1]) / 1024.0
        return np.stack([u, v], 1)
    return uv8 / 255.0


def uv_from_float(uv, extended=False):
    """floats -> (uv bytes, extra byte or None). Values are clamped to the range the format can hold."""
    uv = np.asarray(uv, dtype=np.float64)
    if extended:
        x = np.clip(np.rint(uv * 1024.0), 0, 1023).astype(np.int64)
        lo = (x & 0xFF).astype(np.uint8)
        hi = ((x[:, 0] >> 8) & 3) | (((x[:, 1] >> 8) & 3) << 2)
        return lo, hi.astype(np.uint8)
    return np.clip(np.rint(uv * 255.0), 0, 255).astype(np.uint8), None


# ---------------------------------------------------------------------------------------------- billboard vertices
def decode_billboard(raw):
    n, stride = raw.shape
    q = _pack_u64(raw, 5)
    out = {'q': np.stack([q & M13, (q >> np.uint64(13)) & M13, (q >> np.uint64(26)) & M13], 1).astype(np.uint16),
           'unk_bit': ((q >> np.uint64(39)) & np.uint64(1)).astype(np.uint8)}
    if stride >= 13:
        out['bone_ids'] = raw[:, 5:9].copy()
        out['bone_weights'] = raw[:, 9:13].copy()
    if stride not in (5, 13):
        out['unk_tail'] = raw[:, (13 if stride > 13 else 5):].copy()
    return out


def encode_billboard(f, stride):
    q3 = np.asarray(f['q'], dtype=np.uint64)
    n = len(q3)
    ub = np.asarray(f.get('unk_bit', np.zeros(n)), dtype=np.uint64)
    q = (q3[:, 0] & M13) | ((q3[:, 1] & M13) << np.uint64(13)) | ((q3[:, 2] & M13) << np.uint64(26)) \
        | ((ub & np.uint64(1)) << np.uint64(39))
    raw = np.zeros((n, stride), dtype=np.uint8)
    raw[:, 0:5] = _unpack_u64(q, 5)
    if stride >= 13:
        raw[:, 5:9] = np.asarray(f.get('bone_ids', np.full((n, 4), 255)), dtype=np.uint8)
        raw[:, 9:13] = np.asarray(f.get('bone_weights', np.zeros((n, 4))), dtype=np.uint8)
    if 'unk_tail' in f and stride not in (5, 13):
        raw[:, (13 if stride > 13 else 5):] = f['unk_tail']
    return raw
