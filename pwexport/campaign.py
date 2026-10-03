"""A campaign map as one JSON document: everything a mission consists of besides the terrain.

    from pwexport.campaign import campaign, campaign_maps
    data = campaign('Data/Base/Maps/Cpn_single_001/single_11.ula', Install('E:/Paraworld'))
    python -m pwexport.campaign <map.ula> [--install <game folder>] [--lang uk] [--json out.json] [--text out.txt]
    python -m pwexport.campaign --all OUTDIR [--install <game folder>]      every mission: single_NN.json + .txt

The document (SCHEMA 'pw-campaign/1', field by field in docs/CAMPAIGN_FORMAT.md §10):

    schema, lang
    map          name, file, title, description, setting, size, water level, start time, camera, AI options ...
    players[8]   one per slot: human / ai / none, tribe, team, colour, diplomacy, resources, unit limits, start army ...
    objects      every placed object (index, guid, name, class, type, owner, position, rotation, level, hit points ...)
    groups, question_marks, regions (+ region_tree), quests, variables
    triggers (+ trigger_tree)   every trigger with its conditions, boolean expression and actions
    defaults     the level editor's default value of every condition / action parameter (the file only stores
                 parameters that differ)
    texts        every text key the mission refers to -> text in the chosen language
    dialogs      dialogue scene path -> actors and frames;  sequences   cutscene path -> subtitle lines
    refs         guid -> [kind, name] for every guid a trigger refers to
    warnings     what could not be resolved

What the triggers MEAN (how to run a mission from this document) is specified in remake/docs/spec/triggers.md.
Coordinates are map coordinates: x east, y north, z up (metres); rotations as in ula.py. Levels of objects are
0-based (level 0 = the game's "level 1").

The reader degrades gracefully: without an installation (or with an incomplete one) the texts, dialogue scenes and
sequences are simply missing / reduced to what the text tables contain; nothing raises.
"""
import gzip
import os
import re
import struct

from . import triggers as T
from . import ula
from .install import Install, _ci_join

SCHEMA = 'pw-campaign/1'

QM_STATES = ['STATE_INVISIBLE', 'QM_STATE_RED', 'QM_STATE_GREEN', 'QM_STATE_YELLOW', 'EC_STATE_YELLOW']   # QuestionMark.usl:5-10
RESOURCES = ('food', 'wood', 'stone', 'iron')
# parameters that hold one guid / a list of guids (one per line) of objects
_GUID_LISTS = ('units', 'aggro_state_units', 'add_to_group_units', 'objects_units', 'subjects_units')


# ---------------------------------------------------------------- small helpers
def _int(v, default=0):
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        try:
            return int(float(str(v).strip()))
        except (TypeError, ValueError):
            return default


def _float(v, default=0.0):
    try:
        return float(str(v).strip())
    except (TypeError, ValueError):
        return default


def vec(s):
    """'[x y z]', 'x y z' or 'x, y, z' -> [x, y, z] (None when it is not a vector)"""
    if not isinstance(s, str):
        return None
    p = re.findall(r'-?\d+(?:\.\d*)?(?:[eE][-+]?\d+)?', s)
    if len(p) != 3 or re.sub(r'[\d\s,.\[\]eE+-]', '', s):
        return None
    return [float(x) for x in p]


def _child(node, *path):
    for name in path:
        if node is None:
            return None
        node = next((c for c in node['children'] if c['name'] == name), None)
    return node


def _val(node, *path, default=''):
    n = _child(node, *path)
    return n['value'] if n is not None else default


def _round(v, n=3):
    return round(float(v), n)


def find_install(map_path):
    """the installation a map file belongs to (the folder above its 'Data' folder), or None"""
    p = os.path.abspath(map_path)
    while True:
        d = os.path.dirname(p)
        if d == p:
            return None
        if os.path.basename(p).lower() == 'data':
            try:
                return Install(p)
            except (ValueError, OSError):
                return None
        p = d


# ---------------------------------------------------------------- texts
class TextTable:
    """the game's text tables: Data/locale/<lang>/Texts/*.ltf ("key";"text"), the quest descriptions in
    Texts/Quests/<level>.seml, and Data/<mod>/Texts/*.lmf (the master files: key;text;max length;comment) as a last
    resort. English ('uk') fills the gaps of another language."""

    def __init__(self, install, lang='uk'):
        self.lang, self.t, self.seml = lang, {}, {}
        self.files = 0
        if install is None:
            return
        for lg in ([lang, 'uk'] if lang != 'uk' else ['uk']):
            d = install.locale_dir(lg)
            if not d:
                continue
            for f in sorted(os.listdir(d)):
                if f.lower().endswith('.ltf'):
                    self._ltf(os.path.join(d, f))
            q = _ci_join(d, 'Quests')
            if q:
                for f in sorted(os.listdir(q)):
                    if f.lower().endswith('.seml'):
                        self._seml(os.path.join(q, f))
        for mod in install.mods:
            d = _ci_join(os.path.join(install.data, mod), 'Texts')
            if not d:
                continue
            for f in sorted(os.listdir(d)):
                if f.lower().endswith('.lmf'):
                    self._ltf(os.path.join(d, f), master=True)

    def _ltf(self, path, master=False):
        try:
            with open(path, encoding='utf-8-sig' if not master else 'cp1252', errors='replace') as fh:
                txt = fh.read()
        except OSError:
            return
        self.files += 1
        for line in txt.splitlines():
            m = re.match(r'\s*"([^"]*)";"((?:[^"]|"")*)"', line)
            if not m or m.group(1) in ('Suit Localization File', 'Suit Localization Master File'):
                continue
            k, v = m.group(1), m.group(2).replace('\\n', '\n').replace('""', '"')
            if master and v in ('!DUMMY!', ''):
                continue
            self.t.setdefault(k, v)

    def _seml(self, path):
        try:
            with open(path, encoding='utf-8-sig', errors='replace') as fh:
                txt = fh.read()
        except OSError:
            return
        level = os.path.splitext(os.path.basename(path))[0].lower()
        for m in re.finditer(r'\\\{section\s+-name\s+(\S+?)\s*\}(.*?)\\\{/section\}', txt, re.S):
            body = re.sub(r'\\\{p\}', '\n', m.group(2))
            body = re.sub(r'\\\{[^}]*\}', '', body)
            body = '\n'.join(s.strip() for s in body.split('\n'))
            body = re.sub(r'\n{3,}', '\n\n', body).strip()
            self.seml.setdefault((level, m.group(1)), body)

    def get(self, key, default=None):
        return self.t.get(key, default)

    def has(self, key):
        return key in self.t

    def quest(self, level_name, quest):
        """the quest's long description (QuestWindow.usl:410-417: Texts/Quests/<LevelName, blanks -> _>.seml#<name>)"""
        return self.seml.get((level_name.replace(' ', '_').lower(), quest))

    def prefix(self, prefix):
        """[(key, text)] of all keys with this prefix, in file order"""
        return [(k, v) for k, v in self.t.items() if k.startswith(prefix)]


# ---------------------------------------------------------------- level info -> map, players, variables
def _map_info(m, tx):
    tr = m.info_tree
    base = _child(tr, 'Base')
    name = _val(base, 'LevelName') or m.name
    desc_key = _val(base, 'Description')
    st = _val(base, 'StartTime', default='12:0').split(':')
    cam = _child(tr, 'ClientSettings', '0', 'Camera')
    wd = _child(tr, 'WeatherData')
    items = _child(tr, 'Items')
    ai = _child(tr, 'AIOptions')
    return {
        'name': name, 'file': os.path.basename(m.path),
        'title': tx.get(name, name), 'description': tx.get(desc_key, desc_key), 'description_key': desc_key,
        'author': _val(base, 'Author'),
        'setting': m.setting, 'w': m.w, 'h': m.h, 'water': _round(m.water),
        'game_type': m.info.get('GameType', ''), 'map_type': _val(base, 'MapType'),
        'tutorial': _val(base, 'Tutorial') == '1',
        'max_players': _int(_val(base, 'MaxPlayers'), 0),
        'difficulty': _int(_val(base, 'Difficulty'), 1),
        'start_time': {'raw': ':'.join(st), 'hour': _int(st[0], 12), 'minute': _int(st[1], 0) if len(st) > 1 else 0},
        'default_camera': _float(_val(base, 'DefaultCamera'), 0.785),
        'camera': {'eye': vec(_val(cam, 'Eye')), 'look_at': vec(_val(cam, 'LookAt'))},
        'black_start': _val(base, 'BlackStart') == '1',
        'dim_gate': _val(base, 'DimGate_Available') == '1',
        'atmos': _val(base, 'material_atmos'),
        'credits': _int(m.info.get('credits'), 0),
        'weather': {'name': _val(wd, 'Name'), 'loop': _val(wd, 'Loop') == '1',
                    'tracks': [{c['name']: c['value'] for c in e['children']} for e in (_child(wd, 'Tracks') or {'children': []})['children']]},
        'items': {'max': _int(_val(items, 'MaxItems'), 0), 'pool': [c['name'] for c in (_child(items, 'Pool') or {'children': []})['children']]},
        'ai_options': {c['name']: c['value'] == '1' for c in (ai['children'] if ai else [])},
    }


def _slot_level(slot):
    """point buy slot -> unit level, 0-based (StartLocation.usl:500-512)"""
    if slot == 51:
        return 4
    if 48 <= slot <= 50:
        return 3
    if 40 <= slot <= 47:
        return 2
    if 25 <= slot <= 39:
        return 1
    return 0


def _start_army(pb, tribe):
    """the units the start location creates for a player (StartLocation.usl:482-575): the PointBuyPreset/<tribe> node"""
    out = []
    node = _child(pb, tribe)
    for c in (node['children'] if node else []):
        if not c['name'].lstrip('-').isdigit():
            continue
        slot, what = int(c['name']), c['value']
        e = {'slot': slot, 'level': _slot_level(slot), 'class': what, 'preset': what}
        if what in ('Nature', 'Technics', 'Resource', 'worker'):
            e['class'] = 'seas_worker' if tribe == 'SEAS' else tribe.lower() + '_worker'
            if tribe != 'SEAS':
                e['caste'] = {'Technics': 'tec', 'Nature': 'nat'}.get(what, 'res')
        elif what == 'Stina_s0':
            e['class'] = 'special_eusmilus'      # Stina arrives riding her sabre-tooth (StartLocation.usl:517-519)
        if what == 'Blocked':
            continue
        out.append(e)
    out.sort(key=lambda e: e['slot'])
    return out


def _players(m, tx, objs, by_guid, warn):
    tr = m.info_tree
    ps = _child(tr, 'PlayerSettings')
    out = []
    for i in range(8):
        n = _child(ps, 'Player_%d' % i)
        b = _child(n, 'Restrictions', 'Base')
        p = {'id': i, 'type': 'none', 'control': '', 'present': False}
        out.append(p)
        if n is None or b is None:
            continue
        ctl = _val(b, 'DefPlayer')
        tribes = [t for t in _val(b, 'Tribes').split(':') if t]
        tribe = _val(b, 'Tribes', 'Default') or (tribes[0] if tribes else '')
        key = _val(n, 'PlayerName')
        dip = _val(n, 'Diplomacy')
        ch = _child(n, 'Restrictions', 'Chars')
        res = _child(n, 'Restrictions', 'Resources')
        resources = {r: _int(_val(res, r), 0) for r in RESOURCES}
        hu = _child(res, 'Hu')
        if hu is not None:                      # StartLocation.usl:610-616: a "Hu" sub-node overrides (any tribe)
            for r in RESOURCES:
                resources[r] = _int(_val(hu, r), 0)
        pb = _child(n, 'PointBuyPreset')
        blocked = [int(x) for x in _val(pb, 'BlockedSlots').split(':') if x.strip().isdigit()]
        heroes = {}
        allowed = {'infantry': {}, 'cavalry': {}}
        for kind in ('Infantry', 'Cavalry'):
            for t in (_child(ch, kind) or {'children': []})['children']:
                allowed[kind.lower()][t['name']] = [c['name'] for c in t['children']]
        for h in (_child(ch, 'Heroes') or {'children': []})['children']:
            if h['children'] and h['children'][0]['children'] == [] and h['name'] in ('Hu', 'Aje', 'Ninigi', 'SEAS') and \
                    not any(c['name'] in ('NeedForStart', 'Level') for c in h['children']):
                heroes.setdefault('_by_tribe', {})[h['name']] = [c['name'] for c in h['children']]
            else:
                heroes[h['name']] = {c['name']: c['value'] for c in h['children']}
        limits = []
        for lv in range(1, 6):
            ln = _child(ch, 'Level%d' % lv)
            limits.append({'min': _int(_val(ln, 'Min'), 0), 'max': _int(_val(ln, 'Max'), [25, 15, 8, 3, 1][lv - 1]) if ln else None,
                           'max_start': _int(_val(ln, 'MaxStart'), 0) if _child(ln, 'MaxStart') else None})
        pop = _child(ch, 'Population')
        sls = []
        for c in (_child(n, 'StartLocations') or {'children': []})['children']:
            o = by_guid.get(c['name'])
            if o is None:
                warn.append('player %d: start location %s is not an object of the map' % (i, c['name']))
            else:
                sls.append(o)
        if not sls:                              # StartLocation.usl:203-211: else the start location owned by the player
            sls = [o for o in objs if o['type'] == 'SLOC' and o['owner'] == i][:1]
        p.update({
            'type': 'human' if ctl == 'human' else 'ai' if ctl.startswith('ai_') else 'none', 'control': ctl,
            'present': bool(ctl),
            'tribe': tribe, 'tribes': tribes,
            'name_key': key, 'name': tx.get(key, key),
            'team': _int(_val(b, 'DefTeam'), 0), 'color': _int(_val(b, 'DefColor'), -1),
            'gfx_prefix': _val(b, 'GfxPrefix'), 'show_statistics': _val(b, 'ShowStatistics', default='1') == '1',
            'resources': resources, 'credits': _int(_val(n, 'SPCredits'), 0),
            'diplomacy_raw': dip,
            # relation towards player j: 0 hostile, 1 neutral, 2 friendly (ServerApp.usl:539-551); slots the string
            # does not cover are neutral
            'diplomacy': [(_int(dip[j], 1) if j < len(dip) else 1) for j in range(8)],
            'population_limit': _int(_val(pop, 'Max'), 0) if pop else None,
            'unit_limits': limits,
            'ai_difficulty': {'easy': _int(_val(b, 'AI_Difficulty_Easy'), 1), 'medium': _int(_val(b, 'AI_Difficulty_Medium'), 4),
                              'hard': _int(_val(b, 'AI_Difficulty_Hard'), 8)},
            'tech_filters': [c['name'] for c in (_child(n, 'Restrictions', 'TTDef') or {'children': []})['children']],
            'allowed_units': allowed, 'heroes': heroes,
            'point_buy': {'preset': {c['name']: c['value'] for c in (pb['children'] if pb else []) if c['name'].isdigit()},
                          'tribes': {t['name']: {c['name']: c['value'] for c in t['children']} for t in (pb['children'] if pb else [])
                                     if not t['name'].isdigit() and t['name'] != 'BlockedSlots'},
                          'blocked_slots': blocked},
            'start_army': _start_army(pb, tribe),
            'include_buildings': _val(n, 'IncludeBuildings', default='1') == '1',
            'start_location': _sloc(sls[0]) if sls else None,
            'start_locations': [o['guid'] for o in sls],
        })
    return out


def _sloc(o):
    a = o.get('attr', {})
    return {'guid': o['guid'], 'name': o['name'], 'index': o['index'], 'x': o['x'], 'y': o['y'], 'z': o['z'], 'rot': o['rot'],
            'ignore_pointbuy': a.get('ignore_pointbuy') == '1', 'include_building': a.get('include_building', '1') != '0',
            'is_sequence': a.get('is_sequence') == '1', 'seq_filename': a.get('seq_filename', '')}


def _variables(m):
    out = {}
    for v in (_child(m.info_tree, 'Variables') or {'children': []})['children']:
        d = {c['name']: c['value'] for c in v['children']}
        out[v['name']] = {'type': d.get('type', 'int'), 'value': d.get('value', '0')}
    return out


# ---------------------------------------------------------------- objects, groups, question marks
def _objects(m):
    objs, by_guid, by_handle = [], {}, {}
    for o, e in zip(m.objects, m.details):
        a = o['attr']
        d = {'index': e['index'], 'guid': e['guid'], 'name': o['name'], 'class': o['cls'], 'type': o['type'].strip('\0 '),
             'owner': o['owner'], 'x': _round(o['x']), 'y': _round(o['y']), 'z': _round(o['z']),
             'rot': _round(o['rot'], 4), 'q': [_round(v, 5) for v in o['quat']],
             'level': _int(a.get('level'), 0),
             'visible': e['visible'], 'flags': e['flags'],
             # [G] bits of the object flags (CAMPAIGN_FORMAT.md §2): bit 0 selectable, bit 1 hitable, bit 31 set on
             # the objects the designers made invulnerable
             'selectable': bool(e['flags'] & 1), 'hitable': bool(e['flags'] & 2), 'invulnerable': bool(e['flags'] & 0x80000000)}
        if o.get('gfx') and o['gfx'] != o['cls']:
            d['gfx'] = o['gfx']
        if e['handle']:
            d['handle'] = e['handle']
            by_handle[tuple(e['handle'])] = d
        if 'hitpoints' in a:
            d['hp'] = _int(a.get('hitpoints'), 0)
        if 'maxhitpoints' in a:
            d['max_hp'] = _int(a.get('maxhitpoints'), 0)
        if e['links']:
            d['links'] = e['links']
        if a:
            d['attr'] = dict(a)
        objs.append(d)
        if e['guid']:
            by_guid[e['guid']] = d
    groups, qms = [], []
    for o, e in zip(objs, m.details):
        if o['type'] == 'GROU':
            mem = []
            for h in (e['members'] or []):
                t = by_handle.get(tuple(h))
                if t is not None:
                    mem.append(t['guid'])
                    t.setdefault('groups', []).append(o['guid'])
            groups.append({'guid': o['guid'], 'name': o['name'], 'index': o['index'], 'x': o['x'], 'y': o['y'], 'z': o['z'],
                           'members': mem})
        elif o['type'] == 'QMRK':
            s = e['qmark'] if e['qmark'] is not None else 0
            qms.append({'guid': o['guid'], 'name': o['name'], 'index': o['index'], 'x': o['x'], 'y': o['y'], 'z': o['z'],
                        'state': QM_STATES[s] if 0 <= s < len(QM_STATES) else str(s)})
    return objs, by_guid, groups, qms


# ---------------------------------------------------------------- regions, quests
def _regions(m):
    r = T.regions(m.chunks['Rgns'].data) if 'Rgns' in m.chunks else {'regions': [], 'tree': None}
    out = []
    for g in r['regions']:
        shapes = [{'type': s['type'], 'enabled': s['enabled'], 'flags': s['flags'], 'x': _round(s['x']), 'y': _round(s['y']),
                   'z': _round(s['z']), 'w': _round(s['w']), 'h': _round(s['h'])} for s in g['shapes']]
        d = {'guid': g['guid'], 'name': g['name'], 'flags': g['flags'], 'color': g['color'], 'note': g['note'], 'shapes': shapes}
        if shapes:
            d['bbox'] = [_round(v) for v in (min(s['x'] for s in shapes), min(s['y'] for s in shapes),
                                             max(s['x'] + s['w'] for s in shapes), max(s['y'] + s['h'] for s in shapes))]
        out.append(d)
    # the folder tree also lists GUIDs of regions the map does not store (regions that objects create when the level
    # runs - nest areas, the healing wells' areas ...): keep the stored ones
    known = {g['guid'] for g in out}

    def prune(f):
        return {'name': f['name'], 'guid': f['guid'], 'regions': [g for g in f['regions'] if g in known],
                'folders': [prune(c) for c in f['folders']]}
    return out, prune(r['tree']) if r['tree'] else None


def _quests(m, tx, level_name, warn):
    out = []
    try:
        qs = T.quests(m.chunks['Ques'].data) if 'Ques' in m.chunks else []
    except (struct.error, IndexError, ValueError) as e:
        warn.append('quests: %s' % e)
        qs = []
    for q in qs:
        a = q['attr']
        name = a.get('name', '')
        kh, kd, kg = '_%s_Headline' % name, '_%s_Description' % name, '_' + a.get('group', '')
        desc = tx.quest(level_name, name)
        if desc is None:
            desc = tx.get(kd)
            if desc is None or desc.lower().startswith('see '):
                desc = a.get('description', '')
        out.append({
            'guid': q['guid'], 'name': name, 'group': a.get('group', ''), 'main': a.get('mainquest') == '1',
            'bonus': {'easy': _int(a.get('boni_easy'), 0), 'medium': _int(a.get('boni_middle'), 0), 'hard': _int(a.get('boni_hard'), 0)},
            'visible': a.get('visible') == '1', 'accomplished': a.get('accomplished') == '1',
            'unaccomplishable': a.get('unaccomplishable') == '1',
            'headline': tx.get(kh, a.get('headline', '')), 'description': desc, 'info': a.get('additionalInfo', ''),
            'group_title': tx.get(kg, a.get('group', '')) if a.get('group') else '',
            'key_headline': kh, 'key_description': kd, 'key_group': kg if a.get('group') else '',
            'attr': a})
    return out


# ---------------------------------------------------------------- dialogue scenes, sequences
def _game_file(install, folder, rel):
    if install is None:
        return None
    for mod in reversed(install.mods):
        for base in (folder + '/' + rel, rel):          # DialogScene.usl:169-173: DialogScenes/<path>, else Data/<path>
            p = _ci_join(os.path.join(install.data, mod), base)
            if p and os.path.isfile(p):
                return p
    return None


def dialog(path, install, tx):
    """a dialogue scene: the .dlg file (a property tree: Actors, Frames, Soundpath) when the installation has it,
    else the frames found in the text tables (keys _<scene>_Frame_<n>)"""
    sid = os.path.splitext(os.path.basename(path.replace('\\', '/')))[0]
    d = {'path': path, 'id': sid, 'file': False, 'actors': {}, 'frames': [], 'sound_path': ''}
    f = _game_file(install, 'DialogScenes', path)
    if f:
        try:
            with open(f, encoding='cp1252', errors='replace') as fh:
                root = T.propdb(fh.read())
            d['file'] = True
            d['sound_path'] = root['attr'].get('Soundpath', '')
            for a in (_pchild(root, 'Actors') or {'children': []})['children']:
                at = a['attr']
                gen = at.get('generate_name', 'true') == 'true'       # DialogScene.usl:280-294
                e = {'class': at.get('class', ''), 'owner': _int(at['owner'], None) if 'owner' in at else None,
                     'icon': at.get('def_icon', ''), 'generate_name': gen}
                for k in ('name', 'tribe', 'caste', 'region', 'level'):
                    if k in at:
                        e[k] = at[k]
                # the shown name: "_ds_ACTOR_<actor node name>"; with generate_name the name of the object found
                # (up to its first "_") replaces the node name at run time
                e['name_key'] = '_ds_ACTOR_' + a['name']
                e['display'] = tx.get(e['name_key'], a['name'])
                d['actors'][a['name']] = e
            for fr in (_pchild(root, 'Frames') or {'children': []})['children']:
                key = '_%s_%s' % (sid, fr['name'])
                actor = fr['attr'].get('actor', '')
                d['frames'].append({'name': fr['name'], 'actor': actor, 'audio': fr['attr'].get('audio', ''), 'key': key,
                                    'text': tx.get(key, ''), 'speaker': d['actors'].get(actor, {}).get('display', actor)})
        except (OSError, ValueError, IndexError, KeyError):
            d['file'] = False
    if not d['file']:
        i = 0
        while tx.has('_%s_Frame_%d' % (sid, i)):
            key = '_%s_Frame_%d' % (sid, i)
            d['frames'].append({'name': 'Frame_%d' % i, 'actor': '', 'audio': '', 'key': key, 'text': tx.get(key), 'speaker': ''})
            i += 1
        if re.search(r'(^|/)mentor/', path.replace('\\', '/').lower()):
            d['actors']['Mentor'] = {'class': 'babbage_s0', 'owner': None, 'icon': 'babbage', 'generate_name': False,
                                     'name_key': '_ds_ACTOR_Mentor', 'display': tx.get('_ds_ACTOR_Mentor', 'Mentor')}
            for fr in d['frames']:
                fr['actor'], fr['speaker'] = 'Mentor', d['actors']['Mentor']['display']
    # a mentor scene (the adviser's hints) is not shown when the player switched them off (DialogScene.usl:396-403)
    d['mentor'] = 'Mentor' in d['actors']
    return d


def _pchild(node, name):
    return next((c for c in node['children'] if c['name'] == name), None)


def sequence(path, install, tx):
    """a cutscene: its subtitle lines from the text tables (keys _seq_<id>_<speaker>_<nn>, in table order = the
    order they are spoken) and, when the installation has the .seq file (gzip; a binary timeline with whole actor
    objects, cameras, sound and effect tracks - see CAMPAIGN_FORMAT.md §9), the videos, speech and sounds it names"""
    stem = os.path.splitext(os.path.basename(path.replace('\\', '/')))[0]
    d = {'path': path, 'id': stem, 'file': False, 'lines': [], 'videos': [], 'speech': [], 'sounds': [], 'duration': None}
    ids = [p for p in re.split(r'_', re.sub(r'^(ms|sc|hs)_', '', stem)) if re.match(r'\d{3,}', p)]
    f = _game_file(install, 'Sequences', path)
    if f:
        try:
            with gzip.open(f) as fh:
                b = fh.read()
            d['file'] = True
            if len(b) >= 37:
                # u32 0, u32 version (20 / 21), u32 1, u8 0, then three f64 seconds: the length of the timeline,
                # the start and the end marker of the part that is played (end 0 = not set: the whole timeline)
                tl, st, en = struct.unpack_from('<ddd', b, 13)
                d['timeline'], d['start'], d['end'] = round(tl, 3), round(st, 3), round(en, 3)
                d['duration'] = round(en - st, 3) if en > st else round(tl, 3)
            for mm in re.finditer(rb'([\x20-\x7e]{4,})\x00', b):
                s = mm.group(1).decode('latin1')
                if mm.start() < 4 or struct.unpack_from('<I', b, mm.start() - 4)[0] != len(s) + 1:
                    continue
                low = s.lower()
                if low.endswith('.bik'):
                    d['videos'].append(s)
                    vid = re.sub(r'^hs_', '', s[:-4])
                    if vid not in ids:
                        ids.append(vid)
                elif low.endswith('.lsd') and '/seqsounds/' in low and '/music/' not in low:
                    d['speech'].append(s)
                elif low.endswith(('.wav', '.lsd', '.mp3', '.ogg')):
                    d['sounds'].append(s)
        except (OSError, EOFError, struct.error, ValueError):
            d['file'] = False
    d['ids'] = ids
    for i in ids:
        for k, v in tx.prefix('_seq_%s_' % i):
            sp = k[len('_seq_%s_' % i):]
            sp = re.sub(r'_?\d+[a-z]?$', '', sp)
            d['lines'].append({'key': k, 'speaker': sp, 'text': v})
    return d


# ---------------------------------------------------------------- triggers
def _triggers(m, defaults, warn):
    t = T.triggers(m.chunks['Trgr'].data) if 'Trgr' in m.chunks else {'triggers': [], 'tree': None, 'warnings': [], 'compiled': []}
    warn.extend(t['warnings'])
    paths = T.folder_paths(t['tree'])
    out = []
    for x in t['triggers']:
        fl = x['flags']
        d = {'guid': x['guid'], 'name': x['name'], 'description': x['description'], 'folder': paths.get(x['guid'], ''),
             'index': x.get('index'), 'compiled': x['compiled'],
             'flags': fl, 'expression': x['expression'].strip(),
             'conditions': [{'type': c['type'], 'note': c['note'], 'name': c['name'], 'p': c['p']} for c in x['conditions']],
             'actions': [{'type': a['type'], 'note': a['note'], 'name': a['name'],
                          'difficulty': _int(a['p'].get('difficulty'), 1), 'p': a['p']} for a in x['actions']]}
        out.append(d)
    return out, t['tree'], len(t['compiled'])


def _defaults(install):
    out = {'conditions': {}, 'actions': {}}
    if install is None:
        return out
    for kind, fn in (('conditions', 'condition_attrib_def.txt'), ('actions', 'action_attrib_def.txt')):
        p = install.file('Scripts/Server/misc/' + fn)
        if not p:
            continue
        try:
            with open(p, encoding='cp1252', errors='replace') as fh:
                d = T.attrib_defaults(fh.read())
        except (OSError, ValueError, IndexError):
            continue
        out[kind] = {t: {k: v['default'] for k, v in ps.items() if v['default'] is not None} for t, ps in d.items()}
    return out


def _check_refs(doc, warn):
    """resolve every guid the triggers refer to; fills doc['refs'] and reports what does not resolve"""
    objs = {o['guid']: o for o in doc['objects'] if o['guid']}
    names = {}
    for o in doc['objects']:
        names.setdefault(o['name'], o)
    regions = {r['guid']: r for r in doc['regions']}
    quests = {q['guid']: q for q in doc['quests']}
    qnames = {q['name']: q for q in doc['quests']}
    trigs = {t['guid']: t for t in doc['triggers']}
    folders = set()

    def walk(f, path):
        p = (path + '/' + f['name']) if path else f['name']
        folders.add(p + '/')
        for c in f['folders']:
            walk(c, p)
    if doc['trigger_tree']:
        walk(doc['trigger_tree'], '')
    refs = {}
    seen = set()

    def once(msg):
        if msg not in seen:
            seen.add(msg)
            warn.append(msg)

    for t in doc['triggers']:
        dead = t['flags']['disabled']
        tag = 'trigger "%s"%s' % (t['name'], ' (disabled)' if dead else '')
        for kind, lst in (('condition', t['conditions']), ('action', t['actions'])):
            for n in lst:
                p = n['p']
                where = '%s, %s %s' % (tag, kind, n['type'])
                for k, v in p.items():
                    if k.endswith('rgn_guid'):
                        if v == 'UniqueWorldRegion' or v == '':
                            continue
                        if v in regions:
                            refs[v] = ['region', regions[v]['name']]
                        else:
                            once('%s: region %s (%s) does not exist' % (where, v, k))
                    elif k.endswith('obj_guid'):
                        if v in ('NA', ''):
                            continue
                        nm = p.get(k[:-4] + 'name', '')
                        if v in objs:
                            refs[v] = [objs[v]['type'], objs[v]['name']]
                        elif nm in names:
                            # ObjFinder falls back to the name (ConditionFactory.usl:535-539)
                            refs[v] = [names[nm]['type'], nm, 'by name']
                            once('%s: object guid %s not on the map, resolved by its name "%s"' % (where, v, nm))
                        else:
                            # a leftover of an object deleted in the editor: the query finds nothing (no live
                            # trigger addresses a run-time object by name, spec triggers.md 2.4)
                            refs[v] = ['missing', nm]
                            once('%s: object "%s" (%s) is not on the map (deleted in the editor): the query finds nothing' % (where, nm, v))
                    elif k in _GUID_LISTS:
                        for g in v.split('\n'):
                            g = g.strip()
                            if not g:
                                continue
                            if g in objs:
                                refs[g] = [objs[g]['type'], objs[g]['name']]
                            else:
                                once('%s: %s lists an object that is not on the map (%s)' % (where, k, g))
                    elif (n['type'], k) in (('TRIG', 'guid'),):
                        if v in trigs:
                            refs[v] = ['trigger', trigs[v]['name']]
                            if trigs[v]['flags']['disabled'] and not dead:
                                once('%s: target trigger "%s" is disabled (not compiled): the action does nothing' % (where, trigs[v]['name']))
                        else:
                            once('%s: trigger %s does not exist' % (where, v))
                    elif k == 'quest_guid':
                        if v in quests:
                            refs[v] = ['quest', quests[v]['name']]
                        elif p.get('quest_name') in qnames:
                            refs[v] = ['quest', p['quest_name'], 'by name']
                        else:
                            once('%s: quest %s (%s) does not exist' % (where, v, p.get('quest_name', '')))
                    elif k in ('group', 'group_guid', 'questionmark'):
                        if v in objs:
                            refs[v] = [objs[v]['type'], objs[v]['name']]
                        elif v:
                            once('%s: %s %s is not an object of the map' % (where, k, v))
                    elif (n['type'], k) == ('ACND', 'nodename'):
                        if v not in folders and v.rstrip('/') + '/' not in folders:
                            once('%s: trigger folder "%s" does not exist' % (where, v))
    doc['refs'] = refs


_KEY = re.compile(r'^_[A-Za-z0-9][A-Za-z0-9_+\-]*$')


def _collect_texts(doc, tx):
    keys = set()

    def add(k):
        if isinstance(k, str) and k and tx.has(k):
            keys.add(k)
    add(doc['map']['name']); add(doc['map']['description_key'])
    for p in doc['players']:
        add(p.get('name_key'))
    for q in doc['quests']:
        add(q['key_headline']); add(q['key_description']); add(q['key_group'])
    for t in doc['triggers']:
        for n in t['conditions'] + t['actions']:
            for k, v in n['p'].items():
                if not isinstance(v, str) or '_' not in v:
                    continue
                for part in re.split(r'[\t\n|]', v):
                    part = part.strip()
                    if _KEY.match(part):
                        add(part)
    for d in doc['dialogs'].values():
        for a in d['actors'].values():
            add(a.get('name_key'))
        for f in d['frames']:
            add(f['key'])
    for s in doc['sequences'].values():
        for ln in s['lines']:
            add(ln['key'])
    for k in ('_SubQuestGroup', '_NT_QuestNew', '_NT_QuestAccomplished', '_NT_QuestUnaccomplishable', '_NT_ACTOR_TEXT_SEPARATOR',
              '_GAOV_Failed', '_GAOV_Accomplished', '_UI_QuestWin_Title_Quests'):
        add(k)
    return {k: tx.get(k) for k in sorted(keys)}


# ---------------------------------------------------------------- the document
def campaign(map_path, install=None, lang='uk'):
    """the mission data of a map (see the module header). install: an Install, a path, or None = the installation the
    map lies in (if any)."""
    if isinstance(install, str):
        try:
            install = Install(install)
        except (ValueError, OSError):
            install = None
    if install is None:
        install = find_install(map_path)
    m = ula.Map.load(map_path)
    tx = TextTable(install, lang)
    warn = []
    if install is None:
        warn.append('no game installation: texts, dialogue scenes and sequences are missing')
    elif not tx.t:
        warn.append('no text tables found for language "%s"' % lang)
    objs, by_guid, groups, qms = _objects(m)
    info = _map_info(m, tx)
    regions, rtree = _regions(m)
    trigs, ttree, ncompiled = _triggers(m, None, warn)
    doc = {
        'schema': SCHEMA, 'lang': lang,
        'map': info,
        'players': _players(m, tx, objs, by_guid, warn),
        'objects': objs, 'groups': groups, 'question_marks': qms,
        'regions': regions, 'region_tree': rtree,
        'quests': _quests(m, tx, info['name'], warn),
        'variables': _variables(m),
        'triggers': trigs, 'trigger_tree': ttree,
        'defaults': _defaults(install),
        'texts': {}, 'dialogs': {}, 'sequences': {}, 'refs': {},
        'counts': {'objects': len(objs), 'triggers': len(trigs), 'compiled_triggers': ncompiled,
                   'conditions': sum(len(t['conditions']) for t in trigs), 'actions': sum(len(t['actions']) for t in trigs),
                   'quests': 0, 'regions': len(regions), 'groups': len(groups), 'question_marks': len(qms)},
        'warnings': warn,
    }
    doc['counts']['quests'] = len(doc['quests'])
    dl, sq = [], []
    for t in trigs:
        for n in t['conditions'] + t['actions']:
            p = n['p']
            for k, lst in (('scene', dl), ('dlgscene_name', dl), ('sequence', sq), ('sequence_name', sq)):
                v = p.get(k)
                if v and v not in lst and (n['type'], k) in (('DGSC', 'scene'), ('DSEN', 'dlgscene_name'), ('SQNZ', 'sequence'), ('SQEN', 'sequence_name')):
                    lst.append(v)
    for pl in doc['players']:
        s = pl.get('start_location')
        if s and s.get('seq_filename') and s['seq_filename'] not in sq:
            sq.append(s['seq_filename'])
    missing = [0, 0]
    for v in dl:
        doc['dialogs'][v] = dialog(v, install, tx)
        if not doc['dialogs'][v]['file']:
            missing[0] += 1
        if not doc['dialogs'][v]['frames']:
            warn.append('dialogue scene %s: no file and no texts' % v)
    for v in sq:
        doc['sequences'][v] = sequence(v, install, tx)
        if not doc['sequences'][v]['file']:
            missing[1] += 1
    if install is not None and (missing[0] or missing[1]):
        warn.append('%d of %d dialogue scene files and %d of %d sequence files are not in the installation '
                    '(their texts come from the text tables)' % (missing[0], len(dl), missing[1], len(sq)))
    _check_refs(doc, warn)
    doc['texts'] = _collect_texts(doc, tx)
    return doc


def campaign_maps(install):
    """the missions of the single player campaign in playing order:
    [{'id' (0 = tutorial), 'key', 'file', 'path', 'pack', 'rel', 'min_credits', 'point_buy'}].
    Order and names come from Scripts/Server/settings/Campaigns.txt (CampaignMgr.usl:40-65); maps of the
    Cpn_single_* folders that the list does not name follow in file order."""
    if isinstance(install, str):
        install = Install(install)
    found = {}
    for e in install.maps():
        mm = re.search(r'(^|/)cpn_single_\d+/([^/]+)\.ula$', e['rel'].replace('\\', '/').lower())
        if mm:
            found.setdefault(mm.group(2) + '.ula', e)
    order = []
    p = install.file('Scripts/Server/settings/Campaigns.txt')
    if p:
        try:
            with open(p, encoding='cp1252', errors='replace') as fh:
                root = T.propdb(fh.read())
            camp = _pchild(root, 'Campaign')
            for c in (camp['children'] if camp else []):
                order.append((c['name'], c['value'].lower(), c['attr']))
        except (OSError, ValueError, IndexError):
            order = []
    out, used = [], set()
    for key, fn, at in order:
        e = found.get(fn)
        if e is None:
            continue
        used.add(fn)
        out.append({'key': key, 'file': fn, 'path': e['path'], 'pack': e['pack'], 'rel': e['rel'],
                    'min_credits': _int(at.get('MinCredits'), 0), 'point_buy': at.get('PB_Available') == '1'})
    for fn in sorted(found):
        if fn not in used:
            e = found[fn]
            out.append({'key': os.path.splitext(fn)[0], 'file': fn, 'path': e['path'], 'pack': e['pack'], 'rel': e['rel'],
                        'min_credits': 0, 'point_buy': False})
    for i, e in enumerate(out):
        mm = re.search(r'(\d+)\.ula$', e['file'])
        e['id'] = int(mm.group(1)) if mm else i
    return out


# ---------------------------------------------------------------- the readable dump
_QUERY_KEYS = ('rgn_guid', 'obj_type', 'obj_owner', 'obj_guid', 'obj_name', 'obj_class', 'exclude_class', 'char_tribe',
               'char_caste', 'char_level', 'from_condition')
_HIDE = {'renderable', 'renderable_type', 'difficulty'}


def _query_text(p, prefix, doc):
    """one line for the object query block with the given prefix ('' / 'dst_' / 'B_' ...), None if it has none"""
    if prefix + 'obj_type' not in p and prefix + 'rgn_guid' not in p and prefix + 'obj_name' not in p:
        return None
    refs = doc['refs']
    parts = []
    name = p.get(prefix + 'obj_name', 'NA')
    if p.get(prefix + 'from_condition', '-1') not in ('-1', ''):
        parts.append('the objects of condition #%s' % p[prefix + 'from_condition'])
    elif name not in ('NA', ''):
        r = refs.get(p.get(prefix + 'obj_guid'), [])
        parts.append('%s "%s"' % (r[0] if r else 'object', name))
    else:
        ty = p.get(prefix + 'obj_type', 'All|').strip('|') or 'All'
        s = ty
        cl = p.get(prefix + 'obj_class', 'NA')
        if cl not in ('NA', ''):
            s += ' class ' + cl
        ow = p.get(prefix + 'obj_owner')
        s += ' of player %s' % ow if ow not in (None, '-2') else ' of any owner'
        ex = p.get(prefix + 'exclude_class', 'NA').strip('|')
        if ex not in ('NA', ''):
            s += ' except ' + ex
        for k in ('char_tribe', 'char_caste', 'char_level'):
            if p.get(prefix + k) not in (None, 'All', '-1', ''):
                s += ' %s=%s' % (k, p[prefix + k])
        parts.append(s)
    rg = p.get(prefix + 'rgn_guid', 'UniqueWorldRegion')
    if rg not in ('UniqueWorldRegion', ''):
        parts.append('in region "%s"' % (refs.get(rg, ['', rg])[1]))
    return ' '.join(parts)


def _node_text(n, doc, trig):
    """a condition / action as one readable line"""
    p, ty, refs, texts = n['p'], n['type'], doc['refs'], doc['texts']
    used = set(_HIDE)
    prefixes = sorted({k[:-len('obj_type')] for k in p if k.endswith('obj_type')} |
                      {k[:-len('rgn_guid')] for k in p if k.endswith('rgn_guid') and (k[:-len('rgn_guid')] + 'obj_type') in p}, key=len)
    q = []
    for pre in prefixes:
        s = _query_text(p, pre, doc)
        if s:
            q.append((pre or 'objects', s))
        for k in _QUERY_KEYS:
            used.add(pre + k)

    def ref(g):
        r = refs.get(g)
        return '"%s"' % r[1] if r else g

    def txt(k):
        t = texts.get(k)
        return '%s "%s"' % (k, t.replace('\n', ' / ')[:110]) if t is not None else k
    head = ''
    if ty == 'TRIG':
        head = {'1': 'enable', '2': 'toggle'}.get(p.get('state', '0'), 'disable') + ' trigger ' + ref(p.get('guid', ''))
        used |= {'guid', 'state'}
    elif ty == 'QUES':
        qn = refs.get(p.get('quest_guid'), ['', p.get('quest_name', p.get('quest_guid', ''))])[1]
        st = p.get('dest_state', '0')
        if trig == 'c':
            head = 'quest "%s" is %s' % (qn, {'0': 'visible', '1': 'accomplished', '2': 'unaccomplishable', '3': 'untouched'}.get(st, st))
        else:
            head = 'quest "%s" -> %s' % (qn, {'0': 'show', '1': 'ACCOMPLISHED', '2': 'FAILED (unaccomplishable)', '3': 'hide'}.get(st, st))
        used |= {'quest_guid', 'quest_name', 'dest_state', 'owner'}
    elif ty in ('VARS', 'CVAR'):
        head = '%s %s %s' % (p.get('varname', '?'), p.get('operation', '>=' if ty == 'CVAR' else '?'), p.get('value', ''))
        used |= {'varname', 'operation', 'value', 'local'}
    elif ty == 'DGSC':
        d = doc['dialogs'].get(p.get('scene'), {})
        head = p.get('scene', '') + ''.join('\n%s%s: %s' % (' ' * 14, f['speaker'] or f['actor'] or '-', f['text'].replace('\n', ' ')) for f in d.get('frames', []))
        used.add('scene')
    elif ty == 'SQNZ':
        s = doc['sequences'].get(p.get('sequence'), {})
        head = p.get('sequence', '') + (' (%d subtitle lines)' % len(s['lines']) if s.get('lines') else '')
        if s.get('lines'):
            head += '\n%s"%s"' % (' ' * 14, s['lines'][0]['text'].replace('\n', ' ')[:100])
        used.add('sequence')
    elif ty in ('SQEN', 'DSEN'):
        head = 'ended: ' + p.get('sequence_name', p.get('dlgscene_name', ''))
        used |= {'sequence_name', 'dlgscene_name'}
    elif ty == 'FDBK':
        head = '(debug text) ' + repr(p.get('msg_text', ''))
        used |= {'msg_text', 'player_id'}
    elif ty == 'GAOV':
        head = 'MISSION LOST, player %s: %s' % (p.get('player_id', '0'), txt(p.get('reason', '')))
        used |= {'player_id', 'reason'}
    elif ty == 'QUIT':
        head = 'MISSION WON'
        used.add('result')
    elif ty == 'QMRK':
        head = 'question mark %s -> %s, tooltip %s' % (ref(p.get('questionmark', '')), p.get('questionstate', ''), txt(p.get('questiontooltip', '')))
        used |= {'questionmark', 'questionstate', 'questiontooltip'}
    elif ty in ('CKGR', 'SPGR', 'ADGR'):
        g = p.get('group_guid', p.get('group', ''))
        head = 'group ' + ref(g) + (' count ' + p['check_val'] if 'check_val' in p else '')
        used |= {'group_guid', 'group', 'check_val'}
    elif ty == 'REGN':
        head = 'count %s' % p.get('obj_count', '')
        used.add('obj_count')
    rest = []
    for k, v in p.items():
        if k in used:
            continue
        if isinstance(v, str) and v in refs:
            v = ref(v)
        elif isinstance(v, str) and _KEY.match(v.split('\t')[0]) and v.split('\t')[0] in texts:
            v = txt(v.split('\t')[0]) + (' ' + ' '.join(v.split('\t')[1:]) if '\t' in v else '')
        elif k in _GUID_LISTS:
            v = '[' + ', '.join(ref(g.strip()) for g in v.split('\n') if g.strip()) + ']'
        else:
            v = str(v).replace('\n', ' ; ')
        rest.append('%s=%s' % (k, v))
    line = ty
    more = ''
    if head:
        head, _, more = head.partition('\n')
        line += ' ' + head
    if rest:
        line += ('  ' if head else ' ') + ', '.join(rest)
    if more:
        line += '\n' + more
    for pre, s in q:
        line += '\n%s%s: %s' % (' ' * 14, pre.rstrip('_'), s)
    if trig == 'a' and n.get('difficulty', 1) != 1:
        line += '   [only on %s]' % {0: 'EASY', 2: 'HARD'}.get(n['difficulty'], n['difficulty'])
    if n.get('name'):
        line += '   <%s>' % n['name']
    if n.get('note'):
        line += '   # ' + n['note'].replace('\n', ' ')
    return line


def text_dump(doc):
    """the mission as text: players, quests, variables, regions, groups and every trigger as readable pseudo-code"""
    L = []
    mp = doc['map']
    L.append('%s  (%s)  -  %s' % (mp['title'], mp['file'], mp['name']))
    L.append('=' * 100)
    if mp['description']:
        L.append(mp['description'])
    L.append('setting %s, %d x %d m, water %.1f, start %s, default camera %.3f rad, AI options: %s' % (
        mp['setting'], mp['w'], mp['h'], mp['water'], mp['start_time']['raw'], mp['default_camera'],
        ', '.join(k for k, v in mp['ai_options'].items() if v) or '-'))
    c = doc['counts']
    L.append('%d objects, %d triggers (%d compiled; %d conditions, %d actions), %d quests, %d regions, %d groups, %d question marks' % (
        c['objects'], c['triggers'], c['compiled_triggers'], c['conditions'], c['actions'], c['quests'], c['regions'], c['groups'], c['question_marks']))
    L.append('')
    L.append('PLAYERS')
    rel = 'HNF'
    for p in doc['players']:
        if not p['present']:
            continue
        sl = p['start_location']
        L.append('  %d  %-12s %-7s team %d colour %2d  "%s"  diplomacy %s  res f/w/s/i %s  AI difficulty e/m/h %s%s' % (
            p['id'], p['control'], p['tribe'], p['team'], p['color'], p['name'],
            ''.join(rel[d] if 0 <= d < 3 else '?' for d in p['diplomacy']),
            '/'.join(str(p['resources'][r]) for r in RESOURCES),
            '/'.join(str(p['ai_difficulty'][k]) for k in ('easy', 'medium', 'hard')),
            ('  start (%.0f, %.0f)%s' % (sl['x'], sl['y'], '' if sl['ignore_pointbuy'] else ' +army')) if sl else ''))
        ex = []
        if p['population_limit'] is not None:
            ex.append('population limit %d' % p['population_limit'])
        if any(u['max'] is not None for u in p['unit_limits']):
            ex.append('unit limits ' + '/'.join(str(u['max']) for u in p['unit_limits']))
        if p['include_buildings']:
            ex.append('main building at start')
        if p['tech_filters']:
            ex.append('%d tech filters' % len(p['tech_filters']))
        if p['start_army']:
            ex.append('start army: ' + ', '.join('%s L%d' % (e['class'], e['level'] + 1) for e in p['start_army']))
        if ex:
            L.append('       ' + '; '.join(ex))
    L.append('  (diplomacy: one letter per player 0..7 = this player\'s relation to it: H hostile, N neutral, F friendly)')
    L.append('')
    L.append('QUESTS')
    for q in doc['quests']:
        L.append('  %-4s %-34s [%s] bonus %d/%d/%d  "%s"' % ('MAIN' if q['main'] else 'side', q['name'], q['group'],
                                                           q['bonus']['easy'], q['bonus']['medium'], q['bonus']['hard'], q['headline']))
        for ln in (q['description'] or '').split('\n'):
            if ln.strip():
                L.append('         ' + ln.strip())
    L.append('')
    if doc['variables']:
        L.append('VARIABLES  ' + ', '.join('%s=%s' % (k, v['value']) for k, v in doc['variables'].items()))
        L.append('')
    by = {}
    for o in doc['objects']:
        by[o['type']] = by.get(o['type'], 0) + 1
    L.append('OBJECTS  ' + ', '.join('%s %d' % kv for kv in sorted(by.items(), key=lambda kv: -kv[1])))
    own = {}
    for o in doc['objects']:
        if o['type'] in ('CHTR', 'ANML', 'VHCL', 'SHIP', 'BLDG') and o['owner'] is not None:
            own.setdefault(o['owner'], {}).setdefault(o['type'], 0)
            own[o['owner']][o['type']] += 1
    for k in sorted(own):
        L.append('  player %d: %s' % (k, ', '.join('%s %d' % kv for kv in sorted(own[k].items()))))
    L.append('')
    if doc['groups']:
        L.append('GROUPS  ' + ', '.join('%s(%d)' % (g['name'], len(g['members'])) for g in doc['groups']))
        L.append('')
    if doc['question_marks']:
        L.append('QUESTION MARKS  ' + ', '.join(q['name'] for q in doc['question_marks']))
        L.append('')
    used_regions = {g for g, r in doc['refs'].items() if r[0] == 'region'}
    L.append('REGIONS used by triggers (%d of %d)' % (len(used_regions), len(doc['regions'])))
    for r in doc['regions']:
        if r['guid'] in used_regions:
            L.append('  %-40s %s' % (r['name'], '; '.join('%s%s %.0f,%.0f %.0fx%.0f' % (s['type'], '' if s['enabled'] else '(off)', s['x'], s['y'], s['w'], s['h']) for s in r['shapes'])))
    L.append('')
    L.append('TRIGGERS')
    L.append('  flags: E enabled at start, O once, R random action, D by difficulty, N node off (inactive folder), X disabled in the editor (not compiled)')
    tr = {t['guid']: t for t in doc['triggers']}

    def folder(f, path, depth):
        p = (path + '/' + f['name']) if path else f['name']
        L.append('')
        L.append('%s[%s]' % ('', p))
        for g in f['triggers']:
            t = tr.get(g)
            if t is None:
                continue
            fl = t['flags']
            L.append('  TRIGGER "%s"  %s%s%s%s%s%s%s' % (
                t['name'], 'E' if fl['enabled'] else '-', 'O' if fl['once'] else '-', 'R' if fl['random'] else '-',
                'D' if fl['by_difficulty'] else '-', 'N' if fl['node_off'] else '-', 'X' if fl['disabled'] else '-',
                ('   # ' + t['description'].replace('\n', ' ')) if t['description'] else ''))
            n = len(t['conditions'])
            expr = t['expression'] or ('1' if n == 1 else ' && '.join(str(i + 1) for i in range(n)) + '  (no expression stored)' if n else '(no condition)')
            L.append('    IF  %s' % expr)
            for i, cnd in enumerate(t['conditions']):
                L.append('      %2d. %s' % (i + 1, _node_text(cnd, doc, 'c')))
            L.append('    DO')
            for i, a in enumerate(t['actions']):
                L.append('      %2d. %s' % (i + 1, _node_text(a, doc, 'a')))
        for c in f['folders']:
            folder(c, p, depth + 1)
    if doc['trigger_tree']:
        folder(doc['trigger_tree'], '', 0)
    if doc['warnings']:
        L.append('')
        L.append('WARNINGS (%d)' % len(doc['warnings']))
        L.extend('  ' + w for w in doc['warnings'])
    return '\n'.join(L) + '\n'


# ---------------------------------------------------------------- command line
def main(argv=None):
    import argparse
    import json
    ap = argparse.ArgumentParser(prog='python -m pwexport.campaign',
                                 description='the mission data of a ParaWorld campaign map as JSON (schema %s)' % SCHEMA)
    ap.add_argument('map', nargs='?', help='a campaign map (.ula)')
    ap.add_argument('--install', help='the game folder (default: the installation the map lies in)')
    ap.add_argument('--lang', default='uk', help='text language: uk (English), de, fr ... (default uk)')
    ap.add_argument('--json', help='write the JSON document to this file')
    ap.add_argument('--text', help='write a readable dump of the mission to this file')
    ap.add_argument('--all', metavar='DIR', help='export every mission of the campaign into DIR (single_NN.json + .txt)')
    ap.add_argument('--compact', action='store_true', help='JSON without indentation')
    a = ap.parse_args(argv)

    def write(doc, jpath, tpath):
        if jpath:
            with open(jpath, 'w', encoding='utf-8') as f:
                if a.compact:
                    json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
                else:
                    json.dump(doc, f, ensure_ascii=False, indent=1)
        if tpath:
            with open(tpath, 'w', encoding='utf-8') as f:
                f.write(text_dump(doc))

    if a.all:
        inst = Install(a.install) if a.install else (find_install(a.map) if a.map else None)
        if inst is None:
            ap.error('--all needs --install <game folder>')
        os.makedirs(a.all, exist_ok=True)
        for e in campaign_maps(inst):
            doc = campaign(e['path'], inst, a.lang)
            stem = os.path.join(a.all, 'single_%02d' % e['id'])
            write(doc, stem + '.json', stem + '.txt')
            c = doc['counts']
            print('%-12s %-28s %5d objects %4d triggers %3d quests %3d regions %4d warnings' % (
                e['file'], doc['map']['title'][:28], c['objects'], c['triggers'], c['quests'], c['regions'], len(doc['warnings'])))
        return 0
    if not a.map:
        ap.error('a map file or --all DIR is required')
    doc = campaign(a.map, a.install, a.lang)
    write(doc, a.json, a.text)
    if not a.json and not a.text:
        json.dump(doc, __import__('sys').stdout, ensure_ascii=False, indent=None if a.compact else 1)
    else:
        c = doc['counts']
        print('%s: %d objects, %d triggers, %d quests, %d regions, %d warnings' % (
            doc['map']['title'], c['objects'], c['triggers'], c['quests'], c['regions'], len(doc['warnings'])))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
