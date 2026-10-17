"""Step "menu": the original menu art (UI/menue/** of every Data folder of the configuration) -> <OUT>/assets/ui/menu/menue__<folder>__<name>.png|jpg.
Used by the menus and the loading screen (index.src.html CSS, src/ui/menu.js)."""
import os
import shutil
import stat
import sys

from PIL import Image
try:
    from . import paths
except ImportError:
    import paths


def _writable(dst):
    """an older build may have left a read-only copy (shutil.copy carried the game file's read-only flag over)"""
    if os.path.exists(dst):
        os.chmod(dst, stat.S_IWRITE | stat.S_IREAD)
    return dst


def run(log=print, progress=None):
    out = os.path.join(paths.OUT, 'assets', 'ui', 'menu')
    os.makedirs(out, exist_ok=True)
    n = 0
    # the menu art of every folder of the configuration (a mod ships only what it changes or adds)
    for rel, f in paths.game().tree('UI/menue').items():
        ext = os.path.splitext(rel)[1]
        if ext not in ('.tga', '.jpg', '.png'):
            continue
        name = 'menue__' + '__'.join(os.path.splitext(rel)[0].split('/'))
        if ext == '.jpg':
            # copyfile: data only, not the permission bits (the game's files are often read-only)
            shutil.copyfile(f, _writable(os.path.join(out, name + '.jpg')))
        else:
            Image.open(f).save(_writable(os.path.join(out, name + '.png')))
        n += 1
    log('menu images', n)


if __name__ == '__main__':
    paths.configure(sys.argv[1], sys.argv[2])
    run()
