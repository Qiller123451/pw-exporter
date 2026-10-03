"""Where things are in a ParaWorld installation.

    game = Install('E:/Paraworld')         # the install folder (or its Data folder)
    game.data                               # .../Data
    game.mods                               # ['Base', 'BoosterPack1', ...] present, in override order
    game.file('Scripts/Server/settings/techtree/_TechTree.ttree')   # newest mod's copy wins
    game.archives()                         # {'all_animals': '.../Base/GSF/all_animals.gsf', ...} newest mod's copy
    game.archive_list()                     # every copy: [{'mod', 'name', 'path'}]
    game.locales()                          # ['uk', 'de', ...] text languages
    Install.find()                          # guess install folders on this computer

The game stores its data in Data/<mod>/...: Base is the original release, BoosterPack1 the last official
patch (its scripts and tech tree override Base). BoosterPack3 / MIRAGE / Wintermod are add-ons and community mods;
their models are listed too, but the rules (tech tree) come from the official mods only.
File names are matched case-insensitively (the game ships "H_Hu_Gebaeude.SEML" next to "H_general.seml").
"""
import glob
import os
import string
import sys

OFFICIAL = ['Base', 'BoosterPack1']                  # rules: later overrides earlier
MODEL_MODS = ['Base', 'BoosterPack1', 'BoosterPack3', 'MIRAGE', 'Wintermod']   # models: Base first
LANGS = {
    'uk': 'English', 'de': 'Deutsch', 'fr': 'Français', 'it': 'Italiano', 'pl': 'Polski', 'ru': 'Русский',
    'cz': 'Čeština', 'hu': 'Magyar', 'zh': '中文', 'es': 'Español', 'en': 'English',
}


def _ci_join(base, rel):
    """case-insensitive path join (Windows doesn't care; Linux/macOS copies of the game do)"""
    p = base
    for part in rel.replace('\\', '/').split('/'):
        if not part:
            continue
        q = os.path.join(p, part)
        if os.path.exists(q):
            p = q
            continue
        try:
            low = part.lower()
            hit = next((e for e in os.listdir(p) if e.lower() == low), None)
        except OSError:
            hit = None
        if hit is None:
            return None
        p = os.path.join(p, hit)
    return p


class Install:
    def __init__(self, root):
        root = os.path.abspath(os.path.expanduser(root))
        if os.path.basename(root).lower() != 'data':
            d = _ci_join(root, 'Data')
            if d is None:
                raise ValueError('no "Data" folder in %s' % root)
            root = d
        self.data = root
        self.root = os.path.dirname(root)
        if not _ci_join(self.data, 'Base/GSF'):
            raise ValueError('%s does not look like a ParaWorld Data folder (Base/GSF is missing)' % root)
        present = {e.lower(): e for e in os.listdir(self.data)}
        self.mods = [present[m.lower()] for m in OFFICIAL if m.lower() in present]
        extra = [e for e in sorted(os.listdir(self.data)) if os.path.isdir(os.path.join(self.data, e))
                 and e.lower() not in ('locale',) and e not in self.mods]
        self.model_mods = self.mods + [e for e in extra if _ci_join(os.path.join(self.data, e), 'GSF')]

    def __repr__(self):
        return 'Install(%r)' % self.root

    @staticmethod
    def valid(path):
        try:
            Install(path)
            return True
        except (ValueError, OSError):
            return False

    # ---------------------------------------------------------------- files
    def file(self, rel, mods=None):
        """path of Data/<mod>/<rel> from the newest official mod that has it (None if missing)"""
        found = None
        for m in mods or self.mods:
            p = _ci_join(os.path.join(self.data, m), rel)
            if p and os.path.isfile(p):
                found = p
        return found

    def dir(self, rel, mods=None):
        """path of the folder Data/<mod>/<rel> from the newest official mod that has it (None if missing)"""
        found = None
        for m in mods or self.mods:
            p = _ci_join(os.path.join(self.data, m), rel)
            if p and os.path.isdir(p):
                found = p
        return found

    def maps(self):
        """every map (.ula) of the game and its mods: [{'pack', 'rel', 'path', 'size'}], pack = the Data/<pack>
        folder, rel = the path below its Maps folder (forward slashes)"""
        out = []
        for m in sorted(e for e in os.listdir(self.data) if os.path.isdir(os.path.join(self.data, e))):
            base = _ci_join(os.path.join(self.data, m), 'Maps')
            if not base:
                continue
            for dp, _, fs in os.walk(base):
                for f in sorted(fs):
                    if f.lower().endswith('.ula'):
                        full = os.path.join(dp, f)
                        out.append({'pack': m, 'rel': os.path.relpath(full, base).replace(os.sep, '/'), 'path': full,
                                    'size': os.path.getsize(full)})
        return out

    def files(self, pattern, mods=None):
        """all Data/<mod>/<pattern> matches; a later mod's file replaces the same relative path of an earlier one"""
        out = {}
        for m in mods or self.mods:
            base = os.path.join(self.data, m)
            for p in glob.glob(os.path.join(base, pattern), recursive=True):
                out[os.path.relpath(p, base).lower()] = p
        return [out[k] for k in sorted(out)]

    def read_text(self, rel, encoding='latin-1'):
        p = self.file(rel)
        if not p:
            raise FileNotFoundError(rel)
        with open(p, encoding=encoding, errors='replace') as f:
            return f.read()

    def archives(self):
        """{archive name: path} of every .gsf; a mod's archive of the same name replaces Base's"""
        out = {}
        for m in self.model_mods:
            g = _ci_join(os.path.join(self.data, m), 'GSF')
            if not g:
                continue
            for f in sorted(os.listdir(g)):
                if f.lower().endswith('.gsf'):
                    out[os.path.splitext(f)[0].lower()] = os.path.join(g, f)
        return out

    def archive_list(self):
        """every .gsf of every mod, nothing replaced: [{'mod', 'name', 'path'}] in mod order (Base first). The same
        archive name in several mods (all_characters.gsf in Base, BoosterPack3, MIRAGE, Wintermod ...) gives one
        entry each: the exporter lists every copy of a model and lets the user pick the mod."""
        out = []
        for m in self.model_mods:
            g = _ci_join(os.path.join(self.data, m), 'GSF')
            if not g:
                continue
            for f in sorted(os.listdir(g)):
                if f.lower().endswith('.gsf'):
                    out.append({'mod': m, 'name': os.path.splitext(f)[0].lower(), 'path': os.path.join(g, f)})
        return out

    def archive_mod(self, path):
        rel = os.path.relpath(path, self.data).replace('\\', '/')
        return rel.split('/')[0]

    # ---------------------------------------------------------------- texts
    def locale_dir(self, lang):
        return _ci_join(self.data, 'locale/%s/Texts' % lang)

    def locales(self):
        d = _ci_join(self.data, 'locale')
        if not d:
            return []
        return sorted(e for e in os.listdir(d) if _ci_join(os.path.join(d, e), 'Texts'))

    # ---------------------------------------------------------------- discovery
    @staticmethod
    def find():
        """likely install folders on this computer (registry, common folders), valid ones only"""
        cands = []
        if sys.platform == 'win32':
            try:
                import winreg
                for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
                    for base in (r'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
                                 r'SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'):
                        try:
                            k = winreg.OpenKey(hive, base)
                        except OSError:
                            continue
                        for i in range(winreg.QueryInfoKey(k)[0]):
                            try:
                                sk = winreg.OpenKey(k, winreg.EnumKey(k, i))
                                name = str(winreg.QueryValueEx(sk, 'DisplayName')[0])
                                if 'paraworld' in name.lower():
                                    cands.append(str(winreg.QueryValueEx(sk, 'InstallLocation')[0]))
                            except OSError:
                                pass
                    for base in (r'SOFTWARE\Sunflowers\ParaWorld', r'SOFTWARE\WOW6432Node\Sunflowers\ParaWorld'):
                        try:
                            sk = winreg.OpenKey(hive, base)
                            for v in ('InstallDir', 'Path', 'InstallPath'):
                                try:
                                    cands.append(str(winreg.QueryValueEx(sk, v)[0]))
                                except OSError:
                                    pass
                        except OSError:
                            pass
            except ImportError:
                pass
            for drive in string.ascii_uppercase[2:]:
                for sub in ('Paraworld', 'ParaWorld', 'Games/ParaWorld', 'Games/Paraworld', 'Program Files (x86)/Sunflowers/ParaWorld',
                            'Program Files/Sunflowers/ParaWorld', 'Program Files (x86)/ParaWorld', 'GOG Games/ParaWorld'):
                    cands.append('%s:/%s' % (drive, sub))
        else:
            home = os.path.expanduser('~')
            cands += [os.path.join(home, x) for x in ('ParaWorld', 'Paraworld', 'Games/ParaWorld',
                                                       '.wine/drive_c/Program Files (x86)/Sunflowers/ParaWorld')]
        seen, out = set(), []
        for c in cands:
            if not c:
                continue
            c = os.path.normpath(c)
            if c.lower() in seen:
                continue
            seen.add(c.lower())
            if os.path.isdir(c) and Install.valid(c):
                out.append(c)
        return out
