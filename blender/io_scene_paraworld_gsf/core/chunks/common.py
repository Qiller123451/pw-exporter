"""Field groups and helpers shared by several chunk types."""
import numpy as np

from ..schema import Field, ATTR_DOC, GUID_DOC, is_skinned


def head_fields():
    return [Field('attributes', 'attr', ATTR_DOC),
            Field('guid', 'hex32', GUID_DOC)]


SKELETON_INDEX_DOC = ("Index of the skeleton chunk in the model's chunk table (or of the cloth chunk that drives the "
                      'component). Kept pointing at the same chunk when chunks are reordered.')


def skin_fields(when=is_skinned):
    """skeleton index + the 4 bones the whole component hangs on"""
    return [Field('skeleton_index', 'u32', SKELETON_INDEX_DOC, when=when, derived=True),
            Field('bone_ids', 'u8x4', 'Bone indices in depth-first order of the skeleton, 255 = unused.', when=when),
            Field('bone_weights', 'u8x4', 'Bone weights, 255 = 1.0.', when=when, default=(255, 0, 0, 0))]


def atlas_fields(prefix=''):
    """TextureInfo of SEK's exporter: which cells of a texture atlas are used (9 bytes)"""
    p = prefix
    return [Field(p + 'material', 'u8', "Index into the model's used materials."),
            Field(p + 'tiles_w_log2', 'u8', 'log2 of the number of atlas columns.'),
            Field(p + 'tiles_h_log2', 'u8', 'log2 of the number of atlas rows.'),
            Field(p + 'tile_start', 'u8', 'First cell used (cells are numbered row by row).'),
            Field(p + 'tile_last', 'u8', 'Number of cells used - 1.'),
            Field(p + 'tile_border_width', 'u8', 'TileLimitR - TileLimitL (255 = the whole cell).'),
            Field(p + 'tile_border_left', 'u8', 'TileLimitL.'),
            Field(p + 'mid_x', 'u8', 'Pivot x + 127 (127 = centre).', default=127),
            Field(p + 'mid_y', 'u8', 'Pivot y + 127.', default=127)]


ATLAS_KEYS = [f.name for f in atlas_fields()]


def f32_array(r, o, n, width):
    if o is None or n == 0:
        return np.zeros((0, width), dtype=np.float32)
    return np.frombuffer(r.bytes(o, n * width * 4), dtype='<f4').reshape(n, width).copy()


def u16_array(r, o, n, width=1):
    if o is None or n == 0:
        return np.zeros((0, width) if width > 1 else 0, dtype=np.uint16)
    a = np.frombuffer(r.bytes(o, n * width * 2), dtype='<u2').copy()
    return a.reshape(n, width) if width > 1 else a


def u32_array(r, o, n):
    if o is None or n == 0:
        return np.zeros(0, dtype=np.uint32)
    return np.frombuffer(r.bytes(o, n * 4), dtype='<u4').copy()


def raw_writer(data, dtype=None):
    """writer function for a numpy array / bytes block"""
    def fn(w):
        if dtype is not None:
            w.raw(np.ascontiguousarray(data, dtype=dtype).tobytes())
        else:
            w.raw(bytes(data))
    return fn
