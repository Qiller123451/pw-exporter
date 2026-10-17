// The diplomacy window (the original's CDiplomacyWindow, DiplomacyWindow.usl / .srf; docs/spec/ui_groups7_9.md
// §1-2): a row per other player - name, team, colour, my opinion of them (Friend / Neutral / Enemy), their opinion
// of me (Status) and the tribute: food, wood or stone, an amount, Send and Request. Only in skirmish games (the top
// bar's button is there only on multiplayer maps, IngameScreen.usl:737-757); the opinions are locked with "Lock
// diplomacy settings", in Domination and Defender. The game runs on while it is open.

const esc = (t) => String(t == null ? '' : t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const REL = ['Enemy', 'Neutral', 'Friend'];
const STATUS_COL = ['#ff7a5a', '#ffffff', '#8de07a'];

export function diplomacyWindow(G) {
  const M = G.menu, W = G.world, D = G.data, me = G.me;
  const ui = (k, d) => D.ui(k, d);
  const locked = !!(W.rules.diplomacyLocked || W.rules.mode === 'domination' || W.rules.mode === 'defender');
  const others = W.players.filter((p) => p !== me);
  const hex = (p) => '#' + ((p.color >>> 0) & 0xffffff).toString(16).padStart(6, '0');
  const row = (p) => {
    const mine = me.relation(p), theirs = p.relation(me), gone = p.defeated;
    const radios = [2, 1, 0].map((r) => `<td><label class="pwradio${locked || gone ? ' off' : ''}"><input type="radio" name="dp${p.id}" value="${r}" ${mine === r ? 'checked' : ''} ${locked || gone ? 'disabled' : ''}><i></i></label></td>`).join('');
    return `<tr data-p="${p.id}" class="${gone ? 'gone' : ''}"><td class="nm" style="color:${hex(p)}">${esc(p.name)}</td><td>${p.team || '-'}</td>
      <td><i class="sw" style="background:${hex(p)}"></i></td>${radios}
      <td style="color:${STATUS_COL[theirs]}">${esc(ui('_UI_DiplWind_Option_' + REL[theirs], REL[theirs]))}</td>
      <td><select class="pwsel" data-res ${gone ? 'disabled' : ''}>${['food', 'wood', 'stone'].map((r) => `<option value="${r}">${esc(ui('_UI_DiplWind_' + r, r))}</option>`).join('')}</select></td>
      <td><input class="pwsel" data-n maxlength="5" value="0" ${gone ? 'disabled' : ''}></td>
      <td><button class="pwbtn small" data-send ${gone ? 'disabled' : ''}>Send</button></td><td><button class="pwbtn small" data-req ${gone ? 'disabled' : ''}>Request</button></td></tr>`;
  };
  M.inGame = true;
  M.open(ui('_PlayersWindow_Title_Diplomacy', 'Diplomacy'), `<table class="dipl"><thead><tr>
      <th>${esc(ui('_PlayersWindow_Player', 'Player'))}</th><th>${esc(ui('_PlayersWindow_Team', 'Team'))}</th><th>${esc(ui('_PlayersWindow_Color', 'Color'))}</th>
      <th>${esc(ui('_PlayersWindow_Label_Friend', 'Friend'))}</th><th>${esc(ui('_PlayersWindow_Label_Neutral', 'Neutral'))}</th><th>${esc(ui('_PlayersWindow_Label_Enemy', 'Enemy'))}</th>
      <th>${esc(ui('_PlayersWindow_Label_Status', 'Status'))}</th><th colspan="4">${esc(ui('_PlayersWindow_Label_Tribute', 'Tribute'))}</th></tr></thead>
      <tbody>${others.map(row).join('')}</tbody></table>
    <div class="btns row">${M.btn('close', ui('_PlayersWindow_Button_Close', 'Close'), 'small')}</div>`, { noPause: true });
  const win = M.win;
  win.classList.add('wide');
  const close = () => { win.classList.remove('wide'); M.close(); };
  M.bind({ close });
  const brain = (p) => (G.brains && G.brains.get(p.id)) || null;
  win.querySelectorAll('tr[data-p]').forEach((tr) => {
    const p = W.players.find((x) => x.id === +tr.dataset.p);
    // my opinion of them (SetMyOpinion)
    tr.querySelectorAll('input[type=radio]').forEach((r) => { r.onchange = () => { W.changeOpinion(me, p, +r.value); M.click(); diplomacyWindow(G); }; });
    // amounts: digits only, at most 5 (DW:90-100)
    const n = tr.querySelector('[data-n]');
    n.oninput = () => { n.value = n.value.replace(/\D/g, '').slice(0, 5); };
    const res = () => tr.querySelector('[data-res]').value;
    // Send: the resources go over at once, the computer player thanks (DW:72-88, ai/chat.js)
    tr.querySelector('[data-send]').onclick = () => {
      const sent = W.tribute(me, p, res(), +n.value || 0);
      if (sent > 0 && brain(p)) brain(p).onPlayerRequest(me, 'gift');
      n.value = '0';
    };
    // Request: a computer player sends 100 of it when it can (the amount is not read, AIC:683-720)
    tr.querySelector('[data-req]').onclick = () => { if (brain(p)) brain(p).onPlayerRequest(me, res()); };
  });
}
