"""Model archives for a mod: models taken out of the game's archives or out of an archive the Blender add-on wrote,
renamed, their animations renamed for the template's scripts, and written into the mod's own archive.

The archive code is the Blender add-on's core (blender/io_scene_paraworld_gsf/core: pure Python + numpy, no Blender
needed); pwexport/gsf.py reads the result back for the previews and the remake.

    a = load(path)                                    the add-on's GsfArchive
    out = assemble('mymod', [Pick(path, 'stegosaurus', 'mymod_stego', {'walk': 'walk_1'})])
    out.save('mymod.gsf')
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def _core():
    """the add-on's core package: the repository's blender/ folder (or PW_GSF_ADDON = the folder that holds
    io_scene_paraworld_gsf)"""
    for base in [os.path.join(ROOT, 'blender'), os.environ.get('PW_GSF_ADDON') or '']:
        if base and os.path.isdir(os.path.join(base, 'io_scene_paraworld_gsf', 'core')):
            if base not in sys.path:
                sys.path.insert(0, base)
            from io_scene_paraworld_gsf.core import archive        # noqa: E402
            return archive
    raise ImportError('the Blender add-on (blender/io_scene_paraworld_gsf) is missing: the Workshop uses its archive code')


_cache = {}


def load(path):
    """an archive (kept: the game's archives are read once per session)"""
    key = (os.path.abspath(path), os.path.getmtime(path), os.path.getsize(path))
    if key not in _cache:
        if len(_cache) > 6:
            _cache.pop(next(iter(_cache)))
        _cache[key] = _core().GsfArchive.load(path)
    return _cache[key]


class Pick:
    """a model to put into the mod's archive: from archive `path`, model `model`, stored as `name`; anims =
    {name the scripts use: name in the model} - an animation the model has under another name is stored under the
    script's name too (the model keeps its own names)"""

    def __init__(self, path, model, name, anims=None):
        self.path, self.model, self.name, self.anims = path, model, name, dict(anims or {})


def _copy_model(m):
    """a model of a loaded archive, ready to be changed without changing the cached archive: the model's own records
    are copied; chunks, animation data and materials are shared (they are not changed)"""
    import copy
    A = _core()
    n = copy.copy(m)
    n.anim_names = []
    for e in m.anim_names:
        x = A.AnimName(e.name, e.anim)
        x.sounds = list(e.sounds)
        x.v = dict(e.v)
        n.anim_names.append(x)
    old = {id(e): x for e, x in zip(m.anim_names, n.anim_names)}
    n.walksets = []
    for ws in m.walksets:
        w = A.WalkSet(ws.name)
        w.slots = [old.get(id(s), s) if s is not None and not isinstance(s, int) else s for s in ws.slots]
        n.walksets.append(w)
    n.anims = list(m.anims)
    return n, old


def assemble(file_name, picks):
    """the mod's archive with the picked models"""
    A = _core()
    out = A.GsfArchive(file_name)
    out.materials, out.sounds, out.dusttrails, out.anim_infos = [], [], [], []
    out.anim_groups, out.walk_transitions = [], []
    for p in picks:
        src = load(p.path)
        try:
            m0 = src.model(p.model)
        except KeyError:
            m0 = next((m for m in src.models if m.name.lower() == p.model.lower()), None)
            if m0 is None:
                raise KeyError('%s has no model %s' % (os.path.basename(p.path), p.model))
        m, old = _copy_model(m0)
        m.name = m.object_name = p.name
        # animation groups and walk transitions by name (each archive numbers its own)
        gmap = {}
        for k, g in enumerate(src.anim_groups):
            if g not in out.anim_groups:
                out.anim_groups.append(g)
            gmap[k] = out.anim_groups.index(g)
        for e in m.anim_names:
            f, nf = e.v.get('anim_flags', 0), 0
            for k in range(32):
                if f & (1 << k):
                    nf |= 1 << gmap.get(k, k)
            e.v['anim_flags'] = nf
        tmap = {}
        for k, t in enumerate(src.walk_transitions):
            if t not in out.walk_transitions:
                out.walk_transitions.append(t)
            tmap[k + 1] = out.walk_transitions.index(t) + 1
        for ws in m.walksets:
            s = ws.slots[A.WALK_TRANSITION_SLOT]
            ws.slots[A.WALK_TRANSITION_SLOT] = tmap.get(int(s or 0), 0) if s else 0
        # the script's animation names: a model animation the scripts know under another name is renamed; one that
        # serves several names (or whose own name is wanted too) gets more entries in the table of contents (the
        # game finds an animation by any of them; pwexport and the remake see the first one)
        have = {e.name: e for e in m.anim_names}
        wanted = {w for w, s in p.anims.items() if s and w != s}
        by_src = {}
        for want, src_name in p.anims.items():
            if src_name and want != src_name and want not in have:
                by_src.setdefault(src_name, []).append(want)
        for src_name, wants in by_src.items():
            e = have.get(src_name)
            if e is None:
                raise KeyError('%s has no animation %s' % (p.model, src_name))
            if src_name not in wanted and src_name not in p.anims:
                e.name = wants[0]
                have[wants[0]] = e
                del have[src_name]
                wants = wants[1:]
            for want in wants:
                x = A.AnimName(want, e.anim)
                x.sounds = list(e.sounds)
                x.v = dict(e.v)
                m.anim_names.append(x)
                have[want] = x
        for e in m.anim_names:
            for s in e.sounds:
                if s not in out.sounds:
                    out.sounds.append(s)
        out.add_model(m)
        for d in src.dusttrails:
            if d.model is m0:
                nd = A.DustTrail(d.name, m, d.anim_index)
                nd.anim = old.get(id(d.anim)) if d.anim is not None else None
                nd.start_frame, nd.entries = d.start_frame, list(d.entries)
                out.dusttrails.append(nd)
        for ai in src.anim_infos:
            if ai not in out.anim_infos:
                out.anim_infos.append(ai)
    out.prune_anim_infos()
    return out


def describe(path):
    """the models of an archive for the Workshop's lists: [{'name', 'fourcc', 'anims', 'links', 'bbox'}] (read with
    pwexport's reader, which the remake uses too)"""
    if ROOT not in sys.path:
        sys.path.insert(0, ROOT)
    from pwexport import gsf
    a = gsf.Archive(path)
    out = []
    for i, info in enumerate(a.infos):
        out.append({'name': info['name'], 'fourcc': info['fourcc'], 'anims': a.anim_names_index(i),
                    'bbox': info.get('bbox'), 'links': links_of(a, i)})
    return out


def links_of(a, i):
    """the link names of model i (where the scripts hang weapons, riders, flags ...)"""
    r, info = a.r, a.infos[i]
    names = []
    for c in info['chunks']:
        if c is None:
            continue
        try:
            if r.u32(c) & 0x7FFFFFFF == 0xB:          # link chunk (gsf.ksy link_chunk)
                from pwexport import gsf
                L = gsf.parse_link(r, c)
                if L.get('name'):
                    names.append(L['name'])
        except Exception:                          # noqa: BLE001
            continue
    return names


def textures_of(path, model):
    """the texture names model's materials use (each once, in order)"""
    a = load(path)
    m = next((x for x in a.models if x.name.lower() == model.lower()), None)
    if m is None:
        raise KeyError('%s has no model %s' % (os.path.basename(path), model))
    seen, out = set(), []
    lists = [m.material_list] + [getattr(an, 'material_list', None) for ma in m.anims for _, an, _ in ma.tracks]
    for ml in lists:
        if ml is None:
            continue
        mats = ml.materials if ml.materials is not None else [a.materials[i] for i in ml.indices if i < len(a.materials)]
        for mat in mats:
            if isinstance(mat, int):
                continue
            for name in (mat.texture, mat.normal_map):
                if name and name.lower() not in seen:
                    seen.add(name.lower())
                    out.append(name)
    return out


def extract_one(path, model, out_path):
    """one model of an archive as an archive of its own (to tweak it in Blender)"""
    a = assemble(os.path.splitext(os.path.basename(out_path))[0], [Pick(path, model, model)])
    return a.save(out_path)
