// The in-game help (HelpMenu.usl, F1): the topics of Texts/Help/index.txt on the left, the chosen file's chapters
// and help items on the right, links between them, Home / Back / Forward. Opened from the menus or with F1 - then on
// the help item of what the mouse is over, the building being placed or the first selected object (StartHelpNav).
// Data: help.json (remake/pipeline/build_data.py help_book): { index: [{key, text, file, subs}], docs: {file: [
//   {t: 'chapter'|'section', key, title} | {t: 'item', key, title, img, medium, long}]} }; texts in the markup of
//   pwexport.texts._rich: '{ref:<file#key>|<label>}', '{img:<spec>}', newlines.
import { spriteCss, iconFor } from './atlas.js';

let BOOK = null;
export async function loadHelp() {
  if (!BOOK) { try { BOOK = await (await fetch('help.json')).json(); } catch (e) { BOOK = { index: [], docs: {} }; } }
  return BOOK;
}

const esc = (t) => String(t || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

// a picture of the help: bunit:<class> its card, bres:<level>;layer+<sprite> an interface sprite, pics/<x>.tga a cursor
function picture(spec, big) {
  const m = /^bunit:(\S+)/.exec(spec);
  if (m) { const ic = iconFor(m[1]); const css = ic && spriteCss(ic, 2, big ? 64 : 40, big ? 64 : 40); return css ? `<i class="hpic card" style="${css}"></i>` : ''; }
  const r = /^bres:(\d+);layer\+(\S+)/.exec(spec);
  if (r) { const css = spriteCss(r[2], +r[1], 22, 22); return css ? `<i class="hpic" style="${css}"></i>` : ''; }
  const p = /^pics\/(\w+)\.tga$/i.exec(spec);
  if (p) return `<img class="hpic" src="assets/ui/cur/${p[1].toLowerCase()}.png" alt="">`;
  return '';
}
function rich(t) {
  let h = '';
  const re = /\{ref:([^|}]*)\|([^}]*)\}|\{img:([^}]*)\}/g;
  let i = 0, m;
  while ((m = re.exec(t))) {
    h += esc(t.slice(i, m.index));
    h += m[3] != null ? picture(m[3]) : `<a class="hlink" data-ref="${esc(m[1])}">${esc(m[2])}</a>`;
    i = re.lastIndex;
  }
  h += esc(t.slice(i));
  return h.replace(/\n\n/g, '<p></p>').replace(/\n/g, '<br>');
}

export class HelpBook {
  constructor(menu) { this.menu = menu; this.G = menu.G; this.back = []; this.fwd = []; this.cur = null; }
  // the help item key of an object (HelpMenu.GetObjHelpitemKey: the tech tree's description, else the class)
  keyOf(name) { const t = this.G.data && this.G.data.texts; return name && t ? (t[name.toLowerCase()] && name.toLowerCase()) || name.toLowerCase() : ''; }
  // the file holding a help item
  find(key) {
    key = '_' + String(key || '').replace(/^_/, '').toLowerCase();
    for (const [f, items] of Object.entries(BOOK.docs)) if (items.some((x) => x.t === 'item' && x.key === key)) return `${f}#${key}`;
    return null;
  }
  // F1: what the mouse is over, the building being placed, the first selected object - else the introduction
  async openFor(G, onClose) {
    await loadHelp();
    const I = G.input, sel = [...G.sel][0], ghost = I && I.mode === 'place' && I.modeData;
    const cands = [I && I.hover && I.hover.name, ghost && ghost.results && ghost.results[0] && ghost.results[0].obj, sel && sel.name];
    let ref = null;
    for (const c of cands) if (c && (ref = this.find(this.keyOf(c)))) break;
    this.open(ref, onClose);
  }
  async open(ref, onClose) {
    await loadHelp();
    this.onClose = onClose || null;
    this.back = []; this.fwd = [];
    this.go(ref || this.home(), false);
  }
  home() { const t = BOOK.index[0]; return t ? t.file : ''; }
  go(ref, push = true) {
    if (push && this.cur) { this.back.push(this.cur); this.fwd = []; }
    this.cur = ref;
    this.render();
  }
  render() {
    const M = this.menu, [file, key] = String(this.cur || '').split('#');
    const doc = BOOK.docs[file] || [];
    const tree = (list, d) => list.map((t) => `<div class="ht${t.file === file ? ' on' : ''}" style="padding-left:${6 + d * 14}px" ${t.file ? `data-ref="${esc(t.file)}"` : ''}>${esc(t.text)}</div>${tree(t.subs, d + 1)}`).join('');
    const body = doc.map((x) => x.t !== 'item' ? `<h4 class="hch" id="h${esc(x.key)}">${esc(x.title)}</h4>`
      : `<div class="hitem" id="h${esc(x.key)}">${x.img ? `<span class="hright">${picture(x.img, true)}</span>` : ''}<b>${esc(x.title)}</b>`
        + (x.medium ? `<div class="hmed">${rich(x.medium)}</div>` : '') + (x.long ? `<div class="hlong">${rich(x.long)}</div>` : '') + '</div>').join('');
    M.open('Help', `<div class="helpbook"><div class="hindex">${tree(BOOK.index, 0)}</div><div class="hdoc">${body || '<p>No help text.</p>'}</div></div>
      <div class="btns">${M.btn('home', 'Home')}${M.btn('hback', 'Back')}${M.btn('hfwd', 'Forward')}${M.btn('close', 'Close')}</div>`);
    const W = M.win;
    W.classList.add('wide');
    W.querySelectorAll('[data-ref]').forEach((e) => { e.onclick = () => this.go(e.dataset.ref); });
    M.bind({
      home: () => this.go(this.home()),
      hback: () => { if (this.back.length) { this.fwd.push(this.cur); this.cur = this.back.pop(); this.render(); } },
      hfwd: () => { if (this.fwd.length) { this.back.push(this.cur); this.cur = this.fwd.pop(); this.render(); } },
      close: () => { W.classList.remove('wide'); if (this.onClose) this.onClose(); else M.close(); },
    });
    const at = key && W.querySelector('#h' + CSS.escape(key));
    const pane = W.querySelector('.hdoc');
    if (at && pane) pane.scrollTop = at.offsetTop - pane.offsetTop; else if (pane) pane.scrollTop = 0;
  }
}
