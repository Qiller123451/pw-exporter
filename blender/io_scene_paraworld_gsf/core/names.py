"""Names of bits and well-known values (for the user interface; nothing here changes the file data)."""
import zlib


def crc32(name):
    """GUID of a component / bone: CRC-32 of its name as written in the source scene"""
    return zlib.crc32((name or '').encode('latin-1', 'replace')) & 0xFFFFFFFF


# --------------------------------------------------------------------------------------------- chunk attribute bits
# Bits are numbered from the least significant bit (1 << bit), as SEK's tools do.
_COMMON = {0: 'LOD 0', 1: 'LOD 1', 2: 'LOD 2', 3: 'LOD 3', 4: 'LOD 4', 18: 'SelVol (pick volume)'}
_BUILDING = {5: 'AnimateConStart', 6: 'AnimateConEnd', 9: 'Age 1', 10: 'Age 2', 11: 'Age 3', 12: 'Age 4',
             13: 'Age 5', 19: 'ShadowModel', 20: 'Night', 21: 'Con 0', 22: 'Con 1', 23: 'Con 2', 24: 'Con 3',
             25: 'Con 4 (finished)', 26: 'UseConFlags', 27: 'Dest 1', 28: 'Dest 2'}
_ANIM = {5: 'PartyCol', 6: 'Saddle', 7: 'Helmet', 8: 'Armor', 9: 'Standarte', 10: 'Armorsaddle', 11: 'Misc',
         16: 'Activated', 20: 'Wound arm_li', 21: 'Wound arm_re', 22: 'Wound leg_li', 23: 'Wound leg_re',
         24: 'Wound bauch_li', 25: 'Wound bauch_re', 26: 'Wound head', 27: 'Wound tail'}
_CHAR = {5: 'Head', 6: 'Body', 7: 'Legs'}
_RESS = {5: 'res_1', 6: 'res_2', 7: 'res_3', 8: 'res_4', 9: 'res_5', 10: 'res_6'}
_MISC = {5: 'Misc_Step0', 6: 'Misc_Step1', 7: 'Misc_Step2', 19: 'ShadowModel', 20: 'Night'}

ATTRIBUTE_BITS = {
    'Bldg': _BUILDING, 'Fiel': _BUILDING, 'Wall': _BUILDING,
    'Ship': {**_BUILDING, 5: 'ram_low', 6: 'ram_high'},
    'Vehi': {5: 'ram_low', 6: 'ram_high', 19: 'ShadowModel'},
    'Anim': _ANIM, 'Char': _CHAR, 'Ress': _RESS, 'Misc': _MISC,
    'Deko': {5: 'Sequence', 19: 'ShadowModel', 20: 'Night'},
    'Vgtn': {19: 'TreeBillboard'},
    'RIVR': {21: 'UseWaterShader'},
}


def attribute_bit_names(fourcc):
    names = dict(_COMMON)
    names.update(ATTRIBUTE_BITS.get((fourcc or '').strip(), {}))
    return [names.get(i, 'bit %d' % i) for i in range(32)]


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
