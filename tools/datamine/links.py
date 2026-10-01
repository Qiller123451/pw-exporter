import json,struct,glob,os
idx={}
for f in glob.glob('/tmp/pwout4/*/*.glb'):
    b=open(f,'rb').read(); n=struct.unpack('<I',b[12:16])[0]
    j=json.loads(b[20:20+n])
    name=os.path.basename(f)[:-4]
    links=[x.get('name','')[5:] for x in j.get('nodes',[]) if x.get('name','').startswith('link_')]
    idx.setdefault(name,[]).append({'archive':f.split('/')[-2],'links':links})
json.dump(idx,open('/home/claude/pwexp_data/gen/glblinks.json','w'),indent=0)
print(len(idx), sum(len(v) for v in idx.values()))
