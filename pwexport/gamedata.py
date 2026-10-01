"""The game's rule files, read live from the installation.

    tt = techtree(install)            # Root of _TechTree.ttree (BoosterPack1's copy if present)
    classes(install)                  # {'hu_warrior': {'classname': 'CHu', 'gfx': 'hu_warrior_s1', ...}, ...}
    script_tree(install, 'Scripts/Game/misc/IdleAnims.txt')    # any settings file, parsed
    object_gfx(tt, tribe, name)       # [(label, gfx), ...] every model an object can show (levels, upgrades)
"""
import glob
import os
import re

from . import tree

TECHTREE = 'Scripts/Server/settings/techtree/_TechTree.ttree'
TRIBES = ['Hu', 'Aje', 'Ninigi', 'SEAS']
OBJECT_TYPES = ['CHTR', 'ANML', 'VHCL', 'SHIP', 'BLDG']


def techtree(install):
    """the parsed tech tree (dict 'StartTT', 'Filters', ...). BoosterPack1 (the last official patch) overrides Base."""
    return tree.parse(install.read_text(TECHTREE))['Root']


def script_tree(install, rel):
    return tree.parse(install.read_text(rel), inherit=True).get('Root', {})


def classes(install):
    """object class definitions (Scripts/Server/classes/**/*.txt "classattribs"): name -> attributes.
    BoosterPack1 overrides Base."""
    out = {}
    for mod in install.mods:
        base = os.path.join(install.data, mod)
        for f in sorted(glob.glob(os.path.join(base, 'Scripts', 'Server', 'classes', '**', '*.txt'), recursive=True)):
            try:
                with open(f, encoding='latin-1') as fh:
                    root = tree.parse(fh.read(), inherit=True).get('Root', {})
            except Exception:
                continue
            if not isinstance(root, dict):
                continue
            for name, o in root.items():
                ca = isinstance(o, dict) and o.get('classattribs')
                if isinstance(ca, dict):
                    d = {k: v for k, v in ca.items() if isinstance(v, str)}
                    if 'gfx' in d:
                        d['gfx'] = d['gfx'].lower()
                    out[name.lower()] = d
    return out


def objects(tt):
    """yield (tribe, type, name, node) for every object of the tech tree"""
    for tribe, O in (tt.get('StartTT', {}).get('Objects') or {}).items():
        if not isinstance(O, dict):
            continue
        for typ in OBJECT_TYPES:
            for name, o in (O.get(typ) or {}).items():
                if isinstance(o, dict):
                    yield tribe, typ, name, o


def object_gfx(tt, tribe, name, node=None):
    """every model an object can show: [(label, gfx)], label 'Level 2' / '<upgrade name>' / '' (the start look).
    Taken from the level filters (LevelBonusData gfx or "replace .../<name>/gfx" modificators) and upgrades."""
    node = node or {}
    out = []
    g = tree.scalar(node.get('gfx'))
    if g and g != '0':
        out.append(('', g))
    ups = (((tt.get('Filters') or {}).get(tribe) or {}).get('Upgrades') or {}).get(name) or {}
    suffix = '/%s/gfx' % name.lower()
    for k, f in ups.items():
        if not isinstance(f, dict):
            continue
        m = re.match(r'Lvl(\d)_Bonus$', k)
        label = ('level %s' % m.group(1)) if m else k
        lbd = f.get('LevelBonusData') or {}
        cand = []
        if isinstance(lbd, dict) and tree.scalar(lbd.get('gfx')):
            cand.append(tree.scalar(lbd['gfx']))
        for mod in (f.get('Modificators') or {}).values():
            if isinstance(mod, dict) and str(mod.get('path', '')).lower().endswith(suffix) and isinstance(mod.get('value'), str):
                cand.append(mod['value'])
        for c in cand:
            if c and c != '0':
                out.append((label, c))
    return out
