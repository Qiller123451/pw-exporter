"""Skeleton chunk (kind 5).

Bones are 60 byte records; the children of a bone are stored next to each other and the bone points to the first.
Bone indices everywhere else (vertices, links, animation tracks, bind poses) count the bones in DEPTH-FIRST order.
Rest pose of a bone relative to its parent: T(pos) * R(conjugate of rot). The size of the rest scale is not part of
the bind pose, its sign is: a bone with scale (-1, -1, -1) is mirrored and its children inherit that.
"""
import numpy as np

from ..schema import Field, Struct
from .base import Chunk, register, key_of
from .common import head_fields, f32_array, raw_writer

BONE = Struct('bone', [
    Field('guid', 'hex32', 'CRC-32 of the bone\'s name ("root" = 0x16F4F95B). Names are not stored.'),
    Field('flags', 'hex32', '0, or 1 on a few bones (probably the "extended bone setup" of SEK\'s exporter).'),
    Field('pos', 'vec3', 'Rest position relative to the parent bone.', xform=True),
    Field('scale', 'vec3', 'Rest scale. Only its sign matters to the game (-1 -1 -1 = mirrored bone).', default=(1.0, 1.0, 1.0)),
    Field('rot', 'quat', 'Rest rotation relative to the parent (Direct3D convention).', xform=True),
    Field('num_children', 'u32', derived=True),
    Field('ptr_children', 'ptr'),
    Field('num_children2', 'u32', derived=True),
])

HEAD = Struct('skeleton_head', head_fields() + [
    Field('skeleton_index', 'u32', 'Index of this chunk in the model\'s chunk table (skeletons come first).', derived=True),
])
TAIL = Struct('skeleton_tail', [
    Field('ptr_bind_poses', 'ptr'),
    Field('num_all_bones', 'u32', derived=True),
    Field('num_all_bones2', 'u32', derived=True),
    Field('unk_zero', 'u32', 'Always 0.'),
])


class Bone:
    def __init__(self, values=None):
        self.v = BONE.defaults()
        if values:
            self.v.update(values)
        self.children = []

    @property
    def guid(self):
        return self.v['guid']

    @classmethod
    def read(cls, r, o, depth=0):
        b = cls()
        vals, ptrs, _ = BONE.read(r, o)
        b.v.update(vals)
        cp = ptrs['ptr_children']
        if cp is not None and depth < 256:
            b.children = [Bone.read(r, cp + 60 * k, depth + 1) for k in range(vals['num_children'])]
        return b

    def write(self, w):
        self.v['num_children'] = self.v['num_children2'] = len(self.children)
        kc = key_of(self, 'children') if self.children else None
        BONE.write(w, self.v, {'ptr_children': kc})

        def kids(w):
            for c in self.children:
                c.write(w)
        w.need(kc, kids)

    def walk(self, parent=None):
        """depth-first: (bone, parent)"""
        yield self, parent
        for c in self.children:
            yield from c.walk(self)


@register
class SkeletonChunk(Chunk):
    KIND = 'skeleton'
    LABEL = 'Skeleton'
    TYPE_IDS = {0x00000005: {}}
    STRUCT = Struct('skeleton', HEAD.fields + [Field('root', 'ptr')] + TAIL.fields)   # for documentation / UI only
    GROUP = 0

    def __init__(self, type_id=5, values=None):
        super().__init__(type_id, values)
        self.v.pop('root', None)
        self.root = Bone({'guid': 0x16F4F95B})
        self.bind_poses = np.zeros((0, 16), dtype=np.float32)   # inverse bind matrix per bone (depth-first order)

    @classmethod
    def read(cls, r, o):
        c = cls()
        c.offset = o
        vals, _, p = HEAD.read(r, o + 4)
        c.v.update(vals)
        c.root = Bone.read(r, p)
        vals, ptrs, _ = TAIL.read(r, p + 60)
        c.v.update(vals)
        c.bind_poses = f32_array(r, ptrs['ptr_bind_poses'], vals['num_all_bones'], 16)
        return c

    def bones(self):
        """depth-first list of (bone, parent index)"""
        out, index = [], {}
        for b, p in self.root.walk():
            index[id(b)] = len(out)
            out.append((b, -1 if p is None else index[id(p)]))
        return out

    def write(self, w):
        n = len(self.bones())
        self.v['num_all_bones'] = self.v['num_all_bones2'] = n
        w.u32(self.type_id)
        HEAD.write(w, self.v)
        self.root.write(w)
        kb = key_of(self, 'bind') if len(self.bind_poses) else None
        TAIL.write(w, self.v, {'ptr_bind_poses': kb})
        w.need(kb, raw_writer(self.bind_poses, '<f4'))
