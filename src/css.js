// Bridge for the many literal `style="a:b;c:d"` strings in the original DC
// templates: JSX requires `style` to be an object, so we parse those CSS
// strings into React style objects. Object styles produced by renderVals
// (e.g. `p.style`, `chip(on)`) are used directly and never go through here.
//
// Memoized because the same literal strings render on every frame.
const cache = new Map();

export function css(str) {
  if (str == null || str === '') return undefined;
  if (typeof str !== 'string') return str; // already an object
  const hit = cache.get(str);
  if (hit) return hit;
  const obj = {};
  for (const decl of str.split(';')) {
    const i = decl.indexOf(':');
    if (i === -1) continue;
    const prop = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (!prop) continue;
    // custom properties (--x) keep their name; others camelCase.
    const key = prop.startsWith('--')
      ? prop
      : prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    obj[key] = value;
  }
  cache.set(str, obj);
  return obj;
}
