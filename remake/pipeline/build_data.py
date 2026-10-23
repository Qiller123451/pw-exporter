"""Extract the game rules data for the remake from the original tech tree and scripts.

Outputs:
  techtree.json : the original tech tree (StartTT + Filters) as JSON. The game evaluates it at runtime
                  (src/game/techtree.js): every upgrade, level bonus and building is a filter of modificators.
  gamedata.json with
  objects[name]   : per-object data incl. per-level stats
  weapons[name]   : weapon stats
  actions[tribe]  : build/upgrade actions (cost, time, producer, requirements, ui position)
  texts[name]     : display name + tooltip texts from the help files
  hero_consts     : the constants of Hero.usl (BUILDING_DAMAGE_BONUS, LIVINGSTONE_TICK_DAMAGE ...)
  mod             : the mod configuration the data is built for ('' = the official game, 'MIRAGE')
"""
import json, os, re, sys, glob
try:
    from . import paths, sounddb
except ImportError:
    import paths
    import sounddb
# the game-file readers are shared with the Model Exporter (pwexport): a fix there is a fix here
from pwexport.tree import parse                      # noqa: E402
from pwexport import texts as pwtexts    # noqa: E402

TRIBES = ['Hu', 'Aje', 'Ninigi', 'SEAS']
# the string-table entries the remake's interface uses (the command bar's tooltips, the minimap's options ...)
UI_STRINGS = re.compile(r'_(ObjCommandBar_|UI_CommandBar_|MIRAGE_Duration|MI_ManaRequirement|UI_OptionsM_CheckBox_(RotateMinimap|UsePlayerColors)|UI_OptionsM_AutoSave|UI_IngaScre_Button_|NT_SavingGame|NT_Artefact_|NT_PickUpFailInvFull|NT_AI_|NT_Flag_|NT_Dipl|Timer_TT_|PlayersWindow_|UI_DiplWind_|UI_ChatWind_|EndScreen_|UI_StatScre_|UI_HistWind_|PointBuyMenu_|UI_ShopList_Tab_|UI_Tab_(Infantry|Cavalry|Heroes|MyArmy)_TT|UI_AC_PointBuy_|UI_PBMenu_|pb_|MyArmy$|UI_PresWind_|UI_GameInfo_Label_Points|LOCKED_STANDARD_PRESET)', re.I)


def buff_table(game):
    """Scripts/Server/init/buffdecals.txt as Info.usl CBuffInfo reads it: [{attrib, tile (UnitDecals tile, -1 none),
    vis (0 own, 1 all, 2 enemies, 3 allies), icon, tip}] in the file's order (the order the info window shows them)"""
    p = game.file('Scripts/Server/init/buffdecals.txt')
    if not p:
        return []
    root = sounddb.parse(open(p, encoding='latin1').read()).get('Root', {})
    out = []
    for name, b in root.items():
        if not isinstance(b, dict) or not b.get('attrib'):
            continue
        out.append({'attrib': b['attrib'], 'tile': int(num(b.get('tile'), -1)), 'vis': int(num(b.get('visibility'), 0)),
                    'icon': b.get('icon') or '', 'tip': b.get('tooltip') or ''})
    return out


def point_buy(game, dp):
    """the army budget's prices and presets (docs/spec/pointbuy.md): Server/settings/NewPointBuyCosts.txt of the
    configuration (BoosterPack1 has its own with more rows) and the default presets Game/misc/DefPresets.txt (dp) ->
    {costs: {tribe: {class: [price at level 1..5, 0 = not at that level]}}, cats: {tribe: {class: Character | Animals |
    Vehicles}} (file order = the shop's), heroes: {class: [...]}, rates: {tribe: {food, wood, stone, iron}},
    presets: {tribe: [{name, cost, standard, units: {slot: class}, res: {food, wood, stone}}]}}"""
    f = game.file('Scripts/Server/settings/NewPointBuyCosts.txt')
    root = sounddb.parse(open(f, encoding='latin1').read()).get('Root', {}) if f else {}
    lv = lambda n: [int(num(n.get('Level%d' % i), 0)) for i in range(1, 6)]
    costs, cats, heroes, rates = {}, {}, {}, {}
    for tribe, t in (root.get('Units') or {}).items():
        if not isinstance(t, dict):
            continue
        if tribe == 'Heroes':
            heroes = {c: lv(n) for c, n in t.items() if isinstance(n, dict)}
            continue
        costs[tribe], cats[tribe] = {}, {}
        for cat, cl in t.items():
            for c, n in (cl.items() if isinstance(cl, dict) else []):
                if isinstance(n, dict):
                    costs[tribe][c] = lv(n)
                    cats[tribe][c] = cat
    for tribe, r in (root.get('Resources') or {}).items():
        if isinstance(r, dict):
            rates[tribe] = {k: num(r.get(k), 0) for k in ('food', 'wood', 'stone', 'iron')}
    presets = {}
    for tribe, st in dp.items():
        if not isinstance(st, dict):
            continue
        for name, n in st.items():
            if not isinstance(n, dict) or 'Cost' not in n:
                continue
            presets.setdefault(tribe, []).append({
                'name': name, 'cost': int(num(n.get('Cost'), -1)), 'standard': str(n.get('standard', '')) == '1',
                'units': {k: v for k, v in (n.get('Units') or {}).items() if k.isdigit() and isinstance(v, str)},
                'res': {k: int(num(v)) for k, v in (n.get('Resources') or {}).items() if k in ('food', 'wood', 'stone')}})
    return {'costs': costs, 'cats': cats, 'heroes': heroes, 'rates': rates, 'presets': presets}


def walkable_walls(game):
    """the wall classes units walk on (Scripts/Server/init/wallclassconfig_ex.txt - the engine's WallMap reads this one -
    else wallclassconfig.txt: Wall = '<class>' { Walkable = '1' }), lower case"""
    for f in ('Scripts/Server/init/wallclassconfig_ex.txt', 'Scripts/Server/init/wallclassconfig.txt'):
        p = game.file(f)
        if p:
            t = open(p, encoding='latin1').read()
            return sorted({m.group(1).lower() for m in re.finditer(r"wall\s*=\s*'([^']+)'\s*\{\s*walkable\s*=\s*'1'", t, re.I)})
    return []


def wall_classes(game):
    """the wall class table (Scripts/Server/init/wallclassconfig_ex.txt, the engine's InitWallClassMap 0x7df5d0):
    class name (lower case) -> [race, class, type]; race 0 Hu 1 Aje 2 Ninigi 3 SEAS, type 0 Wall 1 Gate 2 Tower 3 Trap.
    For traps the engine keeps race := the class index and class 0 (0x7de880)."""
    p = game.file('Scripts/Server/init/wallclassconfig_ex.txt')
    if not p:
        return {}
    out, race, cls = {}, None, None
    TYPES = {'wall': 0, 'gate': 1, 'tower': 2, 'trap': 3}
    for line in open(p, encoding='latin1'):
        m = re.match(r"\s*Race_(\d+)\s*=", line)
        if m:
            race, cls = int(m.group(1)), None
            continue
        m = re.match(r"\s*Class_(\d+)\s*=", line)
        if m:
            cls = int(m.group(1))
            continue
        m = re.match(r"\s*(Wall|Gate|Tower|Trap)\s*=\s*'([^']*)'", line, re.I)
        if m and race is not None and cls is not None and m.group(2) and m.group(2) != '****':
            t = TYPES[m.group(1).lower()]
            out[m.group(2).lower()] = [cls, 0, t] if t == 3 else [race, cls, t]
    return out


def finishing_moves(game):
    """Scripts/Server/settings/FinishingMoves.txt as FinishingMoveMgr.usl reads it: fighter class (lower case) ->
    [{e: [enemy classes], a: [[fighter anim, victim anim]], link, delay, del}] - groups ($Infantry_res ...) expanded;
    del = DeleteCorpse"""
    p = game.file('Scripts/Server/settings/FinishingMoves.txt')
    if not p:
        return {}
    root = sounddb.parse(open(p, encoding='latin1').read()).get('Root', {})
    groups = {k: [x.strip() for x in str(v.get('_value') if isinstance(v, dict) else v).split(',') if x.strip()]
              for k, v in (root.get('Groups') or {}).items()}
    split = lambda s, keep_empty=False: [x.strip() for x in str(s or '').split(',') if keep_empty or x.strip()]
    def expand(lst):
        out = []
        for x in lst:
            out += groups.get(x[1:], []) if x.startswith('$') else [x]
        return out
    out = {}
    for name, m in root.items():
        if name == 'Groups' or not isinstance(m, dict):
            continue
        fa, ea = split(m.get('FighterAnims')), split(m.get('EnemyAnims'), True)
        fighters, enemies = expand(split(m.get('Fighters'))), expand(split(m.get('Enemies')))
        if not fighters or not enemies or not fa or len(fa) != len(ea):
            continue
        mv = {'e': sorted({e.lower() for e in enemies}), 'a': [[f, e] for f, e in zip(fa, ea)], 'link': m.get('Link') or '',
              'delay': num(m.get('LinkDelay')), 'del': str(m.get('DeleteCorpse') or '0') == '1'}
        for f in fighters:
            out.setdefault(f.lower(), []).append(mv)
    return out


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


def particle_db(game):
    """the effects the triggers play by path (Scripts/Game/sequencer/particles.txt, CActionEffectObj's ParticleDB):
    {"particle/fx/heal/fx_heal_target": [model, length in s]} (lower case, no slashes at the ends)"""
    try:
        root = sounddb.parse(open(game.file('Scripts/Game/sequencer/particles.txt'), encoding='latin1').read()).get('Root', {})
    except (OSError, TypeError):           # an installation without the file
        return {}
    out = {}

    def walk(node, path):
        for k, v in node.items():
            if not isinstance(v, dict):
                continue
            p = path + [k]
            if v.get('_value') and 'length' in v:
                out['/'.join(p).lower()] = [str(v['_value']).lower(), num(v.get('length')) or 4.0]
            else:
                walk(v, p)
    walk({k: v for k, v in root.items() if isinstance(v, dict)}, [])
    return out


def main(out=None, log=print):
    out = out or os.path.join(paths.OUT, 'gamedata.json')
    game = paths.game()
    # a later folder of the configuration overrides an earlier one (BoosterPack1 / a mod over Base)
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
                            locs.append({'at': (l.get('_value') or '').split('/')[-1], 'ui': l.get('uiposition'), 'icon': l.get('iconpath'),
                                         'desc': l.get('description')})      # the tooltip's help key (CmdButton.usl)
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
    # help texts (the English encyclopedia Texts/Help/*.seml: the tooltips' titles and bullets) and the command bar's
    # strings (main_uk.ltf ...), each file from the last of the language pack's folders that has it (Locale_UK.info)
    texts, ui = {}, {}
    loc = [l for l in ('uk', 'en') if l in game.locales()] or game.locales() or ['uk']
    for name, f in game.locale_files(loc[0], 'Help').items():
        if not name.endswith('.seml'): continue
        for key, e in pwtexts.parse_help(open(f, encoding='utf-8-sig', errors='replace').read()).items():
            texts[key] = {k: e[k] for k in ('name', 'cls', 'vs', 'lvl', 'medium', 'long') if e[k]}
    for name, f in game.locale_files(loc[0]).items():
        if not name.endswith('.ltf') or name.startswith(('sequences', 'dialogscenes')): continue
        for k, v in pwtexts.parse_ltf(open(f, encoding='utf-8-sig', errors='replace').read()).items():
            if UI_STRINGS.match(k): ui[k] = v
    # idle animation sets (Scripts/Game/misc/IdleAnims.txt): class -> [[anim, minLoops, maxLoops, chance], ...]
    idle = {}
    ia = sounddb.parse(open(game.file('Scripts/Game/misc/IdleAnims.txt'), encoding='latin1').read()).get('Root', {})
    for setname, st in ia.items():
        if not isinstance(st, dict): continue
        entries = [[v['_value'], int(num(v.get('min_loops'), 1)), int(num(v.get('max_loops'), 1)), num(v.get('chance'), 1)]
                   for k, v in st.items() if k != 'users' and isinstance(v, dict) and v.get('_value')]
        for u in (st.get('users') or {}):
            idle[u.lower()] = entries
    # multiplayer start (Scripts/Game/misc/DefPresets.txt "_pb_locked"; SEAS as in StartLocation.usl)
    dp = sounddb.parse(open(game.file('Scripts/Game/misc/DefPresets.txt'), encoding='latin1').read()).get('Root', {})
    start = {}
    for tribe, st in dp.items():
        pb = isinstance(st, dict) and st.get('_pb_locked')
        if isinstance(pb, dict):
            start[tribe] = {'units': [u for u in (pb.get('Units') or {}).values() if isinstance(u, str)],
                            'res': {k: int(num(v)) for k, v in (pb.get('Resources') or {}).items() if k in ('food', 'wood', 'stone')}}
    start['SEAS'] = {'units': ['seas_worker'] * 3, 'res': dict(start.get('Hu', {}).get('res') or {'food': 200, 'wood': 150, 'stone': 100})}
    base = {'Hu': 'hu_fireplace', 'Aje': 'aje_resource_collector', 'Ninigi': 'ninigi_fireplace', 'SEAS': 'seas_headquarters'}
    for t in start: start[t]['base'] = base[t]
    # script class of every object (classes/**/*.txt "classattribs/classname"; a later folder overrides)
    script, classgfx = {}, {}
    for mod in game.mods:
        for f in sorted(glob.glob(os.path.join(paths.data('%s/Scripts/Server/classes' % mod), '**', '*.txt'), recursive=True)):
            if os.path.basename(f).startswith('._'): continue      # Mac metadata (install.junk)
            try: root = sounddb.parse(open(f, encoding='latin1').read()).get('Root', {})
            except Exception: continue
            if not isinstance(root, dict): continue
            for name, o in root.items():
                ca = isinstance(o, dict) and o.get('classattribs')
                if isinstance(ca, dict) and ca.get('classname'): script[name.lower()] = ca['classname']
                if isinstance(ca, dict) and ca.get('gfx'): classgfx[name.lower()] = ca['gfx'].lower()
    # the script classes' parents (classes/**/*.usl "class CTrap inherit CBuilding"): what a class is (Rules.isA -
    # traps, fields and the Aje slaughterhouses don't block the pathfinder ...)
    from pwexport import modparts
    parents = {c: v['parent'] for c, v in modparts.script_classes(game).items() if v.get('parent')}
    # resource node values (settings/Resources.txt): WOOD / STON / FRUI / FOOD (carcasses "<animal>_food")
    rs = sounddb.parse(open(game.file('Scripts/Server/settings/Resources.txt'), encoding='latin1').read()).get('Root', {})
    resources = {sec: {k.lower(): num(v.get('value')) for k, v in (rs.get(sec) or {}).items() if isinstance(v, dict)} for sec in ('WOOD', 'STON', 'FRUI', 'FOOD')}
    # unique heroes (settings/NPCList.txt)
    npc = [k for k in sounddb.parse(open(game.file('Scripts/Server/settings/NPCList.txt'), encoding='latin1').read()).get('Root', {})]
    # the heroes' script constants (Hero.usl: building damage bonus, Livingstone's drain ... - MIRAGE changes them)
    hero = game.file('Scripts/Server/classes/character/Hero.usl')
    hero_consts = {k: float(v) for k, v in re.findall(r'const\s+(?:real|int)\s+([A-Z_]+)\s*=\s*(-?[0-9.]+)f?\s*;',
                                                     open(hero, encoding='latin1').read() if hero else '')}
    # multi-part objects (riders, turrets, build-ups, drawbars, flags ...) as the scripts assemble them
    comp = {k: [dict({x: p[x] for x in ('i', 'kind', 'gfx', 'variants', 'by', 'link', 'pi', 'anim', 'attack_anim', 'cond', 'arg', 'flex')},
                     **{x: p[x] for x in ('offset', 'weapon_class') if p.get(x)})
                for p in v if p['cond'] not in ('weapon', 'tool', 'carry', 'special')]
            for k, v in paths.composites().items()}
    data = {'texts': texts, 'ui': ui, 'idle': idle, 'composites': {k: v for k, v in comp.items() if v}, 'start': start, 'script': script, 'classParents': parents, 'classgfx': classgfx, 'resources': resources, 'npc': npc,
            'pyramid': [25, 15, 8, 3, 1], 'levelup_skulls': [25, 50, 100, 300],
            'hero_consts': hero_consts, 'mod': paths.MOD or '',                  # the configuration (the sequel campaign needs MIRAGE's)
            'particles': particle_db(game), 'finishing': finishing_moves(game), 'buffs': buff_table(game), 'walkableWalls': walkable_walls(game), 'wallClasses': wall_classes(game),
            'pointBuy': point_buy(game, dp)}
    json.dump(data, open(out, 'w'), indent=None, separators=(',', ':'))
    json.dump({'StartTT': T['StartTT'], 'Filters': T['Filters']}, open(os.path.join(os.path.dirname(out), 'techtree.json'), 'w'),
              indent=None, separators=(',', ':'))
    json.dump(help_book(game, loc[0]), open(os.path.join(os.path.dirname(out), 'help.json'), 'w'), indent=None, separators=(',', ':'))
    log('script classes', len(script), 'texts', len(texts), 'food values', len(resources['FOOD']), 'npc', npc)


def help_book(game, lang):
    """the in-game help (HelpMenu.usl: F1): the topics of Texts/Help/index.txt - [{'key', 'text', 'file',
    'subs': [...]}] - and each file's chapters and help items (pwexport.texts.help_doc), {'index', 'docs'}"""
    files = {n.lower(): f for n, f in game.locale_files(lang, 'Help').items()}
    idx = files.get('index.txt')
    if not idx:
        return {'index': [], 'docs': {}}

    def topics(node):
        out = []
        for k, v in node.items():
            if isinstance(v, dict):
                out.append({'key': k.lower(), 'text': v.get('text', k), 'file': (v.get('helpfile') or '').lower(), 'subs': topics(v)})
        return out
    index = topics(parse(open(idx, encoding='utf-8-sig', errors='replace').read(), inherit=True).get('Root', {}))
    docs = {n: pwtexts.help_doc(open(f, encoding='utf-8-sig', errors='replace').read()) for n, f in files.items() if n.endswith('.seml')}
    return {'index': index, 'docs': docs}


def run(log=print, progress=None):
    main(None, log)


if __name__ == '__main__':
    paths.configure(sys.argv[1], sys.argv[2])       # <Data folder> <output folder>
    run()
