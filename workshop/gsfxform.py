"""Changes to a model of a mod's archive that the add-ons need (workshop/addons.py):

    add_link(model, 'Ws01', at='we', offset=M)    a new attachment point: the link `at` (or the model's origin) moved
                                                  and turned by the 4 x 4 matrix M (in that link's frame, GSF axes)
    scale_model(model, 1.5)                       the whole model, its skeleton, links, effects and animations
                                                  1.5 times as big (about the model's origin)
    link_matrix(model, 'we')                      where a link sits in the model (4 x 4, bind pose)

The game finds a link by name (a FourCC: up to 4 characters) and puts what a script links there into the link's frame.
A skinned link follows its bone, so a new link made from one keeps that link's bone binding: it moves with the same
part of the body (the Black widow's "we" hangs on its root bone).

Matrices are column matrices (M @ point); the archive stores rotations as Direct3D quaternions (x, y, z, w) whose
conjugate is the rotation (pwexport/gsf.py turns them into glTF the same way). Mesh and bind matrices are stored
row-major (Direct3D): their translation is at 12..14 of the 16 floats.
"""
import copy
import math

import numpy as np


# ------------------------------------------------------------------------------------------------------- math
def qmat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def mat_quat(m):
    m = np.array(m, dtype=np.float64)[:3, :3]
    tr = m[0, 0] + m[1, 1] + m[2, 2]
    if tr > 0:
        s = math.sqrt(tr + 1.0) * 2
        q = [(m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s, 0.25 * s]
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = math.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        q = [0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s, (m[2, 1] - m[1, 2]) / s]
    elif m[1, 1] > m[2, 2]:
        s = math.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        q = [(m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s, (m[0, 2] - m[2, 0]) / s]
    else:
        s = math.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        q = [(m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s, (m[1, 0] - m[0, 1]) / s]
    q = np.array(q)
    return q / np.linalg.norm(q)


def euler_matrix(pos=(0, 0, 0), rot_deg=(0, 0, 0)):
    """4 x 4: translation `pos`, then the rotation X, Y, Z (degrees, intrinsic X then Y then Z - three.js's 'XYZ'
    Euler order, which the Workshop's 3D view uses)"""
    ax, ay, az = (math.radians(float(a)) for a in rot_deg)
    cx, sx, cy, sy, cz, sz = math.cos(ax), math.sin(ax), math.cos(ay), math.sin(ay), math.cos(az), math.sin(az)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    M = np.eye(4)
    M[:3, :3] = Rx @ Ry @ Rz
    M[:3, 3] = [float(x) for x in pos]
    return M


def links(model):
    return [c for c in model.chunks if getattr(c, 'KIND', None) == 'link']


def find_link(model, name):
    return next((c for c in links(model) if (c.v.get('link_fourcc') or '') == name), None)


def link_matrix(model, name):
    """the link's frame in the model (bind pose): rotation = conjugate of the stored quaternion"""
    c = find_link(model, name)
    if c is None:
        raise KeyError('%s has no link %s' % (model.name, name))
    q = np.array(c.v['rot'], dtype=np.float64) * [-1, -1, -1, 1]
    M = np.eye(4)
    M[:3, :3] = qmat(q / (np.linalg.norm(q) or 1))
    M[:3, 3] = c.v['pos']
    return M


def free_link_name(model, prefix='Ws'):
    have = {c.v.get('link_fourcc') for c in links(model)}
    for k in range(1, 100):
        n = '%s%02d' % (prefix, k)
        if n not in have:
            return n
    raise ValueError('%s: no free link name' % model.name)


def add_link(model, name, at=None, offset=None):
    """a new link `name` at link `at` (None: the model's origin) moved by `offset` (4 x 4 in that frame). It keeps
    the bone binding of `at`; at the origin of a skinned model it hangs on the root bone."""
    from io_scene_paraworld_gsf.core.chunks.simple import LinkChunk     # (the add-on's core: gsfedit._core())
    if len(name) > 4:
        raise ValueError('a link name has at most 4 characters: %s' % name)
    if find_link(model, name) is not None:
        raise ValueError('%s already has a link %s' % (model.name, name))
    base = find_link(model, at) if at else None
    if at and base is None:
        raise KeyError('%s has no link %s' % (model.name, at))
    B = link_matrix(model, at) if base is not None else np.eye(4)
    M = B @ (np.asarray(offset, dtype=np.float64) if offset is not None else np.eye(4))
    # (a rotation only: a scale in the offset is the part's own business - a scaled copy of its model)
    R = M[:3, :3] / np.linalg.norm(M[:3, :3], axis=0)
    q = mat_quat(R) * [-1, -1, -1, 1]
    if base is not None:
        c = LinkChunk(base.type_id)
        c.v.update({k: v for k, v in base.v.items() if k not in ('pos', 'rot', 'link_fourcc', 'guid')})
        c.refs = dict(base.refs)
    else:
        skel = next((x for x in model.chunks if getattr(x, 'KIND', None) == 'skeleton'), None)
        c = LinkChunk(0x8000000B if skel is not None else 0x0000000B)
        if skel is not None:
            c.v.update(bone_ids=(0, 255, 255, 255), bone_weights=(255, 0, 0, 0))
            c.refs = {'skeleton_index': skel}
    c.v['pos'] = tuple(float(x) for x in M[:3, 3])
    c.v['rot'] = tuple(float(x) for x in q)
    c.v['link_fourcc'] = name
    c.v['guid'] = _crc(name)
    # links stay together in the chunk table (the model info stores the first one and the count)
    idx = [i for i, x in enumerate(model.chunks) if getattr(x, 'KIND', None) == 'link']
    model.chunks.insert(idx[-1] + 1 if idx else len(model.chunks), c)
    return c


def _crc(text):
    import zlib
    return zlib.crc32(text.encode('latin-1')) & 0xFFFFFFFF


# ------------------------------------------------------------------------------------------------------ scale
def _bbox(b, s):
    return tuple(float(x) * s for x in b)


def _row_major_t(flat, s):
    a = np.array(flat, dtype=np.float64).copy()
    a[12:15] *= s
    return tuple(float(x) for x in a)


def _vol_size(shape, size, s):
    """a volume's size scaled: a sphere stores (radius, radius squared, 0), the others lengths"""
    sz = [float(x) for x in size]
    if shape == 0 and len(sz) >= 2:
        return tuple([sz[0] * s, sz[1] * s * s] + [x * s for x in sz[2:]])
    return tuple(x * s for x in sz)


def _mesh_data(md, s):
    md.v['bounding_box'] = _bbox(md.v['bounding_box'], s)       # the vertices are quantised in it
    for sm in md.submeshes:
        if 'bounding_box' in sm.v:
            sm.v['bounding_box'] = _bbox(sm.v['bounding_box'], s)


def copy_model(model, keep=()):
    """a deep copy that shares the objects in `keep` (the archive's materials and sounds)"""
    memo = {id(x): x for x in keep}
    return copy.deepcopy(model, memo)


def scale_model(model, s):
    """scale `model` (a copy of its own: copy_model) by s about its origin. Rotations and the sizes of sprites and
    particles stay; positions, lengths and the vertices grow."""
    s = float(s)
    if abs(s - 1) < 1e-9:
        return model
    if s <= 0:
        raise ValueError('a scale must be positive')
    v = model.v
    v['bounding_box'] = _bbox(v['bounding_box'], s)
    for cv in model.collision:
        cv.v['pos'] = tuple(float(x) * s for x in cv.v['pos'])
        cv.v['size'] = _vol_size(cv.v.get('shape'), cv.v['size'], s)
    for c in model.chunks:
        k = getattr(c, 'KIND', None)
        if k is None:
            continue
        cv = c.v
        if k == 'mesh':
            cv['transform'] = _row_major_t(cv['transform'], s)
            _mesh_data(c.mesh, s)
            for a in ('points_a', 'points_b'):
                if getattr(c, a, None) is not None:
                    setattr(c, a, (np.asarray(getattr(c, a), dtype=np.float32) * s).astype(np.float32))
        elif k == 'skeleton':
            for b, _ in c.root.walk():
                b.v['pos'] = tuple(float(x) * s for x in b.v['pos'])
            if len(c.bind_poses):
                bp = np.array(c.bind_poses, dtype=np.float32).copy()
                bp[:, 12:15] *= s
                c.bind_poses = bp
        elif k == 'billboard':
            cv['transform'] = _row_major_t(cv['transform'], s)
            if 'bounding_box' in cv:
                cv['bounding_box'] = _bbox(cv['bounding_box'], s)
            cv['size'] = float(cv.get('size', 1.0)) * s
        elif k in ('link', 'particle', 'speedline', 'light'):
            cv['pos'] = tuple(float(x) * s for x in cv['pos'])
            if k == 'speedline':
                cv['size'] = float(cv.get('size', 1.0)) * s
                cv['length'] = float(cv.get('length', 1.0)) * s
        elif k in ('light_volume', 'phys_coll'):
            cv['pos'] = tuple(float(x) * s for x in cv['pos'])
            cv['size'] = _vol_size(cv.get('shape'), cv['size'], s)
    done = set()
    for ma in model.anims:
        for _, a, _ in ma.tracks:
            if a is None or id(a) in done:
                continue
            done.add(id(a))
            _scale_anim(a, s)
    return model


def _scale_anim(a, s):
    k = getattr(a, 'KIND', None)
    if k == 'bone_anim':
        if a.v.get('root_height', -1.0) != -1.0:
            a.v['root_height'] = float(a.v['root_height']) * s
        a.v['root_dist'] = tuple(float(x) * s for x in a.v.get('root_dist', (0, 0, 0)))
        for t, _ in a.root.walk():
            if not len(t.keys) or t.constant:
                continue
            keys = np.array(t.keys, dtype=np.float32).copy()
            f = t.format
            if f in (0, 1):            # rot4, position offset 3, velocity 3 [, scale 3]
                keys[:, 4:10] *= s
            elif f in (3, 4):          # rot4, stretch along x [, scale 3]
                keys[:, 4] *= s
            t.keys = keys
    elif k == 'mesh_anim':
        a.v['bounding_box'] = _bbox(a.v['bounding_box'], s)
        if len(a.matrices):
            m = np.array(a.matrices, dtype=np.float32).copy()
            m[:, 12:15] *= s
            a.matrices = m
        if len(a.keys):
            kk = np.array(a.keys, dtype=np.float32).copy()
            kk[:, 0:3] *= s
            a.keys = kk
        for md in a.meshes:
            _mesh_data(md, s)
    elif k == 'billboard_anim':
        a.v['bounding_box'] = _bbox(a.v['bounding_box'], s)
        if len(a.matrices):
            m = np.array(a.matrices, dtype=np.float32).copy()
            m[:, 12:15] *= s
            a.matrices = m
        for cl in a.clouds:
            cl.v['bounding_box'] = _bbox(cl.v['bounding_box'], s)
    elif k in ('particle_anim', 'speedline_anim'):
        if len(a.positions):
            a.positions = (np.asarray(a.positions, dtype=np.float32) * s).astype(np.float32)
