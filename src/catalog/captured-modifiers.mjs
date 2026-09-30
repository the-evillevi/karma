// Saved modifier records are untrusted JSON. Compare own entries through Maps;
// never resolve a storage-supplied key on an object or its prototype chain.
export function sameCapturedModifiers(before, after) {
  const read = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const entries = Object.entries(value);
    if (entries.some(([key, options]) =>
      ['__proto__', 'constructor', 'prototype'].includes(key)
      || !Array.isArray(options)
      || options.some(option => typeof option !== 'string'))) return null;
    return new Map(entries.map(([key, options]) => [key, [...options].sort()]));
  };
  const oldSelections = read(before);
  const newSelections = read(after);
  if (!oldSelections || !newSelections) return false;
  const keys = new Set([...oldSelections.keys(), ...newSelections.keys()]);
  return [...keys].every(key => {
    const oldOptions = oldSelections.get(key) ?? [];
    const newOptions = newSelections.get(key) ?? [];
    return oldOptions.length === newOptions.length
      && oldOptions.every((option, index) => option === newOptions[index]);
  });
}
