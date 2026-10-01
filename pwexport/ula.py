"""ParaWorld map files (.ula): reader.

    m = Map.load('Data/Base/Maps/Base/Multiplayer/berg.ula')
    m.info            {'MapWidth': '2208', 'Setting': 'Jungle', ...}     level info key/values
    m.players         8 player slots (tribe, team, colour, start ...)
    m.description     {'LevelName': ..., 'Author': ..., 'Description': ...} (the editor's description tree, flattened)
    m.preview         200 x 200 RGBA preview picture (bytes) or None
    m.w, m.h          size in metres;  m.setting ('Jungle', 'Northland', ...);  m.water (water level, metres)
    m.heights         numpy float32 [hy, hx], metres, 2 m grid (row 0 = south edge, y grows north)
    m.mats            numpy uint8 [my, mx], ground material 0..7 of the setting, 4 m grid
    m.objects         [{'type', 'name', 'cls', 'gfx', 'x', 'y', 'z', 'rot', 'quat', 'owner', 'attr'}]
                      quat = the stored orientation (x, y, z, w). The engine applies it the Direct3D way (row vectors),
                      i.e. as the rotation of the conjugate quaternion in the usual maths convention - see world_quat().
                      rot = the heading as a counter-clockwise angle in map space (x east, y north) = -2 atan2(z, w).
                      Most objects only turn about the up axis; landscape pieces (plateaus, cliffs) are tilted too.
                      (Checked on the maps: harbours face the water, gates lie along their walls, plateau cliffs
                      reach into the ground only this way.)
    m.plants          [{'name', 'x', 'y', 'z', 'rot', 'quat'}]   landscape decoration instances (grass, ferns)
    m.surf            the unpacked SURF data (bytes);  m.chunks  {tag: Chunk}

The format (see docs/MAP_FORMAT.md and the Kaitai Struct descriptions pwexport/data/ksy/ula.ksy, surf.ksy):

    .ula   = u32 2, u32 unpacked size, u32 block count N, u32 crc32(first 12 bytes), u32 ?,
             N x {u32 unpacked size (<= 256 KB), u32 packed size, u32 1, u32 crc32(packed block)},
             N zlib streams back to back. Inflated and concatenated: one SURF chunk tree.
    tree   = node: char[4] tag, u32 end (offset after the node and its children), u16 flags, u16 child count,
                   [u32 version if flags & 2], [u32 data size if flags & 8], [u32 data offset if flags & 0x20],
                   then the children. Offsets are relative to the start of the tree ("SURF" or "UOF2").
    Objs   = u32 size + a "UOF2" tree: CMGR, HMGR, OBJS { obj { clss, base, data { gobj { gfx { name, Link }, fsm, attr,
             tmrs }, ... } } } - one "obj" per placed object.

Map coordinates: x east 0..w, y north 0..h, z up (metres).
"""
import codecs
import os
import struct
import zlib

import numpy as np

VERSION = '2026.10.2'     # bump when what the reader returns changes (cached map summaries)
SETTINGS = ['Northland', 'Savanna', 'Jungle', 'Icewaste', 'Ashvalley', 'TestSet', 'Cave1', 'Cave2', 'Cave3']


class FormatError(ValueError):
    pass


def _cp1252_fallback(err):
    """decode error handler: bytes that are not UTF-8 are read as Windows-1252 (maps mix both)"""
    bad = err.object[err.start:err.end]
    return bad.decode('cp1252', errors='replace'), err.end


codecs.register_error('pw_cp1252', _cp1252_fallback)


def text(raw):
    """a map string: UTF-8 where it is valid, Windows-1252 elsewhere; the editor's line breaks \\{br} -> newlines"""
    return raw.decode('utf-8', errors='pw_cp1252').replace('\\{br}', '\n')


# ---------------------------------------------------------------- container
def unpack(data):
    """the .ula container -> the SURF bytes"""
    if len(data) < 20:
        raise FormatError('file too short')
    ver, total, n = struct.unpack_from('<3I', data, 0)
    if n == 0 or n > 100000 or total > 1 << 31:
        raise FormatError('not a ParaWorld map file')
    o = 20 + 16 * n
    out = bytearray()
    for i in range(n):
        us, cs, _one, crc = struct.unpack_from('<4I', data, 20 + 16 * i)
        part = data[o:o + cs]
        if len(part) < cs:
            raise FormatError('truncated block %d' % i)
        out += zlib.decompress(part)
        o += cs
    if len(out) != total:
        raise FormatError('unpacked size %d, expected %d' % (len(out), total))
    return bytes(out)


def pack(surf, block=0x40000):
    """SURF bytes -> a .ula container (header crc and block crcs as the game writes them; the 5th header word,
    whose meaning is unknown, is written as 0)"""
    blocks = [surf[i:i + block] for i in range(0, len(surf), block)] or [b'']
    comp = [zlib.compress(b, 9) for b in blocks]
    head = struct.pack('<3I', 2, len(surf), len(blocks))
    table = b''.join(struct.pack('<4I', len(b), len(c), 1, zlib.crc32(c) & 0xffffffff) for b, c in zip(blocks, comp))
    return head + struct.pack('<2I', zlib.crc32(head) & 0xffffffff, 0) + table + b''.join(comp)


# ---------------------------------------------------------------- chunk trees (SURF, UOF2)
class Chunk:
    __slots__ = ('tag', 'flags', 'version', 'size', 'offset', 'children', 'data', 'pos')

    def __init__(self, tag, flags, version, size, offset, data, pos):
        self.tag, self.flags, self.version, self.size, self.offset = tag, flags, version, size, offset
        self.data, self.pos, self.children = data, pos, []

    def __repr__(self):
        return 'Chunk(%s, %d bytes, %d children)' % (self.tag, self.size or 0, len(self.children))

    def child(self, tag):
        return next((c for c in self.children if c.tag == tag), None)

    def all(self, tag):
        return [c for c in self.children if c.tag == tag]


def read_tree(buf, base=0):
    """parse the chunk tree that starts at buf[base:] -> root Chunk"""
    def node(o):
        tag = buf[base + o:base + o + 4].split(b'\0')[0].decode('latin1')
        end, flags, count = struct.unpack_from('<IHH', buf, base + o + 4)
        p = o + 12
        version = size = offset = None
        if flags & 2:
            version = struct.unpack_from('<I', buf, base + p)[0]; p += 4
        if flags & 8:
            size = struct.unpack_from('<I', buf, base + p)[0]; p += 4
        if flags & 0x20:
            offset = struct.unpack_from('<I', buf, base + p)[0]; p += 4
        data = buf[base + offset:base + offset + (size or 0)] if offset is not None else None
        c = Chunk(tag, flags, version, size, offset, data, o)
        for _ in range(count):
            ch, p = node(p)
            c.children.append(ch)
        return c, end
    return node(0)[0]


# ---------------------------------------------------------------- small readers
class _R:
    def __init__(self, b, o=0):
        self.b, self.o = b, o

    def u8(self):
        v = self.b[self.o]; self.o += 1; return v

    def u32(self):
        v = struct.unpack_from('<I', self.b, self.o)[0]; self.o += 4; return v

    def i32(self):
        v = struct.unpack_from('<i', self.b, self.o)[0]; self.o += 4; return v

    def f32(self, n=1):
        v = struct.unpack_from('<%df' % n, self.b, self.o); self.o += 4 * n; return v if n > 1 else v[0]

    def s(self):
        """u32 length (with the closing 0) + characters"""
        n = self.u32()
        raw = self.b[self.o:self.o + n].split(b'\0')[0]; self.o += n
        return text(raw)

    def kv(self):
        return {self.s(): self.s() for _ in range(self.u32())}


def _kvlist(r):
    out = {}
    for _ in range(r.u32()):
        k = r.s(); out[k] = r.s()
    return out


def level_info(b):
    """LInf: key/values, 8 slot numbers, 8 player slots, the 200 x 200 preview picture, the description tree"""
    r = _R(b)
    info = _kvlist(r)
    res = {'info': info, 'players': [], 'preview': None, 'description': {}}
    try:
        slots = [r.i32() for _ in range(8)]
        for i in range(8):
            p = _kvlist(r); p['slot'] = slots[i]; res['players'].append(p)
        r.u8()
        w, h, npix, nbytes, bpp = (r.u32() for _ in range(5))
        if w * h == npix and npix * bpp == nbytes and r.o + nbytes <= len(b):
            res['preview'] = dict(w=w, h=h, rgba=b[r.o:r.o + nbytes]); r.o += nbytes
        r.o += 16
        desc = {}

        def tree(prefix):
            n = r.u32(); name = r.s(); value = r.s()
            key = (prefix + '/' + name) if prefix else name
            if value:
                desc[key] = value
            for _ in range(n):
                tree(key)
        if r.o + 12 <= len(b):
            tree('')
        # "Root/Base/LevelName" -> also plain "LevelName" for the first occurrence
        for k, v in list(desc.items()):
            desc.setdefault(k.split('/')[-1], v)
        res['description'] = desc
    except (struct.error, IndexError, UnicodeDecodeError):
        pass
    return res


def terrain(b):
    r = _R(b)
    r.u32()
    w, h, bx, by, setting = (r.u32() for _ in range(5))
    water = r.f32()
    r.u32(); r.u8()
    hc = r.u32()
    if hc != bx * by * 256:
        raise FormatError('unexpected terrain size %d (%d x %d blocks)' % (hc, bx, by))
    raw = np.frombuffer(b, dtype='<u2', count=hc, offset=r.o).astype(np.float32) / 128.0
    r.o += 2 * hc
    # 16 x 16 blocks, blocks row by row, samples row by row inside a block
    heights = raw.reshape(by, bx, 16, 16).transpose(0, 2, 1, 3).reshape(by * 16, bx * 16)
    mc = r.u32()
    if mc == bx * by * 64:
        m = np.frombuffer(b, dtype=np.uint8, count=mc, offset=r.o)
        mats = m.reshape(by, bx, 8, 8).transpose(0, 2, 1, 3).reshape(by * 8, bx * 8).copy()
    else:
        mats = np.zeros((by * 8, bx * 8), np.uint8)
    return dict(w=w, h=h, bx=bx, by=by, setting=SETTINGS[setting] if setting < len(SETTINGS) else 'Jungle',
                water=water, heights=heights, mats=mats)


def plants(b):
    """IOMG: u32 ?, u32 blocks x, u32 blocks y, class names, per block u32 n + n x {f32 x y z, quaternion, u32 class}"""
    if not b or len(b) < 16:
        return []
    r = _R(b)
    r.u32(); r.u32(); r.u32()
    names = [r.s() for _ in range(r.u32())]
    out = []
    for _ in range(r.u32()):
        if r.o + 4 > len(b):
            break
        n = r.u32()
        a = np.frombuffer(b, dtype='<f4', count=n * 8, offset=r.o).reshape(n, 8)
        cls = np.frombuffer(b, dtype='<u4', count=n * 8, offset=r.o).reshape(n, 8)[:, 7]
        r.o += 32 * n
        for k in range(n):
            out.append({'name': names[cls[k]] if cls[k] < len(names) else '', 'x': float(a[k, 0]), 'y': float(a[k, 1]),
                        'z': float(a[k, 2]), 'rot': float(-2 * np.arctan2(a[k, 5], a[k, 6])),
                        'quat': [float(v) for v in a[k, 3:7]]})
    return out


def objects(b):
    """Objs: u32 size + UOF2 tree; one OBJS/obj per placed object"""
    if not b or len(b) < 24 or b[4:8] != b'UOF2':
        return []
    root = read_tree(b, 4)
    lst = root.child('OBJS')
    out = []
    for ob in (lst.children if lst else []):
        if ob.tag != 'obj':
            continue
        cl, base = ob.child('clss'), ob.child('base')
        if base is None or base.data is None or len(base.data) < 41:
            continue
        d = base.data
        r = _R(d, 8)
        owner = r.u8()
        x, y, z = r.f32(3)
        qx, qy, qz, qw = r.f32(4)
        name = r.s()
        o = {'type': d[:4].decode('latin1'), 'name': name, 'cls': _R(cl.data).s() if cl is not None and cl.data else name,
             'gfx': '', 'x': x, 'y': y, 'z': z, 'rot': float(-2 * np.arctan2(qz, qw)), 'quat': [qx, qy, qz, qw],
             'owner': None if owner == 0xff else owner, 'attr': {}}
        data = ob.child('data')
        gobj = data.child('gobj') if data else None
        if gobj is not None:
            gfx = gobj.child('gfx')
            nm = gfx.child('name') if gfx else None
            if nm is not None and nm.data:
                o['gfx'] = _R(nm.data).s()
            at = gobj.child('attr')
            if at is not None and at.data:
                try:
                    o['attr'] = _kvlist(_R(at.data))
                except (struct.error, IndexError):
                    pass
        out.append(o)
    return out


class Map:
    def __init__(self, surf, path=''):
        if surf[:4] != b'SURF':
            raise FormatError('not a ParaWorld map (no SURF data)')
        self.path, self.surf = path, surf
        self.root = read_tree(surf, 0)
        self.chunks = {}

        def collect(c):
            for ch in c.children:
                if ch.data is not None:
                    self.chunks.setdefault(ch.tag, ch)
                collect(ch)
        collect(self.root)
        li = level_info(self.chunks['LInf'].data) if 'LInf' in self.chunks else {'info': {}, 'players': [], 'preview': None, 'description': {}}
        self.info, self.players, self.preview, self.description = li['info'], li['players'], li['preview'], li['description']
        t = terrain(self.chunks['Terr'].data)
        self.w, self.h, self.water = t['w'], t['h'], t['water']
        self.heights, self.mats = t['heights'], t['mats']
        self.setting = self.info.get('Setting') if self.info.get('Setting') in SETTINGS else t['setting']
        self.objects = objects(self.chunks['Objs'].data) if 'Objs' in self.chunks else []
        self.plants = plants(self.chunks['IOMG'].data) if 'IOMG' in self.chunks else []
        base = os.path.splitext(os.path.basename(path))[0]
        self.name = self.description.get('LevelName') or self.info.get('LevelName') or self.info.get('MapName') or base
        self.max_players = sum(1 for o in self.objects if o['type'] == 'SLOC') or int(self.info.get('MaxPlayers') or 0) or 2

    @classmethod
    def load(cls, path):
        with open(path, 'rb') as f:
            return cls(unpack(f.read()), path)

    def height_at(self, x, y):
        """terrain height (metres) at map position x, y (bilinear)"""
        hy, hx = self.heights.shape
        fx = min(max(x / 2.0, 0), hx - 1.001); fy = min(max(y / 2.0, 0), hy - 1.001)
        i, j = int(fx), int(fy); u, v = fx - i, fy - j
        H = self.heights
        return float((H[j, i] * (1 - u) + H[j, i + 1] * u) * (1 - v) + (H[j + 1, i] * (1 - u) + H[j + 1, i + 1] * u) * v)

    def summary(self):
        counts = {}
        for o in self.objects:
            counts[o['type']] = counts.get(o['type'], 0) + 1
        return {'name': self.name, 'w': self.w, 'h': self.h, 'setting': self.setting, 'water': self.water,
                'players': self.max_players, 'objects': len(self.objects), 'plants': len(self.plants), 'types': counts,
                'author': self.description.get('Author', ''), 'description': self.description.get('Description', ''),
                'game_type': self.info.get('GameType', ''), 'chunks': sorted(self.chunks)}


def rotation_matrix(q):
    """3x3 matrix (column vectors, map space) of a stored quaternion as the engine applies it: the conjugate"""
    x, y, z, w = q
    n = (x * x + y * y + z * z + w * w) ** 0.5 or 1.0
    x, y, z, w = -x / n, -y / n, -z / n, w / n
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def preview_png(m, path):
    """the map's preview picture as a .png (None when the map has none)"""
    if not m.preview:
        return None
    from PIL import Image
    Image.frombytes('RGBA', (m.preview['w'], m.preview['h']), m.preview['rgba']).save(path)
    return path


def main(argv=None):
    """python -m pwexport.ula info|unpack|pack ..."""
    import argparse
    import json
    ap = argparse.ArgumentParser(prog='python -m pwexport.ula', description='ParaWorld map files (.ula)')
    sub = ap.add_subparsers(dest='cmd', required=True)
    a = sub.add_parser('info', help='print what a map contains'); a.add_argument('map')
    a = sub.add_parser('unpack', help='.ula -> the SURF data (open it with paraworld_surf.ksy)'); a.add_argument('map'); a.add_argument('out')
    a = sub.add_parser('pack', help='SURF data -> .ula'); a.add_argument('surf'); a.add_argument('out')
    a = sub.add_parser('objects', help='list the placed objects as JSON'); a.add_argument('map')
    args = ap.parse_args(argv)
    if args.cmd == 'info':
        print(json.dumps(Map.load(args.map).summary(), ensure_ascii=False, indent=1))
    elif args.cmd == 'unpack':
        with open(args.map, 'rb') as f:
            data = unpack(f.read())
        with open(args.out, 'wb') as f:
            f.write(data)
        print('%d bytes -> %s' % (len(data), args.out))
    elif args.cmd == 'pack':
        with open(args.surf, 'rb') as f:
            data = pack(f.read())
        with open(args.out, 'wb') as f:
            f.write(data)
        print('%d bytes -> %s' % (len(data), args.out))
    elif args.cmd == 'objects':
        print(json.dumps(Map.load(args.map).objects, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
