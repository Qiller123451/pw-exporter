"""Mission scripting data of ParaWorld maps: triggers (Trgr), quests (Ques) and regions (Rgns).

    m = ula.Map.load('Data/Base/Maps/Cpn_single_001/single_11.ula')
    t = triggers(m.chunks['Trgr'].data)       # {'triggers': [...], 'tree': folder tree, 'compiled': [...], 'warnings'}
    q = quests(m.chunks['Ques'].data)         # [{'guid', 'attr': {name, headline, boni_easy ...}}]
    r = regions(m.chunks['Rgns'].data)        # {'regions': [...], 'tree': folder tree, 'handles': [...]}

The formats are described in docs/CAMPAIGN_FORMAT.md, what the nodes MEAN in remake/docs/spec/triggers.md.

A trigger = {guid, name, description, flags (decoded, see FLAGS), expression, conditions[], actions[]}; a condition or
action node = {type ('TIME', 'SPGR' ...), note (the designer's comment), name (the editor's node label),
p: {parameter: value}}. All parameter values are strings exactly as the level
editor stored them (numbers, "[x y z]" vectors, 32-letter GUIDs, "a|b|c" lists); a parameter the designer left at its
default is simply missing - the defaults come from the game's *_attrib_def.txt (attrib_defaults(), spec §2.1).

GUIDs: the editor writes a 16-byte GUID as 32 letters 'a'..'p', one per nibble, low nibble first (byte 0xad ->
"nk"). guid_str() / guid_bytes() convert; everything this package returns uses the letter form because that is what
trigger parameters contain.
"""
import re
import struct

from .ula import _R, read_tree, text

# trigger flags (TRDM entry and compiled TRIG/BASE). Names after the level editor's check boxes / TriggerDesc;
# what they do: remake/docs/spec/triggers.md §1.2
FLAGS = (
    (0x0002, 'f02'),            # set on every trigger of every map (meaning unknown)
    (0x0004, 'once'),           # the trigger is disabled when it fires (a TRIG action can enable it again)
    (0x0008, 'enabled'),        # enabled when the level starts
    (0x0010, 'disabled'),       # switched off in the editor: exactly the triggers that have no compiled TRIG node
    (0x0020, 'random'),         # one random action instead of all
    (0x0040, 'node_off'),       # its folder node starts inactive (the ACND action switches folders)
    (0x0080, 'by_difficulty'),  # only the actions of the current difficulty run
    (0x0200, 'compiled'),       # only in the compiled TRIG nodes
    (0x80000000, 'valid'),      # always set
)


# the chunk tag of a compiled node where it differs from the node type of the description (the script classes' Save())
COMPILED_TAGS = {'ACDO': 'OBDO', 'SQNZ': 'SEQU', 'RSRC': 'RES_', 'WYPT': 'WAYP', 'OBAP': 'OAPR', 'TECH': 'TTRE',
                 'OCPY': 'OCUP', 'DELO': '<Fou'}


def guid_str(b):
    """16 bytes -> the editor's 32-letter form"""
    return ''.join(chr(97 + (c & 15)) + chr(97 + (c >> 4)) for c in b)


def guid_bytes(s):
    return bytes((ord(s[i]) - 97) | ((ord(s[i + 1]) - 97) << 4) for i in range(0, 32, 2))


def is_guid(s):
    return isinstance(s, str) and len(s) == 32 and all('a' <= c <= 'p' for c in s)


def decode_flags(v):
    d = {name: bool(v & bit) for bit, name in FLAGS if name not in ('f02', 'valid', 'compiled')}
    d['raw'] = v
    return d


def _guid(r):
    g = guid_str(r.b[r.o:r.o + 16]); r.o += 16
    return g


def _tag(r):
    t = r.b[r.o:r.o + 4].split(b'\0')[0].decode('latin1'); r.o += 4
    return t


def _subtree(b):
    """a chunk that holds 'u32 size' + a nested chunk tree -> its root (None when empty / not a tree)"""
    if not b or len(b) < 16:
        return None
    try:
        return read_tree(b, 4)
    except (struct.error, IndexError):
        return None


# ---------------------------------------------------------------- Trgr
def _node(r):
    t = _tag(r)
    note = r.s(); name = r.s()
    p = {}
    for _ in range(r.u32()):
        k = r.s(); p[k] = r.s()
    return {'type': t, 'note': note, 'name': name, 'p': p}


def _folder(r, warn):
    """TRDM folder tree node: u16 0xCD, name, u32 n + n trigger guids, u32 children, children, u16 0xDC"""
    if struct.unpack_from('<H', r.b, r.o)[0] != 0xCD:
        warn.append('trigger folder tree: unexpected marker at %d' % r.o)
        return None
    r.o += 2
    f = {'name': r.s(), 'triggers': [_guid(r) for _ in range(r.u32())], 'folders': []}
    for _ in range(r.u32()):
        c = _folder(r, warn)
        if c is None:
            return f
        f['folders'].append(c)
    if struct.unpack_from('<H', r.b, r.o)[0] == 0xDC:
        r.o += 2
    else:
        warn.append('trigger folder "%s": no end marker' % f['name'])
    return f


def trdm(d, warn=None):
    """the TRDM chunk (the editor's trigger descriptions) -> (triggers, folder tree)"""
    warn = warn if warn is not None else []
    r = _R(d)
    out = []
    for _ in range(r.u32()):
        g = _guid(r)
        fl = r.u32()
        name = r.s(); desc = r.s(); expr = r.s()
        conds = [_node(r) for _ in range(r.u32())]
        acts = [_node(r) for _ in range(r.u32())]
        out.append({'guid': g, 'name': name, 'description': desc, 'flags': decode_flags(fl), 'expression': expr,
                    'conditions': conds, 'actions': acts})
    tree = _folder(r, warn) if r.o + 2 <= len(d) else None
    if r.o != len(d):
        warn.append('TRDM: %d bytes after the folder tree' % (len(d) - r.o))
    return out, tree


def _compiled(ch):
    """a compiled TRIG node -> {index, guid, flags, expression, name, conditions [(class, tag)], actions [...]}.
    The per-type payloads (SPGR, OBFR ...) are binary copies of the TRDM parameters and are not decoded; the node
    BASE gives the name and, for actions, the difficulty."""
    t = {'index': struct.unpack_from('<I', ch.data, 0)[0] if ch.data else None, 'conditions': [], 'actions': []}
    for c in ch.children:
        if c.tag == 'BASE' and c.data:
            r = _R(c.data)
            t['guid'] = _guid(r); t['flags'] = r.u32(); t['expression'] = r.s(); t['name'] = r.s()
        elif c.tag in ('COND', 'ACTN') and c.data:
            n = {'class': _R(c.data).s(), 'type': '', 'version': None, 'size': 0}
            for k in c.children:
                if k.tag == 'BASE' and k.data:
                    try:
                        r = _R(k.data)
                        if c.tag == 'ACTN':                 # v2: name, u32 difficulty, u32 ?
                            n['name'] = r.s(); n['difficulty'] = r.u32()
                        else:                               # v1: name, u32 active?, ...
                            n['name'] = r.s()
                    except (struct.error, IndexError):
                        pass
                else:
                    n['type'], n['version'], n['size'] = k.tag, k.version, k.size or 0
            t['conditions' if c.tag == 'COND' else 'actions'].append(n)
    return t


def triggers(b):
    """the Trgr chunk -> {'triggers': [...], 'tree': folders, 'compiled': [...], 'warnings': [...]}"""
    res = {'triggers': [], 'tree': None, 'compiled': [], 'warnings': []}
    root = _subtree(b)
    if root is None:
        return res
    d = root.child('TRDM')
    if d is not None and d.data:
        try:
            res['triggers'], res['tree'] = trdm(d.data, res['warnings'])
        except (struct.error, IndexError, UnicodeDecodeError) as e:
            res['warnings'].append('TRDM: %s' % e)
    for ch in root.all('TRIG'):
        try:
            res['compiled'].append(_compiled(ch))
        except (struct.error, IndexError, UnicodeDecodeError) as e:
            res['warnings'].append('compiled TRIG: %s' % e)
    by = {t['guid']: t for t in res['triggers']}
    for c in res['compiled']:
        t = by.get(c.get('guid'))
        if t is None:
            res['warnings'].append('compiled trigger "%s" has no description' % c.get('name'))
            continue
        t['compiled'] = True
        t['index'] = c['index']
        # the action difficulty is not always in the description (the editor only writes non-default parameters)
        if len(c['actions']) == len(t['actions']):
            for a, ca in zip(t['actions'], c['actions']):
                if ca['type'] != a['type'] and COMPILED_TAGS.get(a['type']) != ca['type']:
                    res['warnings'].append('trigger "%s": compiled action %s != %s' % (t['name'], ca['type'], a['type']))
                a['difficulty'] = ca.get('difficulty')
        else:
            res['warnings'].append('trigger "%s": %d compiled actions, %d described' % (t['name'], len(c['actions']), len(t['actions'])))
        if len(c['conditions']) != len(t['conditions']):
            res['warnings'].append('trigger "%s": %d compiled conditions, %d described' % (t['name'], len(c['conditions']), len(t['conditions'])))
    for t in res['triggers']:
        t.setdefault('compiled', False)
    return res


def folder_paths(tree):
    """{trigger guid: 'Root/Folder/Sub'}"""
    out = {}

    def walk(f, path):
        p = (path + '/' + f['name']) if path else f['name']
        for g in f['triggers']:
            out[g] = p
        for c in f['folders']:
            walk(c, p)
    if tree:
        walk(tree, '')
    return out


# ---------------------------------------------------------------- Ques
def quests(b):
    """the Ques chunk -> [{'guid', 'attr': {...}}] in file order.
    QMGR: u32 count, count x { u32 0, guid[16], u32 n, n x { u32 0, u32 0, key, value } }"""
    root = _subtree(b)
    q = root.child('QMGR') if root else None
    if q is None or not q.data:
        return []
    r = _R(q.data)
    out = []
    for _ in range(r.u32()):
        r.u32()
        g = _guid(r)
        a = {}
        for _ in range(r.u32()):
            r.u32(); r.u32(); k = r.s(); a[k] = r.s()
        out.append({'guid': g, 'attr': a})
    if r.o != len(q.data):
        raise ValueError('Ques: %d bytes left' % (len(q.data) - r.o))
    return out


# ---------------------------------------------------------------- Rgns
SHAPES = {1: 'rect', 2: 'oval'}          # CSubRegion.RT_Rect / RT_Oval (Nest.usl:137 creates ovals)


def regions(b):
    """the Rgns chunk -> {'regions': [...], 'tree': folder tree, 'handles': [(index, serial)]}.
    A region = {guid, name, flags, color, note, shapes [{type 'rect'|'oval', enabled, x, y, z, w, h, d}]}; a shape covers
    the axis-aligned box x..x+w, y..y+h (map coordinates) - an oval is the ellipse inscribed in it."""
    res = {'regions': [], 'tree': None, 'handles': [], 'version': None}
    if not b or len(b) < 12:
        return res
    r = _R(b)
    res['version'] = r.u32()
    res['handles'] = [struct.unpack_from('<HH', b, r.o + 4 * i) for i in range(r.u32())]
    r.o += 4 * len(res['handles'])
    for _ in range(r.u32()):
        fl = r.u32()
        reg = {'guid': _guid(r), 'name': r.s(), 'flags': fl, 'color': '%08x' % r.u32(), 'shapes': []}
        for _ in range(r.u32()):
            t = r.u32(); r.u32()
            x, y, z, w, h, d = r.f32(6)
            reg['shapes'].append({'type': SHAPES.get(t & 0xff, str(t & 0xff)), 'enabled': bool(t & 0x20000000),
                                  'flags': t >> 24, 'x': x, 'y': y, 'z': z, 'w': w, 'h': h, 'd': d})
        reg['note'] = r.s()
        res['regions'].append(reg)

    def folder():
        f = {'name': r.s(), 'guid': _guid(r), 'regions': [_guid(r) for _ in range(r.u32())], 'folders': []}
        for _ in range(r.u32()):
            f['folders'].append(folder())
        return f
    try:
        if r.o + 24 <= len(b):
            res['tree'] = folder()
    except (struct.error, IndexError, UnicodeDecodeError):
        pass
    res['rest'] = len(b) - r.o
    return res


def in_shape(s, x, y):
    """is the map position inside the shape (the test the JSON's region geometry is meant for)"""
    if s['type'] == 'oval':
        a, c = s['w'] / 2.0, s['h'] / 2.0
        if a <= 0 or c <= 0:
            return False
        return ((x - s['x'] - a) / a) ** 2 + ((y - s['y'] - c) / c) ** 2 <= 1.0
    return s['x'] <= x <= s['x'] + s['w'] and s['y'] <= y <= s['y'] + s['h']


# ---------------------------------------------------------------- the game's text trees (.dlg, *_attrib_def.txt)
_PD_PAIR = re.compile(r"^(.+?)\s*=\s*(?:'(.*)'|\"(.*)\"|(\S*))\s*(\{)?$")


def _propdb_lines(text):
    """the files are written one item per line (name {  /  key = 'value'  /  key = 'value' {  /  }); reading them
    that way survives the stray quote some shipped files have in a key (ds_1100.dlg: "stina' = ''"). None if the
    text is not in that layout."""
    root = {'name': '', 'value': '', 'attr': {}, 'children': []}
    stack = [root]
    for ln in text.splitlines():
        ln = ln.strip()
        if not ln:
            continue
        if ln == '}':
            if len(stack) < 2:
                return None
            stack.pop()
            continue
        m = _PD_PAIR.match(ln)
        if m:
            key = m.group(1).strip()
            val = next((g for g in m.group(2, 3, 4) if g is not None), '')
            if m.group(5):
                c = {'name': key, 'value': val, 'attr': {}, 'children': []}
                stack[-1]['children'].append(c)
                stack.append(c)
            else:
                stack[-1]['attr'][key] = val
        elif ln.endswith('{') and '=' not in ln and "'" not in ln:
            c = {'name': ln[:-1].strip().strip('"'), 'value': '', 'attr': {}, 'children': []}
            stack[-1]['children'].append(c)
            stack.append(c)
        else:
            return None
    if len(stack) != 1:
        return None
    return root['children'][0] if len(root['children']) == 1 and not root['attr'] else root


def propdb(text):
    """the game's property tree text format ("Root { key = 'value'  Child { ... } }", used by dialogue scenes, the level
    editor's attribute definitions ...) -> node {'name', 'value', 'attr': {key: value}, 'children': [node]}.
    'key = value' pairs go to attr; a pair followed by '{' is a child node with a value."""
    import re
    n = _propdb_lines(text)
    if n is not None:
        return n
    tok = re.findall(r"'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\"|([{}=])|([^\s{}='\"]+)", text)
    toks = []
    for a, b, p, w in tok:
        toks.append(('p', p) if p else ('s', a or b or w))
    pos = [0]

    def node(name, value=''):
        n = {'name': name, 'value': value, 'attr': {}, 'children': []}
        while pos[0] < len(toks):
            k, v = toks[pos[0]]
            if (k, v) == ('p', '}'):
                pos[0] += 1
                return n
            if k != 's':
                pos[0] += 1
                continue
            pos[0] += 1
            nk = toks[pos[0]] if pos[0] < len(toks) else ('p', '}')
            if nk == ('p', '{'):
                pos[0] += 1
                n['children'].append(node(v))
            elif nk == ('p', '='):
                val = toks[pos[0] + 1][1] if pos[0] + 1 < len(toks) and toks[pos[0] + 1][0] == 's' else ''
                pos[0] += 2
                if pos[0] < len(toks) and toks[pos[0]] == ('p', '{'):
                    pos[0] += 1
                    n['children'].append(node(v, val))
                else:
                    n['attr'][v] = val
        return n
    root = node('')
    return root['children'][0] if len(root['children']) == 1 and not root['attr'] else root


def attrib_defaults(text):
    """*_attrib_def.txt -> {node type: {parameter: {'type', 'default'}}}. A type nested in another one (REGN in OBJC)
    inherits its parameters, and the root's own attribs (renderable, difficulty of actions) belong to every type.
    The editor only stores parameters that differ from these defaults, and the game compiles triggers WITH them
    (checked: 957 of 958 compiled TIME conditions have reset = 1 although the description has no 'reset')."""
    out = {}

    def own(n):
        a = next((c for c in n['children'] if c['name'] == 'attribs'), None)
        return {c['name']: {'type': c['attr'].get('type', 'string'), 'default': c['attr'].get('default')} for c in a['children']} if a else {}

    def walk(n, inherited):
        mine = dict(inherited); mine.update(own(n))
        for c in n['children']:
            if c['name'] == 'attribs':
                continue
            sub = dict(mine); sub.update(own(c))
            out[c['name']] = sub
            walk(c, mine)
    walk(propdb(text), {})
    return out
