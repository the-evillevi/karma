import { validateCatalog } from './catalog-domain.mjs';

/** Map the canonical catalog to the legacy demo POS data shape. Not a persistence or approval boundary. */
export function adaptCatalogForRuntime(catalog, existingRuntime = {}) {
  const { errors } = validateCatalog(catalog);
  if (errors.length) throw new Error(`Cannot adapt invalid catalog: ${errors.join('; ')}`);
  const byOrderAndId = (left, right) => left.sortOrder - right.sortOrder || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const categories = [...catalog.categories].sort(byOrderAndId).map((category) => ({ id: category.id, label: category.name, active: category.active }));
  const categoryById = new Map(catalog.categories.map((category) => [category.id, category]));
  const products = [...catalog.products].sort(byOrderAndId).map((product) => {
    // The integer centavo value remains authoritative. This is a compatibility
    // number for the legacy demo UI, so do not test it with binary float equality.
    const pesos = product.price.amountCents / 100;
    if (!Number.isFinite(pesos)) {
      throw new Error(`Product ${product.id} cannot be represented exactly in the legacy peso-number runtime`);
    }
    return {
      id: product.id,
      name: product.name,
      cat: product.categoryId,
      price: pesos,
      priceCents: product.price.amountCents,
      mods: [...product.modifierGroupIds],
      // Existing POS checks available for sales. Keep stock availability separate
      // from permanent activation in canonical data.
      available: product.available && product.active && Boolean(categoryById.get(product.categoryId)?.active),
      active: product.active,
    };
  });
  const modGroups = Object.fromEntries(catalog.modifierGroups.map((group) => [group.id, {
    label: group.name,
    min: group.selection.min,
    max: group.selection.max,
    options: group.options.map((option) => {
      const price = option.priceEffect.amountCents / 100;
      if (!Number.isFinite(price)) {
        throw new Error(`Modifier ${group.id}/${option.id} cannot be represented exactly in the legacy peso-number runtime`);
      }
      return { id: option.id, label: option.name, price, priceCents: option.priceEffect.amountCents, active: option.active };
    }),
  }]));
  return {
    ...existingRuntime,
    categories,
    products,
    modGroups,
    catalogInfo: {
      schema: catalog.schema,
      revision: catalog.revision,
      sourceStatus: catalog.sourceStatus,
      businessValidated: catalog.importGate.readyForValidatedBusinessUse,
      demoOnly: !catalog.importGate.readyForValidatedBusinessUse,
    },
  };
}
