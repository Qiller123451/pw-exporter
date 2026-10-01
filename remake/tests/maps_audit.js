// Audit original maps (run with tests/evaljs.py tests/maps_audit.js "&tribe=Hu&enemy=Aje"): for every map in
// maps/index.json, how many objects of each type the remake turns into something, and the classes it can't show.
const T = G.mapTools, M = T.models(), D = G.data;
const list = await (await fetch('maps/index.json')).json();
const rows = [], missing = {};
for (const m of list) {
  try {
    const buf = await (await fetch(m.path.split('/').map(encodeURIComponent).join('/'))).arrayBuffer();
    const md = await T.parseUla(buf, m.path.split('/').pop());
    const S = T.originalSource(md, D, {}, M);
    const by = {};
    for (const o of md.objects) { const b = by[o.type] || (by[o.type] = [0, 0]); b[0]++; }
    let plantsShown = 0;
    for (const p of md.plants) { const c = p.name.toLowerCase(); const g = D.classGfx(c) || c; if (M[g] || M[c]) plantsShown++; else missing['IOMG:' + c] = (missing['IOMG:' + c] || 0) + 1; }
    for (const o of md.objects) {
      if (!/^(TREE|STON|FRUI|DCCO|DECO|VGTN|WOOD)$/.test(o.type)) continue;
      const c = o.cls.toLowerCase(), g = D.classGfx(c) || c;
      if (M[g] || M[c]) by[o.type][1]++; else missing[o.type + ':' + c] = (missing[o.type + ':' + c] || 0) + 1;
    }
    rows.push(`${m.path.split('/').pop().padEnd(32)} ${md.setting.padEnd(9)} ${md.w}x${md.h} water ${md.water} trees ${S.trees.length} decor ${S.decor.length} plants ${plantsShown}/${md.plants.length} ` +
      Object.entries(by).filter(([k]) => /^(TREE|STON|FRUI|DCCO|DECO|VGTN|WOOD)$/.test(k)).map(([k, [a, b]]) => `${k} ${b}/${a}`).join(' '));
  } catch (e) { rows.push(m.path + ' ERROR ' + e.message); }
}
const miss = Object.entries(missing).sort((a, b) => b[1] - a[1]).slice(0, 80).map(([k, n]) => `${n}\t${k}`);
return rows.join('\n') + '\n\nMISSING CLASSES (count, type:class)\n' + miss.join('\n');
