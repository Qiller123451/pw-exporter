// In-engine cutscenes (ui/cutscene.js, game/campaign/sequence.js; docs/SEQUENCE_FORMAT.md): mission 1's sc_1040 - the
// four freed spearmen walk down to Stina while Cole and the warriors stay up the hill and a rock rolls into the
// path. Skipped (as with ?manual) the actors are put where the scene leaves them; played, the camera follows the
// scene's shots, the actors walk and talk (speech with subtitles at their items' times) and end in the same places.
//   python3 tests/evaljs.py tests/cutscene.js "&campaign=1"      (the mission's own triggers are held back)
const C = G.campaign, W = G.world, E = C.engine, M = G.mission, out = [];
const ok = (c, m, info) => out.push(`${c ? 'ok  ' : 'FAIL'} ${m}` + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
for (const t of E.triggers) t.startEnabled = false;
const path = Object.keys(C.data.sequences || {}).find((k) => /sc_1040\.seq$/i.test(k));
const seq = C.data.sequences[path];
ok(!!seq && !!seq.play && seq.play.actors.length > 10 && seq.play.cuts.length > 5, 'sc_1040 comes with its timeline', seq && seq.play && { actors: seq.play.actors.length, cuts: seq.play.cuts.length, end: seq.play.end });
ok(seq.lines.length === 4 && seq.lines.every((l) => l.t >= 0 && l.mp3), 'its subtitles are its speech items, timed', seq.lines.map((l) => [l.t, l.key]));
const SPEAR = ['hu_spearman_14', 'hu_spearman_15', 'hu_spearman_16', 'hu_spearman_17'];
let spear = SPEAR.map((n) => C.objects.byName(n)).map((r) => r && r.entity);
ok(spear.every((u) => u && u.alive), 'the four spearmen are there');
// (freed: the mission gives them to the player before the scene - "bela_worker_ready" and the prison triggers)
for (const n of SPEAR) C.setOwner(C.objects.byName(n), 0);
// (played with another tribe, "&tribe=SEAS": they become the tribe's equivalents - new world objects, same records)
spear = SPEAR.map((n) => C.objects.byName(n)).map((r) => r && r.entity);
const cole0 = W.units.find((u) => u.alive && /^cole/i.test(u.name));
for (const u of spear) W.teleport(u, cole0.pos.x + 4, cole0.pos.z + 4);
const stina = W.units.find((u) => u.alive && /^stina/i.test(u.name)), cole = W.units.find((u) => u.alive && /^cole/i.test(u.name));
const d = (u, v) => Math.hypot(u.pos.x - v.pos.x, u.pos.z - v.pos.z);
const before = spear.map((u) => +d(u, stina).toFixed(1));
// skipped: the actors end where the scene leaves them
E.playSequence({ path, quit: false, snapBack: false, snapActors: false, camera: null, fow: false, trigger: E.triggers[0] });
for (let i = 0; i < 10 && (E.seqRunning || E.seqQueue.length); i++) G.step(1, 0.05);
const after = spear.map((u) => +d(u, stina).toFixed(1));
{ const A = E.seqActors, sp = A ? A.list.filter((x) => /spear/i.test(x.a.cls || '')) : [];
  ok(sp.length === 4 && sp.every((x) => !x.temp && spear.includes(x.e)), 'the scene\'s four spearmen are the freed ones (also as another tribe\'s equivalents)', sp.map((x) => [x.a.name, x.temp, x.e && x.e.name])); }
ok(after.every((x) => x < 12) && before.every((x) => x > 20), 'skipped: the spearmen end down by Stina (they were up with Cole)', { before, after });
const rock = C.objects.byName('rolling_stone_2');
ok(!rock || !rock.prop || d(rock.prop, cole) < 30, 'the rolling stone lies in the path below Cole', rock && rock.prop && +d(rock.prop, cole).toFixed(1));
// played: the scene's own timeline on screen
for (const u of spear) W.teleport(u, cole.pos.x + 3, cole.pos.z + 3);
M.manual = false;
E.playSequence({ path, quit: false, snapBack: false, snapActors: false, camera: null, fow: false, trigger: E.triggers[0] });
G.step(1, 0.05);
M.update(0.016);
ok(M.cine && M.cine.player && G.paused, 'played: the cutscene runs, the game stands still', { cine: !!M.cine, paused: G.paused });
const cam0 = G.camera.position.clone();
const seen = { moved: 0, line: '', camMoves: 0 };
let last = cam0.clone();
let lipMax = 0, lipOn = false;
for (let i = 0; i < 400 && M.cine; i++) {
  if (i % 8 === 0) await new Promise((r) => setTimeout(r, 40));        // (the speech's lip-sync file loads meanwhile)
  M.update(0.05);
  const pl = M.cine && M.cine.player, cA = pl && pl.actors.list.find((A) => /^cole/i.test(A.a.cls));
  if (cA && cA.lip) { lipOn = true; lipMax = Math.max(lipMax, cA.lip.w || 0); }
  G.seqCam && G.seqCam(0.05);
  if (G.camera.position.distanceTo(last) > 0.01) seen.camMoves++;
  last = G.camera.position.clone();
  const tx = M.cineEl && M.cineEl.querySelector('.ctext').textContent;
  if (tx && !seen.line) seen.line = tx;
}
ok(seen.camMoves > 20, 'the camera follows the shots', seen.camMoves);
ok(lipOn && lipMax > 0.1, 'lip sync: Cole\'s jaw follows his line (faceanim frame 1 for IY / IH / h / y)', +lipMax.toFixed(2));
ok(/Stina|okay/i.test(seen.line), 'a subtitle shows when its speech item starts', seen.line);
ok(!M.cine && !G.paused, 'it ends after its length and the game goes on', { cine: !!M.cine, paused: G.paused });
const after2 = spear.map((u) => +d(u, stina).toFixed(1));
ok(after2.every((x) => x < 12), 'played: the spearmen end down by Stina too', after2);
return out.join('\n');
