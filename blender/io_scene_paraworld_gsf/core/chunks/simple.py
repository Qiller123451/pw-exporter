"""Small fixed-size chunks: links, light volumes, cloth collision volumes, speed lines and lights."""
from ..schema import Field, Struct, VOLUME_SHAPES
from .base import Chunk, register
from .common import head_fields, skin_fields, atlas_fields

LINK = Struct('link', head_fields() + [
    Field('pos', 'vec3', 'Position in model space (bind pose).', xform=True),
    Field('rot', 'quat', 'Rotation (Direct3D convention).', xform=True),
    Field('link_fourcc', 'str4', 'Name of the attachment point, up to 4 characters: HndR, HndL, Shld, Back, Ride, '
          'Dri1, Proj, Spwn, Ex_1, Bl_0-9, Cr_1-4, D_01-16, we, Db_1, Db_2 ...'),
] + skin_fields())


@register
class LinkChunk(Chunk):
    """Attachment point: where a weapon, rider, shield or effect is put, where workers stand, where units leave."""
    KIND = 'link'
    LABEL = 'Link'
    TYPE_IDS = {0x0000000B: {'skinned': False}, 0x8000000B: {'skinned': True}}
    STRUCT = LINK
    GROUP = 3
    REFS = {'skeleton_index': -1}


LIGHT_VOLUME = Struct('light_volume', head_fields() + [
    Field('shape', 'u32', 'Volume shape (ellipsoid in every shipped model).', items=VOLUME_SHAPES, default=3),
    Field('pos', 'vec3', 'Centre.', xform=True),
    Field('size', 'vec3', 'Radii (sphere: radius, radius squared, 0).', default=(1.0, 1.0, 1.0)),
] + skin_fields())


@register
class LightVolumeChunk(Chunk):
    """"LightVol": a sphere or ellipsoid that shades the billboards which refer to it (the crown of a tree)."""
    KIND = 'light_volume'
    LABEL = 'Light volume'
    TYPE_IDS = {0x0000000D: {'skinned': False}, 0x8000000D: {'skinned': True}}
    STRUCT = LIGHT_VOLUME
    GROUP = 4
    REFS = {'skeleton_index': -1}


PHYS_COLL = Struct('phys_coll', head_fields() + [
    Field('shape', 'u32', 'Volume shape (sphere or tube in the shipped models).', items=VOLUME_SHAPES),
    Field('pos', 'vec3', 'Centre / bottom centre.', xform=True),
    Field('size', 'vec3', 'Size (see shape).', default=(1.0, 1.0, 0.0)),
    Field('cloth_chunk_index', 's32', "Index of the cloth chunk in the model's chunk table, -1 = not assigned. "
          'Kept pointing at the same cloth when chunks are reordered.', derived=True, default=-1),
    Field('unk_flag', 'u32', '0 or 1.'),
] + skin_fields())


@register
class PhysCollChunk(Chunk):
    """Collision volume of a cloth ("PhysColl"): the cloth must not pass through it."""
    KIND = 'phys_coll'
    LABEL = 'Cloth collider'
    TYPE_IDS = {0x0000000A: {'skinned': False}, 0x8000000A: {'skinned': True}}
    STRUCT = PHYS_COLL
    GROUP = 1
    REFS = {'cloth_chunk_index': -1, 'skeleton_index': -1}


SPEEDLINE = Struct('speedline', head_fields() + [
    Field('pos', 'vec3', 'Position.', xform=True),
    Field('rot', 'quat', 'Rotation (Direct3D convention).', xform=True),
    Field('size', 'f32', 'Width of the trail.', default=1.0),
    Field('length', 'f32', 'Length of the trail.', default=1.0),
    Field('alpha', 'u8', '255 - the value set in the exporter (255 = opaque).', default=255),
] + atlas_fields('tile_') + skin_fields())


@register
class SpeedlineChunk(Chunk):
    """Trail drawn behind a moving point (weapon swings, projectiles). Its path comes from a speedline animation."""
    KIND = 'speedline'
    LABEL = 'Speed line'
    TYPE_IDS = {0x0000000E: {'skinned': False}, 0x8000000E: {'skinned': True}}
    STRUCT = SPEEDLINE
    GROUP = 9
    REFS = {'skeleton_index': -1}


LIGHT = Struct('light', head_fields() + [
    Field('pos', 'vec3', 'Position.', xform=True),
    Field('unk_0', 'hex32', 'Probably the diffuse colour (TGODLight m_dwD of SEK\'s exporter).'),
    Field('unk_1', 'hex32', 'Probably the ambient colour (m_dwA).'),
    Field('unk_2', 'hex32', 'Probably the specular colour (m_dwS).'),
    Field('unk_float', 'f32', 'Probably the range (m_fRange).'),
    Field('color', 'hex32', 'Colour (layout guessed from the only light in the game, aje_scarecrow).'),
])


@register
class LightChunk(Chunk):
    """Light source (kind 8). Only one model of the game has one."""
    KIND = 'light'
    LABEL = 'Light'
    TYPE_IDS = {0x00000008: {}}
    STRUCT = LIGHT
    GROUP = 9

