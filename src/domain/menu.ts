import type {
  Catalog,
  Category,
  ModifierGroup,
  ModifierOption,
  Product,
} from "./catalog.ts";
import type {
  Actor,
  CommandBatch,
  CommandMeta,
  PosEvent,
  PosState,
} from "./journal.ts";
import { can } from "./access.ts";
import { findProduct, productsInCategory } from "./catalog.ts";
import { CommandRejectedError } from "./commands.ts";

export type ProductChanges = Partial<
  Pick<Product, "priceCents" | "available" | "name" | "categoryId" | "active">
>;

export type MenuEdit = { at: string; by: Actor };

export type ProductPatch = { changes: ProductChanges; lastEdit: MenuEdit };

export type CategoryChanges = Partial<Pick<Category, "name" | "active">>;

export type OptionChanges = Partial<
  Pick<ModifierOption, "name" | "priceDeltaCents" | "active">
>;

export type GroupOptionEdits = {
  changes: Record<string, OptionChanges>;
  added: ModifierOption[];
};

export type MenuState = {
  products: Record<string, ProductPatch>;
  created: Product[];
  categories: Record<string, CategoryChanges>;
  createdCategories: Category[];
  categoryOrder: string[];
  productOrder: Record<string, string[]>;
  modifierOptions: Record<string, GroupOptionEdits>;
  createdGroups: ModifierGroup[];
  productGroups: Record<string, string[]>;
};

export const SKU_SERIES = "52000822";

export type NewProductInput = {
  sku: string;
  name: string;
  categoryId: string;
  priceCents: number;
};

export type ProductEdit = {
  productId: string;
  name?: string;
  categoryId?: string;
  active?: boolean;
};

export function emptyMenu(): MenuState {
  return {
    products: {},
    created: [],
    categories: {},
    createdCategories: [],
    categoryOrder: [],
    productOrder: {},
    modifierOptions: {},
    createdGroups: [],
    productGroups: {},
  };
}

export function suggestedSku(menu: Catalog): string {
  let highest = Number(`${SKU_SERIES}000`);
  for (const { sku } of menu.products) {
    if (sku.startsWith(SKU_SERIES) && /^[0-9]{11}$/.test(sku)) {
      highest = Math.max(highest, Number(sku));
    }
  }
  return String(highest + 1);
}

export function forSale(menu: Catalog): Catalog {
  const categories = menu.categories.filter(
    (category) => category.active !== false,
  );
  const categoryIds = new Set(categories.map((category) => category.id));
  return {
    ...menu,
    categories,
    products: menu.products.filter(
      (product) =>
        product.active !== false && categoryIds.has(product.categoryId),
    ),
  };
}

export function createProduct(
  state: PosState,
  meta: CommandMeta,
  input: NewProductInput,
  base: Catalog,
): CommandBatch {
  if (!can(meta.actor.role, "edit-menu")) {
    throw new CommandRejectedError("not-allowed", "edit-menu");
  }
  const current = menuFor(base, state.menu);
  const { sku, categoryId, priceCents } = input;
  const name = input.name.trim();
  if (name === "") {
    throw new CommandRejectedError("invalid-name");
  }
  if (!current.categories.some((category) => category.id === categoryId)) {
    throw new CommandRejectedError("unknown-category");
  }
  if (!Number.isSafeInteger(priceCents) || priceCents <= 0) {
    throw new CommandRejectedError("invalid-price");
  }
  if (!/^[0-9]{1,20}$/.test(sku)) {
    throw new CommandRejectedError("invalid-sku");
  }
  if (
    current.products.some(
      (product) => product.id === sku || product.sku === sku,
    )
  ) {
    throw new CommandRejectedError("duplicate-sku");
  }
  return {
    ...meta,
    actor: structuredClone(meta.actor),
    events: [
      {
        type: "product-created",
        product: {
          id: sku,
          sku,
          name,
          categoryId,
          priceCents,
          available: true,
          active: true,
          modifierGroupIds: [],
        },
      },
    ],
  };
}

export function updateProduct(
  state: PosState,
  meta: CommandMeta,
  input: ProductEdit,
  base: Catalog,
): CommandBatch {
  if (!can(meta.actor.role, "edit-menu")) {
    throw new CommandRejectedError("not-allowed", "edit-menu");
  }
  const current = menuFor(base, state.menu);
  const { productId, categoryId, active } = input;
  const product = findProduct(current, productId);
  if (!product) {
    throw new CommandRejectedError("unknown-product");
  }
  const name = input.name?.trim();
  if (name === "") {
    throw new CommandRejectedError("invalid-name");
  }
  if (
    categoryId !== undefined &&
    !current.categories.some((category) => category.id === categoryId)
  ) {
    throw new CommandRejectedError("unknown-category");
  }
  const destination =
    categoryId !== undefined && categoryId !== product.categoryId
      ? categoryId
      : undefined;
  const changes: ProductChanges = {
    ...(name !== undefined ? { name } : {}),
    ...(destination !== undefined ? { categoryId: destination } : {}),
    ...(active !== undefined ? { active } : {}),
  };
  return {
    ...meta,
    actor: structuredClone(meta.actor),
    events: [
      { type: "product-updated", productId, changes },
      ...(destination !== undefined
        ? [lastInCategory(current, destination, productId)]
        : []),
    ],
  };
}

function lastInCategory(
  menu: Catalog,
  categoryId: string,
  productId: string,
): PosEvent {
  return {
    type: "products-reordered",
    categoryId,
    productIds: [
      ...productsInCategory(menu, categoryId)
        .map((item) => item.id)
        .filter((id) => id !== productId),
      productId,
    ],
  };
}

export function menuFor(base: Catalog, menu: MenuState): Catalog {
  const categories = [...base.categories].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  const categoryIds = new Set(categories.map((category) => category.id));
  for (const category of menu.createdCategories) {
    if (categoryIds.has(category.id)) continue;
    categories.push(category);
    categoryIds.add(category.id);
  }
  const categoryRanks = new Map(
    menu.categoryOrder.map((id, index) => [id, index]),
  );
  categories.sort(
    (a, b) =>
      (categoryRanks.get(a.id) ?? menu.categoryOrder.length) -
      (categoryRanks.get(b.id) ?? menu.categoryOrder.length),
  );
  const increasingSortOrder = categories.every(
    (category, index) =>
      index === 0 || category.sortOrder > categories[index - 1].sortOrder,
  );
  const products = [...base.products];
  const productIds = new Set(products.map((product) => product.id));
  for (const product of menu.created) {
    if (productIds.has(product.id)) continue;
    products.push(product);
    productIds.add(product.id);
  }
  const patchedProducts = products.map((product) => ({
    ...product,
    ...(Object.hasOwn(menu.products, product.id)
      ? menu.products[product.id].changes
      : {}),
    ...(Object.hasOwn(menu.productGroups, product.id)
      ? { modifierGroupIds: menu.productGroups[product.id] }
      : {}),
  }));
  const orderedProducts = new Map<string, Product[]>();
  for (const [categoryId, ids] of Object.entries(menu.productOrder)) {
    const ranks = new Map(ids.map((id, index) => [id, index]));
    orderedProducts.set(
      categoryId,
      patchedProducts
        .filter((product) => product.categoryId === categoryId)
        .sort(
          (a, b) =>
            (ranks.get(a.id) ?? ids.length) - (ranks.get(b.id) ?? ids.length),
        ),
    );
  }
  const positions = new Map<string, number>();
  const groups = [...base.modifierGroups];
  const groupIds = new Set(groups.map((group) => group.id));
  for (const group of menu.createdGroups) {
    if (groupIds.has(group.id)) continue;
    groups.push(group);
    groupIds.add(group.id);
  }
  return {
    ...base,
    modifierGroups: groups.map((group) => {
      const edits = Object.hasOwn(menu.modifierOptions, group.id)
        ? menu.modifierOptions[group.id]
        : undefined;
      if (!edits) return group;
      const baseIds = new Set(group.options.map((option) => option.id));
      return {
        ...group,
        options: [
          ...group.options,
          ...edits.added.filter((option) => !baseIds.has(option.id)),
        ].map((option) =>
          Object.hasOwn(edits.changes, option.id)
            ? { ...option, ...edits.changes[option.id] }
            : option,
        ),
      };
    }),
    categories: categories.map((category, index) => ({
      ...category,
      ...(Object.hasOwn(menu.categories, category.id)
        ? menu.categories[category.id]
        : {}),
      ...(!increasingSortOrder ? { sortOrder: index } : {}),
    })),
    products: patchedProducts.map((product) => {
      const ordered = orderedProducts.get(product.categoryId);
      if (!ordered) return product;
      const index = positions.get(product.categoryId) ?? 0;
      positions.set(product.categoryId, index + 1);
      return ordered[index];
    }),
  };
}

export function lastEdit(menu: MenuState, productId: string): MenuEdit | null {
  return Object.hasOwn(menu.products, productId)
    ? menu.products[productId].lastEdit
    : null;
}

export function editLabel(edit: MenuEdit): string {
  const day = String(Number(edit.at.slice(8, 10)));
  const month = [
    "ene",
    "feb",
    "mar",
    "abr",
    "may",
    "jun",
    "jul",
    "ago",
    "sep",
    "oct",
    "nov",
    "dic",
  ][Number(edit.at.slice(5, 7)) - 1];
  const time = edit.at.slice(11, 16);
  return `Editado por ${edit.by.name} · ${day} ${month}, ${time}`;
}

export function setProductPrice(
  state: PosState,
  meta: CommandMeta,
  input: { productId: string; priceCents: number },
  base: Catalog,
): CommandBatch {
  if (!can(meta.actor.role, "edit-menu")) {
    throw new CommandRejectedError("not-allowed", "edit-menu");
  }
  if (!findProduct(menuFor(base, state.menu), input.productId)) {
    throw new CommandRejectedError("unknown-product");
  }
  if (!Number.isSafeInteger(input.priceCents) || input.priceCents <= 0) {
    throw new CommandRejectedError("invalid-price");
  }
  return {
    ...meta,
    actor: structuredClone(meta.actor),
    events: [
      {
        type: "product-updated",
        productId: input.productId,
        changes: { priceCents: input.priceCents },
      },
    ],
  };
}

export function setProductAvailability(
  state: PosState,
  meta: CommandMeta,
  input: { productId: string; available: boolean },
  base: Catalog,
): CommandBatch {
  if (!can(meta.actor.role, "set-availability")) {
    throw new CommandRejectedError("not-allowed", "set-availability");
  }
  if (!findProduct(menuFor(base, state.menu), input.productId)) {
    throw new CommandRejectedError("unknown-product");
  }
  return {
    ...meta,
    actor: structuredClone(meta.actor),
    events: [
      {
        type: "product-updated",
        productId: input.productId,
        changes: { available: input.available },
      },
    ],
  };
}

export type MoveDirection = "up" | "down";

export type NewCategoryInput = { categoryId: string; name: string };

export type CategoryEdit = {
  categoryId: string;
  name?: string;
  active?: boolean;
};

export function createCategory(
  state: PosState,
  meta: CommandMeta,
  input: NewCategoryInput,
  base: Catalog,
): CommandBatch {
  if (!can(meta.actor.role, "edit-menu")) {
    throw new CommandRejectedError("not-allowed", "edit-menu");
  }
  const current = menuFor(base, state.menu);
  const name = categoryName(input.name, current.categories);
  if (current.categories.some((category) => category.id === input.categoryId)) {
    throw new CommandRejectedError("duplicate-category");
  }
  return {
    ...meta,
    actor: structuredClone(meta.actor),
    events: [
      {
        type: "category-created",
        category: {
          id: input.categoryId,
          name,
          active: true,
          sortOrder: (current.categories.at(-1)?.sortOrder ?? -1) + 1,
        },
      },
    ],
  };
}

export function updateCategory(
  state: PosState,
  meta: CommandMeta,
  input: CategoryEdit,
  base: Catalog,
): CommandBatch {
  if (!can(meta.actor.role, "edit-menu")) {
    throw new CommandRejectedError("not-allowed", "edit-menu");
  }
  const current = menuFor(base, state.menu);
  const { categoryId, active } = input;
  if (!current.categories.some((category) => category.id === categoryId)) {
    throw new CommandRejectedError("unknown-category");
  }
  const name =
    input.name === undefined
      ? undefined
      : categoryName(
          input.name,
          current.categories.filter((category) => category.id !== categoryId),
        );
  return {
    ...meta,
    actor: structuredClone(meta.actor),
    events: [
      {
        type: "category-updated",
        categoryId,
        changes: {
          ...(name !== undefined ? { name } : {}),
          ...(active !== undefined ? { active } : {}),
        },
      },
    ],
  };
}

export function moveCategory(
  state: PosState,
  meta: CommandMeta,
  input: { categoryId: string; direction: MoveDirection },
  base: Catalog,
): CommandBatch {
  if (!can(meta.actor.role, "edit-menu")) {
    throw new CommandRejectedError("not-allowed", "edit-menu");
  }
  const current = menuFor(base, state.menu);
  const ids = current.categories.map((category) => category.id);
  if (!ids.includes(input.categoryId)) {
    throw new CommandRejectedError("unknown-category");
  }
  return {
    ...meta,
    actor: structuredClone(meta.actor),
    events: [
      {
        type: "categories-reordered",
        categoryIds: swapNeighbour(ids, input.categoryId, input.direction),
      },
    ],
  };
}

export function moveProduct(
  state: PosState,
  meta: CommandMeta,
  input: { productId: string; direction: MoveDirection },
  base: Catalog,
): CommandBatch {
  if (!can(meta.actor.role, "edit-menu")) {
    throw new CommandRejectedError("not-allowed", "edit-menu");
  }
  const current = menuFor(base, state.menu);
  const product = findProduct(current, input.productId);
  if (!product) {
    throw new CommandRejectedError("unknown-product");
  }
  const ids = productsInCategory(current, product.categoryId).map(
    (item) => item.id,
  );
  return {
    ...meta,
    actor: structuredClone(meta.actor),
    events: [
      {
        type: "products-reordered",
        categoryId: product.categoryId,
        productIds: swapNeighbour(ids, input.productId, input.direction),
      },
    ],
  };
}

function normalizedName(name: string): string {
  return name.trim().normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function categoryName(value: string, others: Category[]): string {
  const name = value.trim();
  if (name === "") {
    throw new CommandRejectedError("invalid-category-name");
  }
  if (
    others.some(
      (category) => normalizedName(category.name) === normalizedName(name),
    )
  ) {
    throw new CommandRejectedError("duplicate-category");
  }
  return name;
}

function swapNeighbour(
  ids: string[],
  id: string,
  direction: MoveDirection,
): string[] {
  const index = ids.indexOf(id);
  const neighbour = index + (direction === "up" ? -1 : 1);
  if (neighbour < 0 || neighbour >= ids.length) {
    throw new CommandRejectedError("invalid-move");
  }
  const next = [...ids];
  [next[index], next[neighbour]] = [next[neighbour], next[index]];
  return next;
}

export type OptionEdit = {
  groupId: string;
  optionId: string;
  name?: string;
  priceDeltaCents?: number;
  active?: boolean;
};

export type NewOptionInput = {
  groupId: string;
  optionId: string;
  name: string;
  priceDeltaCents: number;
};

export function updateModifierOption(
  state: PosState,
  meta: CommandMeta,
  input: OptionEdit,
  base: Catalog,
): CommandBatch {
  if (!can(meta.actor.role, "edit-menu")) {
    throw new CommandRejectedError("not-allowed", "edit-menu");
  }
  const { groupId, optionId, priceDeltaCents, active } = input;
  const group = menuFor(base, state.menu).modifierGroups.find(
    (group) => group.id === groupId,
  );
  if (!group) {
    throw new CommandRejectedError("unknown-modifier-group");
  }
  if (!group.options.some((option) => option.id === optionId)) {
    throw new CommandRejectedError("unknown-option");
  }
  const name =
    input.name === undefined
      ? undefined
      : optionName(
          input.name,
          group.options.filter((option) => option.id !== optionId),
        );
  if (
    priceDeltaCents !== undefined &&
    (!Number.isSafeInteger(priceDeltaCents) || priceDeltaCents < 0)
  ) {
    throw new CommandRejectedError("invalid-option-price");
  }
  if (
    active === false &&
    group.options.filter(
      (option) => option.id !== optionId && option.active !== false,
    ).length < group.min
  ) {
    throw new CommandRejectedError("group-needs-option");
  }
  return {
    ...meta,
    actor: structuredClone(meta.actor),
    events: [
      {
        type: "modifier-option-updated",
        groupId,
        optionId,
        changes: {
          ...(name !== undefined ? { name } : {}),
          ...(priceDeltaCents !== undefined ? { priceDeltaCents } : {}),
          ...(active !== undefined ? { active } : {}),
        },
      },
    ],
  };
}

export function addModifierOption(
  state: PosState,
  meta: CommandMeta,
  input: NewOptionInput,
  base: Catalog,
): CommandBatch {
  if (!can(meta.actor.role, "edit-menu")) {
    throw new CommandRejectedError("not-allowed", "edit-menu");
  }
  const { groupId, optionId, priceDeltaCents } = input;
  const group = menuFor(base, state.menu).modifierGroups.find(
    (group) => group.id === groupId,
  );
  if (!group) {
    throw new CommandRejectedError("unknown-modifier-group");
  }
  const name = optionName(input.name, group.options);
  if (group.options.some((option) => option.id === optionId)) {
    throw new CommandRejectedError("duplicate-option");
  }
  if (!Number.isSafeInteger(priceDeltaCents) || priceDeltaCents < 0) {
    throw new CommandRejectedError("invalid-option-price");
  }
  return {
    ...meta,
    actor: structuredClone(meta.actor),
    events: [
      {
        type: "modifier-option-added",
        groupId,
        option: { id: optionId, name, priceDeltaCents, active: true },
      },
    ],
  };
}

function optionName(value: string, others: ModifierOption[]): string {
  const name = value.trim();
  if (name === "") {
    throw new CommandRejectedError("invalid-option-name");
  }
  if (
    others.some(
      (option) => normalizedName(option.name) === normalizedName(name),
    )
  ) {
    throw new CommandRejectedError("duplicate-option");
  }
  return name;
}

export type NewGroupInput = {
  groupId: string;
  name: string;
  min: number;
  max: number;
  defaultOptionId?: string;
  options: { optionId: string; name: string; priceDeltaCents: number }[];
};

export function createModifierGroup(
  state: PosState,
  meta: CommandMeta,
  input: NewGroupInput,
  base: Catalog,
): CommandBatch {
  if (!can(meta.actor.role, "edit-menu")) {
    throw new CommandRejectedError("not-allowed", "edit-menu");
  }
  const current = menuFor(base, state.menu);
  const { groupId, min, max, defaultOptionId } = input;
  const name = input.name.trim();
  if (name === "") {
    throw new CommandRejectedError("invalid-group-name");
  }
  if (
    current.modifierGroups.some(
      (group) => normalizedName(group.name) === normalizedName(name),
    )
  ) {
    throw new CommandRejectedError("duplicate-group");
  }
  if (current.modifierGroups.some((group) => group.id === groupId)) {
    throw new CommandRejectedError("duplicate-group");
  }
  if (input.options.length === 0) {
    throw new CommandRejectedError("group-needs-option");
  }
  const options: ModifierOption[] = [];
  for (const option of input.options) {
    const optionLabel = optionName(option.name, options);
    if (options.some((existing) => existing.id === option.optionId)) {
      throw new CommandRejectedError("duplicate-option");
    }
    if (
      !Number.isSafeInteger(option.priceDeltaCents) ||
      option.priceDeltaCents < 0
    ) {
      throw new CommandRejectedError("invalid-option-price");
    }
    options.push({
      id: option.optionId,
      name: optionLabel,
      priceDeltaCents: option.priceDeltaCents,
      active: true,
    });
  }
  if (
    !Number.isSafeInteger(min) ||
    !Number.isSafeInteger(max) ||
    min < 0 ||
    min > max ||
    max < 1 ||
    max > options.length
  ) {
    throw new CommandRejectedError("invalid-group-limits");
  }
  if (
    defaultOptionId !== undefined &&
    !options.some((option) => option.id === defaultOptionId)
  ) {
    throw new CommandRejectedError("unknown-option");
  }
  return {
    ...meta,
    actor: structuredClone(meta.actor),
    events: [
      {
        type: "modifier-group-created",
        group: {
          id: groupId,
          name,
          min,
          max,
          ...(defaultOptionId !== undefined ? { defaultOptionId } : {}),
          options,
        },
      },
    ],
  };
}

export function setProductGroups(
  state: PosState,
  meta: CommandMeta,
  input: { productId: string; groupIds: string[] },
  base: Catalog,
): CommandBatch {
  if (!can(meta.actor.role, "edit-menu")) {
    throw new CommandRejectedError("not-allowed", "edit-menu");
  }
  const current = menuFor(base, state.menu);
  const { productId, groupIds } = input;
  if (!findProduct(current, productId)) {
    throw new CommandRejectedError("unknown-product");
  }
  const knownIds = new Set(current.modifierGroups.map((group) => group.id));
  if (groupIds.some((id) => !knownIds.has(id))) {
    throw new CommandRejectedError("unknown-modifier-group");
  }
  if (new Set(groupIds).size !== groupIds.length) {
    throw new CommandRejectedError("repeated-group");
  }
  return {
    ...meta,
    actor: structuredClone(meta.actor),
    events: [
      { type: "product-groups-set", productId, groupIds: [...groupIds] },
    ],
  };
}
