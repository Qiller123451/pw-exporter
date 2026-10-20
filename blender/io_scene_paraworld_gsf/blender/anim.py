"""Animation chunks <-> Blender actions.

bone animation      action on the armature: location / rotation_quaternion / scale per bone, GSF frame k = Blender
                    frame k (25 fps). The root track's velocity is kept as the custom property "gsf_velocity" of its
                    pose bone (animated). Track formats, flags and the track tree are kept in the action's GSF data.
mesh animation      action on the mesh object (its transform relative to the model root, one key per frame). Mesh
                    frames (vertex animation) are kept as meshes listed in the action's GSF data; which one shows at a
                    frame is the animated custom property "gsf_mesh_frame".
billboard animation like a mesh animation; "gsf_cloud_frame" selects the sprite cloud.
particle / speed line path   action on the empty: its location at every frame.
"""
import os

import bpy
import numpy as np
from mathutils import Matrix

from ..core.chunks import (BoneAnimChunk, Track, MeshAnimChunk, BillboardAnimChunk, BillboardCloud,
                           ParticleAnimChunk, SpeedlineAnimChunk)
from ..core.chunks.anims import TRACK_FORMATS, TRACK_CONSTANT, TRACK_NO_KEYS
from . import props as P
from . import compat
from . import bonemath as BM

FORMAT_ID = {v: ident for v, ident, _ in TRACK_FORMATS}
FORMAT_NUM = {ident: v for v, ident, _ in TRACK_FORMATS}


# ======================================================================================================= helpers
def _decompose(Ms):
    """(n,4,4) -> loc (n,3), quat wxyz (n,4), scale (n,3)"""
    loc = Ms[:, :3, 3].copy()
    M3 = Ms[:, :3, :3]
    s = np.linalg.norm(M3, axis=1)
    R = BM.orthonormal(M3, s)
    neg = np.linalg.det(R) < 0
    if neg.any():
        R[neg] = -R[neg]
        s[neg] = -s[neg]
    q = BM.continuous(BM.mat_to_quat_wxyz(R))
    return loc, q, s


def _key_channels(act, path_prefix, group, loc, quat, scale, frames, skip_rest=True):
    """one F-curve per channel; channels that never change get one key (or none when they hold the rest value) -
    the exporter samples the curves, so this loses nothing and keeps big archives small in memory"""
    def put(path, i, vals, default):
        vals = np.asarray(vals, dtype=np.float64)
        if len(vals) and np.ptp(vals) < 1e-7:
            if skip_rest and abs(vals[0] - default) < 1e-7:
                return
            compat.set_keys(compat.new_fcurve(act, path, i, group), frames[:1], vals[:1])
            return
        compat.set_keys(compat.new_fcurve(act, path, i, group), frames, vals)
    for i in range(3):
        put(path_prefix + 'location', i, loc[:, i], 0.0)
    for i in range(4):
        put(path_prefix + 'rotation_quaternion', i, quat[:, i], 1.0 if i == 0 else 0.0)
    for i in range(3):
        put(path_prefix + 'scale', i, scale[:, i], 1.0)


def _meta_common(act, a):
    g = act.gsf
    g.kind = a.KIND.upper()
    g.attributes = P.int_to_bits(a.v.get('attributes', 0))
    g.guid = P.hexs(a.v.get('guid', 0))
    P.to_props(getattr(g, 'p_' + a.KIND), a.STRUCT, a.v, a.KIND)


# ======================================================================================================= origin
def action_signature(act):
    """checksum of everything the export of an action depends on (keys, GSF data, frame meshes)"""
    import hashlib
    h = hashlib.md5()
    for fc in sorted(compat.fcurves(act), key=lambda f: (f.data_path, f.array_index)):
        h.update(('%s|%d|' % (fc.data_path, fc.array_index)).encode())
        n = len(fc.keyframe_points)
        if n:
            co = np.zeros(n * 2, dtype=np.float32)
            fc.keyframe_points.foreach_get('co', co)
            h.update(co.tobytes())
            ip = np.zeros(n, dtype=np.int32)
            fc.keyframe_points.foreach_get('interpolation', ip)
            h.update(ip.tobytes())
    g = act.gsf
    h.update(repr(_pg_values(g)).encode())
    for ref in g.frame_meshes:
        me = ref.mesh
        if me is None:
            continue
        co = np.zeros(len(me.vertices) * 3, dtype=np.float32)
        me.vertices.foreach_get('co', co)
        lv = np.zeros(len(me.loops), dtype=np.int32)
        me.loops.foreach_get('vertex_index', lv)
        h.update(co.tobytes() + lv.tobytes() + repr([m.name if m else '' for m in me.materials]).encode())
    return h.hexdigest()


def _pg_values(pg, depth=0):
    out = []
    if depth > 4:
        return out
    for p in pg.bl_rna.properties:
        k = p.identifier
        if k in ('rna_type', 'name') and depth or k in ('info_name', 'info_fourcc', 'rna_type'):
            continue
        v = getattr(pg, k)
        if p.type == 'POINTER':
            out.append((k, _pg_values(v, depth + 1) if isinstance(v, bpy.types.PropertyGroup) else getattr(v, 'name', None)))
        elif p.type == 'COLLECTION':
            out.append((k, [_pg_values(x, depth + 1) for x in v]))
        else:
            try:
                out.append((k, tuple(v) if hasattr(v, '__len__') and not isinstance(v, str) else v))
            except TypeError:
                out.append((k, str(v)))
    return out


def skeleton_rest(sk):
    """guids and rest placement of a skeleton, to tell whether an animation still fits it"""
    return ['%08X' % b.v['guid'] for b in sk.bones], [float(x) for b in sk.bones for x in tuple(b.v['pos']) + tuple(b.v['rot'])]


def mark_origin(imp, act, a, sk=None):
    act['gsf_source'] = os.path.abspath(imp.path) if imp.path else ''
    act['gsf_origin'] = int(a.offset or 0)
    if sk is not None:
        guids, rest = skeleton_rest(sk)
        act['gsf_skel_guids'] = ' '.join(guids)
        act['gsf_skel_rest'] = rest
    act['gsf_sig'] = action_signature(act)


def original_chunk(exp, act, skel=None):
    """the animation chunk an unchanged action came from (keeps the file's exact data and sharing)"""
    src = act.get('gsf_source')
    if not src or not exp.source_path or os.path.abspath(src) != os.path.abspath(exp.source_path):
        return None
    a = exp.archive.anim_by_offset.get(int(act.get('gsf_origin', -1)))
    if a is None or act.get('gsf_sig') != action_signature(act):
        return None
    if skel is not None:
        guids, rest = skeleton_rest(skel)
        if act.get('gsf_skel_guids') != ' '.join(guids):
            return None
        old = np.array(act.get('gsf_skel_rest', []), dtype=np.float64)
        new = np.array(rest, dtype=np.float64)
        if old.shape != new.shape:
            return None
        d = np.abs(old - new).reshape(-1, 7)
        dq = np.minimum(d[:, 3:], np.abs(old.reshape(-1, 7)[:, 3:] + new.reshape(-1, 7)[:, 3:]))
        if d[:, :3].max(initial=0) > 2e-3 or dq.max(initial=0) > 2e-3:
            return None
    return a


# ======================================================================================================= import
def import_anim(imp, a, chunk, obj, ctx, name):
    key = id(a)
    if a.KIND == 'bone_anim':
        arm = ctx['skeletons'].get(id(chunk))
        if arm is None:
            return None
        key = (id(a), arm['sk'].signature())
        if key in imp.action_cache:
            return imp.action_cache[key]
        act = import_bone_anim(imp, a, arm, name)
    else:
        key = (id(a), obj.name)
        if key in imp.action_cache:
            return imp.action_cache[key]
        if a.KIND == 'mesh_anim':
            act = import_mesh_anim(imp, a, chunk, obj, ctx, name)
        elif a.KIND == 'billboard_anim':
            act = import_billboard_anim(imp, a, chunk, obj, ctx, name)
        elif a.KIND in ('particle_anim', 'speedline_anim'):
            act = import_path_anim(imp, a, obj, name)
        else:
            return None
    if act is not None:
        mark_origin(imp, act, a, ctx['skeletons'][id(chunk)]['sk'] if a.KIND == 'bone_anim' else None)
    imp.action_cache[key] = act
    return act


def import_bone_anim(imp, a, arm, name):
    sk = arm['sk']
    names = arm['names']
    M = np.array(imp.space.S)
    nf = max(int(a.v['num_anim_frames']), 1)
    local = np.repeat(sk.local[:, None], nf, axis=1)        # (bones, frames, 4, 4)
    animated = set()
    act = compat.new_action(name, 'OBJECT')
    _meta_common(act, a)
    g = act.gsf
    g.frames = nf
    root = a.root
    tracks = list(root.walk())
    if root.bone != 255 and root.bone < sk.n:
        g.helper_bone = names[root.bone]
    g.root_format = FORMAT_ID.get(root.format, 'NONE')
    g.root_flags = root.v['flags']
    vel = None
    for t, parent in tracks:
        b = t.bone
        if b == 255:
            continue
        if b >= sk.n:
            imp.warnings.append('%s: track for bone %d, the skeleton has %d - ignored' % (name, b, sk.n))
            continue
        if parent is not None:
            it = g.tracks.add()
            it.bone = names[b]
            it.format = FORMAT_ID.get(t.format, 'NONE')
            it.flags = t.v['flags']
            it.parent = names[parent.bone] if parent.bone != 255 and parent.bone < sk.n else ''
        if t.v['flags'] & TRACK_NO_KEYS or not len(t.keys):
            continue
        is_root = parent is None
        local[b] = BM.track_locals(sk, b, t.format, t.constant, t.keys, nf, is_root)
        animated.add(b)
        if is_root and t.format in (0, 1) and not t.constant and t.keys.shape[1] >= 10:
            vel = np.array(t.keys[:nf, 7:10], dtype=np.float64)
    Brest = arm['B']
    frames = np.arange(nf, dtype=np.float64)
    for b in sorted(animated):
        # pose basis straight from the GSF local matrix (no inverse of animated matrices: a bone may scale to 0)
        basis = BM.local_to_basis(sk, Brest, b, local[b], M)
        loc, q, s = _decompose(basis)
        _key_channels(act, 'pose.bones["%s"].' % names[b], names[b], loc, q, s, frames)
    if vel is not None and g.helper_bone:
        v = vel * np.array(imp.space.s3)
        for i in range(3):
            compat.set_keys(compat.new_fcurve(act, 'pose.bones["%s"]["gsf_velocity"]' % g.helper_bone, i, g.helper_bone),
                            frames, v[:len(frames), i])
        pb = arm['obj'].pose.bones.get(g.helper_bone)
        if pb is not None and 'gsf_velocity' not in pb:
            pb['gsf_velocity'] = [0.0, 0.0, 0.0]
    return act


def _frame_meshes(imp, meshes, mats, base_name, obj, chunk):
    out = []
    for k, md in enumerate(meshes):
        slot_mats = [mats[i] if i < len(mats) else None for i in md.submesh_materials]
        me, _ = imp._mesh_from_data(md, '%s|frame%d' % (base_name, k), slot_mats, chunk, weld=imp.weld)
        me.use_fake_user = True
        out.append(me)
    return out


def import_mesh_anim(imp, a, chunk, obj, ctx, name):
    S = imp.space
    act = compat.new_action(name, 'OBJECT')
    _meta_common(act, a)
    g = act.gsf
    nf = a.frame_count()
    g.frames = nf
    frames = np.arange(nf, dtype=np.float64)
    if len(a.matrices):
        g.storage = 'MATRICES'
        Ms = np.array([np.array(S.matrix(m)) for m in a.matrices])
    elif len(a.keys) and len(a.key_index):
        g.storage = 'KEYS'
        idx = np.clip(a.key_index.astype(np.int64), 0, len(a.keys) - 1)
        Ms = np.array([np.array(S.loc_rot(a.keys[i][:3], a.keys[i][3:7])) for i in idx])
    else:
        g.storage = 'NONE'
        Ms = None
    obj.rotation_mode = 'QUATERNION'
    if Ms is not None and len(Ms):
        loc, q, s = _decompose(Ms)
        _key_channels(act, '', 'Object Transforms', loc, q, s, frames[:len(Ms)], skip_rest=False)
    mats = []
    if a.material_list is not None:
        g.has_material_list = True
        from .materials import to_blender
        for x in (a.material_list.materials or []):
            bm = to_blender(x, imp.finder, imp.mat_cache)
            mats.append(bm)
            g.materials.add().material = bm
    if a.meshes:
        for me in _frame_meshes(imp, a.meshes, mats, obj.name, obj, FrameFlags(a.v["flags"])):
            g.frame_meshes.add().mesh = me
        idx = a.mesh_index.astype(np.float64)
        compat.set_keys(compat.new_fcurve(act, '["gsf_mesh_frame"]', 0, 'Mesh frames'), np.arange(len(idx)), idx, 'CONSTANT')
        if 'gsf_mesh_frame' not in obj:
            obj['gsf_mesh_frame'] = -1
    return act


def import_billboard_anim(imp, a, chunk, obj, ctx, name):
    S = imp.space
    act = compat.new_action(name, 'OBJECT')
    _meta_common(act, a)
    g = act.gsf
    nf = a.frame_count()
    g.frames = nf
    g.storage = 'MATRICES' if len(a.matrices) else 'NONE'
    obj.rotation_mode = 'QUATERNION'
    if len(a.matrices):
        Ms = np.array([np.array(S.matrix(m)) for m in a.matrices])
        loc, q, s = _decompose(Ms)
        _key_channels(act, '', 'Object Transforms', loc, q, s, np.arange(len(Ms), dtype=np.float64), skip_rest=False)
    if a.material_list is not None:
        g.has_material_list = True
        from .materials import to_blender
        for x in (a.material_list.materials or []):
            g.materials.add().material = to_blender(x, imp.finder, imp.mat_cache)
    for k, cl in enumerate(a.clouds):
        me, _ = imp._points_mesh('%s|cloud%d' % (obj.name, k), cl.raw, cl.v['bounding_box'])
        me.use_fake_user = True
        me['gsf_vertex_size'] = cl.v['vertex_size']
        g.frame_meshes.add().mesh = me
    if len(a.cloud_index):
        compat.set_keys(compat.new_fcurve(act, '["gsf_cloud_frame"]', 0, 'Clouds'), np.arange(len(a.cloud_index)),
                        a.cloud_index.astype(np.float64), 'CONSTANT')
        if 'gsf_cloud_frame' not in obj:
            obj['gsf_cloud_frame'] = -1
    return act


def import_path_anim(imp, a, obj, name):
    act = compat.new_action(name, 'OBJECT')
    _meta_common(act, a)
    g = act.gsf
    pos = np.asarray(a.positions, dtype=np.float64) * np.array(imp.space.s3)
    g.frames = len(pos)
    fr = np.arange(len(pos), dtype=np.float64)
    for i in range(3):
        compat.set_keys(compat.new_fcurve(act, 'location', i, 'Path'), fr, pos[:, i])
    return act


# ======================================================================================================= export
class FrameFlags:
    """vertex layout of mesh animation frames (from the animation's mesh flags)"""

    def __init__(self, flags):
        self.extended_uv = bool(flags & 0x08)
        self.baked_light = bool(flags & 0x10)
        self._size = 8 + (1 if flags & 0x18 else 0)

    def vertex_size(self):
        return self._size


def _index_in(mats, bm):
    for i, m in enumerate(mats):
        if m is bm:
            return i
    mats.append(bm)
    return len(mats) - 1


class Curves:
    """evaluates an action's F-curves at whole frames"""

    def __init__(self, act):
        self.map = compat.fcurve_map(act) if act is not None else {}
        self.paths = {p for p, _ in self.map}

    def has(self, path):
        return path in self.paths

    def get(self, path, n, frames, default):
        out = np.tile(np.asarray(default, dtype=np.float64), (len(frames), 1))
        for i in range(n):
            fc = self.map.get((path, i))
            if fc is not None:
                out[:, i] = compat.sample(fc, frames)
        return out

    def get1(self, path, frames, default=0.0):
        fc = self.map.get((path, 0))
        if fc is None:
            return None
        return compat.sample(fc, frames)


def basis_matrices(cv, prefix, frames, rotation_mode='QUATERNION'):
    """(n,4,4) local transforms from location / rotation / scale curves"""
    loc = cv.get(prefix + 'location', 3, frames, (0, 0, 0))
    scale = cv.get(prefix + 'scale', 3, frames, (1, 1, 1))
    if rotation_mode == 'QUATERNION' or cv.has(prefix + 'rotation_quaternion'):
        q = cv.get(prefix + 'rotation_quaternion', 4, frames, (1, 0, 0, 0))
        R = BM.wxyz_to_mat(q)
    elif rotation_mode == 'AXIS_ANGLE':
        aa = cv.get(prefix + 'rotation_axis_angle', 4, frames, (0, 0, 1, 0))
        R = np.array([np.array(Matrix.Rotation(x[0], 3, x[1:4])) for x in aa])
    else:
        e = cv.get(prefix + 'rotation_euler', 3, frames, (0, 0, 0))
        from mathutils import Euler
        R = np.array([np.array(Euler(x, rotation_mode).to_matrix()) for x in e])
    return BM.trs(loc, R, scale)


def frame_count(act, default=1):
    g = act.gsf
    if g.frames > 0:
        return g.frames
    s, e = act.frame_range
    return max(int(round(e)) + 1, default)


def export_bone_anim(exp, act, arm_obj, skel_info, warn):
    """action on an armature -> BoneAnimChunk. skel_info: the exporter's skeleton data (dfs names, Skeleton)"""
    sk = skel_info['sk']
    names = skel_info['names']
    index = {n: i for i, n in enumerate(names)}
    M = np.array(exp.space.S)
    g = act.gsf
    nf = frame_count(act)
    frames = np.arange(nf, dtype=np.float64)
    cv = Curves(act)
    Brest = skel_info['B']
    # pose basis -> Blender bone matrices -> GSF world -> GSF local
    rot_modes = {pb.name: pb.rotation_mode for pb in arm_obj.pose.bones}
    animated = set()
    basis = np.repeat(np.eye(4)[None, None], sk.n, axis=0).repeat(nf, axis=1)
    for k, n in enumerate(names):
        pre = 'pose.bones["%s"].' % n
        if any(cv.has(pre + c) for c in ('location', 'rotation_quaternion', 'rotation_euler', 'rotation_axis_angle', 'scale')):
            basis[k] = basis_matrices(cv, pre, frames, rot_modes.get(n, 'QUATERNION'))
            animated.add(k)
    L = np.empty_like(basis)
    for k in range(sk.n):
        L[k] = BM.basis_to_local(sk, Brest, k, basis[k], M)
    # tracks: which bones, which format, tree
    meta = {t.bone: t for t in g.tracks if t.bone in index}
    helper = g.helper_bone if g.helper_bone in index else ''
    included = set(animated) | {index[n] for n in meta}
    if helper:
        included.add(index[helper])
    a = BoneAnimChunk()
    a.v['attributes'] = P.bits_to_int(g.attributes)
    a.v['guid'] = P.parse_hex(g.guid) if g.guid else (sk.bones[index[helper]].v['guid'] if helper else sk.bones[0].v['guid'])
    P.from_props(g.p_bone_anim, a.STRUCT, a.v, 'bone_anim')
    a.v['num_anim_frames'] = nf
    # root node
    if helper:
        hb = index[helper]
        rfmt = FORMAT_NUM.get(g.root_format, 0)
        if rfmt == 255:
            rfmt = 0
        root = Track(hb, rfmt, g.root_flags & ~TRACK_NO_KEYS)
        constant = bool(root.v['flags'] & TRACK_CONSTANT)
        if constant and np.abs(L[hb] - L[hb][:1]).max() > 1e-5:
            root.v['flags'] &= ~TRACK_CONSTANT
            constant = False
        keys, w = BM.local_to_keys(sk, hb, L[hb], rfmt, constant)
        warn.extend('%s: %s' % (act.name, x) for x in w)
        if rfmt in (0, 1) and not constant:
            vel = cv.get('pose.bones["%s"]["gsf_velocity"]' % helper, 3, frames, (0, 0, 0)) * np.array(exp.space.s3)
            keys[:, 7:10] = vel
        root.keys = keys
        a.v['flags'] = (a.v['flags'] | 0x80000000) & ~0x02
    else:
        root = Track(255, 255, 0)
        root.keys = np.zeros((0, 0), dtype=np.float32)
        a.v['flags'] = a.v['flags'] | 0x80000002
    # the other nodes: parent = the stored track parent, else the nearest included ancestor
    nodes = {}
    for k in sorted(included):
        if helper and k == index[helper]:
            continue
        m = meta.get(names[k])
        fmt = FORMAT_NUM.get(m.format, 2) if m is not None else BM.auto_format(sk, k, L[k])
        flags = m.flags if m is not None else 0
        t = Track(k, fmt, flags)
        if k not in animated and m is not None and m.flags & TRACK_NO_KEYS:
            t.keys = np.zeros((0, 4), dtype=np.float32)
        else:
            t.v['flags'] &= ~TRACK_NO_KEYS
            if fmt in (0, 1, 255):
                fmt = BM.auto_format(sk, k, L[k])
                t.v['format'] = fmt
            constant = bool(t.v['flags'] & TRACK_CONSTANT)
            if constant and np.abs(L[k] - L[k][:1]).max() > 1e-5:
                t.v['flags'] &= ~TRACK_CONSTANT
                constant = False
            if m is None and np.abs(L[k] - L[k][:1]).max() < 1e-7 and fmt == 2:
                t.v['flags'] |= TRACK_CONSTANT
                constant = True
            keys, w = BM.local_to_keys(sk, k, L[k], fmt, constant)
            warn.extend('%s: %s' % (act.name, x) for x in w)
            t.keys = keys
        nodes[k] = t
    for k in sorted(nodes):
        m = meta.get(names[k])
        parent = None
        if m is not None and m.parent in index and index[m.parent] in nodes and index[m.parent] != k:
            parent = nodes[index[m.parent]]
        elif m is not None and m.parent == helper and helper:
            parent = root
        else:
            x = sk.parent[k]
            while x >= 0 and x not in nodes and not (helper and x == index[helper]):
                x = sk.parent[x]
            if x >= 0 and x in nodes:
                parent = nodes[x]
            else:
                parent = root
        parent.children.append(nodes[k])
    a.root = root
    return a


def export_object_transforms(exp, act, obj):
    """per-frame matrices (n,4,4) of an object relative to the model root (Blender space), or None"""
    cv = Curves(act)
    if not any(cv.has(p) for p in ('location', 'rotation_quaternion', 'rotation_euler', 'scale', 'rotation_axis_angle')):
        return None
    nf = frame_count(act)
    frames = np.arange(nf, dtype=np.float64)
    basis = basis_matrices(cv, '', frames, obj.rotation_mode)
    # fill channels without curves from the rest placement
    rest = exp.rest_matrix(obj)
    loc, rot, sca = rest.decompose()
    for path, n, val in (('location', 3, loc), ('scale', 3, sca)):
        for i in range(n):
            if (path, i) not in cv.map:
                if path == 'location':
                    basis[:, i, 3] = val[i]
    PI = np.array(obj.matrix_parent_inverse)
    return PI[None] @ basis


def export_mesh_anim(exp, act, obj, chunk_obj_matrix, warn):
    g = act.gsf
    a = MeshAnimChunk()
    a.v['attributes'] = P.bits_to_int(g.attributes)
    a.v['guid'] = P.parse_hex(g.guid)
    P.from_props(g.p_mesh_anim, a.STRUCT, a.v, 'mesh_anim')
    nf = frame_count(act)
    Ms = export_object_transforms(exp, act, obj)
    S = exp.space
    if Ms is not None and g.storage != 'NONE':
        if g.storage == 'MATRICES':
            a.matrices = np.array([S.matrix_back(Matrix(m.tolist())) for m in Ms], dtype=np.float32)
        else:
            keys, index = [], []
            lookup = {}
            for m in Ms:
                Mm = Matrix(m.tolist())
                p = S.point_back(Mm.to_translation())
                q = S.quat_back(Mm.to_3x3().normalized())
                k = tuple(np.round(np.array(p + q, dtype=np.float32), 7))
                if k not in lookup:
                    lookup[k] = len(keys)
                    keys.append(list(p) + list(q))
                index.append(lookup[k])
            a.keys = np.array(keys, dtype=np.float32).reshape(-1, 7)
            a.key_index = np.array(index, dtype=np.uint16)
    cv = Curves(act)
    refs, slot = _valid_frames(g, act, warn)
    if refs:
        idx = cv.get1('["gsf_mesh_frame"]', np.arange(nf, dtype=np.float64))
        k = np.clip(np.rint(idx if idx is not None else np.zeros(nf)), 0, len(slot) - 1).astype(np.int64)
        a.mesh_index = slot[k].astype(np.uint16)
        mats = [m.material for m in g.materials]
        a.meshes = []
        ff = FrameFlags(a.v['flags'])
        for ref in refs:
            # frame meshes index the animation's own material list
            md, used = exp.mesh_data_from_mesh(ref.mesh, obj, list(ref.mesh.materials) or [None], chunk=ff, skin=None, warn=warn,
                                               material_index=lambda bm: _index_in(mats, bm),
                                               bbox_hint=ref.mesh.get('gsf_bbox'))
            a.meshes.append(md)
        a.material_list = exp.material_list_for(mats) if (g.has_material_list or mats) else None
    elif g.has_material_list:
        a.material_list = exp.material_list_for([m.material for m in g.materials])
    if not len(a.meshes) and not len(a.matrices) and not len(a.key_index):
        return None
    return a


def _valid_frames(g, act, warn):
    """frame mesh entries that have a mesh, and for every entry the one written in its place (an empty entry takes
    the mesh of the entry before it)"""
    refs, slot, last = [], [], 0
    for ref in g.frame_meshes:
        if ref.mesh is not None:
            last = len(refs)
            refs.append(ref)
        slot.append(last)
    if len(refs) < len(g.frame_meshes):
        warn('%s: %d frame mesh entries have no mesh - the frames that pick them show the mesh before them'
             % (act.name, len(g.frame_meshes) - len(refs)))
    return refs, np.array(slot, dtype=np.int64)


def export_billboard_anim(exp, act, obj, warn):
    g = act.gsf
    a = BillboardAnimChunk()
    a.v['attributes'] = P.bits_to_int(g.attributes)
    a.v['guid'] = P.parse_hex(g.guid)
    P.from_props(g.p_billboard_anim, a.STRUCT, a.v, 'billboard_anim')
    nf = frame_count(act)
    Ms = export_object_transforms(exp, act, obj)
    if Ms is not None and g.storage != 'NONE':
        a.matrices = np.array([exp.space.matrix_back(Matrix(m.tolist())) for m in Ms], dtype=np.float32)
    cv = Curves(act)
    refs, slot = _valid_frames(g, act, warn)
    for ref in refs:
        cl = BillboardCloud()
        cl.v['vertex_size'] = int(ref.mesh.get('gsf_vertex_size', 5))
        cl.raw, cl.v['bounding_box'] = exp.points_raw(ref.mesh, cl.v['vertex_size'], None)
        a.clouds.append(cl)
    if refs:
        idx = cv.get1('["gsf_cloud_frame"]', np.arange(nf, dtype=np.float64))
        k = np.clip(np.rint(idx if idx is not None else np.zeros(nf)), 0, len(slot) - 1).astype(np.int64)
        a.cloud_index = slot[k].astype(np.uint16)
    if g.has_material_list:
        a.material_list = exp.material_list_for([m.material for m in g.materials])
    return a


def export_path_anim(exp, act, obj, kind):
    g = act.gsf
    a = ParticleAnimChunk() if kind == 'particle_anim' else SpeedlineAnimChunk()
    a.v['attributes'] = P.bits_to_int(g.attributes)
    a.v['guid'] = P.parse_hex(g.guid)
    P.from_props(getattr(g, 'p_' + kind), a.STRUCT, a.v, kind)
    nf = frame_count(act)
    cv = Curves(act)
    rest = exp.rest_matrix(obj).to_translation()
    pos = cv.get('location', 3, np.arange(nf, dtype=np.float64), tuple(rest))
    a.positions = (pos * np.array(exp.space.s3)).astype(np.float32)
    return a
