"""Blender properties for every GSF parameter.

The property groups of chunks, animation chunks, bones, materials, model infos ... are GENERATED from the schema
structs of the core library (core/schema.py): every field that is not derived (counts, offsets, indices of other
chunks) becomes an editable property with the field's description as tooltip. A new chunk type registered in the core
gets its properties and panel without any change here.

Values are moved between the core objects and the property groups with `to_props` / `from_props`.
"""
import bpy
from bpy.props import (BoolProperty, BoolVectorProperty, CollectionProperty, EnumProperty, FloatProperty,
                       FloatVectorProperty, IntProperty, IntVectorProperty, PointerProperty, StringProperty)
from bpy.types import PropertyGroup

from ..core.chunks import KINDS
from ..core.chunks.skeleton import BONE
from ..core.chunks.anims import TRACK_FORMATS
from ..core.materials import MATERIAL
from .space import MIRRORS as MIRROR_ITEMS
from ..core.archive import MODEL_INFO, COLLISION, SOUND, ANIM_INFO, HEADER2, MATERIALS_HEADER

# fields that are not shown as properties because the Blender object itself holds them
COMMON = {'attributes', 'guid'}
HIDDEN = {
    'billboard': {'material', 'bounding_box'},        # material = the object's material slot
    'bone_anim': {'num_anim_frames'},                  # -> action .frames
    'speedline': {'tile_material'},                    # -> container .material
    'model': {'fourcc_', 'bounding_box'},
}

_generated = []          # classes created here, registered in order


def hexs(v):
    return '0x%08X' % (int(v) & 0xFFFFFFFF)


def parse_hex(s, default=0):
    try:
        return int(str(s).strip(), 0) & 0xFFFFFFFF
    except (ValueError, TypeError):
        return default


def _enum_items(field):
    return [(ident, ident.replace('_', ' ').title(), desc, i) for i, (val, ident, desc) in enumerate(field.items)]


def _prop_for(field):
    d = field.doc or field.name
    k = field.kind
    if field.items:
        items = _enum_items(field)
        default = next((it[0] for it, (val, _, _) in zip(items, field.items) if val == field.default), items[0][0])
        return EnumProperty(name=field.name, description=d, items=items, default=default)
    if k == 'u8':
        return IntProperty(name=field.name, description=d, min=0, max=255, default=int(field.default))
    if k == 'u16':
        return IntProperty(name=field.name, description=d, min=0, max=65535, default=int(field.default))
    if k == 's16':
        return IntProperty(name=field.name, description=d, min=-32768, max=32767, default=int(field.default))
    if k == 'u32':
        return IntProperty(name=field.name, description=d, min=0, max=2 ** 31 - 1, default=int(field.default))
    if k == 's32':
        return IntProperty(name=field.name, description=d, default=int(field.default))
    if k == 'hex32':
        return StringProperty(name=field.name, description=d + ' (hexadecimal)', default=hexs(field.default))
    if k == 'attr':
        return BoolVectorProperty(name=field.name, description=d, size=32)
    if k == 'f32':
        return FloatProperty(name=field.name, description=d, default=float(field.default), precision=5)
    if k in ('vec3', 'quat', 'bbox', 'mat4'):
        n = {'vec3': 3, 'quat': 4, 'bbox': 6, 'mat4': 16}[k]
        return FloatVectorProperty(name=field.name, description=d, size=n, default=tuple(field.default), precision=5)
    if k == 'u8x4':
        return IntVectorProperty(name=field.name, description=d, size=4, min=0, max=255, default=tuple(field.default))
    if k == 'str4':
        return StringProperty(name=field.name, description=d, maxlen=5, default=field.default)
    raise ValueError(k)


def ui_fields(struct, kind=None, ctx=None):
    """the fields of `struct` that get a property"""
    hide = COMMON | HIDDEN.get(kind, set())
    return [f for f in struct.fields if f.editable and not f.xform and f.name not in hide
            and (ctx is None or f.present(ctx))]


def make_group(class_name, struct, kind=None, extra=None):
    ann = {}
    for f in ui_fields(struct, kind):
        ann[f.name] = _prop_for(f)
    if extra:
        ann.update(extra)
    cls = type(class_name, (PropertyGroup,), {'__annotations__': ann, '__module__': __name__})
    cls.STRUCT = struct
    cls.KIND = kind
    _generated.append(cls)
    return cls


# ------------------------------------------------------------------------------------------- value conversion
def to_props(pg, struct, values, kind=None):
    """core values -> property group"""
    for f in ui_fields(struct, kind):
        if f.name not in values:
            continue
        v = values[f.name]
        try:
            if f.items:
                ident = next((ident for val, ident, _ in f.items if val == v), None)
                if ident is None:
                    continue
                setattr(pg, f.name, ident)
            elif f.kind == 'hex32':
                setattr(pg, f.name, hexs(v))
            elif f.kind == 'attr':
                setattr(pg, f.name, [bool(v >> i & 1) for i in range(32)])
            elif f.kind == 'u32':
                setattr(pg, f.name, min(int(v), 2 ** 31 - 1))
            elif f.kind in ('vec3', 'quat', 'bbox', 'mat4', 'u8x4'):
                setattr(pg, f.name, tuple(v))
            else:
                setattr(pg, f.name, v)
        except (TypeError, ValueError, OverflowError) as e:
            print('GSF: cannot set %s.%s = %r (%s)' % (struct.name, f.name, v, e))


def from_props(pg, struct, values, kind=None, ctx=None):
    """property group -> core values (updates `values` in place)"""
    for f in ui_fields(struct, kind, ctx):
        v = getattr(pg, f.name)
        if f.items:
            v = next((val for val, ident, _ in f.items if ident == v), f.default)
        elif f.kind == 'hex32':
            v = parse_hex(v, f.default)
        elif f.kind == 'attr':
            v = bits_to_int(v)
        elif f.kind in ('vec3', 'quat', 'bbox', 'mat4', 'u8x4'):
            v = tuple(v)
        values[f.name] = v
    return values


def bits_to_int(bits):
    r = 0
    for i, b in enumerate(bits):
        if b:
            r |= 1 << i
    return r


def int_to_bits(v):
    return [bool(int(v) >> i & 1) for i in range(32)]


# --------------------------------------------------------------------------------------------- chunk groups
def _variant_label(kind, ctx):
    if kind == 'mesh':
        base = 'Cloth' if ctx['cloth'] else 'Mesh'
        return base + {0: '', 1: ', skinned per vertex', 2: ', bound to bones (simple skin)'}[ctx['skin']]
    if 'skinned' in ctx:
        return 'Skinned (moves with bones)' if ctx['skinned'] else 'Static'
    return 'Default'


CHUNK_GROUPS = {}        # kind -> PropertyGroup class
ANIM_GROUPS = {}

for _kind, _cls in sorted(KINDS.items()):
    if _cls.IS_ANIM:
        continue
    _items = [(hexs(t), _variant_label(_kind, c), 'Chunk type ' + hexs(t), i) for i, (t, c) in enumerate(_cls.TYPE_IDS.items())]
    CHUNK_GROUPS[_kind] = make_group('GSF_PG_chunk_' + _kind, _cls.STRUCT, _kind,
                                     {'type_id': EnumProperty(name='Variant', items=_items,
                                                              description='Chunk type (static / skinned ...)')})
for _kind, _cls in sorted(KINDS.items()):
    if not _cls.IS_ANIM:
        continue
    ANIM_GROUPS[_kind] = make_group('GSF_PG_anim_' + _kind, _cls.STRUCT, _kind)


# ---------------------------------------------------------------------------------------- static groups
class GSF_PG_atlas(PropertyGroup):
    """one TextureInfo record of a particle emitter"""
    material: PointerProperty(type=bpy.types.Material, name='Material', description='Material of the sprites')
    tiles_w_log2: IntProperty(name='tiles_w_log2', min=0, max=255, description='log2 of the number of atlas columns')
    tiles_h_log2: IntProperty(name='tiles_h_log2', min=0, max=255, description='log2 of the number of atlas rows')
    tile_start: IntProperty(name='tile_start', min=0, max=255, description='First cell used')
    tile_last: IntProperty(name='tile_last', min=0, max=255, description='Number of cells used - 1')
    tile_border_width: IntProperty(name='tile_border_width', min=0, max=255, default=255,
                                   description='TileLimitR - TileLimitL (255 = the whole cell)')
    tile_border_left: IntProperty(name='tile_border_left', min=0, max=255, description='TileLimitL')
    mid_x: IntProperty(name='mid_x', min=0, max=255, default=127, description='Pivot x + 127')
    mid_y: IntProperty(name='mid_y', min=0, max=255, default=127, description='Pivot y + 127')


class GSF_PG_param(PropertyGroup):
    """one parameter of a particle source (4 bytes)"""
    pname: StringProperty(name='Name')
    ptype: EnumProperty(name='Type', items=[('f', 'Float', ''), ('i', 'Integer', ''), ('x', 'Bit set', '')], default='f')
    f: FloatProperty(name='Value', precision=5)
    i: IntProperty(name='Value')
    x: StringProperty(name='Value', default='0x00000000', description='hexadecimal')


class GSF_PG_ref(PropertyGroup):
    """reference from one chunk to another (a field that holds a chunk index in the file)"""
    field: StringProperty(name='Field')
    target: PointerProperty(type=bpy.types.Object, name='Object')


REF_LABELS = {'skeleton_index': 'Skeleton', 'cloth_chunk_index': 'Cloth', 'light_volume_chunk': 'Light volume'}


class GSF_PG_chunk(PropertyGroup):
    """GSF component data of an object"""
    kind: EnumProperty(name='Kind', items=[('NONE', 'Not part of a GSF model', '')] + [
        (k.upper(), KINDS[k].LABEL, KINDS[k].__doc__ or '') for k in sorted(CHUNK_GROUPS)] + [
        ('COLLISION', 'Collision volume', 'Pathfinding / hit volume of the model (not a chunk)')], default='NONE')
    order: IntProperty(name='Order', default=1000, description='Position in the chunk table (stable sort within its group)')
    attributes: BoolVectorProperty(name='Attributes', size=32, description='Visibility bits')
    guid: StringProperty(name='GUID', description='CRC-32 of the component name. Empty = computed from the object name')
    material: PointerProperty(type=bpy.types.Material, name='Material', description='Material (speed lines)')
    # particle emitters
    particle_name: StringProperty(name='Emitter name', description='Name of the emitter in the source scene')
    has_name: BoolProperty(name='Has name', default=True)
    tiles: CollectionProperty(type=GSF_PG_atlas)
    params: CollectionProperty(type=GSF_PG_param)
    refs: CollectionProperty(type=GSF_PG_ref)
    # collision volumes
    shape: EnumProperty(name='Shape', items=[('SPHERE', 'Sphere', ''), ('BOX', 'Box', ''), ('TUBE', 'Tube', ''),
                                             ('ELLIPSOID', 'Ellipsoid', '')], default='BOX')
    # mesh: how the extra vertex byte is used
    keep_tangents: BoolProperty(name='Keep tangent data', default=True,
                                description='Write the per-vertex tangent words (unk_tangent attribute) back')


class GSF_PG_bone(PropertyGroup):
    guid: StringProperty(name='GUID', description='CRC-32 of the bone name. Empty = computed from the bone name')
    flags: StringProperty(name='flags', default='0x00000000', description=BONE.by_name['flags'].doc)
    scale: FloatVectorProperty(name='scale', size=3, default=(1, 1, 1), description=BONE.by_name['scale'].doc)
    order: IntProperty(name='Order', default=100000, description='Depth-first position (siblings are sorted by it)')
    # rest placement as read from the file: written back unchanged while the bone was not moved (Blender keeps bones
    # with less precision than the file)
    rest_pos: FloatVectorProperty(size=3, precision=6)
    rest_rot: FloatVectorProperty(size=4, precision=6)
    has_rest: BoolProperty(default=False)


GSF_PG_material_fields = make_group('GSF_PG_material', MATERIAL, 'material', {
    'is_gsf': BoolProperty(default=False),
    'texture': StringProperty(name='Texture', description='Path of the texture below the Texture folder (.tga)'),
    'has_texture': BoolProperty(name='Has texture', default=True),
    'normal_map': StringProperty(name='Normal map'),
    'has_normal_map': BoolProperty(name='Has normal map', default=False),
    'env_map': StringProperty(name='Environment map'),
    'has_env_map': BoolProperty(name='Has environment map', default=False),
})


class GSF_PG_track(PropertyGroup):
    bone: StringProperty(name='Bone')
    format: EnumProperty(name='Format', items=[(ident, ident.title(), d, v) for v, ident, d in TRACK_FORMATS], default='SIMPLE')
    flags: IntProperty(name='Flags', min=0, max=255, description='0x01 constant (one key), 0x02 no keys')
    parent: StringProperty(name='Parent track', description='Bone of the parent node in the track tree ("" = automatic)')


class GSF_PG_meshref(PropertyGroup):
    mesh: PointerProperty(type=bpy.types.Mesh)


class GSF_PG_matref(PropertyGroup):
    material: PointerProperty(type=bpy.types.Material)


_action_extra = {
    'kind': EnumProperty(name='Kind', items=[('NONE', 'None', '')] + [
        (k.upper(), KINDS[k].LABEL, '') for k in sorted(ANIM_GROUPS)], default='NONE'),
    'frames': IntProperty(name='Frames', min=0, description='Number of frames written (0 = from the action\'s range)'),
    'attributes': BoolVectorProperty(name='Attributes', size=32),
    'guid': StringProperty(name='GUID', description='Checksum of the animated component / root bone name'),
    'helper_bone': StringProperty(name='Root track bone', description='Bone of the root ("helper") track; empty = dummy root'),
    'root_format': EnumProperty(name='Root format', items=[(i, i.title(), d, v) for v, i, d in TRACK_FORMATS], default='ROOT'),
    'root_flags': IntProperty(name='Root flags', min=0, max=255),
    'tracks': CollectionProperty(type=GSF_PG_track),
    'storage': EnumProperty(name='Transform storage', items=[
        ('MATRICES', 'Matrices', 'One 4x4 matrix per frame'),
        ('KEYS', 'Keys', 'Position / rotation keys + a key index per frame'),
        ('NONE', 'None', 'No transforms (only mesh frames)')], default='KEYS'),
    'frame_meshes': CollectionProperty(type=GSF_PG_meshref),
    'materials': CollectionProperty(type=GSF_PG_matref),
    'has_material_list': BoolProperty(name='Has material list', default=False),
    'info_name': StringProperty(name='Animation info name', default='Helper01',
                                description='Name in the archive\'s animation info table (helper object of the source scene)'),
    'info_fourcc': StringProperty(name='Animation info FourCC', maxlen=5),
}
_action_extra.update({'p_' + k: PointerProperty(type=g) for k, g in ANIM_GROUPS.items()})
GSF_PG_action = type('GSF_PG_action', (PropertyGroup,), {'__annotations__': _action_extra, '__module__': __name__})

_chunk_ann = dict(GSF_PG_chunk.__annotations__)
_chunk_ann.update({'p_' + k: PointerProperty(type=g) for k, g in CHUNK_GROUPS.items()})
GSF_PG_chunk = type('GSF_PG_chunk', (PropertyGroup,), {'__annotations__': _chunk_ann, '__module__': __name__,
                                                        '__doc__': GSF_PG_chunk.__doc__})

GSF_PG_collision = make_group('GSF_PG_collision', COLLISION, 'collision')


class GSF_PG_track_ref(PropertyGroup):
    target: PointerProperty(type=bpy.types.Object, name='Object', description='The animated component')
    action: PointerProperty(type=bpy.types.Action, name='Action')


class GSF_PG_anim(PropertyGroup):
    """one animation of a model (table of contents entry + animation table entry)"""
    name: StringProperty(name='Name', description='Script name: standanim, walk_1, attack_front ...')
    anim_flags: StringProperty(name='Groups', default='0x00000000',
                               description='Bit k = the animation belongs to animation group k (1 idle, 2 walk, 4 fight, 8 work)')
    sounds: StringProperty(name='Sounds', description='Sound events: positions in the archive\'s sound list, comma separated')
    tracks: CollectionProperty(type=GSF_PG_track_ref)
    track_index: IntProperty()
    info_name: StringProperty(name='Animation info', default='Helper01')
    legacy_tracks: StringProperty(name='Tracks on empty slots', description=(
        'Animation tracks of empty chunk-table slots (legacy edits in modded archives): "slot:offset:frames" each, '
        'copied unchanged from the source archive on save'))


class GSF_PG_walkslot(PropertyGroup):
    anim: StringProperty(name='Animation')
    value: IntProperty(name='Value', min=0, description='Walk transition index (slot 28 only)')


class GSF_PG_walkset(PropertyGroup):
    name: StringProperty(name='Name', maxlen=5, default='def')
    slots: CollectionProperty(type=GSF_PG_walkslot)


GSF_PG_model = make_group('GSF_PG_model', MODEL_INFO, 'model', {
    'is_root': BoolProperty(default=False),
    'name': StringProperty(name='Model name', description='Name in the table of contents (used by scripts and maps)'),
    'object_name': StringProperty(name='Object name', description='Name stored in the model info (usually the same)'),
    'has_object_name': BoolProperty(default=True),
    'auto_bbox': BoolProperty(name='Automatic bounding box', default=True,
                              description='Compute the bounding box from the geometry on export'),
    'bbox': FloatVectorProperty(name='Bounding box', size=6, precision=4),
    'anims': CollectionProperty(type=GSF_PG_anim),
    'anim_index': IntProperty(),
    'walksets': CollectionProperty(type=GSF_PG_walkset),
    'walkset_index': IntProperty(),
    'materials': CollectionProperty(type=GSF_PG_matref),
    'source_name': StringProperty(name='Replaces', description='Model of the source archive this one replaces on save'),
    'empty_slots': StringProperty(name='Empty chunk slots', description=(
        'Positions in the chunk table that hold no chunk (legacy edits in modded archives), comma separated. They '
        'are written back where they are: "1" = the null value 0x80000000, "1=0" = the value 0, '
        '"1=zero" = a pointer to a blanked-out (all zero) chunk')),
})


def parse_empty_slots(text):
    """'1, 5=0, 7=zero' -> [(1, 0x80000000), (5, 0), (7, 'zero')]"""
    out = {}
    for tok in text.replace(';', ',').split(','):
        tok = tok.strip()
        if not tok:
            continue
        i, _, raw = tok.partition('=')
        raw = raw.strip().lower()
        try:
            out[int(i)] = 'zero' if raw == 'zero' else (0 if raw in ('0', '0x0', '0x00000000') else 0x80000000)
        except ValueError:
            continue
    return sorted(out.items())


def format_empty_slots(slots):
    return ', '.join('%d=zero' % i if raw == 'zero' else ('%d=0' % i if raw == 0 else '%d' % i) for i, raw in slots)


GSF_PG_sound_fields = make_group('GSF_PG_sound_values', SOUND, 'sound')


class GSF_PG_sound(PropertyGroup):
    name: StringProperty(name='Sound', description='Path of the .wav below the Audio folder')
    group: StringProperty(name='Group', description='Sounds of one group are alternatives')
    v: PointerProperty(type=GSF_PG_sound_fields)
    orig_index: IntProperty(default=-1, description='Position in the source archive (-1 = added in Blender)')


class GSF_PG_kv(PropertyGroup):
    name: StringProperty(name='Key')
    value: StringProperty(name='Value')


class GSF_PG_dusttrail(PropertyGroup):
    name: StringProperty(name='Effect', description='Script class ("CLevelUpFX") or "_dusttrail"')
    model: StringProperty(name='Model')
    anim: StringProperty(name='Animation', description='Name of the model animation')
    anim_index: IntProperty(name='Animation index', min=0, description='Used when the animation name is empty')
    start_frame: IntProperty(name='Start frame', min=0)
    entries: CollectionProperty(type=GSF_PG_kv)


class GSF_PG_name(PropertyGroup):
    name: StringProperty(name='Name')
    orig_index: IntProperty(default=-1, description='Position in the source archive (-1 = added in Blender)')


class GSF_PG_entry(PropertyGroup):
    """a model of the source archive"""
    name: StringProperty(name='Model')
    fourcc: StringProperty()
    info: StringProperty()
    state: EnumProperty(name='State', items=[
        ('FILE', 'Keep', 'Written as it is in the source archive'),
        ('SCENE', 'Edited', 'Imported into the scene; written from the scene'),
        ('REMOVE', 'Remove', 'Left out when the archive is saved')], default='FILE')
    root: PointerProperty(type=bpy.types.Object)
    select: BoolProperty(name='Select', default=False)
    copy_of: StringProperty(name='Copy of', description='This model is a copy of that one (made with Copy): '
                            'written as a copy of it under this name, or imported from it')


GSF_PG_archive = make_group('GSF_PG_archive', HEADER2, 'archive', {
    'is_archive': BoolProperty(default=False),
    'file_name': StringProperty(name='Archive name', description='Name stored in the archive (without extension)'),
    'source_path': StringProperty(name='Source file', subtype='FILE_PATH',
                                  description='Archive the models marked "Keep" are taken from when saving'),
    'data_dir': StringProperty(name='Game Data folder', subtype='DIR_PATH', description='Used to find textures'),
    'mirror': EnumProperty(name='Handedness', items=MIRROR_ITEMS, default='X',
                           description='Axis mirrored between the game\'s left-handed space and Blender'),
    'materials_capacity': IntProperty(name='Material table capacity', min=0, default=1000,
                                      description=MATERIALS_HEADER.by_name['num_max_entries'].doc),
    'sounds': CollectionProperty(type=GSF_PG_sound),
    'sound_index': IntProperty(),
    'dusttrails': CollectionProperty(type=GSF_PG_dusttrail),
    'dusttrail_index': IntProperty(),
    'dust_entry_index': IntProperty(),
    'anim_groups': CollectionProperty(type=GSF_PG_name),
    'anim_group_index': IntProperty(),
    'walk_transitions': CollectionProperty(type=GSF_PG_name),
    'walk_transition_index': IntProperty(),
    'lists_tracked': BoolProperty(default=False, description='Sounds, animation groups and walk transitions know their '
                                  'position in the source archive (models kept from the file are renumbered on save)'),
    'entries': CollectionProperty(type=GSF_PG_entry),
    'entry_index': IntProperty(),
    'order_changed': BoolProperty(name='Order changed', default=False,
                                  description='The model list was rearranged: the archive is saved in its order'),
    'filter': StringProperty(name='Filter', description='Show only models whose name contains this text'),
})

GSF_PG_anim_info = make_group('GSF_PG_anim_info', ANIM_INFO, 'anim_info')

def get_ref(g, field):
    for r in g.refs:
        if r.field == field:
            return r.target
    return None


def set_ref(g, field, obj):
    for r in g.refs:
        if r.field == field:
            r.target = obj
            return
    r = g.refs.add()
    r.field = field
    r.target = obj


STATIC = [GSF_PG_atlas, GSF_PG_param, GSF_PG_bone, GSF_PG_track, GSF_PG_meshref, GSF_PG_matref, GSF_PG_track_ref,
          GSF_PG_anim, GSF_PG_walkslot, GSF_PG_walkset, GSF_PG_kv, GSF_PG_dusttrail, GSF_PG_name, GSF_PG_entry]


def classes():
    """every property group, in registration order (dependencies first)"""
    gen_first = [c for c in _generated if c.__name__ not in ('GSF_PG_model', 'GSF_PG_archive', 'GSF_PG_sound_values')]
    out = [GSF_PG_atlas, GSF_PG_param, GSF_PG_ref] + gen_first + [GSF_PG_chunk, GSF_PG_bone, GSF_PG_track, GSF_PG_meshref,
                                                         GSF_PG_matref, GSF_PG_action, GSF_PG_track_ref, GSF_PG_anim,
                                                         GSF_PG_walkslot, GSF_PG_walkset, GSF_PG_model,
                                                         GSF_PG_sound_fields, GSF_PG_sound, GSF_PG_kv,
                                                         GSF_PG_dusttrail, GSF_PG_name, GSF_PG_entry, GSF_PG_archive]
    seen, res = set(), []
    for c in out:
        if c not in seen:
            seen.add(c)
            res.append(c)
    return res


def register():
    for c in classes():
        bpy.utils.register_class(c)
    bpy.types.Object.gsf = PointerProperty(type=GSF_PG_chunk)
    bpy.types.Object.gsf_model = PointerProperty(type=GSF_PG_model)
    bpy.types.Collection.gsf_archive = PointerProperty(type=GSF_PG_archive)
    bpy.types.Material.gsf = PointerProperty(type=GSF_PG_material_fields)
    bpy.types.Bone.gsf = PointerProperty(type=GSF_PG_bone)
    bpy.types.EditBone.gsf = PointerProperty(type=GSF_PG_bone)
    bpy.types.Action.gsf = PointerProperty(type=GSF_PG_action)


def unregister():
    for t, a in ((bpy.types.Object, 'gsf'), (bpy.types.Object, 'gsf_model'), (bpy.types.Collection, 'gsf_archive'),
                 (bpy.types.Material, 'gsf'), (bpy.types.Bone, 'gsf'), (bpy.types.EditBone, 'gsf'),
                 (bpy.types.Action, 'gsf')):
        if hasattr(t, a):
            delattr(t, a)
    for c in reversed(classes()):
        try:
            bpy.utils.unregister_class(c)
        except RuntimeError:
            pass
