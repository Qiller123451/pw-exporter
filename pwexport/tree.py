"""Parser for ParaWorld's text data files: the tech tree (.ttree) and the class / settings / sound files (.txt).

They all use nested blocks of quoted values:

    Root {
        hu_warrior {
            gfx = 'hu_warrior_s1'
            Parts { 0 = 'AxtA' { Gfx { 0 = 'hu_axe_a' } Links = 'HndR' } }
        }
    }

parse(text) returns nested dicts. `name = 'value' { ... }` becomes a dict with the value under '_value'.

Two dialects exist in the game files:
  * the tech tree: no comments, `name = 'x' {..}` always keeps 'x' as _value  -> parse(text)
  * script/settings files: `// comments`, and `name = 'sibling' {..}` copies the sibling block `sibling`
    and applies the overrides (sound tables, idle animations) -> parse(text, inherit=True)
"""
import re

_TOK = re.compile(r"'([^']*)'|(\{)|(\})|(=)|(//[^\n]*)|([^\s{}=']+)")
_TOK_TT = re.compile(r"'([^']*)'|(\{)|(\})|(=)|(?!)()|([^\s{}=']+)")     # tech tree: '//' is not special


def parse(text, inherit=False):
    toks = []
    for m in (_TOK if inherit else _TOK_TT).finditer(text):
        if m.group(5):
            continue                          # comment
        if m.group(1) is not None: toks.append(('S', m.group(1)))
        elif m.group(2): toks.append(('{', None))
        elif m.group(3): toks.append(('}', None))
        elif m.group(4): toks.append(('=', None))
        else: toks.append(('W', m.group(6)))
    pos = 0

    def block():
        nonlocal pos
        node = {}
        while pos < len(toks):
            t, v = toks[pos]
            if t == '}':
                pos += 1
                return node
            if t not in ('W', 'S'):
                pos += 1
                continue
            name = v
            pos += 1
            val, has_val = None, False
            if pos < len(toks) and toks[pos][0] == '=':
                pos += 1
                val = toks[pos][1] if pos < len(toks) else None
                has_val = True
                pos += 1
            if pos < len(toks) and toks[pos][0] == '{':
                pos += 1
                sub = block()
                if inherit and has_val and isinstance(node.get(val), dict):
                    base = dict(node[val]); base.update(sub); sub = base
                elif has_val:
                    if inherit: sub.setdefault('_value', val)
                    else: sub['_value'] = val
                node[name] = sub
            else:
                node[name] = val if has_val else (None if inherit else True)
        return node
    return block()


def get(node, path, default=None):
    """get(tree, 'Root/StartTT/Objects') - walk a '/' separated path"""
    for p in path.strip('/').split('/'):
        if not isinstance(node, dict) or p not in node:
            return default
        node = node[p]
    return node


def scalar(v):
    """a value that may be either 'x' or a block 'x' { ... }"""
    return v.get('_value') if isinstance(v, dict) else v


def values(block):
    """the scalar entries of a list block such as Users { 0 = 'a' 1 = 'b' }"""
    if not isinstance(block, dict):
        return []
    return [scalar(v) for k, v in block.items() if k != '_value' and isinstance(scalar(v), str)]
