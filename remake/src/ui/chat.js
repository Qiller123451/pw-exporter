// The in-game chat (the original's CIngameChatBar, ChatWindow.usl 16-349; docs/spec/ui_groups7_9.md §3): a bar
// of 550 x 50 px at a height of 1 - 1/3.5 of the screen with the target (To All / To Allies / To Enemies), the line
// (150 characters) and Send. Enter opens it to all, Ctrl+Enter to the allies, Shift+Enter to the enemies; the top
// bar's Chat button opens it, its right click the history of the news lines (HistoryWindow.usl).
// A line to all that starts with "AI<n>:" is a request to the computer player of slot n (help / food / wood / stone /
// gift: game/ai/chat.js) - as in the original, only "To All" lines reach the computer players (CW:147-153).
// There are no other human players: whispering (/whisper, /who) has nobody to reach.

const esc = (t) => String(t == null ? '' : t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const MAX_HISTORY = 300;

export class Chat {
  constructor(G) {
    this.G = G;
    this.history = [];                  // [{ t (game time), text, kind }] of every message line (HUD.message)
    this.bar = null;
  }
  ui(k, d) { return this.G.data.ui(k, d); }
  log(text, kind) {
    this.history.push({ t: this.G.world ? Math.floor(this.G.world.time) : 0, text: String(text), kind: kind || '' });
    if (this.history.length > MAX_HISTORY) this.history.splice(0, this.history.length - MAX_HISTORY);
  }
  // to: 'all' | 'allies' | 'enemies'
  open(to = 'all') {
    const G = this.G;
    if (!G.hud || G.menuOpen) return;
    if (!this.bar) this.build();
    this.bar.classList.remove('hidden');
    this.sel.value = to;
    this.input.value = '';
    this.input.focus();
  }
  close() { if (this.bar) { this.bar.classList.add('hidden'); this.input.blur(); } }
  get isOpen() { return !!this.bar && !this.bar.classList.contains('hidden'); }
  build() {
    const b = this.bar = document.createElement('div');
    b.className = 'chatbar hidden';
    b.innerHTML = `<select class="pwsel" title="${esc(this.ui('_UI_ChatWind_List_Filter_TT'))}">${['All', 'Allies', 'Enemies'].map((k) => `<option value="${k.toLowerCase()}">${esc(this.ui('_UI_ChatWind_Option_To' + k, 'To ' + k))}</option>`).join('')}</select>
      <input class="pwsel" maxlength="150" title="${esc(this.ui('_UI_ChatWind_Edit_Text_TT'))}"><button class="pwbtn small" title="${esc(this.ui('_UI_ChatWind_Button_Send_TT'))}">${esc(this.ui('_UI_ChatWind_Button_Send', 'Send'))}</button>`;
    this.sel = b.querySelector('select'); this.input = b.querySelector('input');
    b.querySelector('button').onclick = () => this.send();
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); this.send(); } else if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    });
    for (const ev of ['mousedown', 'click', 'wheel']) b.addEventListener(ev, (e) => e.stopPropagation());
    this.G.hud.root.appendChild(b);
  }
  send() {
    const G = this.G, W = G.world, me = G.me, text = this.input.value.trim(), to = this.sel.value;
    this.close();
    if (!text) return;
    if (to === 'allies' || to === 'enemies') {
      // to the players I consider friends / enemies; a computer player does not read it (CW:271-322)
      G.hud.message(this.ui(to === 'allies' ? '_UI_ChatWind_Msg_ToAllies' : '_UI_ChatWind_Msg_ToEnemies', '') + text, 'chat');
      return;
    }
    G.hud.message(`${me.name}: ${text}`, 'chat');
    const m = /^AI(\d)\s*:\s*(.*)$/i.exec(text);
    if (m) {
      const p = W.players.find((x) => x.id === +m[1]), b = p && G.brains && G.brains.get(p.id);
      if (b && b.onPlayerRequest) b.onPlayerRequest(me, m[2]);
    }
  }
  // the history of the news lines (HistoryWindow.usl: 765 x 515, "auto scroll")
  showHistory() {
    const G = this.G, M = G.menu;
    const mmss = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    M.inGame = true;
    M.open(this.ui('_UI_ChatWind_Title_Chat', 'Chat'), `<div class="chathist">${this.history.map((h) => `<div class="${esc(h.kind)}"><em>${mmss(h.t)}</em> ${esc(h.text)}</div>`).join('') || '<div class="dim">-</div>'}</div>
      <label class="pwcheck"><input type="checkbox" id="ch_auto" checked><i></i>Auto scroll</label>
      <div class="btns row">${M.btn('close', 'Close', 'small')}</div>`, { noPause: true });
    const list = M.win.querySelector('.chathist');
    if (M.win.querySelector('#ch_auto').checked) list.scrollTop = list.scrollHeight;
    M.bind({ close: () => M.close() });
  }
}
