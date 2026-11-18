import { useState } from "react";
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
import type { Product } from "../../domain/catalog.ts";
import {
  editLabel,
  lastEdit,
  setProductAvailability,
  setProductPrice,
} from "../../domain/menu.ts";
import { formatMXN, parsePesos } from "../../domain/money.ts";
import { catalog } from "../catalog.ts";
import { useCommand, useMenu, usePosState, useSession } from "../context.tsx";
import { errorMessage } from "../errors.ts";
import { normalize } from "../station/ProductGrid.tsx";
import { useToast } from "../toast.tsx";

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

export function Menu() {
  const state = usePosState();
  const menu = useMenu();
  const run = useCommand();
  const notify = useToast();
  const { user } = useSession();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{
    product: Product;
    trigger: HTMLElement;
  } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const role = user?.role ?? "";
  const mayEditPrice = can(role, "edit-menu");
  const mayToggle = can(role, "set-availability");

  const needle = normalize(query.trim());
  const sections = [...menu.categories]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((category) => ({
      category,
      products: menu.products.filter(
        (product) =>
          product.categoryId === category.id &&
          normalize(product.name).includes(needle),
      ),
    }))
    .filter((section) => section.products.length > 0);

  async function toggle(product: Product, available: boolean) {
    if (pending !== null) return;
    setPending(product.id);
    try {
      await run((current, meta) =>
        setProductAvailability(
          current,
          meta,
          { productId: product.id, available },
          catalog,
        ),
      );
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-4 overflow-y-auto p-4">
      <h1 className="text-xl font-medium">Menú</h1>
      <Input
        type="search"
        inputMode="search"
        aria-label="Buscar producto"
        placeholder="Buscar producto"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="bg-card"
      />

      {sections.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Ningún producto coincide con «{query.trim()}».
        </p>
      ) : (
        sections.map(({ category, products }) => {
          const headingId = `menu-categoria-${category.id}`;
          return (
            <section
              key={category.id}
              aria-labelledby={headingId}
              className="flex flex-col gap-2"
            >
              <h2 id={headingId} className="text-base font-medium">
                {category.name}
              </h2>
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
                        </p>
                        {edit && (
                          <p className="text-xs text-muted-foreground">
                            {editLabel(edit)}
                          </p>
                        )}
                      </div>
                      <div className="ml-auto flex items-center gap-3">
                        <p className="text-right text-sm font-medium tabular-nums">
                          {formatMXN(product.priceCents)}
                        </p>
                        {mayEditPrice && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-h-11"
                            aria-label={`Cambiar precio de ${product.name}`}
                            onClick={(event) =>
                              setEditing({
                                product,
                                trigger: event.currentTarget,
                              })
                            }
                          >
                            Cambiar precio
                          </Button>
                        )}
                        {mayToggle && (
                          <label className="flex min-h-11 min-w-11 items-center justify-center">
                            <Switch
                              aria-label="Disponible"
                              checked={product.available}
                              disabled={pending !== null}
                              onCheckedChange={(next) => toggle(product, next)}
                            />
                          </label>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}

      {editing && (
        <PriceDialog
          key={editing.product.id}
          product={editing.product}
          returnFocus={editing.trigger}
          onClose={() => {
            editing.trigger.focus();
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}
