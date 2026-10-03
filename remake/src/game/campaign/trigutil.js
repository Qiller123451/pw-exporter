// Small helpers shared by the trigger engine, its conditions and its actions (remake/docs/spec/triggers.md §1.2,
// §2.3, §3): count expressions, $(variable) substitution, the trigger expression.
// CHelper.GetValueString (ConditionFactory.usl:2715-2744): "$(name)" anywhere in the string = the variable's value
// (it replaces the whole string); an unknown variable gives ''.
export function valueString(s, vars) {
  s = String(s == null ? '' : s);
  const a = s.indexOf('$(');
  if (a < 0) return s;
  const b = s.indexOf(')');
  if (b < a + 2) return s;
  const v = vars.get(s.slice(a + 2, b));
  return v == null ? '' : String(v);
}
// String.ToInt of the scripts: leading integer, anything else 0
export const toInt = (s) => { const n = parseInt(String(s).trim(), 10); return Number.isFinite(n) ? n : 0; };
// CHelper.Compare (ConditionFactory.usl:2754-2781): a bare number means >=
export function compare(a, s, vars) {
  s = String(s == null ? '' : s).trim();
  const val = (r) => toInt(valueString(r, vars));
  if (s.startsWith('>=')) return a >= val(s.slice(2));
  if (s.startsWith('>')) return a > val(s.slice(1));
  if (s.startsWith('<=')) return a <= val(s.slice(2));
  if (s.startsWith('<')) return a < val(s.slice(1));
  if (s.startsWith('==')) return a === val(s.slice(2));
  if (s.startsWith('!=')) return a !== val(s.slice(2));
  if (s.startsWith('=')) return a === val(s.slice(1));
  return a >= val(s);
}
// the trigger expression: condition numbers (1-based), && || ! and parentheses -> fn(states[]) -> bool.
// Empty = the AND of all conditions (§1.2); no condition at all = never.
export function compileExpression(src, n) {
  src = String(src || '').trim();
  if (!n) return () => false;
  if (!src) return (c) => { for (let i = 0; i < n; i++) if (!c[i].state) return false; return true; };
  const tok = src.match(/\d+|&&|\|\||!|\(|\)|&|\|/g) || [];
  let i = 0;
  const prim = () => {
    const t = tok[i++];
    if (t === '!') { const f = prim(); return (c) => !f(c); }
    if (t === '(') { const f = or(); if (tok[i] === ')') i++; return f; }
    if (t === undefined || !/^\d+$/.test(t)) throw new Error('bad expression "' + src + '"');
    const k = +t - 1;
    return (c) => !!(c[k] && c[k].state);
  };
  const and = () => { let f = prim(); while (tok[i] === '&&' || tok[i] === '&') { i++; const a = f, b = prim(); f = (c) => a(c) && b(c); } return f; };
  const or = () => { let f = and(); while (tok[i] === '||' || tok[i] === '|') { i++; const a = f, b = and(); f = (c) => a(c) || b(c); } return f; };
  const f = or();
  if (i < tok.length) throw new Error('bad expression "' + src + '"');
  return f;
}
// file part of a sequence / dialogue path, compared without case
export const filePart = (p) => String(p || '').replace(/\\/g, '/').split('/').pop().toLowerCase();

