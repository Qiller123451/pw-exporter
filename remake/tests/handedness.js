// Handedness (maps/frame.js, pwexport/gsf.py GSF_MIRROR): every character holds its right-hand link on its right side
// (the models were mirrored before). python3 tests/evaljs.py tests/handedness.js "&tribe=Hu&enemy=Aje"
  const out = [];
  const v = G.world.units[0].pos.clone();
  for (const u of G.world.units.filter((u) => u.alive && u.obj && u.cls === 'CHTR').slice(0, 6)) {
    u.obj.updateMatrixWorld(true);
    const h = u.heading, f = [-Math.sin(h), -Math.cos(h)], r = [-f[1], f[0]];
    const rec = { name: u.name, h: +h.toFixed(2) };
    u.obj.traverse((o) => {
      if (/hndr|hndl|hand_r|hand_l/i.test(o.name) && !rec[o.name]) {
        o.getWorldPosition(v);
        const dx = v.x - u.pos.x, dz = v.z - u.pos.z;
        rec[o.name] = +(dx * r[0] + dz * r[1]).toFixed(2);
      }
    });
    out.push(rec);
  }
  const bad = out.filter((r) => !(r.link_HndR > 0.2) || (r.link_HndL !== undefined && !(r.link_HndL < -0.2)));
return (out.length && !bad.length ? 'ok' : 'FAIL') + ' right hands on the right: ' + JSON.stringify(out);

