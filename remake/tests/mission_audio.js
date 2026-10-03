// Speech of dialogue scenes and cutscenes (src/ui/mission.js speak): python3 tests/evaljs.py tests/mission_audio.js "&campaign=1"
// Needs the installation's Audio/SeqSounds (mission 1: Level_1/1020_Cole_01.mp3, Level_1/1040/1040_Cole_01.mp3); without
// them every line is "skip" - the game then shows the texts in silence.
const C = G.campaign, M = G.mission, D = C.data, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  G.audio.init(); G.audio.applyVolumes();
  const dA = D.dialogs['Cpn_single_001/single_01/ds_1020.dlg'], f0 = dA.frames[0];
  const file = M.frameSound(dA, f0);
  check('sound file of a frame from its audio name', file === '../SeqSounds/Level_1/1020_Cole_01.mp3', file);
  const mentor = Object.values(D.dialogs).find((d) => d.mentor);
  check('mentor hint: Mentor/<scene>.mp3', M.frameSound(mentor, mentor.frames[0]) === `../SeqSounds/Mentor/${(mentor.frames[0].audio || mentor.id).replace(/^ds_/i, '')}.mp3`, M.frameSound(mentor, mentor.frames[0]));
  const buf = await G.audio.buffer(file);
  if (!buf) out.push('skip  no speech files in this installation (silence, text timing)');
  else {
    check('speech file decoded', buf.duration > 0.5, { seconds: buf.duration, ctx: G.audio.ctx.state });
    let ended = 0;
    M.playDialog(dA, () => ended++);
    G.step(1, 0.05); await sleep(600);
    check('frame is as long as its sound and plays it', !!M.scene && M.scene.i === 0 && !!M.scene.sound && Math.abs(M.scene.len - (M.scene.t - 0.05 + buf.duration)) < 0.3 && M.scene.len >= buf.duration, { len: M.scene && M.scene.len, sound: buf.duration, text: M.frameLength(f0.text) });
    M.closeDialog();
    check('closing the scene stops the voice', ended === 1 && !M.scene);
    // a missing file: silence, the text length
    const fake = { id: 'ds_9999', actors: {}, frames: [{ actor: 'X', speaker: 'X', text: 'Nothing to hear here.', audio: 'ds_9999_Nobody_01' }] };
    M.playDialog(fake, () => ended++); G.step(1, 0.05); await sleep(500);
    check('missing sound: silence, text length', !!M.scene && !M.scene.sound && M.scene.len === M.frameLength(fake.frames[0].text), M.scene && M.scene.len);
    M.skipAll();
    // cutscene line with speech
    const sq = Object.values(D.sequences).find((s) => s.id === 'sc_1040');
    const li = sq.lines.findIndex((l) => /cole_01$/.test(l.key));
    check('speech file of a subtitle line', M.lineSound(sq, sq.lines[li]) === '../SeqSounds/Level_1/1040/1040_Cole_01.mp3', M.lineSound(sq, sq.lines[li]));
    M.manual = false;
    M.playSequence({ ...sq, lines: [sq.lines[li]] }, {}, () => ended++);
    M.update(0.016); await sleep(600);
    const sb = await G.audio.buffer(M.lineSound(sq, sq.lines[li]));
    check('cutscene line lasts as long as its speech', !!M.cine && !!M.cine.sound && !!sb && Math.abs(M.cine.len - (sb.duration + 0.4)) < 0.3, { len: M.cine && M.cine.len, sound: sb && sb.duration });
    M.skip(); M.manual = true;
    check('cutscene ended', ended === 3 && !G.paused);
  }
} catch (e) { check('exception', false, String(e && e.stack || e)); }
return out.join('\n');
