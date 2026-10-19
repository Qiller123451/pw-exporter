"""Lossless round trip of GSF archives through the core library.

    python tests/roundtrip.py <file.gsf | folder> ...

For every archive: read -> write -> read again, and compare everything that was read (all values, arrays, names,
table of contents, shared structures stay shared). Also reports the derived values that the writer recomputes and
that differ from the original file, and how big the rewritten file is.
"""
import glob
import hashlib
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from io_scene_paraworld_gsf.core import GsfArchive  # noqa: E402
from io_scene_paraworld_gsf.core.chunks.base import Chunk  # noqa: E402

SKIP_ATTRS = {'offset', 'refs', '_cloth_keys', 'name_meta', 'object_name_meta', 'name_capacity', 'num_entries',
              'materials', 'prune_anim_infos_keep', '_toc_end', 'warnings', 'anim_by_offset'}


class Canon:
    def __init__(self):
        self.ids = {}

    def __call__(self, x, depth=0):
        if depth > 400:
            return '<deep>'
        if x is None or isinstance(x, (bool, int, str)):
            return x
        if isinstance(x, float):
            return ('f', float(np.float32(x)).hex()) if x == x else ('f', 'nan')
        if isinstance(x, (bytes, bytearray)):
            return ('b', hashlib.md5(bytes(x)).hexdigest())
        if isinstance(x, np.ndarray):
            return ('a', str(x.dtype), x.shape, hashlib.md5(np.ascontiguousarray(x).tobytes()).hexdigest())
        if isinstance(x, (list, tuple)):
            return [self(y, depth + 1) for y in x]
        if isinstance(x, dict):
            return {str(k): self(v, depth + 1) for k, v in sorted(x.items(), key=lambda kv: str(kv[0]))}
        # objects: shared ones get a number
        k = id(x)
        if k in self.ids:
            return ('ref', self.ids[k])
        self.ids[k] = len(self.ids)
        d = {a: v for a, v in vars(x).items() if a not in SKIP_ATTRS}
        if isinstance(x, Chunk):
            d['v'] = {a: v for a, v in x.v.items() if not (x.STRUCT.by_name.get(a) and x.STRUCT.by_name[a].derived)}
            d['refs'] = {f: (self(t, depth + 1) if t is not None else None) for f, t in x.refs.items()}
        return (type(x).__name__, self(d, depth + 1))


def strip_derived(arch):
    """values the writer recomputes are compared separately"""


def compare(a, b, path='', out=None, limit=20):
    out = [] if out is None else out
    if len(out) >= limit:
        return out
    if type(a) != type(b):
        out.append('%s: type %s != %s' % (path, type(a).__name__, type(b).__name__))
    elif isinstance(a, dict):
        for k in set(a) | set(b):
            if k not in a or k not in b:
                out.append('%s.%s: missing on one side' % (path, k))
            else:
                compare(a[k], b[k], path + '.' + k, out, limit)
    elif isinstance(a, list):
        if len(a) != len(b):
            out.append('%s: length %d != %d' % (path, len(a), len(b)))
        for i, (x, y) in enumerate(zip(a, b)):
            compare(x, y, '%s[%d]' % (path, i), out, limit)
    elif isinstance(a, tuple) and a and a[0] in ('ref',) or not isinstance(a, tuple):
        if a != b:
            out.append('%s: %r != %r' % (path, a, b))
    else:
        compare(list(a), list(b), path, out, limit)
    return out


def derived_diffs(arch):
    """derived values as read vs as the writer computes them"""
    import copy
    diffs = {}
    for m in arch.models:
        before = dict(m.v)
        cb = {id(c): dict(c.v) for c in m.chunks if isinstance(c, Chunk)}
        m.prepare()
        for k, v in m.v.items():
            if before.get(k) != v:
                diffs.setdefault('model.' + k, []).append((m.name, before.get(k), v))
        for c in m.chunks:
            if not isinstance(c, Chunk):
                continue
            c.prepare()
            for k, v in c.v.items():
                if cb[id(c)].get(k) != v:
                    diffs.setdefault('%s.%s' % (c.KIND, k), []).append((m.name, cb[id(c)].get(k), v))
    return diffs


def main(paths):
    files = []
    for p in paths:
        files += sorted(glob.glob(os.path.join(p, '**', '*.gsf'), recursive=True)) if os.path.isdir(p) else [p]
    total_bad = 0
    for f in files:
        t0 = time.time()
        a = GsfArchive.load(f)
        t1 = time.time()
        data = a.to_bytes()
        t2 = time.time()
        b = GsfArchive.from_bytes(data)
        t3 = time.time()
        ca, cb = Canon()(a), Canon()(b)
        diffs = compare(ca, cb)
        data2 = b.to_bytes()
        same2 = data2 == data
        total_bad += bool(diffs) or not same2
        print('%-28s %9d -> %9d bytes  read %.1fs write %.1fs  %s%s%s' % (
            os.path.basename(f), os.path.getsize(f), len(data), t1 - t0, t2 - t1,
            'OK' if not diffs else 'DIFF', '' if same2 else ' (second write differs)',
            (' warnings: %d' % len(a.warnings)) if a.warnings else ''))
        for d in diffs:
            print('     ', d)
        for wmsg in a.warnings[:5]:
            print('      !', wmsg)
        dd = derived_diffs(GsfArchive.load(f))
        for k, lst in sorted(dd.items()):
            print('      derived %s differs in %d: %s' % (k, len(lst), lst[:3]))
    print('archives with differences:', total_bad)


if __name__ == '__main__':
    main(sys.argv[1:])
