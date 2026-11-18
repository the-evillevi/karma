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
import type { Catalog } from "../../domain/catalog.ts";
import { findProduct } from "../../domain/catalog.ts";
import type {
  CommandBatch,
  CommandMeta,
  PosState,
} from "../../domain/journal.ts";
import {
  createProduct,
  suggestedSku,
  updateProduct,
} from "../../domain/menu.ts";
import { parsePesos } from "../../domain/money.ts";
import { catalog } from "../catalog.ts";
import { useCommand, useMenu } from "../context.tsx";
import { errorMessage } from "../errors.ts";
import { useToast } from "../toast.tsx";

type Command = (state: PosState, meta: CommandMeta) => CommandBatch;

export function editButtonId(productId: string): string {
  return `editar-${productId}`;
}

export function focusTarget(trigger: HTMLElement): HTMLElement | null {
  return trigger.isConnected ? trigger : document.getElementById(trigger.id);
}

function useGuardedSave(onClose: () => void) {
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
      className={cn(
        "min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-primary bg-background px-3 py-2 text-base outline-none md:text-sm",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      <option value="">Elige una categoría</option>
      {categories.map((category) => (
        <option key={category.id} value={category.id}>
          {category.name}
        </option>
      ))}
    </select>
  );
}

function Field({
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

function ProductDialog({
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
        className="sm:max-w-sm"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          focusTarget(returnFocus)?.focus();
        }}
      >
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
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

  if (!product) return null;
  const name = nameDraft ?? product.name;
  const categoryId = categoryDraft ?? product.categoryId;

  function submit() {
    const edit = {
      productId,
      ...(nameDraft !== null ? { name: nameDraft } : {}),
      ...(categoryDraft !== null ? { categoryId: categoryDraft } : {}),
    };
    void save(
      (state, meta) => updateProduct(state, meta, edit, catalog),
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
      <p className="text-sm text-muted-foreground tabular-nums">
        {`SKU ${product.sku}`}
      </p>
    </ProductDialog>
  );
}
