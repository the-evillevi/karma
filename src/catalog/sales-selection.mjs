/** Toggle one option while enforcing the group's single/multiple and min/max rules. */
export function toggleModifierSelection(current, optionId, { min, max }) {
  if (!Array.isArray(current) || !Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max < min) {
    throw new TypeError('Invalid modifier selection state');
  }
  const selected = current.includes(optionId);
  if (selected) return current.length > min ? current.filter((id) => id !== optionId) : [...current];
  if (max === 1) return [optionId];
  return current.length < max ? [...current, optionId] : [...current];
}
