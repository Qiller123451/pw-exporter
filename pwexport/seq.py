"""ParaWorld in-engine cutscenes (.seq): a complete decoder, reverse-engineered from the game client.

    from pwexport.seq import read_seq
    s = read_seq('Data/Base/Sequences/Cpn_single_001/single_03/sc_2010.seq')    # path, gzip bytes or raw bytes
    s['timeline'], s['camera_track'], s['items'], s['actors'], s['cameras'], s['region']

    python -m pwexport.seq <file.seq | folder> [--json out.json]     dump one file (or every file of a folder)
    python -m pwexport.seq --check <ParaWorld folder | folder>       decode every .seq, report the bytes consumed

A .seq file is gzip; inside is the client's own archive of a CSequence (PWClient.exe 0x530f70 opens
/Data/Base/Sequences/<file>, 0x52d3a0 serializes the sequence). The decoder below follows the client's loader call
by call - every field is read because the loader reads it, in its order and under its version conditions - and it
must end exactly at the last byte (it raises otherwise). The format, the addresses and what the fields DO when the
game plays a sequence are in docs/SEQUENCE_FORMAT.md.

The document (SCHEMA 'pw-seq/1'):

    schema, file, version, name, timeline {length, start, end, duration}, flags {raw, hide_region_objects ...},
    audio_mode, anchor, region (the SeqRegion: a region like the map's Rgns ones), day_time (an ItemDayTime),
    camera_track [ItemCamera cuts -> camera guid], items [global timeline items: ItemSound, ItemParticle, ItemFading,
    ItemWideScreen, ItemBink, ItemText, ItemCut, ItemCamFX ...], actors [{guid, name, class, type, attributes,
    binding, state, flags, links, items [ItemAnim, ItemAnimAct, ItemWalkAct, ItemRotAct, ItemVisPath, ItemLipSync,
    ItemAttr, ItemFlags, ItemLink, ItemFaceExpr, ItemResetCloth, ItemBeam]}], cameras [{guid, name, eye, target, fov,
    spline}], editor_camera.

Every timeline item: {type, class, tag (the editor's short label: Cam1, Snd3, LipS, AEvt ...), guid, start, length
(seconds), ...fields}. Units and conventions (the same as the map objects of ula.py / campaign.py):
positions are map metres (x east, y south, z up), quaternions are stored (x, y, z, w) and applied the Direct3D way
(ula.rotation_matrix); 'heading' = the yaw in map space as ula.py computes it. A camera looks along its local +Y axis
with local +Z up; fov in radians. Times in seconds; key frames of paths and camera splines count 1/50 s, animation
frames 1/25 s. GUIDs are the 32-letter form of the level editor / trigger parameters (triggers.guid_str), so actor
and camera GUIDs compare directly with the objects of a campaign JSON.
"""
import gzip
import json
import math
import os
import struct

from .triggers import SHAPES, guid_str
from .ula import text

SCHEMA = 'pw-seq/1'
KEY_RATE = 50.0         # key frames per second of paths and camera splines (PWClient 0x840670 = 50.0)
ANIM_RATE = 25.0        # animation frames per second of the sequencer (0x8439d0 = 25.0)


class SeqError(ValueError):
    pass


# ---------------------------------------------------------------- the archive reader
class _Arc:
    """the client's CArc in read mode (0x59e5a0 reads n raw bytes, 0x412470 a u32-length string); `version` is the
    archive version the sequence loader stores in the archive ([arc+0xc], 0x52d3e6) - the spline keys test it"""

    def __init__(self, b):
        self.b, self.o, self.version = b, 0, 0

    def need(self, n):
        if self.o + n > len(self.b):
            raise SeqError('unexpected end of data at byte %d (%d more needed)' % (self.o, n))

    def u8(self):
        self.need(1)
        v = self.b[self.o]
        self.o += 1
        return v

    def u16(self):
        self.need(2)
        v = struct.unpack_from('<H', self.b, self.o)[0]
        self.o += 2
        return v

    def u32(self):
        self.need(4)
        v = struct.unpack_from('<I', self.b, self.o)[0]
        self.o += 4
        return v

    def i32(self):
        self.need(4)
        v = struct.unpack_from('<i', self.b, self.o)[0]
        self.o += 4
        return v

    def f32(self, n=None):
        k = n or 1
        self.need(4 * k)
        v = struct.unpack_from('<%df' % k, self.b, self.o)
        self.o += 4 * k
        return [_r(x) for x in v] if n else _r(v[0])

    def f64(self):
        self.need(8)
        v = struct.unpack_from('<d', self.b, self.o)[0]
        self.o += 8
        return _r(v, 6)

    def guid(self):
        """two 8-byte halves (0x59e5a0 twice) = a GUID; returned in the editor's letter form"""
        self.need(16)
        v = guid_str(self.b[self.o:self.o + 16])
        self.o += 16
        return v

    def tag(self):
        """4 raw bytes: an editor label or a four-character code"""
        self.need(4)
        v = self.b[self.o:self.o + 4]
        self.o += 4
        return _fourcc(v)

    def s(self):
        n = self.u32()
        self.need(n)
        raw = self.b[self.o:self.o + n].split(b'\0')[0]
        self.o += n
        return text(raw)


def _r(v, n=5):
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return round(v, n)


def _fourcc(b):
    return b.split(b'\0')[0].decode('latin1')


def _cc(v):
    """a u32 that holds a four-character code ('CHTR', 'HndR', 'def') -> the text, else the number"""
    b = struct.pack('<I', v)
    t = b.split(b'\0')[0]
    if t and all(32 < c < 127 for c in t) and b[len(t):].strip(b'\0') == b'':
        return t.decode('latin1')
    return v


def _heading(q):
    return _r(-2 * math.atan2(q[2], q[3]), 5)


def _i(v):
    """a stored -1 (u32 0xffffffff) as -1"""
    return v - (1 << 32) if v >= 1 << 31 else v


def _tristate(v):
    return {0: False, 1: True}.get(v, None if v == 2 else v)


# ---------------------------------------------------------------- items: the common header
def _item_head(a, typ, cls):
    """CItem::Serialize 0x502170: u32 version, GUID, f32 start, f32 length, (version >= 1) char[4] tag"""
    v = a.u32()
    d = {'type': typ, 'class': cls, 'tag': '', 'guid': a.guid(), 'start': a.f32(), 'length': a.f32()}
    if v >= 1:
        d['tag'] = a.tag()
    if v != 1:
        d['item_version'] = v
    return d


def _ver(a, d, known):
    v = a.u32()
    if v not in known:
        raise SeqError('%s version %d not handled (offset %d)' % (d['class'], v, a.o - 4))
    if v != max(known):
        d['version'] = v
    return v


def _shake_axis(a):
    """0x509f60: u32 version 0, f32 amplitude, f32 frequency, u8 flag"""
    a.u32()
    return {'amplitude': a.f32(), 'frequency': a.f32(), 'flag': a.u8()}


# ---------------------------------------------------------------- global items (sequence timeline, factory 0x52c810)
def _g_daytime(a, d):
    """ItemDayTime 0x50a950 (written as version 4); start: TimeMgr SetDayTime(time) + weather 0x4f7ce0/d10/d40"""
    v = _ver(a, d, (0, 1, 2, 3, 4))
    if v == 0:
        a.u32()
        d['time_of_day'] = a.f32()
        d['legacy'] = [a.u32(), a.u32(), a.u32()]
        return
    d['time_of_day'] = a.f32()                  # seconds after midnight (46800 = 13:00)
    w = {}
    if v >= 2:
        w['type'] = a.u32()                     # WeatherManager +0x24; 0 = weather off, 1 snow, 2 rain
    if v >= 3:
        w['intensity'] = a.u32()                # percent (/100 -> WeatherManager +0x40)
    if v >= 4:
        w['draw'] = bool(a.u8())                # WeatherManager "Draw"
    d['weather'] = w


def _g_cut(a, d):
    """ItemCut 0x50a3d0: no data. On start (0x50a570) a cut with a length > 0 jumps the playback over its range
    (sequence time offset +0xa0 and the client clock advance by the length)"""
    _ver(a, d, (0,))


def _g_bmp(a, d):
    """ItemBmp 0x507bb0: an overlay picture (CFXSeqFilterBitmap)"""
    v = _ver(a, d, (0, 1))
    d['mode'] = a.u32()
    d['path'] = a.s()                           # below Data/Base/Gfx (e.g. Sequence/4030/Scope.dds)
    if v == 0:
        d['legacy'] = [a.u32(), a.u32()]
    else:
        d['params'] = [a.u32(), a.f32(), a.u32(), a.u32()]   # raw (0x40 .. 0x4c); see open points


def _g_camfx(a, d):
    """ItemCamFX (tag CaFX; class of the ItemCamera unit, vtable 0x85afa0) 0x508bd0: camera shake.
    Per frame (0x508660): for every axis whose bit is set, offset += amplitude * f(time * frequency)"""
    v = _ver(a, d, (0, 1))
    if v >= 1:
        d['mode'] = a.u32()
        d['axis_mask'] = a.u32()                # bit 0, 1, 2 = shake[0], [1], [2] active
        d['shake'] = [_shake_axis(a) for _ in range(3)]


def _g_particle(a, d):
    """ItemParticle 0x512000: a particle effect at a fixed place for the item's length"""
    v = _ver(a, d, (0, 1, 2))
    d['path'] = a.s()                           # effect class, e.g. Particle/FX/Blood/fx_blood_sprinkle_02
    d['pos'] = a.f32(3)
    if v >= 1:
        d['q'] = a.f32(4)
    if v >= 2:
        d['flags'] = a.u32()


def _g_fading(a, d):
    """ItemFading 0x50b5d0; start 0x50b720: 0 -> fade in from black (0x523b30), 1 -> fade out to black (0x523bf0),
    over the item's length"""
    _ver(a, d, (0,))
    x = a.u32()
    d['direction'] = {0: 'in', 1: 'out'}.get(x, x)


def _g_timefactor(a, d):
    """ItemTimeFactor 0x51a580 (no file uses it)"""
    _ver(a, d, (0,))
    d['factor'] = a.f32()


def _g_widescreen(a, d):
    """ItemWideScreen 0x51dbb0; start 0x51dd10: 0 -> letterbox bars in (0x523a00), 1 -> bars out (0x523a20)"""
    _ver(a, d, (0,))
    x = a.u32()
    d['bars'] = {0: 'on', 1: 'off'}.get(x, x)


def _g_light(a, d):
    """ItemLight 0x50e320 (no file uses it): raw values in the client's order"""
    _ver(a, d, (0,))
    d['mode'] = a.u32()                         # +0x4c
    d['pos'] = a.f32(3)                         # +0x30
    d['color'] = a.f32(4)                       # +0x3c
    d['params'] = [a.u32() for _ in range(3)] + a.f32(6)   # +0x50 .. +0x70


def _g_bink(a, d):
    """ItemBink 0x506e70: a pre-rendered film (Data/locale/<lang>/Video/<file>)"""
    _ver(a, d, (0,))
    d['file'] = a.s()


def _g_text(a, d):
    """ItemText 0x519620: a text on the screen (the film wrappers' captions)"""
    _ver(a, d, (0,))
    d['mode'] = a.u32()
    d['font'] = a.s()
    d['size'] = a.u32()                         # +0x3c
    d['p40'] = a.u32()                          # +0x40 (5 in every file)
    d['p44'] = a.u32()                          # +0x44
    d['text'] = a.s()
    d['x'] = a.u32()                            # +0x50 screen position (pixels of a 1024 x 768 screen?)
    d['y'] = a.u32()                            # +0x54
    d['p48'] = a.u32()                          # +0x48


def _g_sound(a, d):
    """ItemSound 0x517ce0; start 0x517e60: a sound below /Data/Base/Audio/, 2D unless 'positional'"""
    _ver(a, d, (0,))
    d['positional'] = bool(a.u32())             # +0x30: 0 = plain (2D) sound, else at 'pos'
    d['pos'] = a.f32(3)
    d['path'] = a.s()
    d['volume'] = a.u32()                       # percent
    d['loop'] = bool(a.u8())


GLOBAL_ITEMS = {        # type id -> (class, reader); the factory switch of 0x52c810 (jump table 0x52caa4)
    1: ('ItemDayTime', _g_daytime),
    2: ('ItemCut', _g_cut),
    3: ('ItemText', _g_text),           # obsolete id: read as an ItemText and dropped by the loader (0x52ca09)
    4: ('ItemBmp', _g_bmp),
    5: ('ItemCamFX', _g_camfx),
    6: ('ItemParticle', _g_particle),
    7: ('ItemFading', _g_fading),
    8: ('ItemTimeFactor', _g_timefactor),
    9: ('ItemWideScreen', _g_widescreen),
    10: ('ItemLight', _g_light),
    11: ('ItemBink', _g_bink),
    12: ('ItemText', _g_text),
    13: ('ItemSound', _g_sound),
}


def _global_item(a, typ):
    if typ not in GLOBAL_ITEMS:
        raise SeqError('unknown sequence item type %d at byte %d' % (typ, a.o - 4))
    cls, fn = GLOBAL_ITEMS[typ]
    d = _item_head(a, typ, cls)
    fn(a, d)
    if typ == 3:
        d['dropped'] = True
    return d


def _camera_cut(a):
    """ItemCamera (main track) 0x508b80: u32 version 0, the GUID of the camera object shown from 'start' on"""
    d = _item_head(a, 0, 'ItemCamera')
    _ver(a, d, (0,))
    d['camera'] = a.guid()
    return d


# ---------------------------------------------------------------- actor items (factory 0x4ff540, jump table 0x5000f0)
def _path(a):
    """the key-framed path of walk / vis-path items 0x56fa60: u32 version 1, u32, f64 start, f64 end,
    position keys {u16 frame, vec3}, rotation keys {u16 frame, quaternion}; frame / 50 = seconds"""
    v = a.u32()
    if v != 1:
        raise SeqError('path version %d not handled' % v)
    d = {'mode': a.u32(), 'start': a.f64(), 'end': a.f64()}
    d['pos'] = [{'t': _r(a.u16() / KEY_RATE, 4), 'v': a.f32(3)} for _ in range(a.u32())]
    d['rot'] = [{'t': _r(a.u16() / KEY_RATE, 4), 'q': a.f32(4)} for _ in range(a.u32())]
    return d


def _a_anim(a, d):
    """ItemAnim 0x5042a0; apply 0x5040e0 queues the animation (0x7a9ef0, 25 frames/s)"""
    _ver(a, d, (0,))
    d['anim'] = a.s()
    d['repeat'] = a.u32()                       # +0x34: times the frame range is played (0 = hold)
    d['first_frame'] = a.u32()                  # +0x38
    d['last_frame'] = a.u32()                   # +0x3c (inclusive)


def _a_vispath(a, d):
    """ItemVisPath 0x51ac60: a recorded movement (position / rotation keys) the actor follows"""
    v = _ver(a, d, (1,))
    if v >= 1:
        d['path'] = _path(a)


def _a_animact(a, d):
    """ItemAnimAct 0x504f70; apply 0x504b00: an action animation with loop markers (the GSF's loop start / end):
    intro (flag 1), the loop part 'loops' times, outro (flag 2); without markers the whole clip 'loops' times"""
    _ver(a, d, (0,))
    d['anim'] = a.s()
    d['loops'] = a.u32()                        # +0x34
    f = a.u32()                                 # +0x38
    d['intro'] = bool(f & 1)
    d['outro'] = bool(f & 2)
    if f & ~3:
        d['flags'] = f


def _a_rotact(a, d):
    """ItemRotAct 0x516f00: turn on the spot (computed by the server like a walk, see ItemWalkAct)"""
    _ver(a, d, (0,))
    d['mode'] = a.u32()                         # +0x30 (4 in every file)
    d['angle'] = a.f32()                        # +0x34, radians


def _a_walkact(a, d):
    """ItemWalkAct 0x51c040: walk through waypoints. The client sends the request to the server at load time
    (0x51c440 -> message), the server's CSeqEdActCalculator (PWServer 0x464ed0) runs the unit's real walk action and
    returns the motion and the walk animations that are played back (0x51d190)"""
    v = _ver(a, d, (0, 1, 2, 3))
    f = a.u32()                                 # +0x90
    d['single_target'] = bool(f & 1)            # bit 0: one target point instead of the waypoint list (unused)
    d['walk_flag'] = bool(f & 2)                # bit 1: the walk keeps to the terrain (0x489fc0)
    if v >= 2:
        d['walkset'] = _cc(a.u32())             # +0x94: the GSF walk set: 'def', 'hump', 'cary' ...
    if v >= 3:
        d['speed'] = a.u32()                    # +0x98: 1 slowest .. 4 run (as the trigger walk actions)
    if v >= 1:
        d['path'] = _path(a)                    # the waypoints (position keys; their times are the editor's)


def _a_lipsync(a, d):
    """ItemLipSync 0x510b80; start 0x510db0: plays <lsd path minus extension>.mp3 and shows the subtitle
    '_seq_' + lsd file name without '.lsd' (or the stored key when 'is_key') from Texts/sequences_<lang>.ltf
    (looked up without regard to case: the table's keys are lower case)"""
    v = _ver(a, d, (0, 2, 3))
    d['lsd'] = a.s()
    if v >= 3:
        d['is_key'] = bool(a.u8())
    lsd = d['lsd'].replace('\\', '/')
    if '/music/' in lsd.lower():
        d['music'] = True                       # the sequence's music track (SeqSounds/music/NS_<id>): no subtitle
    if d.get('is_key'):
        d['subtitle_key'] = lsd
    else:
        base = lsd.rsplit('/', 1)[-1]
        d['speech'] = lsd[:-3] + 'mp3' if lsd.lower().endswith('.lsd') else lsd
        d['subtitle_key'] = '_seq_' + (base[:-4] if base.lower().endswith('.lsd') else base)


def _a_link(a, d):
    _ver(a, d, (0,))
    d['links'] = _links(a)


def _links(a):
    """0x510780: u32 n + n x {u32 op, u32 slot (four-character code), string}"""
    out = []
    for _ in range(a.u32()):
        op, slot, s = a.u32(), _cc(a.u32()), a.s()
        out.append({'op': op, 'slot': slot, 'object': s})
    return out


def _a_attr(a, d):
    """ItemAttr 0x505f20 (version first, the item header only from version 1); start 0x5056a0: sets object
    attributes, then three switches 0 / 1 / 2 (= leave) applied to the actor's object"""
    v = d.pop('_attr_version')
    if v != 1:
        d['version'] = v
    d['attributes'] = [{'op': a.u32(), 'key': a.s(), 'value': a.s()} for _ in range(a.u32())]
    sw = [a.u32() for _ in range(3)]
    d['hidden'] = _tristate(sw[0])              # 1 -> object byte +0x98 = 0 (not drawn), 0 -> 0xff
    d['not_hitable'] = _tristate(sw[1])         # object flag 2 (0x569ef0)
    d['not_selectable'] = _tristate(sw[2])      # object flag 1


def _flags_body(a, d):
    """0x50d1c0: u32 version 1, (>= 1) u32, the mesh-part / flag list, u32, u32"""
    v = a.u32()
    if v >= 1:
        d['set'] = a.u32()                      # +0x8
    d['parts'] = [{'op': a.u32(), 'name': a.s(), 'mask': a.u32(), 'mask2': a.u32(), 'state': a.u32()}
                  for _ in range(a.u32())]
    d['p0c'] = _i(a.u32())
    d['p10'] = _i(a.u32())


def _a_faceexpr(a, d):
    """ItemFaceExpr 0x50b040"""
    _ver(a, d, (0,))
    d['expression'] = a.u32()


def _a_resetcloth(a, d):
    """ItemResetCloth 0x516bb0: no data (resets the cloth simulation of the model)"""
    _ver(a, d, (0,))


def _a_beam(a, d):
    """ItemBeam 0x5064f0: teleport the actor"""
    _ver(a, d, (0,))
    d['pos'] = a.f32(3)
    d['q'] = a.f32(4)
    d['heading'] = _heading(d['q'])


ACTOR_ITEMS = {         # type id -> (class, reader)
    0: ('ItemAnim', _a_anim),
    1: ('ItemVisPath', _a_vispath),
    2: ('ItemAnimAct', _a_animact),
    3: ('ItemRotAct', _a_rotact),
    4: ('ItemWalkAct', _a_walkact),
    5: ('ItemLipSync', _a_lipsync),
    6: ('ItemLink', _a_link),
    7: ('ItemAttr', _a_attr),
    8: ('ItemFlags', None),
    9: ('ItemFaceExpr', _a_faceexpr),
    10: ('ItemResetCloth', _a_resetcloth),
    11: ('ItemBeam', _a_beam),
}


def _actor_item(a, typ):
    if typ not in ACTOR_ITEMS:
        raise SeqError('unknown actor item type %d at byte %d' % (typ, a.o - 4))
    cls, fn = ACTOR_ITEMS[typ]
    if typ in (7, 8):
        # ItemAttr 0x505f20 / ItemFlags 0x50dd70: the class version comes first, the item header only if >= 1
        v = a.u32()
        d = _item_head(a, typ, cls) if v >= 1 else {'type': typ, 'class': cls}
        if typ == 7:
            d['_attr_version'] = v
            _a_attr(a, d)
        else:
            if v != 1:
                d['version'] = v
            _flags_body(a, d)
        return d
    d = _item_head(a, typ, cls)
    fn(a, d)
    return d


# ---------------------------------------------------------------- actors
def _actor_desc(a):
    """the actor's object 0x4fbc90: u32 version 2, GUID, name, class, (>= 1) u32 type, (>= 2) attributes"""
    v = a.u32()
    d = {'guid': a.guid(), 'name': a.s(), 'class': a.s()}
    if v >= 1:
        d['type'] = _cc(a.u32())
    if v >= 2:
        d['attributes'] = {}
        for _ in range(a.u32()):
            k = a.s()
            d['attributes'][k] = a.s()
    return d


def _binding(a):
    """0x4fbf30: how the actor finds its world object when the GUID does not (0x52bea0): u32 version 0, region,
    class, owner, level, name"""
    a.u32()
    return {'region': a.s(), 'class': a.s(), 'owner': _i(a.u32()), 'level': _i(a.u32()), 'name': a.s()}


def _link_node(a):
    """0x4feb10: u32 version 1, GUID, class, vec3, u32, u8, child links, (>= 1) u32"""
    v = a.u32()
    d = {'guid': a.guid(), 'class': a.s(), 'offset': a.f32(3), 'p20': _i(a.u32()), 'p24': a.u8(),
         'children': _link_list(a)}
    if v >= 1:
        d['p28'] = _i(a.u32())
    return d


def _link_list(a):
    """0x501000: u32 n + n x 0x500120 {u32 version 1, u32 op, u32 slot, model, node, (>= 1) string}"""
    out = []
    for _ in range(a.u32()):
        v = a.u32()
        e = {'op': a.u32(), 'slot': _cc(a.u32()), 'model': a.s(), 'node': _link_node(a)}
        if v >= 1:
            e['extra'] = a.s()
        out.append(e)
    return out


def _actor_state(a):
    """0x4febc0 (actor +0x234): the pose and look the actor starts the sequence with"""
    v = a.u32()
    d = {'pos': a.f32(3)}
    q = a.f32(4)
    d['q'] = q
    d['heading'] = _heading(q)
    d['p20'] = a.u32()                          # 255 in every file
    d['object_flags'] = a.u32()                 # +0x24
    d['part_mask'] = a.u32()                    # +0x28
    d['scale'] = a.f32()                        # +0x2c (1.0)
    d['p30'] = _i(a.u32())
    d['attachments'] = _link_list(a)            # +0x38: models on link slots ('HndR' -> 'cole_machete')
    if v >= 1:
        d['p34'] = _i(a.u32())
    return d


def _actor(a, ver):
    """one actor of 0x52d3a0 (read path 0x52dc24 ff., version > 5)"""
    d = _actor_desc(a)
    if ver >= 9:
        d['binding'] = _binding(a)
    size = a.u32()
    o0 = a.o
    v = a.u32()                                 # 0x4ff540, written as 13
    if v not in (2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13):
        raise SeqError('actor block version %d not handled' % v)
    if v != 13:
        d['block_version'] = v
    d['items'] = [_actor_item(a, a.u32()) for _ in range(a.u32())]
    if 3 <= v <= 5:
        raise SeqError('actor block version %d (pre-release layout) not handled' % v)
    if v >= 4:
        d['flags'] = _actor_item(a, 8)          # the embedded ItemFlags (+0x2d0): the start state
        d['links'] = _actor_item(a, 6)          # the embedded ItemLink (+0x318)
    if v >= 5:
        b2 = _binding(a)
        if b2 != d.get('binding'):
            d['binding2'] = b2
    if 6 <= v <= 11:
        d['legacy_pose'] = a.f32(7)
    if 7 <= v < 13:
        d['legacy_260'] = a.u32()
    if 8 <= v < 13:
        d['legacy_264'] = a.u32()
    if v >= 9:
        d['p534'] = a.u32()
    if 10 <= v < 13:
        d['legacy_258'] = a.u32()
    if v >= 11:
        d['state'] = _actor_state(a)
    if a.o - o0 != size:
        raise SeqError('actor %s: block of %d bytes, %d read' % (d['name'], size, a.o - o0))
    return d


# ---------------------------------------------------------------- cameras
def _spline_key(a):
    """0x43b4e0: u16 frame, (archive version >= 4) u32 interpolation, f32 x3 (tension/scale, continuity, bias),
    (>= 0x12) f32 x3 (ease)"""
    k = {'t': _r(a.u16() / KEY_RATE, 4)}
    if a.version >= 4:
        k['interp'] = a.u32()
        k['tcb'] = a.f32(3)
    if a.version >= 0x12:
        k['ease'] = a.f32(3)
    return k


def _spline(a):
    """the camera curve 0x43b220: f64 start, f64 end (-1 = not computed), position, rotation and fov keys"""
    d = {'start': a.f64(), 'end': a.f64()}
    pos = []
    for _ in range(a.u32()):
        k = _spline_key(a)
        k['v'] = a.f32(3)
        pos.append(k)
    rot = []
    for _ in range(a.u32()):
        k = _spline_key(a)
        k['q'] = a.f32(4)
        rot.append(k)
    fov = []
    for _ in range(a.u32()):
        k = _spline_key(a)
        k['fov'] = a.f32()
        fov.append(k)
    d['pos'], d['rot'], d['fov'] = pos, rot, fov
    return d


def _cam_object(a):
    """0x56a720: an eye or target object of a camera"""
    d = {'p08': a.u32(), 'p0c': a.u32(), 'p10': a.u8(), 'pos': a.f32(3), 'q': a.f32(4), 'name': a.s(),
         'guid': a.guid(), 'p90': a.u32(), 'p5c': a.u32(), 'p94': _i(a.u32()), 'p98': a.u8()}
    return d


def _camera(a):
    """SeqCamera 0x51e830 (u32 version 3) with its camera object 0x4791f0"""
    v = a.u32()
    d = {'editor_pos': a.f32(3), 'editor_q': a.f32(4)}
    if v >= 1:
        d['fov'] = a.f32()                      # radians
    d['spline'] = _spline(a)
    ov = a.u32()
    o = {'p18': _i(a.u32()), 'name': a.s(), 'p98': a.u32(), 'guid': a.guid()}
    o['eye'] = _cam_object(a)
    if ov >= 1:
        o['target'] = _cam_object(a)
    if v >= 2:
        d['pa0'] = a.u8()
    if v >= 3:
        d['pa4'] = a.u32()
    cam = {'guid': o['guid'], 'name': o['name'], 'fov': d.get('fov'),
           'eye': {'pos': o['eye']['pos'], 'q': o['eye']['q'], 'heading': _heading(o['eye']['q'])}}
    if 'target' in o:
        cam['target'] = {'pos': o['target']['pos']}
    cam['spline'] = d['spline']
    cam['editor'] = {'pos': d['editor_pos'], 'q': d['editor_q']}
    cam['raw'] = {k: o[k] for k in ('p18', 'p98')}
    cam['raw'].update({'eye': {k: v_ for k, v_ in o['eye'].items() if k[0] == 'p' or k in ('name', 'guid')}})
    if 'target' in o:
        cam['raw']['target'] = {k: v_ for k, v_ in o['target'].items() if k[0] == 'p' or k in ('name', 'guid')}
    for k in ('pa0', 'pa4'):
        if k in d:
            cam['raw'][k] = d[k]
    return cam


# ---------------------------------------------------------------- region
def _region(a):
    """0x57d660: a region record like the map's Rgns ones: u32 flags, GUID, name, u32 colour, shapes, (flags & 0x40)
    note"""
    fl = a.u32()
    d = {'flags': fl, 'guid': a.guid(), 'name': a.s(), 'color': '%08x' % a.u32(), 'shapes': []}
    for _ in range(a.u32()):
        t = a.u32()
        a.u32()
        x, y, z = a.f32(3)
        w, h, dz = a.f32(3)
        d['shapes'].append({'type': SHAPES.get(t & 0xff, str(t & 0xff)), 'flags': t >> 24, 'x': x, 'y': y, 'z': z,
                            'w': w, 'h': h, 'd': dz})
    if fl & 0x40:
        d['note'] = a.s()
    return d


# ---------------------------------------------------------------- the sequence
SEQ_FLAGS = (
    (0x2, 'flag_02'),               # +0x7c bit 1 (versions 8 - 18 stored it as a byte)
    (0x4, 'hide_region_objects'),   # 0x52b931: hide the world objects inside the SeqRegion while it plays
    (0x8, 'mp3_speech'),            # set by the loader for files older than version 21 (0x52d5e4); LipSync -> .mp3
)


def _sequence(a):
    pre = a.u32()                               # read and ignored by the file loader 0x530f70
    v = a.u32()                                 # 0x52d3cc; the client writes 21
    a.version = v
    doc = {'schema': SCHEMA, 'version': v}
    if pre:
        doc['prefix'] = pre
    doc['name'] = a.s()
    length = a.f64()                            # +0xa8
    start = end = 0.0
    if v > 0:
        start, end = a.f64(), a.f64()           # +0x90, +0x98: the played part (end 0 = the whole timeline)
    doc['timeline'] = {'length': length, 'start': start, 'end': end,
                       'duration': _r(end - start, 4) if end > start else length}
    if v == 2:
        doc['legacy_v2'] = a.u32()
    # main track 0x52c5f0: the camera cuts
    tv = a.u32()
    doc['camera_track'] = [_camera_cut(a) for _ in range(a.u32())]
    if tv != 1:
        doc['camera_track_version'] = tv
    doc['items'] = []
    if v >= 3:
        # 0x52c810: u32 version, u32 n, n x {u32 type, item}, (version >= 1) the sequence's ItemDayTime
        gv = a.u32()
        for _ in range(a.u32()):
            it = _global_item(a, a.u32())
            doc['items'].append(it)
        if gv >= 1:
            doc['day_time'] = _global_item(a, 1)
    if v >= 7:
        doc['region'] = _region(a)
    flags = 0
    if 8 <= v <= 0x12:
        flags |= 2 if a.u8() else 0
    if 0xb <= v <= 0xd:
        doc['legacy_b'] = a.u8()
    if v >= 0xe:
        doc['audio_mode'] = a.u32()             # +0x128: 2 = game (0x52a180 maps it to 1 in the game), 1
    if 0xf <= v <= 0x12:
        doc['legacy_f'] = a.u8()
    if v >= 0x11:
        doc['vec_b0'] = a.f32(3)                # +0xb0 (see open points)
    if v >= 0x13:
        flags = a.u32()
        if v < 0x15:
            flags |= 8                          # 0x52d5e4
    doc['flags'] = {'raw': flags}
    for bit, name in SEQ_FLAGS:
        doc['flags'][name] = bool(flags & bit)
    if flags & 1:
        doc['flags']['flag_01'] = True
    if v >= 0x14:
        # an object the sequence creates / uses (0x52d6cb): class, GUID, position, rotation (empty in every file)
        doc['anchor'] = {'class': a.s(), 'guid': a.guid(), 'pos': a.f32(3), 'q': a.f32(4)}
    # actors 0x52da29
    n = a.u32()
    if v >= 0x10:
        doc['actor_guids'] = [a.guid() for _ in range(a.u32())]
    if v <= 5 and n:
        raise SeqError('actors of sequence version %d not handled' % v)
    doc['actors'] = [_actor(a, v) for _ in range(n)]
    # cameras 0x52e072
    doc['cameras'] = [_camera(a) for _ in range(a.u32())]
    if v >= 0xc:
        f = a.f32(13)                           # 0x6c09c0: the editor's view when the file was saved
        doc['editor_camera'] = {'eye': f[0:3], 'look_at': f[3:6], 'up': f[6:9], 'fov': f[9], 'aspect': f[10],
                                'near': f[11], 'far': f[12]}
    return doc


def _bytes(src):
    if isinstance(src, (bytes, bytearray)):
        b = bytes(src)
    else:
        with open(src, 'rb') as f:
            b = f.read()
    if b[:2] == b'\x1f\x8b':
        b = gzip.decompress(b)
    return b


def read_seq(src):
    """a .seq file (path, gzip bytes or the unpacked bytes) -> the pw-seq/1 document; raises SeqError when the data
    does not decode to its last byte"""
    b = _bytes(src)
    a = _Arc(b)
    try:
        doc = _sequence(a)
    except struct.error as e:
        raise SeqError('%s at byte %d' % (e, a.o))
    if a.o != len(b):
        raise SeqError('%d bytes left after byte %d' % (len(b) - a.o, a.o))
    if not isinstance(src, (bytes, bytearray)):
        doc['file'] = str(src).replace('\\', '/')
    doc['size'] = len(b)
    return doc


# ---------------------------------------------------------------- summaries
def speech(doc):
    """[{actor, t, length, lsd, speech, subtitle_key}] in time order - what campaign.sequence() needs"""
    out = []
    for ac in doc['actors']:
        for it in ac['items']:
            if it['class'] == 'ItemLipSync':
                out.append({'actor': ac['name'], 't': it['start'], 'length': it['length'], 'lsd': it['lsd'],
                            'speech': it.get('speech'), 'subtitle_key': it['subtitle_key']})
    return sorted(out, key=lambda e: e['t'])


def summary(doc):
    counts = {}
    for it in doc['items']:
        counts[it['class']] = counts.get(it['class'], 0) + 1
    for ac in doc['actors']:
        for it in ac['items']:
            counts[it['class']] = counts.get(it['class'], 0) + 1
    return {'duration': doc['timeline']['duration'], 'actors': len(doc['actors']), 'cameras': len(doc['cameras']),
            'cuts': len(doc['camera_track']), 'items': counts}


def find_files(root):
    """every .seq below root (a ParaWorld folder: Data/Base/Sequences and Data/locale/*/Sequences)"""
    out = []
    for dp, dn, fn in os.walk(root):
        dn.sort()
        for f in sorted(fn):
            if f.lower().endswith('.seq'):
                out.append(os.path.join(dp, f))
    return out


def check(paths, log=print):
    """decode every file; returns (ok, failed) and prints one line per file"""
    ok, bad = 0, []
    for p in paths:
        try:
            d = read_seq(p)
        except (SeqError, OSError, EOFError, ValueError) as e:
            bad.append((p, str(e)))
            log('FAIL %s: %s' % (p, e))
            continue
        ok += 1
        s = summary(d)
        log('ok   %-70s v%d %7d bytes %6.2f s %3d actors %3d cameras %4d items' % (
            p[-70:], d['version'], d['size'], s['duration'], s['actors'], s['cameras'], sum(s['items'].values())))
    log('%d of %d files decoded to the last byte' % (ok, len(paths)))
    return ok, bad


def main(argv=None):
    import argparse
    ap = argparse.ArgumentParser(prog='python -m pwexport.seq',
                                 description='ParaWorld cutscene files (.seq) as JSON (schema %s)' % SCHEMA)
    ap.add_argument('path', help='a .seq file, or a folder (every .seq below it)')
    ap.add_argument('--json', help='write the JSON here (a folder: one document per file, keyed by path)')
    ap.add_argument('--check', action='store_true', help='decode every file and report the consumption')
    ap.add_argument('--compact', action='store_true', help='JSON without indentation')
    a = ap.parse_args(argv)
    paths = find_files(a.path) if os.path.isdir(a.path) else [a.path]
    if a.check:
        ok, bad = check(paths)
        return 0 if not bad else 1
    if len(paths) == 1 and not os.path.isdir(a.path):
        doc = read_seq(paths[0])
    else:
        doc = {'schema': SCHEMA, 'files': {os.path.relpath(p, a.path).replace('\\', '/'): read_seq(p) for p in paths}}
    ind = None if a.compact else 1
    if a.json:
        with open(a.json, 'w', encoding='utf-8') as f:
            json.dump(doc, f, ensure_ascii=False, indent=ind)
        print('%d file(s) -> %s' % (len(paths), a.json))
    else:
        import sys
        json.dump(doc, sys.stdout, ensure_ascii=False, indent=ind)
        print()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
