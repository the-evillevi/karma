import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
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
import { cn } from "@/lib/utils";
import type { Catalog, ModifierGroup } from "../../domain/catalog.ts";
import { findProduct } from "../../domain/catalog.ts";
import type {
  CommandBatch,
  CommandMeta,
  PosState,
} from "../../domain/journal.ts";
import {
  createProduct,
  suggestedSku,
  saveProductEdit,
} from "../../domain/menu.ts";
import type { MoveDirection } from "../../domain/menu.ts";
import { parsePesos } from "../../domain/money.ts";
import { catalog } from "../catalog.ts";
import { useCommand, useMenu } from "../context.tsx";
import { errorMessage } from "../errors.ts";
import { requirement } from "../station/ModifierDialog.tsx";
import { useToast } from "../toast.tsx";
import { MoveButtons, refocusMove } from "./MoveButtons.tsx";

type Command = (state: PosState, meta: CommandMeta) => CommandBatch;

export function editButtonId(productId: string): string {
  return `editar-${productId}`;
}

export function focusTarget(trigger: HTMLElement): HTMLElement | null {
  return trigger.isConnected ? trigger : document.getElementById(trigger.id);
}

export function useGuardedSave(onClose: () => void) {
  const run = useCommand();
  const notify = useToast();
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(command: Command, success: string) {
    if (busy) return;
    setBusy(true);
    try {
      await run(command);
      onClose();
      notify(success);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return { failure, busy, save };
}

export const nativeSelectClass = cn(
  "min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-primary bg-background px-3 py-2 text-base outline-none md:text-sm",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
);

function CategorySelect({
  id,
  menu,
  value,
  onChange,
}: {
  id: string;
  menu: Catalog;
  value: string;
  onChange: (categoryId: string) => void;
}) {
  const categories = [...menu.categories].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={nativeSelectClass}
    >
      <option value="">Elige una categoría</option>
      {categories.map((category) => (
        <option key={category.id} value={category.id}>
          {category.active === false
            ? `${category.name} (oculta)`
            : category.name}
        </option>
      ))}
    </select>
  );
}

export function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

export function ProductDialog({
  title,
  description,
  busy,
  failure,
  submitLabel,
  returnFocus,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  description: string;
  busy: boolean;
  failure: string;
  submitLabel: string;
  returnFocus: HTMLElement;
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) {
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-sm"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          focusTarget(returnFocus)?.focus();
        }}
      >
        <form onSubmit={submit} className="flex min-h-0 flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1 pb-1">
            {children}
          </div>
          {failure !== "" && (
            <p role="alert" className="text-sm font-medium">
              {failure}
            </p>
          )}
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
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NewProductDialog({
  returnFocus,
  onClose,
}: {
  returnFocus: HTMLElement;
  onClose: () => void;
}) {
  const menu = useMenu();
  const { failure, busy, save } = useGuardedSave(onClose);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [priceText, setPriceText] = useState("");
  const [skuText, setSkuText] = useState(() => suggestedSku(menu));

  function submit() {
    const input = {
      sku: skuText.trim(),
      name,
      categoryId,
      priceCents: parsePesos(priceText) ?? Number.NaN,
    };
    void save(
      (state, meta) => createProduct(state, meta, input, catalog),
      `Producto ${name.trim()} creado`,
    );
  }

  return (
    <ProductDialog
      title="Nuevo producto"
      description="Se agrega al menú y a la venta."
      busy={busy}
      failure={failure}
      submitLabel="Guardar producto"
      returnFocus={returnFocus}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field id="nuevo-nombre" label="Nombre">
        <Input
          id="nuevo-nombre"
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field id="nuevo-categoria" label="Categoría">
        <CategorySelect
          id="nuevo-categoria"
          menu={menu}
          value={categoryId}
          onChange={setCategoryId}
        />
      </Field>
      <Field id="nuevo-precio" label="Precio">
        <Input
          id="nuevo-precio"
          inputMode="decimal"
          autoComplete="off"
          value={priceText}
          onChange={(event) => setPriceText(event.target.value)}
          className="tabular-nums"
        />
      </Field>
      <Field id="nuevo-sku" label="SKU">
        <Input
          id="nuevo-sku"
          inputMode="numeric"
          autoComplete="off"
          value={skuText}
          onChange={(event) => setSkuText(event.target.value)}
          className="tabular-nums"
        />
      </Field>
    </ProductDialog>
  );
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function moved(ids: string[], groupId: string, direction: MoveDirection) {
  const from = ids.indexOf(groupId);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

function addGroupSelectId(productId: string): string {
  return `agregar-grupo-${productId}`;
}

function refocusById(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}

function ProductGroupsField({
  productId,
  assigned,
  available,
  onChange,
}: {
  productId: string;
  assigned: ModifierGroup[];
  available: ModifierGroup[];
  onChange: (groupIds: string[]) => void;
}) {
  const ids = assigned.map((group) => group.id);
  const selectId = addGroupSelectId(productId);
  const [picked, setPicked] = useState("");
  const choice = available.some((group) => group.id === picked) ? picked : "";

  function add() {
    if (choice === "") return;
    onChange([...ids, choice]);
    setPicked("");
    refocusById(selectId);
  }

  function move(groupId: string, direction: MoveDirection) {
    onChange(moved(ids, groupId, direction));
    refocusMove(`mover-grupo-${productId}-${groupId}`, direction);
  }

  function remove(groupId: string) {
    onChange(ids.filter((id) => id !== groupId));
    refocusById(selectId);
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">Modificadores</legend>
      {assigned.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin modificadores</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border">
          {assigned.map((group, index) => (
            <li
              key={group.id}
              aria-label={group.name}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1"
            >
              <div className="flex min-w-0 flex-1 flex-col py-1">
                <span className="text-sm font-medium">{group.name}</span>
                <span className="text-xs text-muted-foreground">
                  {requirement(group)}
                </span>
              </div>
              <MoveButtons
                idPrefix={`mover-grupo-${productId}-${group.id}`}
                label={group.name}
                isFirst={index === 0}
                isLast={index === assigned.length - 1}
                disabled={false}
                onMove={(direction) => move(group.id, direction)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11"
                aria-label={`Quitar ${group.name}`}
                onClick={() => remove(group.id)}
              >
                Quitar
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Field id={selectId} label="Agregar grupo">
        <div className="flex gap-2">
          <select
            id={selectId}
            value={choice}
            onChange={(event) => setPicked(event.target.value)}
            className={nativeSelectClass}
          >
            <option value="">Elige un grupo</option>
            {available.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 shrink-0"
            disabled={choice === ""}
            onClick={add}
          >
            Agregar
          </Button>
        </div>
      </Field>
    </fieldset>
  );
}

export function EditProductDialog({
  productId,
  returnFocus,
  onClose,
}: {
  productId: string;
  returnFocus: HTMLElement;
  onClose: () => void;
}) {
  const menu = useMenu();
  const product = findProduct(menu, productId);
  const { failure, busy, save } = useGuardedSave(onClose);
  const [nameDraft, setName] = useState<string | null>(null);
  const [categoryDraft, setCategoryId] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState<string[] | null>(null);

  if (!product) return null;
  const name = nameDraft ?? product.name;
  const categoryId = categoryDraft ?? product.categoryId;
  const groupsById = new Map(
    menu.modifierGroups.map((group) => [group.id, group]),
  );
  const exists = (groupId: string) => groupsById.has(groupId);
  const live = product.modifierGroupIds.filter(exists);
  const shownIds = (groupDraft ?? live).filter(exists);
  const assigned = shownIds.flatMap((groupId) => {
    const group = groupsById.get(groupId);
    return group ? [group] : [];
  });
  const available = menu.modifierGroups.filter(
    (group) => !shownIds.includes(group.id),
  );

  function submit() {
    const changes = {
      ...(nameDraft !== null ? { name: nameDraft } : {}),
      ...(categoryDraft !== null ? { categoryId: categoryDraft } : {}),
      ...(!sameOrder(shownIds, live) ? { groupIds: shownIds } : {}),
    };
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    const edit = { productId, ...changes };
    void save(
      (state, meta) => saveProductEdit(state, meta, edit, catalog),
      "Cambios guardados",
    );
  }

  return (
    <ProductDialog
      title="Editar producto"
      description={product.name}
      busy={busy}
      failure={failure}
      submitLabel="Guardar cambios"
      returnFocus={returnFocus}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field id={`editar-nombre-${productId}`} label="Nombre">
        <Input
          id={`editar-nombre-${productId}`}
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field id={`editar-categoria-${productId}`} label="Categoría">
        <CategorySelect
          id={`editar-categoria-${productId}`}
          menu={menu}
          value={categoryId}
          onChange={setCategoryId}
        />
      </Field>
      <ProductGroupsField
        productId={productId}
        assigned={assigned}
        available={available}
        onChange={setGroupDraft}
      />
      <p className="text-sm text-muted-foreground tabular-nums">
        {`SKU ${product.sku}`}
      </p>
    </ProductDialog>
  );
}
