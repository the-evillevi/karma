import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { can } from "../../domain/access.ts";
import type {
  Category,
  ModifierGroup,
  ModifierOption,
  Product,
} from "../../domain/catalog.ts";
import { productsInCategory } from "../../domain/catalog.ts";
import type {
  CommandBatch,
  CommandMeta,
  PosState,
} from "../../domain/journal.ts";
import {
  editLabel,
  lastEdit,
  moveCategory,
  moveProduct,
  setProductAvailability,
  updateCategory,
  updateModifierOption,
  updateProduct,
} from "../../domain/menu.ts";
import type { MoveDirection } from "../../domain/menu.ts";
import { formatMXN } from "../../domain/money.ts";
import { catalog } from "../catalog.ts";
import { useCommand, useMenu, usePosState, useSession } from "../context.tsx";
import { errorMessage } from "../errors.ts";
import {
  NewCategoryDialog,
  RenameCategoryDialog,
  newCategoryButtonId,
  renameCategoryButtonId,
} from "../menu/CategoryDialogs.tsx";
import {
  EditProductDialog,
  NewProductDialog,
  editButtonId,
  focusTarget,
} from "../menu/ProductDialogs.tsx";
import { NewGroupDialog } from "../menu/GroupDialogs.tsx";
import { ModifierGroupsView } from "../menu/ModifierGroupsView.tsx";
import { MoveButtons, refocusMove } from "../menu/MoveButtons.tsx";
import { EditOptionDialog, NewOptionDialog } from "../menu/OptionDialogs.tsx";
import { normalize } from "../station/ProductGrid.tsx";
import { useToast } from "../toast.tsx";

type OpenDialog =
  | { kind: "new"; trigger: HTMLElement }
  | { kind: "edit"; productId: string; trigger: HTMLElement }
  | { kind: "new-category"; trigger: HTMLElement }
  | { kind: "new-group"; trigger: HTMLElement }
  | { kind: "rename-category"; categoryId: string; trigger: HTMLElement }
  | { kind: "new-option"; groupId: string; trigger: HTMLElement }
  | {
      kind: "edit-option";
      groupId: string;
      optionId: string;
      trigger: HTMLElement;
    };

type MenuTab = "productos" | "modificadores";

const menuTabs: { id: MenuTab; label: string }[] = [
  { id: "productos", label: "Productos" },
  { id: "modificadores", label: "Modificadores" },
];

function tabId(tab: MenuTab): string {
  return `menu-pestana-${tab}`;
}

function MenuTabs({
  selected,
  onSelect,
}: {
  selected: MenuTab;
  onSelect: (tab: MenuTab) => void;
}) {
  function selectAndFocus(tab: MenuTab) {
    onSelect(tab);
    document.getElementById(tabId(tab))?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label="Secciones del menú"
      className="flex gap-1 self-start rounded-[var(--radius-button)] border border-border bg-card p-1"
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const index = menuTabs.findIndex((tab) => tab.id === selected);
        const step = event.key === "ArrowRight" ? 1 : -1;
        const next =
          menuTabs[(index + step + menuTabs.length) % menuTabs.length];
        selectAndFocus(next.id);
      }}
    >
      {menuTabs.map((tab) => {
        const isSelected = tab.id === selected;
        return (
          <Button
            key={tab.id}
            type="button"
            role="tab"
            id={tabId(tab.id)}
            aria-selected={isSelected}
            aria-controls="menu-pestana-panel"
            tabIndex={isSelected ? 0 : -1}
            variant={isSelected ? "default" : "ghost"}
            className="min-h-11"
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
          </Button>
        );
      })}
    </div>
  );
}

type MenuCommand = (state: PosState, meta: CommandMeta) => CommandBatch;

export function Menu() {
  const state = usePosState();
  const menu = useMenu();
  const run = useCommand();
  const notify = useToast();
  const { user } = useSession();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<OpenDialog | null>(null);
  const [pending, setPending] = useState(false);
  const [tab, setTab] = useState<MenuTab>("productos");
  const running = useRef(false);
  const role = user?.role ?? "";
  const mayEditMenu = can(role, "edit-menu");
  const mayToggle = can(role, "set-availability");

  const needle = normalize(query.trim());
  const categories = [...menu.categories].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  const sections = categories
    .map((category, index) => {
      const all = productsInCategory(menu, category.id);
      return {
        category,
        isFirst: index === 0,
        isLast: index === categories.length - 1,
        firstId: all.at(0)?.id,
        lastId: all.at(-1)?.id,
        products: all.filter((product) =>
          normalize(product.name).includes(needle),
        ),
      };
    })
    .filter((section) => needle === "" || section.products.length > 0);

  async function runCommand(command: MenuCommand, afterwards?: () => void) {
    if (running.current) return;
    running.current = true;
    setPending(true);
    try {
      await run(command);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      running.current = false;
      setPending(false);
      afterwards?.();
    }
  }

  function toggle(product: Product, available: boolean) {
    return runCommand((current, meta) =>
      setProductAvailability(
        current,
        meta,
        { productId: product.id, available },
        catalog,
      ),
    );
  }

  function toggleVisibility(product: Product) {
    return runCommand((current, meta) =>
      updateProduct(
        current,
        meta,
        { productId: product.id, active: !product.active },
        catalog,
      ),
    );
  }

  function toggleCategory(category: Category) {
    return runCommand((current, meta) =>
      updateCategory(
        current,
        meta,
        { categoryId: category.id, active: category.active === false },
        catalog,
      ),
    );
  }

  function shiftCategory(category: Category, direction: MoveDirection) {
    return runCommand(
      (current, meta) =>
        moveCategory(
          current,
          meta,
          { categoryId: category.id, direction },
          catalog,
        ),
      () => refocusMove(`mover-categoria-${category.id}`, direction),
    );
  }

  function shiftProduct(product: Product, direction: MoveDirection) {
    return runCommand(
      (current, meta) =>
        moveProduct(
          current,
          meta,
          { productId: product.id, direction },
          catalog,
        ),
      () => refocusMove(`mover-producto-${product.id}`, direction),
    );
  }

  function toggleOption(group: ModifierGroup, option: ModifierOption) {
    return runCommand((current, meta) =>
      updateModifierOption(
        current,
        meta,
        {
          groupId: group.id,
          optionId: option.id,
          active: option.active === false,
        },
        catalog,
      ),
    );
  }

  function close() {
    if (open) focusTarget(open.trigger)?.focus();
    setOpen(null);
  }

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-4 overflow-y-auto p-4">
      <h1 className="text-xl font-medium">Menú</h1>
      {mayEditMenu && <MenuTabs selected={tab} onSelect={setTab} />}
      <div
        id="menu-pestana-panel"
        role={mayEditMenu ? "tabpanel" : undefined}
        aria-labelledby={mayEditMenu ? tabId(tab) : undefined}
        className="flex flex-col gap-4"
      >
        {mayEditMenu && tab === "modificadores" ? (
          <ModifierGroupsView
            pending={pending}
            onNewGroup={(trigger) => setOpen({ kind: "new-group", trigger })}
            onAdd={(group, trigger) =>
              setOpen({ kind: "new-option", groupId: group.id, trigger })
            }
            onEdit={(group, option, trigger) =>
              setOpen({
                kind: "edit-option",
                groupId: group.id,
                optionId: option.id,
                trigger,
              })
            }
            onToggle={toggleOption}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="search"
                inputMode="search"
                aria-label="Buscar producto"
                placeholder="Buscar producto"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="min-w-48 flex-1 bg-card"
              />
              {mayEditMenu && (
                <Button
                  className="min-h-11 shrink-0"
                  onClick={(event) =>
                    setOpen({ kind: "new", trigger: event.currentTarget })
                  }
                >
                  Nuevo producto
                </Button>
              )}
              {mayEditMenu && (
                <Button
                  variant="outline"
                  className="min-h-11 shrink-0"
                  id={newCategoryButtonId}
                  onClick={(event) =>
                    setOpen({
                      kind: "new-category",
                      trigger: event.currentTarget,
                    })
                  }
                >
                  Nueva categoría
                </Button>
              )}
            </div>

            {sections.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Ningún producto coincide con «{query.trim()}».
              </p>
            ) : (
              sections.map(
                ({ category, isFirst, isLast, firstId, lastId, products }) => {
                  const headingId = `menu-categoria-${category.id}`;
                  const hidden = category.active === false;
                  return (
                    <section
                      key={category.id}
                      aria-labelledby={headingId}
                      className="flex flex-col gap-2"
                    >
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                          <h2 id={headingId} className="text-base font-medium">
                            {category.name}
                          </h2>
                          {hidden && <Badge variant="outline">Oculta</Badge>}
                        </div>
                        {mayEditMenu && (
                          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="min-h-11"
                              id={renameCategoryButtonId(category.id)}
                              aria-label={`Renombrar categoría ${category.name}`}
                              onClick={(event) =>
                                setOpen({
                                  kind: "rename-category",
                                  categoryId: category.id,
                                  trigger: event.currentTarget,
                                })
                              }
                            >
                              Renombrar
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="min-h-11"
                              aria-label={`${hidden ? "Mostrar" : "Ocultar"} categoría ${category.name}`}
                              disabled={pending}
                              onClick={() => toggleCategory(category)}
                            >
                              {hidden ? "Mostrar" : "Ocultar"}
                            </Button>
                            <MoveButtons
                              idPrefix={`mover-categoria-${category.id}`}
                              label={`categoría ${category.name}`}
                              isFirst={isFirst}
                              isLast={isLast}
                              disabled={pending}
                              onMove={(direction) =>
                                shiftCategory(category, direction)
                              }
                            />
                          </div>
                        )}
                      </div>
                      {products.length === 0 ? (
                        <p className="rounded-[var(--radius-card)] border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                          Sin productos
                        </p>
                      ) : (
                        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-card">
                          {products.map((product) => {
                            const edit = lastEdit(state.menu, product.id);
                            return (
                              <li
                                key={product.id}
                                aria-label={product.name}
                                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2"
                              >
                                <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
                                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                                    <span className="min-w-0">
                                      {product.name}
                                    </span>
                                    {!product.available && (
                                      <Badge variant="secondary">Agotado</Badge>
                                    )}
                                    {!product.active && (
                                      <Badge variant="outline">Oculto</Badge>
                                    )}
                                  </p>
                                  <p className="text-xs text-muted-foreground tabular-nums">
                                    {`SKU ${product.sku}`}
                                  </p>
                                  {edit && (
                                    <p className="text-xs text-muted-foreground">
                                      {editLabel(edit)}
                                    </p>
                                  )}
                                </div>
                                <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
                                  <p className="text-right text-sm font-medium tabular-nums">
                                    {formatMXN(product.priceCents)}
                                  </p>
                                  {mayEditMenu && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="min-h-11"
                                      id={editButtonId(product.id)}
                                      aria-label={`Editar ${product.name}`}
                                      onClick={(event) =>
                                        setOpen({
                                          kind: "edit",
                                          productId: product.id,
                                          trigger: event.currentTarget,
                                        })
                                      }
                                    >
                                      Editar
                                    </Button>
                                  )}
                                  {mayEditMenu && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="min-h-11"
                                      aria-label={`${product.active ? "Ocultar" : "Mostrar"} ${product.name}`}
                                      disabled={pending}
                                      onClick={() => toggleVisibility(product)}
                                    >
                                      {product.active ? "Ocultar" : "Mostrar"}
                                    </Button>
                                  )}
                                  {mayEditMenu && (
                                    <MoveButtons
                                      idPrefix={`mover-producto-${product.id}`}
                                      label={product.name}
                                      isFirst={product.id === firstId}
                                      isLast={product.id === lastId}
                                      disabled={pending}
                                      onMove={(direction) =>
                                        shiftProduct(product, direction)
                                      }
                                    />
                                  )}
                                  {mayToggle && (
                                    <label className="flex min-h-11 min-w-11 items-center justify-center">
                                      <Switch
                                        aria-label="Disponible"
                                        checked={product.available}
                                        disabled={pending}
                                        onCheckedChange={(next) =>
                                          toggle(product, next)
                                        }
                                      />
                                    </label>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </section>
                  );
                },
              )
            )}
          </>
        )}
      </div>

      {open?.kind === "new" && (
        <NewProductDialog returnFocus={open.trigger} onClose={close} />
      )}
      {open?.kind === "edit" && (
        <EditProductDialog
          key={open.productId}
          productId={open.productId}
          returnFocus={open.trigger}
          onClose={close}
        />
      )}
      {open?.kind === "new-category" && (
        <NewCategoryDialog returnFocus={open.trigger} onClose={close} />
      )}
      {open?.kind === "new-group" && (
        <NewGroupDialog returnFocus={open.trigger} onClose={close} />
      )}
      {open?.kind === "rename-category" && (
        <RenameCategoryDialog
          key={open.categoryId}
          categoryId={open.categoryId}
          returnFocus={open.trigger}
          onClose={close}
        />
      )}
      {open?.kind === "new-option" && (
        <NewOptionDialog
          key={open.groupId}
          groupId={open.groupId}
          returnFocus={open.trigger}
          onClose={close}
        />
      )}
      {open?.kind === "edit-option" && (
        <EditOptionDialog
          key={`${open.groupId}-${open.optionId}`}
          groupId={open.groupId}
          optionId={open.optionId}
          returnFocus={open.trigger}
          onClose={close}
        />
      )}
    </section>
  );
}
