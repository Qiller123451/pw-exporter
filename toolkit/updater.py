"""Updates of the toolkit from GitHub: on start the toolkit looks for a newer version, and the launcher asks whether
to install it (toolkit/web/launcher.js, the banner at the top).

Two kinds of copies are handled:

    git   a clone (the folder has .git): `git fetch`, then the commits the copy is behind; updating = `git pull
          --ff-only`. Nothing is touched when the copy has local changes to files the update changes, or commits of
          its own that GitHub does not have (it has diverged) - the launcher says why, and git is the way then.
    zip   a "Download ZIP" copy (no .git): GitHub's latest commit against the one recorded in
          <toolkit home>/update.json; updating = GitHub's ZIP of the branch unpacked over the folder (files the
          previous ZIP update brought and the new one no longer has are removed; nothing else is). The first start
          of a ZIP copy only records the latest commit: it is taken to be what was downloaded.

The repository is the clone's origin, else REPO (PWTOOLKIT_REPO / PWTOOLKIT_BRANCH override it). Private
repositories work with git (its own credentials, never a prompt: GIT_TERMINAL_PROMPT=0); the ZIP way needs a public
one. After an update the toolkit restarts: it exits with RESTART_CODE and the start file runs it again
("Start ParaWorld Toolkit.bat", start.sh), on the same port and without opening another browser tab
(<home>/restart.json).

Settings (pwexport settings.json): update_check (default true: look on start), update_skip (a commit the user chose
to skip: no banner for it, a newer one shows again).
"""
import io
import json
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.request
import zipfile

REPO = 'Qiller123451/pw-exporter'
BRANCH = 'main'
RESTART_CODE = 3                 # "run me again" for the start files
API = 'https://api.github.com/repos/%s'
ZIP = 'https://codeload.github.com/%s/zip/refs/heads/%s'
UA = {'User-Agent': 'paraworld-toolkit-updater', 'Accept': 'application/vnd.github+json'}
NO_WINDOW = 0x08000000 if os.name == 'nt' else 0      # (Windows: no console window flashing up for git)
# the files a running start file is read from: when an update changes them the toolkit is not restarted by itself
# (cmd reads a batch file line by line while it runs) - the user starts it again
START_FILES = ('Start ParaWorld Toolkit.bat', 'start.sh')


def _repo_of(url):
    """owner/name of a GitHub remote URL (https or ssh), else None"""
    m = re.search(r'github\.com[:/]+([^/]+)/([^/]+?)(?:\.git)?/?$', url or '')
    return '%s/%s' % (m.group(1), m.group(2)) if m else None


class Updater:
    def __init__(self, root, settings, home):
        self.root = root
        self.settings = settings
        self.home = home
        self.lock = threading.Lock()
        self.busy = None                  # a function: True while something must not be interrupted (a remake build)
        self.on_restart = None            # set by the server: called after a successful update
        self.st = {'state': 'idle'}       # idle | checking | current | available | updating | updated | error
        self.kind = 'git' if os.path.isdir(os.path.join(root, '.git')) else 'zip'
        self.git = shutil.which('git')
        self.repo = os.environ.get('PWTOOLKIT_REPO') or REPO
        self.branch = os.environ.get('PWTOOLKIT_BRANCH') or BRANCH
        if self.kind == 'git' and self.git:
            origin = self._git('config', '--get', 'remote.origin.url', check=False)
            self.repo = os.environ.get('PWTOOLKIT_REPO') or _repo_of(origin) or self.repo
            up = self._git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}', check=False)
            if up and up.startswith('origin/') and not os.environ.get('PWTOOLKIT_BRANCH'):
                self.branch = up[len('origin/'):]

    # ------------------------------------------------------------------ state for the launcher
    def state(self):
        with self.lock:
            st = dict(self.st)
        st.update(kind=self.kind, repo=self.repo, branch=self.branch, auto=self.settings.get('update_check', True) is not False,
                  skipped=bool(st.get('latest')) and self.settings.get('update_skip') == st.get('latest'))
        return st

    def _set(self, **kw):
        with self.lock:
            self.st = kw

    # ------------------------------------------------------------------ the check
    def check_on_start(self):
        if self.settings.get('update_check', True) is False:
            return
        self.check()

    def check(self):
        """look for a newer version in the background"""
        with self.lock:
            if self.st.get('state') in ('checking', 'updating'):
                return
            self.st = {'state': 'checking'}
        threading.Thread(target=self._check, daemon=True).start()

    def _check(self):
        try:
            st = self._check_git() if self.kind == 'git' else self._check_zip()
        except Exception as e:                       # noqa: BLE001 - offline, no git, private repository ...
            st = {'state': 'error', 'error': str(e)}
        st['checked'] = time.time()
        self._set(**st)
        if st['state'] == 'available':
            print('A new version of the toolkit is available (%d change%s) - the launcher asks whether to update.'
                  % (st.get('behind', 0), '' if st.get('behind') == 1 else 's'))

    def _git(self, *args, check=True, timeout=60):
        env = dict(os.environ, GIT_TERMINAL_PROMPT='0', GCM_INTERACTIVE='never', LC_ALL='C')
        r = subprocess.run([self.git, *args], cwd=self.root, capture_output=True, text=True, encoding='utf-8', errors='replace',
                           timeout=timeout, env=env, creationflags=NO_WINDOW)
        if check and r.returncode:
            raise RuntimeError((r.stderr or r.stdout or 'git %s failed' % args[0]).strip().splitlines()[-1])
        return r.stdout.rstrip() if not r.returncode else ''          # (rstrip: porcelain lines start with a space)

    def _check_git(self):
        if not self.git:
            return {'state': 'error', 'error': 'git is not installed', 'blocked': 'nogit'}
        self._git('fetch', '--quiet', 'origin', self.branch, timeout=90)
        remote = 'origin/' + self.branch
        head, latest = self._git('rev-parse', 'HEAD'), self._git('rev-parse', remote)
        behind = int(self._git('rev-list', '--count', 'HEAD..' + remote) or 0)
        ahead = int(self._git('rev-list', '--count', remote + '..HEAD') or 0)
        st = {'current': head[:7], 'latest': latest, 'behind': behind, 'ahead': ahead}
        if not behind:
            return dict(st, state='current')
        log = self._git('log', '--format=%H%x09%cI%x09%s', '-n', '30', 'HEAD..' + remote)
        st['commits'] = [dict(zip(('sha', 'date', 'title'), l.split('\t', 2))) for l in log.splitlines() if l.count('\t') >= 2]
        if ahead:
            return dict(st, state='available', blocked='diverged')
        # local changes to files the update changes would be overwritten: git refuses, and so do we
        changed = set(self._git('diff', '--name-only', 'HEAD', remote).splitlines())
        dirty = [l[3:] for l in self._git('status', '--porcelain', '--untracked-files=no').splitlines() if len(l) > 3]
        dirty = [f.strip('"') for f in dirty]
        clash = sorted(f for f in dirty if f in changed or f.split(' -> ')[-1] in changed)
        if clash:
            return dict(st, state='available', blocked='local', files=clash[:20], nfiles=len(clash))
        return dict(st, state='available')

    def _get(self, url, timeout=30):
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()

    def _record(self):
        try:
            with open(os.path.join(self.home, 'update.json'), encoding='utf-8') as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def _save_record(self, rec):
        p = os.path.join(self.home, 'update.json')
        with open(p + '.tmp', 'w', encoding='utf-8') as f:
            json.dump(rec, f, indent=1)
        os.replace(p + '.tmp', p)

    def _check_zip(self):
        try:
            head = json.loads(self._get((API % self.repo) + '/commits/' + self.branch))
        except urllib.error.HTTPError as e:
            raise RuntimeError('GitHub answered %d (a private repository can only be updated with git)' % e.code) from None
        latest = head['sha']
        rec = self._record()
        if rec.get('repo') != self.repo or not rec.get('sha'):
            # the first start of this copy: it is what GitHub has now
            self._save_record({'repo': self.repo, 'branch': self.branch, 'sha': latest, 'files': rec.get('files') or []})
            return {'state': 'current', 'current': latest[:7], 'latest': latest, 'behind': 0}
        if rec['sha'] == latest:
            return {'state': 'current', 'current': latest[:7], 'latest': latest, 'behind': 0}
        cmp = json.loads(self._get((API % self.repo) + '/compare/%s...%s' % (rec['sha'], latest)))
        commits = [{'sha': c['sha'], 'date': c['commit']['committer']['date'], 'title': c['commit']['message'].splitlines()[0]}
                   for c in reversed(cmp.get('commits') or [])][:30]
        return {'state': 'available', 'current': rec['sha'][:7], 'latest': latest, 'behind': cmp.get('ahead_by', len(commits)), 'commits': commits}

    # ------------------------------------------------------------------ the update
    def apply(self):
        """install the update in the background; True when it started"""
        with self.lock:
            st = self.st
            if st.get('state') != 'available' or st.get('blocked'):
                return False, 'nothing to update' if st.get('state') != 'available' else st.get('blocked')
            if self.busy and self.busy():
                return False, 'busy'
            self.st = dict(st, state='updating')
        threading.Thread(target=self._apply, daemon=True).start()
        return True, None

    def _start_files(self):
        out = {}
        for n in START_FILES:
            try:
                with open(os.path.join(self.root, n), 'rb') as f:
                    out[n] = f.read()
            except OSError:
                out[n] = None
        return out

    def _apply(self):
        before = self._start_files()
        try:
            if self.kind == 'git':
                self._git('pull', '--ff-only', '--quiet', 'origin', self.branch, timeout=300)
            else:
                self._apply_zip()
        except Exception as e:                       # noqa: BLE001
            with self.lock:
                self.st = dict(self.st, state='error', error=str(e), phase='apply')
            return
        # (a start file that changed: the user starts the toolkit again - see START_FILES)
        manual = self._start_files() != before
        with self.lock:
            self.st = dict(self.st, state='updated', restart='manual' if manual else 'auto')
        print('The toolkit was updated.' + (' Close this window and start it again.' if manual else ' Restarting...'))
        if not manual and self.on_restart:
            threading.Timer(1.0, self.on_restart).start()      # (the launcher gets its answer first)

    def _apply_zip(self):
        latest = self.st.get('latest')
        data = self._get(ZIP % (self.repo, self.branch), timeout=300)
        rec = self._record()
        new_files = []
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            names = [n for n in z.namelist() if not n.endswith('/')]
            top = os.path.commonprefix(names).split('/')[0] + '/' if names else ''
            for n in names:
                rel = n[len(top):] if n.startswith(top) else n
                if not rel or rel.startswith('.git/') or '..' in rel.split('/'):
                    continue
                new_files.append(rel)
                dst = os.path.join(self.root, *rel.split('/'))
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                part = dst + '.pwtk-new'
                with z.open(n) as a, open(part, 'wb') as b:
                    shutil.copyfileobj(a, b)
                os.replace(part, dst)
        # what the previous ZIP update brought and this one no longer has
        for rel in set(rec.get('files') or []) - set(new_files):
            try:
                os.remove(os.path.join(self.root, *rel.split('/')))
            except OSError:
                pass
        self._save_record({'repo': self.repo, 'branch': self.branch, 'sha': latest, 'files': sorted(new_files)})

    def skip(self):
        latest = self.st.get('latest')
        if latest:
            self.settings['update_skip'] = latest
            self.settings.save()

    def set_auto(self, on):
        self.settings['update_check'] = bool(on)
        self.settings.save()


# ---------------------------------------------------------------------- the restart
def restart_note(home, port):
    """what the next start reads: the same port, no new browser tab"""
    with open(os.path.join(home, 'restart.json'), 'w', encoding='utf-8') as f:
        json.dump({'port': port, 't': time.time()}, f)


def take_restart_note(home):
    """{port} when this start is a restart after an update (within a minute), else None"""
    p = os.path.join(home, 'restart.json')
    try:
        with open(p, encoding='utf-8') as f:
            note = json.load(f)
        os.remove(p)
    except (OSError, ValueError):
        return None
    return note if time.time() - note.get('t', 0) < 60 else None
