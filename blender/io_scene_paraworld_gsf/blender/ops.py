"""Operators: import / export, archive editing, animations, helpers."""
import fnmatch
import os

import bpy
from bpy.props import BoolProperty, EnumProperty, IntProperty, StringProperty
from bpy_extras.io_utils import ExportHelper, ImportHelper
from mathutils import Matrix

from ..core import GsfArchive, GsfError
from ..core.archive import WALKSET_SLOTS
from . import props as P
from . import compat
from .space import MIRRORS

_cache = {}


def load_archive(path):
    """read an archive (kept in memory while the file does not change)"""
    path = os.path.abspath(bpy.path.abspath(path))
    st = os.stat(path)
    hit = _cache.get(path)
    if hit and hit[0] == (st.st_mtime, st.st_size):
        return hit[1]
    a = GsfArchive.load(path)
    _cache.clear()
    _cache[path] = ((st.st_mtime, st.st_size), a)
    return a


def archive_collections():
    return [c for c in bpy.data.collections if c.gsf_archive.is_archive]


def active_archive(context):
    """the archive collection of the active object, else the scene's chosen one, else the first"""
    o = context.active_object
    cols = archive_collections()
    if o is not None:
        for c in cols:
            if _contains(c, o):
                return c
    name = context.scene.get('gsf_active_archive', '')
    for c in cols:
        if c.name == name:
            return c
    return cols[0] if cols else None


def _contains(col, obj):
    if obj.name in col.objects:
        return True
    return any(_contains(ch, obj) for ch in col.children)


def model_root(obj):
    while obj is not None:
        if obj.gsf_model.is_root:
            return obj
        obj = obj.parent
    return None


def _report_warnings(op, warnings, limit=12):
    for w in warnings[:limit]:
        op.report({'WARNING'}, w)
        print('GSF:', w)
    for w in warnings[limit:]:
        print('GSF:', w)
    if len(warnings) > limit:
        op.report({'WARNING'}, '%d more warnings in the system console' % (len(warnings) - limit))


# ============================================================================================ import / export
class IMPORT_SCENE_OT_paraworld_gsf(bpy.types.Operator, ImportHelper):
    """Import models of a ParaWorld .gsf archive"""
    bl_idname = 'import_scene.paraworld_gsf'
    bl_label = 'Import ParaWorld GSF'
    bl_options = {'REGISTER', 'UNDO', 'PRESET'}
    filename_ext = '.gsf'
    filter_glob: StringProperty(default='*.gsf', options={'HIDDEN'})
    models: StringProperty(name='Models', description='Names (or patterns like seas_*) to import, comma separated. '
                           'Empty = every model')
    open_only: BoolProperty(name='Only open the archive', default=False,
                            description='List the archive\'s models without importing any (import them later from the GSF tab)')
    animations: BoolProperty(name='Animations', default=True)
    textures: BoolProperty(name='Textures', default=True, description='Look for the game\'s textures')
    weld: BoolProperty(name='Weld vertices', default=True,
                       description='Join the split vertices of a mesh (needed for editing; cloth stays unwelded)')
    mirror: EnumProperty(name='Handedness', items=MIRRORS, default='X')
    data_dir: StringProperty(name='Game Data folder', subtype='DIR_PATH',
                             description='Data folder of the game (for textures). Empty = guessed from the file\'s location')

    def execute(self, context):
        from .imp import Importer
        try:
            a = load_archive(self.filepath)
        except (OSError, GsfError) as e:
            self.report({'ERROR'}, 'Cannot read %s: %s' % (self.filepath, e))
            return {'CANCELLED'}
        imp = Importer(a, self.filepath, self.mirror, self.data_dir, self.textures, self.animations, self.weld)
        col = imp.archive_collection()
        context.scene['gsf_active_archive'] = col.name
        if self.open_only:
            self.report({'INFO'}, 'Opened %s: %d models' % (a.file_name, len(a.models)))
            return {'FINISHED'}
        pats = [p.strip() for p in self.models.split(',') if p.strip()]
        sel = [m for m in (a.toc_order or a.models) if not pats or any(fnmatch.fnmatchcase(m.name, p) for p in pats)]
        if not sel:
            self.report({'WARNING'}, 'No model matches %s' % self.models)
            return {'CANCELLED'}
        roots = imp.import_models(sel)
        _report_warnings(self, imp.warnings)
        self.report({'INFO'}, 'Imported %d models from %s' % (len(roots), a.file_name))
        return {'FINISHED'}


def _archive_items(self, context):
    items = [(c.name, c.gsf_archive.file_name or c.name, c.name) for c in archive_collections()]
    return items or [('', '(no GSF archive in the file)', '')]


class EXPORT_SCENE_OT_paraworld_gsf(bpy.types.Operator, ExportHelper):
    """Save a GSF archive collection as a ParaWorld .gsf archive"""
    bl_idname = 'export_scene.paraworld_gsf'
    bl_label = 'Export ParaWorld GSF'
    filename_ext = '.gsf'
    filter_glob: StringProperty(default='*.gsf', options={'HIDDEN'})
    archive: EnumProperty(name='Archive', items=_archive_items)
    normals: EnumProperty(name='Normals', items=[
        ('AUTO', 'Automatic', 'Meshes not edited since the import keep the file\'s normals; edited and new meshes get '
                              'normals computed like the game'),
        ('GAME', 'Like the game', 'Area-weighted face normals summed over smooth fans (sharp edges and flat faces split '
                                  'them), as SEK\'s exporter did, then the closest entry of the lookup sphere'),
        ('CUSTOM', 'Keep custom normals', 'Blender\'s corner normals (custom normals of imported meshes) mapped to the '
                                          'closest entry of the lookup sphere')], default='AUTO')
    apply_modifiers: BoolProperty(name='Apply modifiers', default=True)
    prune_materials: BoolProperty(name='Remove unused materials', default=True)

    def invoke(self, context, event):
        col = active_archive(context)
        if col is not None:
            self.archive = col.name
            src = bpy.path.abspath(col.gsf_archive.source_path)
            self.filepath = src or (col.gsf_archive.file_name + '.gsf')
        return ExportHelper.invoke(self, context, event)

    def execute(self, context):
        from .exp import Exporter
        col = bpy.data.collections.get(self.archive)
        if col is None:
            self.report({'ERROR'}, 'No GSF archive collection chosen')
            return {'CANCELLED'}
        exp = Exporter(col, self.normals, self.apply_modifiers, self.prune_materials)
        try:
            n = exp.save(self.filepath)
        except (GsfError, OSError, ValueError) as e:
            import traceback
            traceback.print_exc()
            self.report({'ERROR'}, 'Export failed: %s' % e)
            return {'CANCELLED'}
        _cache.pop(os.path.abspath(self.filepath), None)
        _report_warnings(self, exp.warnings)
        self.report({'INFO'}, 'Saved %s (%d models, %d bytes)' % (self.filepath, len(exp.archive.models), n))
        return {'FINISHED'}


# ============================================================================================ archive editing
class GSF_OT_import_entries(bpy.types.Operator):
    """Import the ticked models (or the active one) of the archive into the scene for editing"""
    bl_idname = 'gsf.import_entries'
    bl_label = 'Import selected models'
    bl_options = {'REGISTER', 'UNDO'}
    animations: BoolProperty(name='Animations', default=True)

    def execute(self, context):
        from .imp import Importer
        col = active_archive(context)
        if col is None:
            return {'CANCELLED'}
        g = col.gsf_archive
        names = [e.name for e in g.entries if e.select and e.state != 'SCENE']
        if not names and 0 <= g.entry_index < len(g.entries) and g.entries[g.entry_index].state != 'SCENE':
            names = [g.entries[g.entry_index].name]
        if not names:
            self.report({'INFO'}, 'Nothing to import (tick models that are not in the scene yet)')
            return {'CANCELLED'}
        try:
            a = load_archive(g.source_path)
        except (OSError, GsfError) as e:
            self.report({'ERROR'}, str(e))
            return {'CANCELLED'}
        imp = Importer(a, bpy.path.abspath(g.source_path), g.mirror, bpy.path.abspath(g.data_dir), True,
                       self.animations, True)
        imp.col = col
        sel = [m for m in a.models if m.name in names]
        roots = imp.import_models(sel)
        for e in g.entries:
            e.select = False
        _report_warnings(self, imp.warnings)
        self.report({'INFO'}, 'Imported %d models' % len(roots))
        return {'FINISHED'}


class GSF_OT_entry_state(bpy.types.Operator):
    """Set what happens to the ticked models (or the active one) when the archive is saved"""
    bl_idname = 'gsf.entry_state'
    bl_label = 'Set model state'
    bl_options = {'REGISTER', 'UNDO'}
    state: EnumProperty(items=[('FILE', 'Keep', 'Write it as it is in the source archive'),
                               ('REMOVE', 'Remove', 'Leave it out of the saved archive')])

    def execute(self, context):
        col = active_archive(context)
        if col is None:
            return {'CANCELLED'}
        g = col.gsf_archive
        es = [e for e in g.entries if e.select] or ([g.entries[g.entry_index]] if 0 <= g.entry_index < len(g.entries) else [])
        for e in es:
            if self.state == 'FILE' and e.root is not None:
                e.root.gsf_model.source_name = ''
            e.state = 'REMOVE' if self.state == 'REMOVE' else ('SCENE' if (e.root is not None and self.state != 'FILE') else 'FILE')
        return {'FINISHED'}


class GSF_OT_entry_move(bpy.types.Operator):
    """Move the active model in the list. The saved archive lists its models in this order"""
    bl_idname = 'gsf.entry_move'
    bl_label = 'Move model'
    bl_options = {'REGISTER', 'UNDO'}
    direction: EnumProperty(items=[('UP', 'Up', 'One place up'), ('DOWN', 'Down', 'One place down'),
                                   ('TOP', 'To the top', 'To the start of the list'),
                                   ('BOTTOM', 'To the bottom', 'To the end of the list')])

    def execute(self, context):
        col = active_archive(context)
        if col is None:
            return {'CANCELLED'}
        g = col.gsf_archive
        n, i = len(g.entries), g.entry_index
        if not 0 <= i < n:
            return {'CANCELLED'}
        # with a filter: past the hidden models to the next shown one
        flt = g.filter.lower()
        shown = [k for k, e in enumerate(g.entries) if not flt or flt in e.name.lower()]
        if self.direction == 'TOP':
            j = 0
        elif self.direction == 'BOTTOM':
            j = n - 1
        elif self.direction == 'UP':
            j = max([k for k in shown if k < i], default=i)
        else:
            j = min([k for k in shown if k > i], default=i)
        if j == i:
            return {'CANCELLED'}
        g.entries.move(i, j)
        g.entry_index = j
        g.order_changed = True
        return {'FINISHED'}


class GSF_OT_archive_new(bpy.types.Operator):
    """Create an empty GSF archive collection (for new models)"""
    bl_idname = 'gsf.archive_new'
    bl_label = 'New archive'
    bl_options = {'REGISTER', 'UNDO'}
    name: StringProperty(name='Name', default='my_models')
    mirror: EnumProperty(name='Handedness', items=MIRRORS, default='X')

    def invoke(self, context, event):
        return context.window_manager.invoke_props_dialog(self)

    def execute(self, context):
        col = bpy.data.collections.new('GSF ' + self.name)
        context.scene.collection.children.link(col)
        g = col.gsf_archive
        g.is_archive = True
        g.file_name = self.name
        g.mirror = self.mirror
        context.scene['gsf_active_archive'] = col.name
        return {'FINISHED'}


KIND_BY_TYPE = {'MESH': 'MESH', 'ARMATURE': 'SKELETON', 'EMPTY': 'LINK', 'LIGHT': 'LIGHT'}


class GSF_OT_model_new(bpy.types.Operator):
    """Make a new GSF model of the selected objects: a root empty in the active archive collection; the objects become
    its components (meshes, armature, links ...)"""
    bl_idname = 'gsf.model_new'
    bl_label = 'New model from selection'
    bl_options = {'REGISTER', 'UNDO'}
    name: StringProperty(name='Model name', default='new_model')
    fourcc: EnumProperty(name='Class', items=[(x, x, '') for x in ('Misc', 'Deko', 'Bldg', 'Char', 'Anim', 'Vehi', 'Ship',
                                                                    'Wall', 'Fiel', 'Ress', 'Vgtn', 'RIVR')])

    def invoke(self, context, event):
        return context.window_manager.invoke_props_dialog(self)

    def execute(self, context):
        col = active_archive(context)
        if col is None:
            bpy.ops.gsf.archive_new('EXEC_DEFAULT', name='my_models')
            col = active_archive(context)
        mcol = bpy.data.collections.new(self.name)
        col.children.link(mcol)
        root = bpy.data.objects.new(self.name, None)
        root.empty_display_type = 'PLAIN_AXES'
        mcol.objects.link(root)
        g = root.gsf_model
        g.is_root = True
        g.name = self.name
        g.object_name = self.name
        g.fourcc = self.fourcc
        sel = [o for o in context.selected_objects if not o.gsf_model.is_root]
        for k, o in enumerate(sel):
            if o.parent is None or o.parent not in sel:
                mw = o.matrix_world.copy()
                o.parent = root
                o.matrix_world = mw
            if o.name not in mcol.objects:
                mcol.objects.link(o)
            if o.gsf.kind == 'NONE':
                o.gsf.kind = KIND_BY_TYPE.get(o.type, 'NONE')
                if o.type == 'MESH' and o.parent is not None and o.parent.type == 'ARMATURE':
                    o.gsf.p_mesh.type_id = '0x80000000'
            o.gsf.order = 1000 + k
            o.gsf.attributes[0] = True
            for i in range(1, 5):
                o.gsf.attributes[i] = True
        e = col.gsf_archive.entries.add()
        e.name = self.name
        e.fourcc = self.fourcc
        e.state = 'SCENE'
        e.root = root
        e.info = 'new model'
        return {'FINISHED'}


class GSF_OT_set_kind(bpy.types.Operator):
    """Make the selected objects GSF components of a kind"""
    bl_idname = 'gsf.set_kind'
    bl_label = 'Set component kind'
    bl_options = {'REGISTER', 'UNDO'}
    kind: EnumProperty(items=lambda self, ctx: [(i.identifier, i.name, i.description)
                                                for i in P.GSF_PG_chunk.bl_rna.properties['kind'].enum_items])

    def execute(self, context):
        for o in context.selected_objects:
            o.gsf.kind = self.kind
        return {'FINISHED'}


# ============================================================================================ animations
def _rest(o):
    v = o.get('gsf_rest_matrix')
    if v is not None and len(v) == 16:
        return Matrix([v[0:4], v[4:8], v[8:12], v[12:16]])
    return None


class GSF_OT_anim_apply(bpy.types.Operator):
    """Show this animation: assign its actions to the model's objects and set the frame range"""
    bl_idname = 'gsf.anim_apply'
    bl_label = 'Play animation'
    bl_options = {'REGISTER', 'UNDO'}
    index: IntProperty(default=-1)

    def execute(self, context):
        root = model_root(context.active_object)
        if root is None:
            return {'CANCELLED'}
        g = root.gsf_model
        i = self.index if self.index >= 0 else g.anim_index
        if not 0 <= i < len(g.anims):
            return {'CANCELLED'}
        clear_animation(root)
        it = g.anims[i]
        nf = 1
        from .anim import frame_count
        for tr in it.tracks:
            if tr.target is None or tr.action is None:
                continue
            o = tr.target
            if o.type != 'ARMATURE' and o.get('gsf_rest_matrix') is None:
                o['gsf_rest_matrix'] = [x for row in o.matrix_basis for x in row]
            if tr.action.gsf.kind in ('MESH_ANIM', 'BILLBOARD_ANIM') and len(tr.action.gsf.frame_meshes) and 'gsf_base_mesh' not in o:
                o['gsf_base_mesh'] = o.data.name
            compat.assign_action(o, tr.action)
            nf = max(nf, frame_count(tr.action))
        g.anim_index = i
        sc = context.scene
        sc.frame_start = 0
        sc.frame_end = max(nf - 1, 0)
        sc.frame_set(0)
        return {'FINISHED'}


def clear_animation(root):
    from .exp import descendants
    for o in [root] + descendants(root):
        ad = o.animation_data
        if ad is not None and ad.action is not None:
            ad.action = None
            r = _rest(o)
            if r is not None and o.type != 'ARMATURE':
                o.matrix_basis = r
        if o.type == 'ARMATURE':
            for pb in o.pose.bones:
                pb.matrix_basis = Matrix.Identity(4)
        base = o.get('gsf_base_mesh')
        if base and base in bpy.data.meshes and o.type == 'MESH':
            o.data = bpy.data.meshes[base]
            del o['gsf_base_mesh']


class GSF_OT_anim_clear(bpy.types.Operator):
    """Remove the shown animation from the model's objects (back to the rest pose)"""
    bl_idname = 'gsf.anim_clear'
    bl_label = 'Rest pose'
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        root = model_root(context.active_object)
        if root is None:
            return {'CANCELLED'}
        clear_animation(root)
        return {'FINISHED'}


class GSF_OT_anim_add(bpy.types.Operator):
    """Add an animation to the model from the actions its objects have now"""
    bl_idname = 'gsf.anim_add'
    bl_label = 'New animation from current actions'
    bl_options = {'REGISTER', 'UNDO'}
    name: StringProperty(name='Name', default='standanim')

    def invoke(self, context, event):
        return context.window_manager.invoke_props_dialog(self)

    def execute(self, context):
        from .exp import descendants
        root = model_root(context.active_object)
        if root is None:
            self.report({'ERROR'}, 'Select an object of a GSF model')
            return {'CANCELLED'}
        it = root.gsf_model.anims.add()
        it.name = self.name
        n = 0
        for o in descendants(root):
            ad = o.animation_data
            if ad is not None and ad.action is not None and o.gsf.kind != 'NONE':
                tr = it.tracks.add()
                tr.target = o
                tr.action = ad.action
                n += 1
        root.gsf_model.anim_index = len(root.gsf_model.anims) - 1
        self.report({'INFO'}, 'Animation %s with %d animated components' % (self.name, n))
        return {'FINISHED'}


class GSF_OT_anim_remove(bpy.types.Operator):
    """Remove the active animation from the model (its actions stay in the file)"""
    bl_idname = 'gsf.anim_remove'
    bl_label = 'Remove animation'
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        root = model_root(context.active_object)
        if root is None:
            return {'CANCELLED'}
        g = root.gsf_model
        if 0 <= g.anim_index < len(g.anims):
            name = g.anims[g.anim_index].name
            g.anims.remove(g.anim_index)
            g.anim_index = min(g.anim_index, len(g.anims) - 1)
            for ws in g.walksets:
                for s in ws.slots:
                    if s.anim == name:
                        s.anim = ''
        return {'FINISHED'}


# ============================================================================================ generic helpers
class GSF_OT_collection_edit(bpy.types.Operator):
    """Add or remove an entry of a list"""
    bl_idname = 'gsf.collection_edit'
    bl_label = 'Edit list'
    bl_options = {'REGISTER', 'UNDO', 'INTERNAL'}
    path: StringProperty()
    action: EnumProperty(items=[('ADD', 'Add', ''), ('REMOVE', 'Remove', '')])
    index: IntProperty(default=-1)

    def execute(self, context):
        try:
            coll = context.path_resolve(self.path)
        except ValueError:
            return {'CANCELLED'}
        if self.action == 'ADD':
            it = coll.add()
            if self.path.endswith('walksets'):
                for _ in range(len(WALKSET_SLOTS)):
                    it.slots.add()
        elif 0 <= self.index < len(coll):
            coll.remove(self.index)
        return {'FINISHED'}


class GSF_OT_toggle_bit(bpy.types.Operator):
    """Toggle a bit of a hexadecimal flags field"""
    bl_idname = 'gsf.toggle_bit'
    bl_label = 'Toggle bit'
    bl_options = {'REGISTER', 'UNDO', 'INTERNAL'}
    path: StringProperty()
    field: StringProperty()
    bit: IntProperty()

    def execute(self, context):
        try:
            pg = context.path_resolve(self.path)
        except ValueError:
            return {'CANCELLED'}
        v = P.parse_hex(getattr(pg, self.field)) ^ (1 << self.bit)
        setattr(pg, self.field, P.hexs(v))
        return {'FINISHED'}


class GSF_OT_rebuild_material(bpy.types.Operator):
    """Rebuild the preview shader of the material from its GSF settings (texture, alpha mode)"""
    bl_idname = 'gsf.rebuild_material'
    bl_label = 'Rebuild preview'
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        from .materials import build_nodes, TextureFinder
        bm = context.material
        if bm is None:
            return {'CANCELLED'}
        col = active_archive(context)
        data = bpy.path.abspath(col.gsf_archive.data_dir) if col else ''
        if bm.node_tree:
            for n in list(bm.node_tree.nodes):
                if n.type == 'TEX_IMAGE':
                    bm.node_tree.nodes.remove(n)
        build_nodes(bm, TextureFinder(data))
        return {'FINISHED'}


@bpy.app.handlers.persistent
def frame_handler(scene, depsgraph=None):
    """show the mesh frame / sprite cloud the active GSF action selects"""
    for o in scene.objects:
        if o.type != 'MESH' or 'gsf_base_mesh' not in o:
            continue
        ad = o.animation_data
        act = ad.action if ad is not None else None
        if act is None or not len(act.gsf.frame_meshes):
            continue
        prop = 'gsf_mesh_frame' if act.gsf.kind == 'MESH_ANIM' else 'gsf_cloud_frame'
        fc = compat.fcurve_map(act).get(('["%s"]' % prop, 0))
        if fc is None:
            continue
        k = int(round(fc.evaluate(scene.frame_current)))
        if 0 <= k < len(act.gsf.frame_meshes) and act.gsf.frame_meshes[k].mesh is not None:
            me = act.gsf.frame_meshes[k].mesh
            if o.data is not me:
                o.data = me


CLASSES = [IMPORT_SCENE_OT_paraworld_gsf, EXPORT_SCENE_OT_paraworld_gsf, GSF_OT_import_entries, GSF_OT_entry_state, GSF_OT_entry_move,
           GSF_OT_archive_new, GSF_OT_model_new, GSF_OT_set_kind, GSF_OT_anim_apply, GSF_OT_anim_clear, GSF_OT_anim_add,
           GSF_OT_anim_remove, GSF_OT_collection_edit, GSF_OT_toggle_bit, GSF_OT_rebuild_material]


def menu_import(self, context):
    self.layout.operator(IMPORT_SCENE_OT_paraworld_gsf.bl_idname, text='ParaWorld GSF (.gsf)')


def menu_export(self, context):
    self.layout.operator(EXPORT_SCENE_OT_paraworld_gsf.bl_idname, text='ParaWorld GSF (.gsf)')


def register():
    for c in CLASSES:
        bpy.utils.register_class(c)
    bpy.types.TOPBAR_MT_file_import.append(menu_import)
    bpy.types.TOPBAR_MT_file_export.append(menu_export)
    if frame_handler not in bpy.app.handlers.frame_change_post:
        bpy.app.handlers.frame_change_post.append(frame_handler)


def unregister():
    if frame_handler in bpy.app.handlers.frame_change_post:
        bpy.app.handlers.frame_change_post.remove(frame_handler)
    bpy.types.TOPBAR_MT_file_import.remove(menu_import)
    bpy.types.TOPBAR_MT_file_export.remove(menu_export)
    for c in reversed(CLASSES):
        bpy.utils.unregister_class(c)
