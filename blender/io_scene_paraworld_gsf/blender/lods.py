"""Outliner layout of a model: its components sorted into LOD collections, each split by kind.

    <model>                     model collection (holds the root empty)
        <model> Lod0            components whose best (lowest) LOD bit is 0
            <model> Lod0 Collision volume
            <model> Lod0 Skeleton
            <model> Lod0 Mesh
            ...
        <model> Lod1 ... Lod4
        <model> No LOD          components with none of the LOD bits 0-4 set

A component shown on several LODs goes into the best of them (LOD bits 2 and 3 -> Lod2). The layout is only for
the outliner: the exporter finds a model's components through the parent hierarchy below its root, and a
component's LOD bits stay in its GSF properties. After changing LOD bits, *Sort into LOD collections* (GSF Model
panel) moves the components again.
"""
import bpy

from . import props as P

LOD_COUNT = 5

# kind collections, in this order inside a LOD collection (enum id of GSF_PG_chunk.kind -> label)
KIND_LABELS = [
    ('COLLISION', 'Collision volume'),
    ('SKELETON', 'Skeleton'),
    ('MESH', 'Mesh'),
    ('CLOTH', 'Cloth'),
    ('LINK', 'Link'),
    ('PHYS_COLL', 'Cloth collider'),
    ('BILLBOARD', 'Billboard cloud'),
    ('LIGHT_VOLUME', 'Light volume'),
    ('PARTICLE', 'Particle emitter'),
    ('SPEEDLINE', 'Speed line'),
    ('LIGHT', 'Light'),
]
_KIND_RANK = {k: i for i, (k, _) in enumerate(KIND_LABELS)}
_LABEL = dict(KIND_LABELS)
TAG = 'gsf_group'           # custom property of the collections made here: 'lod' or 'kind'


def best_lod(obj):
    """lowest LOD bit set in the object's attributes (0 = best quality), None when no LOD bit is set"""
    bits = obj.gsf.attributes
    return next((k for k in range(LOD_COUNT) if bits[k]), None)


def kind_key(obj):
    k = obj.gsf.kind
    if k == 'MESH' and P.parse_hex(obj.gsf.p_mesh.type_id) & 0xFF == 9:
        return 'CLOTH'
    return k


def kind_label(key):
    if key in _LABEL:
        return _LABEL[key]
    item = P.GSF_PG_chunk.bl_rna.properties['kind'].enum_items.get(key)
    return item.name if item is not None else key.replace('_', ' ').capitalize()


def lod_label(lod):
    return 'No LOD' if lod is None else 'Lod%d' % lod


def _tree(col):
    out = [col]
    for ch in col.children:
        out.extend(_tree(ch))
    return out


def _child(parent, tag, value, name):
    """the tagged child collection of `parent` (made when missing)"""
    for ch in parent.children:
        if ch.get(TAG) == tag and ch.get('gsf_value') == value:
            return ch
    ch = bpy.data.collections.new(name)
    ch[TAG] = tag
    ch['gsf_value'] = value
    parent.children.link(ch)
    return ch


def _reorder(parent, rank):
    """put the tagged children of `parent` in rank order (collections keep the order they were linked in)"""
    now = [ch for ch in parent.children if ch.get(TAG)]
    tagged = sorted(now, key=lambda c: rank(c.get('gsf_value')))
    if tagged == now:
        return          # (relinking would reset the collections' visibility in the view layer)
    for ch in tagged:
        parent.children.unlink(ch)
        parent.children.link(ch)


def model_collection(root):
    """the collection holding a model root (its model collection)"""
    cols = [c for c in root.users_collection if not c.get(TAG)]
    return cols[0] if cols else (root.users_collection[0] if root.users_collection else None)


def components(root, mcol=None):
    """the model's components: objects below the root plus GSF objects already in its collections"""
    seen, out = {root}, []

    def add(o):
        if o not in seen and o.gsf.kind != 'NONE':
            seen.add(o)
            out.append(o)

    stack = list(root.children)
    while stack:
        o = stack.pop(0)
        add(o)
        stack.extend(o.children)
    if mcol is not None:
        for c in _tree(mcol):
            for o in c.objects:
                add(o)
    return out


def sort_model(root, mcol=None):
    """sort the components of the model `root` into LOD and kind collections inside its model collection"""
    mcol = mcol or model_collection(root)
    if mcol is None:
        return 0
    base = root.gsf_model.name or root.name
    inside = set(_tree(mcol))
    n = 0
    for o in components(root, mcol):
        lod = best_lod(o)
        key = kind_key(o)
        lcol = _child(mcol, 'lod', -1 if lod is None else lod, '%s %s' % (base, lod_label(lod)))
        kcol = _child(lcol, 'kind', key, '%s %s %s' % (base, lod_label(lod), kind_label(key)))
        if o.name not in kcol.objects:
            kcol.objects.link(o)
        # out of the model's other collections (collections outside the model are left alone)
        for c in list(o.users_collection):
            if c is not kcol and c in inside:
                c.objects.unlink(o)
        n += 1
    # drop the sorting collections that became empty, then fix their order
    for lcol in [c for c in mcol.children if c.get(TAG) == 'lod']:
        for kcol in [c for c in lcol.children if c.get(TAG) == 'kind']:
            if not len(kcol.objects) and not len(kcol.children):
                bpy.data.collections.remove(kcol)
        if not len(lcol.objects) and not len(lcol.children):
            bpy.data.collections.remove(lcol)
    _reorder(mcol, lambda v: LOD_COUNT if v == -1 else v)
    for lcol in mcol.children:
        if lcol.get(TAG) == 'lod':
            _reorder(lcol, lambda v: _KIND_RANK.get(v, len(_KIND_RANK)))
    return n
