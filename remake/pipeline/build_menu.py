"""Step "menu": the original menu art (Data/Base/UI/menue/**) -> <OUT>/assets/ui/menu/menue__<folder>__<name>.png|jpg.
Used by the menus and the loading screen (index.src.html CSS, src/ui/menu.js)."""
import glob
import os
import shutil
import sys

from PIL import Image
try:
    from . import paths
except ImportError:
    import paths


def run(log=print, progress=None):
    src = paths.data('Base/UI/menue')
    out = os.path.join(paths.OUT, 'assets', 'ui', 'menu')
    os.makedirs(out, exist_ok=True)
    n = 0
    for f in glob.glob(os.path.join(src, '**', '*'), recursive=True):
        ext = os.path.splitext(f)[1].lower()
        if ext not in ('.tga', '.jpg', '.png'):
            continue
        rel = os.path.relpath(f, src)
        name = 'menue__' + '__'.join(os.path.splitext(rel)[0].split(os.sep)).lower()
        if ext == '.jpg':
            shutil.copy(f, os.path.join(out, name + '.jpg'))
        else:
            Image.open(f).save(os.path.join(out, name + '.png'))
        n += 1
    log('menu images', n)


if __name__ == '__main__':
    paths.configure(sys.argv[1], sys.argv[2])
    run()
