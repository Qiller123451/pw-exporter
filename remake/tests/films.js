// The story films of the campaign (ui/mission.js playFilms; the toolkit converts the Bink films: pwexport/video.py):
//   python3 tests/evaljs.py tests/films.js "&campaign=9"
// needs <data>/assets/video/hs_3010.webm (python -m pwexport.video <game> <data>/assets/video). A sequence with a
// film plays it full screen with the game paused, its subtitles spread over it, Esc ends it; a sequence whose film
// is missing shows its subtitles instead.
const M = G.mission, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
M.skipAll();
M.manual = false;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ended = 0;
M.playSequence({ id: 'ms_test', videos: ['hs_3010.bik'], lines: [{ speaker: 'cole', text: 'First line' }, { speaker: 'bela', text: 'Second line' }] }, {}, () => { ended++; });
M.pump();
const v = document.querySelector('.film video');
await wait(4000);
check('the film plays full screen', !!M.cine && !!M.cine.film && !document.querySelector('.film').classList.contains('hidden') && v.currentTime > 0.5, { t: v.currentTime, err: v.error && v.error.code, src: v.currentSrc.split('/').pop() });
check('the game stands still meanwhile', !!G.paused);
check('a subtitle line shows', /line/.test(document.querySelector('.film .fsub span').textContent), document.querySelector('.film .fsub').textContent);
M.key({ code: 'Escape' });
check('Esc ends it (and the sequence)', !M.cine && ended === 1 && document.querySelector('.film').classList.contains('hidden'), { ended });
// a missing film: the subtitles instead
M.playSequence({ id: 'ms_missing', videos: ['hs_9999.bik'], lines: [{ speaker: 'cole', text: 'Only words' }] }, {}, () => { ended++; });
M.pump();
await wait(2500);
check('a missing film falls back to the subtitles', !!M.cine && !M.cine.film && /Only words/.test(document.querySelector('.cine .ctext').textContent), M.log.slice(-3));
M.skip();
check('and ends like a sequence', ended === 2, ended);
M.manual = true;
return out.join('\n');
