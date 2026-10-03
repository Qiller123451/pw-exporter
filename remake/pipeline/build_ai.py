"""Step "ai": the tables of the original computer player -> <OUT>/ai.json (read by src/game/ai/data.js).

The original AI is script code (Data/<mod>/Scripts/Ai/**.usl) plus settings text files (Scripts/Ai/settings/**):
    behaviours, difficulty levels      Modules/AiModuleControlDefault.usl (SetBehavior, SetDifficulty, the gifts in Think)
    worker caps, squad sizes           Modules/AiModuleEconomyDefault.usl, the attack goals
    build orders, upgrades, heroes     goals/AiGoalBuildVillage.usl
    attack plans                       goals/AiGoalDisturbAttack.usl
    armies, unit mix, point buy        settings/<Tribe>/*.txt, settings/*.txt
    object data                        Server/settings/Techtree/_AI_ObjectData.txt
    handicaps by difficulty            Server/misc/Player.usl, RequirementsMgr.usl, classes/task/Action.usl, FightingObj.usl
Nothing is typed in by hand: the script tables are read with a small "conditional call" extractor (if / elseif
chains with literal arguments), so mods and other installations give their own values. A file that is missing (the
Hu and Ninigi settings folders of some installations) leaves its table out; the game then derives it from the tech
tree. See docs/spec/ai.md section 12 for the keys.

    python -m remake.pipeline.build_ai <Data folder> <output folder>
"""
import json
import os
import re
import sys

try:
    from . import paths
except ImportError:
    import paths

TRIBES = ['Hu', 'Aje', 'Ninigi', 'SEAS']
# the Server scripts read (also the step's inputs, with Scripts/Ai and the object data file)
SERVER_FILES = ['Server/misc/Player.usl', 'Server/misc/RequirementsMgr.usl', 'Server/classes/task/Action.usl',
                'Server/classes/FightingObj/FightingObj.usl']
OBJECT_DATA = 'Server/settings/Techtree/_AI_ObjectData.txt'


# ------------------------------------------------------------------ files
def _mods():
    """the official mod folders of the installation in override order (Base, BoosterPack1): the rules come from
    them only, as for the tech tree (pwexport.install)"""
    from pwexport.install import Install
    return list(Install(paths.DATA).mods)


def _find(rel):
    """Scripts/<rel> in the last mod that has it (case-insensitive), or None"""
    hit = None
    for m in _mods():
        p = paths.ci(os.path.join(paths.DATA, m, 'Scripts', rel))
        if os.path.isfile(p):
            hit = p
    return hit


def _read(rel):
    p = _find(rel)
    if not p:
        return None
    with open(p, 'rb') as f:
        return f.read().decode('latin-1').replace('\r', '')


def _listdir(rel):
    out = {}
    for m in _mods():
        d = paths.ci(os.path.join(paths.DATA, m, 'Scripts', rel))
        if os.path.isdir(d):
            for n in os.listdir(d):
                out[n.lower()] = os.path.join(d, n)
    return out


def _tree(path_or_text, is_text=False):
    from pwexport import tree
    if not is_text:
        with open(path_or_text, 'rb') as f:
            path_or_text = f.read().decode('latin-1')
    t = tree.parse(path_or_text.replace('\r', ''), inherit=False)
    return t.get('Root', t)


# ------------------------------------------------------------------ the script reader
_COMMENT = re.compile(r'/\*.*?\*/|//[^\n]*', re.S)


def _code(text):
    """script text without comments (string literals with // do not occur in the AI scripts' tables)"""
    return _COMMENT.sub(lambda m: ' ' * 0 if '\n' not in m.group(0) else '\n' * m.group(0).count('\n'), text)


def _procs(text, name):
    """bodies of every proc called `name` (overloads) -> [(start line, body)]"""
    out = []
    for m in re.finditer(r'\bproc\s+[\w^.<>, ]+?\s+%s\s*\(' % re.escape(name), text):
        e = text.find('endproc', m.end())
        if e < 0:
            continue
        out.append((text.count('\n', 0, m.start()) + 1, text[m.end():e]))
    return out


def _paren(s, i):
    """s[i] == '(' -> index after the matching ')'"""
    d = 0
    q = False
    while i < len(s):
        c = s[i]
        if c == '"':
            q = not q
        elif not q:
            if c == '(':
                d += 1
            elif c == ')':
                d -= 1
                if d == 0:
                    return i + 1
        i += 1
    return len(s)


def _args(s):
    """split a call's argument text at top-level commas; string literals lose their quotes"""
    out, d, q, cur = [], 0, False, ''
    for c in s:
        if c == '"':
            q = not q
            cur += c
        elif not q and c in '({':
            d += 1
            cur += c
        elif not q and c in ')}':
            d -= 1
            cur += c
        elif not q and c == ',' and d == 0:
            out.append(cur.strip())
            cur = ''
        else:
            cur += c
    if cur.strip():
        out.append(cur.strip())
    return [a[1:-1] if len(a) >= 2 and a[0] == '"' and a[-1] == '"' else a for a in out]


_KW = re.compile(r'\b(elseif|if|else|endif)\b')


def _nows(s):
    """without white space, except inside string literals ("Single 04")"""
    return ''.join(p if i % 2 else re.sub(r'\s+', '', p) for i, p in enumerate(s.split('"'))).join(['', '']) if '"' not in s else \
        '"'.join(p if i % 2 else re.sub(r'\s+', '', p) for i, p in enumerate(s.split('"')))


def walk(body, events, line0=1):
    """Walk a proc body. `events` = {name: regex}; yields (name, match, conditions, line) for every regex hit, where
    conditions = the if-conditions that hold there: the current branch's condition as written, earlier branches of
    the same chain as '!<condition>'. The match's text position lets callers read call arguments (see call())."""
    stack = []          # frames: [earlier branch conditions..., current]
    pos = 0
    ev = [(n, re.compile(r)) for n, r in events.items()]
    while pos < len(body):
        nxt = _KW.search(body, pos)
        best = None
        for n, r in ev:
            m = r.search(body, pos)
            if m and (best is None or m.start() < best[1].start()):
                best = (n, m)
        if best and (not nxt or best[1].start() < nxt.start()):
            conds = []
            for fr in stack:
                conds += ['!' + c for c in fr[:-1] if c] + ([fr[-1]] if fr[-1] else [])
            yield best[0], best[1], conds, line0 + body.count('\n', 0, best[1].start())
            pos = best[1].end()
            continue
        if not nxt:
            break
        kw = nxt.group(1)
        pos = nxt.end()
        if kw in ('if', 'elseif'):
            i = body.find('(', pos)
            j = _paren(body, i)
            cond = _nows(body[i + 1:j - 1])
            # calls inside the condition itself (if(!pxT^.LoadValueTable(..))then) belong to the enclosing branch
            outer = []
            for fr in (stack[:-1] if kw == 'elseif' else stack):
                outer += ['!' + c for c in fr[:-1] if c] + ([fr[-1]] if fr[-1] else [])
            for n, r in ev:
                for m in r.finditer(body, i, j):
                    yield n, m, outer, line0 + body.count('\n', 0, m.start())
            pos = j
            if kw == 'if':
                stack.append([cond])
            elif stack:
                stack[-1].append(cond)
        elif kw == 'else':
            if stack:
                stack[-1].append('')          # '' = "none of the above"
        elif kw == 'endif':
            if stack:
                stack.pop()


def call(body, m):
    """arguments of the call whose name the match ends with ('Name(' matched up to and including the paren)"""
    i = m.end() - 1
    j = _paren(body, i)
    return _args(body[i + 1:j - 1])


def _strip(c):
    while c.startswith('(') and _paren(c, 0) == len(c):
        c = c[1:-1]
    return c


def _split_and(c):
    """top-level && parts of a condition"""
    c = _strip(c)
    parts, d, q, cur, i = [], 0, False, '', 0
    while i < len(c):
        ch = c[i]
        if ch == '"':
            q = not q
        if not q and ch == '(':
            d += 1
        elif not q and ch == ')':
            d -= 1
        if not q and d == 0 and c.startswith('&&', i):
            parts.append(_strip(cur))
            cur = ''
            i += 2
            continue
        cur += ch
        i += 1
    parts.append(_strip(cur))
    return [p for p in parts if p]


_ATOMS = [
    (r'^(?:m_s|s)Tribe=="(\w+)"$', lambda m: ('tribe', m.group(1))),
    (r'^(?:m_s|s)Behaviou?r=="(\w)\w*"$', lambda m: ('behaviour', m.group(1))),
    (r'^\(?(?:m_s|s)Behaviou?r=="(\w)"\)?\|\|\(?(?:m_s|s)Behaviou?r=="\w+"\)?$', lambda m: ('behaviour', m.group(1))),
    (r'^(?:iAge|m_iCurrentAge)>=(\d)$', lambda m: ('minAge', int(m.group(1)))),
    (r'^(?:iAge|m_iCurrentAge)==(\d)$', lambda m: ('age', int(m.group(1)))),
    (r'^m_bMultimap$', lambda m: ('multimap', True)),
    (r'^!m_bMultimap$', lambda m: ('multimap', False)),
    (r'^m_sGametype!="Defender"$', lambda m: ('defenderGame', False)),
    (r'^m_sGametype=="Defender"$', lambda m: ('defenderGame', True)),
    (r'^!m_bDefenderplayer$', lambda m: ('defender', False)),
    (r'^m_bDefenderplayer$', lambda m: ('defender', True)),
    (r'^m_sLevelName=="([^"]+)"$', lambda m: ('level', m.group(1))),
    (r'^m_sLevelName!="([^"]+)"$', lambda m: ('notLevel', m.group(1))),
    (r'^m_iPlayerID==(\d)$', lambda m: ('player', int(m.group(1)))),
    (r'^m_iAttackType==(\d)$', lambda m: ('tactic', int(m.group(1)))),
]
_ATOMS = [(re.compile(r), f) for r, f in _ATOMS]
# conditions that never matter for the tables (guards, the AI-assist switch, list bookkeeping)
_DROP = re.compile(r'==null|!=null|^!m_bAssistEnabled$|FindInRequests|NumEntries\(\)|^iType>0$|^m_i\w*Counter|^!m_bScouting$')


def classify(conds, alias=None, pos=0):
    """conditions of walk() -> {structured keys..., when: [raw atoms], not: [{...} of earlier branches]}"""
    out, when, nots = {}, [], []
    for c in conds:
        neg = c.startswith('!') and not _strip(c[1:]).startswith('m_b') and c[1:2] != 'm'
        # '!cond' from an earlier branch is marked by walk(); a written negation like !m_bMultimap is an atom
        if c.startswith('!') and (c[1:] in _raw_seen):
            neg = True
        if neg:
            d = classify(_split_and(c[1:]), alias, pos)
            d.pop('not', None)
            if d.get('when') == []:
                d.pop('when')
            if d:
                nots.append(d)
            continue
        for a in _split_and(c):
            if alias:
                a = alias(a, pos)
            if _DROP.search(a):
                continue
            for r, f in _ATOMS:
                m = r.match(a)
                if m:
                    k, v = f(m)
                    out[k] = v
                    break
            else:
                when.append(a)
    out['when'] = when
    if nots:
        out['not'] = nots
    return out


_raw_seen = set()


def rows(body, events, line0=1, alias=None):
    """walk() + classify(): yields (name, match, row dict, line)"""
    hits = list(walk(body, events, line0))
    _raw_seen.clear()
    for _, _, conds, _ in hits:
        for c in conds:
            if not c.startswith('!'):
                _raw_seen.add(c)
    # every branch condition ever written (for telling an earlier-branch negation from a written "!x")
    for m in re.finditer(r'\b(?:else)?if\s*\(', body):
        i = m.end() - 1
        _raw_seen.add(_nows(body[i + 1:_paren(body, i) - 1]))
    for n, m, conds, line in hits:
        yield n, m, classify(conds, alias, m.start()), line


def _num(s, d=0.0):
    try:
        return float(s)
    except (TypeError, ValueError):
        return d


def _clean(row):
    """drop the mutually exclusive negations that carry no information (other tribes / behaviours / ages)"""
    nots = []
    for d in row.get('not', []):
        keys = set(d) - {'when'}
        if keys and keys <= {'tribe', 'behaviour', 'minAge', 'age'} and not d.get('when'):
            if any(k in row for k in keys) or keys <= {'tribe', 'behaviour'}:
                continue
        nots.append(d)
    if nots:
        row['not'] = nots
    else:
        row.pop('not', None)
    if not row.get('when'):
        row.pop('when', None)
    return row


# ------------------------------------------------------------------ control module: behaviours, difficulty
def behaviours(cm):
    out = {}
    for _, body in _procs(cm, 'SetBehavior'):
        ev = {'set': r'm_x([EFDA])Module\.SetBehavior\(', 'table': r'LoadValueTable\(', 'pause': r'SetPaused\(',
              'off': r'm_xEModule\.(?:Shut|Deactivate)\(', 'wash': r'BrainWash\(', 'type': r'SetBehaviorType\(',
              'sub': r'm_sSubStrategy\s*=\s*', 'kg': r'SetKindergardenEnabled\(', 'rnd': r'Random\.GetInt\(\)%(\d+)'}
        for n, m, conds, _ in walk(body, ev):
            name = None
            for c in conds:
                mm = re.match(r'^p_sBehavior=="(\w+)"$', c)
                if mm:
                    name = mm.group(1)
            if not name or name.startswith('AIAssist'):
                continue
            b = out.setdefault(name, {'economy': [], 'fight': [], 'defense': [], 'area': [], 'params': {},
                                      'valueTable': None, 'subStrategy': None, 'variants': 1, 'paused': False,
                                      'economyOff': False, 'brainWash': False, 'personality': name, 'kindergarten': False})
            if n == 'set':
                a = call(body, m)
                raw = body[m.end():_paren(body, m.end() - 1) - 1]
                cmd = re.sub(r'"\s*\+\s*m_sSubStrategy', '{sub}"', raw)
                cmd = re.sub(r'"\s*\+\s*sPos', '{pos}"', cmd)
                cmd = re.sub(r'"\s*\+\s*[\w.()]+', '{n}"', cmd).strip().strip('"')
                key = {'E': 'economy', 'F': 'fight', 'D': 'defense', 'A': 'area'}[m.group(1)]
                b[key].append(cmd)
                t = cmd.split(' ')
                if len(t) == 2:
                    b['params'][t[0]] = t[1] if not re.match(r'^-?[\d.]+$', t[1]) else float(t[1])
                elif len(t) == 1:
                    b['params'][t[0]] = True
            elif n == 'table':
                a = body[m.end():_paren(body, m.end() - 1) - 1]
                mm = re.search(r'/(\w+)"\s*\+\s*GetDifficulty|/(\w+)\.txt', a)
                b['valueTable'] = (mm.group(1) or mm.group(2)) if mm else name      # a variable: "/<tribe>/<behaviour><class>.txt"
            elif n == 'pause':
                b['paused'] = True
            elif n == 'off':
                b['economyOff'] = True
            elif n == 'wash':
                b['brainWash'] = True
            elif n == 'type':
                a = call(body, m)
                if a and a[0] != 'p_sBehavior':
                    b['personality'] = a[0]
            elif n == 'sub':
                mm = re.match(r'"(\w+)"(\s*\+)?', body[m.end():m.end() + 20])
                if mm:
                    b['subStrategy'] = mm.group(1) + ('{n}' if mm.group(2) else '')
            elif n == 'kg':
                b['kindergarten'] = call(body, m)[:1] == ['true']
            elif n == 'rnd':
                b['variants'] = int(m.group(1))
    return out


def by_difficulty(text, proc, var, fields):
    """{d: {field: value}} from an `if(<var>==N)then a=1; b=2; elseif ... else ...` chain inside a proc.
    fields = {name: regex with one group}; the final else is difficulty 9 (or everything above the listed ones)"""
    out = {}
    for _, body in (_procs(text, proc) if proc else [(1, text)]):
        ev = {k: v for k, v in fields.items()}
        seen = set()
        for n, m, conds, _ in walk(body, ev):
            d = None
            for c in conds:
                mm = re.match(r'^%s==(\d+)$' % re.escape(var), _strip(c))
                if mm:
                    d = int(mm.group(1))
            if d is None:
                if any(re.match(r'^!\(?%s==\d+\)?$' % re.escape(var), c) for c in conds) and \
                        not any(re.match(r'^%s' % re.escape(var), _strip(c)) for c in conds):
                    d = 'else'
                else:
                    continue
            seen.add(d)
            out.setdefault(d, {})[n] = m.group(1)
    if 'else' in out:
        e = out.pop('else')
        for d in range(10):
            out.setdefault(d, e)
    return out


def by_class(text, proc, fields, var=r'(?:\w+\^?\.GetDifficulty\(\)|m_sDifficulty|sDifficulty)'):
    """{Easy|Medium|Hard: {field: value}} from an if(class=="Easy") ... elseif(=="Medium") ... else chain"""
    out = {}
    for _, body in (_procs(text, proc) if proc else [(1, text)]):
        for n, m, conds, _ in walk(body, fields):
            k = None
            for c in conds:
                mm = re.match(r'^%s=="(\w+)"$' % var, _strip(c))
                if mm:
                    k = mm.group(1)
            if k is None and any(re.match(r'^!\(?%s=="\w+"\)?$' % var, c) for c in conds):
                k = 'Hard'
            if k and n not in out.setdefault(k, {}):
                out[k][n] = m.group(1)
    return out


def difficulty(cm, goals, server, ch):
    levels = {}
    num = r'\s*=\s*(-?[\d.]+)'
    base = by_difficulty(cm, 'SetDifficulty', 'p_iDifficulty',
                         {'class': r'm_sDifficulty\s*=\s*"(\w+)"', 'wait': r'm_iDifficulty' + num, 'controlWait': r'SetThinkWait\((\d+)'})
    for d in range(10):
        b = base.get(d, {})
        levels[d] = {'class': b.get('class', 'Hard'), 'wait': int(_num(b.get('wait'), 10)), 'controlWait': int(_num(b.get('controlWait'), 20)),
                     'gift': {'food': 0, 'wood': 0, 'stone': 0, 'skulls': 0}, 'attackStrength': 0.65, 'quickAttackStrength': 0.6,
                     'pyramidAttackUnits': 10, 'gather': 1, 'buildTime': 1, 'researchTime': 1,
                     'unitLimit': {'levels': [0, 0, 0, 0, 0], 'total': 0}, 'weaponDuration': 1}
    # gifts: GetCheatMgr().SpawnResources("food", 50) per GetOldDifficultyInt()
    for _, body in _procs(cm, 'Think'):
        for n, m, conds, _ in walk(body, {'gift': r'SpawnResources\('}):
            a = call(body, m)
            for c in conds:
                mm = re.match(r'^GetOldDifficultyInt\(\)==(\d)$', _strip(c))
                if mm and len(a) == 2:
                    levels[int(mm.group(1))]['gift'][{'iron': 'skulls'}.get(a[0], a[0])] = int(_num(a[1]))
    for key, f, var, fld in (('attackStrength', 'AiGoalSuicideAttack.usl', 'iDifficulty', 'm_fAttackStrength'),
                             ('quickAttackStrength', 'AiGoalQuickAttack.usl', 'iDifficulty', 'm_fAttackStrength'),
                             ('pyramidAttackUnits', 'AiGoalPyramidAttack.usl', 'iDifficulty', 'm_iShouldHave')):
        t = goals.get(f.lower())
        if not t:
            continue
        for d, v in by_difficulty(t, 'Init', var, {key: fld + num}).items():
            levels[d][key] = _num(v[key]) if key != 'pyramidAttackUnits' else int(_num(v[key]))
    # handicaps in the Server scripts (iDiff / iDff = the slot's "Difficulty")
    pl, rq, ac, fo = (server.get(k) for k in SERVER_FILES)
    if pl:
        for d, v in by_difficulty(pl, 'AddResource', 'iDiff', {'gather': r'fNewValue\*=(-?[\d.]+)'}).items():
            levels[d]['gather'] = _num(v['gather'], 1)
    if ac:
        # two chains in one block: research (Actions/Upgrades|Invent) first, everything else second
        m = re.search(r'begin\s+AIHelp;(.*?)end\s+AIHelp;', ac, re.S)
        if m:
            seen = {}
            for n, mm, conds, _ in walk(m.group(1), {'t': r'm_xDuration\*=(-?[\d.]+)'}):
                d = next((int(x.group(1)) for x in (re.match(r'^iDiff==(\d)$', _strip(c)) for c in conds) if x), None)
                if d is None:
                    continue
                research = any('Upgrades' in c and not c.startswith('!') for c in conds)
                levels[d]['researchTime' if research else 'buildTime'] = _num(mm.group(1), 1)
    if rq:
        cur = None
        for line in rq.split('\n'):
            mm = re.search(r'iDff\s*==\s*(\d)', line)
            if mm:
                cur = int(mm.group(1))
            mm = re.search(r'aiMaxUnits\[(\d)\]\s*\+=\s*(\d+)', line)
            if mm and cur is not None:
                levels[cur]['unitLimit']['levels'][int(mm.group(1))] = int(mm.group(2))
            mm = re.search(r'iMaxUnits\s*\+=\s*(\d+)', line)
            if mm and cur is not None:
                levels[cur]['unitLimit']['total'] = int(mm.group(1))
    if fo:
        for _, body in _procs(fo, 'GetAICheatModifier'):
            for mm in sorted(re.finditer(r'iDiff\s*>=\s*(\d)\s*\)\s*then\s*fValue\s*=\s*([\d.]+)', body), key=lambda x: int(x.group(1))):
                for d in range(int(mm.group(1)), 10):
                    levels[d]['weaponDuration'] = _num(mm.group(2), 1)
    out = {'levels': {str(d): v for d, v in levels.items()}}
    # the gift as actually given (CAiCheatMgr.SpawnResources): fixed amounts by class on skirmish maps, +N on others
    gm = {'skirmish': {}, 'campaignAdd': 10}
    if ch:
        for _, body in _procs(ch, 'SpawnResources'):
            for n, m, conds, _ in walk(body, {'v': r'i(Food|Wood|Stone|Iron)\s*=\s*(\d+)\s*;', 'add': r'iFood\s*=\s*p_iValue\s*\+\s*(\d+)'}):
                if n == 'add':
                    gm['campaignAdd'] = int(m.group(1))
                    continue
                k = next((x.group(1) for x in (re.match(r'^m_pxCM\^\.GetDifficulty\(\)=="(\w+)"$', _strip(c)) for c in conds) if x), None)
                if k:
                    gm['skirmish'].setdefault(k, {})[{'Iron': 'skulls'}.get(m.group(1), m.group(1).lower())] = int(m.group(2))
    out['gift'] = gm
    return out


def squads(goals, em, bs, kg):
    """pool units an attack goal adds (min / max / allowed share of "bad" units) per difficulty class"""
    sq = {}
    for f, t in sorted(goals.items()):
        mm = re.match(r'aigoal(\w+?)attack\.usl$', f)
        if not mm:
            continue
        r = by_class(t, 'Think', {'min': r'iMinUnits\s*=\s*(\d+)', 'max': r'iMaxUnits\s*=\s*(\d+)', 'bad': r'fBad\s*=\s*([\d.]+)'})
        if r:
            army = re.search(r'GetUnits\("(\w+?)_?"\s*(\+)?', t)
            sq[mm.group(1)] = {k: {'min': int(_num(v.get('min'))), 'max': int(_num(v.get('max'))), 'bad': _num(v.get('bad'), 1)} for k, v in r.items()}
            if army:
                sq[mm.group(1)]['army'] = army.group(1) + ('_{age}' if army.group(2) else '')
    workers = {}
    if em:
        cur = None
        for _, body in _procs(em, 'ComputeMaxWorkersPerAge'):
            for n, m, conds, _ in walk(body, {'w': r'm_aiMaxWorkersPerAge\[(\d)\]\s*=\s*(\d+)'}):
                k = next((x.group(1) for x in (re.match(r'^\w+\^\.GetDifficulty\(\)=="(\w+)"$', _strip(c)) for c in conds) if x), 'Hard')
                workers.setdefault(k, [0] * 6)[int(m.group(1))] = int(m.group(2))
    out = {'maxWorkersPerAge': {k: v[1:] for k, v in workers.items()}, 'squad': sq}
    if bs:
        r = by_class(bs, None, {'t': r'm_iTimout\s*=\s*m_iTimoutInit\s*=\s*(\d+)'})
        out['squadTimeout'] = {k: int(_num(v['t'])) for k, v in r.items()}
    if kg:
        r = by_class(kg, 'Init', {'t': r'SetThinkWait\((\d+)\)'})
        out['kindergartenWait'] = {k: int(_num(v['t'])) for k, v in r.items()}
    return out


# ------------------------------------------------------------------ build village
def _request(a, onTop):
    """AddRequest(name[, objFlag], count, unique[, pos]) in its overloads"""
    if len(a) >= 4 and not re.match(r'^-?\d+$', a[1]):
        name, flag, cnt, uniq = a[0], a[1], a[2], a[3]
    else:
        name, flag, cnt, uniq = a[0], '', a[1] if len(a) > 1 else '1', a[2] if len(a) > 2 else 'true'
    return {'request': name, 'objFlag': flag, 'count': int(_num(cnt, 1)), 'unique': uniq == 'true', 'onTop': onTop}


def build_lists(bv):
    out = {'buildOrders': [], 'fightUpgrades': [], 'heroRequests': [], 'housing': [], 'counterShips': [], 'storage': []}
    ev = {'add': r'\bAddRequest(OnTop)?\('}
    for key, proc in (('buildOrders', 'UpdateBuildList'), ('fightUpgrades', 'CheckForFightUpgrades'), ('heroRequests', 'UpdateSpecialBuildList'),
                      ('housing', 'CheckForUnitLimit'), ('counterShips', 'CheckForEnemyShips'), ('storage', 'RequestMoreResourceBuilding')):
        for line0, body in _procs(bv, proc):
            # "var ^CAiNodeInstance pxNIWarrior=m_pxTT^.GetNodeInstanceFromPartialName("hu_warrior", "")" + a count
            # check on it = "the player owns such a unit"
            assigns = [(m.start(), m.group(1), m.group(2)) for m in re.finditer(r'(\w+)\s*=\s*m_pxTT\^\.GetNodeInstanceFromPartialName\("(\w+)"', body)]

            def alias(atom, pos, assigns=assigns):
                def cls(var):
                    hit = [c for p, v, c in assigns if v == var and p < pos]
                    return hit[-1] if hit else var
                m = re.match(r'^m_pxTT\^\.GetAllNodeInstanceCount\((\w+)\^\.GetTTPath\(\)\)(>0|<=0)$', atom)
                if m:
                    return ('has:' if m.group(2) == '>0' else '!has:') + cls(m.group(1))
                m = re.match(r'^(\w+)\^\.GetInstanceCount\(\)<\1\^\.GetMaxInstanceCount\(\)$', atom)
                if m:
                    return 'canBuild:' + cls(m.group(1))
                m = re.match(r'^px(Stone|Wood|Food)NI\^\.GetInstanceCount\(\)>=px\1NI\^\.GetMaxInstanceCount\(\)$', atom)
                if m:
                    return 'full:' + m.group(1).lower()
                return atom.replace('m_iHeroes==', 'heroSet==')
            for n, m, row, line in rows(body, ev, line0, alias):
                a = call(body, m)
                if not a or not re.match(r'^[\w/]+$', a[0]):
                    continue
                r = _request(a, bool(m.group(1)))
                r.update(_clean(row))
                r['line'] = line
                if key == 'heroRequests':
                    hs = [w for w in r.get('when', []) if w.startswith('heroSet==')]
                    r['set'] = int(hs[0][9:]) if hs else 0
                    r.pop('when', None)
                    r.pop('not', None)
                out[key].append(r)
    return out


# ------------------------------------------------------------------ attack plans
def attack_plans(da):
    plans = []
    for line0, body in _procs(da, 'CheckTacticalConditionsAndAct'):
        i = body.find('asAttacks.AddEntry("none")')
        j = body.find('m_bWarpGateHunt', i)
        if i < 0:
            continue
        seg = body[i:j if j > 0 else len(body)]
        l0 = line0 + body.count('\n', 0, i)
        cur = None
        for n, m, row, line in rows(seg, {'reset': r'asAttacks\s*=\s*0\s*;', 'add': r'asAttacks\.AddEntry\("(\w+)"\)',
                                          'guer': r'bGuerillaAttack\s*=\s*\(Random\.GetInt\(\)%100<=(\d+)\)'}, l0):
            row = _clean(row)
            key = json.dumps({k: v for k, v in row.items()}, sort_keys=True)
            if not row:
                continue                                  # the five defaults in front of the table
            if cur is None or cur['_key'] != key:
                cur = dict(row)
                cur.update({'attacks': [], 'guerilla': 0, 'appended': True, 'line': line, '_key': key})
                plans.append(cur)
            if n == 'reset':
                cur['appended'] = False
            elif n == 'add':
                cur['attacks'].append(m.group(1))
            elif n == 'guer':
                cur['guerilla'] = int(m.group(1)) + 1     # "% 100 <= 10" = 11 %
    for p in plans:
        p.pop('_key', None)
    return [p for p in plans if p['attacks']]


def outposts(bo):
    """BuildOutpost.RequestNext: type -> tribe -> [{request, count, when}]"""
    out = {}
    if not bo:
        return out
    for line0, body in _procs(bo, 'RequestNext'):
        for n, m, row, line in rows(body, {'add': r'\bCreateRequest\('}, line0):
            a = call(body, m)
            if not a or not re.match(r'^[\w/]+$', a[0]):
                continue
            when = row.get('when', [])
            typ = next((re.search(r'"(\w+)"', w).group(1) for w in when if w.startswith('m_sType==')), 'default')
            e = {'request': a[0], 'count': int(_num(a[2] if len(a) > 2 else 1, 1)), 'when': [w for w in when if not w.startswith('m_sType')]}
            if a[1:2] and a[1] and re.match(r'^\w+$', a[1]):
                e['objFlag'] = a[1]
            for k in ('minAge', 'age'):
                if k in row:
                    e[k] = row[k]
            out.setdefault(typ, {}).setdefault(row.get('tribe', 'any'), []).append(e)
    return out


def level_caps(kg):
    """Kindergarten.CheckIfMaxLevelIsReached: class -> {free: levels below this always level up, last: [level, chance %]}"""
    caps = {}
    for _, body in _procs(kg, 'CheckIfMaxLevelIsReached'):
        for n, m, conds, _ in walk(body, {'ok': r'bOK\s*=\s*(true|false|\(Random\.GetInt\(\)%100<=(\d+)\))'}):
            cls = next((x.group(1) for x in (re.match(r'^sClassName=="(\w+)"$', _strip(c)) for c in conds) if x), None)
            if not cls:
                continue
            c = caps.setdefault(cls, {'free': 0, 'last': None})
            lv = [(_strip(x)) for x in conds if _strip(x).startswith('iLevel')]
            if not lv:
                if m.group(1) == 'true':
                    c['free'] = 5
                continue
            mm = re.match(r'^iLevel(<|==|<=)(\d)$', lv[-1])
            if not mm:
                continue
            op, v = mm.group(1), int(mm.group(2))
            if m.group(1) == 'true':
                c['free'] = max(c['free'], v if op == '<' else v + 1)
            elif m.group(2) is not None:
                c['last'] = [v, int(m.group(2)) + 1]
    return caps


def spawn_levels(ch):
    lv = {}
    for _, body in _procs(ch, 'GetProperLevel'):
        for m in re.finditer(r'p_sClassName\s*==\s*"(\w+)"\s*\)\s*then\s*return\s+(\d)', body):
            lv[m.group(1)] = int(m.group(2))
    return lv


# ------------------------------------------------------------------ settings text files
def army_table(path):
    """Root { <Army> { Group0 { Priority = '1.0'  Units0 = '1-4' { cls = '' | cls { level = '1' ObjFlag = '..' } } } } }"""
    out = {}
    for army, node in _tree(path).items():
        if not isinstance(node, dict):
            continue
        units = []
        for g, (gname, gnode) in enumerate(sorted(((k, v) for k, v in node.items() if isinstance(v, dict)), key=lambda kv: kv[0])):
            for uname, unode in gnode.items():
                if not uname.lower().startswith('units') or not isinstance(unode, dict):
                    continue
                mm = re.match(r'^\s*(\d+)\s*-\s*(\d+)', str(unode.get('_value', '1-1')))
                e = {'min': int(mm.group(1)) if mm else 1, 'max': int(mm.group(2)) if mm else 1, 'alternatives': []}
                if g:
                    e['group'] = g
                pr = gnode.get('Priority')
                for cls, c in unode.items():
                    if cls == '_value':
                        continue
                    alt = {'cls': cls}
                    if isinstance(c, dict):
                        if c.get('level') not in (None, ''):
                            alt['level'] = int(_num(c.get('level')))
                        if c.get('ObjFlag'):
                            alt['objFlag'] = c['ObjFlag']
                    e['alternatives'].append(alt)
                if e['alternatives']:
                    units.append(e)
        out[army] = units
    return out


def unit_mix(path):
    """Root { Age_n { Level_n { GroupN = '<weight>' { cls = '<npc>' { nonchar = ''  ObjFlag = '..' } } } } }"""
    out = {}
    for age, anode in _tree(path).items():
        if not isinstance(anode, dict):
            continue
        for lvl, lnode in anode.items():
            if not isinstance(lnode, dict):
                continue
            groups = []
            for gname, g in lnode.items():
                if not isinstance(g, dict):
                    continue
                e = {'weight': _num(g.get('_value'), 1), 'units': []}
                for cls, c in g.items():
                    if cls == '_value':
                        continue
                    u = {'cls': cls}
                    npc = c.get('_value') if isinstance(c, dict) else c
                    if npc:
                        u['npc'] = npc
                    if isinstance(c, dict):
                        if 'nonchar' in c:
                            u['nonchar'] = True
                        if c.get('ObjFlag'):
                            u['objFlag'] = c['ObjFlag']
                    e['units'].append(u)
                groups.append(e)
            out.setdefault(age, {})[lvl] = groups
    return out


def point_buy(path):
    out = {}
    for credits, n in _tree(path).items():
        if not isinstance(n, dict):
            continue
        ch = n.get('Chars') or {}
        rs = n.get('Resources') or {}
        out[credits] = {'chars': [v for k, v in ch.items() if k != '_value' and isinstance(v, str)],
                        'resources': {k: int(_num(rs.get(k))) for k in ('food', 'wood', 'stone', 'iron')}}
    return out


def efficient(path):
    """CompareValue.txt: Root { CHTR { hu_warrior ... } ... }: unit classes that are good against a target type"""
    with open(path, 'rb') as f:
        text = f.read().decode('latin-1').replace('\r', '')
    out, cur = {}, None
    for line in text.split('\n'):
        s = line.split('//')[0].strip()
        m = re.match(r'^(\w+)\s*\{$', s)
        if m:
            if m.group(1) != 'Root':
                cur = out.setdefault(m.group(1), [])
            continue
        if s == '}':
            cur = None
        elif cur is not None and re.match(r'^\w+$', s):
            cur.append(s)
    return out


def object_data(text):
    out = {}
    objs = (_tree(text, True).get('Objects') or {})
    for name, o in objs.items():
        if not isinstance(o, dict):
            continue
        out[name] = {'type': o.get('FourCC'), 'tribe': o.get('Tribe'),
                     'boni': {k: int(_num(o.get('Boni_' + k))) for k in ('CHTR', 'ANML', 'VHCL', 'BLDG')},
                     'skulls': [int(_num(o.get('Skulls_Lvl%d' % i))) for i in range(5)], 'threat': _num(o.get('Threat'), 1)}
    return out


# ------------------------------------------------------------------ the step
def build():
    """-> the ai.json object"""
    src = {'mods': _mods(), 'tribes': [], 'files': []}
    cm = _read('Ai/Modules/AiModuleControlDefault.usl')
    if cm is None:
        raise FileNotFoundError('Scripts/Ai/Modules/AiModuleControlDefault.usl not found under ' + paths.DATA)
    cm = _code(cm)
    goals = {n: _code(open(p, 'rb').read().decode('latin-1').replace('\r', '')) for n, p in _listdir('Ai/goals').items() if n.endswith('.usl')}
    em = _read('Ai/Modules/AiModuleEconomyDefault.usl')
    bs = _read('Ai/tasks/AiTaskBuildSquad.usl')
    ch = _read('Ai/misc/AiImprovementMgr.usl')
    server = {k: (_code(t) if t else None) for k, t in ((k, _read(k)) for k in SERVER_FILES)}
    bv = goals.get('aigoalbuildvillage.usl', '')
    da = goals.get('aigoaldisturbattack.usl', '')
    kg = goals.get('aigoalkindergarten.usl', '')
    out = {'schema': 1, 'source': src, 'behaviours': behaviours(cm)}
    out['difficulty'] = difficulty(cm, goals, server, _code(ch) if ch else '')
    out['difficulty'].update(squads(goals, _code(em) if em else '', _code(bs) if bs else '', kg))
    out.update(build_lists(bv))
    out['attackPlans'] = attack_plans(da)
    out['outposts'] = outposts(goals.get('aigoalbuildoutpost.usl'))
    out['levelCaps'] = level_caps(kg)
    out['spawnLevels'] = spawn_levels(_code(ch)) if ch else {}
    # settings text files
    st = _listdir('Ai/settings')
    out['armies'], out['unitMix'], out['pointBuy'] = {}, {}, {}
    gen = {}
    for n, p in sorted(st.items()):
        m = re.match(r'^aipbpreset(\w+)\.txt$', n)
        if m and os.path.isfile(p):
            gen[os.path.basename(p)[10:-4]] = point_buy(p)
    if gen:
        out['pointBuy']['generic'] = gen
    out['efficient'] = efficient(st['comparevalue.txt']) if 'comparevalue.txt' in st else {}
    for tribe in TRIBES:
        files = _listdir('Ai/settings/' + tribe)
        if not files:
            continue
        src['tribes'].append(tribe)
        for n, p in sorted(files.items()):
            base = os.path.basename(p)[:-4]
            if not n.endswith('.txt'):
                continue
            if n.startswith('aipbpreset'):
                out['pointBuy'].setdefault(tribe, {})[base[10:]] = point_buy(p)
            elif n.startswith('units'):
                out['unitMix'].setdefault(tribe, {})[base[5:] or 'default'] = unit_mix(p)
            else:
                out['armies'].setdefault(tribe, {})[base] = army_table(p)
    od = _read(OBJECT_DATA)
    out['objectData'] = object_data(od) if od else {}
    return out


def run(log=print, progress=None):
    data = build()
    f = os.path.join(paths.OUT, 'ai.json')
    with open(f + '.tmp', 'w', encoding='utf-8') as fh:
        json.dump(data, fh, separators=(',', ':'))
    os.replace(f + '.tmp', f)
    log('ai tables: %d behaviours, %d build entries, %d attack plans, armies of %s, %d objects (%d KB)' % (
        len(data['behaviours']), len(data['buildOrders']), len(data['attackPlans']), '/'.join(sorted(data['armies'])) or 'no tribe',
        len(data['objectData']), os.path.getsize(f) // 1024))
    return data


if __name__ == '__main__':
    paths.configure(sys.argv[1], sys.argv[2])
    run()
