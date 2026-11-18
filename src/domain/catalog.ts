export type Category = {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
};

export type ModifierOption = {
  id: string;
  name: string;
  priceDeltaCents: number;
  active: boolean;
  sku?: string;
};

export type ModifierGroup = {
  id: string;
  name: string;
  min: number;
  max: number;
  defaultOptionId?: string;
  options: ModifierOption[];
};

export type Product = {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  priceCents: number;
  available: boolean;
  active: boolean;
  modifierGroupIds: string[];
};

export type Catalog = {
  currency: "MXN";
  taxRateBps: number;
  pricesIncludeTax: boolean;
  categories: Category[];
  modifierGroups: ModifierGroup[];
  products: Product[];
};

export type CatalogProblem =
  | "malformed"
  | "invalid-price"
  | "duplicate-sku"
  | "unknown-category"
  | "unknown-modifier-group"
  | "invalid-modifier-group";

export class CatalogError extends Error {
  readonly problem: CatalogProblem;
  readonly subjectId: string | undefined;

  constructor(problem: CatalogProblem, subjectId?: string) {
    super(
      subjectId ? `Catalog ${problem}: ${subjectId}` : `Catalog ${problem}`,
    );
    this.name = "CatalogError";
    this.problem = problem;
    this.subjectId = subjectId;
  }
}

function asRecord(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new CatalogError("malformed");
  }
  return raw as Record<string, unknown>;
}

function malformed(item: Record<string, unknown>): never {
  throw new CatalogError(
    "malformed",
    typeof item.id === "string" ? item.id : undefined,
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown) => typeof item === "string")
  );
}

function parseCategory(raw: unknown): Category {
  const item = asRecord(raw);
  if (
    typeof item.id !== "string" ||
    typeof item.name !== "string" ||
    typeof item.sortOrder !== "number" ||
    ("active" in item && typeof item.active !== "boolean")
  ) {
    malformed(item);
  }
  return {
    id: item.id,
    name: item.name,
    sortOrder: item.sortOrder,
    active: typeof item.active === "boolean" ? item.active : true,
  };
}

function parseOption(raw: unknown, groupId: string): ModifierOption {
  const item = asRecord(raw);
  if (
    typeof item.id !== "string" ||
    typeof item.name !== "string" ||
    typeof item.priceDeltaCents !== "number" ||
    ("sku" in item && typeof item.sku !== "string")
  ) {
    malformed(item);
  }
  if (!Number.isSafeInteger(item.priceDeltaCents) || item.priceDeltaCents < 0) {
    throw new CatalogError("invalid-price", groupId);
  }
  return {
    id: item.id,
    name: item.name,
    priceDeltaCents: item.priceDeltaCents,
    active: true,
    ...(typeof item.sku === "string" ? { sku: item.sku } : {}),
  };
}

function parseGroup(raw: unknown): ModifierGroup {
  const item = asRecord(raw);
  if (
    typeof item.id !== "string" ||
    typeof item.name !== "string" ||
    typeof item.min !== "number" ||
    typeof item.max !== "number" ||
    !Array.isArray(item.options) ||
    ("defaultOptionId" in item && typeof item.defaultOptionId !== "string")
  ) {
    malformed(item);
  }
  const groupId = item.id;
  const options = item.options.map((option: unknown) =>
    parseOption(option, groupId),
  );
  const optionIds = new Set(options.map((option) => option.id));
  if (
    !Number.isSafeInteger(item.min) ||
    !Number.isSafeInteger(item.max) ||
    item.min < 0 ||
    item.min > item.max ||
    item.max < 1 ||
    item.max > options.length ||
    optionIds.size !== options.length ||
    (typeof item.defaultOptionId === "string" &&
      !optionIds.has(item.defaultOptionId))
  ) {
    throw new CatalogError("invalid-modifier-group", groupId);
  }
  return {
    id: groupId,
    name: item.name,
    min: item.min,
    max: item.max,
    ...(typeof item.defaultOptionId === "string"
      ? { defaultOptionId: item.defaultOptionId }
      : {}),
    options,
  };
}

export function parseCatalog(raw: unknown): Catalog {
  const item = asRecord(raw);
  if (
    item.currency !== "MXN" ||
    typeof item.taxRateBps !== "number" ||
    !Number.isSafeInteger(item.taxRateBps) ||
    item.taxRateBps < 0 ||
    typeof item.pricesIncludeTax !== "boolean" ||
    !Array.isArray(item.categories) ||
    !Array.isArray(item.modifierGroups) ||
    !Array.isArray(item.products)
  ) {
    throw new CatalogError("malformed");
  }
  const categories = item.categories.map(parseCategory);
  const categoryIds = new Set(categories.map((category) => category.id));
  const groupIds = new Set<string>();
  const modifierGroups = item.modifierGroups.map((rawGroup: unknown) => {
    const group = parseGroup(rawGroup);
    if (groupIds.has(group.id)) {
      throw new CatalogError("invalid-modifier-group", group.id);
    }
    groupIds.add(group.id);
    return group;
  });
  const productIds = new Set<string>();
  const skus = new Set<string>();
  const products = item.products.map((rawProduct: unknown): Product => {
    const product = asRecord(rawProduct);
    if (
      typeof product.id !== "string" ||
      typeof product.sku !== "string" ||
      typeof product.name !== "string" ||
      typeof product.categoryId !== "string" ||
      typeof product.priceCents !== "number" ||
      typeof product.available !== "boolean" ||
      ("active" in product && typeof product.active !== "boolean") ||
      !isStringArray(product.modifierGroupIds)
    ) {
      malformed(product);
    }
    if (!Number.isSafeInteger(product.priceCents) || product.priceCents <= 0) {
      throw new CatalogError("invalid-price", product.id);
    }
    if (productIds.has(product.id) || skus.has(product.sku)) {
      throw new CatalogError("duplicate-sku", product.id);
    }
    if (!categoryIds.has(product.categoryId)) {
      throw new CatalogError("unknown-category", product.id);
    }
    if (product.modifierGroupIds.some((id) => !groupIds.has(id))) {
      throw new CatalogError("unknown-modifier-group", product.id);
    }
    productIds.add(product.id);
    skus.add(product.sku);
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      categoryId: product.categoryId,
      priceCents: product.priceCents,
      available: product.available,
      active: typeof product.active === "boolean" ? product.active : true,
      modifierGroupIds: [...product.modifierGroupIds],
    };
  });
  return {
    currency: item.currency,
    taxRateBps: item.taxRateBps,
    pricesIncludeTax: item.pricesIncludeTax,
    categories,
    modifierGroups,
    products,
  };
}

export function productsInCategory(
  catalog: Catalog,
  categoryId: string,
): Product[] {
  return catalog.products.filter(
    (product) => product.categoryId === categoryId,
  );
}

export function findProduct(
  catalog: Catalog,
  productId: string,
): Product | undefined {
  return catalog.products.find((product) => product.id === productId);
}

export function modifierGroupsFor(
  catalog: Catalog,
  product: Product,
): ModifierGroup[] {
  return product.modifierGroupIds.flatMap((groupId) => {
    const group = catalog.modifierGroups.find(
      (candidate) => candidate.id === groupId,
    );
    return group ? [group] : [];
  });
}
