"""Materials (header 2 table) and material lists (the materials one model or animation uses)."""
import numpy as np

from .schema import Field, Struct
from .chunks.base import NameBlock, key_of
from .chunks.common import u32_array, raw_writer

MAT_ATTR1_DOC = ('Bits: 0x0001 alpha test (hard alpha), 0x0002 alpha blend (soft alpha), 0x0004 additive / self '
                 'illuminated, 0x0008 environment map, 0x0010 normal map, 0x0100 probably no z-write, 0x0200 probably '
                 'two sided, 0x1000 player colour (alpha masks the team colour), 0x4000 specular. Community table of '
                 'the low digit: 1 3 5 B D F hard alpha, 2 6 7 A E soft alpha, others alpha unused.')
MAT_ATTR2_DOC = 'Bits 0-3 specular / environment strength, bits 4-7 normal map strength, 0x100000 water shader.'

MATERIAL = Struct('material', [
    Field('attributes1', 'hex32', MAT_ATTR1_DOC),
    Field('attributes2', 'hex32', MAT_ATTR2_DOC),
    Field('ptr_texture_name', 'ptr'),
    Field('ptr_nm_name', 'ptr'),
    Field('ptr_env_name', 'ptr'),
    Field('unk_zero', 'u32', 'Always 0.'),
])


class Material:
    """24 bytes. Texture names are paths of .tga files below the Texture folder (the game loads
    <name>_(<size>).dds)."""

    def __init__(self, texture='', attributes1=0, attributes2=0):
        self.v = MATERIAL.defaults()
        self.v.update(attributes1=attributes1, attributes2=attributes2)
        self.texture = texture       # None = no name block
        self.normal_map = None
        self.env_map = None
        self.name_meta = {}          # per name: (stored length, buffer size) to write them back alike

    @classmethod
    def read(cls, r, o):
        m = cls()
        vals, ptrs, _ = MATERIAL.read(r, o)
        m.v.update(vals)
        for attr, p in (('texture', 'ptr_texture_name'), ('normal_map', 'ptr_nm_name'), ('env_map', 'ptr_env_name')):
            if ptrs[p] is not None:
                text, n, _, cap = NameBlock.read(r, ptrs[p])
                setattr(m, attr, text)
                m.name_meta[attr] = (n, cap)
            else:
                setattr(m, attr, None)
        return m

    def write(self, w):
        keys = {}
        for attr, p in (('texture', 'ptr_texture_name'), ('normal_map', 'ptr_nm_name'), ('env_map', 'ptr_env_name')):
            text = getattr(self, attr)
            if text is None:
                keys[p] = None
                continue
            k = keys[p] = key_of(self, attr)
            n, cap = self.name_meta.get(attr, (None, None))
            if n is not None and n != len(text.encode('latin-1', 'replace')) + 1:
                n = None
            w.need(k, (lambda t, n, c: lambda w: NameBlock.write(w, t, n, c))(text, n, cap))
        MATERIAL.write(w, self.v, keys)

    @staticmethod
    def write_empty(w):
        """unused record of the reserved table: zeros and three "none" offsets"""
        MATERIAL.write(w, MATERIAL.defaults(), {})

    def __repr__(self):
        return '<Material %s %08X/%08X>' % (self.texture, self.v['attributes1'], self.v['attributes2'])


MATERIAL_LIST = Struct('material_list', [
    Field('ptr_header2', 'ptr'),
    Field('ptr_materials_header', 'ptr'),
    Field('ptr_indices', 'ptr'),
    Field('num_used_materials', 'u32', derived=True),
    Field('unk_one', 'u32', 'Always 1.', default=1),
])


class MaterialList:
    """The materials one model (or one animation with mesh frames) uses. Submeshes, billboards and emitters index this
    list; its entries index the archive's material table. 20 bytes."""

    def __init__(self, indices=None):
        self.v = MATERIAL_LIST.defaults()
        self.indices = list(indices or [])     # indices into the archive's material table
        self.materials = None                  # resolved Material objects (set by the archive)

    @classmethod
    def read(cls, r, o):
        ml = cls()
        vals, ptrs, _ = MATERIAL_LIST.read(r, o)
        ml.v.update(vals)
        ml.indices = [int(x) for x in u32_array(r, ptrs['ptr_indices'], vals['num_used_materials'])]
        return ml

    def write(self, w):
        self.v['num_used_materials'] = len(self.indices)
        ki = key_of(self, 'i') if self.indices else None
        MATERIAL_LIST.write(w, self.v, {'ptr_header2': 'header2', 'ptr_materials_header': 'materials_header',
                                        'ptr_indices': ki})
        w.need(ki, raw_writer(np.array(self.indices, dtype=np.uint32), '<u4'))
