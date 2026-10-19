"""Declarative description of the fixed-size part of GSF structures.

A structure is a list of `Field`s. The same list is used
  * to read and write the bytes (`Struct.read` / `Struct.write`),
  * by the Blender add-on to generate editable properties and panels for every parameter.

So adding or renaming a field in one place updates the reader, the writer and the user interface.

Field kinds
    u8 u16 s16 u32 s32 f32      plain numbers
    hex32                       u32 shown as hexadecimal text in the UI (GUIDs / CRCs, bit sets with the top bit set)
    attr                        u32 chunk attribute (visibility) bits - the UI shows named check boxes
    vec3 quat bbox mat4         3, 4, 6 and 16 floats
    u8x4                        four bytes (bone ids / weights)
    str4                        four characters, zero padded
    ptr                         self-relative offset; the owner reads / writes what it points to

Field flags
    derived   the value is recomputed when writing (counts, indices of other chunks ...). It is still read and kept,
              so it can be inspected, but editing it has no effect.
    xform     the value is the placement of the object in Blender (location / rotation); the add-on takes it from
              the object's transform instead of showing a separate property.
    unknown   meaning not understood; by convention such fields are named unk_*.
    when      callable(ctx) -> bool: the field only exists in some variants (skinned chunks ...).
"""
import struct

from .binio import GsfError

SIZES = {'u8': 1, 'u16': 2, 's16': 2, 'u32': 4, 's32': 4, 'hex32': 4, 'attr': 4, 'f32': 4,
         'vec3': 12, 'quat': 16, 'bbox': 24, 'mat4': 64, 'u8x4': 4, 'str4': 4, 'ptr': 4}

DEFAULTS = {'u8': 0, 'u16': 0, 's16': 0, 'u32': 0, 's32': 0, 'hex32': 0, 'attr': 0, 'f32': 0.0,
            'vec3': (0.0, 0.0, 0.0), 'quat': (0.0, 0.0, 0.0, 1.0), 'bbox': (0.0,) * 6,
            'mat4': (1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0), 'u8x4': (255, 255, 255, 255),
            'str4': '', 'ptr': None}


class Field:
    __slots__ = ('name', 'kind', 'doc', 'when', 'derived', 'xform', 'default', 'items', 'min', 'max', 'soft')

    def __init__(self, name, kind, doc='', when=None, derived=False, xform=False, default=None, items=None,
                 min=None, max=None, soft=None):
        if kind not in SIZES:
            raise ValueError('unknown field kind %r' % kind)
        self.name = name
        self.kind = kind
        self.doc = doc
        self.when = when
        self.derived = derived
        self.xform = xform
        self.default = DEFAULTS[kind] if default is None else default
        self.items = items        # for enumerations: [(value, identifier, description)]
        self.min = min
        self.max = max
        self.soft = soft          # (soft_min, soft_max)

    @property
    def unknown(self):
        return self.name.startswith('unk_')

    @property
    def editable(self):
        return not self.derived and self.kind != 'ptr'

    def present(self, ctx):
        return self.when is None or self.when(ctx)


def _read_value(r, o, kind):
    if kind == 'u8':
        return r.u8(o)
    if kind == 'u16':
        return r.u16(o)
    if kind == 's16':
        return r.s16(o)
    if kind in ('u32', 'hex32', 'attr'):
        return r.u32(o)
    if kind == 's32':
        return r.s32(o)
    if kind == 'f32':
        return r.f32(o)
    if kind == 'vec3':
        return tuple(r.fs(o, 3))
    if kind == 'quat':
        return tuple(r.fs(o, 4))
    if kind == 'bbox':
        return tuple(r.fs(o, 6))
    if kind == 'mat4':
        return tuple(r.fs(o, 16))
    if kind == 'u8x4':
        return tuple(r.bytes(o, 4))
    if kind == 'str4':
        return r.cstr(o, 4)
    if kind == 'ptr':
        return r.ptr(o)
    raise GsfError(kind)


def _write_value(w, kind, v):
    if kind == 'u8':
        w.u8(v)
    elif kind == 'u16':
        w.u16(v)
    elif kind == 's16':
        w.s16(v)
    elif kind in ('u32', 'hex32', 'attr'):
        w.u32(v)
    elif kind == 's32':
        w.s32(v)
    elif kind == 'f32':
        w.f32(v)
    elif kind in ('vec3', 'quat', 'bbox', 'mat4'):
        n = SIZES[kind] // 4
        v = list(v)
        if len(v) != n:
            raise GsfError('%s needs %d values, got %d' % (kind, n, len(v)))
        w.fs(v)
    elif kind == 'u8x4':
        v = list(v)
        w.raw(bytes(int(x) & 0xFF for x in (v + [255] * 4)[:4]))
    elif kind == 'str4':
        w.cstr_fixed(v, 4)
    else:
        raise GsfError(kind)


class Struct:
    """an ordered list of fields with byte-level read / write"""

    def __init__(self, name, fields):
        self.name = name
        self.fields = list(fields)
        self.by_name = {f.name: f for f in self.fields}

    def size(self, ctx=None):
        ctx = ctx or {}
        return sum(SIZES[f.kind] for f in self.fields if f.present(ctx))

    def read(self, r, o, ctx=None):
        """-> (values, pointers, end). pointers: name -> absolute target or None"""
        ctx = ctx or {}
        vals, ptrs = {}, {}
        for f in self.fields:
            if not f.present(ctx):
                continue
            if f.kind == 'ptr':
                ptrs[f.name] = r.ptr(o)
            else:
                vals[f.name] = _read_value(r, o, f.kind)
            o += SIZES[f.kind]
        return vals, ptrs, o

    def write(self, w, vals, ptrs=None, ctx=None):
        """write the fields; ptrs: name -> writer key (None = none)"""
        ctx = ctx or {}
        ptrs = ptrs or {}
        for f in self.fields:
            if not f.present(ctx):
                continue
            if f.kind == 'ptr':
                w.ptr(ptrs.get(f.name))
            else:
                v = vals.get(f.name, f.default)
                try:
                    _write_value(w, f.kind, v)
                except (struct.error, TypeError, ValueError) as e:
                    raise GsfError('%s.%s = %r: %s' % (self.name, f.name, v, e))

    def defaults(self, ctx=None):
        ctx = ctx or {}
        return {f.name: f.default for f in self.fields if f.kind != 'ptr' and f.present(ctx)}

    def editable_fields(self, ctx=None):
        return [f for f in self.fields if f.editable and (ctx is None or f.present(ctx))]


# shared helpers ---------------------------------------------------------------------------------------------------
def is_skinned(ctx):
    return bool(ctx.get('skinned'))


ATTR_DOC = ('Visibility bits ("Attrib" of SEK\'s exporter). Bits 0-4 = level-of-detail mask (bit k = drawn at '
            'detail level k); the meaning of bits 5-31 depends on the model\'s FourCC.')
GUID_DOC = 'CRC-32 of the component\'s name in the source scene (as written there, case kept).'

VOLUME_SHAPES = [(0, 'SPHERE', 'Sphere: pos = centre, size = (radius, radius squared, 0)'),
                 (1, 'BOX', 'Box: pos = lowest corner, size = extent in x, y, z'),
                 (2, 'TUBE', 'Tube: pos = bottom centre, size = (radius, 0, height)'),
                 (3, 'ELLIPSOID', 'Ellipsoid: pos = centre, size = radii')]
