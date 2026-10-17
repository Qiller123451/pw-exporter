"""Render built models the way the game shows them (diffuse only, a sun from the south-west, the RTS camera):
python3 -m remake.art.sequel.preview <data or built folder> <out.png> name [name ...]   (one picture, models side by side)"""
import sys, os, math
import bpy
from mathutils import Vector


def render(data_dir, out, names, size=640, yaw=35, pitch=38, samples=32):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    x = 0.0
    objs = []
    for n in names:
        before = set(bpy.data.objects)
        base = os.path.join(data_dir, 'assets') if os.path.isdir(os.path.join(data_dir, 'assets')) else data_dir    # a data folder or a built folder
        bpy.ops.import_scene.gltf(filepath=os.path.join(base, 'models', n + '.glb'))
        new = [o for o in bpy.data.objects if o not in before]
        meshes = [o for o in new if o.type == 'MESH']
        lo = min((o.matrix_world @ Vector(c)).x for o in meshes for c in o.bound_box)
        hi = max((o.matrix_world @ Vector(c)).x for o in meshes for c in o.bound_box)
        root = [o for o in new if o.parent is None][0]
        root.location.x += x - lo
        x += (hi - lo) + 2.0
        objs += meshes
        for o in meshes:
            for m in o.data.materials:
                b = m.node_tree.nodes.get('Principled BSDF')
                if b:
                    b.inputs['Roughness'].default_value = 1.0
                    b.inputs['Specular IOR Level'].default_value = 0.0
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (lo + hi) / 2
    # ground
    bpy.ops.mesh.primitive_plane_add(size=400, location=(c.x, c.y, 0))
    g = bpy.context.active_object
    gm = bpy.data.materials.new('ground'); gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.32, 0.30, 0.18, 1)
    gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 1.0
    g.data.materials.append(gm)
    # sun + sky
    sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.2; sun.angle = math.radians(3)
    so = bpy.data.objects.new('sun', sun); scn.collection.objects.link(so)
    so.rotation_euler = (math.radians(50), 0, math.radians(-40))
    scn.world = bpy.data.worlds.new('w'); scn.world.use_nodes = True
    scn.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.62, 0.72, 1)
    scn.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    # the camera: from the front-left above (the front looks along -z in glTF = +y in Blender after import? glTF -z -> Blender +y)
    cam = bpy.data.cameras.new('cam'); cam.type = 'ORTHO'
    co = bpy.data.objects.new('cam', cam); scn.collection.objects.link(co); scn.camera = co
    span = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)
    cam.ortho_scale = span * 1.15
    d = span * 3
    a, p = math.radians(yaw), math.radians(pitch)
    co.location = c + Vector((-math.sin(a) * math.cos(p) * d, math.cos(a) * math.cos(p) * d, math.sin(p) * d))
    co.rotation_euler = (c - co.location).to_track_quat('-Z', 'Y').to_euler()
    scn.render.engine = 'CYCLES'; scn.cycles.samples = samples; scn.cycles.device = 'CPU'
    scn.render.resolution_x = size * len(names) if len(names) > 1 else size
    cam.ortho_scale = max(hi.x - lo.x, 1) * 1.1 if len(names) > 1 else cam.ortho_scale
    scn.render.resolution_y = size
    scn.render.filepath = out
    scn.view_settings.view_transform = 'Standard'
    bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    render(sys.argv[1], sys.argv[2], sys.argv[3:])
