"""Animation chunks (type bit 0x40000000).

A model animation is a list with one entry per chunk of the model: a bone animation for a skeleton, a mesh
animation for a mesh, a particle path for an emitter ... Animation chunks are shared between models a lot.
Animations are made for 25 frames per second.
"""
import numpy as np

from ..binio import GsfError
from ..schema import Field, Struct
from .. import vertex as vx
from .base import AnimChunk, register, key_of
from .common import head_fields, f32_array, u16_array, raw_writer
from .mesh import MeshData, MESH_DATA

# ---------------------------------------------------------------------------------------------- bone animation
TRACK_FORMATS = [(0, 'ROOT', 'Root: rotation, position offset, velocity per frame (40 bytes)'),
                 (1, 'ROOT_SCALE', 'Root with scale (52 bytes)'),
                 (2, 'SIMPLE', 'Rotation only (16 bytes)'),
                 (3, 'TRANS', 'Rotation + stretch along the bone x axis (20 bytes)'),
                 (4, 'TRANS_SCALE', 'Rotation + stretch + scale (32 bytes)'),
                 (255, 'NONE', 'No data')]
KEY_FLOATS = {0: 10, 1: 13, 2: 4, 3: 5, 4: 8, 255: 0}
TRACK_CONSTANT = 0x01     # ONE key, and it is only a rotation (4 floats) whatever the format
TRACK_NO_KEYS = 0x02      # the bone is not animated; the node is only there for its children

TRACK = Struct('anim_track', [
    Field('bone', 'u8', 'Index of the bone in depth-first order.'),
    Field('format', 'u8', 'Key layout.', items=TRACK_FORMATS, default=2),
    Field('num_children', 'u8', derived=True),
    Field('flags', 'u8', '0x01 constant (one rotation key), 0x02 no keys (only there for its children).'),
    Field('ptr_keys', 'ptr'),
    Field('ptr_children', 'ptr'),
    Field('num_children2', 'u32', derived=True),
])


class Track:
    """One bone's keys. Local transform at a frame:
        T(rest pos [+ offset_x along x]) * R(conj rest rot) * R(conj key rot) [* S(scale)]
    Key layouts (floats): root = rot4 pos3 velocity3, root_scale = + scale3, simple = rot4, trans = rot4 offset_x,
    trans_scale = rot4 offset_x scale3. The root formats' position is an offset to the rest position."""

    def __init__(self, bone=0, fmt=2, flags=0):
        self.v = TRACK.defaults()
        self.v.update(bone=bone, format=fmt, flags=flags)
        self.keys = np.zeros((0, KEY_FLOATS.get(fmt, 0)), dtype=np.float32)
        self.children = []

    @property
    def bone(self):
        return self.v['bone']

    @property
    def format(self):
        return self.v['format']

    @property
    def constant(self):
        return bool(self.v['flags'] & TRACK_CONSTANT)

    def key_floats(self):
        if self.constant:
            return 4
        f = self.v['format']
        if f not in KEY_FLOATS:
            raise GsfError('unknown track format %d' % f)
        return KEY_FLOATS[f]

    @classmethod
    def read(cls, r, o, nframes, depth=0):
        t = cls()
        vals, ptrs, _ = TRACK.read(r, o)
        t.v.update(vals)
        nk = 1 if t.constant else nframes
        width = t.key_floats()
        t.keys = f32_array(r, ptrs['ptr_keys'], nk, width) if ptrs['ptr_keys'] is not None and width else \
            np.zeros((0, width), dtype=np.float32)
        cp = ptrs['ptr_children']
        if cp is not None and depth < 256:
            t.children = [Track.read(r, cp + 16 * k, nframes, depth + 1) for k in range(vals['num_children2'])]
        return t

    def write(self, w, nframes):
        self.v['num_children'] = self.v['num_children2'] = len(self.children)
        if len(self.children) > 255:
            raise GsfError('a track node can have at most 255 children')
        if len(self.keys):
            if self.keys.shape[1] != self.key_floats():
                raise GsfError('track of bone %d: keys have %d floats, format %d needs %d'
                               % (self.bone, self.keys.shape[1], self.format, self.key_floats()))
            want = 1 if self.constant else nframes
            if len(self.keys) != want:
                raise GsfError('track of bone %d: %d keys, expected %d' % (self.bone, len(self.keys), want))
        kk = key_of(self, 'k') if len(self.keys) else None
        kc = key_of(self, 'c') if self.children else None
        TRACK.write(w, self.v, {'ptr_keys': kk, 'ptr_children': kc})
        w.need(kk, raw_writer(self.keys, '<f4'))

        def kids(w):
            for c in self.children:
                c.write(w, nframes)
        w.need(kc, kids)

    def walk(self, parent=None):
        yield self, parent
        for c in self.children:
            yield from c.walk(self)


BONE_ANIM_HEAD = Struct('bone_anim_head', head_fields() + [
    Field('flags', 'hex32', '0x80000000 always (bone flags present), 0x01 loop marks, 0x02 dummy root (no root track), '
          '0x04 root height, 0x08 fixed root, 0x10 absolute root.', default=0x80000000),
    Field('loop_start_frame', 's16', 'First frame of the loop part (-1 without loop marks). The engine plays the start '
          'once, repeats loop_start .. loop_end and plays the end when the action stops.', default=-1),
    Field('loop_end_frame', 's16', 'Last frame of the loop part (-1 without loop marks).', default=-1),
    Field('root_height', 'f32', 'Height (z) of the root bone at the first frame; -1 without flag 0x04.', default=-1.0),
])
BONE_ANIM_TAIL = Struct('bone_anim_tail', [
    Field('num_anim_frames', 'u32', 'Number of frames (keys per non-constant track).'),
    Field('root_dist', 'vec3', 'Distance the root moves. For walk cycles y is the speed of the loop part in m/s.'),
])


@register
class BoneAnimChunk(AnimChunk):
    """Skeletal animation. `root` is the track of the bone that carries the whole motion (normally the skeleton
    root; e.g. the lamp of a lighthouse); its children are the tracks of the other animated bones, as a tree."""
    KIND = 'bone_anim'
    LABEL = 'Bone animation'
    TYPE_IDS = {0x40000005: {}}
    STRUCT = Struct('bone_anim', BONE_ANIM_HEAD.fields + [Field('root', 'ptr')] + BONE_ANIM_TAIL.fields)

    def __init__(self, type_id=0x40000005, values=None):
        super().__init__(type_id, values)
        self.v.pop('root', None)
        self.root = Track(0, 0)

    @classmethod
    def read(cls, r, o):
        c = cls()
        c.offset = o
        vals, _, p = BONE_ANIM_HEAD.read(r, o + 4)
        c.v.update(vals)
        tv, _, _ = BONE_ANIM_TAIL.read(r, p + 16)
        c.v.update(tv)
        c.root = Track.read(r, p, tv['num_anim_frames'])
        return c

    def write(self, w):
        w.u32(self.type_id)
        BONE_ANIM_HEAD.write(w, self.v)
        self.root.write(w, self.v['num_anim_frames'])
        BONE_ANIM_TAIL.write(w, self.v)

    def tracks(self):
        return list(self.root.walk())

    def frame_count(self):
        return self.v['num_anim_frames']


# ---------------------------------------------------------------------------------------------- mesh animation
MESH_ANIM = Struct('mesh_anim', head_fields() + [
    Field('bounding_box', 'bbox', 'Bounding box over all frames.'),
    Field('flags', 'hex32', 'Mesh flags of the frames: 0x08 extended UV, 0x20 wrapped UV.'),
    Field('num_meshes', 'u32', 'Number of mesh frames.', derived=True),
    Field('ptr_mesh_index', 'ptr'),
    Field('num_mesh_index', 'u32', derived=True),
    Field('ptr_matrices', 'ptr'),
    Field('num_matrices', 'u32', derived=True),
    Field('num_keys', 'u32', 'Number of position / rotation keys.', derived=True),
    Field('ptr_keys', 'ptr'),
    Field('num_keys2', 'u32', derived=True),
    Field('ptr_key_index', 'ptr'),
    Field('num_key_index', 'u32', derived=True),
    Field('ptr_meshes', 'ptr'),
    Field('num_meshes2', 'u32', derived=True),
    Field('ptr_material_list', 'ptr'),
])


@register
class MeshAnimChunk(AnimChunk):
    """Animation of one mesh chunk (doors, wheels, cranes, effects). Per frame the transform of the mesh - as
    `matrices` (Direct3D row-major), or as `keys` (position xyz + rotation xyzw, absolute, model space) plus
    `key_index` (which key each frame uses) - and optionally a different mesh per frame (`meshes` + `mesh_index`)."""
    KIND = 'mesh_anim'
    LABEL = 'Mesh animation'
    TYPE_IDS = {0x40000003: {}}
    STRUCT = MESH_ANIM

    def __init__(self, type_id=0x40000003, values=None):
        super().__init__(type_id, values)
        self.mesh_index = np.zeros(0, dtype=np.uint16)
        self.matrices = np.zeros((0, 16), dtype=np.float32)
        self.keys = np.zeros((0, 7), dtype=np.float32)
        self.key_index = np.zeros(0, dtype=np.uint16)
        self.meshes = []                 # MeshData per mesh frame
        self.material_list = None        # MaterialList of the mesh frames (shared with the animation info)

    def read_payload(self, r, ptrs, end):
        from ..materials import MaterialList
        v = self.v
        self.mesh_index = u16_array(r, ptrs['ptr_mesh_index'], v['num_mesh_index'])
        self.matrices = f32_array(r, ptrs['ptr_matrices'], v['num_matrices'], 16)
        self.keys = f32_array(r, ptrs['ptr_keys'], v['num_keys2'], 7)
        self.key_index = u16_array(r, ptrs['ptr_key_index'], v['num_key_index'])
        mp = ptrs['ptr_meshes']
        self.meshes = [MeshData.read(r, mp + MESH_DATA.size() * k) for k in range(v['num_meshes2'])] if mp is not None else []
        mlp = ptrs['ptr_material_list']
        self.material_list = r.obj('matlist', mlp, MaterialList.read) if mlp is not None else None

    def prepare(self):
        v = self.v
        v['num_meshes'] = v['num_meshes2'] = len(self.meshes)
        v['num_mesh_index'] = len(self.mesh_index)
        v['num_matrices'] = len(self.matrices)
        v['num_keys'] = v['num_keys2'] = len(self.keys)
        v['num_key_index'] = len(self.key_index)

    def payload_pointers(self, w):
        def k(arr, tag):
            return key_of(self, tag) if arr is not None and len(arr) else None
        p = {'ptr_mesh_index': k(self.mesh_index, 'mi'), 'ptr_matrices': k(self.matrices, 'mx'),
             'ptr_keys': k(self.keys, 'k'), 'ptr_key_index': k(self.key_index, 'ki'),
             'ptr_meshes': k(self.meshes, 'm'),
             'ptr_material_list': key_of(self.material_list) if self.material_list is not None else None}
        w.need(p['ptr_mesh_index'], raw_writer(self.mesh_index, '<u2'))
        w.need(p['ptr_matrices'], raw_writer(self.matrices, '<f4'))
        w.need(p['ptr_keys'], raw_writer(self.keys, '<f4'))
        w.need(p['ptr_key_index'], raw_writer(self.key_index, '<u2'))

        def meshes(w):
            for m in self.meshes:
                m.write_head(w)
        w.need(p['ptr_meshes'], meshes)
        if self.material_list is not None:
            w.need(p['ptr_material_list'], self.material_list.write)
        return p

    def frame_count(self):
        return max(len(self.matrices), len(self.key_index), len(self.mesh_index))


# ------------------------------------------------------------------------------------------ billboard animation
BILLBOARD_CLOUD = Struct('billboard_cloud', [
    Field('bounding_box', 'bbox', 'The box the sprite positions are quantised in.', derived=True),
    Field('num_vertices', 'u32', derived=True),
    Field('ptr_vertices', 'ptr'),
    Field('vertex_size', 'u32', 'Bytes per sprite (5 or 13).', default=5),
])


class BillboardCloud:
    """sprite positions of one frame of a billboard animation (36 bytes)"""

    def __init__(self):
        self.v = BILLBOARD_CLOUD.defaults()
        self.raw = np.zeros((0, 5), dtype=np.uint8)

    @classmethod
    def read(cls, r, o):
        c = cls()
        vals, ptrs, _ = BILLBOARD_CLOUD.read(r, o)
        c.v.update(vals)
        n, s = vals['num_vertices'], vals['vertex_size']
        if n and ptrs['ptr_vertices'] is not None:
            c.raw = vx.as_raw(r.bytes(ptrs['ptr_vertices'], n * s), n, s)
        else:
            c.raw = np.zeros((0, s), dtype=np.uint8)
        return c

    def write(self, w):
        self.v['num_vertices'] = len(self.raw)
        k = key_of(self, 'v') if len(self.raw) else None
        BILLBOARD_CLOUD.write(w, self.v, {'ptr_vertices': k})
        w.need(k, raw_writer(self.raw.tobytes()))


BILLBOARD_ANIM = Struct('billboard_anim', head_fields() + [
    Field('bounding_box', 'bbox', 'Bounding box over all frames.'),
    Field('num_clouds', 'u32', derived=True),
    Field('ptr_cloud_index', 'ptr'),
    Field('num_cloud_index', 'u32', derived=True),
    Field('ptr_matrices', 'ptr'),
    Field('num_matrices', 'u32', derived=True),
    Field('ptr_clouds', 'ptr'),
    Field('num_clouds2', 'u32', derived=True),
    Field('ptr_material_list', 'ptr'),
])


@register
class BillboardAnimChunk(AnimChunk):
    """Animation of a billboard chunk, built like a mesh animation: per frame a matrix and which cloud (sprite
    positions) is shown."""
    KIND = 'billboard_anim'
    LABEL = 'Billboard animation'
    TYPE_IDS = {0x40000001: {}}
    STRUCT = BILLBOARD_ANIM

    def __init__(self, type_id=0x40000001, values=None):
        super().__init__(type_id, values)
        self.cloud_index = np.zeros(0, dtype=np.uint16)
        self.matrices = np.zeros((0, 16), dtype=np.float32)
        self.clouds = []
        self.material_list = None

    def read_payload(self, r, ptrs, end):
        from ..materials import MaterialList
        v = self.v
        self.cloud_index = u16_array(r, ptrs['ptr_cloud_index'], v['num_cloud_index'])
        self.matrices = f32_array(r, ptrs['ptr_matrices'], v['num_matrices'], 16)
        cp = ptrs['ptr_clouds']
        self.clouds = [BillboardCloud.read(r, cp + 36 * k) for k in range(v['num_clouds2'])] if cp is not None else []
        mlp = ptrs['ptr_material_list']
        self.material_list = r.obj('matlist', mlp, MaterialList.read) if mlp is not None else None

    def prepare(self):
        v = self.v
        v['num_clouds'] = v['num_clouds2'] = len(self.clouds)
        v['num_cloud_index'] = len(self.cloud_index)
        v['num_matrices'] = len(self.matrices)

    def payload_pointers(self, w):
        p = {'ptr_cloud_index': key_of(self, 'ci') if len(self.cloud_index) else None,
             'ptr_matrices': key_of(self, 'mx') if len(self.matrices) else None,
             'ptr_clouds': key_of(self, 'c') if self.clouds else None,
             'ptr_material_list': key_of(self.material_list) if self.material_list is not None else None}
        w.need(p['ptr_cloud_index'], raw_writer(self.cloud_index, '<u2'))
        w.need(p['ptr_matrices'], raw_writer(self.matrices, '<f4'))

        def clouds(w):
            for c in self.clouds:
                c.write(w)
        w.need(p['ptr_clouds'], clouds)
        if self.material_list is not None:
            w.need(p['ptr_material_list'], self.material_list.write)
        return p

    def frame_count(self):
        return max(len(self.matrices), len(self.cloud_index))


# ----------------------------------------------------------------------------------------- particle / speed line paths
PARTICLE_ANIM = Struct('particle_anim', head_fields() + [
    Field('flags', 'hex32', '1 = positions.', default=1),
    Field('ptr_positions', 'ptr'),
    Field('num_positions', 'u32', derived=True),
])


@register
class ParticleAnimChunk(AnimChunk):
    """Path of a particle emitter: its position at every frame."""
    KIND = 'particle_anim'
    LABEL = 'Particle path'
    TYPE_IDS = {0x40000002: {}}
    STRUCT = PARTICLE_ANIM

    def __init__(self, type_id=None, values=None):
        super().__init__(type_id, values)
        self.positions = np.zeros((0, 3), dtype=np.float32)

    def read_payload(self, r, ptrs, end):
        self.positions = f32_array(r, ptrs['ptr_positions'], self.v['num_positions'], 3)

    def prepare(self):
        self.v['num_positions'] = len(self.positions)

    def payload_pointers(self, w):
        k = key_of(self, 'p') if len(self.positions) else None
        w.need(k, raw_writer(self.positions, '<f4'))
        return {'ptr_positions': k}

    def frame_count(self):
        return len(self.positions)


SPEEDLINE_ANIM = Struct('speedline_anim', head_fields() + [
    Field('ptr_positions', 'ptr'),
    Field('num_positions', 'u32', derived=True),
])


@register
class SpeedlineAnimChunk(ParticleAnimChunk):
    """Path of a speed line: its position at every frame."""
    KIND = 'speedline_anim'
    LABEL = 'Speed line path'
    TYPE_IDS = {0x4000000E: {}}
    STRUCT = SPEEDLINE_ANIM
