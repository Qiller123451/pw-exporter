"""Multi-part objects: which models the game scripts attach to a unit or building, where, and when.

The table data/composites.json was datamined from the UrsRel scripts (docs/COMPOSITES.md, tools/datamine). Each entry
has a free-text "when"; normalize() turns the table into machine-readable conditions, used by the Model Exporter
(default add-ons) and by the remake (which parts a live unit shows):

    parts = normalized()['seas_wehrspinne']
    [{'i': 0, 'kind': 'turret', 'gfx': 'seas_wehrspinne_top', 'link': 'we', 'pi': -1, 'cond': 'always', ...},
     {'i': 1, 'kind': 'rider', 'gfx': 'seas_rider_b', 'link': 'Dri1', 'pi': 0, 'anim': 'balista_stand', ...}]

Fields of a normalized part
    i        index in the object's list           pi    index of the part it hangs on (-1 = the object's own model)
    kind     turret | buildup | drawbar | wagon | rider | weapon | tool | container | other
    gfx      model; variants = alternatives, by = 'level' | 'epoch' | 'random' | None (how a variant is chosen:
             variants[level-1] / variants[epoch-1])
    link     attachment point (node link_<name> on the parent)
    anim     animation the part plays (idle), attack_anim on attack
    cond     always | construction | ready | upgrade | invent | buildup | unless | activation | special
             | weapon | tool | carry
    arg      upgrade / invention id (cond upgrade / invent), build-up part indices (buildup / unless)
    when     the original free-text condition (for people)
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
_cache = None


def raw():
    with open(os.path.join(HERE, 'data', 'composites.json'), encoding='utf-8') as f:
        return json.load(f)


def _by(rule):
    rule = (rule or '').lower()
    if 'epoch' in rule:
        return 'epoch'
    if 'level' in rule:
        return 'level'
    if 'random' in rule:
        return 'random'
    return None


def _cond(e):
    w = (e.get('when') or '').strip()
    lw = w.lower()
    k = e['kind']
    if k in ('weapon',):
        return 'weapon', None
    if k == 'tool':
        return 'tool', None
    if k == 'container':
        return 'carry', None
    if 'under construction' in lw:
        return 'construction', None
    m = re.match(r'after upgrade (\S+)', w)
    if m:
        return 'upgrade', m.group(1)                    # filter path, e.g. Aje/Upgrades/aje_stegosaurus/aje_stegosaurus_transporter
    m = re.match(r'after invention (\S+)', w)
    if m:
        return 'invent', m.group(1).split('/')[-1]
    if lw.startswith('after activation'):
        return 'activation', None
    if lw.startswith('when ready') or lw.startswith('when the building is ready'):
        return 'ready', None
    if lw.startswith('with build-up') or re.match(r'with \w+ build-up', lw):
        return 'buildup', w
    if lw.startswith('without build-up') or '(without build-up)' in lw:
        return 'unless', w
    if lw.startswith('always (water spray') or 'separate object' in lw or 'fishing' in lw or 'special move' in lw \
            or 'loaded rockets' in lw:
        return 'special', None
    if lw.startswith('always'):
        return 'always', None
    return 'special', None


def normalize(parts):
    out = []
    for i, e in enumerate(parts):
        cond, arg = _cond(e)
        n = {'i': i, 'kind': e['kind'], 'gfx': e['gfx'].lower(), 'variants': [v.lower() for v in e.get('variants') or []],
             'by': _by(e.get('variant_rule')), 'link': e['link'], 'parent': (e.get('parent') or '').lower(), 'pi': -1,
             'anim': (e.get('anim') or '').split(' ')[0] or None, 'attack_anim': e.get('attack_anim'),
             'cond': cond, 'arg': arg, 'when': e.get('when', ''), 'flex': bool(e.get('flex_link'))}
        if e.get('weapon'):
            n['weapon'] = e['weapon']
        out.append(n)
    # parent part: the entry whose model is the parent. Several parts of the same model (the titan's two ballistas)
    # are told apart by the link named in the child's condition ("gunner of the con3 ballista"), else in order.
    used = {}
    for n in out:
        if not n['parent']:
            continue
        cands = [p for p in out if p is not n and p['kind'] not in ('weapon', 'tool', 'container')
                 and (p['gfx'] == n['parent'] or n['parent'] in p['variants'])]
        if not cands:
            continue
        pick = None
        if len(cands) > 1:
            for p in cands:
                if re.search(r'\b%s\b' % re.escape(p['link']), n['when']):
                    pick = p
            if pick is None:
                k = used.get(n['parent'], 0)
                pick = cands[k % len(cands)]
                used[n['parent']] = k + 1
        else:
            pick = cands[0]
        n['pi'] = pick['i']
    # build-up conditions -> indices of the build-up parts
    bups = [p for p in out if p['kind'] == 'buildup' and p['cond'] == 'upgrade']
    for n in out:
        if n['cond'] == 'buildup':
            txt = n['arg'].lower()
            hit = [p['i'] for p in bups if p['gfx'] in txt or p['gfx'].split('_')[-1] in txt]
            if not hit and n['pi'] >= 0:
                hit = [n['pi']]
            n['arg'] = hit
        elif n['cond'] == 'unless':
            txt = n['arg'].lower()
            rest = txt.split('without build-up', 1)[1]
            allowed = [p['i'] for p in bups if p['gfx'].split('_')[-1] in rest] if (',' in rest or ' or ' in rest) else []
            n['arg'] = [p['i'] for p in bups if p['i'] not in allowed]
    return out


def normalized():
    """{object name (lowercase): [normalized parts]} for every object of the table"""
    global _cache
    if _cache is None:
        _cache = {k: normalize(v) for k, v in raw().items()}
    return _cache


def models(parts):
    """every model a list of parts can show (for asset builds)"""
    out = set()
    for p in parts:
        out.add(p['gfx'])
        out.update(p['variants'])
    return out
