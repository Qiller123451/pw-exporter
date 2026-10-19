"""Smoke test of the add-on inside Blender (run with Blender's Python or the bpy module):
operators (import / export / archive editing / animations) and every panel's draw code against a recording layout
that checks each property it shows exists.

    blender -b -P tests/blender_ui_smoke.py -- <archive.gsf> <model pattern>
"""
import os
import sys
import types

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import bpy  # noqa: E402

import io_scene_paraworld_gsf as addon  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[-2:]
path, pattern = args[0], args[1]
addon.register()

errors = []


class Layout:
    """records layout calls and checks that every shown property exists"""

    def __getattr__(self, name):
        if name in ('row', 'column', 'box', 'grid_flow', 'split', 'column_flow'):
            return lambda *a, **k: Layout()
        if name in ('label', 'separator', 'template_list', 'menu', 'popover'):
            return lambda *a, **k: None
        if name == 'operator':
            return lambda idname, **k: types.SimpleNamespace()
        if name in ('prop', 'prop_search'):
            def prop(data, prop_name, *a, **k):
                if data is None:
                    return
                props = data.bl_rna.properties
                if prop_name not in props:
                    errors.append('%s has no property %s' % (type(data).__name__, prop_name))
                if name == 'prop_search' and len(a) >= 2 and a[0] is not None and a[1] not in a[0].bl_rna.properties:
                    errors.append('search collection %s missing' % a[1])
            return prop
        raise AttributeError(name)


def draw(panel_cls, **ctx):
    c = types.SimpleNamespace(**ctx)
    p = types.SimpleNamespace(layout=Layout())
    for k, v in panel_cls.__dict__.items():
        if k.startswith('draw') and callable(v):
            setattr(p, k, types.MethodType(v, p))
    try:
        if hasattr(panel_cls, 'poll') and not panel_cls.poll(c):
            return False
        panel_cls.draw(p, c)
        return True
    except Exception as e:      # noqa: BLE001
        import traceback
        traceback.print_exc()
        errors.append('%s.draw: %s' % (panel_cls.__name__, e))
        return False


# ------------------------------------------------------------------------------------------- operators
r = bpy.ops.import_scene.paraworld_gsf(filepath=path, models=pattern, textures=False)
print('import', r)
col = next(c for c in bpy.data.collections if c.gsf_archive.is_archive)
roots = [o for o in bpy.data.objects if o.gsf_model.is_root]
print('roots', [o.name for o in roots])
sc = bpy.context.scene
from io_scene_paraworld_gsf.blender import ui  # noqa: E402

drawn = set()
for o in bpy.data.objects:
    bpy.context.view_layer.objects.active = o
    ctx = dict(active_object=o, object=o, scene=sc, material=o.active_material,
               bone=o.data.bones[0] if o.type == 'ARMATURE' and len(o.data.bones) else None, edit_bone=None)
    for pc in ui.CLASSES:
        if issubclass(pc, bpy.types.Panel) and draw(pc, **ctx):
            drawn.add(pc.__name__)
print('panels drawn:', sorted(drawn))
# play the first animation of each model, then go back to the rest pose
for root in roots:
    bpy.context.view_layer.objects.active = root
    if len(root.gsf_model.anims):
        print('play', root.name, root.gsf_model.anims[0].name, bpy.ops.gsf.anim_apply(index=0))
        sc.frame_set(3)
        for pc in ui.CLASSES:
            if issubclass(pc, bpy.types.Panel):
                draw(pc, active_object=root, object=root, scene=sc, material=None, bone=None, edit_bone=None)
        print('rest', bpy.ops.gsf.anim_clear())
# archive editing: mark the first entry removed, add a model from a selection
g = col.gsf_archive
g.entry_index = 0
print('remove', bpy.ops.gsf.entry_state(state='REMOVE'))
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.mesh.primitive_cube_add(size=1.0)
cube = bpy.context.active_object
cube.select_set(True)
print('new model', bpy.ops.gsf.model_new(name='test_cube', fourcc='Deko'))
import tempfile  # noqa: E402
out = os.path.join(tempfile.mkdtemp(), 'smoke_out.gsf')
print('export', bpy.ops.export_scene.paraworld_gsf(filepath=out, archive=col.name))
from io_scene_paraworld_gsf.core import GsfArchive  # noqa: E402
a = GsfArchive.load(out)
print('saved archive: %d models, has test_cube: %s, first entry removed: %s' % (
    len(a.models), 'test_cube' in a.names(), g.entries[0].name not in a.names()))
m = a.model('test_cube')
print('test_cube chunks', m.chunks, [len(s.tris) for s in m.chunks[0].mesh.submeshes])
print('ERRORS:', errors or 'none')
