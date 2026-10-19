"""Differences between Blender versions (4.2 LTS ... 5.x)."""
import bpy
import numpy as np

LAYERED = hasattr(bpy.types, 'ActionSlot')       # 4.4+: slotted actions (action.fcurves is gone in 5.0)


def new_action(name, id_type='OBJECT'):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    if LAYERED:
        slot = act.slots.new(id_type=id_type, name=name[:60] or 'GSF')
        layer = act.layers.new('Layer')
        strip = layer.strips.new(type='KEYFRAME')
        strip.channelbag(slot, ensure=True)
    return act


def _channelbag(act, create=False):
    if not LAYERED:
        return None
    if not act.slots:
        if not create:
            return None
        act.slots.new(id_type='OBJECT', name=act.name[:60])
    if not act.layers:
        if not create:
            return None
        act.layers.new('Layer')
    layer = act.layers[0]
    if not layer.strips:
        if not create:
            return None
        layer.strips.new(type='KEYFRAME')
    return layer.strips[0].channelbag(act.slots[0], ensure=create)


def fcurves(act):
    """all F-curves of an action"""
    if not LAYERED:
        return list(act.fcurves)
    out = []
    for layer in act.layers:
        for strip in layer.strips:
            for cb in getattr(strip, 'channelbags', []):
                out.extend(cb.fcurves)
    return out


def new_fcurve(act, path, index=0, group=None):
    if LAYERED:
        cb = _channelbag(act, create=True)
        fc = cb.fcurves.new(path, index=index)
        if group:
            g = cb.groups.get(group) or cb.groups.new(group)
            fc.group = g
        return fc
    return act.fcurves.new(path, index=index, action_group=group or '')


def set_keys(fc, frames, values, interpolation='LINEAR'):
    """fast keyframe insertion"""
    n = len(frames)
    fc.keyframe_points.add(n)
    co = np.empty(2 * n, dtype=np.float32)
    co[0::2] = frames
    co[1::2] = values
    fc.keyframe_points.foreach_set('co', co)
    fc.keyframe_points.foreach_set('interpolation', [bpy.types.Keyframe.bl_rna.properties['interpolation'].enum_items[interpolation].value] * n)
    fc.update()


def assign_action(obj, act):
    ad = obj.animation_data or obj.animation_data_create()
    ad.action = act
    if LAYERED and act is not None and act.slots and ad.action_slot is None:
        try:
            ad.action_slot = act.slots[0]
        except (TypeError, RuntimeError):
            pass


def fcurve_map(act):
    """{(data_path, index): fcurve}"""
    return {(fc.data_path, fc.array_index): fc for fc in fcurves(act)}


def sample(fc, frames):
    """values at the given frames (fast path: one key per whole frame, or a single key)"""
    frames = np.asarray(frames, dtype=np.float64)
    n = len(fc.keyframe_points)
    if n:
        co = np.zeros(2 * n, dtype=np.float32)
        fc.keyframe_points.foreach_get('co', co)
        x, y = co[0::2].astype(np.float64), co[1::2].astype(np.float64)
        if n == 1 and fc.extrapolation == 'CONSTANT' and not len(fc.modifiers):
            return np.full(len(frames), y[0])
        if n == len(frames) and np.array_equal(x, frames) and not len(fc.modifiers):
            return y
    return np.array([fc.evaluate(f) for f in frames], dtype=np.float64)


def set_sharp_edges(mesh, sharp):
    """sharp: bool per edge"""
    if hasattr(mesh, 'attributes') and bpy.app.version >= (4, 1, 0):
        a = mesh.attributes.get('sharp_edge') or mesh.attributes.new('sharp_edge', 'BOOLEAN', 'EDGE')
        a.data.foreach_set('value', list(map(bool, sharp)))
    else:
        mesh.edges.foreach_set('use_edge_sharp', list(map(bool, sharp)))


def get_sharp_edges(mesh):
    n = len(mesh.edges)
    if bpy.app.version >= (4, 1, 0):
        a = mesh.attributes.get('sharp_edge')
        if a is None:
            return np.zeros(n, dtype=bool)
        v = np.zeros(n, dtype=bool)
        a.data.foreach_get('value', v)
        return v
    v = np.zeros(n, dtype=bool)
    mesh.edges.foreach_get('use_edge_sharp', v)
    return v


def set_smooth(mesh, smooth=True):
    mesh.polygons.foreach_set('use_smooth', [smooth] * len(mesh.polygons))


def set_custom_normals(mesh, loop_normals):
    if bpy.app.version < (4, 1, 0):
        mesh.use_auto_smooth = True
    mesh.normals_split_custom_set(loop_normals)


def corner_normals(mesh):
    """normal of every face corner (loop), (n, 3)"""
    n = len(mesh.loops)
    out = np.zeros(n * 3, dtype=np.float32)
    if bpy.app.version >= (4, 1, 0):
        mesh.corner_normals.foreach_get('vector', out)
    else:
        mesh.calc_normals_split()
        mesh.loops.foreach_get('normal', out)
    return out.reshape(n, 3)
