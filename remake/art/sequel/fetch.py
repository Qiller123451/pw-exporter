"""Download the materials the sequel's models are made from (materials.json: ambientCG and Poly Haven, all CC0) into
art/sequel/_lib/<id>/ (color, ao, normal, rough, disp at 1K), for building the models (build.py):
    python3 -m remake.art.sequel.fetch
The game itself does not need them: the built models are in art/sequel/built."""
import io
import json
import os
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.environ.get('PW_ART_LIB', os.path.join(HERE, '_lib'))
UA = {'User-Agent': 'ParaWorldToolkit-remake/1.0 (sequel art)'}
ACG = {'Color': 'color', 'AmbientOcclusion': 'ao', 'NormalGL': 'normal', 'Roughness': 'rough', 'Displacement': 'disp', 'Metalness': 'metal'}
PH = {'Diffuse': 'color', 'AO': 'ao', 'nor_gl': 'normal', 'Rough': 'rough', 'Displacement': 'disp', 'Metal': 'metal'}


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120).read()


def fetch(aid, source):
    d = os.path.join(LIB, aid)
    if os.path.exists(os.path.join(d, 'color.jpg')):
        return False
    os.makedirs(d, exist_ok=True)
    if source == 'ambientCG':
        z = zipfile.ZipFile(io.BytesIO(get(f'https://ambientcg.com/get?file={aid}_1K-JPG.zip')))
        for n in z.namelist():
            for k, v in ACG.items():
                if n.endswith(f'_{k}.jpg'):
                    open(os.path.join(d, v + '.jpg'), 'wb').write(z.read(n))
    else:
        files = json.loads(get(f'https://api.polyhaven.com/files/{aid}'))
        for k, v in PH.items():
            one = files.get(k, {}).get('1k', {})
            f = one.get('jpg') or one.get('png')
            if f:
                open(os.path.join(d, v + ('.jpg' if 'jpg' in one else '.png')), 'wb').write(get(f['url']))
    return True


if __name__ == '__main__':
    mats = json.load(open(os.path.join(HERE, 'materials.json')))['materials']
    for aid, m in mats.items():
        print(aid, 'downloaded' if fetch(aid, m['source']) else 'have it')
