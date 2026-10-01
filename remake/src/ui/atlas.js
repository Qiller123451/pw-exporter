// Access to the original HUD texture atlas (UI/All_def.txt converted to assets/ui/atlas.json).
export const UIA = { atlas: {}, base: 'assets/ui/', lower: {} };

export async function initAtlas(base = 'assets/ui/') {
  UIA.base = base;
  UIA.atlas = await (await fetch(base + 'atlas.json')).json();
  for (const k in UIA.atlas) UIA.lower[k.toLowerCase()] = UIA.atlas[k];
}

// best entry for a name: prefer the requested level, else the largest available
export function entry(name, level) {
  if (!name) return null;
  const e = UIA.atlas[name] || UIA.lower[name.toLowerCase()];
  if (!e) return null;
  if (level !== undefined && e[String(level)]) return e[String(level)];
  let best = null;
  for (const k in e) if (!best || e[k][3] * e[k][4] > best[3] * best[4]) best = e[k];
  return best;
}

// CSS for drawing an atlas region into a box of w x h css pixels
export function spriteCss(name, level, w, h) {
  const e = entry(name, level);
  if (!e) return null;
  const [file, x, y, sw, sh] = e;
  w = w || sw; h = h || sh;
  const sx = w / sw, sy = h / sh;
  return `background-image:url(${UIA.base}${file});background-position:${-x * sx}px ${-y * sy}px;background-size:${imgSize(file)[0] * sx}px ${imgSize(file)[1] * sy}px;width:${w}px;height:${h}px;`;
}

const SIZES = {};
export function imgSize(file) { return SIZES[file] || [512, 512]; }
export async function preloadAtlasImages() {
  const files = new Set();
  for (const k in UIA.atlas) for (const l in UIA.atlas[k]) files.add(UIA.atlas[k][l][0]);
  await Promise.all([...files].map((f) => new Promise((res) => {
    const im = new Image();
    im.onload = () => { SIZES[f] = [im.naturalWidth, im.naturalHeight]; res(); };
    im.onerror = () => res();
    im.src = UIA.base + f;
  })));
}

// unit/building portrait icon name for an object (atlas keys follow the tech tree names)
export function iconFor(name) {
  if (!name) return null;
  if (entry(name)) return name;
  const base = name.replace(/_s\d$/, '').replace(/_\d$/, '');
  if (entry(base)) return base;
  return null;
}
