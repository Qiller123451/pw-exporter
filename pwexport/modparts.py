"""Add-ons of units and buildings read straight from the game scripts - for objects the built-in table
(data/composites.json, composites.py) does not know: the units of mods.

The game puts a unit together in script code (Data/<folder>/Scripts/Server/classes/**/*.usl): the object's class
creates its parts in OnInit and links them to attachment points -

    class CSeasRex inherit CAnimal
        export proc void OnInit(bool p_bLoad)
            super.OnInit(p_bLoad);
            if(!p_bLoad)then ReBuildWeapon(); endif;
        endproc;
        export proc void ReBuildWeapon()
            SetBuildUp(CBuildUpBase.TYPE_TRANSPORTER_OPEN);
            var ^CGameObj pxO=CSrvWrap.GetObjMgr()^.CreateObj("seas_triceratops_transporter_buildup", GetOwner());
            GetBuildUp()^.AddObjCustomized(pxO^.GetHandle(), "Ride", {0.0,0.0,-1.61});
            avNests.AddEntry({3.04,-1.15,-1.21}); avNests.AddEntry({-3.04,-1.15,-1.21});
            for(i=0)cond(i<iC)iter(i++)do
                AddAdditionalBuildUp(CBuildUpBase.TYPE_WEAPON);
                var ^CGameObj pxMG=CSrvWrap.GetObjMgr()^.CreateObj("seas_triceratops_machinegun", GetOwner());
                pxWeaponBuildUp^.AddObjCustomized(pxMG^.GetHandle(), "Ride", avNests[i]);
                pxWeaponBuildUp^.SetCanRotate(true);
            ...

The table was written by hand from the base game's scripts. Here a small interpreter runs the script of one object
far enough to see what it attaches: it follows the class chain (super calls, the class's own procedures), knows the
object's class name (the scripts branch on it), runs loops over literal arrays, and records every
AddObj / AddObjFlex / AddObjCaptain / AddObjCustomized / AddCustWithParent ... call with the created object, the link,
the offset and the parent part. Conditions it cannot decide (upgrades, game state) are followed both ways; what
they attach becomes an optional part. Procedures other than OnInit that attach something (upgrade handlers) give
optional parts too. The rider's seat is the class's GetCaptainLink, evaluated with the build-ups OnInit made.

    parts = derive(install, techtree, classes)['seas_rex']      # raw entries like data/composites.json, plus 'offset'
    normalized(install, techtree, classes)['seas_rex']          # composites.normalize()d, with 'offset' and 'derived'

Weapons come from the tech tree as for the table (a character's weapon parts, the rider's weapons). Offsets are in
the link's frame (GSF axes, metres): MIRAGE's AddObjCustomized family, engine call LinkAction(parent, link, offset).
What the interpreter does not see: parts set by task scripts (tools in a worker's hand), level flags of mounts are
added on the "flag" link and shown only when the model has one (the viewer checks).
"""
import os
import re

from . import composites

MAX_DEPTH = 8           # nested procedure calls
MAX_LOOP = 48           # iterations of a script loop
_cache = {}
_TREES = {}             # id(procedure body text) -> statement tree (the texts live in _cache)

ATTACH = {   # name -> argument positions (handle, link, delay, parent, offset, anim)
    'AddObj': (0, 1, None, None, None, None),
    'AddObjFlex': (0, 1, 2, 3, None, None),
    'AddObjCaptain': (0, 1, 2, 3, None, None),
    'AddObjCustomized': (0, 1, None, None, 2, None),
    'AddObjWithParent': (0, 1, None, 2, None, None),
    'AddCustWithParent': (0, 1, None, 3, 2, None),
    'AddCustDelayedObj': (0, 1, 2, 3, 4, None),
    'AddCustDelayedObjAnim': (0, 1, 2, 3, 4, 5),
    'AddObjWithOffset': (0, 1, 2, 3, 4, None),
    'AddObjCaptainCust': (0, 1, 2, 3, 4, None),
}
_ATTACH_RE = re.compile(r'\b(%s)\s*\(' % '|'.join(sorted(ATTACH, key=len, reverse=True)))


# ====================================================================== reading the scripts
def strip_comments(text):
    out, i, n = [], 0, len(text)
    while i < n:
        c = text[i]
        if c == '"':
            j = i + 1
            while j < n and text[j] != '"':
                j += 2 if text[j] == '\\' else 1
            out.append(text[i:j + 1]); i = j + 1
        elif c == '/' and text[i + 1:i + 2] == '/':
            j = text.find('\n', i)
            i = n if j < 0 else j
        elif c == '/' and text[i + 1:i + 2] == '*':
            j = text.find('*/', i + 2)
            i = n if j < 0 else j + 2
        else:
            out.append(c); i += 1
    return ''.join(out)


_CLASS = re.compile(r'\bclass\s+(\w+)(?:\s+inherit\s+([\w.]+))?')
_PROC = re.compile(r'\bproc\s+(?:ref\s+)?[\^\w.<>]+(?:\s+\w+)?\s+(\w+)\s*\(([^)]*)\)')


def read_classes(text, out):
    """the classes of one script file -> out[name] = {'parent', 'procs': {name: (params, body)}} (top level classes;
    a class inside another one is read as its own class)"""
    text = strip_comments(text)
    for m in _CLASS.finditer(text):
        name, parent = m.group(1), (m.group(2) or '').split('.')[-1]
        end = _block_end(text, m.end(), 'class', 'endclass')
        body = text[m.end():end]
        procs = {}
        for p in _PROC.finditer(body):
            pe = body.find('endproc', p.end())
            if pe < 0:
                continue
            params = [a.strip().split()[-1] for a in p.group(2).split(',') if a.strip()]
            procs.setdefault(p.group(1), (params, body[p.end():pe]))
        consts = dict(re.findall(r'\bconst\s+[\^\w.]+\s+(\w+)\s*=\s*([^;]+);', body))
        out[name] = {'parent': parent, 'procs': procs, 'consts': consts}


def _block_end(text, start, opener, closer):
    depth, pos = 1, start
    pat = re.compile(r'\b(%s|%s)\b' % (opener, closer))
    while True:
        m = pat.search(text, pos)
        if not m:
            return len(text)
        if m.group(1) == closer:
            depth -= 1
            if depth == 0:
                return m.start()
        else:
            depth += 1
        pos = m.end()


_TRIGGER = re.compile(r'\b(?:AddObj\w*|AddCust\w*|CreateObj|SetBuildUp|AddAdditionalBuildUp|LinkAction|FlexLinkAction|RideAction|'
                      r'CreateCaptain|SetCanRotate)\s*\(|\bm_\w*(?:Link|Turret)\w*\s*=\s*p_\w+')
_CALLS = re.compile(r'(?<![\w.^])(?:super\.)?(\w+)\s*\(')


def relevant_procs(classes):
    """names of the procedures worth running: those that create or link objects, set a build-up or a member from a
    parameter - or call such a procedure (the rest of the scripts is game logic the interpreter can skip)"""
    calls, rel = {}, set()
    for c in classes.values():
        for name, (params, body) in c['procs'].items():
            if _TRIGGER.search(body):
                rel.add(name)
            calls.setdefault(name, set()).update(_CALLS.findall(body))
    grew = True
    while grew:
        grew = False
        for name, cs in calls.items():
            if name not in rel and cs & rel:
                rel.add(name); grew = True
    return rel


def script_classes(install):
    """every script class of the loaded configuration (a later folder's file replaces the same file of an earlier one)"""
    key = ('usl', install.root, tuple(install.mods))
    if key not in _cache:
        out = {}
        for f in install.files('Scripts/Server/classes/**/*.usl'):
            try:
                with open(f, encoding='latin-1') as fh:
                    read_classes(fh.read(), out)
            except OSError:
                pass
        _cache[key] = out
        _cache[('rel', id(out))] = relevant_procs(out)
    return _cache[key]


# ---------------------------------------------------------------------- statements
def _paren(text, i):
    """text[i] == '(' -> index after the matching ')'"""
    depth, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == '"':
            i += 1
            while i < n and text[i] != '"':
                i += 2 if text[i] == '\\' else 1
        elif c in '({[':
            depth += 1
        elif c in ')}]':
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return n


_KW = re.compile(r'\s*(elseif|if|else|endif|for|endfor|while|endwhile)\b')


def parse_body(text):
    """procedure body -> statement tree: ('s', text) | ('if', [(cond, body), ...], else body | None)
    | ('for', init, cond, iter, body) | ('while', cond, body)"""
    pos, n = 0, len(text)

    def block(stop):
        nonlocal pos
        out = []
        while pos < n:
            m = _KW.match(text, pos)
            kw = m.group(1) if m else None
            if kw in stop:
                return out, kw
            if kw == 'if':
                pos = m.end()
                arms, other = [], None
                while True:
                    a = text.find('(', pos)
                    b = _paren(text, a)
                    cond = text[a + 1:b - 1]
                    t = re.compile(r'\s*then\b').match(text, b)
                    pos = t.end() if t else b
                    body, end = block(('elseif', 'else', 'endif'))
                    arms.append((cond, body))
                    m2 = _KW.match(text, pos)
                    pos = m2.end() if m2 else n
                    if end == 'elseif':
                        continue
                    if end == 'else':
                        other, _ = block(('endif',))
                        m3 = _KW.match(text, pos)
                        pos = m3.end() if m3 else n
                    break
                _semi()
                out.append(('if', arms, other))
            elif kw == 'for':
                pos = m.end()
                parts = []
                for _ in range(3):
                    a = text.find('(', pos)
                    b = _paren(text, a)
                    parts.append(text[a + 1:b - 1]); pos = b
                d = re.compile(r'\s*do\b').match(text, pos)
                pos = d.end() if d else pos
                body, _ = block(('endfor',))
                m2 = _KW.match(text, pos)
                pos = m2.end() if m2 else n
                _semi()
                out.append(('for', parts[0], parts[1], parts[2], body))
            elif kw == 'while':
                pos = m.end()
                a = text.find('(', pos)
                b = _paren(text, a)
                d = re.compile(r'\s*do\b').match(text, b)
                pos = d.end() if d else b
                body, _ = block(('endwhile',))
                m2 = _KW.match(text, pos)
                pos = m2.end() if m2 else n
                _semi()
                out.append(('while', text[a + 1:b - 1], body))
            elif kw:                              # a stray closer: skip it
                pos = m.end()
            else:
                s = _statement()
                if s:
                    out.append(('s', s))
        return out, None

    def _semi():
        nonlocal pos
        m = re.compile(r'\s*;').match(text, pos)
        if m:
            pos = m.end()

    def _statement():
        nonlocal pos
        i, depth = pos, 0
        while i < n:
            c = text[i]
            if c == '"':
                i += 1
                while i < n and text[i] != '"':
                    i += 2 if text[i] == '\\' else 1
            elif c in '({[':
                depth += 1
            elif c in ')}]':
                depth -= 1
            elif c == ';' and depth <= 0:
                break
            i += 1
        s = text[pos:i].strip()
        pos = i + 1
        return s

    return block(())[0]


def split_top(s, sep=','):
    """split at separators outside brackets and strings"""
    out, depth, cur, i, n, k = [], 0, [], 0, len(s), len(sep)
    while i < n:
        c = s[i]
        if c == '"':
            j = i + 1
            while j < n and s[j] != '"':
                j += 2 if s[j] == '\\' else 1
            cur.append(s[i:j + 1]); i = j + 1
            continue
        if c in '({[<' and not (c == '<' and sep != ','):
            depth += 1
        elif c in ')}]>' and not (c == '>' and sep != ','):
            depth -= 1
        if depth == 0 and s.startswith(sep, i):
            out.append(''.join(cur)); cur = []; i += k
            continue
        cur.append(c); i += 1
    out.append(''.join(cur))
    return [x.strip() for x in out]


# ====================================================================== the interpreter
class Unknown:
    def __repr__(self):
        return '?'


UNK = Unknown()


class Obj:
    """an object the script created"""

    def __init__(self, cls, n):
        self.cls, self.n, self.gfx, self.anim = cls, n, None, None
        self.captain = (cls or '').lower() == 'universal_captain'


class _Self:
    """the object itself (GetHandle())"""

    def __repr__(self):
        return 'self'


SELF = _Self()


class BuildUp:
    def __init__(self, kind):
        self.kind, self.rotate, self.weapon = kind, False, None


class _Return(Exception):
    pass


class _Loop(Exception):
    def __init__(self, kind):
        self.kind = kind


class Run:
    """the script of one object: Run(classes, class name of the script, object name).init() -> .parts"""

    def __init__(self, classes, cls, objname, has_captain=False):
        self.classes, self.cls, self.objname = classes, cls, objname
        self.has_captain = has_captain  # the tech tree gives it a captain class: m_xCaptain exists
        self.members = {}               # m_... variables, shared by the procedures
        self.relevant = _cache.get(('rel', id(classes)))
        for c in reversed(self.chain()):                 # class constants (MIRAGE: const vec3 CANNON_OFFSET_UPPER = {...})
            for k, v in (classes[c].get('consts') or {}).items():
                val = self.value(v, {})
                if val is not UNK:
                    self.members[k] = val
        self.parts = []                 # attach records in script order
        self.objs = 0
        self.main = None                # the main build-up (SetBuildUp)
        self.types = set()              # build-up types the object has
        self.extra = []                 # additional build-ups (AddAdditionalBuildUp)
        self.captain = None
        self.cap_anim = self.cap_attack = None
        self.guard = []                 # undecided conditions around the current statement
        self.ran = set()                # (class, proc) executed
        self.steps = 0
        self._trees = {}

    # ---- class chain
    def chain(self, cls=None):
        out, c, seen = [], cls or self.cls, set()
        while c and c in self.classes and c not in seen:
            seen.add(c); out.append(c)
            c = self.classes[c]['parent']
        return out

    def find(self, proc, after=None):
        """(class, params, statement tree) of a procedure in the class chain (after = start above that class)"""
        ch = self.chain()
        if after is not None:
            ch = ch[ch.index(after) + 1:] if after in ch else []
        for c in ch:
            p = self.classes[c]['procs'].get(proc)
            if p:
                tree = _TREES.get(id(p[1]))
                if tree is None:
                    tree = _TREES[id(p[1])] = parse_body(p[1])
                return c, p[0], tree
        return None

    # ---- running
    def call(self, proc, args=(), after=None, depth=0):
        if self.relevant is not None and proc not in self.relevant:
            return UNK
        hit = self.find(proc, after)
        if not hit or depth > MAX_DEPTH:
            return UNK
        cls, params, tree = hit
        self.ran.add((cls, proc))
        env = {'__cls': cls, '__proc': proc, '__depth': depth, '__ret': UNK}
        for k, p in enumerate(params):
            env[p] = args[k] if k < len(args) else UNK
        try:
            self.block(tree, env)
        except _Return:
            pass
        except _Loop:
            pass
        return env['__ret']

    def block(self, tree, env):
        for node in tree:
            self.steps += 1
            if self.steps > 200000:
                raise _Return()
            t = node[0]
            if t == 's':
                self.statement(node[1], env)
            elif t == 'if':
                self.branch(node, env)
            elif t == 'for':
                self.statement(node[1], env)
                self.loop(node[2], node[4], env, node[3])
            elif t == 'while':
                self.loop(node[1], node[2], env, None)

    def branch(self, node, env):
        arms, other = node[1], node[2]
        maybe = []
        for cond, body in arms:
            v = self.cond(cond, env)
            if v is True:
                if not maybe:
                    return self.block(body, env)
                maybe.append((cond, body))
                break
            if v is None:
                maybe.append((cond, body))
        else:
            if other is not None:
                if not maybe:
                    return self.block(other, env)
                maybe.append(('else', other))
        for cond, body in maybe:           # undecided: follow every possible arm, what it attaches is optional
            self.guard.append(' '.join(cond.split()))
            try:
                self.block(body, env)
            except (_Return, _Loop):
                pass
            finally:
                self.guard.pop()

    def loop(self, cond, body, env, step):
        for _ in range(MAX_LOOP):
            v = self.cond(cond, env)
            if v is False:
                return
            if v is None:
                self.guard.append('loop')
                try:
                    self.block(body, env)
                except (_Return, _Loop):
                    pass
                finally:
                    self.guard.pop()
                return
            try:
                self.block(body, env)
            except _Loop as e:
                if e.kind == 'break':
                    return
            if step:
                self.statement(step, env)

    # ---- conditions
    def cond(self, s, env):
        s = s.strip()
        parts = split_top(s, '||')
        if len(parts) > 1:
            vals = [self.cond(p, env) for p in parts]
            return True if True in vals else (None if None in vals else False)
        parts = split_top(s, '&&')
        if len(parts) > 1:
            vals = [self.cond(p, env) for p in parts]
            return False if False in vals else (None if None in vals else True)
        if s.startswith('!') and not s.startswith('!='):
            v = self.cond(s[1:], env)
            return None if v is None else not v
        if s.startswith('(') and _paren(s, 0) == len(s):
            return self.cond(s[1:-1], env)
        for op in ('==', '!=', '<=', '>=', '<', '>'):
            ps = split_top(s, op)
            if len(ps) == 2 and ps[0] and ps[1]:
                a, b = self.value(ps[0], env), self.value(ps[1], env)
                if op in ('==', '!='):
                    if ps[1] == 'null' or ps[0] == 'null':
                        o = a if ps[1] == 'null' else b
                        if isinstance(o, Obj):
                            return op == '!='
                        return None
                    if a is UNK or b is UNK:
                        return None
                    if isinstance(a, str) and isinstance(b, str):
                        a, b = a.lower(), b.lower()
                    return (a == b) if op == '==' else (a != b)
                if isinstance(a, (int, float)) and isinstance(b, (int, float)):
                    return {'<': a < b, '>': a > b, '<=': a <= b, '>=': a >= b}[op]
                return None
        m = re.match(r'^HasBuildUp\s*\(\s*(?:CBuildUpBase\.TYPE_(\w+))?\s*\)$', s)
        if m:
            return (m.group(1) in self.types) if m.group(1) else bool(self.types)
        v = self.value(s, env)
        return v if isinstance(v, bool) else None

    # ---- values
    def value(self, s, env):
        s = s.strip()
        if not s:
            return UNK
        if s[0] == '"' and s.find('"', 1) == len(s) - 1:
            return s[1:-1]
        if s in ('true', 'false'):
            return s == 'true'
        if s == 'p_bLoad':
            return False
        m = re.match(r'^-?\d+$', s)
        if m:
            return int(s)
        m = re.match(r'^-?\d*\.?\d+f?$', s)
        if m:
            return float(s.rstrip('f'))
        if s[0] == '{' and s[-1] == '}':
            v = [self.value(x, env) for x in split_top(s[1:-1])]
            return tuple(float(x) for x in v) if len(v) == 3 and all(isinstance(x, (int, float)) for x in v) else UNK
        if s.startswith('(') and _paren(s, 0) == len(s):
            return self.value(s[1:-1], env)
        m = re.match(r'^cast\s*<[^>]*>\s*\((.*)\)$', s)
        if m and _paren(s, s.index('(')) == len(s):
            return self.value(m.group(1), env)
        for op in ('+', '-', '*'):
            ps = split_top(s, op)
            if len(ps) > 1 and all(ps):
                vals = [self.value(p, env) for p in ps]
                if any(v is UNK for v in vals):
                    return UNK
                if op == '+' and any(isinstance(v, str) for v in vals):
                    return ''.join(str(v) for v in vals)
                if all(isinstance(v, (int, float)) for v in vals):
                    r = vals[0]
                    for v in vals[1:]:
                        r = r + v if op == '+' else r - v if op == '-' else r * v
                    return r
                return UNK
        if s == 'GetClassName()':
            return self.objname
        m = re.match(r'^(.*)\.ToString\(\)$', s)
        if m:
            v = self.value(m.group(1), env)
            return UNK if v is UNK else str(v)
        m = re.match(r'^(.*?)\^?\.(?:GetHandle|GetObj)\(\)$', s)
        if m:
            return self.value(m.group(1), env)
        m = re.match(r'^(\w+)\.NumEntries\(\)$', s)
        if m:
            v = env.get(m.group(1), UNK)
            return len(v) if isinstance(v, list) else UNK
        m = re.match(r'^(\w+)\[(.+)\]$', s)
        if m:
            arr, i = env.get(m.group(1), UNK), self.value(m.group(2), env)
            return arr[i] if isinstance(arr, list) and isinstance(i, int) and 0 <= i < len(arr) else UNK
        m = re.match(r'^(?:CSrvWrap\.GetObjMgr\(\)\^\.)CreateObj\s*\((.*)\)$', s)
        if m:
            cls = self.value(split_top(m.group(1))[0], env)
            if isinstance(cls, str):
                self.objs += 1
                return Obj(cls, self.objs)
            return UNK
        if re.match(r'^GetBuildUp\(\)$', s):
            return self.main if self.main else UNK
        m = re.match(r'^GetAdditionalBuildUp\((.+)\)$', s)
        if m:
            i = self.value(m.group(1), env)
            if isinstance(i, int) and 0 <= i < len(self.extra):
                return self.extra[i]
            return self.extra[-1] if self.extra and i is UNK else UNK
        if s == 'm_xCaptain':
            return self.the_captain() or UNK
        if s == 'GetHandle()':
            return SELF
        if re.match(r'^GetBuildUp\(\)\^?\.GetPrimaryLinkedObj\(\)$', s):
            return next((p['obj'] for p in self.parts if p['bu'] is self.main and self.main is not None), UNK)
        if re.match(r'^\w+$', s):
            return env[s] if s in env else self.members.get(s, UNK)
        return UNK

    def the_captain(self):
        if not self.captain and self.has_captain:
            self.objs += 1
            self.captain = Obj('universal_captain', self.objs)
            self.captain.main = True
        return self.captain

    def either(self, s, env):
        """a value, or the truth of a comparison (var bool bAje = sClass=="aje_triceratops_archer" || ...)"""
        v = self.value(s, env)
        if v is UNK and re.search(r'==|!=|\|\||&&|^\s*!', s):
            c = self.cond(s, env)
            if c is not None:
                return c
        return v

    # ---- statements
    def statement(self, s, env):
        s = s.strip()
        if not s:
            return
        if s.startswith('return'):
            rest = s[6:].strip()
            if rest:
                m = re.match(r'^super\.(\w+)\((.*)\)$', rest)
                v = self.call(m.group(1), [], after=env['__cls'], depth=env['__depth'] + 1) if m else self.value(rest, env)
                if env['__ret'] is UNK or not self.guard:
                    env['__ret'] = v
            if not self.guard:
                raise _Return()
            return
        if s in ('continue', 'break'):
            if not self.guard:
                raise _Loop(s)
            return
        m = re.match(r'^var\s+(array\s+)?(?:[\^\w.<>]+)\s+(.+)$', s, re.S)
        if m:
            for d in split_top(m.group(2)):
                nm, _, ex = d.partition('=')
                nm = nm.strip()
                if re.match(r'^\w+$', nm):
                    env[nm] = [] if m.group(1) else (self.either(ex, env) if ex.strip() else UNK)
            return
        m = re.match(r'^(\w+)\s*(\+\+|--)$', s)
        if m:
            v = env.get(m.group(1), UNK)
            if isinstance(v, int):
                env[m.group(1)] = v + (1 if m.group(2) == '++' else -1)
            return
        m = re.match(r'^(\w+)\s*=(?!=)\s*(.+)$', s, re.S)
        if m:
            v = self.either(m.group(2), env)
            if m.group(1).startswith('m_') and m.group(1) not in env:
                if m.group(1) == 'm_xCaptain':
                    if isinstance(v, Obj):
                        self.captain = v
                elif v is not UNK or not self.guard:
                    self.members[m.group(1)] = v
            else:
                env[m.group(1)] = v
            return
        m = re.match(r'^(\w+)\.AddEntry\((.*)\)$', s, re.S)
        if m:
            arr = env.get(m.group(1), UNK)
            if isinstance(arr, list):
                arr.append(self.value(m.group(2), env))
            return
        m = _ATTACH_RE.search(s)
        if m and _paren(s, m.end() - 1) == len(s):
            return self.attach(m.group(1), s[:m.start()], split_top(s[m.end():-1]), env)
        m = re.match(r'^(.*?)\^?\.(LinkAction|FlexLinkAction|RideAction)\s*\((.*)\)$', s, re.S)
        if m and m.group(1).strip():
            return self.link_action(m.group(2), m.group(1), split_top(m.group(3)), env)
        m = re.match(r'^SetBuildUp\s*\(\s*CBuildUpBase\.TYPE_(\w+)\s*\)$', s)
        if m:
            self.main = BuildUp(m.group(1)); self.types.add(m.group(1))
            return
        m = re.match(r'^AddAdditionalBuildUp\s*\(\s*CBuildUpBase\.TYPE_(\w+)\s*\)$', s)
        if m:
            self.extra.append(BuildUp(m.group(1)))
            return
        if re.match(r'^CreateCaptain\s*\(', s):
            self.has_captain = True
            self.the_captain()
            return
        m = re.match(r'^SetCaptain(Attack)?Anim\s*\(\s*"([^"]*)"', s)
        if m:
            if m.group(1):
                self.cap_attack = m.group(2)
            else:
                self.cap_anim = m.group(2)
            return
        m = re.match(r'^(.*?)\^?\.(SetGFX|SetAnim|SetCanRotate|SetWeaponClass)\s*\((.*)\)$', s, re.S)
        if m:
            o, a = self.value(m.group(1), env), split_top(m.group(3))
            v = self.value(a[0], env) if a else UNK
            if isinstance(o, Obj) and isinstance(v, str):
                if m.group(2) == 'SetGFX':
                    o.gfx = v
                elif m.group(2) == 'SetAnim':
                    o.anim = v
            elif isinstance(o, BuildUp):
                if m.group(2) == 'SetCanRotate' and v is True:
                    o.rotate = True
                elif m.group(2) == 'SetWeaponClass' and isinstance(v, str):
                    o.weapon = v
            return
        m = re.match(r'^super\.(\w+)\s*\((.*)\)$', s, re.S)
        if m:
            self.call(m.group(1), [self.value(a, env) for a in split_top(m.group(2)) if a], after=env['__cls'], depth=env['__depth'] + 1)
            return
        m = re.match(r'^(\w+)\s*\((.*)\)$', s, re.S)
        if m and self.find(m.group(1)) and (m.group(1), env['__cls']) != (env['__proc'], env['__cls']):
            self.call(m.group(1), [self.value(a, env) for a in split_top(m.group(2)) if a], depth=env['__depth'] + 1)

    def attach(self, fn, recv, args, env):
        ih, il, idl, ipa, iof, ian = ATTACH[fn]
        if len(args) <= il:
            return
        obj = self.value(args[ih], env)
        link = self.value(args[il], env)
        if not isinstance(obj, Obj) or not isinstance(link, str):
            return
        link = link[:4]                         # a link is a FourCC: "Rider" means the link "Ride"
        recv = re.sub(r'\^?\.\s*$', '', recv.strip())
        bu = self.value(recv, env) if recv else self.main
        parent = self.value(args[ipa], env) if ipa is not None and ipa < len(args) else None
        if not obj.captain and fn in ('AddObjCaptain', 'AddObjCaptainCust') and obj.cls.lower() != 'universal_captain':
            obj.captain = True                  # a character linked as a gunner
        off = self.value(args[iof], env) if iof is not None and iof < len(args) else None
        delay = self.value(args[idl], env) if idl is not None and idl < len(args) else None
        anim = self.value(args[ian], env) if ian is not None and ian < len(args) else None
        self.parts.append({'obj': obj, 'link': link, 'parent': parent if isinstance(parent, Obj) else None,
                           'offset': off if isinstance(off, tuple) and any(abs(x) > 1e-6 for x in off) else None,
                           'delay': delay if isinstance(delay, (int, float)) else None, 'bu': bu if isinstance(bu, BuildUp) else None,
                           'fn': fn, 'anim': anim if isinstance(anim, str) else None, 'guard': list(self.guard),
                           'proc': '%s.%s' % (env['__cls'], env['__proc'])})

    def link_action(self, fn, recv, args, env):
        """<object>^.LinkAction(parent, link[, offset]) / FlexLinkAction(parent, link, delay, offset, anim) /
        RideAction(parent, link, offset): the object links itself to a part (or to the unit: GetHandle())"""
        obj = self.value(recv, env)
        if not isinstance(obj, Obj) or len(args) < 2:
            return
        parent, link = self.value(args[0], env), self.value(args[1], env)
        if not isinstance(link, str) or link.upper() == 'NONE' or not (parent is SELF or isinstance(parent, Obj)):
            return
        if fn == 'RideAction' and obj is self.captain:
            return                              # the captain's seat: captain_link() answers that
        link = link[:4]
        io = {'LinkAction': 2, 'RideAction': 2, 'FlexLinkAction': 3}[fn]
        off = self.value(args[io], env) if io < len(args) else None
        delay = self.value(args[2], env) if fn == 'FlexLinkAction' and len(args) > 2 else None
        self.parts.append({'obj': obj, 'link': link, 'parent': parent if isinstance(parent, Obj) else None,
                           'offset': off if isinstance(off, tuple) and any(abs(x) > 1e-6 for x in off) else None,
                           'delay': delay if isinstance(delay, (int, float)) else None, 'bu': None, 'fn': fn, 'anim': None,
                           'guard': list(self.guard), 'proc': '%s.%s' % (env['__cls'], env['__proc']),
                           'turret': 'turret' in env['__proc'].lower() or 'turret' in ' '.join(args).lower()})

    # ---- entry points
    def init(self):
        self.call('OnInit', [False])
        # a class with its own LinkCaptainObj seats the captain itself (the velociraptor handler on its leash)
        hit = self.find('LinkCaptainObj')
        if hit and self.has_captain and self.classes[hit[0]]['parent'] and hit[0] != self.chain()[-1] and 'RideAction' not in self.classes[hit[0]]['procs']['LinkCaptainObj'][1]:
            self.call('LinkCaptainObj', [])
        self.seat0 = None if any(p['obj'] is self.captain for p in self.parts) else self.captain_link()
        self.types0 = set(self.types)
        return self

    def optional(self):
        """procedures of the script that attach something and did not run from OnInit (upgrade handlers ...): what
        they attach is optional"""
        for c in self.chain():
            for name, (params, body) in self.classes[c]['procs'].items():
                if (c, name) in self.ran or name in ('OnInit', 'GetCaptainLink', 'LinkCaptainObj', 'OnPostLoad', 'Load', 'Save') or not _ATTACH_RE.search(body) or 'CreateObj' not in body:
                    continue
                if self.find(name)[0] != c:              # overridden further down the chain
                    continue
                self.guard.append('in ' + name)
                try:
                    self.call(name, [])
                finally:
                    self.guard.pop()
        return self

    def captain_link(self):
        """GetCaptainLink of the class chain -> (link, on the build-up?, idle animation, attack animation) or None"""
        hit = self.find('GetCaptainLink')
        if not hit:
            return None
        cls, params, tree = hit
        self.cap_anim = self.cap_attack = None
        env = {'__cls': cls, '__proc': 'GetCaptainLink', '__depth': 0, '__ret': UNK}
        try:
            self.block(tree, env)
        except (_Return, _Loop):
            pass
        ret = env['__ret']
        link = env.get(params[0]) if params else None
        up = None
        c = cls
        while not isinstance(link, str):             # "return super.GetCaptainLink(...)": the parent's answer
            nxt = self.find('GetCaptainLink', after=c)
            if not nxt or ret is False:
                break
            c, params2, tree2 = nxt
            env = {'__cls': c, '__proc': 'GetCaptainLink', '__depth': 0, '__ret': UNK}
            try:
                self.block(tree2, env)
            except (_Return, _Loop):
                pass
            ret = env['__ret']
            link = env.get(params2[0]) if params2 else None
            params = params2
        if ret is False or not isinstance(link, str):
            return None
        link = link[:4]
        up = env.get(params[1]) if len(params) > 1 else False
        return link, up is True, self.cap_anim, self.cap_attack


# ====================================================================== entries
def _gfx(classes_txt, name):
    c = classes_txt.get((name or '').lower())
    return (c.get('gfx') if c and c.get('gfx') else name or '').lower()


def _captain(tt, tribe, node):
    """(captain class, gfx, level variants or None) of a transport from the tech tree"""
    cc = node.get('captainclass')
    if not isinstance(cc, str) or cc in ('', '0'):
        return None
    objs = tt.get('StartTT', {}).get('Objects') or {}
    cn = None
    for t in [tribe] + [x for x in objs if x != tribe]:
        chtr = (objs.get(t) or {}).get('CHTR') or {}
        cn = next((v for k, v in chtr.items() if k.lower() == cc.lower() and isinstance(v, dict)), None)
        if cn:
            break
    if not cn or not isinstance(cn.get('gfx'), str):
        return cc, cc.lower(), None
    g = cn['gfx']
    var = [(g[:-1] + str(lv + 1)).lower() for lv in range(5)] if re.search(r'_s\d$', g.lower()) else None
    return cc, g.lower(), var


def _weapon_parts(tt, tribe, user):
    """[(weapon name, level, slot, gfx class, link)] of a character from the tech tree (primary weapons with parts)"""
    out = []
    objs = tt.get('StartTT', {}).get('Objects') or {}
    for wn, w in ((objs.get(tribe) or {}).get('Weapons') or {}).items():
        if not isinstance(w, dict):
            continue
        users = [str(v).lower() for v in (w.get('Users') or {}).values()] if isinstance(w.get('Users'), dict) else []
        if user.lower() not in users or str(w.get('secondary', '0')) != '0' or not isinstance(w.get('Parts'), dict):
            continue
        try:
            lvl = int(w.get('level', '0') or 0)
        except ValueError:
            lvl = 0
        for p in w['Parts'].values():
            if not isinstance(p, dict):
                continue
            g0 = (p.get('Gfx') or {}).get('0') if isinstance(p.get('Gfx'), dict) else None
            if g0:
                out.append((wn, lvl, str(w.get('slot', '0')), g0, p.get('Links') or ''))
    return out


def entries(run, tt, classes_txt, tribe, typ, name, node):
    """the raw add-on entries (data/composites.json format, plus 'offset') of one object from its script run"""
    out = []
    cap = _captain(tt, tribe, node)
    main_obj = next((p['obj'] for p in run.parts if p['bu'] is run.main and not p['obj'].captain), None)

    def gfx_of(o):
        return o.gfx.lower() if o.gfx else _gfx(classes_txt, o.cls)

    # an object the script links twice (AddObj, then AddObjCustomized with an offset): the later link is the one
    parts, at = [], {}
    for p in run.parts:
        k = id(p['obj'])
        if k in at and not p['guard'] and not parts[at[k]]['guard']:
            parts[at[k]] = p
        else:
            if not p['guard']:
                at[k] = len(parts)
            parts.append(p)
    seen_cap = False
    explicit_hosts = []
    for p in parts:
        o = p['obj']
        e = {'link': p['link'], 'parent': gfx_of(p['parent']) if p['parent'] else '', 'source': p['proc'], 'derived': True}
        if p['offset']:
            e['offset'] = [round(x, 4) for x in p['offset']]
        guard = [g for g in p['guard'] if g]
        e['when'] = 'always' if not guard else 'optional: ' + '; '.join(guard)
        if o.captain:
            if not cap and not o.gfx:
                continue
            e.update(kind='rider', gfx=o.gfx.lower() if o.gfx else cap[1])
            if not o.gfx and cap[2]:
                e.update(variants=cap[2], variant_rule='level')
            if not o.gfx:
                e['captainclass'] = cap[0]
            e['anim'] = o.anim or (run.cap_anim if getattr(o, 'main', False) else None) or None
            if getattr(o, 'main', False):
                if guard and p['parent'] is not None:      # seated by an upgrade: the seat on that build-up
                    e['when'], e['seat_for'] = 'with build-up', [gfx_of(p['parent'])]
                    explicit_hosts.append(p['parent'])
                else:
                    seen_cap = True
                if run.cap_attack:
                    e['attack_anim'] = run.cap_attack
        else:
            bu = p['bu']
            if p.get('turret'):
                kind = 'turret'
            elif p['link'].lower() == 'db_1':
                kind = 'drawbar'
            elif p['parent'] is not None and (p['delay'] or 0) > 0:
                kind = 'wagon'
            elif bu is not None and (bu.rotate or bu.kind.startswith('WEAPON')):
                kind = 'turret'
            else:
                kind = 'buildup'
            e.update(kind=kind, gfx=gfx_of(o))
            if p['anim']:
                e['anim'] = p['anim']
        out.append(e)
    # the main rider: where GetCaptainLink puts the captain (when the script did not link it itself). A unit whose
    # upgrades add a build-up has two seats: one without it, one on the build-up.
    if cap and not seen_cap and typ in ('ANML', 'VHCL', 'SHIP'):
        seat0 = getattr(run, 'seat0', None)
        types0 = set(getattr(run, 'types0', run.types))
        seats, moved = [], list(explicit_hosts)
        # each kind of optional build-up (an upgrade) may move the rider: ask GetCaptainLink with that build-up on
        kinds = []
        for p in run.parts:
            if p['guard'] and p['bu'] is not None and not p['obj'].captain and p['bu'].kind not in kinds and p['bu'].kind not in types0:
                kinds.append(p['bu'].kind)
        all_types = set(run.types)
        for k in kinds:
            run.types = types0 | {k}
            cl = run.captain_link()
            if cl and cl != seat0:
                hosts = [p['obj'] for p in run.parts if p['guard'] and p['bu'] is not None and p['bu'].kind == k and not p['obj'].captain
                         and p['obj'] not in explicit_hosts]
                if not hosts:
                    continue
                seats.append((cl, 'with', hosts))
                moved += hosts
        run.types = all_types
        seats.insert(0, (seat0, 'without' if moved else 'base', moved))
        for cl, mode, hosts in seats:
            if not cl:
                continue
            link, on_bu, anim, attack = cl
            host = main_obj if mode != 'with' else (hosts[0] if hosts else main_obj)
            e = {'kind': 'rider', 'gfx': cap[1], 'link': link, 'parent': gfx_of(host) if on_bu and host else '',
                 'captainclass': cap[0], 'source': 'GetCaptainLink', 'derived': True,
                 'when': {'base': 'always (owned unit, tech tree captainclass)', 'without': 'without build-up', 'with': 'with build-up'}[mode]}
            if mode != 'base':
                e['seat_for'] = sorted({gfx_of(h) for h in hosts})
            if cap[2]:
                e.update(variants=cap[2], variant_rule='level')
            if anim:
                e['anim'] = anim
            elif not on_bu:
                e['anim'] = 'ride_idle_0'
            if attack:
                e['attack_anim'] = attack
            out.append(e)
    # level flag of mounts (TransportObj.usl): shown where the model (or its main build-up) has a "flag" link
    if typ in ('ANML', 'VHCL', 'SHIP') and tribe in ('Hu', 'Aje', 'Ninigi', 'SEAS') and cap:
        flags = ['%s_animal_flag_0%d' % (tribe.lower(), i) for i in range(1, 6)]
        out.append({'kind': 'other', 'gfx': flags[0], 'variants': flags, 'variant_rule': 'level', 'link': 'flag', 'parent': '',
                    'when': 'always (owned); model by unit level', 'source': 'TransportObj.usl', 'derived': True, 'needs_link': True})
    # weapons: the rider's, or the character's own
    riders = [e for e in out if e['kind'] == 'rider' and e.get('captainclass')]
    if riders:
        weps = _weapon_parts(tt, tribe, riders[0]['captainclass'])
        for r in riders[:1]:
            for wn, lvl, slot, g0, link in weps:
                if link:
                    out.append({'kind': 'weapon', 'gfx': _gfx(classes_txt, g0), 'link': link, 'parent': r['gfx'], 'weapon': wn,
                                'when': 'held by the rider at unit level >= %d' % max(1, lvl), 'source': 'tech tree', 'derived': True})
    if typ == 'CHTR':
        seen = {}
        for wn, lvl, slot, g0, link in _weapon_parts(tt, tribe, name):
            g, link = _gfx(classes_txt, g0), link or 'HndR'
            if (g, link) in seen:
                seen[(g, link)]['weapon'] += ', ' + wn
                continue
            e = {'kind': 'weapon', 'gfx': g, 'link': link, 'parent': '', 'weapon': wn, 'source': 'tech tree', 'derived': True,
                 'when': 'unit level >= %d while it is the best weapon of its slot' % lvl}
            seen[(g, link)] = e
            out.append(e)
    # the same part linked twice (a procedure that ran from OnInit and again as an upgrade handler): once, always
    # (two parts that are both always there stay two: the gunners of two equal turrets)
    fixed = {(e['kind'], e['gfx'], e['link'], e['parent']) for e in out if e['when'].startswith('always')}
    uniq, seen = [], {}
    for e in out:
        k = (e['kind'], e['gfx'], e['link'], e['parent'], tuple(e.get('offset') or ()))
        always = e['when'].startswith('always')
        if not always and k[:4] in fixed:
            continue
        if k in seen and not (always and seen[k]['when'].startswith('always')):
            if always:
                uniq[uniq.index(seen[k])] = e; seen[k] = e
            continue
        seen[k] = e
        uniq.append(e)
    order = ['turret', 'buildup', 'drawbar', 'wagon', 'rider', 'weapon', 'tool', 'container', 'other']
    uniq.sort(key=lambda e: (e['parent'] != '', order.index(e['kind'])))      # a part after the part it hangs on
    return uniq


def derive_one(install, tt, classes_txt, tribe, typ, name, node):
    """the script-derived entries of one tech tree object ([] when its class has no script or attaches nothing)"""
    sc = script_classes(install)
    c = classes_txt.get(name.lower()) or {}
    cls = c.get('classname')
    cc = node.get('captainclass')
    run = Run(sc, cls if cls in sc else None, name, has_captain=isinstance(cc, str) and cc not in ('', '0'))
    run.seat0, run.types0 = None, set()
    if run.cls:
        try:
            run.init().optional()
        except RecursionError:
            pass
    return entries(run, tt, classes_txt, tribe, typ, name, node)


VERSION = '6'


def table(install, tt, classes_txt, skip=(), cache_dir=None):
    """{object name (lower case): raw entries} of every tech tree object not in `skip` whose script attaches
    something. Kept in a cache file per configuration (the scripts' names, sizes and times decide when it is redone)."""
    import hashlib
    import json
    from . import gamedata
    files = install.files('Scripts/Server/classes/**/*.usl') + [f for f in [install.file(gamedata.TECHTREE)] if f]
    sig = hashlib.sha1()
    sig.update(('%s|%s|' % (VERSION, '+'.join(install.mods))).encode())
    for f in files:
        try:
            st = os.stat(f)
            sig.update(('%s:%d:%d|' % (f, st.st_size, int(st.st_mtime))).encode())
        except OSError:
            pass
    path = os.path.join(cache_dir, 'modparts_%s.json' % sig.hexdigest()[:16]) if cache_dir else None
    if path:
        try:
            with open(path, encoding='utf-8') as f:
                return json.load(f)
        except (OSError, ValueError):
            pass
    low = {s.lower() for s in skip}
    out = {}
    for tribe, typ, name, node in gamedata.objects(tt):
        if name.lower() in low or name.lower() in out:
            continue
        try:
            e = derive_one(install, tt, classes_txt, tribe, typ, name, node)
        except Exception:                                  # a script the reader cannot follow: no add-ons for it
            e = []
        if e:
            out[name.lower()] = e
    if path:
        try:
            with open(path + '.tmp', 'w', encoding='utf-8') as f:
                json.dump(out, f)
            os.replace(path + '.tmp', path)
        except OSError:
            pass
    return out


def normalize(raw):
    """composites.normalize() of derived entries, keeping what it does not know: offset, derived, needs_link; an
    optional part stays off by default (cond 'special')"""
    out = composites.normalize(raw)
    optional = [n['i'] for n, e in zip(out, raw) if n['kind'] in ('buildup', 'turret') and e.get('when', '').startswith('optional')]
    for n, e in zip(out, raw):
        n['derived'] = True
        if n['kind'] == 'rider' and e.get('seat_for') is not None:
            hosts = [i for i in optional if out[i]['gfx'] in e['seat_for']]
            n['cond'], n['arg'] = ('buildup' if e.get('when') == 'with build-up' else 'unless'), hosts
        if e.get('offset'):
            n['offset'] = e['offset']
        if e.get('needs_link'):
            n['needs_link'] = True
        if e.get('variant_rule') == 'level':
            n['by'] = 'level'
    return out


def main(argv=None):
    """python -m pwexport.modparts <game folder> [mod id]
    without a mod: the self-check - the reader runs on the base game (Base + BoosterPack1) and its build-ups, turrets,
    wagons and riders are compared with the hand-made table (data/composites.json);
    with a mod: what the reader finds for the objects the table does not know."""
    import sys
    import collections
    from . import gamedata, mods
    argv = sys.argv[1:] if argv is None else argv
    mod = argv[1] if len(argv) > 1 else 'BoosterPack1'
    inst = mods.ModInstall(argv[0], mod)
    tt, cl = gamedata.techtree(inst), gamedata.classes(inst)
    known = composites.raw()
    kinds = ('turret', 'buildup', 'drawbar', 'wagon', 'rider')

    def key(e):
        return ('bu' if e['kind'] in ('turret', 'buildup') else e['kind'], e['gfx'].lower(), e['link'], (e.get('parent') or '').lower())
    same = diff = 0
    for tribe, typ, name, node in gamedata.objects(tt):
        d = derive_one(inst, tt, cl, tribe, typ, name, node)
        if len(argv) > 1:
            if name.lower() not in known and d:
                print('%-5s %-34s %s' % (typ, name, ' | '.join('%s %s@%s%s%s%s' % (
                    e['kind'], e['gfx'], e['link'], ('<' + e['parent']) if e['parent'] else '', ' +offset' if e.get('offset') else '',
                    '' if e['when'].startswith('always') else ' (optional)') for e in d if e['kind'] in kinds)))
            continue
        if name.lower() in known:
            a = collections.Counter(key(e) for e in d if e['kind'] in kinds)
            b = collections.Counter(key(e) for e in known[name.lower()] if e['kind'] in kinds)
            if a == b:
                same += 1
            else:
                diff += 1
                print('differs: %-28s table only %s   scripts only %s' % (name, sorted(dict(b - a)), sorted(dict(a - b))))
    if len(argv) < 2:
        print('%d objects of the table read the same from the scripts, %d differ' % (same, diff))
        return 0 if same >= 170 else 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
