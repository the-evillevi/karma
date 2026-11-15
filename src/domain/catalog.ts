// Menu catalog (EVL-112). Source of truth: catalog/catalog.json, generated from
// the workbook Carlos validated. Money is integer centavos, IVA included.

export type Category = { id: string; name: string; sortOrder: number };

export type ModifierOption = {
  id: string;
  name: string;
  priceDeltaCents: number;
  /** Present when the option is also a workbook product (an "Extra"). */
  sku?: string;
};

export type ModifierGroup = {
  id: string;
  name: string;
  /** Minimum and maximum number of options the cashier must/may pick. */
  min: number;
  max: number;
  defaultOptionId?: string;
  options: ModifierOption[];
};

export type Product = {
  /** Stable ID. Equal to the workbook SKU. */
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  priceCents: number;
  available: boolean;
  modifierGroupIds: string[];
};

export type Catalog = {
  currency: "MXN";
  /** IVA rate in basis points: 1600 is 16 %. */
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

/** Why a catalog was refused, and which product or group caused it. */
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

/** Validates raw JSON and returns a typed catalog. Throws CatalogError. */
export function parseCatalog(raw: unknown): Catalog {
  void raw;
  throw new Error("not implemented");
}

/** Products of one category, in catalog order. */
export function productsInCategory(
  catalog: Catalog,
  categoryId: string,
): Product[] {
  void catalog;
  void categoryId;
  throw new Error("not implemented");
}

export function findProduct(
  catalog: Catalog,
  productId: string,
): Product | undefined {
  void catalog;
  void productId;
  throw new Error("not implemented");
}
