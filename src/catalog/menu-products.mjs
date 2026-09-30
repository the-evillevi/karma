function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} es obligatorio.`);
  return value.trim();
}

/** Parse a non-negative peso amount to exact MXN centavos. */
export function parseMenuPriceCents(value) {
  const text = typeof value === 'string' ? value.trim() : String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new Error('El precio debe ser un monto no negativo con máximo dos decimales.');
  }
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error('El precio supera el límite permitido.');
  return cents;
}

/** Build a validated menu save without mutating the current demo products. */
export function saveMenuProduct(products, selectedId, form, newProductId) {
  if (!Array.isArray(products)) throw new TypeError('La lista de productos no es válida.');
  if (!form || typeof form !== 'object') throw new TypeError('El formulario del producto no es válido.');
  const name = requireText(form.name, 'El nombre del producto');
  const categoryId = requireText(form.cat, 'La categoría');
  const priceCents = parseMenuPriceCents(form.price);
  const price = priceCents / 100;

  if (selectedId === 'new') {
    const id = requireText(newProductId, 'El identificador del producto');
    return [{ id, name, cat: categoryId, price, mods: [], available: Boolean(form.available) }, ...products];
  }

  const existing = products.find((product) => product.id === selectedId);
  if (!existing) throw new Error('No se encontró el producto que intentas editar.');
  return products.map((product) => product.id === selectedId
    ? { ...product, name, cat: categoryId, price, available: Boolean(form.available) }
    : product);
}
