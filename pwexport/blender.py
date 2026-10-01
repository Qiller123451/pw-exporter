"""Formats that need Blender (free, https://www.blender.org): FBX, .blend, USD, Alembic, and animated Collada.

The exporter writes a .glb first and lets Blender convert it in the background (no window opens):
    blender -b --factory-startup --python-expr <script> -- in.glb out.fbx

    find()                     -> path of blender(.exe) or None (settings, PATH, the usual install folders)
    convert(glb, out, fmt)     -> list of written files; raises RuntimeError with Blender's output on failure
"""
import glob
import os
import shutil
import subprocess
import sys

FORMATS = {
    'fbx': {'label': 'Autodesk FBX (.fbx)', 'ext': '.fbx', 'animated': True},
    'blend': {'label': 'Blender (.blend)', 'ext': '.blend', 'animated': True},
    'usd': {'label': 'Universal Scene Description (.usdc)', 'ext': '.usdc', 'animated': True},
    'abc': {'label': 'Alembic (.abc)', 'ext': '.abc', 'animated': True},
    'dae_anim': {'label': 'Collada with animation (.dae, Blender 4.x)', 'ext': '.dae', 'animated': True},
}

SCRIPT = r'''
import bpy, sys, os
argv = sys.argv[sys.argv.index("--") + 1:]
src, dst, fmt = argv[0], argv[1], argv[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
# play range = the longest action, so animated formats get every frame
end = 1
for a in bpy.data.actions:
    end = max(end, int(a.frame_range[1]))
bpy.context.scene.frame_end = end
if fmt == "fbx":
    bpy.ops.export_scene.fbx(filepath=dst, path_mode="COPY", embed_textures=True, bake_anim=True, add_leaf_bones=False)
elif fmt == "blend":
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=dst)
elif fmt == "usd":
    bpy.ops.wm.usd_export(filepath=dst, export_animation=True)
elif fmt == "abc":
    bpy.ops.wm.alembic_export(filepath=dst, start=1, end=end)
elif fmt == "dae_anim":
    bpy.ops.wm.collada_export(filepath=dst, include_animations=True)
print("PWEXPORT_OK")
'''


def find(configured=''):
    if configured and os.path.isfile(configured):
        return configured
    exe = shutil.which('blender')
    if exe:
        return exe
    cands = []
    if sys.platform == 'win32':
        for base in (os.environ.get('ProgramFiles', r'C:\Program Files'), os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)')):
            cands += glob.glob(os.path.join(base, 'Blender Foundation', 'Blender*', 'blender.exe'))
        cands += glob.glob(os.path.join(os.environ.get('ProgramFiles', r'C:\Program Files'), 'Steam', 'steamapps', 'common', 'Blender', 'blender.exe'))
        cands += glob.glob(r'C:\Program Files (x86)\Steam\steamapps\common\Blender\blender.exe')
    elif sys.platform == 'darwin':
        cands += ['/Applications/Blender.app/Contents/MacOS/Blender']
    else:
        cands += glob.glob('/opt/blender*/blender') + glob.glob(os.path.expanduser('~/blender*/blender'))
    cands = [c for c in cands if os.path.isfile(c)]
    return sorted(cands)[-1] if cands else None      # newest version folder last


def convert(blender_exe, glb_path, out_path, fmt, timeout=600):
    if not blender_exe:
        raise RuntimeError('Blender was not found. Install it from https://www.blender.org or set its path in the settings.')
    p = subprocess.run([blender_exe, '-b', '--factory-startup', '--python-expr', SCRIPT, '--', glb_path, out_path, fmt],
                       capture_output=True, text=True, timeout=timeout)
    if 'PWEXPORT_OK' not in p.stdout or not os.path.exists(out_path):
        raise RuntimeError('Blender could not write the file:\n' + (p.stdout[-2000:] + p.stderr[-2000:]).strip())
    return [out_path]
