#!/usr/bin/env python3
"""Generate /home/claude/pwexp_data/composites.json (+ object_gfx.json) from the ParaWorld scripts.

Hand-written rules below mirror the UrsRel script logic (file:line looked up by pattern so the
references stay exact); riders, flags, cranes, weapons and worker tools are expanded programmatically
from the tech tree / class files.  Every entry is checked against the GLB link_ nodes.
"""
import json, os, re, collections

DATA = '/mnt/user-data/uploads/Paraworld/Data/'
S = os.path.dirname(os.path.abspath(__file__))
OUT = '/home/claude/pwexp_data'
TT = json.load(open('/home/claude/pwr/techtree.json'))['StartTT']['Objects']
CLS = json.load(open(S + '/classes.json'))                      # class txt: object -> {classname, gfx}
GLB = {k.lower(): v[0] for k, v in json.load(open(S + '/glblinks.json')).items()}
GFXF = json.load(open(S + '/gfxfilters.json'))                   # filter gfx replacements
# models that are not in /tmp/pwout4 (archives seas_wwi, sl_pirate_outpost, hu_resource not converted there);
# links read directly from the GSF with tools/converter/paraworld_gsf.py
EXTRA = {'seas_hq_big_cannon': ['we'], 'seas_hq_big_cannon_rotator': ['Proj', 'we'], 'seas_hq_big_cannon_cannon': [],
         'seas_hq_defense_turret': ['Proj', 'we'], 'seas_hq_defense_turret_top': ['Proj'],
         'seas_hq_machinegun_nest': ['Proj', 'we'], 'seas_hq_machinegun_nest_top': [],
         'pirate_boss': ['psh1', 'psh2', 'psh3', 'Fm01', 'Fm03', 'Proj', 'we', 'Dri1'],
         'pirate_boss_tail': [], 'pirate_boss_sail': [], 'pirate_boss_row': [], 'pirate_boss_cannons': ['D_01', 'Bl_9'],
         'pirate_boss_cannons_reduced': ['D_06', 'Bl_9'], 'hu_corn': [], 'product_wood_sav': []}

_lines = {}
def src(rel, pat, after=0, nth=1):
    """'file:line' of the nth line (after line `after`) containing literal `pat`."""
    path = DATA + rel
    if path not in _lines:
        _lines[path] = open(path, encoding='latin-1').read().split('\n')
    n = 0
    for i, l in enumerate(_lines[path], 1):
        if i > after and pat in l:
            n += 1
            if n == nth:
                return f"{rel}:{i}"
    raise SystemExit(f'pattern not found: {rel} {pat!r} after {after}')

def line_of(rel, pat, after=0):
    return int(src(rel, pat, after).rsplit(':', 1)[1])

ANIMAL = 'Base/Scripts/Server/classes/animals/Animal.usl'
VEH = 'Base/Scripts/Server/classes/FightingObj/TransportObj/Vehicle.usl'
SHIP = 'Base/Scripts/Server/classes/FightingObj/TransportObj/Ship.usl'
TOBJ = 'Base/Scripts/Server/classes/FightingObj/TransportObj/TransportObj.usl'
BLDG = 'Base/Scripts/Server/classes/buildings/Building.usl'
BUB = 'Base/Scripts/Server/classes/misc/BuildUpBase.usl'
CHAR = 'Base/Scripts/Server/classes/character/character.usl'
HERO = 'Base/Scripts/Server/classes/character/Hero.usl'
TASK = 'Base/Scripts/Server/classes/task/'

# class line anchors
def cls_line(rel, name):
    return line_of(rel, f'class {name} inherit')

def gfx_of_class(objclass):
    """CreateObj(<class>) -> the class' gfx (lowercase, as the GLB files are named)."""
    c = CLS.get(objclass.lower())
    return (c['gfx'] if c and c.get('gfx') else objclass).lower()

def gfx_of_classgfx(name):
    """CSrvWrap.GetObjMgr()^.GetClassGFXName(<class>) (weapon parts)."""
    c = CLS.get(name.lower())
    return (c['gfx'] if c and c.get('gfx') else name).lower()

# ---- tech tree index ----
OBJ = {}          # name(lower) -> (tribe, cat, node, name)
for tribe, cats in TT.items():
    for cat in ('CHTR', 'ANML', 'VHCL', 'SHIP', 'BLDG'):
        for name, node in cats.get(cat, {}).items():
            OBJ[name.lower()] = (tribe, cat, node, name)

def main_gfx(obj):
    t = OBJ.get(obj)
    g = t[2].get('gfx') if t else None
    if not g or g in ('0', 'None'):
        c = CLS.get(obj)
        g = c.get('gfx') if c else None
    return g.lower() if g else None

entries = collections.defaultdict(list)

def links_of(gfx):
    g = GLB.get(gfx)
    return None if g is None else g['links']

def add(obj, gfx, link, parent, kind, when, source, anim=None, variants=None, guess=False, parent_gfx=None, **extra):
    """parent: '' (main model) or the gfx of the part the model hangs on."""
    e = {'gfx': gfx, 'link': link, 'parent': parent, 'kind': kind}
    if anim: e['anim'] = anim
    if variants:
        e['variants'] = variants
    e['when'] = when
    e['source'] = source
    if guess: e['guess'] = True
    e.update({k: v for k, v in extra.items() if v is not None})
    # verification against the GLB
    host = parent_gfx or (parent if parent else main_gfx(obj))
    hl = links_of(host) if host else None
    from_gsf = hl is None and host in EXTRA
    if from_gsf:
        hl = EXTRA[host]
    if link in ('', None):
        e['link_check'] = 'no_link (positioned, not linked)'
    elif hl is None:
        e['link_check'] = f'parent_glb_missing ({host})'
    elif link in hl:
        e['link_check'] = 'ok' + (' (parent read from the GSF; not in /tmp/pwout4)' if from_gsf else '')
    else:
        e['link_check'] = f'LINK_MISSING on {host} (has {",".join(hl) or "none"})'
    if gfx not in GLB:
        e['glb_missing'] = True
        if gfx in EXTRA:
            e['glb_note'] = 'model exists in the game GSF but is not in /tmp/pwout4'
    entries[obj].append(e)
    return e

# =====================================================================================
# 1. Riders / captains (CTransportObj.CreateCaptain/LinkCaptainObj + per-class GetCaptainLink)
# =====================================================================================
def captain_info(obj):
    tribe, cat, node, _ = OBJ[obj]
    cc = node.get('captainclass')
    if not cc or cc in ('0',):
        return None
    cnode = TT.get(tribe, {}).get('CHTR', {}).get(cc)
    if cnode is None:
        return None
    g = cnode['gfx']
    base = g[:-1]
    var = []
    for lv in range(5):
        cand = (base + (str(lv) if base == 'Stina_s' else str(lv + 1))).lower()
        var.append(cand if cand in GLB else g.lower())
    uniq = sorted(set(var), key=var.index)
    return cc, g.lower(), (var if len(uniq) > 1 else None)

LVL_RULE = "CCaptain.UpdateGfx: captainclass gfx with last char replaced by (level+1), fallback to the plain gfx; variants[i] = level i+1"

def rider(obj, link, parent, anim, source, attack=None, when='always (owned unit, tech tree captainclass)', flex=None, gfx=None, guess=False, note=None):
    ci = captain_info(obj)
    if ci is None and gfx is None:
        return
    cc, cg, var = ci if ci else (None, gfx, None)
    e = add(obj, gfx or cg, link, parent, 'rider', when, source, anim=anim,
            variants=var if gfx is None else None, guess=guess,
            captainclass=cc, attack_anim=attack, flex_link=flex,
            variant_rule=LVL_RULE if (var and gfx is None) else None, note=note)
    return e

GCL = 'GetCaptainLink'
def gcl(rel, clsname, nth=1):
    return src(rel, 'proc bool GetCaptainLink', after=cls_line(rel, clsname), nth=nth)

ride_default = src(ANIMAL, 'po_rxLink="Ride";')       # CAnimal.GetCaptainLink

# =====================================================================================
# 2. Build-ups, turrets, drawbars
# =====================================================================================
UP = 'after upgrade {}'
# ---------- Aje ankylosaurus ----------
L = cls_line(ANIMAL, 'CAnkylosaurus')
s = src(ANIMAL, 'CreateObj("aje_ankylosaurus_catapult"', L)
add('aje_ankylosaurus', gfx_of_class('aje_ankylosaurus_catapult'), 'con', '', 'buildup',
    UP.format('Aje/Upgrades/aje_ankylosaurus/aje_ankylosaurus_catapult (tech tree flag -> HandleAction)'), s,
    anim='attack_front (on attack)', note='CBuildUpWeapon, rotates towards target; saddle mask VIS_FLAG_ANML_MISC on')
rider('aje_ankylosaurus', 'Dri1', 'aje_ankylosaurus_catapult', 'standanim', gcl(ANIMAL, 'CAnkylosaurus'),
      attack='aje_attack_ankylo', when='with catapult build-up')
rider('aje_ankylosaurus', 'Ride', '', 'ride_idle_0', ride_default, attack='ride_attack_front', when='without build-up')

# ---------- Aje brachiosaurus ----------
L = cls_line(ANIMAL, 'CBrachiosaurus')
up = 'Aje/Upgrades/aje_brachiosaurus/'
add('aje_brachiosaurus', gfx_of_class('aje_brachiosaurus_mobile_camp'), 'con', '', 'buildup',
    UP.format(up + 'aje_brachiosaurus_mobile_camp') + ' (alternative build-ups, one at a time)',
    src(ANIMAL, 'CreateObj("aje_brachiosaurus_mobile_camp"', L))
add('aje_brachiosaurus', gfx_of_class('aje_brachiosaurus_catapult'), 'con', '', 'buildup',
    UP.format(up + 'aje_brachiosaurus_catapult'), src(ANIMAL, 'CreateObj("aje_brachiosaurus_catapult"', L),
    anim='attack_front (on attack)')
add('aje_brachiosaurus', gfx_of_class('aje_brachiosaurus_transporter'), 'con', '', 'buildup',
    UP.format(up + 'aje_brachiosaurus_transporter'), src(ANIMAL, 'CreateObj("aje_brachiosaurus_transporter"', L),
    note='open transporter: passengers on Dri2..Dri6 (Dri1 reserved for the captain)')
add('aje_brachiosaurus', 'aje_rider_b', 'Ride', '', 'rider', UP.format(up + 'aje_brachiosaurus_transporter') + ' (second, fixed rider)',
    src(ANIMAL, 'pxC^.SetGFX("aje_rider_b");', L), anim='ride_idle_0',
    note='extra universal_captain with hard-coded gfx aje_rider_b (no level variant)')
rider('aje_brachiosaurus', 'Dri1', 'aje_brachiosaurus_transporter', 'standanim', gcl(ANIMAL, 'CBrachiosaurus'),
      attack='bow_1', when='with transporter build-up')
add('aje_brachiosaurus', gfx_of_class('aje_brachiosaurus_siege'), 'con', '', 'buildup',
    UP.format(up + 'aje_brachiosaurus_siege'), src(ANIMAL, 'CreateObj("aje_brachiosaurus_siege"', L),
    note='siege ladder; climbers use its psh1/psh2 (DockWall.usl CDockInfo.GetEntryPos)')
rider('aje_brachiosaurus', 'Ride', '', 'ride_idle_0', gcl(ANIMAL, 'CBrachiosaurus'),
      when='without build-up, with siege, mobile camp or catapult build-up')

# ---------- velociraptor handler ----------
L = cls_line(ANIMAL, 'CVelociraptorHandler')
rider('aje_velociraptor_handler', 'Db_1', '', 'walk_1 / all_walk_<speed>_loop', src(ANIMAL, 'AddObjFlex(pxCaptain^.GetHandle(), "Db_1"', L),
      flex='FlexLinkAction delay 3.0 (handler walks behind on a leash)', when='always')

# ---------- Aje resource collector (Iguanodon) ----------
L = cls_line(ANIMAL, 'CIguanodon')
s_bar = src(ANIMAL, 'GetBuildUp()^.AddObj(xBar, "Db_1");', L)
s_wag = src(ANIMAL, 'GetBuildUp()^.AddObjFlex(xWagon, "Db_2", 3.0, xBar);', L)
add('aje_resource_collector', gfx_of_class('aje_resource_collector_drawbar'), 'Db_1', '', 'drawbar', 'always', s_bar)
add('aje_resource_collector', gfx_of_class('aje_resource_collector_a'), 'Db_2', 'aje_resource_collector_drawbar', 'wagon',
    'always; model by epoch (age_1..age_5 invented)', s_wag + ', ' + src(ANIMAL, 'var string sNewName = "aje_resource_collector_";', L),
    variants=['aje_resource_collector_' + c for c in 'abcde'], variant_rule='epoch 1..5 -> _a.._e (CIguanodon.UpdateGfxFlags)',
    flex_link='FlexLinkAction delay 3.0 (trailer, anim walk_1 while moving)')
rider('aje_resource_collector', 'Ride', '', 'ride_idle_0', ride_default, attack='ride_attack_front',
      note='CIguanodon does not override GetCaptainLink -> CAnimal default')

# ---------- trade dino / ninigi cart (CTradeDino) ----------
L = cls_line(ANIMAL, 'CTradeDino')
add('ninigi_cart', gfx_of_class('ninigi_cart_drawbar'), 'Db_1', '', 'drawbar', 'always', src(ANIMAL, 'GetBuildUp()^.AddObj(xBar, "Db_1");', L))
add('ninigi_cart', gfx_of_class('ninigi_cart_wagon'), 'Db_2', 'ninigi_cart_drawbar', 'wagon', 'always',
    src(ANIMAL, 'GetBuildUp()^.AddObjFlex(xWagon, "Db_2", 3.0, xBar);', L), flex_link='FlexLinkAction delay 3.0',
    note='object class ninigi_cart_wagon, gfx ninigi_cart')
add('aje_trade_dino', gfx_of_class('aje_trade_dino_buildup'), 'con', '', 'buildup', 'always',
    src(ANIMAL, 'CreateObj("aje_trade_dino_buildup"', L), note='object class aje_trade_dino_buildup, gfx aje_trade_dino; saddle mask on. No captain (CTradeDino.GetCaptainLink returns false)')

# ---------- mammoth ----------
L = cls_line(ANIMAL, 'CMammoth')
add('hu_mammoth_lumber_upgrade', gfx_of_class('hu_mammoth_lumber_upgrade_buildup'), 'we', '', 'buildup', 'always',
    src(ANIMAL, 'CreateObj("hu_mammoth_lumber_upgrade_buildup"', L))
s_st = src(ANIMAL, 'export proc void LinkToStock', L)
add('hu_mammoth_lumber_upgrade', 'hu_mammoth_lumber_upgrade_wood', 'psh1', 'hu_mammoth_lumber_upgrade_buildup', 'container',
    'while carrying wood (HarvesterTask)', s_st + ', ' + src(TASK + 'HarvesterTask.usl', 'LinkToStock("hu_mammoth_lumber_upgrade_wood")'))
add('hu_mammoth_lumber_upgrade', 'hu_mammoth_lumber_upgrade_stones', 'psh1', 'hu_mammoth_lumber_upgrade_buildup', 'container',
    'while carrying stone (MineTask)', s_st + ', ' + src(TASK + 'MineTask.usl', 'LinkToStock("hu_mammoth_lumber_upgrade_stones")'))
rider('hu_mammoth_lumber_upgrade', 'Ride', '', 'ride_idle_0', ride_default, attack='ride_attack_front')
add('hu_mammoth_log_cannon', gfx_of_class('hu_mammoth_log_cannon_buildup_top'), 'con', '', 'buildup', 'always',
    src(ANIMAL, 'CreateObj("hu_mammoth_log_cannon_buildup_top"', L), anim='attack_front (on attack)',
    note='CBuildUpWeapon, rotates; mammoth plays "rest" in attack mode')
add('hu_mammoth_log_cannon', gfx_of_class('hu_mammoth_log_cannon_buildup_bottom'), 'con', '', 'buildup', 'always',
    src(ANIMAL, 'CreateObj("hu_mammoth_log_cannon_buildup_bottom"', L), anim='build_down (attack mode) / build_up (walk mode)')
rider('hu_mammoth_log_cannon', 'Dri1', 'hu_mammoth_log_cannon_buildup_top', 'balista_stand', gcl(ANIMAL, 'CMammoth'),
      attack='rhino_ballista_shoot')
rider('hu_mammoth', 'Ride', '', 'ride_idle_0', ride_default, attack='ride_attack_front')

# ---------- megaloceros: chariot / scout ----------
L = cls_line(ANIMAL, 'CMegaloceros')
add('hu_chariot', gfx_of_class('hu_chariot_drawbar'), 'Db_1', '', 'drawbar', 'always', src(ANIMAL, 'GetBuildUp()^.AddObj(xBar, "Db_1");', L))
add('hu_chariot', gfx_of_class('hu_chariot_trailer'), 'Db_2', 'hu_chariot_drawbar', 'wagon', 'always',
    src(ANIMAL, 'GetBuildUp()^.AddObjFlex(xWagon, "Db_2", 2.0, xBar);', L), flex_link='FlexLinkAction delay 2.0',
    note='open transporter: passengers on trailer Dri2 (Dri1 = captain)')
rider('hu_chariot', 'Dri1', 'hu_chariot_trailer', 'standanim', src(ANIMAL, 'AddObjCaptain(m_xCaptain, "Dri1", -1.0, xWagon);', L),
      attack='bow_1', note='captain is captainclass hu_archer (archer on the trailer)')
rider('hu_scout', 'Ride', '', 'ride_idle_0', ride_default, attack='ride_attack_front',
      note='helmet/drums are a mesh render-mask flag (VIS_FLAG_ANML_HELMET after drums invention), not a linked model')

# ---------- titan triceratops (hu_triceratops) ----------
L = cls_line(ANIMAL, 'CTitanTriceratops')
add('hu_triceratops', gfx_of_class('hu_titan_transporter_buildup'), 'con', '', 'buildup', 'always',
    src(ANIMAL, 'CreateObj("hu_titan_transporter_buildup"', L), note='open transporter: passengers on Dri1..Dri4')
for i, ln in enumerate(('con2', 'con3')):
    add('hu_triceratops', gfx_of_class('hu_rhino_ballista_buildup_top'), ln, '', 'turret', 'always',
        src(ANIMAL, f'pxWeaponBuildUp^.AddObj(pxO^.GetHandle(), "{ln}");', L), anim='attack_front (on attack)',
        note='additional CBuildUpWeapon (weapon class hu_titan_ballista), rotates independently')
    rider('hu_triceratops', 'Dri1', 'hu_rhino_ballista_buildup_top', 'hu_balista_steamtank_sitpos',
          src(ANIMAL, 'AddObjCaptain(pxC^.GetHandle(), "Dri1", -1.0, pxO^.GetHandle());', L, nth=i + 1),
          attack='hu_balista_steamtank_attack', when=f'always (gunner of the {ln} ballista)',
          note='extra universal_captain, gfx from the titan\'s captainclass; main captain hidden (GetCaptainLink returns false)')

# ---------- triceratops (seas transporter / resource collector, aje archer) ----------
L = cls_line(ANIMAL, 'CTriceratops')
add('seas_triceratops_transporter', gfx_of_class('seas_triceratops_transporter_buildup'), 'con', '', 'buildup', 'always',
    src(ANIMAL, 'CreateObj("seas_triceratops_transporter_buildup"', L), note='passengers Dri2..Dri4')
rider('seas_triceratops_transporter', 'Dri1', gfx_of_class('seas_triceratops_transporter_buildup'), 'standanim', gcl(ANIMAL, 'CTriceratops'), attack='bow_1')
add('aje_triceratops_archer', gfx_of_class('aje_triceratops_transporter'), 'con', '', 'buildup', 'always',
    src(ANIMAL, 'CreateObj("aje_triceratops_transporter"', L), note='passengers Dri2..Dri4')
rider('aje_triceratops_archer', 'Dri1', 'aje_triceratops_transporter', 'standanim', gcl(ANIMAL, 'CTriceratops'), attack='bow_1')
add('seas_triceratops_resource_collector', gfx_of_class('seas_triceratops_resource_collector_buildup'), 'con', '', 'buildup', 'always',
    src(ANIMAL, 'CreateObj("seas_triceratops_resource_collector_buildup"', L))
rider('seas_triceratops_resource_collector', 'Ride', '', 'ride_idle_0', gcl(ANIMAL, 'CTriceratops'), attack='ride_attack_front',
      note='FAKE build-up is not TRANSPORTER_OPEN -> CAnimal default "Ride" on the triceratops')
rider('seas_triceratops', 'Ride', '', 'ride_idle_0', ride_default, attack='ride_attack_front')

# ---------- parasaurolophus ----------
L = cls_line(ANIMAL, 'CParasaurolophus')
add('ninigi_parasaurolophus_drums', gfx_of_class('ninigi_drumwagon_drawbar'), 'Db_1', '', 'drawbar', 'always',
    src(ANIMAL, 'GetBuildUp()^.AddObj(xBar,"Db_1");', L))
add('ninigi_parasaurolophus_drums', gfx_of_class('ninigi_drumwagon'), 'Db_2', 'ninigi_drumwagon_drawbar', 'wagon', 'always',
    src(ANIMAL, 'GetBuildUp()^.AddObjFlex(xWagon,"Db_2", 3.0, xBar);', L), flex_link='FlexLinkAction delay 3.0')
rider('ninigi_parasaurolophus_drums', 'Dri1', 'ninigi_drumwagon', 'standanim', gcl(ANIMAL, 'CParasaurolophus'), attack='drumwagon_attack')
add('ninigi_parasaurolophus_gatling', gfx_of_class('ninigi_parasaurolophus_gatling_obj'), 'con', '', 'turret', 'always',
    src(ANIMAL, 'CreateObj("ninigi_parasaurolophus_gatling_obj"', L), anim='attack_front (on attack)')
rider('ninigi_parasaurolophus_gatling', 'Dri1', 'ninigi_parasaurolophus_gatling', 'gatling_rider_standanim', gcl(ANIMAL, 'CParasaurolophus'),
      attack='gatling_rider_attack')

# ---------- stegosaurus ----------
L = cls_line(ANIMAL, 'CStegosaurus')
add('aje_stegosaurus', gfx_of_class('aje_stegosaurus_transporter'), 'con', '', 'buildup',
    UP.format('Aje/Upgrades/aje_stegosaurus/aje_stegosaurus_transporter'), src(ANIMAL, 'CreateObj("aje_stegosaurus_transporter"', L),
    note='open transporter: passengers Dri1..Dri4 (Dri5 = captain)')
rider('aje_stegosaurus', 'Dri5', 'aje_stegosaurus_transporter', 'standanim', gcl(ANIMAL, 'CStegosaurus'), attack='bow_1',
      when='with transporter build-up')
rider('aje_stegosaurus', 'Ride', '', 'ride_idle_0', ride_default, attack='ride_attack_front', when='without build-up')

# ---------- woolly rhino ----------
L = cls_line(ANIMAL, 'CWoolly_Rhino')
add('hu_rhino_transporter', gfx_of_class('hu_rhino_transporter_buildup'), 'con', '', 'buildup', 'always',
    src(ANIMAL, 'CreateObj("hu_rhino_transporter_buildup"', L), note='passengers Dri2..Dri3')
rider('hu_rhino_transporter', 'Dri1', 'hu_rhino_transporter_buildup', 'standanim', gcl(ANIMAL, 'CWoolly_Rhino'), attack='bow_1')
add('hu_rhino_ballista', gfx_of_class('hu_rhino_ballista_buildup_top'), 'we', '', 'turret', 'always',
    src(ANIMAL, 'CreateObj("hu_rhino_ballista_buildup_top"', L), anim='attack_front (on attack)',
    mask='VIS_FLAG_VHCL_RAM_HIGH on (top part)', note='rotates towards target')
add('hu_rhino_ballista', gfx_of_class('hu_rhino_ballista_buildup_bottom'), 'we', '', 'buildup', 'always',
    src(ANIMAL, 'CreateObj("hu_rhino_ballista_buildup_bottom"', L), mask='VIS_FLAG_VHCL_RAM_LOW on')
rider('hu_rhino_ballista', 'Dri1', 'hu_rhino_ballista_buildup_top', 'hu_balista_steamtank_sitpos', gcl(ANIMAL, 'CWoolly_Rhino'),
      attack='hu_balista_steamtank_attack')
rider('hu_rhino', 'Ride', '', 'ride_idle_0', ride_default, attack='ride_attack_front')

# ---------- saltasaurus ----------
L = cls_line(ANIMAL, 'CSaltasaurus')
add('ninigi_saltasaurus_archer', gfx_of_class('ninigi_saltasaurus_transporter'), 'con', '', 'buildup', 'always',
    src(ANIMAL, 'CreateObj("ninigi_saltasaurus_transporter"', L), note='passengers Dri2..Dri4')
rider('ninigi_saltasaurus_archer', 'Dri1', 'ninigi_saltasaurus_transporter', 'standanim', gcl(ANIMAL, 'CSaltasaurus'), attack='bow_1')

# ---------- eusmilus ----------
L = cls_line(ANIMAL, 'CEusmilus')
for o in ('hu_eusmilus', 'ninigi_eusmilus'):
    rider(o, 'Ride', '', 'ride_idle_0', gcl(ANIMAL, 'CEusmilus'),
          attack='tec_ride_bow_shoot' if o == 'ninigi_eusmilus' else 'ride_attack_front')
# hu_kennel_eusmilus: CKennelEusmilus.GetCaptainLink returns false -> no rider
rider('aje_eusmilus', 'Ride', '', 'ride_idle_0', ride_default, attack='ride_attack_front',
      note='class CAnimal (not CEusmilus) -> default')

# ---------- Aje T-rex (atroxosaurus) ----------
L = cls_line(ANIMAL, 'CAjeTrex')
rider('aje_atroxosaurus', 'Ride', '', 'standanim', gcl(ANIMAL, 'CAjeTrex'))
for ln in ('Rid2', 'Rid3'):
    rider('aje_atroxosaurus', ln, '', None, src(ANIMAL, f'GetBuildUp()^.AddObj(pxC^.GetHandle(), "{ln}");', L),
          when='always (extra rider)', note='extra universal_captain via FAKE build-up; no anim is set by the script (plays its default idle)')

# ---------- seismosaurus ----------
L = cls_line(ANIMAL, 'CSeismosaurus')
add('ninigi_seismosaurus', gfx_of_class('ninigi_triceratops_launcher'), 'con', '', 'turret', 'always',
    src(ANIMAL, 'CreateObj("ninigi_triceratops_launcher"', L), anim='attack_front (on attack)', note='main CBuildUpWeapon, rotates')
rider('ninigi_seismosaurus', 'Dri1', 'ninigi_triceratops_launcher', 'gatling_rider_standanim', gcl(ANIMAL, 'CSeismosaurus'),
      attack='gatling_rider_attack', note='main captain rides the launcher (primary build-up object)')
for i, ln in enumerate(('con2', 'con3')):
    add('ninigi_seismosaurus', gfx_of_class('ninigi_parasaurolophus_gatling_obj'), ln, '', 'turret', 'always',
        src(ANIMAL, f'pxWeaponBuildUp^.AddObj(pxO^.GetHandle(), "{ln}");', L), anim='attack_front (on attack)',
        note='additional CBuildUpWeapon (weapon class ninigi_titan_gatling)')
    rider('ninigi_seismosaurus', 'Dri1', 'ninigi_parasaurolophus_gatling', 'gatling_rider_standanim',
          src(ANIMAL, 'AddObjCaptain(pxC^.GetHandle(), "Dri1", -1.0, pxO^.GetHandle());', L, nth=i + 1),
          attack='gatling_rider_attack', when=f'always (gunner of the {ln} gatling)')

# ---------- plain ridden animals (CAnimal default "Ride") ----------
for o in ('hu_wild_boar', 'hu_kentrosaurus', 'aje_dilophosaurus', 'aje_allosaurus', 'ninigi_scout', 'ninigi_baryonyx'):
    rider(o, 'Ride', '', 'ride_idle_0', ride_default, attack='ride_attack_front')

# =====================================================================================
# vehicles
# =====================================================================================
L = cls_line(VEH, 'CSteamTank')
add('hu_steam_tank', gfx_of_class('hu_rhino_ballista_buildup_top'), 'we', '', 'turret', 'always',
    src(VEH, 'CreateObj("hu_rhino_ballista_buildup_top"', L), anim='attack_front (on attack)', note='TYPE_WEAPON_TRANSPORTER, rotates')
add('hu_steam_tank', gfx_of_class('hu_rhino_ballista_buildup_bottom'), 'we', '', 'buildup', 'always',
    src(VEH, 'CreateObj("hu_rhino_ballista_buildup_bottom"', L))
rider('hu_steam_tank', 'Dri1', 'hu_rhino_ballista_buildup_top', 'hu_balista_steamtank_sitpos', gcl(VEH, 'CSteamTank'),
      attack='hu_balista_steamtank_attack')
rider('hu_steam_ram', 'Dri1', '', 'hu_balista_steamtank_sitpos', gcl(VEH, 'CSteamRam'))
rider('ninigi_flamethrower_trike', 'Dri1', '', 'flamebuggy_standanim', gcl(VEH, 'CFlameThrower'))
rider('seas_mechanical_walker', 'Ride', '', 'balista_stand', gcl(VEH, 'CMechWalker'))
L = cls_line(VEH, 'CFireCannon')
add('ninigi_firecannon', gfx_of_class('ninigi_firecannon_top'), 'we', '', 'turret', 'always',
    src(VEH, 'CreateObj("ninigi_firecannon_top"', L), anim='attack_front (on attack)',
    note='no captain shown (CFireCannon has no GetCaptainLink -> CTransportObj default false)')
rider('ninigi_smokebomb_thrower', 'Dri1', '', 'balista_stand', gcl(VEH, 'CSmokeThrower'))
rider('ninigi_harvester', 'Dri1', '', 'balista_stand', gcl(VEH, 'CHarvester'))
L = cls_line(VEH, 'CHarvester')
add('ninigi_harvester', 'hu_mammoth_lumber_upgrade_wood', 'psh1', '', 'container', 'while carrying wood',
    src(VEH, 'export proc void LinkToStock', L) + ', ' + src(TASK + 'HarvesterTask.usl', 'LinkToStock("hu_mammoth_lumber_upgrade_wood")'))
rider('seas_helicopter', 'Dri1', '', 'balista_stand', gcl(VEH, 'CSeasHelicopter'),
      note='bIsBuildUpLink=true but there is no build-up -> links on the helicopter itself')
L = cls_line(VEH, 'CWehrspinne')
add('seas_wehrspinne', gfx_of_class('seas_wehrspinne_top'), 'we', '', 'turret', 'always',
    src(VEH, 'CreateObj("seas_wehrspinne_top"', L), anim='attack_front (vehicle body plays attack_front when switching to attack mode)')
rider('seas_wehrspinne', 'Dri1', 'seas_wehrspinne_top', 'balista_stand', gcl(VEH, 'CWehrspinne'))
L = cls_line(VEH, 'CTradeCart')
rider('hu_cart', 'push', '', 'hu_cart_push_walk_idle (hu_cart_push_walk_2 while moving)', src(VEH, 'var CFourCC xLink="push";', L),
      flex='FlexLinkAction delay 0, offset (0,-2,0)', note='the captain (hu_worker) pushes the cart')

# =====================================================================================
# ships
# =====================================================================================
L = cls_line(SHIP, 'CSteamShip')
add('hu_steam_boat', gfx_of_class('hu_steam_boat_cannon'), 'we', '', 'turret', 'always',
    src(SHIP, 'CreateObj("hu_steam_boat_cannon"', L), anim='attack_front (on attack)')
L = cls_line(SHIP, 'CTransportTurtle')
add('aje_transport_turtle', gfx_of_class('aje_transport_turtle_shell'), 'con', '', 'buildup', 'always',
    src(SHIP, 'CreateObj("aje_transport_turtle_shell"', L),
    note='carrier gfx swaps Macrolemys_Water (in water) / Macrolemys_Land (on land), shell stays at con; shell has construct/destruct levels by HP')
L = cls_line(SHIP, 'CMuraenoSubmarine')
add('ninigi_muraeno_submarine', gfx_of_class('Aje_Muraeno_Submarine_Bell'), 'con', '', 'buildup', 'always',
    src(SHIP, 'CreateObj("Aje_Muraeno_Submarine_Bell"', L), note='object class Aje_Muraeno_Submarine_Bell, gfx Aje_Muraeno_Submarine; camouflage follows the carrier')
rider('aje_cronosaurus', 'Ride', '', 'ride_idle_0', gcl(SHIP, 'CAjeCronosaurus'), attack='ride_attack_front')
L = cls_line(SHIP, 'CWaterTurret')
add('ninigi_water_turret', gfx_of_class('ninigi_water_turret_cannon'), 'we', '', 'turret', 'always',
    src(SHIP, 'CreateObj("ninigi_water_turret_cannon"', L), anim='attack_front (on attack)')
L = cls_line(SHIP, 'CPirateBoss')
for cls_, ln in (('pirate_boss_tail', 'psh1'), ('pirate_boss_sail', 'psh2'), ('pirate_boss_row', 'psh3')):
    add('pirate_boss', gfx_of_class(cls_), ln, '', 'other', 'always (destructible part; replaced by <part>_dest playing "destroy")',
        src(SHIP, f'CreateObj("{cls_}"', L))
add('pirate_boss', gfx_of_class('pirate_boss_cannons'), 'psh2', '', 'turret', 'always; pirate_boss_cannons_reduced after the tail is destroyed',
    src(SHIP, 'CreateObj("pirate_boss_cannons"', L), variants=['pirate_boss_cannons', 'pirate_boss_cannons_reduced'])
# rocket boat rockets (projectile gfx re-linked at psh1..3)
L = cls_line(SHIP, 'CRocketBoat')
add('ninigi_rocket_boat', '<projectile of current weapon>', 'psh1', '', 'other',
    'loaded rockets, re-linked after each attack (OnActionEnd); also psh2, psh3', src(SHIP, 'SetLinkGFX(m_axLink[i], GetProjectile());', L),
    guess=True, note='gfx = current weapon Projectiles/0 (tech tree); links psh1, psh2, psh3')
# fishing boats: net object positioned at the boat's Dri1 while fishing (not linked)
L = cls_line(SHIP, 'CFishingBoat')
for o in ('hu_fishing_boat', 'ninigi_fishing_boat'):
    e = add(o, gfx_of_class('Hu_Fishnet'), 'Dri1', '', 'other', 'while fishing (hidden otherwise)',
        src(SHIP, 'CreateObj( "Hu_Fishnet"', L) + ', ' + src(SHIP, 'var CFourCC xLink = "Dri1";', L),
        anim='fishnet_anim', note='separate CFishnet object placed at the Dri1 world position/rotation (SetPos/SetRot), not LinkAction')
# seas carrier (building and ship)
L = cls_line(BLDG, 'CSeasCarrier')
for o in ('seas_carrier', 'seas_carrier_fake'):
    add(o, gfx_of_class('seas_carrier_turret'), 'we', '', 'turret', 'when the building is ready (SetReady)',
        src(BLDG, 'CreateObj("seas_carrier_turret"', L), anim='attack_front (on attack)')

# ship spray FX (CShip.SetSpraySize)
spray = {'CFishingBoat': 1, 'CBigSizeShip': 3, 'CMediumSizeShip': 2, 'CTransportShip': 3, 'CSteamShip': 3, 'CCatamaran': 3,
         'CRocketBoat': 3, 'CMineLayer': 3, 'CCorsair': 3, 'CMuraenoSubmarine': 2, 'CTransportTurtle': 2, 'CTorpedoTurtle': 1,
         'CPirateBoss': 3}
s_spray = src(SHIP, 'export proc void SetSpraySize')
for o, (tribe, cat, node, nm) in OBJ.items():
    if cat != 'SHIP': continue
    c = CLS.get(o, {}).get('classname')
    if c not in spray: continue
    hl = links_of(main_gfx(o)) or []
    if 'SpBa' not in hl and 'SpFr' not in hl: continue
    n = spray[c]
    for ln, nm2 in (('SpBa', 'spray_back_'), ('SpFr', 'spray_front_')):
        if ln in hl:
            add(o, f'{nm2}{n}', ln, '', 'other', 'always (water spray FX; turtle: only in water)', s_spray, note='CFX particle object, not a mesh')

# =====================================================================================
# buildings: turrets
# =====================================================================================
L = cls_line(BLDG, 'CSeasBigCannon')
add('seas_hq_big_cannon', gfx_of_class('seas_hq_big_cannon_rotator'), 'we', '', 'turret', 'always',
    src(BLDG, 'SetTurret("seas_hq_big_cannon_rotator");', L), anim='attack_front (on attack)')
add('seas_hq_big_cannon', gfx_of_class('seas_hq_big_cannon_cannon'), 'we', 'seas_hq_big_cannon_rotator', 'turret',
    'after activation (AbortTask)', src(BLDG, 'CreateObj("seas_hq_big_cannon_cannon"', L), anim='attack_front (on attack)')
L = cls_line(BLDG, 'CRocketRamp')
add('ninigi_rocket_ramp', gfx_of_class('ninigi_rb_top'), 'RE_1', '', 'turret', 'always',
    src(BLDG, 'SetTurret("ninigi_rb_top");', L), anim='attack_front (on attack)',
    note='placement ghost links "rb_top" at "Proj" instead (PlaceController.usl hack); the ramp GLB has no Proj')
add('ninigi_rocket_ramp', gfx_of_class('ninigi_rb_bird'), 'we', 'ninigi_rb_top', 'other', 'always',
    src(BLDG, 'CreateObj("ninigi_rb_bird"', L), anim='ninigi_rb_bird_idle_001..004 (random); ninigi_rb_bird_shoot on attack')
L = cls_line(BLDG, 'CNinigiSmallTower')
add('ninigi_small_tower', gfx_of_class('ninigi_small_tower_upgrade'), 'we', '', 'turret',
    'after invention Ninigi/InventObjects/tower_sordes_upgrade', src(BLDG, 'SetTurret("ninigi_small_tower_upgrade");', L))
L = cls_line(BLDG, 'CTower')
add('hu_large_tower', gfx_of_class('Hu_Large_Tower_Upgrade_Balista'), 'we', 'hu_large_tower_upgrade', 'turret',
    'after invention Hu/InventObjects/hu_ballista_upgrade (tower gfx becomes hu_large_tower_upgrade)',
    src(BLDG, 'SetTurret("Hu_Large_Tower_Upgrade_Balista");', L), anim='attack_front (on attack)',
    note='link "we" only exists on hu_large_tower_upgrade (the base hu_large_tower GLB has no "we")')
for cname, obj, turret, anim in (('CSeasTurretTower', 'seas_turret_tower', 'seas_turret', 'attack_front'),
                                 ('CSeasMGTower', 'seas_hq_machinegun_nest', 'seas_hq_machinegun_nest_top', 'attack_front'),
                                 ('CSeasDefenseTower', 'seas_hq_defense_turret', 'seas_hq_defense_turret_top', 'attack_front'),
                                 ('CTeslaTower', 'aje_tesla_tower', 'aje_tesla_tower_canon', 'gun_shoot')):
    L = cls_line(BLDG, cname)
    add(obj, gfx_of_class(turret), 'we', '', 'turret', 'always', src(BLDG, f'SetTurret("{turret}");', L), anim=f'{anim} (on attack)',
        note='rotates towards target (SecRotAction)')
# harbours
L = cls_line(BLDG, 'CHarbour')
add('hu_harbour', gfx_of_class('hu_harbour_crane'), 'Cr_3', '', 'other', 'when ready (Hu harbours only)',
    src(BLDG, 'var CFourCC xLink="Cr_3";', L))
L = cls_line(BLDG, 'CSwimmingHarbour')
for i, ln in enumerate(('Cr_1', 'Cr_2', 'Cr_3', 'Cr_4')):
    add('aje_floating_harbour', gfx_of_class('aje_floating_harbour_macrolemys'), ln, '', 'other', 'when ready',
        src(BLDG, f'xLink="{ln}";', L), anim='swim_1', flex_link='FlexLinkAction delay 0',
        note='object aje_floating_harbour_macrolemys (gfx Macrolemys_Water) - the turtles carrying the harbour')
# scorpion boss panels (positioned, not linked)
L = cls_line(BLDG, 'CScorpionBoss')
for p, off in (('a', '(-20,20,0)'), ('b', '(-20,0,0)'), ('c', '(-20,-20,0)')):
    add('scorpion', gfx_of_class(f'scorpion_panel_{p}'), '', '', 'other', 'always (separate object)',
        src(BLDG, f'CreateObj("scorpion_panel_{p}"', L), offset=off)

# construction cranes for every building with Cr_* links
s_crane = src(BLDG, 'xFCCB="Cr_1";if(HasLink(xFCCB))')
s_crane2 = src(TASK + 'BuildUpBuilding.usl', '_Crane_0"+((i/2)+1)')
for o, (tribe, cat, node, nm) in OBJ.items():
    if cat != 'BLDG' or tribe not in ('Hu', 'Aje', 'Ninigi', 'SEAS'): continue
    g = main_gfx(o)
    hl = links_of(g) or []
    for ln in ('Cr_1', 'Cr_2', 'Cr_3', 'Cr_4'):
        if ln in hl:
            cg = f'{tribe.lower()}_crane_0{1 if ln in ("Cr_1", "Cr_2") else 2}'
            add(o, cg, ln, '', 'other', 'only while under construction', s_crane + ', ' + s_crane2,
                anim='build (workers present) / none (idle)')

# =====================================================================================
# level flags on transport objects (CTransportObj.CheckLevelFlag)
# =====================================================================================
s_flag = src(TOBJ, 'var string sFlagGFX=sTribe+"_animal_flag_0"')
# primary build-up object per unit (first object added to the main build-up)
PRIMARY = {
    'aje_resource_collector': 'aje_resource_collector_a', 'ninigi_cart': 'ninigi_cart', 'aje_trade_dino': 'aje_trade_dino',
    'hu_mammoth_lumber_upgrade': 'hu_mammoth_lumber_upgrade_buildup', 'hu_mammoth_log_cannon': 'hu_mammoth_log_cannon_buildup_top',
    'hu_chariot': 'hu_chariot_trailer', 'hu_triceratops': 'hu_titan_transporter_buildup',
    'seas_triceratops_transporter': 'seas_triceratops_transporter', 'aje_triceratops_archer': 'aje_triceratops_transporter',
    'seas_triceratops_resource_collector': 'seas_triceratops_resource_collector', 'ninigi_parasaurolophus_drums': 'ninigi_drumwagon',
    'ninigi_parasaurolophus_gatling': 'ninigi_parasaurolophus_gatling', 'hu_rhino_transporter': 'hu_rhino_transporter_buildup',
    'hu_rhino_ballista': 'hu_rhino_ballista_buildup_top', 'ninigi_saltasaurus_archer': 'ninigi_saltasaurus_transporter',
    'ninigi_seismosaurus': 'ninigi_triceratops_launcher', 'hu_steam_tank': 'hu_rhino_ballista_buildup_top',
    'ninigi_firecannon': 'ninigi_firecannon_top', 'seas_wehrspinne': 'seas_wehrspinne_top', 'hu_steam_boat': 'hu_steam_boat_cannon',
    'aje_transport_turtle': 'aje_transport_turtle', 'ninigi_muraeno_submarine': 'aje_muraeno_submarine',
    'ninigi_water_turret': 'ninigi_water_turret_cannon',
}
OPTIONAL_BU = {'aje_ankylosaurus': ['aje_ankylosaurus_catapult'],
               'aje_brachiosaurus': ['aje_brachiosaurus_mobile_camp', 'aje_brachiosaurus_catapult', 'aje_brachiosaurus_transporter', 'aje_brachiosaurus_siege'],
               'aje_stegosaurus': ['aje_stegosaurus_transporter']}
for o, (tribe, cat, node, nm) in OBJ.items():
    if cat not in ('ANML', 'VHCL', 'SHIP') or tribe not in ('Hu', 'Aje', 'Ninigi', 'SEAS'): continue
    flags = [f'{tribe.lower()}_animal_flag_0{i}' for i in range(1, 6)]
    if not all(f in GLB for f in flags):
        continue   # SEAS: no seas_animal_flag_0x graphic -> FindGraphicSetEntry fails -> no flag
    g = main_gfx(o)
    own = 'flag' in (links_of(g) or [])
    prim = PRIMARY.get(o)
    if prim and 'flag' in (links_of(prim) or []):
        add(o, flags[0], 'flag', prim, 'other', 'always (owned); model by unit level', s_flag, variants=flags,
            variant_rule='level 1..5 -> <tribe>_animal_flag_01..05 (player tribe)', note='flag moves to the primary build-up object when it has a "flag" link')
    elif own:
        add(o, flags[0], 'flag', '', 'other', 'always (owned); model by unit level' + (' (without build-up)' if o in OPTIONAL_BU else ''), s_flag,
            variants=flags, variant_rule='level 1..5 -> <tribe>_animal_flag_01..05 (player tribe)')
    for bu in OPTIONAL_BU.get(o, []):
        bg = gfx_of_class(bu)
        if 'flag' in (links_of(bg) or []):
            add(o, flags[0], 'flag', bg, 'other', f'with build-up {bu}; model by unit level', s_flag, variants=flags,
                variant_rule='level 1..5 -> <tribe>_animal_flag_01..05')

# =====================================================================================
# rider (captain) weapons (CCaptain.UpdateGfx)
# =====================================================================================
s_capw = src(TOBJ, 'var ^CTechTree.CNode pxParts = pxWeapon^.GetSub("Parts");', after=cls_line(TOBJ, 'CCaptain'))
for o in list(entries):
    if o not in OBJ: continue
    tribe = OBJ[o][0]
    riders = [e for e in entries[o] if e['kind'] == 'rider' and e.get('captainclass')]
    if not riders: continue
    cc = riders[0]['captainclass']
    weps = [(wn, w) for wn, w in TT.get(tribe, {}).get('Weapons', {}).items()
            if cc in (w.get('Users') or {}).values() and str(w.get('secondary', '0')) == '0' and isinstance(w.get('Parts'), dict)]
    # last matching weapon (tech tree order) with level <= unit level+1 wins
    bylevel = {}
    for lv in range(1, 6):
        cand = [(wn, w) for wn, w in weps if 0 <= int(w.get('level', '0')) <= lv]
        bylevel[lv] = cand[-1] if cand else None
    groups = collections.OrderedDict()
    for lv, ww in bylevel.items():
        if ww: groups.setdefault(ww[0], []).append(lv)
    for r in riders:
        for wn, lvs in groups.items():
            w = dict(weps)[wn]
            for p in w['Parts'].values():
                if not isinstance(p, dict): continue
                g0 = (p.get('Gfx') or {}).get('0')
                if not g0: continue
                link = p.get('Links') or ''
                add(o, gfx_of_classgfx(g0), link, r['gfx'], 'weapon',
                    f'held by the rider ({r["link"]}) at unit level {lvs[0]}' + (f'..{lvs[-1]}' if len(lvs) > 1 else ''),
                    s_capw, weapon=wn, note=('empty Links -> not shown by CCaptain (no HndR default here)' if not link else None))

# =====================================================================================
# characters: weapons (CCharacter.UpdateWeaponsGfx), worker tools/containers, special moves
# =====================================================================================
s_wgfx = src(CHAR, 'asWeapons[0] = sCurWeapon+"/Parts";')
s_var = src('Base/Scripts/Server/classes/misc/WeaponMgr.usl', 'export proc string GetRightHVariationPostfix()')
SLOT = {'0': 'right hand weapon', '1': 'left hand weapon', '2': 'armor'}
for o, (tribe, cat, node, nm) in OBJ.items():
    if cat != 'CHTR': continue
    for wtribe in ([tribe] if tribe != 'Special' else ['Special']):
        for wn, w in TT.get(wtribe, {}).get('Weapons', {}).items():
            if nm not in (w.get('Users') or {}).values(): continue
            if str(w.get('secondary', '0')) != '0': continue
            parts = w.get('Parts')
            if not isinstance(parts, dict): continue
            lvl = int(w.get('level', '0') or 0)
            slot = str(w.get('slot', '0'))
            for p in parts.values():
                if not isinstance(p, dict): continue
                g0 = (p.get('Gfx') or {}).get('0')
                if not g0: continue
                link = p.get('Links') or 'HndR'
                var = None
                if slot == '0' and lvl in (1, 2) and wtribe != 'Special':
                    vv = [gfx_of_classgfx(g0)] + [gfx_of_classgfx(g0 + sfx) for sfx in (['_2', '_3'] if lvl == 1 else ['_2']) if (g0 + sfx).lower() in CLS]
                    var = vv if len(vv) > 1 else None
                add(o, gfx_of_classgfx(g0), link, '', 'weapon',
                    f'unit level >= {lvl} while it is the best {SLOT.get(slot, "slot " + slot)} (higher-level weapons of the same slot replace it)',
                    s_wgfx, variants=var, weapon=wn,
                    variant_rule=('random per unit: "", "_2", "_3" class postfix (WeaponMgr.SelectNewWeaponVariation)' if var else None))

# worker tools / carried things
s_axe = src(TASK + 'Harvest.usl', 'pxWorker^.SetLinkGFX(m_xFCCWeaponLink,m_sWeapon);')
s_pick = src(TASK + 'Mine.usl', 'pxWorker^.SetLinkGFX(m_xFCCWeaponLink, m_sWeapon);')
s_ham = src(TASK + 'BuildUp.usl', 'SetLinkGFX(m_xFCCRightHandLink, m_sWeapon);')
s_rep = src(TASK + 'Repair.usl', 'SetLinkGFX(m_xFCCRightHandLink,m_sWeapon);')
s_thing = src(TASK + 'Harvest.usl', 'export proc void SetThing(string p_sTribe)')
s_mine_carry = src(TASK + 'Mine.usl', 'pxWorker^.SetLinkGFX(m_xThingLink, m_sThing);')
s_food_carry = src(TASK + 'GetFood.usl', 'pxWorker^.SetLinkGFX(m_xThingLink, m_sThing);')
s_wood = src(TASK + 'Harvest.usl', 'SetLinkGFX(m_xFCCWeaponLink,"Product_Wood_"')
s_basket = src(TASK + 'GetFood.usl', 'pxWorker^.SetLinkGFX(m_xBasketLink,m_sBasketGfx);')
s_basket_def = src(TASK + 'GetFood.usl', 'm_sBasketGfx = "Hu_Seed_Basket";', after=200)
s_seed = src(TASK + 'GetCorn.usl', 'SetLinkGFX(m_xFCCLeftHandLink,"Hu_Seed_Basket")')
s_sickle = src(TASK + 'GetCorn.usl', 'SetLinkGFX(m_xFCCRightHandLink,"Hu_Sickle")')
s_corn = src(TASK + 'GetCorn.usl', 'SetLinkGFX(m_xFCCRightHandLink,"Hu_Corn")')
s_unl = src(TASK + 'GetUnlimited.usl', 'pxWorker^.SetLinkGFX(m_xThingLink,m_sThing);')
s_ladder = src(TASK + 'DockWall.usl', 'SetLinkGFX(m_xFCCWeaponLink,"Hu_Clerk")')
THING = {'Hu': ('hu_pannier', 'Back'), 'Aje': ('aje_clay_jug', 'HndR'), 'Ninigi': ('ninigi_basket', 'HndR'), 'SEAS': ('seas_backpack', 'Back')}
for tribe, pre in (('Hu', 'hu'), ('Aje', 'aje'), ('Ninigi', 'ninigi'), ('SEAS', 'seas')):
    w = f'{pre}_worker'
    add(w, f'{pre}_axe', 'HndR', '', 'tool', 'chopping wood (Harvest task)', s_axe)
    add(w, f'{pre}_pick', 'HndR', '', 'tool', 'mining stone (Mine task)', s_pick)
    add(w, f'{pre}_hammer', 'HndR', '', 'tool', 'building / repairing (BuildUp, Repair tasks; <PlayerTribe>_hammer)', s_ham + ', ' + s_rep)
    tg, tl = THING[tribe]
    add(w, tg, tl, '', 'container', 'carrying stone or food back to the depot (Mine, GetFood tasks)', s_thing + ', ' + s_mine_carry + ', ' + s_food_carry)
    add(w, 'product_wood_<setting>', 'HndR', '', 'container', 'carrying a log (Harvest task); <setting> = first 3 letters of the map setting (Sav, Jun, Nor, Ice, Ash)',
        s_wood, variants=['product_wood_sav', 'product_wood_jun', 'product_wood_nor', 'product_wood_ice', 'product_wood_ash'], guess=True,
        note='setting abbreviations inferred; vegetation archives not converted')
    if tribe in ('Hu', 'Aje', 'Ninigi'):
        add(w, 'hu_seed_basket', 'HndL', '', 'container', 'gathering fruit (GetFood task, bushes)', s_basket + ', ' + s_basket_def,
            note='Ninigi: init sets ninigi_basket at Back, but USLOnEnter overrides it with Hu_Seed_Basket/HndL' if tribe == 'Ninigi' else None)
    if tribe in ('Hu', 'Ninigi', 'SEAS'):
        add(w, 'hu_seed_basket', 'HndL', '', 'tool', 'sowing on a field (GetCorn task, grow step < 25)', s_seed,
            note='fields: hu_corn_field / ninigi_paddy / ninigi_bamboofarm / seas_greenhouse (character.usl)')
        add(w, 'hu_sickle', 'HndR', '', 'tool', 'reaping a field (GetCorn task, grow step >= 25)', s_sickle)
        add(w, 'hu_corn', 'HndR', '', 'container', 'carrying the harvest (GetCorn task)', s_corn)
    if tribe == 'Aje':
        add(w, 'hu_corn', 'HndR', '', 'container', 'carrying from the slaughterhouse (GetUnlimited task)', s_unl)
    if tribe == 'Hu':
        add(w, 'hu_clerk', 'HndR', '', 'tool', 'building a ladder at a wall (CBuildLadder task)', s_ladder, guess=True,
            note='task is in DockWall.usl; that hu_worker is the ladder builder is inferred from Actions/Hu/Build/BLDG/hu_ladder')

s_sling = src(CHAR, 'm_sAnimalWeapon+=sTribe+"_slingshot_";')
for tribe, pre in (('Hu', 'hu'), ('Aje', 'aje'), ('Ninigi', 'ninigi')):
    w = TT[tribe]['Weapons'].get(f'{pre}_slingshot_a')
    p = w['Parts']['0']
    g0 = p['Gfx']['0']
    vv = [gfx_of_classgfx(g0)] + [gfx_of_classgfx(g0 + sfx) for sfx in ('_2', '_3') if (g0 + sfx).lower() in CLS]
    add(f'{pre}_worker', gfx_of_classgfx(g0), p.get('Links') or 'HndR', '', 'weapon',
        'fighting a wild (unowned) animal (CCharacter.UpdateEquipment: <tribe>_slingshot_<a..e> by level, all use the same part)',
        s_sling, variants=vv if len(vv) > 1 else None, weapon=f'{pre}_slingshot_a..e')

add('hu_jetpack_warrior', 'hu_steam_jet_pack', 'Back', '', 'other', 'during the jetpack special move (Actions/Hu/Moves/CHTR/jetpack)',
    src(TASK + 'Jetpack.usl', 'SetLinkGFX(xLink,"Hu_Steam_Jet_Pack")'))
add('babbage_s0', 'babbage_minigun', 'HndR', '', 'weapon', 'during special move Babbage_Minigun_0 (level 3+)',
    src(TASK + 'BabbageMinigun.usl', 'SetLinkGFX(xLink, "babbage_minigun")'))
add('cole_s0', 'cole_shotgun', 'HndR', '', 'weapon', 'during special move Shotgun (level 3+)',
    src(TASK + 'Shotgun.usl', 'SetLinkGFX(m_xFCCRightHandLink,"Cole_Shotgun")'))

# =====================================================================================
# order & write
# =====================================================================================
# merge identical weapon parts of successive levels (e.g. worker club a..e share one model)
for o, v in entries.items():
    merged, seen = [], {}
    for e in v:
        if e['kind'] == 'weapon' and e['parent'] == '' and e['when'].startswith('unit level >= '):
            key = (e['gfx'], e['link'])
            if key in seen:
                m = seen[key]
                m['weapon'] = m['weapon'] + ', ' + e['weapon']
                continue
            seen[key] = e
        merged.append(e)
    entries[o] = merged

KORDER = ['turret', 'buildup', 'drawbar', 'wagon', 'rider', 'weapon', 'tool', 'container', 'other']
out = {}
for o in sorted(entries):
    out[o] = sorted(entries[o], key=lambda e: (KORDER.index(e['kind']), e['parent'] != '', ))
os.makedirs(OUT, exist_ok=True)
json.dump(out, open(OUT + '/composites.json', 'w'), indent=1)

# object -> gfx map
gm = {}
for o, (tribe, cat, node, nm) in sorted(OBJ.items()):
    ttg = node.get('gfx')
    c = CLS.get(o, {})
    e = {'tribe': tribe, 'type': cat, 'gfx': (ttg or '').lower() or None, 'class': c.get('classname'),
         'class_gfx': (c.get('gfx') or '').lower() or None}
    e['glb'] = bool(e['gfx'] and e['gfx'] in GLB)
    if e['gfx'] and e['class_gfx'] and e['gfx'] != e['class_gfx']:
        e['note'] = 'tech tree gfx overrides the class gfx (CFightingObj.UpdateGfx)'
    fl = GFXF.get(f'/Objects/{tribe}/{cat}/{nm}/gfx')
    if fl:
        e['gfx_by_filter'] = sorted({(v, f) for v, f in fl}, key=lambda x: x[1])
        e['gfx_by_filter'] = [{'gfx': v.lower(), 'filter': f, 'glb': v.lower() in GLB} for v, f in e['gfx_by_filter']]
    if node.get('captainclass') not in (None, '0', ''):
        e['captainclass'] = node['captainclass']
    gm[nm] = e
json.dump(gm, open(OUT + '/object_gfx.json', 'w'), indent=1)

# stats
kinds = collections.Counter(e['kind'] for v in out.values() for e in v)
bad = [(o, e['gfx'], e['link'], e['link_check']) for o, v in out.items() for e in v if not e['link_check'].startswith('ok') and not e['link_check'].startswith('no_link')]
print('objects', len(out), 'entries', sum(len(v) for v in out.values()), dict(kinds))
print('link problems:', len(bad))
for b in bad: print('  ', b)
miss = sorted({e['gfx'] for v in out.values() for e in v if e.get('glb_missing')})
print('missing glb parts:', miss)
