"""A small Kaitai Struct interpreter, enough to check the toolkit's .ksy descriptions against real files without
the Kaitai compiler (Java). Supports what pwexport/data/ksy/*.ksy use: little endian integers and floats, str/strz
with size, raw bytes (size, size-eos), process: zlib, user types with parameters (incl. io), repeat expr/eos, if,
switch-on, enums, instances (pos, io, size, type, value), imports from the same folder.

    python tools/ksy_check.py pwexport/data/ksy/paraworld_ula.ksy map.ula [--dump PATH]
    python tools/ksy_check.py pwexport/data/ksy/paraworld_surf.ksy map.surf
Exits with 1 and the field path on the first parse error. Needs PyYAML (pip install pyyaml).
"""
import os
import re
import struct
import sys
import zlib

import yaml

BUILTIN = {'u1': '<B', 'u2': '<H', 'u4': '<I', 'u8': '<Q', 's1': '<b', 's2': '<h', 's4': '<i', 's8': '<q',
           'f4': '<f', 'f8': '<d'}


class KsyError(Exception):
    pass


class Stream:
    def __init__(self, data):
        self.data, self.pos = data, 0

    @property
    def size(self):
        return len(self.data)

    @property
    def eof(self):
        return self.pos >= len(self.data)

    def read(self, n):
        if n < 0 or self.pos + n > len(self.data):
            raise KsyError('read of %d bytes at %d past the end (%d)' % (n, self.pos, len(self.data)))
        b = self.data[self.pos:self.pos + n]
        self.pos += n
        return b


class Obj:
    """a parsed structure; attribute access resolves lazy instances"""
    def __init__(self, spec, io, parent, root, params, path):
        self._spec, self._io, self._parent, self._root, self._params, self._path = spec, io, parent, root, params, path
        self._fields = {}
        self._inst_cache = {}

    def __getattr__(self, name):
        if name.startswith('__'):
            raise AttributeError(name)
        if name in self._params:
            return self._params[name]
        if name in self._fields:
            return self._fields[name]
        insts = self._spec.get('instances') or {}
        if name in insts:
            if name not in self._inst_cache:
                self._inst_cache[name] = self._schema.instance(self, name, insts[name])
            return self._inst_cache[name]
        if name in ('_root', '_parent', '_io'):
            return object.__getattribute__(self, name)
        return None          # a field skipped by "if"

    def to_plain(self, depth=0, limit=6):
        if depth > limit:
            return '...'
        out = {}
        for k, v in self._fields.items():
            out[k] = plain(v, depth, limit)
        return out


def plain(v, depth=0, limit=6):
    if isinstance(v, Obj):
        return v.to_plain(depth + 1, limit)
    if isinstance(v, list):
        return [plain(x, depth, limit) for x in v[:20]] + (['... %d more' % (len(v) - 20)] if len(v) > 20 else [])
    if isinstance(v, (bytes, bytearray)):
        return '<%d bytes>' % len(v)
    return v


class Schema:
    def __init__(self, path, loaded=None):
        with open(path, encoding='utf-8') as f:
            self.y = yaml.safe_load(f)
        self.dir = os.path.dirname(path)
        self.id = self.y['meta']['id']
        self.types = dict(self.y.get('types') or {})
        self.enums = dict(self.y.get('enums') or {})
        loaded = loaded if loaded is not None else {}
        loaded[self.id] = self
        self.imports = {}
        for imp in self.y['meta'].get('imports') or []:
            if imp not in loaded:
                Schema(os.path.join(self.dir, imp + '.ksy'), loaded)
            self.imports[imp] = loaded[imp]

    # ---------------------------------------------------------------- expressions
    def ev(self, expr, obj, extra=None):
        if isinstance(expr, (int, float, bool)):
            return expr
        s = str(expr)
        # Kaitai -> Python
        s = re.sub(r'(?<![=!<>])!(?!=)', ' not ', s)
        names = {}

        class Scope(dict):
            def __missing__(self_, k):
                if extra and k in extra:
                    return extra[k]
                if k in ('true', 'false'):
                    return k == 'true'
                if k == '_root':
                    return obj._root
                if k == '_parent':
                    return obj._parent
                if k == '_io':
                    return obj._io
                return getattr(obj, k)
        try:
            return eval(s, {'__builtins__': {}}, Scope())      # noqa: S307 (local tool, trusted .ksy)
        except KsyError:
            raise
        except Exception as e:
            raise KsyError('expression %r: %s' % (expr, e))

    # ---------------------------------------------------------------- parsing
    def parse_type(self, tname, io, parent, root, path, args=()):
        if tname in self.imports:
            sch = self.imports[tname]
            return sch.parse_type(None, io, parent, None, path)
        spec = self.y if tname is None else self.types.get(tname)
        if spec is None:
            raise KsyError('%s: unknown type %s' % (path, tname))
        params = {}
        for p, a in zip(spec.get('params') or [], args):
            params[p['id']] = a
        o = Obj(spec, io, parent, root, params, path)
        o._schema = self
        if root is None:
            o._root = o
        for f in spec.get('seq') or []:
            self.field(o, f, path + '.' + f['id'])
        return o

    def field(self, o, f, path):
        if 'if' in f and not self.ev(f['if'], o):
            o._fields[f['id']] = None
            return
        rep = f.get('repeat')
        if rep == 'expr':
            n = self.ev(f['repeat-expr'], o)
            o._fields[f['id']] = vals = []
            for i in range(n):
                vals.append(self.one(o, f, o._io, '%s[%d]' % (path, i), {'_index': i}))
        elif rep == 'eos':
            o._fields[f['id']] = vals = []
            i = 0
            while not o._io.eof:
                vals.append(self.one(o, f, o._io, '%s[%d]' % (path, i), {'_index': i})); i += 1
        else:
            o._fields[f['id']] = self.one(o, f, o._io, path, {})

    def instance(self, o, name, f):
        path = o._path + '.' + name
        if 'if' in f and not self.ev(f['if'], o):
            return None
        if 'value' in f:
            return self.ev(f['value'], o)
        io = self.ev(f['io'], o) if 'io' in f else o._io
        save = io.pos
        if 'pos' in f:
            io.pos = self.ev(f['pos'], o)
        try:
            return self.one(o, f, io, path, {})
        finally:
            io.pos = save

    def one(self, o, f, io, path, extra):
        t = f.get('type')
        if isinstance(t, dict):                                  # switch-on
            key = self.ev(t['switch-on'], o, extra)
            sel = None
            for k, v in (t.get('cases') or {}).items():
                if self.ev(k, o, extra) == key:
                    sel = v
                    break
            if sel is None:
                sel = (t.get('cases') or {}).get('_')
            t = sel
        size = None
        if 'size' in f:
            size = self.ev(f['size'], o, extra)
        elif f.get('size-eos'):
            size = io.size - io.pos
        if 'contents' in f:
            want = bytes(f['contents']) if isinstance(f['contents'], list) else f['contents'].encode()
            got = io.read(len(want))
            if got != want:
                raise KsyError('%s: contents %r, expected %r' % (path, got, want))
            return got
        if t in BUILTIN:
            fmt = BUILTIN[t]
            v = struct.unpack(fmt, io.read(struct.calcsize(fmt)))[0]
            if 'enum' in f:
                en = self.enums.get(f['enum'], {})
                v = en.get(v, v)
            return v
        if t in ('str', 'strz'):
            raw = io.read(size)
            if t == 'strz':
                raw = raw.split(b'\0')[0]
            try:
                return raw.decode(f.get('encoding', 'ASCII').replace('ASCII', 'ascii'))
            except UnicodeDecodeError as e:
                raise KsyError('%s: %s' % (path, e))
        if size is not None:
            raw = io.read(size)
            if f.get('process') == 'zlib':
                try:
                    raw = zlib.decompress(raw)
                except zlib.error as e:
                    raise KsyError('%s: zlib: %s' % (path, e))
            if t is None:
                return raw
            sub = Stream(raw)
            return self.user(o, t, sub, path, extra)
        if t is None:
            raise KsyError('%s: no type and no size' % path)
        return self.user(o, t, io, path, extra)

    def user(self, o, t, io, path, extra):
        m = re.match(r'^(\w+)(?:\((.*)\))?$', t)
        name, args = m.group(1), m.group(2)
        argv = []
        if args:
            for a in split_args(args):
                argv.append(self.ev(a, o, extra))
        return self.parse_type(name, io, o, o._root, path, argv)


def split_args(s):
    out, depth, cur, q = [], 0, '', False
    for ch in s:
        if ch == '"':
            q = not q
        if ch == ',' and depth == 0 and not q:
            out.append(cur.strip()); cur = ''; continue
        if ch in '([':
            depth += 1
        if ch in ')]':
            depth -= 1
        cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def touch(o, depth=0):
    """evaluate every instance (lazy data) so their parse errors show up"""
    if isinstance(o, list):
        for x in o:
            touch(x, depth)
        return
    if not isinstance(o, Obj) or depth > 64:
        return
    for k in (o._spec.get('instances') or {}):
        v = getattr(o, k)
        o._fields['@' + k] = v
    for v in list(o._fields.values()):
        touch(v, depth + 1)


def check(ksy, data):
    sch = Schema(ksy)
    root = sch.parse_type(None, Stream(data), None, None, sch.id)
    touch(root)
    return root


if __name__ == '__main__':
    import json
    ksy, f = sys.argv[1], sys.argv[2]
    try:
        r = check(ksy, open(f, 'rb').read())
    except KsyError as e:
        print('FAIL', e)
        sys.exit(1)
    if '--dump' in sys.argv:
        print(json.dumps(plain(r, 0, 12), indent=1, default=str)[:20000])
    print('ok')
