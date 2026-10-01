"""Extract the game rules data for the remake from the original tech tree and scripts.

Outputs:
  techtree.json : the original tech tree (StartTT + Filters) as JSON. The game evaluates it at runtime
                  (src/game/techtree.js): every upgrade, level bonus and building is a filter of modificators.
  gamedata.json with
  objects[name]   : per-object data incl. per-level stats
  weapons[name]   : weapon stats
  actions[tribe]  : build/upgrade actions (cost, time, producer, requirements, ui position)
  texts[name]     : display name + tooltip texts from the help files
"""
import json, os, re, sys, glob
try:
    from . import paths
except ImportError:
    import paths
# the game-file readers are shared with the Model Exporter (pwexport): a fix there is a fix here
from pwexport.tree import parse                      # noqa: E402
from pwexport import texts as pwtexts, composites    # noqa: E402
from pwexport.install import Install                 # noqa: E402

TRIBES = ['Hu', 'Aje', 'Ninigi', 'SEAS']


def num(v, d=0.0):
    try: return float(v)
    except (TypeError, ValueError): return d


def ints(d, keys):
    return {k: int(num(d.get(k))) for k in keys} if isinstance(d, dict) else {k: 0 for k in keys}


def obj_stats(o):
    return {
        'hp': num(o.get('hitpoints')), 'fow': num(o.get('FOW')),
        'speed': int(num(o.get('defaultspeed'))), 'maxspeed': int(num(o.get('maxspeed'))),
        'tf': num(o.get('timefactor'), 1.0), 'scalps': int(num(o.get('scalps'))),
        'gfx': o.get('gfx'), 'size': int(num(o.get('unit_size'))),
        'carry': ints(o.get('ResInvCaps'), ['food', 'wood', 'stone']),
        'limits': ints(o.get('UpdateLimits'), ['max_units', 'max_food', 'max_wood', 'max_stone']),
        'heal': ({'radius': num(h.get('radius')), 'amount': num(h.get('amount')), 'mod': num(h.get('mod'))}
                 if isinstance((h := (o.get('special_abilities') or {}).get('heal') if isinstance(o.get('special_abilities'), dict) else None), dict)
                 and h.get('enabled') == 'true' else None),
        'captain': o.get('captainclass') if o.get('captainclass') not in (None, '0', '') else None,
    }


def main(out=None, log=print):
    out = out or os.path.join(paths.OUT, 'gamedata.json')
    game = Install(paths.DATA)
    SRC = paths.DATA
    # BoosterPack 1 (the last official patch) overrides Base
    TT = game.file('Scripts/Server/settings/techtree/_TechTree.ttree')
    T = parse(open(TT, encoding='latin1').read())['Root']
    ST = T['StartTT']
    objects, weapons, actions = {}, {}, {}
    for tribe in TRIBES + ['World', 'Special']:
        for cls, group in ST['Objects'].get(tribe, {}).items():
            if cls == 'Weapons':
                for wn, w in group.items():
                    if not isinstance(w, dict): continue
                    users = [u for u in (w.get('Users') or {}).values() if isinstance(u, str)]
                    anims = w.get('Animations') or {}
                    a0 = next((a for a in anims.values() if isinstance(a, dict)), {})
                    bonus = {k: num(v) for k, v in ((w.get('AttackBonus') or {}).get('Type') or {}).items() if k != '_value'}
                    proj = [p for p in (w.get('Projectile') or {}).values() if isinstance(p, str)]
                    weapons[wn] = {
                        'tribe': tribe, 'level': int(num(w.get('level'))), 'secondary': int(num(w.get('secondary'))),
                        'dmg': num(w.get('damage')), 'enddmg': num(w.get('enddamage')), 'range': num(w.get('range')),
                        'minrange': num(w.get('minattackrange')), 'freq': num(w.get('frequency')),
                        'splash': num(w.get('hitrange')), 'def': num(w.get('defense')), 'rdef': num(w.get('rangeddefense')),
                        'ap': num(w.get('armorpiercing')), 'poison': num(w.get('poison_damage')),
                        'poisonTicks': int(num(w.get('poison_tick_count'))), 'bulletspeed': num(w.get('bulletspeed')),
                        'jitter': num(w.get('jitter')), 'size': int(num(w.get('unit_size'))),
                        'projectile': proj[0] if proj else None, 'bonus': bonus, 'users': users,
                        'delay': num(a0.get('delay')), 'shootdelay': num(a0.get('shootdelay')),
                        'anim': next((a.get('_value') for a in anims.values() if isinstance(a, dict)), None),
                        'penetration': int(num(w.get('penetration'))), 'fx': w.get('fx_class'),
                        'anims': [{'name': a.get('_value'), 'delay': num(a.get('delay')), 'shootdelay': num(a.get('shootdelay'))}
                                  for a in anims.values() if isinstance(a, dict)],
                        'parts': [{'gfx': [x for x in (p.get('Gfx') or {}).values() if isinstance(x, str)], 'link': p.get('Links')}
                                  for p in (w.get('Parts') or {}).values() if isinstance(p, dict)],
                    }
                continue
            for name, o in group.items():
                if not isinstance(o, dict) or 'hitpoints' not in o: continue
                ent = {'tribe': tribe, 'class': cls, 'desc': o.get('description'),
                       'aggressive': int(num(o.get('aggressive'))), 'can_build': int(num(o.get('can_build'))),
                       'can_harvest': int(num(o.get('can_harvest'))), 'maxworkers': int(num(o.get('maxworkers'))),
                       'delivery': [k for k, v in (o.get('delivery') or {}).items() if v == '1'] if isinstance(o.get('delivery'), dict) else [],
                       'caste': o.get('caste'), 'standanim': o.get('standanim'),
                       'fx': o.get('fx_class'), 'captain': o.get('captainclass') if o.get('captainclass') not in (None, '0', '') else None,
                       'levels': {1: obj_stats(o)}}
                if ent['captain']:
                    for tb in TRIBES:
                        c = ((ST['Objects'].get(tb) or {}).get('CHTR') or {}).get(ent['captain'])
                        if isinstance(c, dict) and c.get('gfx'): ent['captain_gfx'] = c['gfx']; break
                objects[name] = ent
    # per-level data from filters
    for tribe in TRIBES + ['World', 'Special']:
        ups = ((T.get('Filters') or {}).get(tribe) or {}).get('Upgrades') or {}
        for name, u in ups.items():
            if name not in objects or not isinstance(u, dict): continue
            for k, v in u.items():
                m = re.match(r'Lvl(\d)_Bonus$', k)
                if m and isinstance(v, dict) and isinstance(v.get('LevelBonusData'), dict):
                    objects[name]['levels'][int(m.group(1))] = obj_stats(v['LevelBonusData'])
    # weapons per user
    for wn, w in weapons.items():
        for u in w['users']:
            if u in objects: objects[u].setdefault('weapons', []).append(wn)
    # actions
    for tribe in TRIBES:
        A = ST['Actions'].get(tribe, {})
        lst = []

        def walk(n, path):
            for k, v in n.items():
                if not isinstance(v, dict): continue
                if 'duration' in v and 'conditions' in v:
                    c = v['conditions']
                    locs = []
                    for l in (v.get('locations') or {}).values():
                        if isinstance(l, dict):
                            locs.append({'at': (l.get('_value') or '').split('/')[-1], 'ui': l.get('uiposition'), 'icon': l.get('iconpath')})
                    res = []
                    for r in (v.get('results') or {}).values():
                        if isinstance(r, dict):
                            res.append({'obj': (r.get('_value') or '').split('/')[-1], 'type': r.get('type'),
                                        'level': int(num((r.get('flags') or {}).get('level'), 0)) if isinstance(r.get('flags'), dict) else None})
                    lst.append({'id': k, 'kind': path.split('/')[0], 'cat': path, 'time': num(v.get('duration')),
                                'cost': ints(c.get('rescosts'), ['food', 'wood', 'stone']),
                                'req': [x for x in (c.get('inventobjects') or {}).values() if isinstance(x, str)],
                                'locs': locs, 'results': res})
                else:
                    walk(v, path + '/' + k if path else k)
        walk(A, '')
        actions[tribe] = lst
    # help texts (English encyclopedia, Data/locale/uk/Texts/Help/*.seml)
    texts = {}
    loc = [l for l in ('uk', 'en') if l in game.locales()] or game.locales() or ['uk']
    help_dir = paths.data('locale/%s/Texts/Help' % loc[0])
    for f in sorted(glob.glob(os.path.join(help_dir, '*'))):
        if not f.lower().endswith('.seml'): continue
        for key, e in pwtexts.parse_help(open(f, encoding='utf-8-sig', errors='replace').read()).items():
            texts[key] = {'name': e['name'], 'vs': e['vs'], 'medium': e['medium'], 'long': e['long']}
    # idle animation sets (Scripts/Game/misc/IdleAnims.txt): class -> [[anim, minLoops, maxLoops, chance], ...]
    try:
        from . import sounddb
    except ImportError:
        import sounddb
    idle = {}
    ia = sounddb.parse(open(paths.data('Base/Scripts/Game/misc/IdleAnims.txt'), encoding='latin1').read()).get('Root', {})
    for setname, st in ia.items():
        if not isinstance(st, dict): continue
        entries = [[v['_value'], int(num(v.get('min_loops'), 1)), int(num(v.get('max_loops'), 1)), num(v.get('chance'), 1)]
                   for k, v in st.items() if k != 'users' and isinstance(v, dict) and v.get('_value')]
        for u in (st.get('users') or {}):
            idle[u.lower()] = entries
    # multiplayer start (Scripts/Game/misc/DefPresets.txt "_pb_locked"; SEAS as in StartLocation.usl)
    dp = sounddb.parse(open(paths.data('Base/Scripts/Game/misc/DefPresets.txt'), encoding='latin1').read()).get('Root', {})
    start = {}
    for tribe, st in dp.items():
        pb = isinstance(st, dict) and st.get('_pb_locked')
        if isinstance(pb, dict):
            start[tribe] = {'units': [u for u in (pb.get('Units') or {}).values() if isinstance(u, str)],
                            'res': {k: int(num(v)) for k, v in (pb.get('Resources') or {}).items() if k in ('food', 'wood', 'stone')}}
    start['SEAS'] = {'units': ['seas_worker'] * 3, 'res': dict(start.get('Hu', {}).get('res') or {'food': 200, 'wood': 150, 'stone': 100})}
    base = {'Hu': 'hu_fireplace', 'Aje': 'aje_resource_collector', 'Ninigi': 'ninigi_fireplace', 'SEAS': 'seas_headquarters'}
    for t in start: start[t]['base'] = base[t]
    # script class of every object (classes/**/*.txt "classattribs/classname"; BoosterPack1 overrides Base)
    script, classgfx = {}, {}
    for mod in ('Base', 'BoosterPack1'):
        for f in sorted(glob.glob(os.path.join(paths.data('%s/Scripts/Server/classes' % mod), '**', '*.txt'), recursive=True)):
            try: root = sounddb.parse(open(f, encoding='latin1').read()).get('Root', {})
            except Exception: continue
            if not isinstance(root, dict): continue
            for name, o in root.items():
                ca = isinstance(o, dict) and o.get('classattribs')
                if isinstance(ca, dict) and ca.get('classname'): script[name.lower()] = ca['classname']
                if isinstance(ca, dict) and ca.get('gfx'): classgfx[name.lower()] = ca['gfx'].lower()
    # resource node values (settings/Resources.txt): WOOD / STON / FRUI / FOOD (carcasses "<animal>_food")
    rs = sounddb.parse(open(paths.data('Base/Scripts/Server/settings/Resources.txt'), encoding='latin1').read()).get('Root', {})
    resources = {sec: {k.lower(): num(v.get('value')) for k, v in (rs.get(sec) or {}).items() if isinstance(v, dict)} for sec in ('WOOD', 'STON', 'FRUI', 'FOOD')}
    # unique heroes (settings/NPCList.txt)
    npc = [k for k in sounddb.parse(open(paths.data('Base/Scripts/Server/settings/NPCList.txt'), encoding='latin1').read()).get('Root', {})]
    # multi-part objects (riders, turrets, build-ups, drawbars, flags ...) as the scripts assemble them
    comp = {k: [{x: p[x] for x in ('i', 'kind', 'gfx', 'variants', 'by', 'link', 'pi', 'anim', 'attack_anim', 'cond', 'arg', 'flex')}
                for p in v if p['cond'] not in ('weapon', 'tool', 'carry', 'special')]
            for k, v in composites.normalized().items()}
    data = {'texts': texts, 'idle': idle, 'composites': {k: v for k, v in comp.items() if v}, 'start': start, 'script': script, 'classgfx': classgfx, 'resources': resources, 'npc': npc,
            'pyramid': [25, 15, 8, 3, 1], 'levelup_skulls': [25, 50, 100, 300]}
    json.dump(data, open(out, 'w'), indent=None, separators=(',', ':'))
    json.dump({'StartTT': T['StartTT'], 'Filters': T['Filters']}, open(os.path.join(os.path.dirname(out), 'techtree.json'), 'w'),
              indent=None, separators=(',', ':'))
    log('script classes', len(script), 'texts', len(texts), 'food values', len(resources['FOOD']), 'npc', npc)


def run(log=print, progress=None):
    main(None, log)


if __name__ == '__main__':
    paths.configure(sys.argv[1], sys.argv[2])       # <Data folder> <output folder>
    run()
