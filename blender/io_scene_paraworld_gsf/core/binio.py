"""Low level reading and writing of GSF data.

Every offset in a GSF archive (except the absolute offset of header 2) is a signed 32 bit value RELATIVE TO THE
POSITION OF THE FIELD ITSELF: target = field position + value. 0x80000000 means "none"; archives written by mod tools
also use 0 for "none" (0 would point at the field itself, which never makes sense).

Reader   - random access over the whole file, plus a memo so that a structure that several owners point to (an
           animation chunk shared by 50 models, a material list shared by a model and its animations) becomes ONE
           Python object.
Writer   - appends to a growing buffer. Pointers are written as placeholders that name a *key*; `label(key)` marks
           where the key's data starts. `resolve()` patches every placeholder at the end, so data can be written in
           any order and shared objects are written only once (`once(key)`).
"""
import struct

NULL = 0x80000000

_u8 = struct.Struct('<B')
_u16 = struct.Struct('<H')
_s16 = struct.Struct('<h')
_u32 = struct.Struct('<I')
_s32 = struct.Struct('<i')
_f32 = struct.Struct('<f')


class GsfError(Exception):
    """Raised for files that cannot be read or data that cannot be written."""


class Reader:
    def __init__(self, data):
        self.d = memoryview(data) if not isinstance(data, (bytes, bytearray)) else data
        self.size = len(data)
        self.memo = {}

    # -- scalars
    def u8(self, o): return self.d[o]
    def u16(self, o): return _u16.unpack_from(self.d, o)[0]
    def s16(self, o): return _s16.unpack_from(self.d, o)[0]
    def u32(self, o): return _u32.unpack_from(self.d, o)[0]
    def s32(self, o): return _s32.unpack_from(self.d, o)[0]
    def f32(self, o): return _f32.unpack_from(self.d, o)[0]

    def fs(self, o, n):
        return list(struct.unpack_from('<%df' % n, self.d, o))

    def bytes(self, o, n):
        if o < 0 or o + n > self.size:
            raise GsfError('read past the end of the file (%d bytes at 0x%x)' % (n, o))
        return bytes(self.d[o:o + n])

    def ptr(self, o):
        """absolute target of the self-relative offset at `o`, or None"""
        v = self.u32(o)
        if v == NULL or v == 0:
            return None
        t = o + _s32.unpack_from(self.d, o)[0]
        if t < 0 or t >= self.size:
            raise GsfError('offset at 0x%x points outside the file (0x%x)' % (o, t))
        return t

    def cstr(self, o, n):
        return bytes(self.d[o:o + n]).split(b'\0')[0].decode('latin-1')

    def lstr(self, o):
        """length-prefixed string of header 1 -> (text, next offset)"""
        n = self.u32(o)
        return self.cstr(o + 4, n), o + 4 + n

    def obj(self, key, offset, ctor):
        """memoised read: the same (kind, offset) always gives the same object"""
        k = (key, offset)
        v = self.memo.get(k)
        if v is None:
            v = ctor(self, offset)
            self.memo[k] = v
        return v


class Writer:
    def __init__(self):
        self.buf = bytearray()
        self.fix = []          # (position, key)
        self.labels = {}       # key -> position
        self.queue = []        # (key, writer function) still to be written
        self.queued = set()

    # -- deferred data: a structure writes its pointers, then asks for the data they point to with need(); flush()
    # writes everything asked for (first come, first written; a writer function may ask for more). Asking twice for
    # the same key writes it once - that is how shared data stays shared.
    def need(self, key, fn, align=4):
        if key is None or key in self.labels or key in self.queued:
            return key
        self.queued.add(key)
        self.queue.append((key, fn, align))
        return key

    def flush(self):
        i = 0
        while i < len(self.queue):
            key, fn, al = self.queue[i]
            i += 1
            if key in self.labels:
                continue
            self.align(al)
            self.label(key)
            fn(self)
        self.queue = []
        self.queued = set()

    def tell(self):
        return len(self.buf)

    def align(self, n=4):
        pad = (-len(self.buf)) % n
        if pad:
            self.buf += b'\0' * pad

    def pad_to(self, pos):
        if pos < len(self.buf):
            raise GsfError('pad_to: already past 0x%x' % pos)
        self.buf += b'\0' * (pos - len(self.buf))

    # -- scalars
    def u8(self, v): self.buf += _u8.pack(int(v) & 0xFF)
    def u16(self, v): self.buf += _u16.pack(int(v) & 0xFFFF)
    def s16(self, v): self.buf += _s16.pack(int(v))
    def u32(self, v): self.buf += _u32.pack(int(v) & 0xFFFFFFFF)
    def s32(self, v): self.buf += _s32.pack(int(v))
    def f32(self, v): self.buf += _f32.pack(float(v))

    def fs(self, vals):
        vals = [float(x) for x in vals]
        self.buf += struct.pack('<%df' % len(vals), *vals)

    def raw(self, b):
        self.buf += bytes(b)

    def cstr_fixed(self, s, n):
        b = (s or '').encode('latin-1', 'replace')[:n]
        self.buf += b + b'\0' * (n - len(b))

    def lstr(self, s):
        """header 1 string: u32 length (with the terminating zero) + text + zero"""
        b = (s or '').encode('latin-1', 'replace') + b'\0'
        self.u32(len(b))
        self.buf += b

    # -- pointers
    def ptr(self, key):
        """placeholder for a pointer to `key` (None = no target)"""
        if key is None:
            self.u32(NULL)
            return
        self.fix.append((len(self.buf), key))
        self.u32(0)

    def label(self, key):
        if key in self.labels:
            raise GsfError('label written twice: %r' % (key,))
        self.labels[key] = len(self.buf)

    def has(self, key):
        return key in self.labels

    def resolve(self):
        for pos, key in self.fix:
            t = self.labels.get(key)
            if t is None:
                raise GsfError('pointer to data that was never written: %r' % (key,))
            struct.pack_into('<i', self.buf, pos, t - pos)
        self.fix = []
        return bytes(self.buf)
