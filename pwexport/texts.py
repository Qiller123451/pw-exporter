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
import os
import re

_HELPITEM = re.compile(r'\\\{helpitem ([^}]*)\}(.*?)\\\{/helpitem\}', re.S)
_PREFIXES = ('aje_', 'hu_', 'ninigi_', 'seas_', 'arena_', 'special_', 'all_', 'tutorial_')


def _clean(t):
    t = re.sub(r'\s*\\\\\{br\}\s*', '\n', t)             # a line break of the float box (the source's own newlines around it
    t = re.sub(r'\\\{ref [^}]*\}', '', t)                 # are not more of them)
    t = re.sub(r'\\\{/ref\}', '', t)
    t = re.sub(r'\\\{[^}]*\}', '', t)
    t = re.sub(r'[ \t]+', ' ', t)
    return '\n'.join(l.strip() for l in t.strip().split('\n'))


def _header(h):
    """'-nodisplay -name _x -redirect _y Title words' (the options in any order) -> (name, redirect, nodisplay, title)"""
    toks, i, name, red, nodisp, title = h.split(), 0, None, None, False, []
    while i < len(toks):
        t = toks[i]
        if t == '-name' and i + 1 < len(toks):
            name, i = toks[i + 1], i + 2
        elif t == '-redirect' and i + 1 < len(toks):
            red, i = toks[i + 1], i + 2
        elif t == '-nodisplay':
            nodisp, i = True, i + 1
        else:
            title.append(t)
            i += 1
    return name, red, nodisp, ' '.join(title)


def attribs(t):
    """the tooltip attributes of a help text, as the game's ToolTipWindow.FilterAttrib reads them: '/name:value'
    inside %...% ({'class': 'chtr', 'vschtr': '+', 'lvl1': 'Very strong', ...})"""
    out = {}
    for blk in re.findall(r'%(/.*?)%(?!%)', t, re.S):
        for m in re.finditer(r'/(\w+):([^/]*)', blk):
            out[m.group(1).lower()] = m.group(2).strip()
    return out


def parse_help(text):
    """{key (lowercase, no leading '_'): {'key' (as the file spells it), 'name', 'short', 'medium', 'long', 'cls',
    'vs', 'lvl', 'redirect', 'nodisplay'}}. As the game's tooltip shows it: 'medium' is the text before the first
    '%/' attribute block (ToolTipWindow.GenerateMsgScript), 'cls' the class icon ('chtr' | 'anml' | 'vhcl' | 'bldg';
    '' = "other"), 'vs' the quality against each class ({'chtr': '+', ... MIRAGE also 'ship'}), 'lvl' the heroes'
    level rows {'1': ..., '5': ...}."""
    out = {}
    for m in _HELPITEM.finditer(text):
        name, red, nodisp, title = _header(m.group(1))
        if not name:
            continue
        body = m.group(2)

        def sect(tag):
            mm = re.search(r'\\\{%s\}(.*?)\\\{/%s\}' % (tag, tag), body, re.S)
            return _clean(mm.group(1)) if mm else ''
        short, medium = sect('tooltipshort'), sect('tooltipmedium')
        att = attribs(short + '\n' + medium)
        cut = medium.find('%/')
        out[name.lstrip('_').lower()] = {
            'key': name, 'name': title, 'short': short, 'medium': (medium if cut < 0 else medium[:cut]).strip(),
            'long': sect('tooltiplong'), 'cls': att.get('class', ''),
            'vs': {k[2:]: v for k, v in att.items() if k.startswith('vs')},
            'lvl': {k[3:]: v for k, v in att.items() if re.match(r'lvl\d$', k)},
            'redirect': red.lstrip('_').lower() if red else None, 'nodisplay': nodisp}
    return out


_DOCPART = re.compile(r'\\\{(chapter|section|helpitem) ([^}]*)\}(.*?)(?=\\\{(?:chapter|section|helpitem) |\Z)', re.S)


def _rich(t):
    """a help text with its links and pictures, as the encyclopedia shows it: '{ref:<file#key>|<label>}',
    '{img:<spec>}' (bunit:<class> a card, bres:<level>;layer+<sprite> an interface sprite, pics/<x>.tga a picture),
    paragraphs as empty lines, line breaks as newlines; other markup dropped"""
    t = re.sub(r'\s*\\\\\{br\}\s*', '\n', t)
    t = re.sub(r'\s*\\\{p\}\s*', '\n\n', t)
    t = re.sub(r'\\\{ref ([^}\s]*)\}(.*?)\\\{/ref\}', lambda m: '%s{ref:%s|%s}%s' % (
        ' ' if m.group(2)[:1].isspace() else '', m.group(1).lower(), m.group(2).strip(), ' ' if m.group(2)[-1:].isspace() else ''), t, flags=re.S)
    t = re.sub(r'\\\{img /?([^}\s]*)[^}]*\}', lambda m: '{img:%s}' % m.group(1), t)
    t = re.sub(r'\\\{[^}]*\}', '', t)
    t = re.sub(r'[ \t]+', ' ', t)
    return '\n'.join(l.strip() for l in t.strip().split('\n'))


def help_doc(text):
    """one encyclopedia file (Texts/Help/*.seml) in reading order: [{'t': 'chapter'|'section', 'key', 'title'} |
    {'t': 'item', 'key' (as spelled, with '_'), 'title', 'img' (the picture at its right: '-ralign'), 'medium',
    'long'} ...]; the texts in the _rich markup, the tooltip attribute blocks (%/class:...%) left out"""
    out = []
    for m in _DOCPART.finditer(text):
        kind, head, body = m.group(1), m.group(2), m.group(3)
        name, red, nodisp, title = _header(head)
        if kind != 'helpitem':
            out.append({'t': kind, 'key': (name or '').lower(), 'title': title})
            continue
        if not name or nodisp:
            continue
        body = body.split('\\{/helpitem}')[0]

        def sect(tag):
            mm = re.search(r'\\\{%s\}(.*?)\\\{/%s\}' % (tag, tag), body, re.S)
            return re.sub(r'%/.*?%(?!%)', '', mm.group(1), flags=re.S) if mm else ''
        im = re.search(r'\\\{img /?([^}\s]*)[^}]*-ralign[^}]*\}', body)
        out.append({'t': 'item', 'key': name.lower(), 'title': title, 'img': im.group(1) if im else '',
                    'medium': _rich(sect('tooltipmedium')), 'long': _rich(sect('tooltiplong'))})
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
    """the texts of a language as the game loads them: the language pack's folders (Install.locale_dirs: base,
    the official add-ons, the loaded mod), a later folder's file replacing the same file of an earlier one"""

    def __init__(self, install, lang='uk'):
        self.lang = lang
        self.help, self.ltf = {}, {}
        if not install:
            return
        for n, f in install.locale_files(lang, 'Help').items():
            if n.endswith('.seml'):
                with open(f, encoding='utf-8-sig', errors='replace') as fh:
                    self.help.update(parse_help(fh.read()))
        for n, f in install.locale_files(lang).items():
            if n.endswith('.ltf') and not n.startswith(('sequences', 'dialogscenes')):
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
