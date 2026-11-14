"""Names of bits and well-known values (for the user interface; nothing here changes the file data)."""
import zlib


def crc32(name):
    """GUID of a component / bone: CRC-32 of its name as written in the source scene"""
    return zlib.crc32((name or '').encode('latin-1', 'replace')) & 0xFFFFFFFF


# --------------------------------------------------------------------------------------------- chunk attribute bits
# Bits are numbered from the least significant bit (1 << bit), as SEK's tools do.
# The same bit numbers are the part flags of the game's scripts: CObjBase.SetRndInvMaskSingleFlagInv(bit, bShow)
# (index 0-31; the engine uses index & 31) shows (true) or hides (false) the meshes that carry the bit.
# Each entry: bit -> (label, meaning, engine part name or '', script constant or ''). Engine part names are the ones
# PWClient.exe's sequence part table (CItemFlags) uses for that FourCC; script constants are MIRAGE's USL names.
_HIDE = 'In the game: SetRndInvMaskSingleFlagInv(%d, true) shows these meshes, (%d, false) hides them.'

_COMMON = {
    0: ('LOD 0', 'Level of detail 0 (closest). The engine picks the level from the camera distance', '',
        'CFightingObj.VIS_FLAG_LOD0 = 0 (engine-controlled, do not set from scripts)'),
    1: ('LOD 1', 'Level of detail 1. Chosen by the engine', '', 'CFightingObj.VIS_FLAG_LOD1 = 1 (engine-controlled)'),
    2: ('LOD 2', 'Level of detail 2. Chosen by the engine', '', 'CFightingObj.VIS_FLAG_LOD2 = 2 (engine-controlled)'),
    3: ('LOD 3', 'Level of detail 3. Chosen by the engine', '', 'CFightingObj.VIS_FLAG_LOD3 = 3 (engine-controlled)'),
    4: ('LOD 4', 'Level of detail 4 (farthest). Chosen by the engine', '',
        'CFightingObj.VIS_FLAG_LOD4 = 4 (engine-controlled)'),
    18: ('SelVol (pick volume)', 'Selection / pick volume: never drawn, used for clicking the object', '',
         'CFightingObj.VIS_FLAG_SELVOL = 18 (engine-controlled)'),
}
_SHADOW = (19, ('ShadowModel', 'Mesh that only casts the shadow', '', 'CFightingObj.VIS_FLAG_SHADOWMODEL = 19'))
_DAY = (17, ('Day (not at night)', 'Shown in daylight, hidden at night: at night the buildings hide bit 17 and show '
             'bit 20 (the engine part "Night" switches both)', 'Night (inverted)', 'CFightingObj.VIS_FLAG_BLDG_INIGHTMODE = 17'))
_NIGHT = (20, ('Night', 'Shown at night only (lights), switched together with bit 17', 'Night',
               'CFightingObj.VIS_FLAG_BLDG_NIGHTMODE = 20'))
_BUILDING = {
    5: ('AnimateConStart', 'Animated part at the start of construction. Scarecrows (Bldg) show and hide their '
        'figure with this bit', '', 'CFightingObj.VIS_FLAG_BLDG_ANIMATECONSTART = 5, '
        'CFightingObj.VIS_FLAG_BLDG_SCARECROW = 5'),
    6: ('AnimateConEnd', 'Animated part at the end of construction', '',
        'CFightingObj.VIS_FLAG_BLDG_ANIMATECONEND = 6'),
    9: ('Age 1', "Shown in the owner's epoch 1", '', 'CFightingObj.VIS_FLAG_BLDG_AGE1 = 9'),
    10: ('Age 2', "Shown in the owner's epoch 2", '', 'CFightingObj.VIS_FLAG_BLDG_AGE2 = 10'),
    11: ('Age 3', "Shown in the owner's epoch 3", '', 'CFightingObj.VIS_FLAG_BLDG_AGE3 = 11'),
    12: ('Age 4', "Shown in the owner's epoch 4", '', 'CFightingObj.VIS_FLAG_BLDG_AGE4 = 12'),
    13: ('Age 5', "Shown in the owner's epoch 5", '', 'CFightingObj.VIS_FLAG_BLDG_AGE5 = 13'),
    _SHADOW[0]: _SHADOW[1], _DAY[0]: _DAY[1], _NIGHT[0]: _NIGHT[1],
    21: ('Con 0', 'Construction stage 0', '', 'CFightingObj.VIS_FLAG_BLDG_CON0 = 21'),
    22: ('Con 1', 'Construction stage 1', '', 'CFightingObj.VIS_FLAG_BLDG_CON1 = 22'),
    23: ('Con 2', 'Construction stage 2', '', 'CFightingObj.VIS_FLAG_BLDG_CON2 = 23'),
    24: ('Con 3', 'Construction stage 3', '', 'CFightingObj.VIS_FLAG_BLDG_CON3 = 24'),
    25: ('Con 4 (finished)', 'Finished building', '', 'CFightingObj.VIS_FLAG_BLDG_CON4 = 25'),
    26: ('UseConFlags', 'Part of the intact object', '', 'CFightingObj.VIS_FLAG_BLDG_USECONFLAGS = 26'),
    27: ('Dest 1', 'Damage stage 1', '', 'CFightingObj.VIS_FLAG_BLDG_DEST1 = 27'),
    28: ('Dest 2', 'Damage stage 2', '', 'CFightingObj.VIS_FLAG_BLDG_DEST2 = 28'),
    29: ('Economy', 'Name from the scripts; no script switches it, meaning unknown', '', 'CFightingObj.VIS_FLAG_BLDG_ECONOMY = 29'),
    30: ('Defense', 'Name from the scripts; no script switches it, meaning unknown', '', 'CFightingObj.VIS_FLAG_BLDG_DEFENSE = 30'),
    31: ('Combat', 'Name from the scripts; no script switches it, meaning unknown', '', 'CFightingObj.VIS_FLAG_BLDG_COMBAT = 31'),
}
_RAM = {5: ('ram_low', 'Ram in the low position', 'ram_low', 'CFightingObj.VIS_FLAG_VHCL_RAM_LOW = 5'),
        6: ('ram_high', 'Ram in the high position', 'ram_high', 'CFightingObj.VIS_FLAG_VHCL_RAM_HIGH = 6')}
_WOUND = 'Wound decal, shown by the hit point ratio (0.8 ... 0.2)'
_ANIM = {
    5: ('PartyCol', 'Player-colour parts (tamed animal)', 'PartyCol', 'CFightingObj.VIS_FLAG_ANML_PARTYCOL = 5'),
    6: ('Saddle', 'Saddle', 'Saddle', 'CFightingObj.VIS_FLAG_ANML_SADDLE = 6'),
    7: ('Helmet', 'Helmet', 'Helmet', 'CFightingObj.VIS_FLAG_ANML_HELMET = 7'),
    8: ('Armor', 'Armour', 'Armor', 'CFightingObj.VIS_FLAG_ANML_ARMOR = 8'),
    9: ('Standarte', 'Standard (banner)', 'Standarte', 'CFightingObj.VIS_FLAG_ANML_STANDARTE = 9'),
    10: ('Armorsaddle', 'Armoured saddle', 'Armorsaddle', 'CFightingObj.VIS_FLAG_ANML_ARMORSADDLE = 10'),
    11: ('Misc', 'Other equipment (also the training dummies of MIRAGE)', 'Misc',
         'CFightingObj.VIS_FLAG_ANML_MISC = 11'),
    20: ('Wound arm_li', _WOUND + ': left arm', 'arm_li', 'CFightingObj.VIS_FLAG_ANML_WOUND_ARMLI = 20'),
    21: ('Wound arm_re', _WOUND + ': right arm', 'arm_re', 'CFightingObj.VIS_FLAG_ANML_WOUND_ARMRE = 21'),
    22: ('Wound leg_li', _WOUND + ': left leg', 'leg_li', 'CFightingObj.VIS_FLAG_ANML_WOUND_LEGLI = 22'),
    23: ('Wound leg_re', _WOUND + ': right leg', 'leg_re', 'CFightingObj.VIS_FLAG_ANML_WOUND_LEGRE = 23'),
    24: ('Wound bauch_li', _WOUND + ': left belly', 'bauch_li', 'CFightingObj.VIS_FLAG_ANML_WOUND_BELLI = 24'),
    25: ('Wound bauch_re', _WOUND + ': right belly', 'bauch_re', 'CFightingObj.VIS_FLAG_ANML_WOUND_BELRE = 25'),
    26: ('Wound head', _WOUND + ': head (only when the head is missing)', 'head',
         'CFightingObj.VIS_FLAG_ANML_WOUND_HEAD = 26'),
    27: ('Wound tail', _WOUND + ': tail', 'tail', 'CFightingObj.VIS_FLAG_ANML_WOUND_TAIL = 27'),
}
_CHAR = {
    5: ('Head', 'Head variant', 'Head', 'CFightingObj.VIS_FLAG_CHTR_HEAD = 5'),
    6: ('Body', 'Body variant', 'Body', 'CFightingObj.VIS_FLAG_CHTR_BODY = 6'),
    7: ('Legs', 'Legs variant', 'Legs', 'CFightingObj.VIS_FLAG_CHTR_LEGS = 7'),
    16: ('Activated', 'Activated part (healer staffs)', '', 'CFightingObj.VIS_FLAG_CHTR_ACTIVATED = 16'),
}
_RESS = {5 + k: ('res_%d' % (k + 1), 'Resource stage %d (res_6 = full)' % (k + 1), 'res_%d' % (k + 1),
                 'CResource.VIS_FLAG_RSRC_STATE%d = %d' % (k + 1, 5 + k)) for k in range(6)}
_MISC = {5 + k: ('Misc_Step%d' % k, 'Step %d of a Misc object (craters use 6 and 7)' % k, 'Misc_Step%d' % k,
                 'CFightingObj.VIS_FLAG_MISC_STEP%d = %d' % (k, 5 + k)) for k in range(3)}
_MISC.update({_SHADOW[0]: _SHADOW[1], _DAY[0]: _DAY[1], _NIGHT[0]: _NIGHT[1],
              16: ('Activated', 'Activated part (healer staffs)', '', 'CFightingObj.VIS_FLAG_CHTR_ACTIVATED = 16')})
# construction / damage bits on other classes: same bits as on buildings, not checked in the engine for these classes
_STATE_P = {b: (_BUILDING[b][0], 'Probably as on buildings: ' + _BUILDING[b][1][0].lower() + _BUILDING[b][1][1:],
                '', _BUILDING[b][3]) for b in range(21, 29)}
_TOWER = {5 + k: ('Zinnen_%d' % (k + 1), 'Battlement %d of a tower' % (k + 1), 'Zinnen_%d' % (k + 1),
                  'CFightingObj.VIS_FLAG_TOWE_ZINNEN%d = %d' % (k + 1, 5 + k)) for k in range(9)}
_GATE = {
    7: ('West (gate)', 'Gate piece shown when the gate stands diagonally', '', 'CGate.VIS_FLAG_WEST_BIT = 7'),
    11: ('Ost (gate)', 'Gate piece shown when the gate stands diagonally (Bldg: Age 3)', '',
         'CGate.VIS_FLAG_OST_BIT = 11'),
    14: ('Open (gate collision)', 'Collision volume of the open gate', '', 'CGate.VIS_FLAG_OPEN_BIT = 14'),
    16: ('Closed (gate collision)', 'Collision volume of the closed gate', '', 'CGate.VIS_FLAG_CLOSED_BIT = 16'),
}

ATTRIBUTE_FLAGS = {
    'Bldg': _BUILDING,
    'Fiel': _BUILDING,
    'Wall': {**_BUILDING, **_GATE},
    'Ship': {**_BUILDING, **_RAM},
    'Towe': {**_BUILDING, **_TOWER},
    'Vehi': {**_STATE_P, **_RAM, _SHADOW[0]: _SHADOW[1]},
    'Anim': _ANIM, 'Char': {**_STATE_P, **_CHAR}, 'Ress': {**_STATE_P, **_RESS}, 'Misc': {**_STATE_P, **_MISC},
    'Deko': {**_STATE_P,
             5: ('Sequence', 'Part shown in cutscenes', 'Sequence', 'CFightingObj.VIS_FLAG_DEKO_SEQUENCE = 5'),
             _SHADOW[0]: _SHADOW[1], _DAY[0]: _DAY[1], _NIGHT[0]: _NIGHT[1]},
    'Vgtn': {**_STATE_P,
             19: ('TreeBillboard', 'Far-away impostor of a tree', '', 'CFightingObj.VIS_FLAG_VGTN_TREEBILLBOARD = 19')},
    'RIVR': {**_STATE_P, 21: ('UseWaterShader', 'Drawn with the water shader', '', '')},
}
# labels only, as before
ATTRIBUTE_BITS = {k: {b: v[0] for b, v in d.items()} for k, d in ATTRIBUTE_FLAGS.items()}


def _usage(fourcc, bit):
    from .flag_usage import MODELS, USE
    if fourcc not in MODELS:
        return ''
    n, ex = USE.get(fourcc, {}).get(bit, (0, ''))
    if not n:
        return 'Game data: no %s model uses it' % fourcc
    return 'Game data: %d of %d %s models use it (e.g. %s)' % (n, MODELS[fourcc], fourcc, ex)


def attribute_bit_info(fourcc):
    """(label, tooltip) of the 32 attribute bits of a model class"""
    fourcc = (fourcc or '').strip()
    info = dict(_COMMON)
    info.update(ATTRIBUTE_FLAGS.get(fourcc, {}))
    out = []
    for i in range(32):
        e = info.get(i)
        if e is None:
            label, meaning, engine, script = 'bit %d' % i, 'No known use%s' % (
                ' for %s models' % fourcc if fourcc else ''), '', ''
        else:
            label, meaning, engine, script = e
        lines = ['%s.' % meaning, 'Bit %d, mask 0x%08X' % (i, 1 << i)]
        if engine:
            lines.append('Engine part name: %s' % engine)
        if script:
            lines.append('Script: %s' % script)
        if i > 4 and i != 18:
            lines.append(_HIDE % (i, i))
        use = _usage(fourcc, i)
        if use:
            lines.append(use)
        out.append((label, '\n'.join(lines)))
    return out


def attribute_bit_names(fourcc):
    return [label for label, _ in attribute_bit_info(fourcc)]


# ------------------------------------------------------------------------------------------------- material bits
MATERIAL_ATTR1_BITS = {
    0: 'Alpha test (hard alpha)', 1: 'Alpha blend (soft alpha)', 2: 'Additive / self illuminated',
    3: 'Environment map', 4: 'Normal map', 8: 'No z-write (probably)', 9: 'Two sided (probably)',
    12: 'Player colour (alpha masks team colour)', 14: 'Specular (probably)', 15: 'Maximum shadow (community)',
}
MATERIAL_ATTR2_DOC = 'bits 0-3 specular / environment strength, bits 4-7 normal map strength, 0x100000 water shader'

# ------------------------------------------------------------------------------------------------- mesh flags
MESH_FLAG_BITS = {0: 'unk_0x01', 1: 'unk_0x02 (set on nearly every mesh)', 2: 'unk_0x04',
                  3: 'Extended UV (10 bit texture coordinates)', 4: 'Baked light (extra byte per vertex)',
                  5: 'Wrapped UV', 6: 'unk_0x40', 7: 'unk_0x80', 8: 'unk_0x100'}

# ----------------------------------------------------------------------------------------------- particle params
# Parameters of particle source 3 (CParticleSource_3), four bytes each, in file order. (name, kind)
PARTICLE3_PARAMS = [
    ('size', 'f'), ('life_time', 'f'), ('rotate', 'f'), ('gravitation', 'f'), ('size_var', 'f'), ('drag', 'f'),
    ('flags', 'x'), ('col_alp_fadein', 'f'), ('col_alp_fadeout', 'f'), ('tile_anim_speed', 'f'),
    ('lifetime_var', 'f'), ('size_increase', 'f'), ('color_var_r', 'i'), ('color_var_g', 'i'),
    ('color_var_b', 'i'), ('emit_timer', 'f'), ('speed_var', 'f'), ('emit_timer_var', 'f'), ('color_r', 'i'),
    ('color_g', 'i'), ('color_b', 'i'), ('emit_rot_inc', 'f'), ('src_rot_speed', 'f'), ('center_suck', 'f'),
    ('suck_vel', 'f'), ('rotation_var', 'f'), ('alpha', 'i'), ('emit_per_meter', 'f'), ('size_inc_exp', 'f'),
]
PARTICLE3_FLAG_BITS = {0: 'Start in a sphere', 1: 'Velocity from a random sphere point', 6: 'Radial velocity',
                       7: 'Burst (all particles start together)', 8: 'Tile animation', 9: 'Ring edge',
                       10: 'Tile animation (2)', 11: 'Tile animation (3)', 12: 'Tile animation (4)',
                       14: 'Fade alpha only', 15: 'Fade colour and alpha', 16: 'Radial velocity (2)',
                       17: 'Never downwards', 19: 'Particles live in the world', 23: 'Upper half sphere',
                       25: 'No motion', 26: "Gravity along the emitter's -z", 29: 'Sprite turned along its flight',
                       30: 'Flat on the ground'}


def particle_param_spec(source_type, index):
    """(name, kind) of parameter `index` of a particle source; kind f = float, i = int, x = bit set"""
    if (source_type & 0x7FFFFFFF) == 3 and index < len(PARTICLE3_PARAMS):
        return PARTICLE3_PARAMS[index]
    return ('unk_param_%d' % index, 'x')


# -------------------------------------------------------------------------------------------------- bone names
# Bone names are not stored, only their CRC-32. These are names that are known to occur (3ds Max Biped and the
# names used by SEK); a bone whose CRC is in this table gets its real name on import.
_BIPED = ['Bip01', 'Bip01 Pelvis', 'Bip01 Spine', 'Bip01 Spine1', 'Bip01 Spine2', 'Bip01 Spine3', 'Bip01 Neck',
          'Bip01 Neck1', 'Bip01 Neck2', 'Bip01 Neck3', 'Bip01 Head', 'Bip01 HeadNub', 'Bip01 Ponytail1',
          'Bip01 Tail', 'Bip01 Tail1', 'Bip01 Tail2', 'Bip01 Tail3', 'Bip01 Tail4', 'Bip01 Tail5', 'Bip01 Tail6',
          'Bip01 Tail7', 'Bip01 Tail8', 'Bip01 Tail9', 'Bip01 TailNub', 'Bip01 Footsteps']
for _side in ('L', 'R'):
    for _part in ('Clavicle', 'UpperArm', 'Forearm', 'Hand', 'Finger0', 'Finger01', 'Finger02', 'Finger0Nub',
                  'Finger1', 'Finger11', 'Finger12', 'Finger1Nub', 'Finger2', 'Finger21', 'Finger22', 'Finger2Nub',
                  'Finger3', 'Finger31', 'Finger32', 'Finger4', 'Finger41', 'Finger42', 'Thigh', 'Calf',
                  'HorseLink', 'Foot', 'Toe0', 'Toe01', 'Toe02', 'Toe0Nub', 'Toe1', 'Toe11', 'Toe2', 'Toe21',
                  'Toe3', 'Toe4'):
        _BIPED.append('Bip01 %s %s' % (_side, _part))
KNOWN_BONE_NAMES = {crc32(n): n for n in ['root', 'Root', 'Helper01', 'KOHelper01', 'Dummy01'] + _BIPED}


def bone_name(guid, used):
    """readable, unique bone name for a CRC"""
    n = KNOWN_BONE_NAMES.get(guid) or 'b_%08X' % guid
    base, k = n, 1
    while n in used:
        k += 1
        n = '%s.%d' % (base, k)
    used.add(n)
    return n


def guid_from_bone_name(name):
    """inverse of bone_name for names it produced, else the CRC of the name"""
    base = name.split('.')[0] if name.rsplit('.', 1)[-1].isdigit() else name
    if base.startswith('b_') and len(base) == 10:
        try:
            return int(base[2:], 16)
        except ValueError:
            pass
    return crc32(base)


# ------------------------------------------------------------------------------------------- component names
# Wall and gate parts are found by the engine by name: the CRC of "<component><variant>" - components "x0" "x1" "x2"
# "x03".."x47" (hubs) and "<d><a..h>" (the piece towards tile neighbour d), variants A..P (construction / damage).
def _wall_part_names():
    comps = ['x0', 'x1', 'x2', 'x03', 'x05', 'x14', 'x16', 'x25', 'x27', 'x36', 'x47'] + \
        ['%d%c' % (d, 97 + k) for d in range(8) for k in range(8)]
    return {crc32('%s%c' % (c, 65 + v)): '%s%c' % (c, 65 + v) for c in comps for v in range(16)}


KNOWN_COMPONENT_NAMES = _wall_part_names()


# Model classes whose components the game draws by construction / damage state: a mesh is drawn only when its bits
# match the object's state (Con 0-4, UseConFlags, Dest 1-2). A mesh with LOD bits only is never drawn.
STATE_CLASSES = ('Bldg', 'Wall', 'Ship', 'Fiel')
STATE_BITS = 0x1FE00000          # bits 21-28: Con 0-3, Con 4, UseConFlags, Dest 1, Dest 2 = shown in every state


def needs_state_bits(fourcc):
    return (fourcc or '').strip() in STATE_CLASSES
