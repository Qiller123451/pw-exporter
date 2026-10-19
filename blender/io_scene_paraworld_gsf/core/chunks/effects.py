"""Effect chunks: billboard clouds (kind 1) and particle emitters (kind 2)."""
import numpy as np

from ..binio import GsfError
from ..schema import Field, Struct, is_skinned
from .. import vertex as vx
from .. import names
from .base import Chunk, register, key_of, NameBlock
from .common import head_fields, skin_fields, ATLAS_KEYS, u32_array, raw_writer, SKELETON_INDEX_DOC

# ------------------------------------------------------------------------------------------------------ billboards
BILLBOARD = Struct('billboard', head_fields() + [
    Field('transform', 'mat4', 'Placement in the model (Direct3D row-major matrix).', xform=True),
    Field('material', 'u32', "Index into the model's used materials (the sprite atlas)."),
    Field('tile_last', 'u8', 'Number of atlas cells used - 1.'),
    Field('tile_start', 'u8', 'First atlas cell (numbered row by row).'),
    Field('tiles_h_log2', 'u8', 'log2 of the number of atlas rows.'),
    Field('tiles_w_log2', 'u8', 'log2 of the number of atlas columns.'),
    Field('dimm_var', 'u8', 'Brightness variation, percent.'),
    Field('color_var', 'u8', 'Colour variation, percent.'),
    Field('base_light', 'u8', 'Base light 0-255.'),
    Field('dimm_scale', 'u8', 'Dimming scale, percent.'),
    Field('size', 'f32', 'Sprite size. The game draws a sprite a quarter of this high.', default=1.0),
    Field('size_var', 'u8', 'Size variation, percent.'),
    Field('mid_y', 'u8', 'Pivot y.', default=127),
    Field('mid_x', 'u8', 'Pivot x.', default=127),
    Field('flags', 'u8', '0x01 no waving in the wind, 0x02 has a light volume.'),
    Field('randomize', 'f32', 'Randomisation.'),
    Field('tile_border_width', 'u8', 'TileLimitR - TileLimitL (255 = the whole cell).', default=255),
    Field('tile_border_left', 'u8', 'TileLimitL.'),
    Field('light_volume_chunk', 'u16', "Index of the model's light volume chunk that shades the sprites; "
          '0xFFFF = none. Kept pointing at the same chunk when chunks are reordered.', derived=True, default=0xFFFF),
    Field('skeleton_index', 'u32', SKELETON_INDEX_DOC, when=is_skinned, derived=True),
    Field('bounding_box', 'bbox', 'The box the sprite positions are quantised in.', derived=True),
    Field('num_vertices', 'u32', derived=True),
    Field('ptr_vertices', 'ptr'),
    Field('vertex_size', 'u32', 'Bytes per sprite: 5, or 13 when skinned.', default=5),
])


@register
class BillboardChunk(Chunk):
    """A cloud of camera-facing sprites ("BillCloud": tree foliage, bushes, flowers, small effects). Every vertex is
    the centre of one sprite."""
    KIND = 'billboard'
    LABEL = 'Billboard cloud'
    TYPE_IDS = {0x00000001: {'skinned': False}, 0x80000001: {'skinned': True}}
    STRUCT = BILLBOARD
    GROUP = 9
    REFS = {'light_volume_chunk': 0xFFFF, 'skeleton_index': -1}

    def __init__(self, type_id=None, values=None):
        super().__init__(type_id, values)
        if self.ctx['skinned']:
            self.v['vertex_size'] = 13
        self.raw = np.zeros((0, self.v['vertex_size']), dtype=np.uint8)

    def read_payload(self, r, ptrs, end):
        n, stride = self.v['num_vertices'], self.v['vertex_size']
        if n and ptrs['ptr_vertices'] is not None:
            if not 5 <= stride <= 64:
                raise GsfError('billboard at 0x%x: vertex size %d' % (self.offset, stride))
            self.raw = vx.as_raw(r.bytes(ptrs['ptr_vertices'], n * stride), n, stride)
        else:
            self.raw = np.zeros((0, stride), dtype=np.uint8)

    def prepare(self):
        self.v['num_vertices'] = len(self.raw)
        if len(self.raw) and self.raw.shape[1] != self.v['vertex_size']:
            raise GsfError('billboard: vertex data has %d bytes per vertex, vertex_size says %d'
                           % (self.raw.shape[1], self.v['vertex_size']))

    def payload_pointers(self, w):
        k = key_of(self, 'v') if len(self.raw) else None
        w.need(k, raw_writer(self.raw.tobytes()))
        return {'ptr_vertices': k}


# ---------------------------------------------------------------------------------------------- particle emitters
PARTICLE = Struct('particle', head_fields() + [
    Field('source_type', 'hex32', 'Particle source id in bits 0-30 (selects the script class CParticleSource_<id>; 3 '
          'for nearly every emitter, 0 for a few). Bit 31 = "mirage" (heat haze).', default=3),
    Field('pos', 'vec3', 'Position of the emitter.', xform=True),
    Field('rot', 'quat', 'Rotation of the emitter (Direct3D convention).', xform=True),
    Field('velocity', 'vec3', "The emitter's velocity vector (m_vVel; SEK's exporter called it scale). Source 3: "
          "x = radius of the disk the particles start on, z = start speed along the emitter's z axis (x 0.7); y is "
          'not read.'),
    Field('max_parts', 'u32', 'Maximum number of particles.', default=32),
] + skin_fields() + [
    Field('spread', 'f32', 'Source 3: tilts the start velocity outwards (radians); -pi/2 or less = no tilt.'),
    Field('ptr_particle_name', 'ptr'),
    Field('ptr_tiles', 'ptr'),
    Field('num_tiles', 'u32', derived=True),
    Field('ptr_params', 'ptr'),
    Field('num_params', 'u32', derived=True),
])


@register
class ParticleChunk(Chunk):
    """Particle emitter. The parameters belong to the particle source class (Particle.txt of SEK's tools)."""
    KIND = 'particle'
    LABEL = 'Particle emitter'
    TYPE_IDS = {0x00000002: {'skinned': False}, 0x80000002: {'skinned': True}}
    STRUCT = PARTICLE
    GROUP = 2
    REFS = {'skeleton_index': -1}

    def __init__(self, type_id=None, values=None):
        super().__init__(type_id, values)
        self.name = ''            # name of the emitter in the source scene
        self.has_name = True      # some emitters have no name block at all
        self.name_length = -1     # stored length (-1 in emitters)
        self.name_capacity = None
        self.tiles = []           # list of dicts (atlas_fields keys), "TextureInfo" records
        self.params = []          # raw u32 values; see names.particle_param_spec for their meaning

    def read_payload(self, r, ptrs, end):
        pn = ptrs['ptr_particle_name']
        self.has_name = pn is not None
        if pn is not None:
            self.name, self.name_length, _, self.name_capacity = NameBlock.read(r, pn)
        pt = ptrs['ptr_tiles']
        self.tiles = []
        if pt is not None:
            for k in range(self.v['num_tiles']):
                self.tiles.append(dict(zip(ATLAS_KEYS, r.bytes(pt + 9 * k, 9))))
        self.params = [int(x) for x in u32_array(r, ptrs['ptr_params'], self.v['num_params'])]

    def prepare(self):
        self.v['num_tiles'] = len(self.tiles)
        self.v['num_params'] = len(self.params)

    def payload_pointers(self, w):
        kn = key_of(self, 'n') if self.has_name else None
        kt = key_of(self, 't') if self.tiles else None
        kp = key_of(self, 'p') if self.params else None
        w.need(kn, lambda w: NameBlock.write(w, self.name, self.name_length, self.name_capacity))
        w.need(kt, lambda w: w.raw(b''.join(bytes(int(t.get(k, 0)) & 0xFF for k in ATLAS_KEYS) for t in self.tiles)))
        w.need(kp, raw_writer(np.array(self.params, dtype=np.int64).astype(np.uint32), '<u4'))
        return {'ptr_particle_name': kn, 'ptr_tiles': kt, 'ptr_params': kp}

    # typed access to the parameters
    def param(self, i):
        name, kind = names.particle_param_spec(self.v['source_type'], i)
        raw = self.params[i]
        if kind == 'f':
            return float(np.array([raw], dtype=np.uint32).view(np.float32)[0])
        return raw

    def set_param(self, i, value):
        name, kind = names.particle_param_spec(self.v['source_type'], i)
        if kind == 'f':
            self.params[i] = int(np.array([value], dtype=np.float32).view(np.uint32)[0])
        else:
            self.params[i] = int(value) & 0xFFFFFFFF
