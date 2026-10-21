"""Blender scene -> GSF archive.

Saving an archive collection:
  1. the source archive is read again; models marked "Keep" are written exactly as they are there
  2. models marked "Edited" (and model roots of the collection that the source does not have) are built from the
     scene and replace / extend the source's models; models marked "Remove" are left out
  3. archive-wide data (sounds, dust trails, animation groups, walk transitions) comes from the collection
Normals are written the way SEK's exporter computed them: area-weighted face normals summed over the faces that share
a smoothing group at a vertex (Blender: faces joined by smooth edges), then the closest entry of the lookup sphere.
"""
import os

import bpy
import numpy as np
from mathutils import Matrix

from ..core import GsfArchive, GsfError
from ..core import normals as NRM
from ..core import vertex as VX
from ..core import names as NAMES
from ..core.archive import Model, ModelAnim, AnimName, WalkSet, Sound, DustTrail, CollisionVolume, AnimInfo, WALK_TRANSITION_SLOT
from ..core.chunks import KINDS, MeshData, Submesh, SkeletonChunk, Bone
from ..core.materials import MaterialList
from ..core.archive import SOUND
from . import props as P
from . import compat
from . import bonemath as BM
from . import anim as A
from .space import Space
from .materials import from_blender as material_from_blender, material_key
from .imp import geometry_signature

GROUP_OF = {'skeleton': 0, 'phys_coll': 1, 'particle': 2, 'link': 3, 'light_volume': 4}
SHAPES = {'SPHERE': 0, 'BOX': 1, 'TUBE': 2, 'ELLIPSOID': 3}


def fit_bbox(points, hint=None):
    """the quantisation box: the box stored with the mesh when every point still lies in it (an unchanged mesh then
    gets the same quantised positions as in the file), else the tight box of the points"""
    tight = VX.bbox_of(points)
    if hint is not None and len(hint) == 6:
        h = np.array(hint, dtype=np.float64)
        ext = np.maximum(h[3:] - h[:3], 1e-6)
        p = np.asarray(points, dtype=np.float64)
        if ((p >= h[:3] - 1e-4 * ext) & (p <= h[3:] + 1e-4 * ext)).all():
            return tuple(float(x) for x in h)
    return tight


def remap_bits(flags, pos):
    """move bit k to bit pos[k] (dropped when pos[k] is None); bits without an entry in pos stay"""
    out = 0
    for k in range(32):
        if flags >> k & 1:
            if k not in pos:
                out |= 1 << k
            elif pos[k] is not None and pos[k] < 32:
                out |= 1 << pos[k]
    return out


def descendants(obj):
    out = []
    for c in obj.children:
        out.append(c)
        out.extend(descendants(c))
    return out


def model_roots(col):
    """model root objects in an archive collection (any depth)"""
    roots = []

    def walk(c):
        for o in c.objects:
            if o.gsf_model.is_root and o not in roots:
                roots.append(o)
        for ch in c.children:
            walk(ch)
    walk(col)
    return roots


class Exporter:
    def __init__(self, col, normals='AUTO', apply_modifiers=True, prune_materials=True, log=print):
        self.col = col
        self.ga = col.gsf_archive
        self.space = Space(self.ga.mirror)
        self.normals = normals
        self.apply_modifiers = apply_modifiers
        self.prune_materials = prune_materials
        self.log = log
        self.warnings = []
        self.archive = None
        self.current_chunk = None
        self.mat_by_key = {}
        self.source_path = ''
        self.reuse_unchanged = True      # unchanged animations keep the file's data (exact, and shared between models)

    # ===================================================================================== archive
    def build(self):
        ga = self.ga
        src = bpy.path.abspath(ga.source_path) if ga.source_path else ''
        keep = [e for e in ga.entries if e.state == 'FILE']
        if src and os.path.isfile(src):
            a = GsfArchive.load(src)
            self.source_path = src
        else:
            if keep:
                raise GsfError('the source archive %s is missing - %d models are marked "Keep" and come from it'
                               % (src or '(none)', len(keep)))
            a = GsfArchive()
        self.archive = a
        for m in a.materials:
            self.mat_by_key.setdefault(material_key(m), m)
        a.file_name = ga.file_name or a.file_name
        a.materials_capacity = ga.materials_capacity
        P.from_props(ga, P.GSF_PG_archive.STRUCT, a.h2, 'archive')
        # Sounds, animation groups and walk transitions: the models kept from the file refer to them by their
        # position in the source archive, so they follow the entries that were moved, added or removed in Blender.
        # (Models written from the scene already refer to the new positions.)
        def new_pos(items, n_old):
            """{position in the source: position now} (None when removed)"""
            if not ga.lists_tracked:            # archives imported by add-on versions before 1.3: by position
                return {i: (i if i < len(items) else None) for i in range(n_old)}
            m = {i: None for i in range(n_old)}
            for k, it in enumerate(items):
                if 0 <= it.orig_index < n_old:
                    m[it.orig_index] = k
            return m
        old_index = {id(s): i for i, s in enumerate(a.sounds)}
        snd_map = new_pos(ga.sounds, len(a.sounds))
        sounds = []
        for it in ga.sounds:
            s = Sound(it.name, it.group)
            P.from_props(it.v, SOUND, s.v, 'sound')
            sounds.append(s)
        for m in a.models:
            for e in m.anim_names:
                e.sounds = [sounds[snd_map[old_index[id(s)]]] for s in e.sounds
                            if snd_map.get(old_index.get(id(s), -1)) is not None]
        a.sounds = sounds
        grp_map = new_pos(ga.anim_groups, len(a.anim_groups))
        if any(k != v for k, v in grp_map.items()):
            for m in a.models:
                for e in m.anim_names:
                    e.v['anim_flags'] = remap_bits(e.v['anim_flags'], grp_map)
        wt_map = new_pos(ga.walk_transitions, len(a.walk_transitions))
        if any(k != v for k, v in wt_map.items()):
            for m in a.models:
                for ws in m.walksets:
                    v = ws.slots[WALK_TRANSITION_SLOT] or 0      # 1-based, 0 = none
                    if 0 < v <= len(wt_map):
                        ws.slots[WALK_TRANSITION_SLOT] = 0 if wt_map[v - 1] is None else wt_map[v - 1] + 1
        a.anim_groups = [x.name for x in ga.anim_groups]
        a.walk_transitions = [x.name for x in ga.walk_transitions]
        # models
        by_name = {m.name: m for m in a.models}
        for e in ga.entries:
            if e.state == 'REMOVE' and e.name in by_name:
                a.remove_model(by_name.pop(e.name))
        roots = model_roots(self.col)
        for e in ga.entries:
            if e.state == 'SCENE' and (e.root is None or e.root not in roots) and e.name in by_name:
                self.warnings.append('%s is marked "Edited" but its root object is gone - kept from the file' % e.name)
        placed, placed_root = {}, {}     # entry name, root object name -> the model built from the scene
        for root in roots:
            g = root.gsf_model
            name = g.name or root.name
            own = next((e for e in ga.entries if e.root == root), None)
            if own is not None and own.state == 'FILE':
                continue        # set back to "Keep": the file's model is written, the objects in the scene are not
            try:
                model = self.build_model(root)
            except GsfError as ex:
                raise GsfError('%s: %s' % (name, ex))
            old = by_name.get(g.source_name) or by_name.get(name)
            entry = next((e for e in ga.entries if e.name == (g.source_name or name)), None)
            if entry is not None and entry.state == 'REMOVE':
                continue
            if old is not None:
                a.replace_model(old, model)
                by_name.pop(old.name, None)
            else:
                a.add_model(model)
            placed[g.source_name or name] = placed_root[root.name] = model
            self._anim_infos(model, root)
        # a rearranged list: the archive takes its order (model infos and table of contents alike); models without
        # an entry stay behind them in their order
        if ga.order_changed:
            kept = {m.name: m for m in a.models}
            order, seen = [], set()
            for e in ga.entries:
                if e.state == 'REMOVE':
                    continue
                m = (placed_root.get(e.root.name) if e.root is not None else None) or placed.get(e.name) or kept.get(e.name)
                if m is not None and id(m) not in seen:
                    order.append(m)
                    seen.add(id(m))
            order += [m for m in a.models if id(m) not in seen]
            a.models = order
            a.toc_order = None
        # dust trails
        models = {m.name: m for m in a.models}
        a.dusttrails = []
        for it in ga.dusttrails:
            m = models.get(it.model)
            if m is None:
                self.warnings.append('dust trail %s: model %s not in the archive - left out' % (it.name, it.model))
                continue
            d = DustTrail(it.name, m, it.anim_index)
            d.anim = m.anim_name(it.anim) if it.anim else None
            if it.anim and d.anim is None:
                self.warnings.append('dust trail %s: %s has no animation %s' % (it.name, m.name, it.anim))
            d.start_frame = it.start_frame
            d.entries = [(kv.name, kv.value) for kv in it.entries]
            a.dusttrails.append(d)
        a.prune_anim_infos()
        if self.prune_materials:
            self._prune_materials(a)
        return a

    def save(self, path):
        a = self.build()
        n = a.save(path)
        return n

    def _prune_materials(self, a):
        used = []
        seen = set()

        def add(ml):
            if ml is None or ml.materials is None:
                return
            for x in ml.materials:
                if not isinstance(x, int) and id(x) not in seen:
                    seen.add(id(x))
                    used.append(x)
        for m in a.models:
            add(m.material_list)
            for ma in m.anims:
                for _, an, _ in ma.tracks:
                    add(getattr(an, 'material_list', None))
        for ai in a.anim_infos:
            add(ai.material_list)
        if any(isinstance(x, int) for m in a.models if m.material_list is not None and m.material_list.materials
               for x in m.material_list.materials):
            return          # raw indices past the table (modded archives): keep the table as it is
        order = {id(x): i for i, x in enumerate(a.materials)}
        a.materials = sorted(used, key=lambda x: order.get(id(x), 1 << 30))

    def _anim_infos(self, model, root):
        a = self.archive
        existing = {tuple(sorted(id(c) for c in ai.chunks if c is not None)) for ai in a.anim_infos}
        g = root.gsf_model
        for e, it in zip(model.anim_names, [x for x in g.anims]):
            if e.anim is None:
                continue
            chunks = []
            for _, an, _ in e.anim.tracks:
                if an not in chunks:
                    chunks.append(an)
            key = tuple(sorted(id(c) for c in chunks))
            if not chunks or key in existing:
                continue
            existing.add(key)
            ai = AnimInfo(it.info_name or 'Helper01')
            first = next((t.action for t in it.tracks if t.action is not None), None)
            fc = first.gsf.info_fourcc if first is not None else ''
            ai.fourcc = (fc or model.fourcc).encode('latin-1', 'replace')[:4].ljust(4, b'\0')
            ai.chunks = chunks
            ai.v['num_frames'] = e.anim.frames()
            mls = [getattr(c, 'material_list', None) for c in chunks]
            ai.material_list = next((x for x in mls if x is not None), None)
            a.anim_infos.append(ai)

    # ===================================================================================== helpers
    def rest_matrix(self, obj):
        """placement of `obj` relative to the model root in the rest pose (Blender space)"""
        ad = obj.animation_data
        stored = obj.get('gsf_rest_matrix')
        if ad is not None and ad.action is not None and stored is not None and len(stored) == 16:
            local = Matrix([stored[0:4], stored[4:8], stored[8:12], stored[12:16]])
            return local
        return self.root_inv @ obj.matrix_world

    def material_for(self, bm):
        """Blender material -> core Material of the archive (shared with identical ones)"""
        if bm is None:
            m = material_from_blender(None, self.warnings.append)
        else:
            m = material_from_blender(bm, self.warnings.append)
        k = material_key(m)
        if k in self.mat_by_key:
            return self.mat_by_key[k]
        self.mat_by_key[k] = m
        self.archive.materials.append(m)
        return m

    def model_material(self, bm):
        """index of a Blender material in the model's material list (added when new)"""
        key = bm.name if bm is not None else None
        if key not in self.model_mats:
            self.model_mats[key] = len(self.model_mat_list)
            self.model_mat_list.append(bm)
        return self.model_mats[key]

    def material_list_for(self, bms):
        ml = MaterialList()
        ml.materials = [self.material_for(bm) for bm in bms]
        ml.indices = [0] * len(ml.materials)
        return ml

    # ===================================================================================== model
    def build_model(self, root):
        g = root.gsf_model
        m = Model(g.name or root.name)
        P.from_props(g, P.GSF_PG_model.STRUCT, m.v, 'model')
        m.object_name = (g.object_name or m.name) if g.has_object_name else None
        if g.object_name == '' and g.has_object_name:
            m.object_name = m.name
        self.root = root
        self.root_inv = root.matrix_world.inverted()
        self.model_mats = {}
        self.model_mat_list = []
        for it in g.materials:
            self.model_material(it.material)
        objs = [o for o in descendants(root) if o.gsf.kind != 'NONE']
        arms = [o for o in objs if o.type == 'ARMATURE']
        saved = [(o, o.data.pose_position) for o in arms]
        for o in arms:
            o.data.pose_position = 'REST'
        bpy.context.view_layer.update()
        depsgraph = bpy.context.evaluated_depsgraph_get()
        self.depsgraph = depsgraph
        try:
            chunk_objs = [o for o in objs if o.gsf.kind != 'COLLISION']
            chunk_objs.sort(key=lambda o: (GROUP_OF.get(o.gsf.kind.lower(), 5 if self._is_cloth(o) else 9), o.gsf.order, o.name))
            self.skels = {}
            obj_chunk = {}
            for o in chunk_objs:
                if o.gsf.kind == 'SKELETON':
                    obj_chunk[o] = self.skeleton_chunk(o)
            for o in chunk_objs:
                if o in obj_chunk:
                    continue
                fn = EXPORTERS.get(o.gsf.kind.lower())
                if fn is None:
                    self.warnings.append('%s: no exporter for %s' % (o.name, o.gsf.kind))
                    continue
                c = fn(self, o)
                if c is not None:
                    obj_chunk[o] = c
            m.chunks = [obj_chunk[o] for o in chunk_objs if o in obj_chunk]
            self._refs(obj_chunk)
            m.collision = [self.collision(o) for o in sorted((o for o in objs if o.gsf.kind == 'COLLISION'),
                                                               key=lambda o: (o.gsf.order, o.name))]
            m.material_list = self.material_list_for(self.model_mat_list)
            if g.auto_bbox:
                m.v['bounding_box'] = self._bbox(chunk_objs)
            else:
                m.v['bounding_box'] = tuple(g.bbox)
            self._model_anims(m, root, obj_chunk)
        finally:
            for o, p in saved:
                o.data.pose_position = p
            bpy.context.view_layer.update()
        m.prepare()
        return m

    def _is_cloth(self, o):
        if o.gsf.kind != 'MESH':
            return False
        return P.parse_hex(o.gsf.p_mesh.type_id) & 0xFF == 9

    def _bbox(self, objs):
        pts = []
        for o in objs:
            if o.type == 'MESH' and len(o.data.vertices):
                M = self.rest_matrix(o) if o.parent_type != 'BONE' else self.root_inv @ o.matrix_world
                co = np.zeros(len(o.data.vertices) * 3, dtype=np.float32)
                o.data.vertices.foreach_get('co', co)
                co = co.reshape(-1, 3).astype(np.float64)
                Mn = np.array(M)
                p = co @ Mn[:3, :3].T + Mn[:3, 3]
                pts.append(p * np.array(self.space.s3))
        if not pts:
            return (0.0,) * 6
        p = np.concatenate(pts)
        return tuple(float(x) for x in p.min(0)) + tuple(float(x) for x in p.max(0))

    def _refs(self, obj_chunk):
        for o, c in obj_chunk.items():
            for field in c.REFS:
                if field not in c.v:
                    continue
                t = None
                if field == 'skeleton_index':
                    if o.parent is not None and o.parent.type == 'ARMATURE' and o.parent in obj_chunk:
                        t = o.parent
                    else:
                        t = P.get_ref(o.gsf, field)
                else:
                    t = P.get_ref(o.gsf, field)
                c.refs[field] = obj_chunk.get(t) if t is not None else None
                if field == 'skeleton_index' and c.refs[field] is None:
                    sk = next((x for x in obj_chunk.values() if x.KIND == 'skeleton'), None)
                    c.refs[field] = sk
                    if sk is None:
                        self.warnings.append('%s: skinned, but the model has no skeleton' % o.name)

    def snap_xform(self, o, c):
        """placement fields that equal the file's values up to Blender's precision get the file's exact values"""
        for f in c.STRUCT.fields:
            if not f.xform or f.name not in c.v:
                continue
            old = o.get('gsf_xform_' + f.name)
            if old is None:
                continue
            new = np.atleast_1d(np.array(c.v[f.name], dtype=np.float64))
            old = np.array(old, dtype=np.float64)
            if old.shape != new.shape:
                continue
            tol = 2e-5 * max(1.0, np.abs(old).max())
            d = np.abs(old - new).max()
            if f.kind == 'quat':
                d = min(d, np.abs(old + new).max())
            if d < tol:
                c.v[f.name] = tuple(float(x) for x in old)

    def _common(self, o, c):
        g = o.gsf
        c.v['attributes'] = P.bits_to_int(g.attributes)
        c.v['guid'] = P.parse_hex(g.guid) if g.guid.strip() else NAMES.crc32(o.name.split('.', 1)[-1])
        pg = getattr(g, 'p_' + c.KIND)
        P.from_props(pg, c.STRUCT, c.v, c.KIND, c.ctx)

    def _variant(self, o, kind, skinned):
        """chunk type: from the properties; switched to the skinned / static variant the object's setup calls for"""
        cls = KINDS[kind]
        t = P.parse_hex(getattr(o.gsf, 'p_' + kind).type_id, next(iter(cls.TYPE_IDS)))
        if t not in cls.TYPE_IDS:
            t = next(iter(cls.TYPE_IDS))
        ctx = cls.TYPE_IDS[t]
        if skinned is not None and 'skinned' in ctx and ctx['skinned'] != skinned and kind != 'mesh':
            t = next(tt for tt, cc in cls.TYPE_IDS.items() if cc['skinned'] == skinned)
        return t

    def _bone_ref(self, o, c):
        """components that follow one bone: bone ids / weights from the bone parent"""
        if o.parent_type == 'BONE' and o.parent is not None and o.parent in self.skels:
            names = self.skels[o.parent]['names']
            if o.parent_bone in names:
                c.v['bone_ids'] = (names.index(o.parent_bone), 255, 255, 255)
                c.v['bone_weights'] = (255, 0, 0, 0)

    def _skinned(self, o):
        return o.parent_type == 'BONE' or (o.parent is not None and o.parent.type == 'ARMATURE' and
                                           any(md.type == 'ARMATURE' for md in getattr(o, 'modifiers', [])))

    # ===================================================================================== skeleton
    def skeleton_chunk(self, o):
        arm = o.data
        M = np.array(self.space.S)
        Mrel = np.array(self.root_inv @ o.matrix_world)
        # armatures imported by add-on versions before 1.4 have the old, fixed bone axis
        legacy = 'gsf_bind_poses' in o and int(o.get('gsf_bone_axis', 1)) < BM.AXIS_VERSION
        roots = sorted([b for b in arm.bones if b.parent is None], key=lambda b: (b.gsf.order, b.name))
        order = []

        def walk(b):
            order.append(b)
            for ch in sorted(b.children, key=lambda x: (x.gsf.order, x.name)):
                walk(ch)
        for b in roots:
            walk(b)
        if len(roots) > 1:
            self.warnings.append('%s: %d root bones - the game expects one' % (o.name, len(roots)))
        names = [b.name for b in order]
        idx = {n: i for i, n in enumerate(names)}
        parent = np.array([idx[b.parent.name] if b.parent else -1 for b in order])
        Bl = np.array([Mrel @ np.array(b.matrix_local) for b in order])
        sg = np.array([-1.0 if all(x < 0 for x in b.gsf.scale) else 1.0 for b in order])
        det = np.ones(len(order))
        for k in range(len(order)):
            det[k] = sg[k] * (det[parent[k]] if parent[k] >= 0 else 1.0)
        W = BM.from_blender(Bl, det, M, legacy)
        bones = []
        for k, b in enumerate(order):
            Lk = W[k] if parent[k] < 0 else np.linalg.inv(W[parent[k]]) @ W[k]
            R = Lk[:3, :3] * sg[k]
            s = np.linalg.norm(R, axis=0)
            R = R / np.where(s < 1e-12, 1, s)
            pos = Lk[:3, 3] * sg[k]
            q = BM.mat_to_gsf_quat(R[None])[0]
            if b.gsf.has_rest:
                rp, rq = np.array(b.gsf.rest_pos, dtype=np.float64), np.array(b.gsf.rest_rot, dtype=np.float64)
                tol = 1e-3 * max(1.0, np.abs(rp).max())
                if np.abs(pos - rp).max() < tol and min(np.abs(q - rq).max(), np.abs(q + rq).max()) < 1e-3:
                    pos, q = rp, rq          # not moved: the file's exact values
            bo = Bone()
            bo.v['guid'] = P.parse_hex(b.gsf.guid) if b.gsf.guid.strip() else NAMES.guid_from_bone_name(b.name)
            bo.v['flags'] = P.parse_hex(b.gsf.flags)
            bo.v['pos'] = tuple(float(x) for x in pos)
            bo.v['scale'] = tuple(float(x) for x in b.gsf.scale)
            bo.v['rot'] = tuple(float(x) for x in q)
            bones.append(bo)
            if parent[k] >= 0:
                bones[parent[k]].children.append(bo)
        c = SkeletonChunk()
        self._common(o, c)
        c.root = bones[0] if bones else Bone()
        # inverse bind matrices: the rest pose (the original ones when the skeleton did not change)
        sk = BM.Skeleton(c)
        sk.legacy = legacy
        bind = np.array([np.linalg.inv(sk.world[k]).T.reshape(-1) for k in range(sk.n)], dtype=np.float32)
        orig = o.get('gsf_bind_poses')
        if orig is not None and len(orig) == bind.size:
            ob = np.array(orig, dtype=np.float32).reshape(-1, 16)
            if np.abs(ob - bind).max() < 1e-3:
                bind = ob
        c.bind_poses = bind
        for extra in getattr(o, 'children', []):
            pass
        # the rest pose the animations are relative to: from the written skeleton (exact for unchanged bones)
        self.skels[o] = dict(chunk=c, names=names, sk=sk, B=BM.to_blender(sk.world, sk.det, M, legacy), obj=o)
        return c

    # ===================================================================================== meshes
    def _eval_mesh(self, o):
        if self.apply_modifiers:
            oe = o.evaluated_get(self.depsgraph)
            me = oe.to_mesh()
            return me, lambda: oe.to_mesh_clear()
        return o.data, lambda: None

    def mesh_chunk(self, o):
        skinned_vertex = o.parent is not None and o.parent.type == 'ARMATURE' and o.parent_type != 'BONE' and \
            any(md.type == 'ARMATURE' for md in o.modifiers) and len(o.vertex_groups) > 0
        t = P.parse_hex(o.gsf.p_mesh.type_id, 0)
        cls = KINDS['mesh']
        if t not in cls.TYPE_IDS:
            t = 0
        cloth = cls.TYPE_IDS[t]['cloth']
        if skinned_vertex:
            t = 0x80000009 if cloth else 0x80000000
        elif o.parent_type == 'BONE' and o.parent in self.skels:
            t = 0x20000009 if cloth else 0x20000000
        elif cls.TYPE_IDS[t]['skin'] == 1 and o.parent is not None and o.parent.type != 'ARMATURE' and not P.get_ref(o.gsf, 'skeleton_index'):
            t = 9 if cloth else 0
        c = cls(t)
        self._common(o, c)
        self._bone_ref(o, c)
        self.current_chunk = c
        local = self.rest_matrix(o)
        c.v['transform'] = tuple(self.space.matrix_back(local))
        self.snap_xform(o, c)
        skin = None
        if c.skin == 1:
            arm = o.parent if (o.parent is not None and o.parent in self.skels) else None
            if arm is None:
                ref = P.get_ref(o.gsf, 'skeleton_index')
                if ref is not None and ref in self.skels:
                    arm = ref
            skin = self.skels[arm]['names'] if arm is not None else ['bone_%d' % k for k in range(255)]
        me, done = self._eval_mesh(o)
        try:
            mats = [s.material for s in o.material_slots] or [None]
            c.mesh, _ = self.mesh_data_from_mesh(me, o, mats, c, skin, self.warnings.append, cloth=c.is_cloth,
                                                 bbox_hint=o.data.get('gsf_bbox'), orig=o.data,
                                                 modified=self.apply_modifiers and any(
                                                     md.type != 'ARMATURE' and md.show_viewport for md in o.modifiers))
        finally:
            done()
        if c.is_cloth:
            for attr in ('points_a', 'points_b'):
                v = o.get('gsf_' + attr)
                setattr(c, attr, np.array(v, dtype=np.float32).reshape(-1, 3) if v is not None and len(v) else None)
            for k, s in enumerate(c.mesh.submeshes):
                v = o.get('gsf_cloth_triples_%d' % k)
                s.cloth_triples = np.array(v, dtype=np.uint16).reshape(-1, 3) if v is not None else None
        return c

    def _corner_normals_game(self, me, tri_loops):
        """SEK's way: area-weighted triangle normals summed over the smooth fan at each corner"""
        nl = len(me.loops)
        co = np.zeros(len(me.vertices) * 3, dtype=np.float64)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        lv = np.zeros(nl, dtype=np.int64)
        me.loops.foreach_get('vertex_index', lv)
        le = np.zeros(nl, dtype=np.int64)
        me.loops.foreach_get('edge_index', le)
        np_ = len(me.polygons)
        ps = np.zeros(np_, dtype=np.int64)
        pt = np.zeros(np_, dtype=np.int64)
        me.polygons.foreach_get('loop_start', ps)
        me.polygons.foreach_get('loop_total', pt)
        smooth = np.zeros(np_, dtype=bool)
        me.polygons.foreach_get('use_smooth', smooth)
        sharp = compat.get_sharp_edges(me)
        # union-find over loops
        parent = np.arange(nl)

        def find(x):
            r = x
            while parent[r] != r:
                r = parent[r]
            while parent[x] != r:
                parent[x], x = r, parent[x]
            return r
        edge_users = {}
        for p in range(np_):
            if not smooth[p]:
                continue
            s, n = ps[p], pt[p]
            for k in range(n):
                l = s + k
                ln = s + (k + 1) % n
                e = le[l]
                if sharp[e]:
                    continue
                edge_users.setdefault(e, []).append((lv[l], l, lv[ln], ln))
        for e, users in edge_users.items():
            if len(users) < 2:
                continue
            a0 = users[0]
            for u in users[1:]:
                for va, la in ((a0[0], a0[1]), (a0[2], a0[3])):
                    lb = u[1] if u[0] == va else u[3]
                    ra, rb = find(la), find(lb)
                    if ra != rb:
                        parent[ra] = rb
        roots = np.array([find(l) for l in range(nl)])
        p0, p1, p2 = co[lv[tri_loops[:, 0]]], co[lv[tri_loops[:, 1]]], co[lv[tri_loops[:, 2]]]
        fn = np.cross(p0 - p1, p0 - p2)
        bad = np.linalg.norm(fn, axis=1) < 1e-5
        fn[bad] = (1.0, 0.0, 0.0)
        acc = np.zeros((nl, 3))
        for k in range(3):
            np.add.at(acc, roots[tri_loops[:, k]], fn)
        out = acc[roots]
        ln = np.linalg.norm(out, axis=1, keepdims=True)
        ln[ln < 1e-12] = 1
        return out / ln

    def _vertex_bones(self, o, me, names):
        """per vertex: 4 bone ids (depth-first index) and weights (sum 255)"""
        nv = len(me.vertices)
        ids = np.full((nv, 4), 255, dtype=np.uint8)
        ws = np.zeros((nv, 4), dtype=np.uint8)
        if names is None:
            return ids, ws
        gi = {}
        for vg in o.vertex_groups:
            if vg.name in names:
                gi[vg.index] = names.index(vg.name)
            elif vg.name.startswith('bone_') and vg.name[5:].isdigit():
                gi[vg.index] = int(vg.name[5:])
        nolink = 0
        for v in me.vertices:
            lst = sorted(((g.weight, gi[g.group]) for g in v.groups if g.group in gi and g.weight > 0), reverse=True)[:4]
            if not lst:
                nolink += 1
                continue
            tot = sum(w for w, _ in lst)
            q = [int(round(w / tot * 255)) for w, _ in lst]
            q[0] += 255 - sum(q)
            for k, (w, b) in enumerate(lst):
                ids[v.index, k] = b
                ws[v.index, k] = q[k]
        if nolink:
            self.warnings.append('%s: %d vertices without bone weights' % (o.name, nolink))
        return ids, ws

    def mesh_data_from_mesh(self, me, o, mats, chunk, skin, warn, cloth=False, material_index=None, bbox_hint=None,
                            orig=None, modified=False):
        """Blender mesh (object space) -> MeshData; mats: material per slot. material_index(bm) -> index in the
        material list the submeshes refer to (default: the model's list)"""
        S = self.space
        material_index = material_index or self.model_material
        me.calc_loop_triangles()
        nt = len(me.loop_triangles)
        tri_loops = np.zeros(nt * 3, dtype=np.int64)
        me.loop_triangles.foreach_get('loops', tri_loops)
        tri_loops = tri_loops.reshape(-1, 3)
        tri_mat = np.zeros(nt, dtype=np.int64)
        me.loop_triangles.foreach_get('material_index', tri_mat)
        nl = len(me.loops)
        lv = np.zeros(nl, dtype=np.int64)
        me.loops.foreach_get('vertex_index', lv)
        co = np.zeros(len(me.vertices) * 3, dtype=np.float64)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3) * np.array(S.s3)                  # GSF space
        # normals: AUTO = meshes not edited since the import keep the file's normals, others are computed like the game
        mode = self.normals
        if mode == 'AUTO':
            src = orig if orig is not None else me
            unchanged = src.get('gsf_geometry') is not None and src.get('gsf_geometry') == geometry_signature(src) and \
                (orig is None or not modified)
            mode = 'STORED' if unchanged else 'GAME'
        if mode in ('CUSTOM', 'STORED'):
            ln = compat.corner_normals(me).astype(np.float64)
        else:
            ln = self._corner_normals_game(me, tri_loops) if nt else np.zeros((nl, 3))
        lng = ln * np.array(S.s3)
        nidx = NRM.encode(lng) if nl else np.zeros(0, np.uint16)
        na = me.attributes.get('gsf_normal')
        if mode in ('CUSTOM', 'STORED') and na is not None and na.domain == 'CORNER' and len(na.data) == nl:
            # the file's index where it still fits the corner normal, and on faces without area (no usable normal)
            st = np.zeros(nl, dtype=np.int64)
            na.data.foreach_get('value', st)
            st = np.clip(st, 0, NRM.SPHERE_SIZE - 1)
            fits = (NRM.SPHERE[st] * lng).sum(1) > 0.97
            area = np.zeros(len(me.polygons), dtype=np.float32)
            me.polygons.foreach_get('area', area)
            tot = np.zeros(len(me.polygons), dtype=np.int64)
            me.polygons.foreach_get('loop_total', tot)
            pl = np.repeat(np.arange(len(me.polygons)), tot)
            flat = area[pl] < 1e-10
            use = fits | flat | (mode == 'STORED')       # unedited mesh: the file's indices as they are
            nidx = np.where(use, st, nidx).astype(np.uint16)
        # texture coordinates
        uvl = me.uv_layers.active or (me.uv_layers[0] if len(me.uv_layers) else None)
        uv = np.zeros(nl * 2, dtype=np.float32)
        if uvl is not None:
            uvl.data.foreach_get('uv', uv)
        uv = uv.reshape(-1, 2).astype(np.float64)
        ext = chunk is not None and getattr(chunk, 'extended_uv', False)
        baked = chunk is not None and getattr(chunk, 'baked_light', False)
        lim = (1023 / 1024.0) if ext else 1.0
        if nl and (uv.min() < -1e-4 or uv.max() > lim + 1e-4):
            warn('%s: texture coordinates outside 0..1 are clamped' % o.name)
        uv8, uvhi = VX.uv_from_float(uv, ext)
        extra = uvhi if ext else None
        if baked:
            a = me.color_attributes.get('gsf_baked_light')
            vals = np.full(nl, 255, dtype=np.int64)
            if a is not None:
                col = np.zeros(len(a.data) * 4, dtype=np.float32)
                a.data.foreach_get('color', col)
                g = np.rint(col.reshape(-1, 4)[:, 0] * 255).astype(np.int64)
                vals = g[lv] if a.domain == 'POINT' else g
            extra = np.clip(vals, 0, 255).astype(np.uint8)
        tang = None
        ta = me.attributes.get('gsf_tangent')
        if ta is not None and (chunk is None or getattr(o.gsf, 'keep_tangents', True)):
            t = np.zeros(len(ta.data), dtype=np.int64)
            ta.data.foreach_get('value', t)
            tang = (t[lv] if ta.domain == 'POINT' else t).astype(np.int64)
        bid, bw = self._vertex_bones(o, me, skin) if skin is not None else (None, None)
        stride = 8 + (8 if skin is not None else 0) + (1 if extra is not None else 0)
        if chunk is not None and hasattr(chunk, 'vertex_size'):
            stride = chunk.vertex_size()
            if stride in (9, 17) and extra is None:
                extra = np.zeros(nl, dtype=np.uint8)
        if S.flip:
            tri_loops = tri_loops[:, [0, 2, 1]]
        md = MeshData(cloth)
        # bounding box over every used vertex
        used = np.unique(lv[tri_loops.reshape(-1)]) if nt else np.zeros(0, np.int64)
        md.v['bounding_box'] = fit_bbox(co[used], bbox_hint) if len(used) else (0.0,) * 6
        qpos = VX.quantize(co, md.v['bounding_box'])
        qa = me.attributes.get('gsf_q')
        if qa is not None and qa.domain == 'POINT' and bbox_hint is not None and \
                tuple(md.v['bounding_box']) == tuple(float(x) for x in bbox_hint):
            # vertices that did not move keep the file's quantised value (float32 positions in Blender can round a
            # nearly flat axis to the next step)
            qs = np.zeros(len(me.vertices) * 3, dtype=np.float32)
            qa.data.foreach_get('vector', qs)
            qs = np.rint(qs.reshape(-1, 3)).astype(np.int64)
            back = VX.dequantize(qs, md.v['bounding_box'])
            ext = np.array(md.v['bounding_box'][3:]) - np.array(md.v['bounding_box'][:3])
            step = np.maximum(ext / 8191.0, 1e-9)
            same = (np.abs(back - co) <= 0.5 * step + 1e-6 * np.maximum(np.abs(co), 1)).all(1) & (qs >= 0).all(1) & (qs <= 8191).all(1)
            qpos[same] = qs[same]
        used_slots = []
        degenerate = {}
        for item in str(me.get('gsf_degenerate', '') or (o.data.get('gsf_degenerate', '') if o is not None and o.type == 'MESH' else '')).split(';'):
            if ':' in item:
                k, hx = item.split(':', 1)
                degenerate.setdefault(int(k), []).append(bytes.fromhex(hx))
        for slot in range(max(len(mats), 1)):
            sel = np.where(tri_mat == slot)[0]
            if not len(sel) and slot not in degenerate:
                continue
            if not len(sel):
                s = Submesh(cloth)
                s.stride = stride
                s.raw = np.zeros((0, stride), dtype=np.uint8)
                self._add_degenerate(s, degenerate.pop(slot), md.v['bounding_box'], bbox_hint, stride)
                s.v['bounding_box'] = VX.bbox_of(VX.dequantize(VX.decode_mesh(s.raw)['q'], md.v['bounding_box']))
                md.submeshes.append(s)
                md.submesh_materials.append(self._slot_index(me, o, mats, slot, material_index))
                used_slots.append(slot)
                continue
            corners = tri_loops[sel].reshape(-1)
            cols = [lv[corners], nidx[corners].astype(np.int64), uv8[corners, 0].astype(np.int64), uv8[corners, 1].astype(np.int64)]
            if extra is not None:
                cols.append(extra[corners].astype(np.int64))
            if tang is not None:
                cols.append(tang[corners])
            key = np.stack(cols, 1)
            uk, inv = np.unique(key, axis=0, return_inverse=True)
            inv = inv.reshape(-1)
            tri = inv.reshape(-1, 3)
            # split above 65535 vertices
            start = 0
            while start < len(tri):
                if len(uk) <= 65535:
                    part, sub_uk = tri, uk
                    start = len(tri)
                else:
                    end = start
                    seen = {}
                    while end < len(tri) and len(seen) + 3 <= 65535:
                        for x in tri[end]:
                            seen.setdefault(int(x), len(seen))
                        end += 1
                    remap = np.array(sorted(seen, key=seen.get))
                    lookup = np.full(len(uk), -1)
                    lookup[remap] = np.arange(len(remap))
                    part, sub_uk = lookup[tri[start:end]], uk[remap]
                    start = end
                s = Submesh(cloth)
                vi = sub_uk[:, 0]
                f = {'q': qpos[vi], 'normal': sub_uk[:, 1], 'uv': np.stack([sub_uk[:, 2], sub_uk[:, 3]], 1)}
                c = 4
                if extra is not None:
                    f['extra'] = sub_uk[:, c]
                    c += 1
                if skin is not None:
                    f['bone_ids'] = bid[vi]
                    f['bone_weights'] = bw[vi]
                s.stride = stride
                s.raw = VX.encode_mesh(f, stride)
                s.tris = part.astype(np.uint16)
                if tang is not None and not cloth:
                    s.tangents = sub_uk[:, c].astype(np.uint16) if (sub_uk[:, c] >= 0).any() else None
                s.v['bounding_box'] = VX.bbox_of(co[vi])
                if slot in degenerate and start >= len(tri):
                    self._add_degenerate(s, degenerate.pop(slot), md.v['bounding_box'], bbox_hint, stride)
                md.submeshes.append(s)
                md.submesh_materials.append(self._slot_index(me, o, mats, slot, material_index))
                used_slots.append(slot)
        return md, used_slots

    def _slot_index(self, me, o, mats, slot, material_index):
        bm = mats[slot] if slot < len(mats) else None
        if bm is None:
            raw = me.get('gsf_raw_material_%d' % slot)
            if raw is None and o is not None and o.type == 'MESH':
                raw = o.data.get('gsf_raw_material_%d' % slot)
            if raw is not None:
                return int(raw)
        return material_index(bm)

    def _add_degenerate(self, s, items, bbox, hint, stride):
        """append the triangles that repeat a vertex (kept from the file) to a submesh"""
        for raw3 in items:
            n = len(raw3) // 3
            raw = np.frombuffer(raw3, dtype=np.uint8).reshape(3, n)
            f = VX.decode_mesh(raw)
            if hint is not None and len(hint) == 6:
                f['q'] = VX.quantize(VX.dequantize(f['q'], hint), bbox)
            if stride < 16:
                f.pop('bone_ids', None)
                f.pop('bone_weights', None)
            base = len(s.raw)
            s.raw = np.concatenate([s.raw, VX.encode_mesh(f, stride)]) if len(s.raw) else VX.encode_mesh(f, stride)
            # the repeated corner: the file's triangle referenced one vertex twice
            a, b, c = raw[0].tobytes(), raw[1].tobytes(), raw[2].tobytes()
            idx = [base, base + 1 if b != a else base, base + 2 if c not in (a, b) else (base if c == a else base + 1)]
            s.tris = np.concatenate([s.tris, np.array([idx], dtype=np.uint16)]) if len(s.tris) else np.array([idx], dtype=np.uint16)

    # ===================================================================================== simple chunks
    def link_chunk(self, o):
        t = self._variant(o, 'link', self._skinned(o))
        c = KINDS['link'](t)
        self._common(o, c)
        self._bone_ref(o, c)
        M = self.rest_matrix(o)
        c.v['pos'] = self.space.point_back(M.to_translation())
        c.v['rot'] = self.space.quat_back(M.to_3x3().normalized())
        self.snap_xform(o, c)
        return c

    def speedline_chunk(self, o):
        t = self._variant(o, 'speedline', self._skinned(o))
        c = KINDS['speedline'](t)
        self._common(o, c)
        self._bone_ref(o, c)
        M = self.rest_matrix(o)
        c.v['pos'] = self.space.point_back(M.to_translation())
        c.v['rot'] = self.space.quat_back(M.to_3x3().normalized())
        self.snap_xform(o, c)
        c.v['tile_material'] = self.model_material(o.gsf.material) if o.gsf.material is not None else 0
        return c

    def _snap_size(self, o, c):
        old = o.get('gsf_size')
        if old is not None and np.abs(np.array(old) - np.array(c.v['size'])).max() < 2e-5 * max(1.0, np.abs(np.array(old)).max()):
            c.v['size'] = tuple(float(x) for x in old)

    def _volume_values(self, o, shape):
        M = self.rest_matrix(o)
        centre = self.space.point_back(M.to_translation())
        sc = [abs(x) for x in M.to_scale()] if o.type == 'EMPTY' else [1, 1, 1]
        r3 = o.empty_display_size if o.type == 'EMPTY' else 1.0
        sc = [x * r3 for x in sc]
        if shape == 0:
            r = max(sc)
            return centre, (r, r * r, 0.0)
        if shape == 1:
            ext = [2 * x for x in sc]
            return tuple(c - e / 2 for c, e in zip(centre, ext)), tuple(ext)
        if shape == 2:
            r, h = max(sc[0], sc[1]), 2 * sc[2]
            return (centre[0], centre[1], centre[2] - h / 2), (r, 0.0, h)
        return centre, tuple(sc)

    def light_volume_chunk(self, o):
        t = self._variant(o, 'light_volume', self._skinned(o))
        c = KINDS['light_volume'](t)
        self._common(o, c)
        self._bone_ref(o, c)
        c.v['pos'], c.v['size'] = self._volume_values(o, c.v['shape'])
        self.snap_xform(o, c)
        self._snap_size(o, c)
        return c

    def phys_coll_chunk(self, o):
        t = self._variant(o, 'phys_coll', self._skinned(o))
        c = KINDS['phys_coll'](t)
        self._common(o, c)
        self._bone_ref(o, c)
        c.v['pos'], c.v['size'] = self._volume_values(o, c.v['shape'])
        self.snap_xform(o, c)
        self._snap_size(o, c)
        return c

    def light_chunk(self, o):
        c = KINDS['light']()
        self._common(o, c)
        c.v['pos'] = self.space.point_back(self.rest_matrix(o).to_translation())
        self.snap_xform(o, c)
        return c

    def collision(self, o):
        cv = CollisionVolume()
        shape = SHAPES.get(o.gsf.shape, 1)
        cv.v['shape'] = shape
        cv.v['pos'], cv.v['size'] = self._volume_values(o, shape)
        old = o.get('gsf_xform_pos')
        if old is not None and np.abs(np.array(old) - np.array(cv.v['pos'])).max() < 2e-5 * max(1.0, np.abs(np.array(old)).max()):
            cv.v['pos'] = tuple(float(x) for x in old)
        self._snap_size(o, cv)
        cv.v['attributes'] = P.bits_to_int(o.gsf.attributes)
        return cv

    # ===================================================================================== effects
    def points_raw(self, me, stride, names, o=None):
        n = len(me.vertices)
        co = np.zeros(n * 3, dtype=np.float64)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3) * np.array(self.space.s3)
        bbox = fit_bbox(co, me.get('gsf_bbox')) if n else (0.0,) * 6
        f = {'q': VX.quantize(co, bbox)}
        a = me.attributes.get('gsf_unk_bit')
        if a is not None:
            ub = np.zeros(n, dtype=np.int64)
            a.data.foreach_get('value', ub)
            f['unk_bit'] = ub
        if stride >= 13 and o is not None:
            f['bone_ids'], f['bone_weights'] = self._vertex_bones(o, me, names)
        return VX.encode_billboard(f, stride), bbox

    def billboard_chunk(self, o):
        skinned = o.parent is not None and o.parent.type == 'ARMATURE' and any(md.type == 'ARMATURE' for md in o.modifiers)
        t = self._variant(o, 'billboard', skinned)
        c = KINDS['billboard'](t)
        self._common(o, c)
        c.v['transform'] = tuple(self.space.matrix_back(self.rest_matrix(o)))
        self.snap_xform(o, c)
        bm = o.material_slots[0].material if len(o.material_slots) else None
        c.v['material'] = self.model_material(bm)
        names = self.skels[o.parent]['names'] if skinned and o.parent in self.skels else None
        if c.ctx['skinned']:
            c.v['vertex_size'] = max(13, c.v['vertex_size'])
        else:
            c.v['vertex_size'] = 5
        c.raw, c.v['bounding_box'] = self.points_raw(o.data, c.v['vertex_size'], names, o)
        return c

    def particle_chunk(self, o):
        t = self._variant(o, 'particle', self._skinned(o))
        c = KINDS['particle'](t)
        self._common(o, c)
        self._bone_ref(o, c)
        g = o.gsf
        M = self.rest_matrix(o)
        c.v['pos'] = self.space.point_back(M.to_translation())
        c.v['rot'] = self.space.quat_back(M.to_3x3().normalized())
        self.snap_xform(o, c)
        c.has_name = g.has_name
        c.name = g.particle_name
        c.name_length = int(o.get('gsf_name_length', -1))
        if c.name_length not in (-1, len(c.name.encode('latin-1', 'replace')) + 1):
            c.name_length = -1
        c.tiles = []
        for k, it in enumerate(g.tiles):
            d = {key: getattr(it, key) for key in ('tiles_w_log2', 'tiles_h_log2', 'tile_start', 'tile_last',
                                                    'tile_border_width', 'tile_border_left', 'mid_x', 'mid_y')}
            raw = o.get('gsf_tile_material_raw_%d' % k)
            d['material'] = raw if (raw is not None and it.material is None) else self.model_material(it.material)
            c.tiles.append(d)
        c.params = []
        for it in g.params:
            if it.ptype == 'f':
                c.params.append(int(np.array([it.f], dtype=np.float32).view(np.uint32)[0]))
            elif it.ptype == 'i':
                c.params.append(int(it.i) & 0xFFFFFFFF)
            else:
                c.params.append(P.parse_hex(it.x))
        return c

    # ===================================================================================== animations
    def _model_anims(self, m, root, obj_chunk):
        g = root.gsf_model
        cache = {}
        sounds = self.archive.sounds
        m.anims, m.anim_names = [], []
        for it in g.anims:
            ma = ModelAnim()
            for tr in it.tracks:
                o, act = tr.target, tr.action
                if o is None or act is None or o not in obj_chunk:
                    if o is not None and act is not None:
                        self.warnings.append('%s %s: %s is not part of the model' % (m.name, it.name, o.name))
                    continue
                key = (act.name, o.name)
                an = cache.get(key)
                if an is None:
                    an = self.anim_chunk(act, o, obj_chunk[o])
                    if an is None:
                        continue
                    # share identical animations between models (bone animations of identical skeletons)
                    cache[key] = an
                ma.tracks.append((obj_chunk[o], an, an.frame_count()))
            e = AnimName(it.name, ma)
            e.v['anim_flags'] = P.parse_hex(it.anim_flags)
            for s in it.sounds.replace(';', ',').split(','):
                s = s.strip()
                if s.isdigit() and int(s) < len(sounds):
                    e.sounds.append(sounds[int(s)])
                elif s:
                    self.warnings.append('%s %s: sound %s is not in the archive\'s sound list' % (m.name, it.name, s))
            m.anims.append(ma)
            m.anim_names.append(e)
        for ws in g.walksets:
            w = WalkSet(ws.name)
            for k, sl in enumerate(ws.slots[:42]):
                if k == WALK_TRANSITION_SLOT:
                    w.slots[k] = sl.value
                else:
                    w.slots[k] = m.anim_name(sl.anim) if sl.anim else None
                    if sl.anim and w.slots[k] is None:
                        self.warnings.append('%s walk set %s: no animation %s' % (m.name, ws.name, sl.anim))
            m.walksets.append(w)

    def anim_chunk(self, act, o, chunk):
        kind = act.gsf.kind.lower()
        if self.reuse_unchanged:
            orig = A.original_chunk(self, act, self.skels[o]['sk'] if kind == 'bone_anim' and o in self.skels else None)
            if orig is not None and orig.KIND == kind:
                return orig
        if kind == 'bone_anim':
            if o not in self.skels:
                self.warnings.append('%s: bone animation on %s, which is not a skeleton' % (act.name, o.name))
                return None
            return A.export_bone_anim(self, act, o, self.skels[o], self.warnings)
        self.current_chunk = chunk
        if kind == 'mesh_anim':
            return A.export_mesh_anim(self, act, o, None, self.warnings.append)
        if kind == 'billboard_anim':
            return A.export_billboard_anim(self, act, o, self.warnings.append)
        if kind in ('particle_anim', 'speedline_anim'):
            return A.export_path_anim(self, act, o, kind)
        # an action made in Blender without GSF data: guess from the object
        if o.type == 'ARMATURE' and o in self.skels:
            act.gsf.kind = 'BONE_ANIM'
            return A.export_bone_anim(self, act, o, self.skels[o], self.warnings)
        if chunk.KIND == 'particle':
            return A.export_path_anim(self, act, o, 'particle_anim')
        if chunk.KIND == 'speedline':
            return A.export_path_anim(self, act, o, 'speedline_anim')
        if chunk.KIND == 'mesh':
            act.gsf.kind = 'MESH_ANIM'
            return A.export_mesh_anim(self, act, o, None, self.warnings.append)
        self.warnings.append('%s: cannot export an animation of a %s' % (act.name, chunk.KIND))
        return None


EXPORTERS = {
    'mesh': Exporter.mesh_chunk,
    'link': Exporter.link_chunk,
    'speedline': Exporter.speedline_chunk,
    'light_volume': Exporter.light_volume_chunk,
    'phys_coll': Exporter.phys_coll_chunk,
    'light': Exporter.light_chunk,
    'billboard': Exporter.billboard_chunk,
    'particle': Exporter.particle_chunk,
}


def register_exporter(kind, fn):
    """add an export converter for a new chunk kind: fn(exporter, obj) -> core chunk"""
    EXPORTERS[kind] = fn

