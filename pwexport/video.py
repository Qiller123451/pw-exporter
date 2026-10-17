"""The story films of the campaign (Bink videos, Data/locale/<lang>/Video/hs_*.bik and ns_*.bik) for a web browser:
converted once to WebM (VP9 + Opus: every browser plays it, Chromium too) with ffmpeg.

ffmpeg: the one on the PATH, else the pip package imageio-ffmpeg (a bundled ffmpeg; installed with
`python -m pip install --user imageio-ffmpeg` the first time it is needed).

Which file: the language's own films first (Data/locale/<lang>/Video, then the same folder of every loaded mod),
then Data/<folder>/Video of the configuration, then the films of any other language. Data/Base/Video of many
installations holds only placeholders (160 x 80 pixels, 4 seconds, ~40 KB): files below 1 MB are skipped.

    python -m pwexport.video <ParaWorld folder> <output folder> [lang]     converts every film into <output folder>
"""
import os
import shutil
import subprocess
import sys

from .install import _ci_join

PLACEHOLDER = 1 << 20           # bytes: smaller films are the installation's dummies
_ffmpeg = None


def ffmpeg(log=print, install=True):
    """path of an ffmpeg executable, or None"""
    global _ffmpeg
    if _ffmpeg:
        return _ffmpeg
    exe = shutil.which('ffmpeg')
    if not exe:
        try:
            import imageio_ffmpeg
            exe = imageio_ffmpeg.get_ffmpeg_exe()
        except ImportError:
            if not install:
                return None
            log('installing ffmpeg (pip package imageio-ffmpeg, once) ...')
            r = subprocess.run([sys.executable, '-m', 'pip', 'install', '--user', '--quiet', 'imageio-ffmpeg'],
                               capture_output=True, text=True)
            if r.returncode:
                log('could not install imageio-ffmpeg: ' + (r.stderr or r.stdout).strip()[-400:])
                return None
            import importlib
            import site
            importlib.invalidate_caches()
            p = site.getusersitepackages()
            if p not in sys.path:
                sys.path.append(p)
            try:
                import imageio_ffmpeg
                exe = imageio_ffmpeg.get_ffmpeg_exe()
            except (ImportError, RuntimeError) as e:
                log('imageio-ffmpeg: %s' % e)
                return None
        except RuntimeError as e:
            log('imageio-ffmpeg: %s' % e)
            return None
    _ffmpeg = exe
    return exe


def _video_dirs(inst, lang):
    """the folders that can hold the films, best first"""
    out = []
    loc = _ci_join(inst.data, 'locale')

    def add(d):
        if d and os.path.isdir(d) and d not in out:
            out.append(d)
    if loc:
        add(_ci_join(loc, '%s/Video' % lang))
    for m in reversed(inst.mods):
        add(_ci_join(os.path.join(inst.data, m), 'locale/%s/Video' % lang))
    for m in reversed(inst.mods):
        add(_ci_join(os.path.join(inst.data, m), 'Video'))
    if loc:
        for l in sorted(os.listdir(loc)):
            add(_ci_join(loc, '%s/Video' % l))
    return out


def find(inst, name, lang):
    """the Bink file of a film (e.g. 'hs_2560.bik'), or None"""
    for d in _video_dirs(inst, lang):
        p = _ci_join(d, name)
        if p and os.path.isfile(p) and os.path.getsize(p) >= PLACEHOLDER:
            return p
    return None


def films(inst):
    """the names of the story films the installation has (hs_*.bik, ns_*.bik of every video folder)"""
    names = set()
    for d in _video_dirs(inst, ''):
        for f in os.listdir(d):
            if f.lower().endswith('.bik') and f.lower().startswith(('hs_', 'ns_')):
                names.add(f.lower())
    return sorted(names)


def convert(src, dst, log=print):
    """Bink -> WebM (written next to dst first). True when done."""
    exe = ffmpeg(log)
    if not exe:
        return False
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    tmp = dst + '.tmp.webm'
    cmd = [exe, '-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '33',
           '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-c:a', 'libopus', '-b:a', '96k', tmp]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode or not os.path.isfile(tmp):
        log('%s: %s' % (os.path.basename(src), (r.stderr or '').strip()[-400:]))
        try:
            os.remove(tmp)
        except OSError:
            pass
        return False
    os.replace(tmp, dst)
    return True


def convert_all(inst, out_dir, lang, log=print, progress=None, stop=None):
    """every film the installation has -> <out_dir>/<name>.webm (existing ones are kept). Returns (done, total)."""
    names = films(inst)
    done = 0
    for i, n in enumerate(names):
        if stop and stop():
            break
        dst = os.path.join(out_dir, os.path.splitext(n)[0] + '.webm')
        if progress:
            progress(n, i, len(names))
        if os.path.isfile(dst):
            done += 1
            continue
        src = find(inst, n, lang)
        if not src:
            continue
        if convert(src, dst, log):
            done += 1
        elif not _ffmpeg:
            break                               # no ffmpeg: the others would fail as well
    return done, len(names)


if __name__ == '__main__':
    from .install import Install
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    inst = Install(sys.argv[1])
    print(convert_all(inst, sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else 'uk',
                      progress=lambda n, i, t: print('%d/%d %s' % (i + 1, t, n))))
