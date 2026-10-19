"""Pure-Python reader / writer of ParaWorld .gsf model archives (no Blender needed).

    from io_scene_paraworld_gsf.core import GsfArchive
    a = GsfArchive.load('all_animals.gsf')
    m = a.model('allosaurus')
    a.save('out.gsf')
"""
from .binio import GsfError  # noqa: F401
from .archive import GsfArchive, Model, ModelAnim, AnimInfo  # noqa: F401
