"""Display names and descriptions of game objects in any language the game ships.

    t = Texts(install, 'de')        # 'uk' = English, 'de' = German, 'fr', 'pl', 'ru', 'it', 'cz', 'hu', 'zh' ...
    t.name('hu_warrior')            # 'Axtkrieger'
    t.info('hu_warrior')            # {'name', 'short', 'medium', 'long', 'vs'}
    t.ui('_Aje')                    # 'Wüstenreiter'  (main_<lang>.ltf)

Sources (Data/locale/<lang>/Texts):
  Help/*.seml   in-game encyclopedia: \\{helpitem -name _hu_warrior Axe warrior} ... tooltips ... \\{/helpitem}
  main_<lang>.ltf  UI strings: "key";"text" per line (UTF-8)
Objects without an encyclopedia entry fall back to related names (heroes "cole_s0" -> "cole", "aje_velociraptor" ->
"velociraptor", "arena_x" -> "x") and finally to a tidied internal name.
"""
import glob
import os
import re

_HELPITEM = re.compile(r'\\\{helpitem -name (\S+)((?: -redirect \S+| -nodisplay)*) ([^}]*)\}(.*?)\\\{/helpitem\}', re.S)
_PREFIXES = ('aje_', 'hu_', 'ninigi_', 'seas_', 'arena_', 'special_', 'all_', 'tutorial_')


def _clean(t):
    t = re.sub(r'\\\\\{br\}', '\n', t)
    t = re.sub(r'\\\{ref [^}]*\}', '', t)
    t = re.sub(r'\\\{/ref\}', '', t)
    t = re.sub(r'\\\{[^}]*\}', '', t)
    return re.sub(r'[ \t]+', ' ', t).strip()


def parse_help(text):
    """{key (lowercase, no leading '_'): {'name', 'short', 'medium', 'long', 'vs', 'redirect'}}"""
    out = {}
    for m in _HELPITEM.finditer(text):
        key, opts, title, body = m.group(1).lstrip('_').lower(), m.group(2), m.group(3).strip(), m.group(4)

        def sect(tag):
            mm = re.search(r'\\\{%s\}(.*?)\\\{/%s\}' % (tag, tag), body, re.S)
            return _clean(mm.group(1)) if mm else ''
        short = sect('tooltipshort')
        red = re.search(r'-redirect (\S+)', opts)
        out[key] = {'name': title, 'short': short, 'medium': sect('tooltipmedium'), 'long': sect('tooltiplong'),
                    'vs': dict(re.findall(r'/vs(\w+):([+-]*)', short)),
                    'redirect': red.group(1).lstrip('_').lower() if red else None}
    return out


def parse_ltf(text):
    out = {}
    for line in text.splitlines():
        m = re.match(r'\s*"([^"]*)";"(.*)"\s*$', line)
        if m:
            out[m.group(1)] = m.group(2).replace('\\n', '\n')
    return out


def pretty(name):
    """'hu_rhino_ballista' -> 'Rhino Ballista' (used when the game has no text for an object)"""
    n = name.lower()
    for p in _PREFIXES:
        if n.startswith(p):
            n = n[len(p):]
            break
    n = re.sub(r'_s\d$', '', n)
    return ' '.join(w.capitalize() for w in n.replace('-', '_').split('_') if w)


class Texts:
    def __init__(self, install, lang='uk'):
        self.lang = lang
        self.help, self.ltf = {}, {}
        d = install.locale_dir(lang) if install else None
        if not d:
            return
        for f in sorted(glob.glob(os.path.join(d, 'Help', '*'))):
            if f.lower().endswith('.seml'):
                with open(f, encoding='utf-8-sig', errors='replace') as fh:
                    self.help.update(parse_help(fh.read()))
        for f in sorted(glob.glob(os.path.join(d, '*'))):
            if f.lower().endswith('.ltf') and os.path.basename(f).lower().startswith('main'):
                with open(f, encoding='utf-8-sig', errors='replace') as fh:
                    self.ltf.update(parse_ltf(fh.read()))

    def _entry(self, name):
        n = name.lower()
        cands = [n, re.sub(r'_s\d$', '', n)]
        for p in _PREFIXES:
            if n.startswith(p):
                cands.append(n[len(p):])
                cands.append(re.sub(r'_s\d$', '', n[len(p):]))
        for c in cands:
            e = self.help.get(c)
            if e:
                if e.get('redirect') and e['redirect'] in self.help and not e['name']:
                    e = self.help[e['redirect']]
                return e
        return None

    def name(self, obj):
        e = self._entry(obj)
        return e['name'] if e and e['name'] else pretty(obj)

    def has(self, obj):
        return self._entry(obj) is not None

    def info(self, obj):
        e = self._entry(obj)
        return dict(e) if e else {'name': pretty(obj), 'short': '', 'medium': '', 'long': '', 'vs': {}}

    def ui(self, key, default=None):
        return self.ltf.get(key, default if default is not None else key)
