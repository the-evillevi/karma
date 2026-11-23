import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createModifierGroup } from "../../domain/menu.ts";
import { parsePesos } from "../../domain/money.ts";
import { catalog } from "../catalog.ts";
import { newId } from "../ids.ts";
import {
  Field,
  ProductDialog,
  nativeSelectClass,
  useGuardedSave,
} from "./ProductDialogs.tsx";

type OptionRow = { id: string; name: string; priceText: string };

function newRow(): OptionRow {
  return { id: newId(), name: "", priceText: "0.00" };
}

function parseCount(text: string): number {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

function rowLabel(row: OptionRow, position: number): string {
  const name = row.name.trim();
  return name === "" ? `Opción ${position}` : name;
}

export function NewGroupDialog({
  returnFocus,
  onClose,
}: {
  returnFocus: HTMLElement;
  onClose: () => void;
}) {
  const { failure, busy, save } = useGuardedSave(onClose);
  const [groupId] = useState(newId);
  const [name, setName] = useState("");
  const [minText, setMinText] = useState("0");
  const [maxText, setMaxText] = useState("1");
  const [rows, setRows] = useState<OptionRow[]>(() => [newRow()]);
  const [chosenDefault, setChosenDefault] = useState("");
  const defaultOptionId = rows.some((row) => row.id === chosenDefault)
    ? chosenDefault
    : "";

  function changeRow(id: string, change: Partial<OptionRow>) {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...change } : row)),
    );
  }

  function removeRow(id: string) {
    setRows((current) => current.filter((row) => row.id !== id));
  }

  function addRow() {
    setRows((current) => [...current, newRow()]);
  }

  function submit() {
    const input = {
      groupId,
      name,
      min: parseCount(minText),
      max: parseCount(maxText),
      ...(defaultOptionId !== "" ? { defaultOptionId } : {}),
      options: rows.map((row) => ({
        optionId: row.id,
        name: row.name,
        priceDeltaCents: parsePesos(row.priceText) ?? Number.NaN,
      })),
    };
    void save(
      (state, meta) => createModifierGroup(state, meta, input, catalog),
      `Grupo ${name.trim()} creado`,
    );
  }

  return (
    <ProductDialog
      title="Nuevo grupo"
      description="Se agrega al final de Modificadores."
      busy={busy}
      failure={failure}
      submitLabel="Guardar grupo"
      returnFocus={returnFocus}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field id="nuevo-grupo-nombre" label="Nombre">
        <Input
          id="nuevo-grupo-nombre"
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="nuevo-grupo-minimo" label="Mínimo">
          <Input
            id="nuevo-grupo-minimo"
            inputMode="numeric"
            autoComplete="off"
            value={minText}
            onChange={(event) => setMinText(event.target.value)}
            className="tabular-nums"
          />
        </Field>
        <Field id="nuevo-grupo-maximo" label="Máximo">
          <Input
            id="nuevo-grupo-maximo"
            inputMode="numeric"
            autoComplete="off"
            value={maxText}
            onChange={(event) => setMaxText(event.target.value)}
            className="tabular-nums"
          />
        </Field>
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3">
          {rows.map((row, index) => {
            const position = index + 1;
            const nameId = `nuevo-grupo-opcion-${row.id}-nombre`;
            const priceId = `nuevo-grupo-opcion-${row.id}-precio`;
            return (
              <div
                key={row.id}
                className="grid grid-cols-[minmax(0,1fr)_6rem_auto] items-end gap-2"
              >
                <Field id={nameId} label={`Nombre de la opción ${position}`}>
                  <Input
                    id={nameId}
                    autoComplete="off"
                    value={row.name}
                    onChange={(event) =>
                      changeRow(row.id, { name: event.target.value })
                    }
                  />
                </Field>
                <Field id={priceId} label={`Precio de la opción ${position}`}>
                  <Input
                    id={priceId}
                    inputMode="decimal"
                    autoComplete="off"
                    value={row.priceText}
                    onChange={(event) =>
                      changeRow(row.id, { priceText: event.target.value })
                    }
                    className="tabular-nums"
                  />
                </Field>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="min-h-11 min-w-11"
                  aria-label={`Quitar opción ${position}`}
                  onClick={() => removeRow(row.id)}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            );
          })}
        </div>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 self-start"
          onClick={addRow}
        >
          Agregar opción
        </Button>
      </div>
      <Field id="nuevo-grupo-defecto" label="Opción por defecto">
        <select
          id="nuevo-grupo-defecto"
          value={defaultOptionId}
          onChange={(event) => setChosenDefault(event.target.value)}
          className={nativeSelectClass}
        >
          <option value="">Sin opción por defecto</option>
          {rows.map((row, index) => (
            <option key={row.id} value={row.id}>
              {rowLabel(row, index + 1)}
            </option>
          ))}
        </select>
      </Field>
    </ProductDialog>
  );
}
