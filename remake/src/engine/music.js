// The original's music manager (Scripts/Game/mgr/MusicMgr.usl) on the data it reads (sounds.json "music", built by
// pipeline/build_sounds.py from Audio/MusicMgr.txt and Audio/MusicTracks.txt):
//   switches   MusicMgr.txt: one per situation, the highest one that is on plays -
//              MainMenu < Loading < Background < BackgroundLeveled < Hometown < Region < Trigger < Opening < Combat
//              < Sequence < GameEnd; each with its fade in / out, how it picks a track (autoselect_type 1: its own
//              music_track_id_N, 2: the won / lost node, 3: the level's playlist) and whether it starts a track anew
//              (restart_on_activate: at a random start_ms_N of the track) or goes on where it stopped
//   playlists  MusicTracks.txt: per level (LevelName lower case, blanks -> '_': "single_05", "tutorial"), else per
//              setting (material_atmos: "savanna_txt"), else "default": Opening / Background / Combat tracks
//   tracks     id -> file below Data/Base/Audio (music/<id>.mp3)
// When the switches turn on (MusicMgr.usl Tick, UpdateMusicSwitch):
//   MainMenu   always (the intro is over); the rest only while a game runs
//   Background from the start of the game; Opening too when the playlist has one (played once)
//   Combat     the player's objects were attacked at 3 places within 10 s (the minimap's attack events,
//              FeedbackEventMgr.usl: one per 0.15 s of hits); off when there was none for 10 s
//   Hometown   the listener within 75 m of one of the player's home objects for 5 s - the query takes the class names
//              of MusicMgr.usl: "fireplace" and "seas_headquaters" match no object of the game, so only the Aje's
//              resource collector brings the tribe's theme, as in the original
//   Trigger / BackgroundLeveled  the trigger action MUSI (CActionMusic: once / looped)
//   Region, Sequence, GameEnd    never started by the game's scripts (MusicMgr.OnGameEnd has no caller): after the
//              end of a game its music goes on behind the end screen
// Tracks loop except Opening and Trigger, which turn their switch off when they end.
const ORDER = ['MainMenu', 'Loading', 'Background', 'BackgroundLeveled', 'Hometown', 'Region', 'Trigger', 'Opening', 'Combat', 'Sequence', 'GameEnd'];
const ONCE = new Set(['Trigger', 'Opening']);
const GAME = ORDER.slice(2);

// the player's home objects for the Hometown switch (MusicMgr.usl CheckHomeTownSwitch: an object query by class name)
export const HOME_CLASS = { SEAS: 'seas_headquaters', Aje: 'aje_resource_collector', Hu: 'fireplace', Ninigi: 'fireplace' };

// the original's tables, for game data prepared before they were exported
const FALLBACK = {
  misc: { hometown_switch_delay_in_seconds: 5, hometown_range_in_meters: 75, combat_delay_in_seconds: 10, combat_attack_trigger: 3 },
  switches: { MainMenu: { fade_in_ms: 5000, autoselect_type: 1, restart_on_activate: 1, tracks: ['01_maintheme'] }, Background: { fade_in_ms: 5000, autoselect_type: 3, restart_on_activate: 1 }, Combat: { fade_in_ms: 2000, fade_out_ms: 10000, autoselect_type: 3 } },
  playlists: { default: { Background: ['11_plain_jungle_1', '12_plain_jungle_2', '05_plain_northland_2'], Combat: ['35_combat_hu_1', '40_combat_heroes', '41_combat_hu_2', '42_combat_aje_2', '47_var_combat_hu_2'] } },
  tracks: {},
};

// the playlist name of a level: its LevelName, else its setting's atmosphere file, else "default"
export function playlistName(lists, levelName, atmos) {
  const key = (s, dot) => { let k = String(s || '').toLowerCase().replace(/ /g, '_'); if (dot) k = k.replace(/\./g, '_'); return k; };
  const a = key(levelName), b = key(atmos, true);
  return lists[a] ? a : lists[b] ? b : 'default';
}

export class Music {
  constructor(audio) {
    this.A = audio;
    this.data = FALLBACK;
    this.el = null;              // the playing <audio>
    this.current = -1;           // index of the switch that plays
    this.sw = ORDER.map((name) => ({ name, on: false, track: '', file: '', pos: 0, el: null }));
    this.sw[0].on = true;
    this.running = false;
    this.attacks = [];           // [{x, z, t}] the last attack positions
    this.home = { inside: false, t: -1e9, next: 0 };
    this.level = null;
  }
  setData(m) { if (m && m.switches) this.data = m; }
  get misc() { return this.data.misc || FALLBACK.misc; }
  S(name) { return this.sw[ORDER.indexOf(name)]; }
  conf(name) { return (this.data.switches && this.data.switches[name]) || {}; }

  // ---------------------------------------------------------------- what the game tells it
  // a game starts: its playlist (MusicMgr.usl:701-738)
  startGame({ levelName, atmos, tribe }) {
    for (const n of GAME) Object.assign(this.S(n), { on: false });
    this.S('Opening').track = '';
    this.running = true; this.attacks = []; this.home = { inside: false, t: -1e9, next: 0 };
    const lists = this.data.playlists || {};
    this.level = lists[playlistName(lists, levelName, atmos)] || {};
    this.tribe = tribe;
    if (this.level.Opening) this.S('Opening').on = true;
    this.S('Background').on = true;
    this.update(0);
  }
  // back in the menus: the main theme
  stopGame() {
    this.running = false;
    for (const n of GAME) this.S(n).on = false;
    this.update(0);
  }
  // an attack on one of the player's objects (the minimap's attack event; MusicMgr.usl OnUnderAttack)
  attack(x, z, time) {
    const n = this.misc.combat_attack_trigger || 3;
    const same = this.attacks.find((a) => a.x === x && a.z === z);
    if (same) { same.t = time; return; }
    if (this.attacks.length >= n) {
      let k = 0;
      for (let i = 1; i < this.attacks.length; i++) if (time - this.attacks[i].t < time - this.attacks[k].t) k = i;
      this.attacks[k] = { x, z, t: time };
    } else this.attacks.push({ x, z, t: time });
  }
  // a cutscene starts / ends (MusicMgr.usl OnSequenceStart / OnSequenceEnd): the Sequence switch - above Combat - is on
  // for its length with the scene's music or "-silence-" (the client always passes one of them); the remake's
  // cutscenes play their own music items, so it is silence here. The user: "fight music still plays once the mission
  // ends and the cutscene starts".
  sequence(on) {
    const s = this.S('Sequence');
    if (on) { s.on = true; this.setTrack(s, '-silence-'); } else { s.on = false; s.track = ''; s.file = ''; }
    if (this.current === this.sw.indexOf(s) && on) this.current = -1;
    this.refresh();
  }
  // the trigger action MUSI: a track id or a file below Audio/ ('music/x.mp3'); looped = BackgroundLeveled
  trigger(track, loop) {
    const s = this.S(loop ? 'BackgroundLeveled' : 'Trigger');
    s.on = true;
    this.setTrack(s, track);
    if (this.current === this.sw.indexOf(s)) this.current = -1;     // play the new track at once
  }

  // ---------------------------------------------------------------- every frame
  // time: game seconds; listener {x, z}; homes(): positions of the player's home objects (asked every second)
  update(time, listener, homes) {
    if (this.running) {
      this.combat(time);
      if (listener && homes) this.hometown(time, listener, homes);
      // Opening and Trigger end with their track (or at once when it is silence or its file is missing)
      for (const n of ONCE) { const s = this.S(n); if (s.on && this.current === this.sw.indexOf(s) && (!s.el || s.el.ended || s.el.failed)) s.on = false; }
    }
    let k = -1;
    for (let i = this.sw.length - 1; i >= 0; i--) if (this.sw[i].on) { k = i; break; }
    if (k < 0) return;
    if (k !== this.current) this.activate(k);
    else if (this.current >= 0 && this.el) this.sw[this.current].pos = this.el.currentTime;
  }
  // switch to the highest switch that is on, without the timed checks
  refresh() {
    let k = -1;
    for (let i = this.sw.length - 1; i >= 0; i--) if (this.sw[i].on) { k = i; break; }
    if (k >= 0 && k !== this.current) this.activate(k);
  }
  combat(time) {
    const M = this.misc, delay = M.combat_delay_in_seconds || 10, n = M.combat_attack_trigger || 3;
    this.attacks = this.attacks.filter((a) => time - a.t <= delay);
    const c = this.S('Combat');
    c.on = c.on ? this.attacks.length > 0 : this.attacks.length >= n;
  }
  hometown(time, L, homes) {
    const M = this.misc, H = this.home, r = M.hometown_range_in_meters || 75;
    if (time >= H.next) {
      H.next = time + 1;
      const inside = homes().some((p) => (p.x - L.x) ** 2 + (p.z - L.z) ** 2 < r * r);
      if (inside !== H.inside) { H.inside = inside; H.t = time; }
    }
    const s = this.S('Hometown');
    if (s.on !== H.inside && time - H.t > (M.hometown_switch_delay_in_seconds || 5)) s.on = H.inside;
  }

  // ---------------------------------------------------------------- switching
  // the track a switch plays (SMusicSwitch.OnActivate / SetMusicTrack)
  pick(s) {
    const c = this.conf(s.name), auto = +c.autoselect_type || 0;
    if (!auto) return;
    let list = auto === 3 ? this.level && this.level[s.name] : c.tracks;
    if (auto === 2) list = null;                                 // GameEnd: never started
    if (list && !Array.isArray(list)) list = list[this.tribe];        // Hometown: per tribe
    if (!list || !list.length) { this.setTrack(s, '-silence-'); return; }
    this.setTrack(s, list[Math.floor(Math.random() * list.length)]);
  }
  setTrack(s, id) {
    id = String(id || '').toLowerCase();
    if (id !== s.track) s.pos = 0;
    s.track = id;
    if (id === '-silence-' || !id) { s.file = ''; s.pos = 0; return; }
    if (id.endsWith('.mp3')) { s.file = id; return; }
    const t = (this.data.tracks || {})[id];
    s.file = (t && t.file) || `music/${id}.mp3`;
    if (+this.conf(s.name).restart_on_activate) s.pos = t && t.start && t.start.length ? t.start[Math.floor(Math.random() * t.start.length)] / 1000 : 0;
  }
  activate(k) {
    const prev = this.current, s = this.sw[k];
    const fOut = prev >= 0 ? +(this.conf(this.sw[prev].name).fade_out_ms || 0) : 0;
    const fIn = +(this.conf(s.name).fade_in_ms ?? 5000);
    const fade = fOut === 0 && fIn !== 0 ? fIn : fOut !== 0 && fIn === 0 ? fOut : k > prev ? fIn : fOut;
    this.pick(s);
    this.current = k;
    this.play(s, fade);
  }
  play(s, fadeMs) {
    const A = this.A, old = this.el;
    if (old && s.file && old.dataset.file === s.file && old.loop === !ONCE.has(s.name)) { s.el = old; return; }
    let el = null;
    if (s.file && typeof window !== 'undefined' && window.Audio) {
      el = new window.Audio(A.base + s.file);
      el.dataset.file = s.file;
      el.loop = !ONCE.has(s.name);
      el.volume = 0;
      el.addEventListener('error', () => { el.failed = true; }, { once: true });
      const start = s.pos;
      if (start > 0) el.addEventListener('loadedmetadata', () => { try { el.currentTime = Math.min(start, (el.duration || start + 1) - 0.5); } catch (e) { /* ignore */ } }, { once: true });
      el.play().catch(() => {});
    }
    s.el = el;
    this.el = el;
    const t0 = performance.now(), T = Math.max(1, fadeMs), v0 = old ? old.volume : 0;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / T);
      if (el && this.el === el) el.volume = this.volume() * k;
      if (old && old !== this.el) old.volume = Math.max(0, v0 * (1 - k));
      if (k < 1) requestAnimationFrame(step); else if (old && old !== this.el) old.pause();
    };
    step();
  }
  volume() { const A = this.A; return A.muted ? 0 : A.vol.music * A.vol.master * (A.duckK || 1); }
  // the browser lets a page play sound only after a click: start what could not start before it
  resume() { if (this.el && this.el.paused && !this.el.ended) this.el.play().catch(() => {}); }
  applyVolume() { if (this.el) this.el.volume = this.volume(); }
  shutdown() { try { if (this.el) { this.el.pause(); this.el.src = ''; } } catch (e) { /* ignore */ } this.el = null; }
  // tests / the debug overlay
  state() { return { playing: this.current >= 0 ? this.sw[this.current].name : '', track: this.current >= 0 ? this.sw[this.current].track : '', on: this.sw.filter((s) => s.on).map((s) => s.name), attacks: this.attacks.length }; }
}
