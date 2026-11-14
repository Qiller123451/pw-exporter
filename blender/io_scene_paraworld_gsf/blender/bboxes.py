"""Bounding boxes as cubes in the 3D view (version 1.9.0).

A GSF model has a bounding box (model info), and so has every mesh (its quantisation box: vertex positions are stored
as 13-bit steps inside it). Each can be computed on export ("Automatic bounding box", the default) or set by hand.

Every model root and every mesh can have one cube: an empty with display type CUBE, parented to it and tagged with
`gsf_bbox_cube`. The importer makes them, hidden; "Bounding box cubes" (gsf.bbox_cubes) makes them for other models.
The cube spans the box (location = centre, scale = half size, rotation ignored). Moving or scaling the cube writes
the box into the owner's `bbox` property and turns its automatic box off; editing the property moves the cube.

Boxes are stored in GSF space (the game's axes); the cube lives in Blender space, so the mirror axis of the archive
(stored on the cube as `gsf_s3`) is applied in between.
"""
import bpy
from mathutils import Matrix, Vector

TAG = 'gsf_bbox_cube'
_busy = False          # True while one side writes the other (stops the update ping-pong)


def owner_props(owner):
    """the property group that holds the owner's auto_bbox / bbox (model root or component)"""
    if owner is None:
        return None
    return owner.gsf_model if owner.gsf_model.is_root else owner.gsf


def find_cube(owner):
    for c in owner.children:
        if c.get(TAG):
            return c
    return None


def _s3(cube_or_vec):
    v = cube_or_vec.get('gsf_s3') if hasattr(cube_or_vec, 'get') else cube_or_vec
    return Vector(v) if v is not None and len(v) == 3 else Vector((-1.0, 1.0, 1.0))


def gsf_box_to_local(box, s3):
    """GSF box (min xyz, max xyz) -> (centre, half size) in the owner's Blender space"""
    a = Vector(box[0:3])
    b = Vector(box[3:6])
    a = Vector((a.x * s3.x, a.y * s3.y, a.z * s3.z))
    b = Vector((b.x * s3.x, b.y * s3.y, b.z * s3.z))
    lo = Vector((min(a.x, b.x), min(a.y, b.y), min(a.z, b.z)))
    hi = Vector((max(a.x, b.x), max(a.y, b.y), max(a.z, b.z)))
    half = (hi - lo) / 2.0
    half = Vector((max(half.x, 1e-4), max(half.y, 1e-4), max(half.z, 1e-4)))
    return (lo + hi) / 2.0, half


def cube_to_gsf_box(cube):
    """the box a cube spans, in GSF space (min xyz, max xyz)"""
    s3 = _s3(cube)
    loc, _rot, scale = cube.matrix_basis.decompose()
    half = Vector((abs(scale.x), abs(scale.y), abs(scale.z))) * cube.empty_display_size
    lo = loc - half
    hi = loc + half
    a = Vector((lo.x * s3.x, lo.y * s3.y, lo.z * s3.z))
    b = Vector((hi.x * s3.x, hi.y * s3.y, hi.z * s3.z))
    return (min(a.x, b.x), min(a.y, b.y), min(a.z, b.z), max(a.x, b.x), max(a.y, b.y), max(a.z, b.z))


def place_cube(cube, box):
    global _busy
    centre, half = gsf_box_to_local(box, _s3(cube))
    old = _busy
    _busy = True
    try:
        cube.matrix_basis = Matrix.Translation(centre) @ Matrix.Diagonal((half.x, half.y, half.z, 1.0))
    finally:
        _busy = old


def make_cube(owner, box, s3, collection=None, hidden=True):
    """the owner's cube, made if missing, placed on `box` (GSF space)"""
    cube = find_cube(owner)
    if cube is None:
        cube = bpy.data.objects.new('%s bbox' % owner.name, None)
        cube.empty_display_type = 'CUBE'
        cube.empty_display_size = 1.0
        cube[TAG] = 1
        cube['gsf_s3'] = [float(s3[0]), float(s3[1]), float(s3[2])]
        cols = [collection] if collection is not None else list(owner.users_collection)
        for c in cols or [bpy.context.scene.collection]:
            c.objects.link(cube)
        cube.parent = owner
        cube.matrix_parent_inverse = Matrix.Identity(4)
        cube.hide_render = True
        cube.show_in_front = True
        if hidden:
            cube.hide_viewport = True
    place_cube(cube, box)
    return cube


def on_bbox_prop(self, context):
    """update callback of the bbox properties: move the cube"""
    if _busy:
        return
    owner = self.id_data
    cube = find_cube(owner) if isinstance(owner, bpy.types.Object) else None
    if cube is not None:
        place_cube(cube, tuple(self.bbox))


def sync_from_cube(owner):
    """if the owner's cube spans another box than its bbox property (it was moved or scaled), take the cube's box
    and switch the owner to a set box. Called by the exporter, so an edit is never lost even when the depsgraph
    handler did not run (e.g. scripts in background mode)."""
    global _busy
    cube = find_cube(owner)
    pg = owner_props(owner)
    if cube is None or pg is None:
        return False
    box = cube_to_gsf_box(cube)
    if all(abs(a - b) <= 1e-4 * max(1.0, abs(b)) for a, b in zip(box, pg.bbox)):
        return False
    _busy = True
    try:
        pg.bbox = box
        pg.auto_bbox = False
    finally:
        _busy = False
    return True


def depsgraph_handler(scene, depsgraph):
    """a cube was moved or scaled: write its box into the owner and switch the owner to a set box"""
    global _busy
    if _busy:
        return
    for u in depsgraph.updates:
        if not u.is_updated_transform:
            continue
        ob = u.id
        if not isinstance(ob, bpy.types.Object):
            continue
        cube = ob.original
        if cube is None or not cube.get(TAG) or cube.parent is None:
            continue
        pg = owner_props(cube.parent)
        if pg is None:
            continue
        box = cube_to_gsf_box(cube)
        if all(abs(a - b) <= 1e-4 * max(1.0, abs(b)) for a, b in zip(box, pg.bbox)):
            continue        # float rounding of the cube's matrix, not an edit
        _busy = True
        try:
            pg.bbox = box
            pg.auto_bbox = False
        finally:
            _busy = False


def register():
    if depsgraph_handler not in bpy.app.handlers.depsgraph_update_post:
        bpy.app.handlers.depsgraph_update_post.append(depsgraph_handler)


def unregister():
    if depsgraph_handler in bpy.app.handlers.depsgraph_update_post:
        bpy.app.handlers.depsgraph_update_post.remove(depsgraph_handler)
