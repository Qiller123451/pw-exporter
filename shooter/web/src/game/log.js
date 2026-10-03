// The game's log: what happened, written to a file by the local server while the game runs, so that after a crash
// (or a window that just closed) the file tells what the game was doing right before.
//
//   log.add('KIND', 'text')            one line
//   log.attach(game)                   from then on a line of numbers every few seconds ("BEAT") and game state in errors
//
// Lines are sent to POST /api/log every 2 s and at once for errors; when the page goes away the browser is asked to
// deliver a last "PAGE CLOSED" line (sendBeacon) with the keys held at that moment - a session whose file does not end
// with it did not close in an orderly way. The file is <toolkit home>/shooter/logs/shooter-<time>-<session>.log.
const pad = (n) => String(n).padStart(2, '0');
const stamp = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

export class Log {
  constructor(enabled = true) {
    this.sid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this.on = enabled; this.lines = []; this.file = null; this.game = null; this.sent = 0; this.errors = 0;
    this.frames = 0; this.worst = 0; this.lastFrame = performance.now();
    if (!enabled) return;
    addEventListener('error', (e) => this.error('ERROR', (e.error && e.error.stack) || `${e.message} (${e.filename}:${e.lineno})`));
    addEventListener('unhandledrejection', (e) => this.error('REJECTED', (e.reason && e.reason.stack) || String(e.reason)));
    const ce = console.error.bind(console);
    console.error = (...a) => { ce(...a); this.error('CONSOLE', a.map((x) => (x && x.stack) || String(x)).join(' ')); };
    document.addEventListener('visibilitychange', () => { this.add('PAGE', document.visibilityState === 'hidden' ? 'hidden (other tab / minimised)' : 'visible again'); this.flush(); });
    // the page is going away: closed, reloaded, or the browser closed the window
    addEventListener('pagehide', () => {
      const g = this.game, keys = g && g.input ? [...g.input.keys].join(' ') : '';
      this.add('PAGE CLOSED', `by the browser (window or tab closed, reloaded or left) while in state "${g ? g.state : '?'}"; keys held: ${keys || 'none'}` +
        (/Control/.test(keys) && /KeyW/.test(keys) ? '   <-- Ctrl+W is the browser\'s "close this tab"' : ''));
      this.flush(true);
    });
    setInterval(() => this.flush(), 2000);
    setInterval(() => this.beat(), 5000);
    this.add('START', `${location.href}  |  ${navigator.userAgent}  |  screen ${screen.width}x${screen.height} x${devicePixelRatio}  |  memory ${navigator.deviceMemory || '?'} GB, ${navigator.hardwareConcurrency || '?'} threads`);
  }
  add(kind, text) {
    if (!this.on) return;
    this.lines.push(`${stamp()} ${kind.padEnd(7)} ${text}`);
    if (this.lines.length > 4000) this.lines.splice(0, 1000);
  }
  // errors: at most 60 per session in full (an error in the frame loop would otherwise fill the disk), sent at once
  error(kind, text) {
    if (!this.on) return;
    this.errors++;
    if (this.errors > 60) { if (this.errors === 61) this.add(kind, '(more errors follow; not logged any more)'); return; }
    this.add(kind, String(text).slice(0, 4000) + '\n         ' + this.state());
    this.flush();
  }
  attach(game) {
    this.game = game;
    if (!this.on) return;
    const r = game.engine && game.engine.renderer;
    if (r) {
      const gl = r.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      this.add('GPU', `${ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)}  |  max texture ${gl.getParameter(gl.MAX_TEXTURE_SIZE)}  |  canvas ${r.domElement.width}x${r.domElement.height}`);
      // the graphics driver gave up on the page (out of video memory, driver reset): the picture freezes or goes black
      r.domElement.addEventListener('webglcontextlost', () => { this.error('GPU', '!! WebGL context LOST (graphics driver reset or out of video memory)'); });
      r.domElement.addEventListener('webglcontextrestored', () => this.add('GPU', 'WebGL context restored'));
    }
    this.add('SETTING', JSON.stringify(game.settings));
  }
  // called by the frame loop
  frame(ms) { this.frames++; if (ms > this.worst) this.worst = ms; this.lastFrame = performance.now(); }
  state() {
    const g = this.game;
    if (!g || !g.player || !g.player.ch) return 'state: ' + (g ? g.state : 'no game yet');
    try {
      const P = g.player, M = g.mission, E = g.enemies, c = P.ch, o = M && M.obj;
      const boss = M && M.boss && M.boss.alive ? ` boss ${M.boss.def.name} ${Math.round(M.boss.hp)}/${Math.round(M.boss.maxHp)} ${M.boss.state}` : '';
      return `state ${g.state} t=${g.time.toFixed(1)} obj ${M ? M.index : '-'}${o ? ' "' + o.text + '"' : ''} kills ${M ? M.totalKills : 0} | ${P.active} hp ${Math.round(c.health)} ar ${Math.round(c.armor)} ${P.weapon.id}:${Math.round(P.weapon.ammo)}` +
        ` pos ${P.pos.x.toFixed(0)},${P.pos.y.toFixed(0)},${P.pos.z.toFixed(0)}${P.firstPerson ? ' FP' : ''}${P.dead ? ' DEAD' : ''} | enemies ${E ? E.alive : 0} alive, ${E ? E.list.length : 0} bodies${boss} | shots in flight ${g.projectiles ? g.projectiles.list.length : 0}`;
    } catch (e) { return 'state: (could not be read: ' + e.message + ')'; }
  }
  beat() {
    const g = this.game;
    if (!this.on || !g || !g.ready) return;
    if (g.state !== 'play' && this._quiet === g.state) return;             // menus: one line, not one every 5 s
    this._quiet = g.state;
    const r = g.engine.renderer.info, mem = performance.memory;
    const age = performance.now() - this.lastFrame;
    this.add('BEAT', `${this.state()} | ${this.frames / 5 | 0} fps, worst frame ${this.worst.toFixed(0)} ms${age > 1500 ? `, !! NO FRAME for ${(age / 1000).toFixed(1)} s` : ''}` +
      ` | draw calls ${r.render.calls}, triangles ${r.render.triangles}, geometries ${r.memory.geometries}, textures ${r.memory.textures}` +
      (mem ? ` | JS heap ${(mem.usedJSHeapSize / 1048576).toFixed(0)} of ${(mem.jsHeapSizeLimit / 1048576).toFixed(0)} MB` : ''));
    this.frames = 0; this.worst = 0;
  }
  flush(closing = false) {
    if (!this.on || this.sent >= this.lines.length) return;
    const body = this.lines.slice(this.sent).join('\n') + '\n';
    this.sent = this.lines.length;
    const url = 'api/log?sid=' + this.sid;
    try {
      if (closing && navigator.sendBeacon) { navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' })); return; }
      fetch(url, { method: 'POST', body, keepalive: body.length < 60000, headers: { 'Content-Type': 'text/plain' } })
        .then((r) => r.json()).then((j) => { if (j && j.file) this.file = j.file; }).catch(() => {});
    } catch (e) { /* the server is gone: nothing to be done */ }
  }
  // how did the session before this one end? -> {file, closed, tail} (or null)
  async previous() {
    if (!this.on) return null;
    try { const j = await (await fetch('api/lastlog?sid=' + this.sid)).json(); return j && j.file ? j : null; } catch (e) { return null; }
  }
}
