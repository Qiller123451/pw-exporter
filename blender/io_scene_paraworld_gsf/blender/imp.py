"""GSF archive -> Blender scene.

Every archive becomes a collection ("GSF <name>") that holds the archive-wide data (sounds, dust trails, the list of
its models ...). Every imported model becomes a child collection with a root empty (the model info, its animations
and walk sets) and one object per chunk:

    mesh / cloth      mesh object (one material slot per submesh), skinned ones parented to their armature
    skeleton          armature (bone GUIDs, flags and rest scale kept per bone)
    link              empty (arrows)
    particle emitter  empty (cone) with every emitter and particle parameter
    billboard cloud   mesh object made of points (one per sprite)
    light volume      empty (sphere, scaled to the radii)
    cloth collider    empty (sphere / cube)
    speed line        empty (single arrow)
    light             point light
    collision volume  empty (cube / sphere) - the model's pathfinder / hit volumes
Animations become actions (bone animations on armatures, mesh / emitter / speed line paths on the objects); the root
lists every model animation with the action of each animated component.
Inside the model collection the components are sorted into collections per LOD and kind (see lods.py).
"""
import os

import bpy
import numpy as np
from mathutils import Matrix, Vector

from ..core import normals as NRM
from ..core import vertex as VX
from ..core import names as NAMES
from ..core.chunks.base import Chunk
from ..core.archive import WALK_TRANSITION_SLOT, SOUND
from . import props as P
from . import compat
from . import bonemath as BM
from .space import Space
from . import lods
from .materials import TextureFinder, to_blender as material_to_blender, guess_data_dir

FPS = 25


def _link(obj, col):
    if obj.name not in col.objects:
        col.objects.link(obj)


def chunk_name(model, chunk, i, kind):
    g = chunk.v.get('guid', 0)
    n = NAMES.KNOWN_COMPONENT_NAMES.get(g)
    if kind == 'link':
        n = chunk.v['link_fourcc'] or n
    if kind == 'particle' and getattr(chunk, 'name', ''):
        n = chunk.name
    return '%s.%s' % (model.name, n or '%s%d' % (kind, i))


def geometry_signature(me):
    """checksum of a mesh's vertex positions, faces and sharp edges"""
    import hashlib
    co = np.zeros(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get('co', co)
    lv = np.zeros(len(me.loops), dtype=np.int32)
    me.loops.foreach_get('vertex_index', lv)
    ps = np.zeros(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get('loop_start', ps)
    sm = np.zeros(len(me.polygons), dtype=bool)
    me.polygons.foreach_get('use_smooth', sm)
    sh = compat.get_sharp_edges(me)
    return hashlib.md5(co.tobytes() + lv.tobytes() + ps.tobytes() + sm.tobytes() + np.asarray(sh, bool).tobytes()).hexdigest()


class Importer:
    def __init__(self, archive, path='', mirror='X', data_dir='', textures=True, animations=True, weld=True,
                 log=print):
        self.a = archive
        self.path = path
        self.space = Space(mirror)
        self.mirror = mirror
        self.data_dir = data_dir or (guess_data_dir(path) if path else '')
        self.finder = TextureFinder(self.data_dir) if textures else None
        self.animations = animations
        self.weld = weld
        self.log = log
        self.mat_cache = {}
        self.action_cache = {}
        self.mesh_cache = {}
        self.warnings = list(archive.warnings)
        self.col = None

    # ======================================================================================= archive
    def archive_collection(self, parent=None):
        """find or create the collection of this archive and fill the archive-wide data"""
        name = 'GSF %s' % self.a.file_name
        col = None
        for c in bpy.data.collections:
            g = c.gsf_archive
            if g.is_archive and g.file_name == self.a.file_name and bpy.path.abspath(g.source_path) == os.path.abspath(self.path or ''):
                col = c
                break
        if col is None:
            col = bpy.data.collections.new(name)
            (parent or bpy.context.scene.collection).children.link(col)
            self._fill_archive(col)
        self.col = col
        return col

    def _fill_archive(self, col):
        g = col.gsf_archive
        g.is_archive = True
        g.file_name = self.a.file_name
        g.source_path = self.path or ''
        g.data_dir = self.data_dir or ''
        g.mirror = self.mirror
        g.materials_capacity = self.a.materials_capacity
        P.to_props(g, P.GSF_PG_archive.STRUCT, self.a.h2, 'archive')
        g.lists_tracked = True
        for k, s in enumerate(self.a.sounds):
            it = g.sounds.add()
            it.name, it.group = s.name, s.group
            it.orig_index = k
            P.to_props(it.v, SOUND, s.v, 'sound')
        for d in self.a.dusttrails:
            it = g.dusttrails.add()
            it.name = d.name
            it.model = d.model.name if d.model is not None else ''
            it.anim = d.anim.name if d.anim is not None else ''
            it.anim_index = d.anim_index
            it.start_frame = d.start_frame
            for k, v in d.entries:
                e = it.entries.add()
                e.name, e.value = k, v
        for k, s in enumerate(self.a.anim_groups):
            it = g.anim_groups.add()
            it.name, it.orig_index = s, k
        for k, s in enumerate(self.a.walk_transitions):
            it = g.walk_transitions.add()
            it.name, it.orig_index = s, k
        for m in (self.a.toc_order or self.a.models):
            e = g.entries.add()
            e.name = m.name
            e.fourcc = m.fourcc
            nk = {}
            for c in m.chunks:
                nk[c.KIND] = nk.get(c.KIND, 0) + 1
            e.info = '%d chunks (%s), %d animations' % (len(m.chunks), ', '.join('%d %s' % (v, k) for k, v in sorted(nk.items())), len(m.anims))

    # ======================================================================================= models
    def import_models(self, models):
        if self.col is None:
            self.archive_collection()
        roots = []
        scene = bpy.context.scene
        scene.render.fps = FPS
        scene.render.fps_base = 1.0
        for m in models:
            try:
                roots.append(self.import_model(m))
            except Exception as e:      # keep going with the other models
                import traceback
                traceback.print_exc()
                self.warnings.append('%s: import failed (%s)' % (m.name, e))
        return roots

    def import_model(self, m):
        col = bpy.data.collections.new(m.name)
        self.col.children.link(col)
        root = bpy.data.objects.new(m.name, None)
        root.empty_display_type = 'PLAIN_AXES'
        root.empty_display_size = 0.5
        _link(root, col)
        g = root.gsf_model
        g.is_root = True
        g.name = m.name
        g.source_name = m.name
        g.has_object_name = m.object_name is not None
        g.object_name = m.object_name or ''
        P.to_props(g, P.GSF_PG_model.STRUCT, m.v, 'model')
        g.bbox = m.v['bounding_box']
        g.auto_bbox = False
        mats = []
        if m.material_list is not None and m.material_list.materials is not None:
            for x in m.material_list.materials:
                bm = material_to_blender(x, self.finder, self.mat_cache)
                mats.append(bm)
                g.materials.add().material = bm
        ctx = dict(model=m, root=root, col=col, mats=mats, objs={}, skeletons={})
        # skeletons first: skinned components hang on them
        order = sorted(range(len(m.chunks)), key=lambda i: 0 if getattr(m.chunks[i], 'KIND', '') == 'skeleton' else 1)
        for i in order:
            c = m.chunks[i]
            if not isinstance(c, Chunk):
                continue
            conv = CONVERTERS.get(c.KIND)
            if conv is None:
                self.warnings.append('%s: no converter for %s chunks' % (m.name, c.KIND))
                continue
            obj = conv(self, c, i, ctx)
            if obj is None:
                continue
            self._common(obj, c, i, m)
            ctx['objs'][id(c)] = obj
        self._resolve_refs(m, ctx)
        for k, cv in enumerate(m.collision):
            self._collision(cv, k, ctx)
        if self.animations:
            self._animations(m, ctx)
        self._walksets(m, g)
        lods.sort_model(root, col)
        # entry state
        for e in self.col.gsf_archive.entries:
            if e.name == m.name:
                e.state = 'SCENE'
                e.root = root
        return root

    def _common(self, obj, c, i, m):
        for f in c.STRUCT.fields:
            if f.xform and f.name in c.v:
                v = c.v[f.name]
                obj['gsf_xform_' + f.name] = [float(x) for x in (v if hasattr(v, '__len__') else [v])]
        g = obj.gsf
        g.kind = c.KIND.upper()
        g.order = i
        g.attributes = P.int_to_bits(c.v.get('attributes', 0))
        g.guid = P.hexs(c.v.get('guid', 0))
        pg = getattr(g, 'p_' + c.KIND)
        pg.type_id = P.hexs(c.type_id)
        P.to_props(pg, c.STRUCT, c.v, c.KIND)
        if obj.parent is None:
            obj.parent = None

    def _place(self, obj, ctx, local, parent=None):
        """parent the object to the root (or to `parent`, a direct child of the root) so that its matrix relative to
        the root is `local`"""
        _link(obj, ctx['col'])
        obj.parent = parent or ctx['root']
        obj.matrix_parent_inverse = Matrix.Identity(4)
        if parent is not None and parent is not ctx['root']:
            obj.matrix_basis = parent.matrix_basis.inverted() @ local
        else:
            obj.matrix_basis = local
        obj['gsf_rest_matrix'] = [x for row in local for x in row]

    def _bone_parent(self, obj, c, ctx, local):
        """components that hang on ONE bone with full weight follow that bone"""
        arm = ctx['skeletons'].get(id(c.refs.get('skeleton_index')))
        ids = c.v.get('bone_ids')
        ws = c.v.get('bone_weights')
        if arm is None or ids is None:
            return False
        used = [(b, w) for b, w in zip(ids, ws) if b != 255 and w]
        if len(used) != 1 or used[0][1] != 255:
            return False
        names = arm['names']
        if used[0][0] >= len(names):
            return False
        aobj = arm['obj']
        bone = aobj.data.bones[names[used[0][0]]]
        _link(obj, ctx['col'])
        obj.parent = aobj
        obj.parent_type = 'BONE'
        obj.parent_bone = bone.name
        # bone parenting: world = arm @ bone.matrix_local @ T(tail) @ parent_inverse @ basis
        tail = Matrix.Translation(Vector((0, bone.length, 0)))
        obj.matrix_parent_inverse = (bone.matrix_local @ tail).inverted()
        obj.matrix_basis = local
        obj['gsf_rest_matrix'] = [x for row in local for x in row]
        return True

    def _resolve_refs(self, m, ctx):
        for c in m.chunks:
            if not isinstance(c, Chunk):
                continue
            obj = ctx['objs'].get(id(c))
            if obj is None:
                continue
            for field, t in c.refs.items():
                P.set_ref(obj.gsf, field, ctx['objs'].get(id(t)) if t is not None else None)

    # ======================================================================================= meshes
    def _mesh_from_data(self, md, name, mats, chunk=None, skeleton=None, weld=True):
        """MeshData -> bpy Mesh (+ per-vertex bone data for vertex groups)"""
        S = self.space
        allp, alln, alluv, allex, alltan, allbid, allbw, sub_of = [], [], [], [], [], [], [], []
        tris, tri_sub = [], []
        ext = chunk is not None and chunk.extended_uv
        baked = chunk is not None and chunk.baked_light
        off = 0
        for k, s in enumerate(md.submeshes):
            d = VX.decode_mesh(s.raw) if len(s.raw) else None
            n = len(s.raw)
            if not n:
                continue
            allp.append(d['q'])
            alln.append(d['normal'])
            alluv.append(VX.uv_to_float(d['uv'], d.get('extra'), ext))
            allex.append(d['extra'] if 'extra' in d else np.zeros(n, np.uint8))
            alltan.append(s.tangents.astype(np.int64) if s.tangents is not None and len(s.tangents) == n else np.full(n, -1))
            allbid.append(d.get('bone_ids', np.full((n, 4), 255, np.uint8)))
            allbw.append(d.get('bone_weights', np.zeros((n, 4), np.uint8)))
            sub_of.append(np.full(n, k))
            t = s.tris.astype(np.int64)
            ok = (t < n).all(1)
            tris.append(t[ok] + off)
            tri_sub.append(np.full(ok.sum(), k))
            off += n
        me = bpy.data.meshes.new(name)
        if not allp:
            for bm in mats:
                me.materials.append(bm)
            return me, None
        q = np.concatenate(allp)
        nidx = np.concatenate(alln)
        uv = np.concatenate(alluv)
        extra = np.concatenate(allex)
        tang = np.concatenate(alltan)
        bid = np.concatenate(allbid)
        bw = np.concatenate(allbw)
        tris = np.concatenate(tris) if tris else np.zeros((0, 3), np.int64)
        tri_sub = np.concatenate(tri_sub) if tri_sub else np.zeros(0, np.int64)
        pos = VX.dequantize(q, md.bbox)
        n = len(q)
        # weld vertices that share position and skin
        if weld:
            key = np.concatenate([q.astype(np.int64), bid.astype(np.int64), bw.astype(np.int64)], 1)
            _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
            inv = inv.reshape(-1)
            order = np.argsort(first)            # keep the file's vertex order as far as possible
            rank = np.empty_like(order)
            rank[order] = np.arange(len(order))
            vmap = rank[inv]
            vsrc = first[order]
        else:
            vmap = np.arange(n)
            vsrc = np.arange(n)
        nv = len(vsrc)
        # faces; a triangle that would repeat a vertex or duplicate another face keeps its own vertex copies
        extra_src = []
        faces = []
        seen = set()
        dropped = []
        corner_src = []
        raws = np.concatenate([s.raw for s in md.submeshes if len(s.raw)]) if allp else None
        for ti, t in enumerate(tris):
            a, b, c = int(t[0]), int(t[1]), int(t[2])
            if a == b or b == c or a == c:
                # Blender cannot hold a triangle that repeats a vertex: kept as data and written back on export
                dropped.append('%d:%s' % (int(tri_sub[ti]), b''.join(bytes(raws[x]) for x in (a, b, c)).hex()))
                continue
            f = (int(vmap[a]), int(vmap[b]), int(vmap[c]))
            key = tuple(sorted(f))
            if len(set(f)) < 3 or key in seen:
                f = []
                for src in (a, b, c):
                    extra_src.append(src)
                    f.append(nv + len(extra_src) - 1)
                f = tuple(f)
                key = tuple(sorted(f))
            seen.add(key)
            faces.append(f)
            corner_src.append((a, b, c))
        if dropped:
            me['gsf_degenerate'] = ';'.join(dropped)
        keep_tri = np.array([len(set((int(t[0]), int(t[1]), int(t[2])))) == 3 for t in tris], dtype=bool) if len(tris) else np.zeros(0, bool)
        tri_sub = tri_sub[keep_tri]
        vsrc_all = np.concatenate([vsrc, np.array(extra_src, dtype=np.int64)]) if extra_src else vsrc
        faces = np.array(faces, dtype=np.int64).reshape(-1, 3)
        corner_src = np.array(corner_src, dtype=np.int64).reshape(-1, 3)
        if S.flip:
            faces = faces[:, [0, 2, 1]]
            corner_src = corner_src[:, [0, 2, 1]]
        verts = pos[vsrc_all] * np.array(S.s3)
        me.vertices.add(len(verts))
        me.vertices.foreach_set('co', verts.astype(np.float32).reshape(-1))
        qa = me.attributes.new('gsf_q', 'FLOAT_VECTOR', 'POINT')       # the file's quantised position (exact)
        qa.data.foreach_set('vector', q[vsrc_all].astype(np.float32).reshape(-1))
        nf = len(faces)
        me.loops.add(nf * 3)
        me.polygons.add(nf)
        me.loops.foreach_set('vertex_index', faces.reshape(-1).astype(np.int32))
        me.polygons.foreach_set('loop_start', np.arange(0, nf * 3, 3, dtype=np.int32))
        me.polygons.foreach_set('loop_total', np.full(nf, 3, dtype=np.int32))
        me.polygons.foreach_set('material_index', tri_sub.astype(np.int32))
        me.update(calc_edges=True)
        for bm in mats:
            me.materials.append(bm)
        cs = corner_src.reshape(-1)
        # texture coordinates (v runs bottom-up in the file, as in Blender)
        uvl = me.uv_layers.new(name='UVMap')
        uvl.data.foreach_set('uv', uv[cs].astype(np.float32).reshape(-1))
        # normals from the lookup sphere; edges where they differ become sharp (smoothing groups for re-export)
        nrm = NRM.decode(nidx) * np.array(S.s3)
        loop_n = nrm[cs]
        compat.set_smooth(me, True)
        self._sharp_from_normals(me, nidx[cs])
        na = me.attributes.new('gsf_normal', 'INT', 'CORNER')      # the file's sphere index (zero-area faces)
        na.data.foreach_set('value', nidx[cs].astype(np.int32))
        try:
            compat.set_custom_normals(me, [tuple(v) for v in loop_n])
        except (RuntimeError, ValueError) as e:
            self.warnings.append('%s: custom normals not set (%s)' % (name, e))
        if baked:
            a = me.color_attributes.new('gsf_baked_light', 'FLOAT_COLOR', 'CORNER')
            v = extra[cs].astype(np.float32) / 255.0
            a.data.foreach_set('color', np.stack([v, v, v, np.ones_like(v)], 1).reshape(-1))
        if (tang >= 0).any():
            a = me.attributes.new('gsf_tangent', 'INT', 'CORNER')
            a.data.foreach_set('value', np.maximum(tang[cs], 0).astype(np.int32))
        skin = None
        if (bid != 255).any():
            skin = (bid[vsrc_all], bw[vsrc_all])
        me.validate(clean_customdata=False)
        me['gsf_bbox'] = [float(x) for x in md.bbox]       # quantisation box of the file (reused when it still fits)
        me['gsf_geometry'] = geometry_signature(me)       # tells the exporter whether the mesh was edited
        return me, skin

    def _sharp_from_normals(self, me, corner_nidx):
        loops_v = np.zeros(len(me.loops), dtype=np.int64)
        me.loops.foreach_get('vertex_index', loops_v)
        edge_v = np.zeros(len(me.edges) * 2, dtype=np.int64)
        me.edges.foreach_get('vertices', edge_v)
        edge_index = {}
        for i in range(len(me.edges)):
            a, b = edge_v[2 * i], edge_v[2 * i + 1]
            edge_index[(min(a, b), max(a, b))] = i
        seen = {}
        sharp = np.zeros(len(me.edges), dtype=bool)
        nf = len(loops_v) // 3
        for f in range(nf):
            for k in range(3):
                l0, l1 = 3 * f + k, 3 * f + (k + 1) % 3
                a, b = loops_v[l0], loops_v[l1]
                e = edge_index.get((min(a, b), max(a, b)))
                if e is None:
                    continue
                na = {a: corner_nidx[l0], b: corner_nidx[l1]}
                if e in seen:
                    other = seen[e]
                    if other[a] != na[a] or other[b] != na[b]:
                        sharp[e] = True
                else:
                    seen[e] = na
        compat.set_sharp_edges(me, sharp)

    def _vertex_groups(self, obj, skin, arm):
        if skin is None or arm is None:
            return
        bid, bw = skin
        names = arm['names']
        groups = {}
        for v in range(len(bid)):
            for b, w in zip(bid[v], bw[v]):
                if b == 255 or w == 0 or b >= len(names):
                    continue
                groups.setdefault(int(b), ([], []))
                groups[int(b)][0].append(v)
                groups[int(b)][1].append(w / 255.0)
        for b in sorted(groups):
            vg = obj.vertex_groups.get(names[b]) or obj.vertex_groups.new(name=names[b])
            idx, ws = groups[b]
            for v, w in zip(idx, ws):
                vg.add([v], w, 'REPLACE')

    def conv_mesh(self, c, i, ctx):
        m = ctx['model']
        mats = [ctx['mats'][k] if k < len(ctx['mats']) else None for k in c.mesh.submesh_materials]
        mats += [None] * (len(c.mesh.submeshes) - len(mats))
        raw_mats = {k: x for k, x in enumerate(c.mesh.submesh_materials) if x >= len(ctx['mats'])}
        arm = ctx['skeletons'].get(id(c.refs.get('skeleton_index')))
        me, skin = self._mesh_from_data(c.mesh, chunk_name(m, c, i, 'mesh'), mats, c, weld=self.weld and not c.is_cloth)
        for k, x in raw_mats.items():
            me['gsf_raw_material_%d' % k] = x          # index past the model's material list (kept as it is)
        obj = bpy.data.objects.new(me.name, me)
        local = self.space.matrix(c.v['transform'])
        if c.skin == 2 and self._bone_parent(obj, c, ctx, local):
            pass
        elif c.skin == 1 and arm is not None:
            self._place(obj, ctx, local, arm['obj'])
            mod = obj.modifiers.new('Armature', 'ARMATURE')
            mod.object = arm['obj']
            self._vertex_groups(obj, skin, arm)
        else:
            self._place(obj, ctx, local)
            if skin is not None:          # skinned to a cloth: keep the weights as vertex groups by bone index
                self._vertex_groups(obj, skin, {'names': ['bone_%d' % k for k in range(255)]})
        if c.is_cloth:
            for attr in ('points_a', 'points_b'):
                arr = getattr(c, attr)
                if arr is not None:
                    obj['gsf_' + attr] = [float(x) for x in np.asarray(arr).reshape(-1)]
            for k, s in enumerate(c.mesh.submeshes):
                if s.cloth_triples is not None:
                    obj['gsf_cloth_triples_%d' % k] = [int(x) for x in s.cloth_triples.reshape(-1)]
        return obj

    # ======================================================================================= skeleton
    def conv_skeleton(self, c, i, ctx):
        m = ctx['model']
        sk = BM.Skeleton(c)
        M = np.array(self.space.S)
        B = BM.to_blender(sk.world, sk.det, M)
        arm = bpy.data.armatures.new(chunk_name(m, c, i, 'skeleton'))
        obj = bpy.data.objects.new(arm.name, arm)
        self._place(obj, ctx, Matrix.Identity(4))
        used = set()
        names = [NAMES.bone_name(b.v['guid'], used) for b in sk.bones]
        view_layer = bpy.context.view_layer
        if obj.name not in view_layer.objects:
            bpy.context.scene.collection.objects.link(obj)
            tmp_link = True
        else:
            tmp_link = False
        prev_active = view_layer.objects.active
        view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode='EDIT')
        ebs = []
        for k, b in enumerate(sk.bones):
            eb = arm.edit_bones.new(names[k])
            kids = [j for j in range(sk.n) if sk.parent[j] == k]
            L = 0.1
            if kids:
                d = np.linalg.norm(sk.world[kids[0]][:3, 3] - sk.world[k][:3, 3])
                if d > 1e-3:
                    L = d
            elif sk.parent[k] >= 0:
                L = max(ebs[sk.parent[k]].length * 0.5, 0.02)
            eb.head = (0, 0, 0)
            eb.tail = (0, L, 0)
            eb.matrix = Matrix(B[k].tolist())
            if sk.parent[k] >= 0:
                eb.parent = ebs[sk.parent[k]]
            ebs.append(eb)
        bpy.ops.object.mode_set(mode='OBJECT')
        view_layer.objects.active = prev_active
        if tmp_link:
            bpy.context.scene.collection.objects.unlink(obj)
        for k, b in enumerate(sk.bones):
            bg = arm.bones[names[k]].gsf
            bg.guid = P.hexs(b.v['guid'])
            bg.flags = P.hexs(b.v['flags'])
            bg.scale = b.v['scale']
            bg.order = k
            bg.rest_pos = b.v['pos']
            bg.rest_rot = b.v['rot']
            bg.has_rest = True
            obj.pose.bones[names[k]].rotation_mode = 'QUATERNION'
        arm.display_type = 'STICK'
        obj.show_in_front = True
        obj['gsf_bind_poses'] = [float(x) for x in np.asarray(c.bind_poses).reshape(-1)]
        ctx['skeletons'][id(c)] = dict(obj=obj, names=names, sk=sk, B=B)
        return obj

    # ======================================================================================= simple chunks
    def _empty(self, name, display, size):
        obj = bpy.data.objects.new(name, None)
        obj.empty_display_type = display
        obj.empty_display_size = size
        return obj

    def conv_link(self, c, i, ctx):
        obj = self._empty(chunk_name(ctx['model'], c, i, 'link'), 'ARROWS', 0.25)
        local = self.space.loc_rot(c.v['pos'], c.v['rot'])
        if not (c.ctx['skinned'] and self._bone_parent(obj, c, ctx, local)):
            self._place(obj, ctx, local)
        return obj

    def conv_speedline(self, c, i, ctx):
        obj = self._empty(chunk_name(ctx['model'], c, i, 'speedline'), 'SINGLE_ARROW', 0.5)
        local = self.space.loc_rot(c.v['pos'], c.v['rot'])
        if not (c.ctx['skinned'] and self._bone_parent(obj, c, ctx, local)):
            self._place(obj, ctx, local)
        k = c.v.get('tile_material', 0)
        obj.gsf.material = ctx['mats'][k] if k < len(ctx['mats']) else None
        return obj

    def _volume(self, obj, shape, size):
        """empty display for a sphere / box / tube / ellipsoid"""
        obj['gsf_size'] = [float(x) for x in size]
        if shape == 0:
            obj.empty_display_type = 'SPHERE'
            obj.scale = (size[0],) * 3
        elif shape == 1:
            obj.empty_display_type = 'CUBE'
            obj.scale = (abs(size[0]) / 2, abs(size[1]) / 2, abs(size[2]) / 2)
        elif shape == 2:
            obj.empty_display_type = 'CUBE'
            obj.scale = (size[0], size[0], abs(size[2]) / 2)
        else:
            obj.empty_display_type = 'SPHERE'
            obj.scale = tuple(abs(x) for x in size)
        obj.empty_display_size = 1.0

    @staticmethod
    def volume_centre(shape, pos, size):
        """GSF position of the volume's centre"""
        if shape == 1:
            return (pos[0] + size[0] / 2, pos[1] + size[1] / 2, pos[2] + size[2] / 2)
        if shape == 2:
            return (pos[0], pos[1], pos[2] + size[2] / 2)
        return tuple(pos)

    def conv_light_volume(self, c, i, ctx):
        obj = self._empty(chunk_name(ctx['model'], c, i, 'light_volume'), 'SPHERE', 1.0)
        centre = self.space.point(self.volume_centre(c.v['shape'], c.v['pos'], c.v['size']))
        local = Matrix.Translation(centre)
        if not (c.ctx['skinned'] and self._bone_parent(obj, c, ctx, local)):
            self._place(obj, ctx, local)
        self._volume(obj, c.v['shape'], c.v['size'])
        obj.display_type = 'WIRE'
        return obj

    def conv_phys_coll(self, c, i, ctx):
        obj = self._empty(chunk_name(ctx['model'], c, i, 'phys_coll'), 'SPHERE', 1.0)
        centre = self.space.point(self.volume_centre(c.v['shape'], c.v['pos'], c.v['size']))
        local = Matrix.Translation(centre)
        if not (c.ctx['skinned'] and self._bone_parent(obj, c, ctx, local)):
            self._place(obj, ctx, local)
        self._volume(obj, c.v['shape'], c.v['size'])
        return obj

    def conv_light(self, c, i, ctx):
        ld = bpy.data.lights.new(chunk_name(ctx['model'], c, i, 'light'), 'POINT')
        col = c.v.get('color', 0xFFFFFF)
        ld.color = (((col >> 16) & 255) / 255.0, ((col >> 8) & 255) / 255.0, (col & 255) / 255.0)
        obj = bpy.data.objects.new(ld.name, ld)
        self._place(obj, ctx, Matrix.Translation(self.space.point(c.v['pos'])))
        return obj

    # ======================================================================================= effects
    def _points_mesh(self, name, raw, bbox):
        d = VX.decode_billboard(raw) if len(raw) else {'q': np.zeros((0, 3)), 'unk_bit': np.zeros(0)}
        pos = VX.dequantize(d['q'], bbox) * np.array(self.space.s3)
        me = bpy.data.meshes.new(name)
        me['gsf_bbox'] = [float(x) for x in bbox]
        me.vertices.add(len(pos))
        me.vertices.foreach_set('co', pos.astype(np.float32).reshape(-1))
        me.update()
        if len(raw) and d['unk_bit'].any():
            a = me.attributes.new('gsf_unk_bit', 'INT', 'POINT')
            a.data.foreach_set('value', d['unk_bit'].astype(np.int32))
        skin = (d['bone_ids'], d['bone_weights']) if 'bone_ids' in d else None
        return me, skin

    def conv_billboard(self, c, i, ctx):
        me, skin = self._points_mesh(chunk_name(ctx['model'], c, i, 'billboard'), c.raw, c.v['bounding_box'])
        k = c.v['material']
        me.materials.append(ctx['mats'][k] if k < len(ctx['mats']) else None)
        obj = bpy.data.objects.new(me.name, me)
        local = self.space.matrix(c.v['transform'])
        arm = ctx['skeletons'].get(id(c.refs.get('skeleton_index')))
        if arm is not None:
            self._place(obj, ctx, local, arm['obj'])
            mod = obj.modifiers.new('Armature', 'ARMATURE')
            mod.object = arm['obj']
            self._vertex_groups(obj, skin, arm)
        else:
            self._place(obj, ctx, local)
        return obj

    def conv_particle(self, c, i, ctx):
        obj = self._empty(chunk_name(ctx['model'], c, i, 'particle'), 'CONE', 0.3)
        local = self.space.loc_rot(c.v['pos'], c.v['rot'])
        if not (c.ctx['skinned'] and self._bone_parent(obj, c, ctx, local)):
            self._place(obj, ctx, local)
        g = obj.gsf
        g.particle_name = c.name or ''
        g.has_name = c.has_name
        obj['gsf_name_length'] = c.name_length
        for t in c.tiles:
            it = g.tiles.add()
            for key, val in t.items():
                if key == 'material':
                    it.material = ctx['mats'][val] if val < len(ctx['mats']) else None
                    if val >= len(ctx['mats']):
                        obj['gsf_tile_material_raw_%d' % (len(g.tiles) - 1)] = val
                else:
                    setattr(it, key, val)
        for k in range(len(c.params)):
            name, kind = NAMES.particle_param_spec(c.v['source_type'], k)
            it = g.params.add()
            it.pname = name
            it.ptype = kind
            raw = c.params[k]
            if kind == 'f':
                it.f = float(np.array([raw], dtype=np.uint32).view(np.float32)[0])
                it.x = P.hexs(raw)
            elif kind == 'i':
                it.i = int(np.array([raw], dtype=np.uint32).view(np.int32)[0])
            else:
                it.x = P.hexs(raw)
        return obj

    # ======================================================================================= collision
    def _collision(self, cv, k, ctx):
        v = cv.v
        obj = self._empty('%s.collision%d' % (ctx['model'].name, k), 'CUBE', 1.0)
        centre = self.space.point(self.volume_centre(v['shape'], v['pos'], v['size']))
        self._place(obj, ctx, Matrix.Translation(centre))
        self._volume(obj, v['shape'], v['size'])
        obj['gsf_xform_pos'] = [float(x) for x in v['pos']]
        obj.display_type = 'WIRE'
        g = obj.gsf
        g.kind = 'COLLISION'
        g.order = k
        g.shape = ['SPHERE', 'BOX', 'TUBE', 'ELLIPSOID'][v['shape']] if v['shape'] < 4 else 'BOX'
        g.attributes = P.int_to_bits(v['attributes'])
        obj.hide_render = True

    # ======================================================================================= animations
    def _animations(self, m, ctx):
        from . import anim as A
        g = ctx['root'].gsf_model
        snd_index = {id(s): i for i, s in enumerate(self.a.sounds)}
        info_of = {}
        for ai in self.a.anim_infos:
            for a in ai.chunks:
                if a is not None:
                    info_of.setdefault(id(a), ai)
        for e in m.anim_names:
            it = g.anims.add()
            it.name = e.name
            it.anim_flags = P.hexs(e.v['anim_flags'])
            it.sounds = ','.join(str(snd_index[id(s)]) for s in e.sounds if id(s) in snd_index)
            if e.anim is None:
                continue
            for c, a, n in e.anim.tracks:
                obj = ctx['objs'].get(id(c))
                if obj is None:
                    continue
                try:
                    act = A.import_anim(self, a, c, obj, ctx, '%s|%s' % (m.name, e.name))
                except Exception as ex:
                    import traceback
                    traceback.print_exc()
                    self.warnings.append('%s %s: animation not imported (%s)' % (m.name, e.name, ex))
                    continue
                if act is None:
                    continue
                ai = info_of.get(id(a))
                if ai is not None and not act.gsf.info_name:
                    act.gsf.info_name = ai.name or ''
                    act.gsf.info_fourcc = (ai.fourcc.split(b'\0')[0].decode('latin-1') if isinstance(ai.fourcc, (bytes, bytearray)) else ai.fourcc)
                tr = it.tracks.add()
                tr.target = obj
                tr.action = act
            ai = info_of.get(id(e.anim.tracks[0][1])) if e.anim.tracks else None
            if ai is not None:
                it.info_name = ai.name or ''

    def _walksets(self, m, g):
        for ws in m.walksets:
            it = g.walksets.add()
            it.name = ws.name
            for k in range(42):
                s = it.slots.add()
                v = ws.slots[k]
                if k == WALK_TRANSITION_SLOT:
                    s.value = int(v or 0)
                else:
                    s.anim = v.name if v is not None else ''


CONVERTERS = {
    'mesh': Importer.conv_mesh,
    'skeleton': Importer.conv_skeleton,
    'link': Importer.conv_link,
    'speedline': Importer.conv_speedline,
    'light_volume': Importer.conv_light_volume,
    'phys_coll': Importer.conv_phys_coll,
    'light': Importer.conv_light,
    'billboard': Importer.conv_billboard,
    'particle': Importer.conv_particle,
}


def register_converter(kind, fn):
    """add an import converter for a new chunk kind: fn(importer, chunk, index, ctx) -> Blender object"""
    CONVERTERS[kind] = fn

