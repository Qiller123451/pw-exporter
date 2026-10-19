"""Build the installable add-on: blender/dist/io_scene_paraworld_gsf.zip

    python blender/make_zip.py

Install it in Blender: Edit > Preferences > Add-ons > Install from Disk.
"""
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = 'io_scene_paraworld_gsf'


def main():
    out_dir = os.path.join(HERE, 'dist')
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, PKG + '.zip')
    n = 0
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for d, dirs, files in os.walk(os.path.join(HERE, PKG)):
            dirs[:] = [x for x in dirs if x != '__pycache__']
            for f in sorted(files):
                if f.endswith('.pyc'):
                    continue
                p = os.path.join(d, f)
                z.write(p, os.path.relpath(p, HERE))
                n += 1
        z.write(os.path.join(HERE, 'README.md'), PKG + '/README.md')
    print('%s (%d files)' % (out, n + 1))


if __name__ == '__main__':
    main()
