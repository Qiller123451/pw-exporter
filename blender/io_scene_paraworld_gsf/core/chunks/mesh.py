"""Mesh and cloth chunks (kinds 0 and 9) and the mesh data block they share with mesh animations."""
import numpy as np

from ..binio import GsfError
from ..schema import Field, Struct
from .. import vertex as vx
from .base import Chunk, register, key_of
from .common import head_fields, f32_array, u16_array, raw_writer, SKELETON_INDEX_DOC

MESH_FLAGS_DOC = ('0x08 extended UV (10 bit texture coordinates, 9 byte vertices), 0x10 baked light (the vertices have '
                  'one more byte), 0x20 wrapped UV. 0x02 is set on nearly every mesh; 0x01, 0x04, 0x40, 0x80, 0x100 '
                  'are not understood (SEK\'s exporter also knows "camera normals", "sort alpha" and "bake skin").')

SUBMESH = Struct('submesh', [
    Field('bounding_box', 'bbox', 'Bounding box of this submesh (model units, before the chunk transform).', derived=True),
    Field('num_vertices', 'u32', derived=True),
    Field('num_triangles', 'u32', derived=True),
    Field('num_cloth_triples', 'u32', 'Number of cloth triples (cloth only).', when=lambda c: c.get('cloth'), derived=True),
    Field('ptr_vertices', 'ptr'),
    Field('ptr_triangles', 'ptr'),
    Field('num_triangles2', 'u32', 'Repeats num_triangles.', derived=True),
    Field('vertex_size', 'u32', 'Bytes per vertex: 8, 9 (extended UV or baked light), 16 (skinned), 17.',
          when=lambda c: not c.get('cloth')),
    Field('ptr_extra', 'ptr'),
    Field('num_extra', 'u32', derived=True),
    Field('cloth_vertex_size', 'u32', 'Bytes per vertex of a cloth: 8 or 16.', when=lambda c: c.get('cloth')),
])

MESH_DATA = Struct('mesh_data', [
    Field('bounding_box', 'bbox', 'The box the vertex positions are quantised in.', derived=True),
    Field('num_submeshes', 'u32', derived=True),
    Field('ptr_submeshes', 'ptr'),
    Field('num_submeshes2', 'u32', derived=True),
    Field('ptr_submesh_materials', 'ptr'),
    Field('num_submesh_materials', 'u32', derived=True),
])


class Submesh:
    """one material's part of a mesh"""

    def __init__(self, cloth=False):
        self.cloth = cloth
        self.v = SUBMESH.defaults({'cloth': cloth})
        self.v['vertex_size' if not cloth else 'cloth_vertex_size'] = 8
        self.raw = np.zeros((0, 8), dtype=np.uint8)     # vertex bytes (n, stride)
        self.tris = np.zeros((0, 3), dtype=np.uint16)
        self.tangents = None       # u16 per vertex on normal-mapped materials (not decoded; probably the tangent)
        self.cloth_triples = None  # (k, 3) vertex indices, cloth only (not understood)

    @property
    def stride(self):
        return self.v['cloth_vertex_size' if self.cloth else 'vertex_size']

    @stride.setter
    def stride(self, s):
        self.v['cloth_vertex_size' if self.cloth else 'vertex_size'] = int(s)

    @classmethod
    def read(cls, r, o, cloth):
        s = cls(cloth)
        vals, ptrs, _ = SUBMESH.read(r, o, {'cloth': cloth})
        s.v.update(vals)
        n, stride = vals['num_vertices'], s.stride
        if n and ptrs['ptr_vertices'] is not None:
            if not 5 <= stride <= 64:
                raise GsfError('submesh at 0x%x: vertex size %d' % (o, stride))
            s.raw = vx.as_raw(r.bytes(ptrs['ptr_vertices'], n * stride), n, stride)
        else:
            s.raw = np.zeros((0, max(stride, 1)), dtype=np.uint8)
        s.tris = u16_array(r, ptrs['ptr_triangles'], vals['num_triangles'], 3)
        if ptrs['ptr_extra'] is not None:
            if cloth:
                s.cloth_triples = u16_array(r, ptrs['ptr_extra'], vals['num_extra'], 3)
            else:
                s.tangents = u16_array(r, ptrs['ptr_extra'], vals['num_extra'])
        return s

    def prepare(self, mesh_bbox):
        self.v['num_vertices'] = len(self.raw)
        self.v['num_triangles'] = self.v['num_triangles2'] = len(self.tris)
        extra = self.cloth_triples if self.cloth else self.tangents
        self.v['num_extra'] = 0 if extra is None else len(extra)
        if self.cloth:
            self.v['num_cloth_triples'] = self.v['num_extra']
        if len(self.raw) and self.raw.shape[1] != self.stride:
            raise GsfError('submesh: vertex data has %d bytes per vertex, vertex_size says %d' % (self.raw.shape[1], self.stride))

    def write_head(self, w):
        extra = self.cloth_triples if self.cloth else self.tangents
        kv = key_of(self, 'v') if len(self.raw) else None
        kt = key_of(self, 't') if len(self.tris) else None
        ke = key_of(self, 'x') if extra is not None and len(extra) else None
        SUBMESH.write(w, self.v, {'ptr_vertices': kv, 'ptr_triangles': kt, 'ptr_extra': ke}, {'cloth': self.cloth})
        w.need(kv, raw_writer(self.raw.tobytes()))
        w.need(kt, raw_writer(self.tris, '<u2'))
        w.need(ke, raw_writer(extra, '<u2'))

    # convenience
    def decoded(self):
        return vx.decode_mesh(self.raw)


class MeshData:
    """bounding box + submeshes (44 bytes) - the body of a mesh chunk and one frame of a mesh animation"""

    def __init__(self, cloth=False):
        self.cloth = cloth
        self.v = MESH_DATA.defaults()
        self.submeshes = []
        self.submesh_materials = []     # per submesh: index into the model's material list

    @property
    def bbox(self):
        return self.v['bounding_box']

    @classmethod
    def read(cls, r, o, cloth=False):
        m = cls(cloth)
        vals, ptrs, _ = MESH_DATA.read(r, o)
        m.v.update(vals)
        sp = ptrs['ptr_submeshes']
        size = SUBMESH.size({'cloth': cloth})
        if sp is not None:
            m.submeshes = [Submesh.read(r, sp + size * k, cloth) for k in range(vals['num_submeshes'])]
        m.submesh_materials = [int(x) for x in u16_array(r, ptrs['ptr_submesh_materials'], vals['num_submesh_materials'])]
        return m

    def prepare(self):
        self.v['num_submeshes'] = self.v['num_submeshes2'] = len(self.submeshes)
        self.v['num_submesh_materials'] = len(self.submesh_materials)
        for s in self.submeshes:
            s.prepare(self.bbox)

    def write_head(self, w):
        self.prepare()
        ks = key_of(self, 's') if self.submeshes else None
        km = key_of(self, 'm') if self.submesh_materials else None
        MESH_DATA.write(w, self.v, {'ptr_submeshes': ks, 'ptr_submesh_materials': km})

        def subs(w):
            for s in self.submeshes:
                s.write_head(w)
        w.need(ks, subs)
        w.need(km, raw_writer(np.array(self.submesh_materials, dtype='<u2')))


def _cloth(c):
    return c.get('cloth', False)


def _not_cloth(c):
    return not c.get('cloth', False)


MESH = Struct('mesh_chunk', head_fields() + [
    Field('transform', 'mat4', 'Placement of the mesh in the model (Direct3D row-major matrix).', xform=True),
    Field('flags', 'hex32', MESH_FLAGS_DOC, default=0x02),
    Field('skeleton_index', 'u32', SKELETON_INDEX_DOC, when=lambda c: c['skin'] != 0, derived=True),
    Field('bone_ids', 'u8x4', 'Simple skinning: the bones the whole mesh hangs on (depth-first index, 255 = unused).',
          when=lambda c: c['skin'] == 2),
    Field('bone_weights', 'u8x4', 'Simple skinning: weights, 255 = 1.0.', when=lambda c: c['skin'] == 2,
          default=(255, 0, 0, 0)),
    Field('ptr_mesh', 'ptr'),
    Field('normal_light', 'hex32', 'Parameters of the baked vertex light ("NormalLight": method and three factors, '
          'packed); 0 = none. Also decides what the 9th / 17th vertex byte is: baked light when set, else the high '
          'bits of extended texture coordinates.', when=_not_cloth),
    # cloth data, 32 bytes
    Field('cloth_index', 'u32', 'Number of the cloth within the model (0, 1, 2 ...).', when=_cloth),
    Field('unk_ptr', 'ptr', when=_cloth),
    Field('unk_count', 'u32', 'Count belonging to an always-empty pointer.', when=_cloth),
    Field('ptr_points_a', 'ptr', when=_cloth),
    Field('num_points_a', 'u32', derived=True, when=_cloth),
    Field('ptr_points_b', 'ptr', when=_cloth),
    Field('num_points_b', 'u32', derived=True, when=_cloth),
    Field('unk_minus_one', 's32', '-1; 0, 1 or 3 on the cloths that have point lists.', when=_cloth, default=-1),
])


@register
class MeshChunk(Chunk):
    KIND = 'mesh'
    LABEL = 'Mesh'
    TYPE_IDS = {0x00000000: {'skin': 0, 'cloth': False, 'skinned': False},
                0x80000000: {'skin': 1, 'cloth': False, 'skinned': True},
                0x20000000: {'skin': 2, 'cloth': False, 'skinned': True},
                0x00000009: {'skin': 0, 'cloth': True, 'skinned': False},
                0x80000009: {'skin': 1, 'cloth': True, 'skinned': True},
                0x20000009: {'skin': 2, 'cloth': True, 'skinned': True}}
    STRUCT = MESH
    GROUP = 9
    REFS = {'skeleton_index': -1}

    def __init__(self, type_id=0, values=None):
        super().__init__(type_id, values)
        self.mesh = MeshData(self.is_cloth)
        self.points_a = None     # cloth: one vector per vertex (only six models; probably unquantised positions)
        self.points_b = None

    @property
    def is_cloth(self):
        return self.ctx['cloth']

    @property
    def skin(self):
        return self.ctx['skin']

    def group(self):
        return 5 if self.is_cloth else 9

    def read_payload(self, r, ptrs, end):
        mp = ptrs['ptr_mesh']
        if mp is None:
            raise GsfError('mesh chunk at 0x%x has no mesh data' % self.offset)
        self.mesh = MeshData.read(r, mp, self.is_cloth)
        if self.is_cloth:
            if ptrs.get('ptr_points_a') is not None:
                self.points_a = f32_array(r, ptrs['ptr_points_a'], self.v['num_points_a'], 3)
            if ptrs.get('ptr_points_b') is not None:
                self.points_b = f32_array(r, ptrs['ptr_points_b'], self.v['num_points_b'], 3)

    def prepare(self):
        if self.is_cloth:
            self.v['num_points_a'] = 0 if self.points_a is None else len(self.points_a)
            self.v['num_points_b'] = 0 if self.points_b is None else len(self.points_b)

    def payload_pointers(self, w):
        p = {'ptr_mesh': key_of(self.mesh, 'head')}
        if self.is_cloth:
            ka = key_of(self, 'pa') if self.points_a is not None and len(self.points_a) else None
            kb = key_of(self, 'pb') if self.points_b is not None and len(self.points_b) else None
            p.update(ptr_points_a=ka, ptr_points_b=kb, unk_ptr=None)
            self._cloth_keys = (ka, kb)
        return p

    def write_inline(self, w):
        w.label(key_of(self.mesh, 'head'))
        self.mesh.write_head(w)
        if self.is_cloth:
            ka, kb = self._cloth_keys
            w.need(ka, raw_writer(self.points_a, '<f4'))
            w.need(kb, raw_writer(self.points_b, '<f4'))

    @property
    def extended_uv(self):
        """flag 0x08: the 9th / 17th vertex byte holds the high bits of 10 bit texture coordinates"""
        return not self.is_cloth and bool(self.v.get('flags', 0) & 0x08)

    @property
    def baked_light(self):
        """flag 0x10: the 9th / 17th vertex byte is the baked ambient light (1..255)"""
        return not self.is_cloth and bool(self.v.get('flags', 0) & 0x10)

    def vertex_size(self):
        """bytes per vertex these flags call for (every game archive follows this)"""
        base = 16 if self.skin == 1 else 8
        return base + (1 if (not self.is_cloth and self.v.get('flags', 0) & 0x18) else 0)
