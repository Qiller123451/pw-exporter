"""ParaWorld's tree text files: the tech tree (_TechTree.ttree), the class lists (Scripts/Server/classes/*.txt),
the sound and effect tables. Read into nodes and written back byte for byte (tabs, CRLF, latin-1).

    Root {
    	StartTT {
    		Objects {
    			Hu {
    				CHTR {
    					hu_warrior {
    						description = '_hu_warrior'
    						...
    					}
    				}
    			}
    		}
    		...
    	}
    }

A line is `key = 'value'`, `key {`, `key = 'value' {` (a valued block: list entries such as
`0 = '/Objects/Hu/BLDG/hu_arena' {`) or `}`. Values never hold a quote.

    root = parse(text)               the file's top node (key '', children = the file's blocks)
    write(root) -> text
    node.get('StartTT/Objects/Hu')   a child by path ('/'-separated keys), None if missing
    node.find_all(pred)              every node below for which pred(node, path) is true
"""
import copy
import re

_LINE = re.compile(r"^\s*([^\s=]+)(?: = '([^']*)')?( \{)?\s*$")
# hand-written class files: other spacing, a missing closing quote ("gfx = 'miyagi_s0_head")
_LOOSE = re.compile(r"^\s*([^\s=]+)\s*(?:=\s*'([^']*)'?)?\s*(\{)?\s*$")


class Node:
    __slots__ = ('key', 'value', 'children')

    def __init__(self, key, value=None, children=None):
        self.key = key
        self.value = value                 # str or None
        self.children = children           # list of Node (a block) or None (a plain value)

    # ------------------------------------------------------------------ queries
    def get(self, path):
        n = self
        for k in [p for p in path.split('/') if p]:
            if n.children is None:
                return None
            n = next((c for c in n.children if c.key == k), None)
            if n is None:
                return None
        return n

    def get_ci(self, path):
        """as get, keys compared without case (the game's paths are not case sensitive)"""
        n = self
        for k in [p for p in path.split('/') if p]:
            if n.children is None:
                return None
            kl = k.lower()
            n = next((c for c in n.children if c.key.lower() == kl), None)
            if n is None:
                return None
        return n

    def val(self, path, default=None):
        n = self.get(path)
        return n.value if n is not None and n.value is not None else default

    def blocks(self):
        return [c for c in (self.children or []) if c.children is not None]

    def find_all(self, pred, path=''):
        out = []
        for c in self.children or []:
            p = path + '/' + c.key if path else c.key
            if pred(c, p):
                out.append((c, p))
            if c.children is not None:
                out.extend(c.find_all(pred, p))
        return out

    # ------------------------------------------------------------------ edits
    def set(self, path, value):
        """set a plain value, creating the nodes on the way (a new value goes after the last plain value)"""
        keys = [p for p in path.split('/') if p]
        n = self
        for k in keys[:-1]:
            c = n.get(k)
            if c is None:
                c = Node(k, None, [])
                n.children.append(c)
            n = c
        c = n.get(keys[-1])
        if c is None:
            c = Node(keys[-1], str(value))
            plain = [i for i, x in enumerate(n.children) if x.children is None]
            n.children.insert(plain[-1] + 1 if plain else 0, c)
        else:
            c.value = str(value)
        return c

    def add(self, node, after=None):
        if after is None:
            self.children.append(node)
        else:
            self.children.insert(self.children.index(after) + 1, node)
        return node

    def remove(self, node):
        self.children.remove(node)

    def next_index(self):
        """the next free number of a list block (its entries are keyed 0, 1, 2 ...)"""
        nums = [int(c.key) for c in self.children or [] if c.key.isdigit()]
        return max(nums) + 1 if nums else 0

    def clone(self):
        return copy.deepcopy(self)

    def __repr__(self):
        return '<Node %s%s%s>' % (self.key, " = '%s'" % self.value if self.value is not None else '',
                                  ' {%d}' % len(self.children) if self.children is not None else '')


def parse(text):
    if isinstance(text, bytes):
        text = text.decode('latin-1')
    root = Node('', None, [])
    stack = [root]
    for ln, line in enumerate(text.splitlines(), 1):
        s = line.strip()
        if not s or s.startswith(('//', '#')):
            continue
        if s == '}':
            if len(stack) == 1:
                raise ValueError('line %d: "}" without a block' % ln)
            stack.pop()
            continue
        m = _LINE.match(line) or _LOOSE.match(line)
        if not m:
            raise ValueError('line %d: cannot read %r' % (ln, line[:80]))
        n = Node(m.group(1), m.group(2), [] if m.group(3) else None)
        stack[-1].children.append(n)
        if m.group(3):
            stack.append(n)
    if len(stack) != 1:
        raise ValueError('%d block(s) not closed' % (len(stack) - 1))
    return root


def write(root, eol='\r\n'):
    out = []

    def emit(n, depth):
        ind = '\t' * depth
        head = n.key + (" = '%s'" % n.value if n.value is not None else '')
        if n.children is None:
            out.append(ind + head)
            return
        out.append(ind + head + ' {')
        for c in n.children:
            emit(c, depth + 1)
        out.append(ind + '}')
    for c in root.children:
        emit(c, 0)
    return eol.join(out) + eol


def load(path):
    with open(path, 'rb') as f:
        return parse(f.read())


def save(root, path):
    with open(path, 'wb') as f:
        f.write(write(root).encode('latin-1', 'replace'))


def rename_refs(node, old, new):
    """in a copied block: every value that names `old` - alone or as a part of a path ('/Objects/Hu/CHTR/<old>/gfx') -
    names `new`"""
    for c, _ in [(node, '')] + node.find_all(lambda n, p: True):
        if c.value is None:
            continue
        if c.value == old:
            c.value = new
        elif '/' in c.value:
            parts = c.value.split('/')
            if old in parts:
                c.value = '/'.join(new if x == old else x for x in parts)
