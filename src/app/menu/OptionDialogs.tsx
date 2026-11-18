import { useState } from "react";
import { Input } from "@/components/ui/input";
import { addModifierOption, updateModifierOption } from "../../domain/menu.ts";
import { parsePesos } from "../../domain/money.ts";
import { catalog } from "../catalog.ts";
import { useMenu } from "../context.tsx";
import { newId } from "../ids.ts";
import { Field, ProductDialog, useGuardedSave } from "./ProductDialogs.tsx";

export function pesosText(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function editOptionButtonId(groupId: string, optionId: string): string {
  return `editar-opcion-${groupId}-${optionId}`;
}

export function addOptionButtonId(groupId: string): string {
  return `agregar-opcion-${groupId}`;
}

export function NewOptionDialog({
  groupId,
  returnFocus,
  onClose,
}: {
  groupId: string;
  returnFocus: HTMLElement;
  onClose: () => void;
}) {
  const menu = useMenu();
  const group = menu.modifierGroups.find((item) => item.id === groupId);
  const { failure, busy, save } = useGuardedSave(onClose);
  const [name, setName] = useState("");
  const [priceText, setPriceText] = useState("");

  if (!group) return null;

  function submit() {
    const input = {
      groupId,
      optionId: newId(),
      name,
      priceDeltaCents: parsePesos(priceText) ?? Number.NaN,
    };
    void save(
      (state, meta) => addModifierOption(state, meta, input, catalog),
      `Opción ${name.trim()} agregada`,
    );
  }

  return (
    <ProductDialog
      title="Nueva opción"
      description={group.name}
      busy={busy}
      failure={failure}
      submitLabel="Guardar opción"
      returnFocus={returnFocus}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field id={`nueva-opcion-nombre-${groupId}`} label="Nombre">
        <Input
          id={`nueva-opcion-nombre-${groupId}`}
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field id={`nueva-opcion-precio-${groupId}`} label="Precio">
        <Input
          id={`nueva-opcion-precio-${groupId}`}
          inputMode="decimal"
          autoComplete="off"
          value={priceText}
          onChange={(event) => setPriceText(event.target.value)}
          className="tabular-nums"
        />
      </Field>
    </ProductDialog>
  );
}

export function EditOptionDialog({
  groupId,
  optionId,
  returnFocus,
  onClose,
}: {
  groupId: string;
  optionId: string;
  returnFocus: HTMLElement;
  onClose: () => void;
}) {
  const menu = useMenu();
  const option = menu.modifierGroups
    .find((group) => group.id === groupId)
    ?.options.find((item) => item.id === optionId);
  const { failure, busy, save } = useGuardedSave(onClose);
  const [nameDraft, setName] = useState<string | null>(null);
  const [priceDraft, setPriceText] = useState<string | null>(null);

  if (!option) return null;
  const name = nameDraft ?? option.name;
  const priceText = priceDraft ?? pesosText(option.priceDeltaCents);
  const fieldId = `${groupId}-${optionId}`;

  function submit() {
    if (nameDraft === null && priceDraft === null) {
      onClose();
      return;
    }
    const edit = {
      groupId,
      optionId,
      ...(nameDraft !== null ? { name: nameDraft } : {}),
      ...(priceDraft !== null
        ? { priceDeltaCents: parsePesos(priceDraft) ?? Number.NaN }
        : {}),
    };
    void save(
      (state, meta) => updateModifierOption(state, meta, edit, catalog),
      "Cambios guardados",
    );
  }

  return (
    <ProductDialog
      title="Editar opción"
      description={option.name}
      busy={busy}
      failure={failure}
      submitLabel="Guardar cambios"
      returnFocus={returnFocus}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field id={`editar-opcion-nombre-${fieldId}`} label="Nombre">
        <Input
          id={`editar-opcion-nombre-${fieldId}`}
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field id={`editar-opcion-precio-${fieldId}`} label="Precio">
        <Input
          id={`editar-opcion-precio-${fieldId}`}
          inputMode="decimal"
          autoComplete="off"
          value={priceText}
          onChange={(event) => setPriceText(event.target.value)}
          className="tabular-nums"
        />
      </Field>
    </ProductDialog>
  );
}
