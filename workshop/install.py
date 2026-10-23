"""Put a built mod into the game installation, take it out again, and zip it for sharing.

    install(build_dir, game_root, mod, langs=True)    copies Data/<Mod> and Data/Info/<Mod>.info into the game;
                                                      langs: also registers the mod's texts with the language packs
    uninstall(game_root, mod)                         removes them again (and the language pack lines)
    zip_mod(build_dir, mod, out_zip)

The language packs (Data/Info/Locale_<LANG>.info) list the folders whose Locale/<lang> texts the game reads -
MIRAGE's installer added its own line there. The Workshop adds one line per pack,
"tryfilereplace */data/base/* data/base/ data/<Mod>/locale/<lang>/", and keeps a copy of the file the first time
(Locale_<LANG>.info.workshop-backup); uninstall removes that line.

The game starts a mod with "PWClient.exe -enable <Mod>" (bin folder); the toolkit's Workshop page has a button.
"""
import os
import shutil
import zipfile

MARK = '# ParaWorld Workshop:'


def _ci(base, name):
    if not os.path.isdir(base):
        return None
    low = name.lower()
    return next((os.path.join(base, e) for e in os.listdir(base) if e.lower() == low), None)


def data_dir(game_root):
    d = _ci(game_root, 'Data') if os.path.basename(game_root.rstrip('/\\')).lower() != 'data' else game_root
    if not d or not os.path.isdir(d):
        raise ValueError('%s has no Data folder' % game_root)
    return d


def install(build_dir, game_root, mod, langs=True):
    data = data_dir(game_root)
    src = os.path.join(build_dir, 'Data', mod)
    info = os.path.join(build_dir, 'Data', 'Info', mod + '.info')
    if not os.path.isdir(src) or not os.path.isfile(info):
        raise ValueError('build the mod first')
    dst = os.path.join(data, mod)
    if os.path.isdir(dst):
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    os.makedirs(os.path.join(data, 'Info'), exist_ok=True)
    shutil.copyfile(info, os.path.join(data, 'Info', mod + '.info'))
    done = [dst, os.path.join(data, 'Info', mod + '.info')]
    if langs:
        done += register_texts(data, mod, src)
    return done


def register_texts(data, mod, src):
    """one line per language pack whose language the mod has texts in"""
    out = []
    loc = _ci(src, 'Locale')
    have = {e.lower() for e in os.listdir(loc)} if loc else set()
    info = _ci(data, 'Info')
    for f in sorted(os.listdir(info)) if info else []:
        if not (f.lower().startswith('locale_') and f.lower().endswith('.info')):
            continue
        lang = f[len('locale_'):-len('.info')].lower()
        if lang not in have:
            continue
        p = os.path.join(info, f)
        with open(p, encoding='latin-1') as fh:
            text = fh.read()
        line = 'tryfilereplace */data/base/* data/base/ data/%s/locale/%s/' % (mod, lang)
        if line.lower() in text.lower():
            continue
        bak = p + '.workshop-backup'
        if not os.path.exists(bak):
            shutil.copyfile(p, bak)
        nl = '\r\n' if '\r\n' in text else '\n'
        with open(p, 'w', encoding='latin-1', newline='') as fh:
            fh.write(text.rstrip('\r\n') + nl + '%s %s%s' % (MARK, mod, nl) + line + nl)
        out.append(p)
    return out


def uninstall(game_root, mod):
    data = data_dir(game_root)
    gone = []
    d = os.path.join(data, mod)
    if os.path.isfile(os.path.join(data, 'Info', mod + '.info')):
        with open(os.path.join(data, 'Info', mod + '.info'), encoding='latin-1') as f:
            if 'ParaWorld Workshop' not in f.read():
                raise ValueError('%s was not installed by the Workshop' % mod)
        os.remove(os.path.join(data, 'Info', mod + '.info'))
        gone.append(mod + '.info')
    if os.path.isdir(d):
        shutil.rmtree(d)
        gone.append(d)
    info = _ci(data, 'Info')
    for f in sorted(os.listdir(info)) if info else []:
        if not f.lower().endswith('.info'):
            continue
        p = os.path.join(info, f)
        with open(p, encoding='latin-1') as fh:
            lines = fh.read().splitlines(True)
        keep, skip = [], False
        for l in lines:
            if l.strip() == '%s %s' % (MARK, mod):
                skip = True
                continue
            if skip and ('data/%s/locale/' % mod).lower() in l.lower():
                skip = False
                continue
            skip = False
            keep.append(l)
        if len(keep) != len(lines):
            with open(p, 'w', encoding='latin-1', newline='') as fh:
                fh.write(''.join(keep))
            gone.append(p)
    return gone


def installed(game_root, mod):
    try:
        data = data_dir(game_root)
    except ValueError:
        return False
    return os.path.isfile(os.path.join(data, 'Info', mod + '.info')) and os.path.isdir(os.path.join(data, mod))


def zip_mod(build_dir, mod, out_zip):
    """Data/<Mod>/... and Data/Info/<Mod>.info in a zip, to unpack into the game folder"""
    with zipfile.ZipFile(out_zip, 'w', zipfile.ZIP_DEFLATED) as z:
        base = os.path.join(build_dir, 'Data')
        for dp, _, fs in os.walk(os.path.join(base, mod)):
            for f in fs:
                p = os.path.join(dp, f)
                z.write(p, os.path.join('Data', os.path.relpath(p, base)))
        z.write(os.path.join(base, 'Info', mod + '.info'), 'Data/Info/%s.info' % mod)
        z.writestr('README.txt', README % {'mod': mod})
    return out_zip


README = """%(mod)s - a ParaWorld mod made with the ParaWorld Workshop

Install: unpack this zip into the ParaWorld folder (the one with "Data" and "bin"), so that Data\\%(mod)s and
Data\\Info\\%(mod)s.info are there.
Start: bin\\PWClient.exe -enable %(mod)s   (a shortcut with that line, or the toolkit's Workshop page)
Texts: the names and tooltips are in Data\\%(mod)s\\Locale\\<language>. For the game to read them, add this line to
Data\\Info\\Locale_UK.info (and the other languages):
    tryfilereplace */data/base/* data/base/ data/%(mod)s/locale/uk/
The ParaWorld Toolkit's Workshop does this itself when it installs the mod.
"""
