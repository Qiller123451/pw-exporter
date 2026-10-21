// The sequel campaign's maps for the Model & Map Exporter's map viewer (pwexport/web/app.js, mapview.js). They are no
// .ula files: each mission's map is made by the remake's own code (game/sequel/maps.js) when the mission starts. This
// module does the same in the viewer and hands the map over the way the viewer draws a ParaWorld map: heights, the
// weights of the setting's ground materials, every object with its model, the start, the roads (meshes).
// Bundled by build.sh into game/sequelmaps.js, an ES module that takes three.js from the page (the exporter's own).
import { HeightField } from '../engine/terrain.js';
import { Assets } from '../engine/assets.js';
import { sequelSource, roadMeshes } from '../game/sequel/maps.js';
import { MISSIONS } from '../game/sequel/missions.js';

// the missions' maps: [{id, mission, name, place, date, setting, w, h}]
export function list() {
  return MISSIONS.map((m) => ({ id: 'sequel:' + m.id, mission: m.id, name: `${m.id}. ${m.title}`, place: m.place, date: m.date,
    setting: m.map.setting, w: (m.map.size || 0) + 160, h: (m.map.size || 0) + 160 }));
}

// one mission's map for MapView.load: an info object as /api/map gives it (map coordinates: x east, y south, z up,
// from the north-west corner) with `local` - what the viewer otherwise fetches from the server.
// models: {name: {}} of the models there are (the exporter's catalogue and the sequel's own built ones);
// texBase: where the road surfaces (sq_road_<kind>.png) are served
export function build(mission, models, texBase) {
  const d = MISSIONS.find((m) => m.id === +mission);
  if (!d) throw new Error('no such mission: ' + mission);
  Assets.manifest = { models };
  // (as Sequel.source: nothing grows where the mission puts its own things)
  const clear = [...(d.map.clear || []), ...(d.start.buildings || []).map(([, x, z]) => [x, z, 24]), ...(d.zones || []).map((z) => [z.x, z.z, z.r + 4])];
  const S = sequelSource({ ...d.map, clear, name: d.title }, null);
  const hf = new HeightField(S.size, S.meshCell, S.height);
  const w = S.size, h = S.size, half = S.size / 2;
  // ground: the source's weights per vertex, onto the setting's material slots (textures: '<setting>/scape_<k>.jpg')
  const slot = S.textures.map((t) => +(/scape_(\d)/.exec(t) || [0, 0])[1]);
  const weights = S.splat(hf), n = hf.n;
  const w0 = new Float32Array(n * n * 4), w1 = new Float32Array(n * n * 4);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, ws = weights(i * hf.cell - half, j * hf.cell - half);
    ws.forEach((v, t) => { if (v) { const s = slot[t]; if (s < 4) w0[k * 4 + s] += v; else w1[k * 4 + s - 4] += v; } });
  }
  // objects: the source's decoration, trees, stone and food deposits; turned the way the remake's props are (a turn
  // about y: the viewer's rot is the map's heading, pi - that)
  const objs = [];
  const add = (type, o) => objs.push({ type, model: o.model, name: o.model, x: o.x + half, y: o.z + half, z: o.y != null ? o.y : hf.at(o.x, o.z),
    rot: Math.PI - (o.rot || 0), scale: o.scale || 1 });
  for (const o of S.decor) add(/^sq_/.test(o.model) ? 'BLDG' : /tree|palm/.test(o.model) ? 'TREE' : 'DECO', o);
  for (const o of S.trees) add('TREE', o);
  for (const o of S.stones) add('STON', o);
  for (const o of S.bushes) add('FRUI', o);
  for (const o of d.pieces || []) add('DECO', o);           // the scene's set pieces where they start (London's wheel rim)
  const hq = (d.start.buildings || [])[0];
  if (hq) objs.push({ type: 'SLOC', name: 'start_0', model: null, x: hq[1] + half, y: hq[2] + half, z: hf.at(hq[1], hq[2]) });
  const types = {};
  for (const o of objs) types[o.type] = (types[o.type] || 0) + 1;
  const roads = roadMeshes(S, hf, null, texBase);
  return {
    id: 'sequel:' + d.id, name: `${d.id}. ${d.title}`, rel: `Containment/${d.id}`, pack: 'ParaWorld: Containment', setting: d.map.setting,
    w, h, grid: [Math.round(w / 2), Math.round(h / 2)], water: S.water, players: 1, objects: objs.length, plants: 0, types,
    description: `${d.place} — ${d.date}. ${(d.briefing || [])[0] || ''}`, object_list: objs, plant_list: [], forest: {},
    local: { n, cell: hf.cell, H: hf.h, w0, w1, roads, night: !!d.night },
  };
}
