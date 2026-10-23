"""A Workshop project: one mod with its objects, kept in a folder of its own.

    <workshop home>/<ModId>/project.json     the mod and its objects (below)
    <workshop home>/<ModId>/files/...        uploaded models (.gsf), pictures for icons and textures
    <workshop home>/<ModId>/build/Data/...   the last build (build.py)
    <workshop home>/<ModId>/preview/...      converted models for the previews

project.json
    {"id": "MyCreatures", "title": "My creatures", "base": "" | "BoosterPack1" | "MIRAGE" ..., "lang": "uk",
     "version": "1.0", "objects": [object, ...]}
object
    {"id": "mycreatures_raptor",                  class name: lower case letters, digits, "_"
     "kind": "unit" | "building" | "animal" | "decoration",
     "template": "hu_warrior",                     the game object whose rules and script it gets
     "model": {"source": "game" | "upload", "name": <model>, "file": <files/...gsf, upload only>,
               "anims": {<name the scripts use>: <name in the model>},
               "levels": null | "template"},          the higher levels: the new model (null) or the template's
                                                      own models (hu_warrior_s2 ...)
     "texts": {"name", "short", "long"},          the encyclopedia: title, bullet points, description
     "stats": {"hitpoints", "defaultspeed", "maxspeed", "FOW", "scalps"}, (empty = the template's)
     "cost": {"food", "wood", "stone"}, "duration": seconds, "producer": <building class>,
     "weapon": {"damage", "range", "frequency"},  (level 1; the other levels keep the template's ratios)
     "icon": <files/...png> | null,               null = the template's icon
     "textures": {<texture name the model uses>: <files/...png>},
     "addons": null | [add-on],                   null = the template's turrets, build-ups and gunners (addons.py)
     "rider": null | {"cls", "parent", "link", "pos", "rot", "anim", "attack_anim", "hidden"}}   null = the template's
"""
import json
import os
import re
import shutil

ID_RE = re.compile(r'^[A-Za-z][A-Za-z0-9_]{1,31}$')
OBJ_RE = re.compile(r'^[a-z][a-z0-9_]{2,47}$')
KINDS = ('unit', 'building', 'animal', 'decoration')


class ProjectError(ValueError):
    pass


def new_object(oid, kind, template):
    return {'id': oid, 'kind': kind, 'template': template, 'model': {'source': 'game', 'name': None, 'anims': {}},
            'texts': {'name': '', 'short': '', 'long': ''}, 'stats': {}, 'cost': {}, 'duration': None, 'producer': None,
            'weapon': {}, 'icon': None, 'textures': {}, 'addons': None, 'rider': None}


class Project:
    def __init__(self, data=None, folder=None):
        d = dict(data or {})
        self.folder = folder
        self.id = d.get('id') or 'MyMod'
        self.title = d.get('title') or self.id
        self.base = d.get('base') or ''
        self.lang = d.get('lang') or 'uk'
        self.version = d.get('version') or '1.0'
        self.objects = list(d.get('objects') or [])

    # ------------------------------------------------------------------ files
    @classmethod
    def load(cls, folder):
        with open(os.path.join(folder, 'project.json'), encoding='utf-8') as f:
            return cls(json.load(f), folder)

    def save(self):
        os.makedirs(self.folder, exist_ok=True)
        tmp = os.path.join(self.folder, 'project.json.tmp')
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(self.json(), f, indent=1)
        os.replace(tmp, os.path.join(self.folder, 'project.json'))

    def json(self):
        return {'id': self.id, 'title': self.title, 'base': self.base, 'lang': self.lang, 'version': self.version,
                'objects': self.objects}

    def file(self, rel):
        """a project file (files/...); absolute paths (the game's archives) as they are"""
        if not rel:
            return None
        if os.path.isabs(rel):
            return rel
        p = os.path.realpath(os.path.join(self.folder or '.', rel))
        if self.folder and not p.startswith(os.path.realpath(self.folder)):
            raise ProjectError('%s is outside the project' % rel)
        return p

    def add_file(self, name, data):
        """store an uploaded file under files/ (a safe name; an existing one is not overwritten) -> its path in the
        project"""
        base = re.sub(r'[^A-Za-z0-9_.-]+', '_', os.path.basename(name)) or 'file'
        stem, ext = os.path.splitext(base)
        d = os.path.join(self.folder, 'files')
        os.makedirs(d, exist_ok=True)
        k, out = 1, base
        while os.path.exists(os.path.join(d, out)):
            k += 1
            out = '%s_%d%s' % (stem, k, ext)
        with open(os.path.join(d, out), 'wb') as f:
            f.write(data)
        return 'files/' + out

    # ------------------------------------------------------------------ objects
    def obj(self, oid):
        o = next((x for x in self.objects if x['id'] == oid), None)
        if o is None:
            raise ProjectError('the project has no object %s' % oid)
        return o

    def check(self, known=()):
        """problems that stop a build: [text]"""
        out = []
        if not ID_RE.match(self.id):
            out.append('The mod id must start with a letter and have 2-32 letters, digits or "_" (it is a folder name).')
        seen = set()
        known = {k.lower() for k in known}
        for o in self.objects:
            if not OBJ_RE.match(o['id']):
                out.append('%s: an object id has 3-48 lower case letters, digits or "_" and starts with a letter.' % o['id'])
            if o['id'] in seen:
                out.append('%s: two objects have this id.' % o['id'])
            if o['id'] in known:
                out.append('%s: the game already has an object of this name.' % o['id'])
            seen.add(o['id'])
            if o['kind'] not in KINDS:
                out.append('%s: unknown kind %s.' % (o['id'], o['kind']))
            m = o.get('model') or {}
            if m.get('source') == 'upload' and not (m.get('file') and m.get('name')):
                out.append('%s: pick the model of the uploaded archive.' % o['id'])
        return out


def home():
    """where the projects live: <toolkit home>/workshop"""
    import sys
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if root not in sys.path:
        sys.path.insert(0, root)
    from pwexport.config import home as tk_home
    d = os.path.join(tk_home(), 'workshop')
    os.makedirs(d, exist_ok=True)
    return d


def list_projects(base=None):
    base = base or home()
    out = []
    for e in sorted(os.listdir(base)):
        f = os.path.join(base, e, 'project.json')
        if os.path.isfile(f):
            try:
                p = Project.load(os.path.join(base, e))
                out.append({'id': p.id, 'title': p.title, 'base': p.base, 'objects': len(p.objects), 'folder': p.folder})
            except (OSError, ValueError):
                continue
    return out


def create(pid, title='', base_cfg='', lang='uk', base=None):
    if not ID_RE.match(pid or ''):
        raise ProjectError('The mod id must start with a letter and have 2-32 letters, digits or "_".')
    folder = os.path.join(base or home(), pid)
    if os.path.exists(folder):
        raise ProjectError('There is a project %s already.' % pid)
    p = Project({'id': pid, 'title': title or pid, 'base': base_cfg, 'lang': lang}, folder)
    p.save()
    return p


def delete(pid, base=None):
    folder = os.path.join(base or home(), pid)
    if os.path.isfile(os.path.join(folder, 'project.json')):
        shutil.rmtree(folder)
