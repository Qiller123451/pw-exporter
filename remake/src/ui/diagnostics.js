// Problems the player should see instead of a silent black screen:
//   * the browser renders WebGL in software (hardware acceleration off, or Chrome disabled the GPU after a crash)
//   * the WebGL context was lost (driver reset / GPU memory) - the page needs a reload
//   * a script error inside the game loop (shown once per distinct message, with the first stack line)
// Everything is shown in one banner at the top of the screen; the banner can be closed.
// Clicking a message copies it to the clipboard - with the full stack trace, the build and the game settings -
// so it can be pasted into a bug report.

let banner = null;
const shown = new Set();
let context = () => '';                                         // extra lines for copied reports (set by main.js)
export function setReportContext(fn) { context = fn; }

// copy text to the clipboard (the async API needs a secure context - localhost is one; fallback for others)
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fallback below */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) { return false; }
}

function ensureBanner() {
  if (banner) return banner;
  banner = document.createElement('div');
  banner.id = 'diag';
  banner.style.cssText = 'position:fixed;left:50%;top:44px;transform:translateX(-50%);max-width:820px;z-index:9999;' +
    'background:rgba(40,10,6,.92);border:1px solid #c0602a;color:#ffd9b0;font:13px/1.45 "Trebuchet MS",sans-serif;' +
    'padding:8px 30px 8px 12px;border-radius:4px;box-shadow:0 2px 10px #000;white-space:pre-wrap;display:none';
  const x = document.createElement('span');
  x.textContent = '×';
  x.style.cssText = 'position:absolute;right:9px;top:4px;cursor:pointer;font-size:18px';
  x.onclick = () => { banner.style.display = 'none'; };
  banner.appendChild(x);
  banner.body = document.createElement('div');
  banner.appendChild(banner.body);
  document.body.appendChild(banner);
  return banner;
}

// show a problem once (same key = same message); `detail` is what gets copied (default: the text itself)
export function report(key, text, detail) {
  if (shown.has(key)) return;
  shown.add(key);
  const b = ensureBanner();
  const p = document.createElement('div');
  p.textContent = text;
  p.title = 'Click to copy this message';
  p.style.cssText = 'cursor:copy;padding:2px 0';
  const hint = document.createElement('span');
  hint.style.cssText = 'color:#c09070;font-size:11px;margin-left:8px';
  hint.textContent = '(click to copy)';
  p.appendChild(hint);
  p.onclick = async () => {
    let extra = '';
    try { extra = context(); } catch (e) { /* ignore */ }
    const ok = await copyText((detail || text) + (extra ? '\n\n' + extra : ''));
    hint.textContent = ok ? '✓ copied to the clipboard' : '(copying failed - select the text and press Ctrl+C)';
    hint.style.color = ok ? '#9fe08a' : '#ff9a7a';
    setTimeout(() => { hint.textContent = '(click to copy)'; hint.style.color = '#c09070'; }, 2500);
  };
  b.body.appendChild(p);
  b.style.display = '';
  console.warn('[diagnostics]', text);
}

// an error with its whole stack trace (start-up errors, errors outside the loop)
export function reportError(where, err) {
  const msg = String((err && err.message) || err);
  const stack = String((err && err.stack) || '');
  const first = stack.split('\n')[1] || '';
  report('err:' + where + ':' + msg, `Game error in ${where}: ${msg}${first ? '\n  ' + first.trim() : ''}\n(Please send this text to the developer.)`,
    `Game error in ${where}: ${msg}\n${stack}`);
}

// errors nobody caught (event handlers, promises)
export function watchGlobalErrors() {
  window.addEventListener('error', (e) => { if (e.error) reportError('page', e.error); });
  window.addEventListener('unhandledrejection', (e) => reportError('page', e.reason));
}

// name of the GPU the browser renders with (null if hidden)
export function gpuName(gl) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null;
  } catch (e) { return null; }
}

// call once after the WebGLRenderer exists
export function watchRenderer(renderer) {
  const gl = renderer.getContext();
  const name = gpuName(gl) || '';
  const testRun = /[?&]manual\b/.test(location.search);       // headless tests always render in software
  if (!testRun && /swiftshader|llvmpipe|software|basic render|microsoft basic/i.test(name)) {
    report('soft', `Your browser is drawing the game without the graphics card (${name}). The game will be extremely slow or black.\n` +
      'Chrome/Edge: Settings → System → turn on "Use graphics acceleration when available", then restart the browser. ' +
      'If it is already on, open chrome://gpu to check, or restart the browser (it can switch the GPU off after a driver crash).');
  }
  const cv = renderer.domElement;
  cv.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    report('lost', 'The graphics card reset the game\'s 3D view (WebGL context lost), so the world cannot be drawn any more. ' +
      'Press F5 to reload. If this keeps happening, lower "Shadows" and "Resolution" in Options.');
  });
  return name;
}

// a step of the game loop threw: keep the loop alive, tell the player once
export function loopError(step, err) { reportError(step, err); }
