import { useState } from "react";
import { Input } from "@/components/ui/input";
import { createCategory, updateCategory } from "../../domain/menu.ts";
import { catalog } from "../catalog.ts";
import { useMenu } from "../context.tsx";
import { newId } from "../ids.ts";
import { Field, ProductDialog, useGuardedSave } from "./ProductDialogs.tsx";

export const newCategoryButtonId = "nueva-categoria";

export function renameCategoryButtonId(categoryId: string): string {
  return `renombrar-categoria-${categoryId}`;
}

export function NewCategoryDialog({
  returnFocus,
  onClose,
}: {
  returnFocus: HTMLElement;
  onClose: () => void;
}) {
  const { failure, busy, save } = useGuardedSave(onClose);
  const [name, setName] = useState("");

  function submit() {
    const input = { categoryId: newId(), name };
    void save(
      (state, meta) => createCategory(state, meta, input, catalog),
      `Categoría ${name.trim()} creada`,
    );
  }

  return (
    <ProductDialog
      title="Nueva categoría"
      description="Se agrega al final del menú y de la venta."
      busy={busy}
      failure={failure}
      submitLabel="Guardar categoría"
      returnFocus={returnFocus}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field id="nueva-categoria-nombre" label="Nombre">
        <Input
          id="nueva-categoria-nombre"
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
    </ProductDialog>
  );
}

export function RenameCategoryDialog({
  categoryId,
  returnFocus,
  onClose,
}: {
  categoryId: string;
  returnFocus: HTMLElement;
  onClose: () => void;
}) {
  const menu = useMenu();
  const category = menu.categories.find((item) => item.id === categoryId);
  const { failure, busy, save } = useGuardedSave(onClose);
  const [nameDraft, setName] = useState<string | null>(null);

  if (!category) return null;
  const name = nameDraft ?? category.name;

  function submit() {
    if (nameDraft === null) {
      onClose();
      return;
    }
    const edit = { categoryId, name: nameDraft };
    void save(
      (state, meta) => updateCategory(state, meta, edit, catalog),
      "Cambios guardados",
    );
  }

  return (
    <ProductDialog
      title="Renombrar categoría"
      description={category.name}
      busy={busy}
      failure={failure}
      submitLabel="Guardar cambios"
      returnFocus={returnFocus}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field id={`renombrar-categoria-nombre-${categoryId}`} label="Nombre">
        <Input
          id={`renombrar-categoria-nombre-${categoryId}`}
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
    </ProductDialog>
  );
}
