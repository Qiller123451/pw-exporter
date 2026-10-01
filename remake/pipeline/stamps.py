"""Fingerprints that decide which build steps have to run again.

A step's output is up to date when neither its code nor the game files it reads have changed:

    code_hash('remake/pipeline/build_menu.py')   the step's module and everything it imports from the toolkit
                                                 (remake/pipeline/*, pwexport/*), followed through the imports, plus
                                                 the data files those modules name (roster.json, composites.json)
    tree_hash(game_data, [folders and files])    names, sizes and modification times of the game files a step reads

Only the toolkit's own modules count (numpy, Pillow ... don't). A package's __init__.py counts only when something is
imported from the package itself, so changing pwexport/__init__.py doesn't rebuild everything.
"""
import ast
import hashlib
import os
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))        # the toolkit folder
# build machinery, not part of any step's output
IGNORE = {os.path.join(HERE, 'stamps.py'), os.path.join(HERE, '__init__.py'), os.path.join(HERE, '__main__.py')}

_files = {}        # path -> (mtime_ns, size, sha1 of the content, [imported files], [data files])
_trees = {}        # key -> (time, hash)


def _sha(data):
    return hashlib.sha1(data).hexdigest()


def _module(base, parts):
    """file of the module base/<parts> (.py or package __init__.py), or None"""
    p = os.path.join(base, *parts)
    if os.path.isfile(p + '.py'):
        return p + '.py'
    if os.path.isfile(os.path.join(p, '__init__.py')):
        return os.path.join(p, '__init__.py')
    return None


def _from(base, parts, names):
    """`from <base/parts> import names`: the submodules among the names, else the module itself"""
    p = os.path.join(base, *parts)
    if parts and os.path.isfile(p + '.py'):
        return [p + '.py']
    out = []
    for n in names:
        sub = _module(p, [n]) if n != '*' else None
        if sub:
            out.append(sub)
        elif os.path.isfile(os.path.join(p, '__init__.py')):
            out.append(os.path.join(p, '__init__.py'))
    return out


def _scan(path):
    """(content hash, toolkit files it imports, data files it names) of one module, cached by size + time"""
    st = os.stat(path)
    c = _files.get(path)
    if c and c[0] == st.st_mtime_ns and c[1] == st.st_size:
        return c[2:]
    with open(path, 'rb') as f:
        src = f.read()
    here = os.path.dirname(path)
    deps, data = [], []
    for node in ast.walk(ast.parse(src, path)):
        if isinstance(node, ast.Import):
            for a in node.names:
                parts = a.name.split('.')
                hit = _module(here, parts) or _module(ROOT, parts)       # `import paths` (sibling) or `import pwexport.gsf`
                if hit:
                    deps.append(hit)
        elif isinstance(node, ast.ImportFrom):
            names = [a.name for a in node.names]
            parts = node.module.split('.') if node.module else []
            if node.level:
                base = here
                for _ in range(node.level - 1):
                    base = os.path.dirname(base)
                deps += _from(base, parts, names)
            elif parts:
                for base in (here, ROOT):
                    if _module(base, parts[:1]) or os.path.isdir(os.path.join(base, parts[0])):
                        deps += _from(base, parts, names)
                        break
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and 0 < len(node.value) < 100 \
                and '.' in node.value and '\n' not in node.value and ':' not in node.value \
                and not os.path.isabs(node.value) and not node.value.endswith('.py'):
            for cand in (os.path.join(here, node.value), os.path.join(here, 'data', node.value)):
                if os.path.isfile(cand):                                    # roster.json, data/composites.json
                    data.append(cand)
    # the same file checked out with Windows or Unix line ends is the same code
    res = (_sha(src.replace(b'\r\n', b'\n')), sorted(set(deps)), sorted(set(data)))
    _files[path] = (st.st_mtime_ns, st.st_size) + res
    return res


def code_files(path):
    """the module and every toolkit file it depends on (sorted)"""
    seen, todo, data = set(), [os.path.abspath(path)], set()
    while todo:
        p = todo.pop()
        if p in seen:
            continue
        seen.add(p)
        _, deps, dat = _scan(p)
        data.update(dat)
        todo += [d for d in deps if d not in seen and d not in IGNORE]
    return sorted(seen | data)


def code_hash(path):
    h = hashlib.sha1()
    for p in code_files(path):
        rel = os.path.relpath(p, ROOT).replace(os.sep, '/')
        if p.endswith('.py'):
            digest = _scan(p)[0]
        else:
            with open(p, 'rb') as f:
                digest = _sha(f.read().replace(b'\r\n', b'\n'))
        h.update(('%s:%s\n' % (rel, digest)).encode())
    return h.hexdigest()[:16]


def _walk(path, out):
    try:
        it = os.scandir(path)
    except OSError:
        return
    with it:
        for e in it:
            try:
                if e.is_dir(follow_symlinks=False):
                    _walk(e.path, out)
                elif e.is_file():
                    st = e.stat()          # on Windows from the directory listing itself: no extra disk access
                    out.append((e.path, st.st_size, int(st.st_mtime)))
            except OSError:
                pass


def tree_hash(root, items, max_age=0):
    """hash of names, sizes and times of the files and folders (recursively) in `items`; names relative to `root`,
    missing items count as missing. max_age > 0 reuses a result up to that many seconds old (status checks)."""
    items = sorted({os.path.abspath(p) for p in items if p})
    key = (root,) + tuple(items)
    c = _trees.get(key)
    if max_age and c and time.time() - c[0] < max_age:
        return c[1]
    files = []
    for p in items:
        if os.path.isdir(p):
            _walk(p, files)
        elif os.path.isfile(p):
            st = os.stat(p)
            files.append((p, st.st_size, int(st.st_mtime)))
        else:
            files.append((p, -1, 0))
    h = hashlib.sha1()
    for p, size, mt in sorted((os.path.relpath(p, root).replace(os.sep, '/').lower(), s, m) for p, s, m in files):
        h.update(('%s|%d|%d\n' % (p, size, mt)).encode('utf-8', 'surrogateescape'))
    res = h.hexdigest()[:16]
    _trees[key] = (time.time(), res)
    return res


def combine(*parts):
    return _sha('|'.join(str(p) for p in parts).encode())[:16]
