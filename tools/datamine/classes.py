import re,glob,json
res={}
files=sorted(glob.glob('/mnt/user-data/uploads/Paraworld/Data/Base/Scripts/**/*.txt',recursive=True))+sorted(glob.glob('/mnt/user-data/uploads/Paraworld/Data/BoosterPack1/Scripts/**/*.txt',recursive=True))
for f in files:
    txt=open(f,encoding='latin-1').read()
    if 'classattribs' not in txt: continue
    stack=[];
    for ln,line in enumerate(txt.split('\n'),1):
        s=line.strip()
        m=re.match(r'^([\w\-\.]+)\s*\{',s)
        if m: stack.append(m.group(1)); continue
        if s.startswith('}'): stack and stack.pop(); continue
        m=re.match(r"^(\w+)\s*=\s*'([^']*)'",s)
        if m and len(stack)>=3:
            obj=stack[1].lower()
            d=res.setdefault(obj,{})
            d[m.group(1)]=m.group(2)
            d['_file']=f.split('Data/')[1]+':'+str(ln)
json.dump(res,open('/home/claude/pwexp_data/gen/classes.json','w'),indent=0)
print(len(res))
import collections
c=collections.Counter(v.get('classname') for v in res.values())
print(c.most_common(200))
