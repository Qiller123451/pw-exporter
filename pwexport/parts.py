"""Which parts of a model show, from the GSF mesh attribute flags (node extras "attr" of an --all-parts conversion).
Python twin of the remake's src/engine/parts.js and of the app's web/parts.js - keep the three in step.

Raw attribute bits of a mesh chunk:
  0-4   LOD mask (bit 0 = full detail)                9-13  epoch variants I..V (buildings)
  18    selection / pick volume                       19    shadow model
  20    night-only lights (buildings)                 21-24 construction levels 0..3
  25    finished building                             26    intact   27 damage stage 1   28 damage stage 2
Animals / vehicles / characters use script flags (FightingObj.usl VIS_FLAG_*) instead:
  5 party colour, 6 saddle, 7 helmet, 8 armour, 9 standard, 10 armour saddle, 11 misc, 16 "activated" (healer kit)
  20..27 wounds (arm l/r, leg l/r, belly l/r, head, tail) shown as hit points drop

These are the game's rules ("In-game look" presets of the app). The app's Visibility checkboxes are a plain filter on
top: with bits ticked, a mesh shows exactly when it has every ticked bit set (web/parts.js apply, filterMask).

    visible_nodes(gltf_json, owned=True)                  -> set of mesh node names the game would show
    flag_groups(gltf_json)                                -> the toggles the app offers for this model
"""
DYNAMIC = ('Anim', 'Vehi', 'Char')
FLAG_NAMES = {5: 'party colour', 6: 'saddle', 7: 'helmet', 8: 'armour', 9: 'standard', 10: 'armour saddle', 11: 'misc',
              12: 'flag 12', 13: 'flag 13', 14: 'flag 14', 15: 'flag 15', 16: 'activated', 17: 'flag 17',
              20: 'wound: left arm', 21: 'wound: right arm', 22: 'wound: left leg', 23: 'wound: right leg',
              24: 'wound: belly left', 25: 'wound: belly right', 26: 'wound: head', 27: 'wound: tail'}


def static_sig(a):
    prog = ((a >> 21) & 0xF) | (((a >> 25) & 1) << 4)
    cond = (a >> 26) & 7
    age = (a >> 9) & 0x1F
    return (prog or 0x1F) | ((cond or 7) << 5) | ((age or 0x1F) << 8)


def sig_visible(sig, level, dmg, age):
    return bool((sig >> level) & 1 and (sig >> (5 + dmg)) & 1 and (sig >> (7 + age)) & 1)


# per model type (FourCC): which helper bits exist (web/parts.js FLAGS has the full name table)
SELVOL = {'Char', 'Ress', 'Bldg', 'Deko', 'Vehi', 'Fiel', 'Misc', 'Anim', 'Vgtn', 'RIVR'}
NIGHT = {'Bldg', 'Deko', 'Fiel', 'Misc', 'Ship'}
STATES = {'Bldg', 'Wall', 'Fiel', 'Misc', 'Deko', 'Vgtn', 'Ship'}      # construction / damage / epoch bits 9-13, 21-28


def helper(a, fourcc):
    if (a >> 18) & 1 and fourcc in SELVOL:
        return 'pick'
    if (a >> 19) & 1 and fourcc == 'Vgtn':
        return 'billboard'
    if (a >> 19) & 1 and fourcc not in ('Anim', 'Char'):
        return 'shadow'
    if (a >> 20) & 1 and fourcc in NIGHT:
        return 'night'
    if a & 0x1F and not a & 1:
        return 'lod'
    return None


def _fourcc(j):
    try:
        return (j['nodes'][j['scenes'][0]['nodes'][0]].get('extras') or {}).get('fourcc', '')
    except (KeyError, IndexError):
        return ''


def mesh_nodes(j):
    return [n for n in j.get('nodes', []) if 'mesh' in n and 'attr' in (n.get('extras') or {})]


def _is_hull(j, n):
    """flag-less low-poly hulls (whole-object pick / collision volumes without any part flags)"""
    if n['extras']['attr'] >> 5 or 'skin' in n:
        return False
    cnt, mn, mx = 0, [1e9] * 3, [-1e9] * 3
    for p in j['meshes'][n['mesh']]['primitives']:
        a = j['accessors'][p['attributes']['POSITION']]
        cnt += a['count']
        if 'min' in a:
            mn = [min(x, y) for x, y in zip(mn, a['min'])]; mx = [max(x, y) for x, y in zip(mx, a['max'])]
    return 0 < cnt <= 24 and max(b - a for a, b in zip(mn, mx)) > 8


def _is_fx(j, n):
    """sprite clouds of effects (billboards with a particle_* texture: smoke, dust, sparks)"""
    if (n.get('extras') or {}).get('kind') != 'foliage':
        return False
    return any(str(j['materials'][p['material']].get('name', '')).lower().startswith('particle')
               for p in j['meshes'][n['mesh']]['primitives'] if 'material' in p)


def visible_nodes(j, owned=True, flags=None, level=4, dmg=0, age=None, night=False, fx=False):
    """mesh node names shown in the default in-game look (or the given state)"""
    fourcc = _fourcc(j)
    nodes = mesh_nodes(j)
    if age is None:       # the most advanced epoch the model has
        ages = {k for n in nodes for k in range(5) if (n['extras']['attr'] >> (9 + k)) & 1} if fourcc in STATES else set()
        age = max(ages) + 1 if ages else 1
    show_flags = {5: owned, 6: owned, 7: owned, 8: False, 9: owned, 10: False, 11: True, 16: False}
    for b in range(20, 28):
        show_flags[b] = False
    if flags:
        show_flags.update({int(k): bool(v) for k, v in flags.items()})
    out = set()
    for n in nodes:
        a = n['extras']['attr']
        h = helper(a, fourcc) or ('pick' if _is_hull(j, n) else None)
        if h == 'night' and night:
            h = None
        if h or (not fx and _is_fx(j, n)):
            continue
        if fourcc in DYNAMIC:
            ok = not (a >> 18) & 3 and all(show_flags.get(b, True) for b in range(5, 28) if (a >> b) & 1 and b not in (18, 19))
        elif fourcc == 'Ress':
            ok = not (a >> 5) & 0x3F or (a >> 10) & 1             # the full resource stage (res_6)
        elif fourcc in STATES:
            ok = sig_visible(static_sig(a), level, dmg, age)
        else:
            ok = True
        if ok:
            out.add(n.get('name'))
    return out


def flag_groups(j):
    """script flags used by a dynamic model: [{'bit', 'name', 'count'}]"""
    if _fourcc(j) not in DYNAMIC:
        return []
    cnt = {}
    for n in mesh_nodes(j):
        a = n['extras']['attr']
        for b in range(5, 28):
            if b in (18, 19):
                continue
            if (a >> b) & 1:
                cnt[b] = cnt.get(b, 0) + 1
    return [{'bit': b, 'name': FLAG_NAMES.get(b, 'flag %d' % b), 'count': c} for b, c in sorted(cnt.items())]


def hidden_nodes(j, **state):
    vis = visible_nodes(j, **state)
    return [n.get('name') for n in mesh_nodes(j) if n.get('name') not in vis]
