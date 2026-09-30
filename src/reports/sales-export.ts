import {
  adaptPosStateToCompatibleSnapshot,
  type PosCompatibleSnapshotInput,
} from "../offline-sync/pos-compatible-snapshot.ts";

/** Local recorded evidence only. No upload receipt or historical date is inferred. */
export interface SalesExportOptions extends PosCompatibleSnapshotInput {
  timeZone: string;
  selectionLabel: string;
}

const headers = [
  "Registro",
  "Folio",
  "Referencia",
  "Fecha original registrada",
  "Fecha UTC registrada",
  "Fecha sucursal",
  "Zona horaria",
  "Moneda",
  "Total ticket MXN (incluye propina)",
  "Propina de venta MXN",
  "Método",
  "Pago neto MXN",
  "Efectivo recibido MXN",
  "Cambio MXN",
  "Devolución MXN",
  "Usuario",
  "Estado",
  "Evidencia",
  "Motivo registrado",
  "Pago de origen",
  "Asignación a pagos capturados",
  "Selección",
  "Sincronización",
];

function money(cents: number | null): number | "" {
  return cents === null ? "" : cents / 100;
}

/** Quote CSV cells and neutralize spreadsheet formulas in untrusted text. */
export function csvCell(value: string | number | null): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Invalid CSV number");
    return String(value);
  }
  let text = value ?? "";
  if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

/**
 * Export the exact selected records. Unknown legacy dates remain blank and
 * marked; this does not certify a real-time period, backup, or settlement.
 */
export function createSalesCsv(
  selectedSales: unknown[],
  options: SalesExportOptions,
): {
  csv: string;
  unknownDateCount: number;
  saleCount: number;
  rowCount: number;
} {
  if (!Array.isArray(selectedSales))
    throw new TypeError("Sales must be an array");
  const dateFormat = new Intl.DateTimeFormat("es-MX", {
    timeZone: options.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  if (
    typeof options.selectionLabel !== "string" ||
    !options.selectionLabel.trim() ||
    options.selectionLabel.length > 200
  )
    throw new TypeError("Invalid selection label");
  const snapshot = adaptPosStateToCompatibleSnapshot(
    { sales: selectedSales },
    options,
  );
  const rows: Array<Array<string | number | null>> = [];
  const realDate = (at: string | null): string | null => {
    if (
      at === null ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(at) ||
      !Number.isFinite(Date.parse(at))
    )
      return null;
    const iso = new Date(at).toISOString();
    return iso.slice(0, 19) === at.slice(0, 19) ? iso : null;
  };
  const dateCells = (at: string | null) => {
    const iso = realDate(at);
    return [at, iso, iso === null ? null : dateFormat.format(new Date(iso))];
  };
  let unknownDateCount = 0;
  for (const sale of snapshot.sales) {
    if (realDate(sale.occurredAt) === null) unknownDateCount += 1;
    const base = [options.timeZone, "MXN"];
    const tail = [
      options.selectionLabel,
      "Registro local; acuse servidor no comprobado",
    ];
    rows.push([
      "venta",
      sale.folio,
      null,
      ...dateCells(sale.occurredAt),
      ...base,
      money(sale.money.totalCents),
      money(sale.money.tipCents),
      null,
      null,
      null,
      null,
      null,
      sale.paidBy.name,
      sale.status,
      realDate(sale.occurredAt) === null
        ? "Fecha real sin dato; no asignar a periodo contable"
        : "Importes capturados; autorización externa no comprobada",
      null,
      null,
      null,
      ...tail,
    ]);
    for (const payment of sale.payments) {
      rows.push([
        "pago",
        sale.folio,
        payment.paymentId,
        ...dateCells(sale.occurredAt),
        ...base,
        null,
        null,
        payment.method,
        money(payment.netAmountCents),
        money(payment.cashReceivedCents),
        money(payment.changeCents),
        null,
        sale.paidBy.name,
        sale.status,
        payment.verificationStatus ?? "Verificación sin dato registrado",
        null,
        payment.paymentId,
        null,
        ...tail,
      ]);
    }
    for (const event of sale.compensations) {
      if (realDate(event.occurredAt) === null)
        throw new TypeError("Invalid compensation date");
      if (event.allocations.length === 0) {
        rows.push([
          event.kind,
          sale.folio,
          event.commandId,
          ...dateCells(event.occurredAt),
          ...base,
          null,
          null,
          null,
          null,
          null,
          null,
          money(event.amountCents),
          event.actorName,
          sale.status,
          "Asignación a pago incompleta",
          event.reason,
          event.paymentId,
          "Incompleta",
          ...tail,
        ]);
      } else {
        for (const allocation of event.allocations) {
          rows.push([
            event.kind,
            sale.folio,
            event.commandId,
            ...dateCells(event.occurredAt),
            ...base,
            null,
            null,
            allocation.method,
            null,
            null,
            null,
            money(allocation.amountCents),
            event.actorName,
            sale.status,
            allocation.externalVerification ?? "Verificación externa sin dato",
            event.reason,
            allocation.paymentId,
            event.allocationEvidence === "verified"
              ? "Completa con pagos capturados; no confirma proveedor"
              : "Incompleta",
            ...tail,
          ]);
        }
      }
    }
  }
  return {
    csv:
      "\uFEFF" +
      [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") +
      "\r\n",
    unknownDateCount,
    saleCount: snapshot.sales.length,
    rowCount: rows.length,
  };
}
