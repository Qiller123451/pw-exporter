"""Tests of the toolkit's updater (toolkit/updater.py) on throw-away repositories: no network, no GitHub.

    python tools/test_updater.py

git:  a clone behind its origin (available, the commits), local changes to a file the update changes (blocked
      'local'), a commit of its own (blocked 'diverged'), the update itself (git pull --ff-only), up to date after.
zip:  GitHub's answers faked from a local repository: the first start records the copy, a newer commit is offered,
      the ZIP is unpacked over the folder, a file the previous ZIP brought and the new one dropped is removed, the
      user's own files stay.
"""
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from toolkit import updater as U          # noqa: E402

FAILS = []


def check(what, ok):
    print(('ok   ' if ok else 'FAIL ') + what)
    if not ok:
        FAILS.append(what)


def git(cwd, *a):
    return subprocess.run(['git', '-c', 'user.email=t@t', '-c', 'user.name=t', *a], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def commit(repo, msg, **files):
    for n, t in files.items():
        with open(os.path.join(repo, n), 'a', encoding='utf-8') as f:
            f.write(t)
    git(repo, 'add', '-A')
    git(repo, 'commit', '-qm', msg)


class S(dict):                             # settings stand-in
    def save(self):
        pass


def test_git(tmp):
    src, remote, work = (os.path.join(tmp, n) for n in ('src', 'remote.git', 'work'))
    os.makedirs(src)
    git(src, 'init', '-q', '-b', 'main')
    commit(src, 'A', **{'README.md': 'a\n', 'other.txt': 'o\n'})
    git(tmp, 'clone', '-q', '--bare', src, remote)
    git(tmp, 'clone', '-q', remote, work)
    git(src, 'remote', 'add', 'origin', remote)
    commit(src, 'B: new feature', **{'README.md': 'b\n'})
    commit(src, 'C: a fix', **{'other.txt': 'c\n'})
    git(src, 'push', '-q', 'origin', 'main')
    up = U.Updater(work, S(), tmp)
    st = up._check_git()
    check('git: behind 2, available', st['state'] == 'available' and st['behind'] == 2 and not st.get('blocked'))
    check('git: the commits, newest first', [c['title'] for c in st['commits']] == ['C: a fix', 'B: new feature'])
    with open(os.path.join(work, 'README.md'), 'a') as f:
        f.write('my change\n')
    st = up._check_git()
    check('git: local change to a file the update changes blocks it', st.get('blocked') == 'local' and st.get('files') == ['README.md'])
    git(work, 'checkout', '-q', 'README.md')
    with open(os.path.join(work, 'untouched.txt'), 'w') as f:
        f.write('mine')
    commit(work, 'local commit')
    st = up._check_git()
    check('git: a commit of its own: diverged', st.get('blocked') == 'diverged' and st['ahead'] == 1)
    git(work, 'reset', '-q', '--hard', 'HEAD~1')
    up.st = up._check_git()
    up._apply()
    check('git: updated', up.st['state'] == 'updated' and up.st.get('restart') == 'auto')
    check('git: up to date after', up._check_git()['state'] == 'current')
    # a start file changed by the update: no restart by itself
    commit(src, 'D: start file', **{'start.sh': 'echo new\n'})
    git(src, 'push', '-q', 'origin', 'main')
    up.st = up._check_git()
    up._apply()
    check('git: changed start file: restart by hand', up.st.get('restart') == 'manual')


def test_zip(tmp):
    src, copy, home = (os.path.join(tmp, n) for n in ('zsrc', 'zcopy', 'zhome'))
    for d in (src, copy, home):
        os.makedirs(d)
    git(src, 'init', '-q', '-b', 'main')
    commit(src, 'A', **{'README.md': 'a\n', 'gone.txt': 'x\n'})
    old = git(src, 'rev-parse', 'HEAD')

    def zip_of(rev):
        b = subprocess.run(['git', 'archive', '--format=zip', '--prefix=pw-exporter-main/', rev], cwd=src, check=True, capture_output=True).stdout
        return b
    with zipfile.ZipFile(io.BytesIO(zip_of(old))) as z:
        for n in z.namelist():
            if not n.endswith('/'):
                with open(os.path.join(copy, n.split('/', 1)[1]), 'wb') as f:
                    f.write(z.read(n))
    state = {'cur': old}

    def fake_get(self, url, timeout=30):
        if url.endswith('/commits/main'):
            return json.dumps({'sha': state['cur']}).encode()
        if '/compare/' in url:
            a, b = url.split('/compare/')[1].split('...')
            log = git(src, 'log', '--format=%H%x09%cI%x09%s', '%s..%s' % (a, b)).splitlines()
            cs = [{'sha': l.split('\t')[0], 'commit': {'committer': {'date': l.split('\t')[1]}, 'message': l.split('\t')[2]}} for l in log][::-1]
            return json.dumps({'ahead_by': len(cs), 'commits': cs}).encode()
        if 'codeload' in url:
            return zip_of(state['cur'])
        raise AssertionError(url)
    U.Updater._get = fake_get
    up = U.Updater(copy, S(), home)
    check('zip: a copy without .git', up.kind == 'zip')
    check('zip: the first start records it as current', up._check_zip()['state'] == 'current')
    up.st = {'state': 'current', 'latest': old}
    up._apply_zip()                                      # (the record of the files of a ZIP update)
    git(src, 'rm', '-q', 'gone.txt')
    commit(src, 'B: new feature', **{'README.md': 'b\n'})
    state['cur'] = git(src, 'rev-parse', 'HEAD')
    st = up._check_zip()
    check('zip: newer commit offered', st['state'] == 'available' and st['behind'] == 1 and st['commits'][0]['title'] == 'B: new feature')
    with open(os.path.join(copy, 'mine.txt'), 'w') as f:
        f.write('x')
    up.st = st
    up._apply_zip()
    with open(os.path.join(copy, 'README.md')) as f:
        check('zip: files updated', f.read() == 'a\nb\n')
    check('zip: a file the new version dropped is removed', not os.path.exists(os.path.join(copy, 'gone.txt')))
    check('zip: own files stay', os.path.exists(os.path.join(copy, 'mine.txt')))
    check('zip: up to date after', up._check_zip()['state'] == 'current')


def test_restart_note(tmp):
    U.restart_note(tmp, 8423)
    n = U.take_restart_note(tmp)
    check('restart note: same port, read once', n and n['port'] == 8423 and U.take_restart_note(tmp) is None)


if __name__ == '__main__':
    if not shutil.which('git'):
        sys.exit('git is needed for this test')
    t = tempfile.mkdtemp(prefix='pwtk-updtest-')
    try:
        test_git(t)
        test_zip(t)
        test_restart_note(t)
    finally:
        shutil.rmtree(t, ignore_errors=True)
    print('%d failed' % len(FAILS) if FAILS else 'all passed')
    sys.exit(1 if FAILS else 0)
