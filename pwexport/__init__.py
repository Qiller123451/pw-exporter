"""pwexport - ParaWorld model and map extraction library and the Model & Map Exporter app.

Modules
    gsf        .gsf archives -> glTF 2.0 (.glb): meshes, textures, rigs, attachment points, animations
    glb        helpers for .glb files (load/save, trim animations, find walk loops, list links)
    tree       parser of the game's text data files (tech tree, class and settings files)
    install    paths inside a ParaWorld installation (mods, locale, archives)
    gamedata   tech tree, class files, models per object
    texts      display names / descriptions in every language the game ships
    catalog    model index (model -> archive) and the unit/building catalog with add-ons
    ula        map files (.ula): reader, unpack / pack; Kaitai Struct descriptions in data/ksy
    scape      the ground materials of every setting
    mapexport  maps -> 3D files, height maps, object lists
    app        the Model & Map Exporter (local web app; the toolkit's launcher embeds it)
"""
from .gsf import VERSION  # noqa: F401
