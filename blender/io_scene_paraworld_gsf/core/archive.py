"""A whole .gsf archive in memory: read, edit, write.

Layout of the file
    "GSF\\0", version 0, u32 absolute offset of header 2
    header 1  - table of contents: archive name, models with the names of their animations and their walk sets,
                sound events, dust trails, animation group names, walk transition names
    padding   - header 2 starts at a multiple of 0x10000 (0x10000 unless the table of contents is longer)
    header 2  - model infos, animation infos, materials, then all chunks and tables they point to

Object model (what the add-on edits)
    GsfArchive
        .materials        [Material]              the archive's material table
        .models           [Model]                 in model-info order
        .anim_infos       [AnimInfo]              one per source animation file (the game does not use them)
        .sounds           [Sound]                 sound events, referred to by model animation names
        .dusttrails       [DustTrail]
        .anim_groups      [str]                   "idle", "walk", "fight", "work" (character archives)
        .walk_transitions [str]
    Model
        .name / .object_name / .fourcc / .bounding_box ...
        .chunks           [Chunk | EmptySlot]     components
        .material_list    MaterialList            materials the chunks index
        .collision        [CollisionVolume]
        .anims            [ModelAnim]             the model's animation table (chunk -> animation chunk)
        .anim_names       [AnimName]              script names of the animations (table of contents)
        .walksets         [WalkSet]
Cross references are held as Python object references and turned into indices only when writing, so models,
animations, materials and chunks can be added, removed and reordered freely.
"""
import struct

from .binio import Reader, Writer, GsfError
from .schema import Field, Struct, VOLUME_SHAPES, ATTR_DOC
from .chunks import CHUNK_CLASSES, ANIM_CLASSES, NameBlock, key_of
from .chunks.base import Chunk
from .materials import Material, MaterialList

MAGIC = b'GSF\0'

# ------------------------------------------------------------------------------------------------------ header 2
HEADER2 = Struct('header2', [
    Field('unk_zero', 'u32', 'Always 0.'),
    Field('num_models', 'u32', derived=True),
    Field('num_anims', 'u32', derived=True),
    Field('unk_zero2', 'u32', 'Always 0.'),
    Field('ptr_model_infos', 'ptr'),
    Field('num_model_infos', 'u32', derived=True),
    Field('ptr_anim_infos', 'ptr'),
    Field('num_anim_infos', 'u32', derived=True),
])
MATERIALS_HEADER = Struct('materials_header', [
    Field('num_materials', 'u32', derived=True),
    Field('ptr_materials', 'ptr'),
    Field('num_max_entries', 'u32', 'Capacity of the material list the archive was built with (1000, or 0). The '
          'unused records are written as empty materials.'),
])

MODEL_INFO = Struct('model_info', [
    Field('fourcc', 'str4', 'Object class: Char, Anim (animals), Bldg, Wall, Fiel, Ship, Vehi, Deko, Misc, Ress, Vgtn, '
          'RIVR. It decides what the attribute bits of the chunks mean.', default='Misc'),
    Field('ptr_object_name', 'ptr'),
    Field('ptr_chunks_table', 'ptr'),
    Field('num_chunks', 'u32', derived=True),
    Field('ptr_material_list', 'ptr'),
    Field('unk_one', 'u32', 'Always 1 ("bool_read_data_maybe").', default=1),
    Field('first_particle_chunk_index', 'u16', 'Index of the first particle emitter (0 when there is none).', derived=True),
    Field('num_particle_chunks', 'u16', derived=True),
    Field('first_link_chunk_index', 'u16', '0xFFFF when the model has no links.', derived=True),
    Field('num_link_chunks', 'u16', derived=True),
    Field('has_billboards_or_particles', 'u8', '1 on models with billboard or particle chunks.', derived=True),
    Field('num_skeleton_chunks', 'u8', 'Number of chunks that serve as skeleton: the skeleton chunks plus cloth chunks '
          'that skinned components hang on.', derived=True),
    Field('num_physcoll_chunks', 'u8', derived=True),
    Field('num_cloth_chunks', 'u8', derived=True),
    Field('first_light_volume_chunk_index', 'u8', '255 when there is none.', derived=True),
    Field('num_light_volume_chunks', 'u8', derived=True),
    Field('num_speedline_chunks', 'u8', derived=True),
    Field('unk_zero', 'u8', 'Always 0.'),
    Field('unk_ptr_waypoints', 'ptr'),
    Field('ptr_collision_table', 'ptr'),
    Field('num_collision_volumes', 'u32', derived=True),
    Field('bounding_box', 'bbox', 'Bounding box of the model.'),
    Field('ptr_anim_table', 'ptr'),
    Field('num_object_anim', 'u32', derived=True),
])

COLLISION = Struct('collision_volume', [
    Field('shape', 'u32', 'Shape. Boxes are what units walk around (building footprints), spheres what projectiles hit.',
          items=VOLUME_SHAPES, default=1),
    Field('pos', 'vec3', 'Sphere / ellipsoid: centre, box: lowest corner, tube: bottom centre.'),
    Field('size', 'vec3', 'Sphere: radius, radius squared, 0. Box: extent. Tube: radius, 0, height. Ellipsoid: radii.',
          default=(1.0, 1.0, 1.0)),
    Field('attributes', 'attr', 'The volume counts only in the object states these bits belong to. ' + ATTR_DOC),
])

ANIM_INFO = Struct('anim_info', [
    Field('fourcc', 'str4', 'Object class of the source file; empty in some.'),
    Field('ptr_anim_name', 'ptr'),
    Field('ptr_anim_chunks', 'ptr'),
    Field('num_anim_chunks', 'u32', derived=True),
    Field('ptr_material_list', 'ptr'),
    Field('unk_num_material_lists', 'u32', 'Always 1.', default=1),
    Field('num_frames', 'u32', 'Number of frames.'),
])

SOUND = Struct('sound', [
    Field('start_frame', 'u32', 'Animation frame at which the sound starts.'),
    Field('volume', 'u32', 'Percent.', default=100),
    Field('speed', 'f32', 'Pitch / playback speed.', default=1.0),
    Field('unk_float', 'f32', '0 in every sound looked at.'),
    Field('min_fade_distance', 'f32', 'Probably the distance where fading starts.', default=10.0),
    Field('max_fade_distance', 'f32', 'Probably the distance where fading ends.', default=60.0),
    Field('max_hearing_distance', 'f32', 'Distance beyond which the sound is not played.', default=61.0),
])

TOC_ANIM = Struct('model_anim', [
    Field('anim_flags', 'hex32', 'Bit k = the animation belongs to group k of the archive\'s animation groups (1 idle, '
          '2 walk, 4 fight, 8 work).'),
])

WALKSET_SLOTS = [
    'walk_1', 'walk_2', 'walk_3', 'walk_4',
    'walk_1_end_s', 'walk_1_end_m', 'walk_1_end_l', 'walk_2_end_s', 'walk_2_end_m', 'walk_2_end_l',
    'walk_3_end_s', 'walk_3_end_m', 'walk_3_end_l', 'walk_4_end_s', 'walk_4_end_m', 'walk_4_end_l',
    'standrotate_right', 'standrotate_left', 'unk_slot_18', 'accel_1_2', 'accel_2_3', 'accel_3_4',
    'brake_4_3', 'brake_3_2', 'brake_2_1', 'rotate_left', 'rotate_right', 'riding_layers',
    'walk_transition', 'growup', 'sail_up', 'sail_down', 'standanim', 'walk_to_swim_2',
    'hit_reaction_fa', 'hit_reaction_la', 'hit_reaction_ra', 'hit_reaction_ba',
    'hit_reaction_fb', 'hit_reaction_lb', 'hit_reaction_rb', 'hit_reaction_bb']
WALK_TRANSITION_SLOT = 28     # holds a 1-based index into the archive's walk transition names, not an animation


# ------------------------------------------------------------------------------------------------- object model
class EmptySlot:
    """a null entry of a model's chunk table. Some modded archives have them (legacy hand edits); they are kept in
    place and written back with their raw value (0 or 0x80000000). raw None = a chunk that could not be read,
    written as 0x80000000."""
    KIND = 'empty'
    IS_ANIM = False

    def __init__(self, raw=0x80000000):
        self.raw = raw

    def __repr__(self):
        return '<EmptySlot %s>' % ('unreadable' if self.raw is None else '0x%08X' % self.raw)


class ZeroChunk(EmptySlot):
    """a chunk-table entry that points to a block of zero bytes (a chunk blanked out by hand in modded archives,
    e.g. MIRAGE's dilophosaurud). Kept as it is: written as a pointer to `size` zero bytes."""
    SIZE = 256              # covers the chunk struct and the mesh header the game would read through a 0 offset

    def __init__(self, size=SIZE):
        super().__init__(None)
        self.size = size

    def __repr__(self):
        return '<ZeroChunk %d bytes>' % self.size


# model-info values computed from the chunks; models with legacy empty slots keep the file's values
CHUNK_COUNT_FIELDS = ('num_chunks', 'first_particle_chunk_index', 'num_particle_chunks', 'first_link_chunk_index',
                      'num_link_chunks', 'has_billboards_or_particles', 'num_skeleton_chunks', 'num_physcoll_chunks',
                      'num_cloth_chunks', 'first_light_volume_chunk_index', 'num_light_volume_chunks',
                      'num_speedline_chunks')


class Sound:
    def __init__(self, name='', group=''):
        self.name = name                 # .wav below the Audio folder
        self.group = group               # usually empty; sounds of one group are alternatives
        self.v = SOUND.defaults()


class AnimName:
    """an entry of the table of contents: script name of a model animation"""

    def __init__(self, name, anim=None):
        self.name = name                 # "standanim", "walk_1", "attack_front" ...
        self.anim = anim                 # ModelAnim
        self.sounds = []                 # [Sound]
        self.v = TOC_ANIM.defaults()

    def __repr__(self):
        return '<AnimName %s>' % self.name


class WalkSet:
    def __init__(self, name='def'):
        self.name = name                 # up to 4 characters: def, defn, hump, swim, rage, cary, sldr ...
        self.slots = [None] * 42         # AnimName or None; slot 28 = int (1-based walk transition index)
        self.slots[WALK_TRANSITION_SLOT] = 0


class DustTrail:
    """effect started at a frame of an animation ("CLevelUpFX", "_dusttrail" with bloodcount / force ...)"""

    def __init__(self, name='', model=None, anim_index=0):
        self.name = name
        self.model = model               # Model
        self.anim = None                 # AnimName (resolved from anim_index when possible)
        self.anim_index = anim_index     # raw value, used when it could not be resolved
        self.start_frame = 0
        self.entries = []                # [(key, value)]


class CollisionVolume:
    def __init__(self, values=None):
        self.v = COLLISION.defaults()
        if values:
            self.v.update(values)


class ModelAnim:
    """one animation of a model: which animation chunk moves which chunk"""

    def __init__(self):
        self.tracks = []                 # [(chunk of the model, anim chunk, frame count)]

    def anim_for(self, chunk):
        for c, a, n in self.tracks:
            if c is chunk:
                return a, n
        return None, 0

    def frames(self):
        return max([n for _, _, n in self.tracks] or [0])


class AnimInfo:
    def __init__(self, name='Helper01'):
        self.name = name
        self.name_meta = (None, None)
        self.fourcc = b'\0\0\0\0'
        self.chunks = []                 # [AnimChunk | None]
        self.material_list = None
        self.v = ANIM_INFO.defaults()


class Model:
    def __init__(self, name='new_model', fourcc='Misc'):
        self.name = name                 # table of contents name (what scripts and maps use)
        self.object_name = name          # name stored in the model info
        self.object_name_meta = (None, None)
        self.v = MODEL_INFO.defaults()
        self.v['fourcc'] = fourcc
        self.chunks = []
        self.material_list = MaterialList()
        self.collision = []
        self.anims = []                  # [ModelAnim]
        self.anim_names = []             # [AnimName]
        self.walksets = []               # [WalkSet]

    @property
    def fourcc(self):
        return self.v['fourcc']

    def chunks_of(self, kind):
        return [c for c in self.chunks if getattr(c, 'KIND', None) == kind]

    def anim_name(self, name):
        for a in self.anim_names:
            if a.name == name:
                return a
        return None

    def __repr__(self):
        return '<Model %s %s, %d chunks, %d anims>' % (self.name, self.fourcc, len(self.chunks), len(self.anims))

    # -- ordering and derived values
    def sort_chunks(self):
        """stable sort by group (skeletons, cloth colliders, emitters, links, light volumes, cloth, the rest).
        Empty slots stay where they are; the chunks fill the other positions."""
        fixed = [i for i, c in enumerate(self.chunks) if not isinstance(c, Chunk)]
        moving = sorted((c for c in self.chunks if isinstance(c, Chunk)), key=lambda c: c.group())
        it = iter(moving)
        self.chunks = [self.chunks[i] if i in fixed else next(it) for i in range(len(self.chunks))]

    def _range(self, kind):
        idx = [i for i, c in enumerate(self.chunks) if getattr(c, 'KIND', None) == kind]
        if idx and idx[-1] - idx[0] + 1 != len(idx):
            return None
        return idx

    def prepare(self):
        kinds = ('particle', 'link', 'light_volume')
        if any(self._range(k) is None for k in kinds):
            self.sort_chunks()
        cl = [c for c in self.chunks if getattr(c, 'KIND', '') == 'mesh' and c.is_cloth]
        v = self.v
        v['num_chunks'] = len(self.chunks)
        p = self._range('particle')
        v['first_particle_chunk_index'] = p[0] if p else 0
        v['num_particle_chunks'] = len(p)
        lk = self._range('link')
        v['first_link_chunk_index'] = lk[0] if lk else 0xFFFF
        v['num_link_chunks'] = len(lk)
        lv = self._range('light_volume')
        v['first_light_volume_chunk_index'] = lv[0] if lv else 255
        v['num_light_volume_chunks'] = len(lv)
        v['has_billboards_or_particles'] = int(any(getattr(c, 'KIND', '') in ('billboard', 'particle') for c in self.chunks))
        skel = {i for i, c in enumerate(self.chunks) if getattr(c, 'KIND', '') == 'skeleton'}
        for c in self.chunks:
            t = c.refs.get('skeleton_index') if isinstance(c, Chunk) else None
            if t is not None and id(t) in {id(x) for x in self.chunks}:
                skel.add(next(i for i, x in enumerate(self.chunks) if x is t))
            elif isinstance(c, Chunk) and 'skeleton_index' in c.v and 'skeleton_index' not in c.refs and c.KIND != 'skeleton':
                skel.add(c.v['skeleton_index'])
        v['num_skeleton_chunks'] = len(skel)
        v['num_physcoll_chunks'] = len(self.chunks_of('phys_coll'))
        v['num_cloth_chunks'] = len(cl)
        v['num_speedline_chunks'] = len(self.chunks_of('speedline'))
        legacy = getattr(self, 'legacy_counts', None)
        if legacy and len(self.chunks) == legacy.get('num_chunks'):
            v.update(legacy)        # a model with legacy empty slots, read from a file: its own counts stay
        v['num_collision_volumes'] = len(self.collision)
        v['num_object_anim'] = len(self.anims)
        # chunk -> chunk references back to indices
        pos = {id(c): i for i, c in enumerate(self.chunks)}
        for c in self.chunks:
            if not isinstance(c, Chunk):
                continue
            if c.KIND == 'skeleton':
                c.v['skeleton_index'] = pos[id(c)]
            for field, none in c.REFS.items():
                if field in c.refs and field in c.v:
                    t = c.refs[field]
                    c.v[field] = pos.get(id(t), none) if t is not None else none


# ------------------------------------------------------------------------------------------------------- archive
class GsfArchive:
    def __init__(self, file_name='new_archive'):
        self.file_name = file_name
        self.models = []
        self.toc_order = None            # models in table-of-contents order when it differs from model-info order
        self.materials = []
        self.materials_capacity = 1000
        self.anim_infos = []
        self.sounds = []
        self.dusttrails = []
        self.anim_groups = []
        self.walk_transitions = []
        self.h2 = HEADER2.defaults()
        self.warnings = []
        self.anim_by_offset = {}         # file offset -> animation chunk (as read)

    # ============================================================================================ reading
    @classmethod
    def load(cls, path):
        with open(path, 'rb') as f:
            data = f.read()
        return cls.from_bytes(data)

    @classmethod
    def from_bytes(cls, data):
        r = Reader(data)
        if r.size < 12 or bytes(data[:4]) != MAGIC:
            raise GsfError('not a GSF archive (bad magic)')
        a = cls()
        a._read_header2(r, r.u32(8))
        a._read_header1(r)
        return a

    def _read_header2(self, r, h2):
        vals, ptrs, o = HEADER2.read(r, h2)
        self.h2.update(vals)
        mv, mp, _ = MATERIALS_HEADER.read(r, o)
        self.materials_capacity = mv['num_max_entries']
        if mp['ptr_materials'] is not None:
            self.materials = [Material.read(r, mp['ptr_materials'] + 24 * k) for k in range(mv['num_materials'])]
        # models
        self.models = []
        mi = ptrs['ptr_model_infos']
        for k in range(vals['num_model_infos'] if mi is not None else 0):
            self.models.append(self._read_model(r, mi + 84 * k))
        # animation infos
        self.anim_infos = []
        ai = ptrs['ptr_anim_infos']
        for k in range(vals['num_anim_infos'] if ai is not None else 0):
            self.anim_infos.append(self._read_anim_info(r, ai + 28 * k))
        self._resolve_materials()

    def _read_chunk(self, r, o):
        t = r.u32(o)
        cls = CHUNK_CLASSES.get(t)
        if cls is None:
            raise GsfError('unknown chunk type 0x%08X at 0x%x' % (t, o))
        return r.obj('chunk', o, cls.read)

    def _read_anim_chunk(self, r, o):
        t = r.u32(o)
        cls = ANIM_CLASSES.get(t)
        if cls is None:
            raise GsfError('unknown animation chunk type 0x%08X at 0x%x' % (t, o))
        a = r.obj('anim', o, cls.read)
        self.anim_by_offset[o] = a
        return a

    def _read_model(self, r, o):
        m = Model()
        vals, ptrs, _ = MODEL_INFO.read(r, o)
        m.v.update(vals)
        if ptrs['ptr_object_name'] is not None:
            m.object_name, n, _, cap = NameBlock.read(r, ptrs['ptr_object_name'])
            m.object_name_meta = (n, cap)
        else:
            m.object_name = None
        m.name = m.object_name or ''
        ct = ptrs['ptr_chunks_table']
        m.chunks = []
        for k in range(vals['num_chunks'] if ct is not None else 0):
            p = r.ptr(ct + 4 * k)
            if p is None:
                m.chunks.append(EmptySlot(r.u32(ct + 4 * k)))
                continue
            try:
                m.chunks.append(self._read_chunk(r, p))
            except (GsfError, struct.error, ValueError, IndexError) as e:
                if not any(r.d[p:p + ZeroChunk.SIZE]):
                    m.chunks.append(ZeroChunk())        # blanked out by hand: kept as zeros
                    continue
                self.warnings.append('%s: chunk %d unreadable (%s) - left empty' % (m.name, k, e))
                m.chunks.append(EmptySlot(None))
        if any(not isinstance(c, Chunk) for c in m.chunks):
            m.legacy_counts = {f: m.v[f] for f in CHUNK_COUNT_FIELDS if f in m.v}
        mlp = ptrs['ptr_material_list']
        m.material_list = r.obj('matlist', mlp, MaterialList.read) if mlp is not None else None
        cp = ptrs['ptr_collision_table']
        m.collision = []
        for k in range(vals['num_collision_volumes'] if cp is not None else 0):
            cv = CollisionVolume()
            cv.v.update(COLLISION.read(r, cp + 32 * k)[0])
            m.collision.append(cv)
        # chunk references
        for c in m.chunks:
            if isinstance(c, Chunk):
                for field, none in c.REFS.items():
                    if field not in c.v:
                        continue
                    i = c.v[field]
                    if i != none and 0 <= i < len(m.chunks):
                        c.refs[field] = m.chunks[i]
                    elif i == none:
                        c.refs[field] = None
                    else:
                        self.warnings.append('%s: %s.%s = %d points outside the chunk table' % (m.name, c.KIND, field, i))
        # animation table
        at = ptrs['ptr_anim_table']
        m.anims = []
        for k in range(vals['num_object_anim'] if at is not None else 0):
            e = at + 12 * k
            ma = ModelAnim()
            tp, n = r.ptr(e + 4), r.u32(e + 8)
            for j in range(n if tp is not None else 0):
                ap = r.ptr(tp + 8 * j)
                frames = r.u32(tp + 8 * j + 4)
                if ap is None:
                    continue
                if j >= len(m.chunks):
                    self.warnings.append('%s: animation %d animates chunk %d of %d' % (m.name, k, j, len(m.chunks)))
                    continue
                try:
                    ma.tracks.append((m.chunks[j], self._read_anim_chunk(r, ap), frames))
                except (GsfError, struct.error, ValueError, IndexError) as e2:
                    self.warnings.append('%s: animation %d chunk %d unreadable (%s)' % (m.name, k, j, e2))
            ma.num_entries = n               # original length of the list (it ends after the last animated chunk)
            m.anims.append(ma)
        return m

    def _read_anim_info(self, r, o):
        ai = AnimInfo()
        vals, ptrs, _ = ANIM_INFO.read(r, o)
        ai.v.update(vals)
        ai.fourcc = r.bytes(o, 4)
        if ptrs['ptr_anim_name'] is not None:
            ai.name, n, _, cap = NameBlock.read(r, ptrs['ptr_anim_name'])
            ai.name_meta = (n, cap)
        else:
            ai.name = None
        cp = ptrs['ptr_anim_chunks']
        ai.chunks = []
        for k in range(vals['num_anim_chunks'] if cp is not None else 0):
            p = r.ptr(cp + 4 * k)
            ai.chunks.append(self._read_anim_chunk(r, p) if p is not None else None)
        mlp = ptrs['ptr_material_list']
        ai.material_list = r.obj('matlist', mlp, MaterialList.read) if mlp is not None else None
        return ai

    def _read_header1(self, r):
        o = 12
        self.file_name, o = r.lstr(o)
        n = r.u32(o); o += 4
        toc = []
        for _ in range(n):
            name, o = r.lstr(o)
            idx = r.u32(o); o += 4
            na = r.u32(o); o += 4
            anims = []
            for _ in range(na):
                an, o = r.lstr(o)
                ai = r.u32(o); o += 4
                ns = r.u32(o); o += 4
                snd = [r.u32(o + 4 * k) for k in range(ns)]; o += 4 * ns
                flags = r.u32(o); o += 4
                anims.append((an, ai, snd, flags))
            nw = r.u32(o); o += 4
            walks = []
            for _ in range(nw):
                slots = []
                for _ in range(42):
                    b0 = r.u8(o)
                    if b0 >= 0x80:
                        slots.append(((b0 & 0x7F) << 8) | r.u8(o + 1)); o += 2
                    else:
                        slots.append(b0); o += 1
                wn = r.cstr(o, 4); o += 4
                walks.append((wn, slots))
            toc.append((name, idx, anims, walks))
        ns = r.u32(o); o += 4
        self.sounds = []
        for _ in range(ns):
            s = Sound()
            s.name, o = r.lstr(o)
            vals, _, o = SOUND.read(r, o)
            s.v.update(vals)
            s.group, o = r.lstr(o)
            self.sounds.append(s)
        nd = r.u32(o); o += 4
        dts = []
        for _ in range(nd):
            mi = r.u32(o); ai = r.u16(o + 4); o += 6
            d = DustTrail(anim_index=ai)
            d.name, o = r.lstr(o)
            d.start_frame = r.u32(o); o += 4
            ne = r.u32(o); o += 4
            for _ in range(ne):
                k, o = r.lstr(o)
                v, o = r.lstr(o)
                d.entries.append((k, v))
            dts.append((mi, d))
        n = r.u32(o); o += 4
        self.anim_groups = []
        for _ in range(n):
            s, o = r.lstr(o)
            self.anim_groups.append(s)
        n = r.u32(o); o += 4
        self.walk_transitions = []
        for _ in range(n):
            s, o = r.lstr(o)
            self.walk_transitions.append(s)
        self._toc_end = o
        # attach the table of contents to the models
        order = []
        for name, idx, anims, walks in toc:
            if idx >= len(self.models):
                self.warnings.append('table of contents: %s points at model %d of %d' % (name, idx, len(self.models)))
                continue
            m = self.models[idx]
            if m in order:
                self.warnings.append('table of contents: %s and %s share model %d' % (m.name, name, idx))
            order.append(m)
            m.name = name
            m.anim_names = []
            for an, ai, snd, flags in anims:
                e = AnimName(an, m.anims[ai] if ai < len(m.anims) else None)
                if e.anim is None:
                    self.warnings.append('%s: animation name %s points at animation %d of %d' % (name, an, ai, len(m.anims)))
                    e.anim_index = ai
                e.sounds = [self.sounds[i] for i in snd if i < len(self.sounds)]
                e.v['anim_flags'] = flags
                m.anim_names.append(e)
            m.walksets = []
            for wn, slots in walks:
                ws = WalkSet(wn)
                for k, s in enumerate(slots):
                    if k == WALK_TRANSITION_SLOT:
                        ws.slots[k] = s
                    else:
                        ws.slots[k] = m.anim_names[s - 1] if 0 < s <= len(m.anim_names) else None
                m.walksets.append(ws)
        if order != self.models:
            self.toc_order = order
        self.dusttrails = []
        for mi, d in dts:
            d.model = self.models[mi] if mi < len(self.models) else None
            if d.model is not None and d.anim_index < len(d.model.anim_names):
                d.anim = d.model.anim_names[d.anim_index]
            self.dusttrails.append(d)

    def _resolve_materials(self):
        lists = {id(m.material_list): m.material_list for m in self.models if m.material_list is not None}
        lists.update({id(a.material_list): a.material_list for a in self.anim_infos if a.material_list is not None})
        for m in self.models:
            for ma in m.anims:
                for _, a, _ in ma.tracks:
                    ml = getattr(a, 'material_list', None)
                    if ml is not None:
                        lists[id(ml)] = ml
        for ml in lists.values():
            ml.materials = [self.materials[i] if i < len(self.materials) else i for i in ml.indices]

    # ============================================================================================ queries
    def model(self, name):
        for m in self.models:
            if m.name == name:
                return m
        raise KeyError(name)

    def names(self):
        return [m.name for m in (self.toc_order or self.models)]

    def anim_chunks(self):
        """every animation chunk referenced by a model or an animation info, once"""
        seen, out = set(), []
        for m in self.models:
            for ma in m.anims:
                for _, a, _ in ma.tracks:
                    if id(a) not in seen:
                        seen.add(id(a)); out.append(a)
        for ai in self.anim_infos:
            for a in ai.chunks:
                if a is not None and id(a) not in seen:
                    seen.add(id(a)); out.append(a)
        return out

    # ============================================================================================ editing helpers
    def remove_model(self, model):
        self.models.remove(model)
        if self.toc_order is not None:
            self.toc_order.remove(model)
        self.dusttrails = [d for d in self.dusttrails if d.model is not model]
        self.prune_anim_infos()

    def add_model(self, model, after=None):
        if any(m.name == model.name for m in self.models):
            raise GsfError('the archive already has a model named %s' % model.name)
        i = len(self.models) if after is None else self.models.index(after) + 1
        self.models.insert(i, model)
        if self.toc_order is not None:
            self.toc_order.append(model)

    def copy_model(self, src, name, dusttrails=True):
        """add a copy of model `src` named `name`: its own copy of every component, mesh, collision volume, material
        list, walk set and animation table. Animation data, materials and sounds are shared with the original, as
        the game's archives share them between models anyway. dusttrails: copy the effects started by src's
        animations too."""
        new = self.duplicate_model(src, name)
        self.add_model(new)
        if dusttrails:
            for d in [d for d in self.dusttrails if d.model is src]:
                nd = DustTrail(d.name, new, d.anim_index)
                nd.anim = new.anim_name(d.anim.name) if d.anim is not None else None
                nd.start_frame = d.start_frame
                nd.entries = list(d.entries)
                self.dusttrails.append(nd)
        return new

    def duplicate_model(self, src, name):
        """a copy of model `src` named `name`, not added to the archive (see copy_model)"""
        import copy
        memo = {}
        for x in self.materials:
            memo[id(x)] = x
        for x in self.sounds:
            memo[id(x)] = x
        for ai in self.anim_infos:
            for c in ai.chunks:
                if c is not None:
                    memo[id(c)] = c
        for m in self.models:
            for ma in m.anims:
                for _, a, _ in ma.tracks:
                    memo[id(a)] = a
        new = copy.deepcopy(src, memo)
        new.name = name
        if new.object_name is not None:
            new.object_name = name
        new.object_name_meta = (None, None)
        return new

    def replace_model(self, old, new):
        i = self.models.index(old)
        self.models[i] = new
        if self.toc_order is not None:
            self.toc_order[self.toc_order.index(old)] = new
        for d in self.dusttrails:
            if d.model is old:
                d.model = new
                if d.anim is not None:
                    d.anim = new.anim_name(d.anim.name)
        self.prune_anim_infos()

    def remove_animation(self, model, anim_name):
        """remove a named animation; its animation data goes when nothing else uses it"""
        e = model.anim_name(anim_name) if isinstance(anim_name, str) else anim_name
        model.anim_names.remove(e)
        for ws in model.walksets:
            ws.slots = [None if s is e else s for s in ws.slots]
        self.dusttrails = [d for d in self.dusttrails if d.anim is not e]
        if e.anim is not None and not any(x.anim is e.anim for x in model.anim_names):
            model.anims.remove(e.anim)
        self.prune_anim_infos()

    def prune_anim_infos(self):
        """drop animation chunks from the animation infos that no model uses any more (and empty infos)"""
        used = set()
        for m in self.models:
            for ma in m.anims:
                for _, a, _ in ma.tracks:
                    used.add(id(a))
        keep = []
        for ai in self.anim_infos:
            ai.chunks = [a for a in ai.chunks if a is None or id(a) in used]
            if any(a is not None for a in ai.chunks):
                keep.append(ai)
        self.anim_infos = keep

    def material_index(self, mat):
        for i, m in enumerate(self.materials):
            if m is mat:
                return i
        self.materials.append(mat)
        return len(self.materials) - 1

    # ============================================================================================ writing
    def to_bytes(self):
        w = Writer()
        w.raw(MAGIC)
        w.u32(0)
        pos_h2 = w.tell()
        w.u32(0)                                  # patched below
        self._write_header1(w)
        h2 = max(0x10000, (w.tell() + 0xFFFF) & ~0xFFFF)
        w.pad_to(h2)
        struct.pack_into('<I', w.buf, pos_h2, h2)
        self._write_header2(w)
        return w.resolve()

    def save(self, path):
        data = self.to_bytes()
        with open(path, 'wb') as f:
            f.write(data)
        return len(data)

    def _prepare(self):
        # material lists back to indices (materials referenced by object)
        lists = {}
        for m in self.models:
            if m.material_list is not None:
                lists[id(m.material_list)] = m.material_list
            for ma in m.anims:
                for _, a, _ in ma.tracks:
                    ml = getattr(a, 'material_list', None)
                    if ml is not None:
                        lists[id(ml)] = ml
        for ai in self.anim_infos:
            if ai.material_list is not None:
                lists[id(ai.material_list)] = ai.material_list
        for ml in lists.values():
            if ml.materials is not None:
                ml.indices = [x if isinstance(x, int) else self.material_index(x) for x in ml.materials]
        for m in self.models:
            m.prepare()

    def _write_header1(self, w):
        models = self.toc_order or self.models
        index = {id(m): i for i, m in enumerate(self.models)}
        snd_index = {id(s): i for i, s in enumerate(self.sounds)}
        w.lstr(self.file_name)
        w.u32(len(models))
        for m in models:
            w.lstr(m.name)
            w.u32(index[id(m)])
            anim_pos = {id(ma): i for i, ma in enumerate(m.anims)}
            w.u32(len(m.anim_names))
            for e in m.anim_names:
                w.lstr(e.name)
                if e.anim is not None:
                    if id(e.anim) not in anim_pos:
                        raise GsfError('%s: animation %s is not in the model\'s animation table' % (m.name, e.name))
                    w.u32(anim_pos[id(e.anim)])
                else:
                    w.u32(getattr(e, 'anim_index', 0))
                sl = [snd_index[id(s)] for s in e.sounds if id(s) in snd_index]
                w.u32(len(sl))
                for s in sl:
                    w.u32(s)
                w.u32(e.v['anim_flags'])
            name_pos = {id(e): i + 1 for i, e in enumerate(m.anim_names)}
            w.u32(len(m.walksets))
            for ws in m.walksets:
                for k, s in enumerate(ws.slots):
                    if k == WALK_TRANSITION_SLOT:
                        v = int(s or 0)
                    else:
                        v = name_pos.get(id(s), 0) if s is not None else 0
                    if v >= 0x8000:
                        raise GsfError('walk set index too large')
                    if v >= 0x80:
                        w.u8(0x80 | (v >> 8)); w.u8(v & 0xFF)
                    else:
                        w.u8(v)
                w.cstr_fixed(ws.name, 4)
        w.u32(len(self.sounds))
        for s in self.sounds:
            w.lstr(s.name)
            SOUND.write(w, s.v)
            w.lstr(s.group)
        w.u32(len(self.dusttrails))
        for d in self.dusttrails:
            w.u32(index.get(id(d.model), 0) if d.model is not None else 0)
            if d.anim is not None and d.model is not None and d.anim in d.model.anim_names:
                w.u16(d.model.anim_names.index(d.anim))
            else:
                w.u16(d.anim_index)
            w.lstr(d.name)
            w.u32(d.start_frame)
            w.u32(len(d.entries))
            for k, v in d.entries:
                w.lstr(k)
                w.lstr(v)
        w.u32(len(self.anim_groups))
        for s in self.anim_groups:
            w.lstr(s)
        w.u32(len(self.walk_transitions))
        for s in self.walk_transitions:
            w.lstr(s)

    def _write_header2(self, w):
        self._prepare()
        self.prune_anim_infos_keep = None
        w.label('header2')
        v = self.h2
        v['num_models'] = v['num_model_infos'] = len(self.models)
        v['num_anims'] = v['num_anim_infos'] = len(self.anim_infos)
        HEADER2.write(w, v, {'ptr_model_infos': 'model_infos' if self.models else None,
                             'ptr_anim_infos': 'anim_infos' if self.anim_infos else None})
        w.label('materials_header')
        cap = max(self.materials_capacity, len(self.materials)) if self.materials_capacity else 0
        MATERIALS_HEADER.write(w, {'num_materials': len(self.materials), 'num_max_entries': cap},
                               {'ptr_materials': 'materials' if (self.materials or cap) else None})
        # model infos
        if self.models:
            w.label('model_infos')
            for m in self.models:
                w.label(key_of(m, 'info'))
                self._write_model_info(w, m)
        if self.anim_infos:
            w.align(4)
            w.label('anim_infos')
            for ai in self.anim_infos:
                self._write_anim_info(w, ai)
        if self.materials or cap:
            w.align(4)
            w.label('materials')
            for mat in self.materials:
                mat.write(w)
            for _ in range(cap - len(self.materials)):
                Material.write_empty(w)
        w.flush()

    def _write_model_info(self, w, m):
        keys = {}
        if m.object_name is not None:
            keys['ptr_object_name'] = k = key_of(m, 'name')
            n, cap = m.object_name_meta
            if n is not None and n != len(m.object_name.encode('latin-1', 'replace')) + 1:
                n = None
            w.need(k, lambda w, m=m, n=n, cap=cap: NameBlock.write(w, m.object_name, n, cap))
        keys['ptr_chunks_table'] = kc = key_of(m, 'chunks') if m.chunks else None

        def chunk_table(w, m=m):
            for c in m.chunks:
                if isinstance(c, Chunk):
                    w.ptr(w.need(key_of(c), c.write))
                elif isinstance(c, ZeroChunk):
                    w.ptr(w.need(key_of(c), lambda w, n=c.size: w.raw(b'\0' * n)))
                elif getattr(c, 'raw', None) in (0, 0x80000000):
                    w.u32(c.raw)            # an empty slot, written back exactly as it was
                else:
                    w.ptr(None)
        w.need(kc, chunk_table)
        if m.material_list is not None:
            keys['ptr_material_list'] = w.need(key_of(m.material_list), m.material_list.write)
        keys['ptr_collision_table'] = kcol = key_of(m, 'coll') if m.collision else None
        w.need(kcol, lambda w, m=m: [COLLISION.write(w, cv.v) for cv in m.collision])
        keys['ptr_anim_table'] = ka = key_of(m, 'anims') if m.anims else None

        def anim_table(w, m=m):
            for ma in m.anims:
                w.ptr(key_of(m, 'info'))
                pos = {id(c): i for i, c in enumerate(m.chunks)}
                slots = {}
                for c, a, n in ma.tracks:
                    if id(c) not in pos:
                        raise GsfError('%s: an animation moves a chunk the model does not have' % m.name)
                    slots[pos[id(c)]] = (a, n)
                count = max(slots) + 1 if slots else 0
                kt = key_of(ma, 't') if count else None
                w.ptr(kt)
                w.u32(count)

                def entries(w, slots=slots, count=count):
                    for j in range(count):
                        if j in slots:
                            a, n = slots[j]
                            w.ptr(w.need(key_of(a), a.write))
                            w.u32(n)
                        else:
                            w.ptr(None)
                            w.u32(0)
                w.need(kt, entries)
        w.need(ka, anim_table)
        keys['unk_ptr_waypoints'] = None
        MODEL_INFO.write(w, m.v, keys)

    def _write_anim_info(self, w, ai):
        keys = {}
        if ai.name is not None:
            keys['ptr_anim_name'] = k = key_of(ai, 'name')
            n, cap = ai.name_meta
            if n is not None and n != len(ai.name.encode('latin-1', 'replace')) + 1:
                n = None
            w.need(k, lambda w, ai=ai, n=n, cap=cap: NameBlock.write(w, ai.name, n, cap))
        ai.v['num_anim_chunks'] = len(ai.chunks)
        keys['ptr_anim_chunks'] = kc = key_of(ai, 'chunks') if ai.chunks else None

        def table(w, ai=ai):
            for a in ai.chunks:
                w.ptr(w.need(key_of(a), a.write) if a is not None else None)
        w.need(kc, table)
        if ai.material_list is not None:
            keys['ptr_material_list'] = w.need(key_of(ai.material_list), ai.material_list.write)
        pos = w.tell()
        ANIM_INFO.write(w, ai.v, keys)
        w.buf[pos:pos + 4] = (bytes(ai.fourcc) + b'\0\0\0\0')[:4] if isinstance(ai.fourcc, (bytes, bytearray)) \
            else (ai.fourcc.encode('latin-1') + b'\0\0\0\0')[:4]
