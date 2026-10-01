"""Step "assets": collect the models/textures the remake needs into <OUT>/assets and write assets/manifest.json.

Models come from convert_models.py (<CONV>, one folder per GSF archive), which uses the Model Exporter's GSF
reader (pwexport) - fixes to the exporter reach the game with the next asset build.
Image URIs inside the .glb files are rewritten to ../tex/<file> so all models share one texture folder.
The manifest records per model: file, where its animations live, and walk speeds read from the GSF data.
"""
import json, os, sys, struct, shutil, hashlib, re
try:
    from . import paths
except ImportError:
    import paths
from pwexport import gsf as pg, composites       # noqa: E402
from pwexport.glb import repack                  # noqa: E402
from pwexport.install import Install             # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def load_glb(path):
    b = open(path, 'rb').read()
    jl = struct.unpack_from('<I', b, 12)[0]
    j = json.loads(b[20:20 + jl])
    return j, b[20 + jl:]


def write_glb(path, j, rest):
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    open(path, 'wb').write(struct.pack('<III', 0x46546C67, 2, 20 + len(js) + len(rest)) + struct.pack('<II', len(js), 0x4E4F534A) + js + rest)


KEEP_ANIMS = ['walk_0', 'walk_1', 'walk_2', 'walk_3', 'standanim', 'idle_0', 'idle_1', 'idle_2', 'dying', 'die_simple', 'hit_reaction',
              'level_up', 'hacking', 'hacking_dirt', 'hacking_stone', 'harvesting_bush', 'chop_tree', 'chop_0', 'chop_1', 'hammer',
              'potter', 'potter_ground', 'all_slingshot', 'pick_up', 'put_down', 'shoulder_walk_1', 'shoulder_walk_2', 'shoulder_walk_3',
              'shoulder_standanim', 'belly_walk_1', 'belly_walk_2', 'belly_walk_3', 'belly_standanim', 'cheer', 'victory_0', 'menace',
              'rotate_left', 'rotate_right', 'standrotate_left', 'standrotate_right', 'sowing', 'raking', 'watering', 'scything',
              'seas_marksman_idle_01', 'aje_poisoner_idle_0',
              # carrying (walk sets "sldr" and "cary"), healing, fight stance transitions, guarding, riding
              'shoulder_pick_up', 'shoulder_put_down', 'carry_walk_1', 'carry_walk_2', 'carry_walk_3', 'carry_standrotate_left',
              'carry_standrotate_right', 'belly_pick_up', 'belly_put_down', 'standing', 'heal_0', 'res_guarding',
              'res_stand_to_fight', 'res_fight_to_stand', 'nat_stand_to_fight', 'nat_fight_to_stand', 'tec_fightpos_standanim',
              'tec_standpos_to_fightpos', 'tec_fightpos_to_standpos', 'ride_idle_0', 'ride_attack_front', 'balista_stand', 'all_walk_3_loop',
              # special moves, knockback, entrenching, building work (src/game/systems/moves.js, combat.js, buildings.js)
              'res_sm_kick', 'res_sm_jump', 'nat_sm_twister', 'nat_sm_matrix', 'tec_sm_burst_arrow', 'tec_sm_multishot', 'trumpet',
              'pawing', 'sm_shake_off', 'titan_rage', 'termites', 'tornado', 'shotgun', 'throwdownshot', 'digandhide', 'hideandstand',
              'babbage_minigun', 'lovelace_musket', 'warden_spec', 'aje_velo_strike_0', 'sm_scrunch', 'stomp_harvest', 'sm_attack_back',
              'trex_fm_2', 'harvest', 'sm_01', 'rest', 'nat_throw', 'hit_back', 'getting_up', 'sm_jump_01', 'jump', 'first_strike_0',
              'victory_0', 'victory_1', 'victory_2', 'jans_anim_0', 'jans_anim_1', 'jans_anim_2', 'tavern_spawn', 'feeding', 'praying_wall']


def techtree_models():
    """every model the four tribes (and the heroes, and the wild animals of the roster) can show:
    object gfx of every level (StartTT + level filters), weapon parts, projectiles and captains"""
    T = json.load(open(os.path.join(paths.OUT, 'techtree.json')))
    ST, F = T['StartTT'], T['Filters']
    roster = json.load(open(os.path.join(HERE, 'roster.json')))
    names = set()
    def scal(v): return v.get('_value') if isinstance(v, dict) else v
    for tribe, A in ST['Actions'].items():
        for kind in ('Build',):
            for cat, acts in (A.get(kind) or {}).items():
                for aid, a in acts.items():
                    if not isinstance(a, dict): continue
                    for r in (a.get('results') or {}).values():
                        if isinstance(r, dict) and scal(r): names.add(scal(r).split('/')[-1])
    names |= {'hu_fireplace', 'ninigi_fireplace', 'seas_headquarters', 'aje_resource_collector'}
    names |= set(roster['wild'])
    # every wild animal of the tech tree (original maps spawn them from nests)
    names |= set((ST['Objects'].get('World') or {}).get('ANML') or {})
    gfx = set()
    for tribe, O in ST['Objects'].items():
        for typ in ('CHTR', 'ANML', 'VHCL', 'SHIP', 'BLDG'):
            for n, o in (O.get(typ) or {}).items():
                if n not in names or not isinstance(o, dict): continue
                if scal(o.get('gfx')): gfx.add(scal(o['gfx']))
                cap = scal(o.get('captainclass'))
                if cap and cap != '0':
                    for t2, O2 in ST['Objects'].items():
                        c = (O2.get('CHTR') or {}).get(cap)
                        if isinstance(c, dict) and scal(c.get('gfx')): gfx.add(scal(c['gfx']))
                up = ((F.get(tribe) or {}).get('Upgrades') or {}).get(n) or {}
                for k, f in up.items():
                    if not isinstance(f, dict): continue
                    lbd = f.get('LevelBonusData') or {}
                    if scal(lbd.get('gfx')): gfx.add(scal(lbd['gfx']))
                    for m in (f.get('Modificators') or {}).values():
                        if isinstance(m, dict) and str(m.get('path', '')).endswith('/gfx') and isinstance(m.get('value'), str): gfx.add(m['value'])
        for wn, w in (O.get('Weapons') or {}).items():
            if not isinstance(w, dict): continue
            users = {scal(u) for u in (w.get('Users') or {}).values()}
            if not users & names: continue
            for p in (w.get('Parts') or {}).values():
                if isinstance(p, dict):
                    for g in (p.get('Gfx') or {}).values():
                        if isinstance(scal(g), str): gfx.add(scal(g))
            for p in (w.get('Projectile') or {}).values():
                if isinstance(scal(p), str): gfx.add(scal(p))
    return {g for g in gfx if g and g != '0'}


def main(log=print, progress=None):
    CONV, DATA, OUT = paths.CONV, paths.DATA, paths.OUT
    roster = json.load(open(os.path.join(HERE, 'roster.json')))
    data = json.load(open(os.path.join(OUT, 'gamedata.json')))
    index = {}
    for root in (CONV,):
        if not os.path.isdir(root): continue
        for arch in os.listdir(root):
            d = os.path.join(root, arch)
            if not os.path.isdir(d): continue
            for f in os.listdir(d):
                if f.endswith('.glb'):
                    index[f[:-4].lower()] = (arch, os.path.join(d, f))   # VEG overrides CONV (walked last)
    TT = json.load(open(os.path.join(OUT, 'techtree.json')))['StartTT']['Objects']
    used_anims = set()
    for lst in (data.get('idle') or {}).values():      # IdleAnims.txt
        for e in lst: used_anims.add(e[0])
    want = set(x.lower() for x in techtree_models())
    # objects whose tech tree gfx doesn't exist use the class file's gfx (e.g. hu_flamethrower -> seas_flamethrower_s2)
    cg = data.get('classgfx') or {}
    for tribe in ('Hu', 'Aje', 'Ninigi', 'SEAS', 'Special'):
        for typ in ('CHTR', 'ANML', 'VHCL'):
            for n, o in ((TT.get(tribe) or {}).get(typ) or {}).items():
                g = o.get('gfx') if isinstance(o, dict) else None
                g = (g.get('_value') if isinstance(g, dict) else g) or ''
                if g.lower() not in index and cg.get(n.lower()) in index: want.add(cg[n.lower()])
    for O_ in TT.values():
        for w_ in (O_.get('Weapons') or {}).values():
            if not isinstance(w_, dict): continue
            for a in (w_.get('Animations') or {}).values():
                n = a.get('_value') if isinstance(a, dict) else a
                if isinstance(n, str): used_anims.add(n)
    for parts in composites.normalized().values():          # animations attached parts play (riders, gunners, turrets)
        for p_ in parts:
            for a_ in (p_.get('anim'), p_.get('attack_anim')):
                if a_: used_anims.add(a_)
    for grp in roster['props'].values():
        want |= {x.lower() for x in grp}
    want |= {x.lower() for x in roster['extra_models']}
    core = set(want)       # models the game itself needs; everything added below is only loaded when a map uses it
    # landscape archives (trees, rocks, plants, rivers, ruins of the original maps): every model
    for a in roster.get('archives', []):
        want |= {k for k, (arch, _) in index.items() if arch == a}
    # map object classes resolve to models through the class files (gamedata classgfx), e.g. nests, fish shoals
    want |= {g for g in cg.values() if g in index and index[g][0] in set(roster.get('archives', [])) | {'all_animals', 'all_misc'} and not g.endswith('_dest')}
    want |= {k for k in index if re.match(r'(seas|aje|hu|ninigi)_(axe|pick|hammer|sickle|shovel|basket|crane_0\d)', k)}
    want |= {'aje_resource_collector_drawbar', 'seas_turret'} | {'aje_resource_collector_' + c for c in 'abcde'}
    # attached parts the scripts put on units and buildings (riders, turrets, build-ups, drawbars, level flags,
    # harbour cranes ... ModelExporter/pwexport/data/composites.json) and the rally point flags
    for oname, parts in composites.normalized().items():
        if oname in {o.lower() for O_ in TT.values() for typ in ('CHTR', 'ANML', 'VHCL', 'SHIP', 'BLDG') for o in (O_.get(typ) or {})}:
            for p_ in parts:
                if p_['cond'] not in ('special',): want |= {g for g in [p_['gfx']] + p_['variants'] if g in index}
    want |= {t + '_rally_point' + h for t in ('hu', 'aje', 'ninigi', 'seas') for h in ('', '_harbour')}
    want |= {k for k in index if k.endswith('_dest') and k[:-5] in want}
    missing = sorted(w for w in want if w not in index)
    want = sorted(w for w in want if w in index)
    # animation sources
    anim_src = {}
    for w in list(want):
        j, _ = load_glb(index[w][1])
        src = (j['nodes'][0].get('extras') or {}).get('animations_in')
        if src:
            s = src[:-4].lower()
            anim_src[w] = s
            if s not in want and s in index: want.append(s)
    os.makedirs(OUT + '/assets/models', exist_ok=True)
    os.makedirs(OUT + '/assets/tex', exist_ok=True)
    tex_seen = {}
    manifest = {'models': {}}
    for wi, w in enumerate(want):
        if progress and wi % 50 == 0:
            progress('Collecting models (%d / %d)' % (wi, len(want)), wi / max(1, len(want)))
        arch, path = index[w]
        j, rest = load_glb(path)
        for im in j.get('images', []):
            uri = im.get('uri')
            if not uri: continue
            src = os.path.join(os.path.dirname(path), uri)
            name = os.path.basename(uri)
            data_ = open(src, 'rb').read()
            h = hashlib.md5(data_).hexdigest()
            if name in tex_seen and tex_seen[name] != h:
                base, ext = os.path.splitext(name)
                name = '%s__%s%s' % (base, arch, ext)
            if name not in tex_seen or not os.path.exists(OUT + '/assets/tex/' + name):
                open(OUT + '/assets/tex/' + name, 'wb').write(data_)
                tex_seen[name] = h
            im['uri'] = '../tex/' + name
        ex0 = j['nodes'][0].get('extras') or {}
        ws = ex0.get('walksets') or {}
        walkset = ws.get('defn') or ws.get('def') or {}       # FightingObj: "defn" if the model has it, else "def"
        nm = len(j.get('animations', []))
        if nm > 80:   # human animation packs: keep only what the game uses
            keep = set(KEEP_ANIMS) | used_anims | set(walkset.values())
            names = [a['name'] for a in j['animations'] if a['name'] in keep or re.match(r'(res|nat|tec)_(idle|fight)', a['name'])]
            binc = rest[8:8 + struct.unpack_from('<I', rest, 0)[0]]
            out = repack(j, binc, set(names))
            open(OUT + '/assets/models/%s.glb' % w, 'wb').write(out)
            j, rest = load_glb(OUT + '/assets/models/%s.glb' % w)
        else:
            write_glb(OUT + '/assets/models/%s.glb' % w, j, rest)
        ex = j['nodes'][0].get('extras') or {}
        manifest['models'][w] = {'arch': arch, 'anims': anim_src.get(w), 'foliage': 'foliage' in ex,
                                 'nanims': len(j.get('animations', []))}
        if w not in core and arch in roster.get('archives', []):
            manifest['models'][w]['map'] = True      # map object: loaded only when the map uses it (main.js loadModels)
        if ex.get('pf'): manifest['models'][w]['pf'] = ex['pf']
        if walkset:      # slots 0..2 = walk speeds 1..3 (pwexport.gsf parse_header1)
            manifest['models'][w]['walk'] = {str(k + 1): walkset[str(k)] for k in range(3) if str(k) in walkset}
        if ex.get('sounds'):
            keep = set(KEEP_ANIMS) | used_anims | set(walkset.values())
            snd = {k: v for k, v in ex['sounds'].items()
                   if len(ex['sounds']) < 40 or k in keep or re.match(r'(res|nat|tec)_(idle|fight)|work|attack|build|ride_|balista', k)}
            manifest['models'][w]['sounds'] = snd
    # walk speeds from the GSF animation data (middle float at anim chunk +44)
    by_arch = {}
    for w, m in manifest['models'].items():
        if m['nanims']: by_arch.setdefault(m['arch'], []).append(w)
    archives = Install(DATA).archives()
    for arch, names in by_arch.items():
        p = archives.get(arch.lower())
        if not p or not os.path.exists(p): continue
        r = pg.R(open(p, 'rb').read())
        h = pg.parse_header2(r)
        infos = pg.parse_model_infos(r, h)
        h1 = pg.parse_header1(r)
        for mi, m in enumerate(infos):
            if m['name'].lower() not in names: continue
            an = {}
            for hm in h1:
                if hm['index'] == mi:
                    for a, ai in hm['anims']: an.setdefault(ai, a)
            sp = {}
            for k, lst in enumerate(m['anims']):
                for (c, nf) in lst:
                    if c and r.u32(c) == 0x40000005:
                        nm = an.get(k)
                        v = r.fs(c + 44, 3)
                        if nm and ('walk' in nm or 'run' in nm) and v[1] > 0.01:
                            sp[nm] = round(v[1], 3)
                        break
            manifest['models'][m['name'].lower()]['speeds'] = sp
    json.dump(manifest, open(OUT + '/assets/manifest.json', 'w'), indent=1)
    # walk clips made as start + loop + stop: record the loop (anim_loops.py)
    try:
        from . import anim_loops
    except ImportError:
        import anim_loops
    anim_loops.main(log)
    # drop models of earlier runs that are no longer used
    for f in os.listdir(OUT + '/assets/models'):
        if f.endswith('.glb') and f[:-4] not in manifest['models']: os.remove(OUT + '/assets/models/' + f)
    for f in os.listdir(OUT + '/assets/tex'):
        if f not in tex_seen: os.remove(OUT + '/assets/tex/' + f)
    tot = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(OUT + '/assets') for f in fs)
    log('models', len(manifest['models']), 'textures', len(os.listdir(OUT + '/assets/tex')), 'MB', round(tot / 1e6, 1))
    log('missing', missing)


def run(log=print, progress=None):
    main(log, progress)


if __name__ == '__main__':
    paths.configure(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)   # <Data> <out> [conv]
    run()
