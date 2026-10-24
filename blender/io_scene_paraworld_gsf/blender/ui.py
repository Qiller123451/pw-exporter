"""Panels and lists. Chunk, animation, material and model parameters are drawn from the schema, so every field of a
struct (including the unk_* ones) shows up without extra code."""
import bpy

from ..core import names as NAMES
from ..core.archive import WALKSET_SLOTS, WALK_TRANSITION_SLOT
from ..core.chunks import KINDS
from . import props as P
from .ops import active_archive, model_root

BIT_NAMES = {
    ('mesh', 'flags'): NAMES.MESH_FLAG_BITS,
    ('material', 'attributes1'): NAMES.MATERIAL_ATTR1_BITS,
}


def draw_bits(layout, path, pg, field, names):
    v = P.parse_hex(getattr(pg, field))
    grid = layout.grid_flow(columns=2, align=True)
    for bit in sorted(names):
        op = grid.operator('gsf.toggle_bit', text=names[bit], depress=bool(v >> bit & 1))
        op.path, op.field, op.bit = path, field, bit


def draw_struct(layout, pg, struct, kind, ctx=None, path=''):
    for f in P.ui_fields(struct, kind, ctx):
        row = layout.row()
        if f.kind == 'attr':
            continue
        row.prop(pg, f.name)
        names = BIT_NAMES.get((kind, f.name))
        if names and path:
            box = layout.box()
            draw_bits(box, path, pg, f.name, names)


def draw_attributes(layout, pg, fourcc):
    names = NAMES.attribute_bit_names(fourcc)
    col = layout.column(align=True)
    col.label(text='Attributes (visibility bits) = %s' % P.hexs(P.bits_to_int(pg.attributes)))
    grid = col.grid_flow(columns=4, align=True)
    for i in range(32):
        grid.prop(pg, 'attributes', index=i, text=names[i], toggle=True)


def _fourcc_of(obj):
    r = model_root(obj)
    return r.gsf_model.fourcc if r is not None else ''


# ============================================================================================ lists
class GSF_UL_entries(bpy.types.UIList):
    def draw_item(self, context, layout, data, item, icon, active_data, active_property, index=0, flt_flag=0):
        icons = {'FILE': 'FILE', 'SCENE': 'OBJECT_DATA', 'REMOVE': 'X'}
        icon = 'DUPLICATE' if item.copy_of and item.state == 'FILE' else icons.get(item.state, 'DOT')
        row = layout.row(align=True)
        row.prop(item, 'select', text='')
        row.label(text=item.name, icon=icon)
        row.label(text=item.fourcc)

    def filter_items(self, context, data, propname):
        items = getattr(data, propname)
        flt = data.filter.lower()
        flags = [self.bitflag_filter_item if (not flt or flt in it.name.lower()) else 0 for it in items]
        return flags, []


class GSF_UL_anims(bpy.types.UIList):
    def draw_item(self, context, layout, data, item, icon, active_data, active_property, index=0, flt_flag=0):
        row = layout.row(align=True)
        row.prop(item, 'name', text='', emboss=False, icon='ACTION')
        row.label(text='%d' % len(item.tracks))
        op = row.operator('gsf.anim_apply', text='', icon='PLAY')
        op.index = index


class GSF_UL_named(bpy.types.UIList):
    def draw_item(self, context, layout, data, item, icon, active_data, active_property, index=0, flt_flag=0):
        layout.prop(item, 'name', text='%d' % index, emboss=False)


def _edit_op(layout, path, action, index=-1, owner=None, text='', icon='ADD'):
    op = layout.operator('gsf.collection_edit', text=text, icon=icon)
    op.path, op.action, op.index = path, action, index
    if owner is not None:
        op.id_type = 'ACTION' if isinstance(owner, bpy.types.Action) else 'OBJECT'
        op.id_name = owner.name
    return op


def remove_button(row, path, index, owner=None):
    """an X that removes entry `index` of the list at `path`"""
    _edit_op(row, path, 'REMOVE', index, owner, icon='X')


def add_button(layout, path, text, owner=None):
    _edit_op(layout, path, 'ADD', -1, owner, text=text, icon='ADD')


def archive_list_buttons(layout, which, move=True):
    col = layout.column(align=True)
    for action, icon in (('ADD', 'ADD'), ('REMOVE', 'REMOVE')) + ((('UP', 'TRIA_UP'), ('DOWN', 'TRIA_DOWN')) if move else ()):
        if action == 'UP':
            col.separator()
        op = col.operator('gsf.archive_list', text='', icon=icon)
        op.which, op.action = which, action


# ============================================================================================ 3D view sidebar
class GSF_PT_archive(bpy.types.Panel):
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'GSF'
    bl_label = 'GSF Archive'

    def draw(self, context):
        lay = self.layout
        row = lay.row(align=True)
        row.operator('import_scene.paraworld_gsf', text='Open / Import', icon='FILEBROWSER')
        row.operator('gsf.archive_new', text='New', icon='ADD')
        col = active_archive(context)
        if col is None:
            lay.label(text='No archive yet: open a .gsf file')
            return
        g = col.gsf_archive
        lay.label(text=col.name, icon='OUTLINER_COLLECTION')
        lay.prop(g, 'file_name')
        lay.prop(g, 'source_path')
        lay.prop(g, 'data_dir')
        lay.prop(g, 'mirror')
        lay.prop(g, 'filter', icon='VIEWZOOM')
        row = lay.row()
        row.template_list('GSF_UL_entries', '', g, 'entries', g, 'entry_index', rows=8)
        col_b = row.column(align=True)
        for d, ic in (('TOP', 'TRIA_UP_BAR'), ('UP', 'TRIA_UP'), ('DOWN', 'TRIA_DOWN'), ('BOTTOM', 'TRIA_DOWN_BAR')):
            col_b.operator('gsf.entry_move', text='', icon=ic).direction = d
        if 0 <= g.entry_index < len(g.entries):
            lay.label(text=g.entries[g.entry_index].info)
        if g.order_changed:
            lay.label(text='Saved in the order of the list', icon='SORTSIZE')
        row = lay.row(align=True)
        row.operator('gsf.import_entries', text='Import', icon='IMPORT')
        row.operator('gsf.entry_state', text='Keep').state = 'FILE'
        row.operator('gsf.entry_state', text='Remove', icon='X').state = 'REMOVE'
        row.operator('gsf.entry_copy', text='Copy', icon='DUPLICATE')
        row = lay.row(align=True)
        row.operator('gsf.model_new', icon='EMPTY_AXIS')
        row.operator('gsf.sort_lods', text='', icon='OUTLINER_COLLECTION').all_models = True
        lay.operator('export_scene.paraworld_gsf', text='Save archive', icon='EXPORT')


class GSF_PT_archive_data(bpy.types.Panel):
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'GSF'
    bl_label = 'Archive data'
    bl_parent_id = 'GSF_PT_archive'
    bl_options = {'DEFAULT_CLOSED'}

    def draw(self, context):
        col = active_archive(context)
        if col is None:
            return
        g = col.gsf_archive
        lay = self.layout
        lay.prop(g, 'materials_capacity')
        draw_struct(lay, g, P.GSF_PG_archive.STRUCT, 'archive')
        lay.label(text='Sound events (position = index used by animations)')
        row = lay.row()
        row.template_list('GSF_UL_named', 'snd', g, 'sounds', g, 'sound_index', rows=4)
        archive_list_buttons(row, 'sounds')
        if 0 <= g.sound_index < len(g.sounds):
            s = g.sounds[g.sound_index]
            box = lay.box()
            box.prop(s, 'name')
            box.prop(s, 'group')
            draw_struct(box, s.v, P.GSF_PG_sound_fields.STRUCT, 'sound')
        lay.label(text='Dust trails / effects')
        row = lay.row()
        row.template_list('GSF_UL_named', 'dust', g, 'dusttrails', g, 'dusttrail_index', rows=3)
        archive_list_buttons(row, 'dusttrails')
        if 0 <= g.dusttrail_index < len(g.dusttrails):
            d = g.dusttrails[g.dusttrail_index]
            box = lay.box()
            box.prop(d, 'name')
            box.prop_search(d, 'model', g, 'entries')
            for k in ('anim', 'anim_index', 'start_frame'):
                box.prop(d, k)
            box.label(text='Parameters (key, value)')
            for k, kv in enumerate(d.entries):
                r = box.row(align=True)
                r.prop(kv, 'name', text='')
                r.prop(kv, 'value', text='')
                op = r.operator('gsf.archive_list', text='', icon='X')
                op.which, op.action, op.index = 'dust_entries', 'REMOVE', k
            op = box.operator('gsf.archive_list', text='Add parameter', icon='ADD')
            op.which, op.action, op.index = 'dust_entries', 'ADD', len(d.entries) - 1
        lay.label(text='Animation groups (bit k of an animation\'s groups = group k)')
        row = lay.row()
        row.template_list('GSF_UL_named', 'grp', g, 'anim_groups', g, 'anim_group_index', rows=3)
        archive_list_buttons(row, 'anim_groups')
        lay.label(text='Walk transitions (walk set value k = entry k - 1)')
        row = lay.row()
        row.template_list('GSF_UL_named', 'wt', g, 'walk_transitions', g, 'walk_transition_index', rows=3)
        archive_list_buttons(row, 'walk_transitions')


class GSF_PT_model(bpy.types.Panel):
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'GSF'
    bl_label = 'GSF Model'

    @classmethod
    def poll(cls, context):
        return model_root(context.active_object) is not None

    def draw(self, context):
        root = model_root(context.active_object)
        g = root.gsf_model
        lay = self.layout
        row = lay.row(align=True)
        row.label(text=root.name, icon='EMPTY_AXIS')
        row.operator('gsf.sort_lods', text='', icon='OUTLINER_COLLECTION').all_models = False
        row = lay.row()
        row.template_list('GSF_UL_anims', '', g, 'anims', g, 'anim_index', rows=6)
        col = row.column(align=True)
        col.operator('gsf.anim_add', text='', icon='ADD')
        col.operator('gsf.anim_remove', text='', icon='REMOVE')
        col.separator()
        col.operator('gsf.anim_clear', text='', icon='ARMATURE_DATA')
        if 0 <= g.anim_index < len(g.anims):
            it = g.anims[g.anim_index]
            box = lay.box()
            box.prop(it, 'name')
            box.prop(it, 'anim_flags')
            box.prop(it, 'sounds')
            box.prop(it, 'info_name')
            box.label(text='Animated components')
            path = 'gsf_model.anims[%d].tracks' % g.anim_index
            for k, tr in enumerate(it.tracks):
                r = box.row(align=True)
                r.prop(tr, 'target', text='')
                r.prop(tr, 'action', text='')
                remove_button(r, path, k, root)
            add_button(box, path, 'Add component', root)


class GSF_PT_action(bpy.types.Panel):
    """GSF data of the action shown on the active object"""
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'GSF'
    bl_label = 'GSF Action'
    bl_options = {'DEFAULT_CLOSED'}

    @classmethod
    def poll(cls, context):
        o = context.active_object
        return o is not None and o.animation_data is not None and o.animation_data.action is not None

    def draw(self, context):
        act = context.active_object.animation_data.action
        g = act.gsf
        lay = self.layout
        lay.label(text=act.name, icon='ACTION')
        lay.prop(g, 'kind')
        lay.prop(g, 'frames')
        lay.prop(g, 'guid')
        lay.prop(g, 'info_name')
        lay.prop(g, 'info_fourcc')
        kind = g.kind.lower()
        if kind in KINDS:
            draw_struct(lay, getattr(g, 'p_' + kind), KINDS[kind].STRUCT, kind)
        if kind == 'bone_anim':
            lay.prop_search(g, 'helper_bone', context.active_object.data, 'bones')
            lay.prop(g, 'root_format')
            lay.prop(g, 'root_flags')
            box = lay.box()
            box.label(text='Tracks (bone, format, flags, parent)')
            box.label(text='Animated bones get a track anyway; listed bones keep their format')
            arm = context.active_object.data
            for k, t in enumerate(g.tracks):
                r = box.row(align=True)
                r.prop_search(t, 'bone', arm, 'bones', text='')
                r.prop(t, 'format', text='')
                r.prop(t, 'flags', text='')
                r.prop_search(t, 'parent', arm, 'bones', text='')
                remove_button(r, 'gsf.tracks', k, act)
            add_button(box, 'gsf.tracks', 'Add track', act)
        if kind in ('mesh_anim', 'billboard_anim'):
            lay.prop(g, 'storage')
            box = lay.box()
            box.label(text='Frame meshes (%s picks one per frame)' % (
                'gsf_mesh_frame' if kind == 'mesh_anim' else 'gsf_cloud_frame'))
            for k, m in enumerate(g.frame_meshes):
                r = box.row(align=True)
                r.label(text='%d' % k)
                r.prop(m, 'mesh', text='')
                remove_button(r, 'gsf.frame_meshes', k, act)
            add_button(box, 'gsf.frame_meshes', 'Add frame mesh', act)
            box = lay.box()
            box.prop(g, 'has_material_list')
            box.label(text='Material list of the animation')
            for k, m in enumerate(g.materials):
                r = box.row(align=True)
                r.prop(m, 'material', text='')
                remove_button(r, 'gsf.materials', k, act)
            add_button(box, 'gsf.materials', 'Add material', act)
        draw_attributes(lay, g, _fourcc_of(context.active_object))


# ============================================================================================ properties editor
class GSF_PT_object(bpy.types.Panel):
    bl_space_type = 'PROPERTIES'
    bl_region_type = 'WINDOW'
    bl_context = 'object'
    bl_label = 'ParaWorld GSF'

    def draw(self, context):
        o = context.object
        lay = self.layout
        if o.gsf_model.is_root:
            self.draw_root(lay, o)
            return
        g = o.gsf
        lay.prop(g, 'kind')
        if g.kind == 'NONE':
            return
        if g.kind == 'COLLISION':
            lay.prop(g, 'shape')
            lay.label(text='Position and size: the object\'s location and scale')
            draw_attributes(lay, g, _fourcc_of(o))
            return
        kind = g.kind.lower()
        pg = getattr(g, 'p_' + kind, None)
        if pg is None:
            return
        cls = KINDS[kind]
        lay.prop(pg, 'type_id')
        lay.prop(g, 'guid')
        lay.prop(g, 'order')
        t = P.parse_hex(pg.type_id)
        ctx = cls.TYPE_IDS.get(t, next(iter(cls.TYPE_IDS.values())))
        draw_struct(lay, pg, cls.STRUCT, kind, ctx, 'object.gsf.p_' + kind)
        for r in g.refs:
            lay.prop(r, 'target', text=P.REF_LABELS.get(r.field, r.field))
        if kind == 'speedline':
            lay.prop(g, 'material')
        if kind == 'mesh':
            lay.prop(g, 'keep_tangents')
        if kind == 'particle':
            self.draw_particle(lay, o)
        draw_attributes(lay, g, _fourcc_of(o))

    def draw_particle(self, lay, o):
        g = o.gsf
        lay.prop(g, 'has_name')
        lay.prop(g, 'particle_name')
        box = lay.box()
        box.label(text='Texture tiles')
        for k, t in enumerate(g.tiles):
            b = box.box()
            r = b.row(align=True)
            r.prop(t, 'material')
            remove_button(r, 'gsf.tiles', k, o)
            grid = b.grid_flow(columns=2, align=True)
            for key in ('tiles_w_log2', 'tiles_h_log2', 'tile_start', 'tile_last', 'tile_border_width',
                        'tile_border_left', 'mid_x', 'mid_y'):
                grid.prop(t, key)
        add_button(box, 'gsf.tiles', 'Add tile set', o)
        box = lay.box()
        box.label(text='Particle source parameters (in file order)')
        for k, p in enumerate(g.params):
            r = box.row(align=True)
            r.prop(p, 'pname', text='')
            r.prop(p, 'ptype', text='')
            r.prop(p, {'f': 'f', 'i': 'i', 'x': 'x'}[p.ptype], text='')
            remove_button(r, 'gsf.params', k, o)
        add_button(box, 'gsf.params', 'Add parameter', o)

    def draw_root(self, lay, o):
        g = o.gsf_model
        lay.label(text='Model root', icon='EMPTY_AXIS')
        lay.prop(g, 'name')
        lay.prop(g, 'has_object_name')
        if g.has_object_name:
            lay.prop(g, 'object_name')
        lay.prop(g, 'source_name')
        if g.empty_slots:
            lay.prop(g, 'empty_slots')
        draw_struct(lay, g, P.GSF_PG_model.STRUCT, 'model')
        lay.prop(g, 'auto_bbox')
        if not g.auto_bbox:
            lay.prop(g, 'bbox')
        box = lay.box()
        box.label(text='Material list (order = indices used by sprites and emitters)')
        for k, m in enumerate(g.materials):
            r = box.row(align=True)
            r.prop(m, 'material', text='')
            remove_button(r, 'gsf_model.materials', k, o)
        add_button(box, 'gsf_model.materials', 'Add material', o)
        box = lay.box()
        box.label(text='Walk sets')
        for k, ws in enumerate(g.walksets):
            b = box.box()
            r = b.row(align=True)
            r.prop(ws, 'name')
            remove_button(r, 'gsf_model.walksets', k, o)
            for i, s in enumerate(ws.slots):
                r = b.row()
                name = WALKSET_SLOTS[i] if i < len(WALKSET_SLOTS) else 'slot %d' % i
                if i == WALK_TRANSITION_SLOT:
                    r.prop(s, 'value', text=name)
                else:
                    r.prop_search(s, 'anim', g, 'anims', text=name)
        add_button(box, 'gsf_model.walksets', 'Add walk set', o)


class GSF_PT_material(bpy.types.Panel):
    bl_space_type = 'PROPERTIES'
    bl_region_type = 'WINDOW'
    bl_context = 'material'
    bl_label = 'ParaWorld GSF'

    @classmethod
    def poll(cls, context):
        return context.material is not None

    def draw(self, context):
        g = context.material.gsf
        lay = self.layout
        lay.prop(g, 'is_gsf', text='GSF material')
        for k in ('texture', 'normal_map', 'env_map'):
            r = lay.row()
            r.prop(g, 'has_' + k, text='')
            r.prop(g, k)
        draw_struct(lay, g, P.GSF_PG_material_fields.STRUCT, 'material', None, 'material.gsf')
        lay.operator('gsf.rebuild_material', icon='SHADING_TEXTURE')


class GSF_PT_bone(bpy.types.Panel):
    bl_space_type = 'PROPERTIES'
    bl_region_type = 'WINDOW'
    bl_context = 'bone'
    bl_label = 'ParaWorld GSF'

    @classmethod
    def poll(cls, context):
        return context.bone is not None or context.edit_bone is not None

    def draw(self, context):
        b = context.bone or context.edit_bone
        g = b.gsf
        lay = self.layout
        lay.prop(g, 'guid')
        lay.label(text='CRC of the name: %s' % P.hexs(NAMES.crc32(b.name)))
        lay.prop(g, 'flags')
        lay.prop(g, 'scale')
        lay.prop(g, 'order')


CLASSES = [GSF_UL_entries, GSF_UL_anims, GSF_UL_named, GSF_PT_archive, GSF_PT_archive_data, GSF_PT_model,
           GSF_PT_action, GSF_PT_object, GSF_PT_material, GSF_PT_bone]


def register():
    for c in CLASSES:
        bpy.utils.register_class(c)


def unregister():
    for c in reversed(CLASSES):
        bpy.utils.unregister_class(c)
