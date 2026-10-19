"""Chunk base classes and the chunk registry.

A model is a list of chunks (the "components" of SEK's 3ds Max exporter). The first u32 of a chunk is its type:
bits 0-7 the kind, 0x80000000 = skinned per vertex / bound to bones, 0x20000000 = the whole component is bound to one
bone set, 0x40000000 = animation data of that kind.

Adding a chunk type
-------------------
1. Write a subclass of `Chunk` (model chunks) or `AnimChunk` (animation chunks) in a new module of this package:
       TYPE_IDS   {type id: variant context}   e.g. {0x0B: {'skinned': False}, 0x8000000B: {'skinned': True}}
       KIND       short name used everywhere else ('link')
       STRUCT     schema.Struct of the fixed part that follows the type id
       read_payload(r, ptrs) / payload_pointers(w) for data the struct points to (optional)
2. Decorate it with @register.
3. Import the module in chunks/__init__.py.
The Blender add-on picks up the new struct's fields automatically (properties and panel); a converter that turns the
chunk into Blender objects can be added in blender/convert/ (see blender/convert/__init__.py).
"""
from ..binio import GsfError
from ..schema import Struct

CHUNK_CLASSES = {}     # type id -> class
ANIM_CLASSES = {}      # type id -> class
KINDS = {}             # kind -> class


def register(cls):
    table = ANIM_CLASSES if cls.IS_ANIM else CHUNK_CLASSES
    for t in cls.TYPE_IDS:
        if t in table:
            raise ValueError('chunk type 0x%08X registered twice' % t)
        table[t] = cls
    KINDS[cls.KIND] = cls
    return cls


def key_of(obj, tag=''):
    """writer key of a Python object (its identity) and an optional sub-part"""
    return ('o', id(obj), tag)


class Chunk:
    IS_ANIM = False
    KIND = 'chunk'
    LABEL = 'Chunk'
    TYPE_IDS = {}
    STRUCT = Struct('chunk', [])
    # fields that hold the index of another chunk of the model: {field: (value meaning "none", kind)}. The model
    # turns them into object references after reading (self.refs) and back into indices when writing, so they stay
    # right when chunks are added, removed or reordered.
    REFS = {}
    # order group in the model's chunk table (the exporter sorted chunks this way; the model info stores the first
    # index and count of some groups, so they must stay together)
    GROUP = 9

    def __init__(self, type_id=None, values=None):
        if type_id is None:
            type_id = next(iter(self.TYPE_IDS))
        if type_id not in self.TYPE_IDS:
            raise GsfError('%s cannot have type 0x%08X' % (type(self).__name__, type_id))
        self.type_id = type_id
        self.v = self.STRUCT.defaults(self.ctx)
        if values:
            self.v.update(values)
        self.offset = None        # where it was read from (information only)
        self.refs = {}            # REFS field -> referenced chunk object (or None)

    # variant context: {'skinned': ...} etc. - selects the optional fields
    @property
    def ctx(self):
        return self.TYPE_IDS[self.type_id]

    def set_type(self, type_id):
        """switch variant (e.g. static <-> skinned) keeping the common values"""
        old = self.v
        self.type_id = type_id
        self.v = self.STRUCT.defaults(self.ctx)
        self.v.update({k: x for k, x in old.items() if k in self.v})

    def group(self):
        return self.GROUP

    @property
    def guid(self):
        return self.v.get('guid', 0)

    # ---------------------------------------------------------------- reading
    @classmethod
    def read(cls, r, o):
        t = r.u32(o)
        c = cls(t)
        c.offset = o
        vals, ptrs, end = cls.STRUCT.read(r, o + 4, c.ctx)
        c.v.update(vals)
        c.read_payload(r, ptrs, end)
        return c

    def read_payload(self, r, ptrs, end):
        """read what the struct's pointers point to"""

    # ---------------------------------------------------------------- writing
    def write(self, w):
        """called with the writer positioned (and labelled) at the chunk"""
        self.prepare()
        w.u32(self.type_id)
        ptrs = self.payload_pointers(w)
        self.STRUCT.write(w, self.v, ptrs, self.ctx)
        self.write_inline(w)

    def prepare(self):
        """recompute derived values before writing"""

    def payload_pointers(self, w):
        """-> {pointer field: writer key}; queue the data with w.need(key, fn)"""
        return {}

    def write_inline(self, w):
        """data that directly follows the struct (part of the chunk itself)"""

    def __repr__(self):
        return '<%s 0x%08X %08X>' % (type(self).__name__, self.type_id, self.guid)


class AnimChunk(Chunk):
    IS_ANIM = True
    KIND = 'anim'

    def frame_count(self):
        """number of frames the data covers (for the chunk_anim_ref frame count)"""
        return 0


class NameBlock:
    """Name as stored in header 2: [u32 1][u32 buffer size][s32 length][buffer]. The buffer grows in steps of 16
    bytes starting at 20 (20, 36, 52 ...) and is padded with zeros. Particle emitter names have length -1."""

    @staticmethod
    def read(r, o):
        n_strings = r.u32(o)
        cap = r.u32(o + 4)
        n = r.s32(o + 8)
        if cap > 0x10000:
            raise GsfError('name at 0x%x: buffer size %d' % (o, cap))
        return r.cstr(o + 12, cap), n, n_strings, cap

    @staticmethod
    def capacity(text):
        n = len(text.encode('latin-1', 'replace')) + 1
        cap = 20
        while cap < n:
            cap += 16
        return cap

    @staticmethod
    def write(w, text, length=None, capacity=None, n_strings=1):
        text = text or ''
        b = text.encode('latin-1', 'replace')
        cap = capacity if capacity and capacity > len(b) else NameBlock.capacity(text)
        w.u32(n_strings)
        w.u32(cap)
        w.s32(len(b) + 1 if length is None else length)
        w.raw(b + b'\0' * (cap - len(b)))
