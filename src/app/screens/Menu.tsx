import { useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { can } from "../../domain/access.ts";
import type { Category, Product } from "../../domain/catalog.ts";
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
  setProductPrice,
  updateCategory,
  updateProduct,
} from "../../domain/menu.ts";
import type { MoveDirection } from "../../domain/menu.ts";
import { formatMXN, parsePesos } from "../../domain/money.ts";
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
import { normalize } from "../station/ProductGrid.tsx";
import { useToast } from "../toast.tsx";

type OpenDialog =
  | { kind: "price"; product: Product; trigger: HTMLElement }
  | { kind: "new"; trigger: HTMLElement }
  | { kind: "edit"; productId: string; trigger: HTMLElement }
  | { kind: "new-category"; trigger: HTMLElement }
  | { kind: "rename-category"; categoryId: string; trigger: HTMLElement };

type MenuCommand = (state: PosState, meta: CommandMeta) => CommandBatch;

function pesosText(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function PriceDialog({
  product,
  returnFocus,
  onClose,
}: {
  product: Product;
  returnFocus: HTMLElement;
  onClose: () => void;
}) {
  const run = useCommand();
  const notify = useToast();
  const [text, setText] = useState(pesosText(product.priceCents));
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const inputId = `precio-${product.id}`;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const priceCents = parsePesos(text) ?? Number.NaN;
    setBusy(true);
    try {
      await run((state, meta) =>
        setProductPrice(
          state,
          meta,
          { productId: product.id, priceCents },
          catalog,
        ),
      );
      onClose();
      notify(`Precio de ${product.name}: ${formatMXN(priceCents)}`);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        className="sm:max-w-sm"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus.focus();
        }}
      >
        <form onSubmit={save} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Cambiar precio</DialogTitle>
            <DialogDescription>{product.name}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor={inputId}>Precio de {product.name}</Label>
            <Input
              id={inputId}
              inputMode="decimal"
              autoComplete="off"
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="tabular-nums"
            />
            {failure !== "" && (
              <p role="alert" className="text-sm font-medium">
                {failure}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              Guardar precio
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function moveButtonId(idPrefix: string, direction: MoveDirection): string {
  return `${idPrefix}-${direction}`;
}

function refocusMove(idPrefix: string, direction: MoveDirection) {
  requestAnimationFrame(() => {
    const same = document.getElementById(moveButtonId(idPrefix, direction));
    const other = document.getElementById(
      moveButtonId(idPrefix, direction === "up" ? "down" : "up"),
    );
    const target =
      same instanceof HTMLButtonElement && !same.disabled ? same : other;
    target?.focus();
  });
}

function MoveButtons({
  idPrefix,
  label,
  isFirst,
  isLast,
  disabled,
  onMove,
}: {
  idPrefix: string;
  label: string;
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  onMove: (direction: MoveDirection) => void;
}) {
  return (
    <span className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon"
        id={moveButtonId(idPrefix, "up")}
        aria-label={`Subir ${label}`}
        disabled={disabled || isFirst}
        onClick={() => onMove("up")}
      >
        <ChevronUp aria-hidden="true" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        id={moveButtonId(idPrefix, "down")}
        aria-label={`Bajar ${label}`}
        disabled={disabled || isLast}
        onClick={() => onMove("down")}
      >
        <ChevronDown aria-hidden="true" />
      </Button>
    </span>
  );
}

export function Menu() {
  const state = usePosState();
  const menu = useMenu();
  const run = useCommand();
  const notify = useToast();
  const { user } = useSession();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<OpenDialog | null>(null);
  const [pending, setPending] = useState(false);
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

  function close() {
    if (open) focusTarget(open.trigger)?.focus();
    setOpen(null);
  }

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-4 overflow-y-auto p-4">
      <h1 className="text-xl font-medium">Menú</h1>
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
              setOpen({ kind: "new-category", trigger: event.currentTarget })
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
                              <span className="min-w-0">{product.name}</span>
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
                                aria-label={`Cambiar precio de ${product.name}`}
                                onClick={(event) =>
                                  setOpen({
                                    kind: "price",
                                    product,
                                    trigger: event.currentTarget,
                                  })
                                }
                              >
                                Cambiar precio
                              </Button>
                            )}
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

      {open?.kind === "price" && (
        <PriceDialog
          key={open.product.id}
          product={open.product}
          returnFocus={open.trigger}
          onClose={close}
        />
      )}
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
      {open?.kind === "rename-category" && (
        <RenameCategoryDialog
          key={open.categoryId}
          categoryId={open.categoryId}
          returnFocus={open.trigger}
          onClose={close}
        />
      )}
    </section>
  );
}
