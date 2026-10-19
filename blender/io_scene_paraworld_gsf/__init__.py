"""ParaWorld GSF archives for Blender: import, edit and export models, rigs, animations and effects.

core/      the file format, no Blender needed (read, edit, write archives; normal lookup sphere)
blender/   properties, import, export, panels
"""
bl_info = {
    'name': 'ParaWorld GSF format',
    'author': 'Kacper, with Claude',
    'version': (1, 0, 0),
    'blender': (4, 2, 0),
    'location': 'File > Import / Export > ParaWorld GSF; 3D View > Sidebar > GSF',
    'description': 'Import, edit and export ParaWorld .gsf model archives (meshes, skeletons, animations, effects)',
    'category': 'Import-Export',
}

try:
    import bpy  # noqa: F401
    _HAS_BPY = True
except ImportError:          # the core package also works outside Blender
    _HAS_BPY = False


def register():
    from .blender import props, ops, ui
    props.register()
    ops.register()
    ui.register()


def unregister():
    from .blender import props, ops, ui
    ui.unregister()
    ops.unregister()
    props.unregister()
