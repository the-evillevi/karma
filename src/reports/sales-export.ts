import {
  adaptPosStateToCompatibleSnapshot,
  type PosCompatibleSnapshotInput,
} from "../offline-sync/pos-compatible-snapshot.ts";
import {
  recordedUtcInstant,
  reportSaleInstant,
  type ReportPeriod,
} from "./report-period.ts";

/** Local recorded evidence only. No upload receipt or historical date is inferred. */
export interface SalesExportOptions extends PosCompatibleSnapshotInput {
  timeZone: string;
  selectionLabel: string;
  period?: ReportPeriod;
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
 * Export selected sales and period-dated compensations. In period mode,
 * undated legacy sales stay in a clearly separate evidence group, while a
 * refund from an older sale is included by the refund's own recorded time.
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
  const realDate = recordedUtcInstant;
  const period = options.period;
  if (
    period &&
    (period.timeZone !== options.timeZone ||
      realDate(period.startUtc) === null ||
      realDate(period.endUtcExclusive) === null ||
      Date.parse(period.endUtcExclusive) <= Date.parse(period.startUtc))
  )
    throw new TypeError("Invalid report period");
  const inPeriod = (at: string | null) =>
    !!period &&
    at !== null &&
    Date.parse(at) >= Date.parse(period.startUtc) &&
    Date.parse(at) < Date.parse(period.endUtcExclusive);
  const dateCells = (at: string | null) => {
    const iso = realDate(at);
    return [at, iso, iso === null ? null : dateFormat.format(new Date(iso))];
  };
  let unknownDateCount = 0;
  let periodSaleCount = 0;
  for (const sale of snapshot.sales) {
    const saleAt = reportSaleInstant(sale);
    const unknownSaleDate = saleAt === null;
    const includeSale =
      !period || inPeriod(saleAt) || (period !== undefined && unknownSaleDate);
    if (unknownSaleDate) unknownDateCount += 1;
    else if (!period || inPeriod(saleAt)) periodSaleCount += 1;
    const base = [options.timeZone, "MXN"];
    const tail = (legacy = false) => [
      legacy && period
        ? "Legado sin fecha real; separado del periodo"
        : options.selectionLabel,
      "Registro local; acuse servidor no comprobado",
    ];
    if (includeSale)
      rows.push([
        "venta",
        sale.folio,
        null,
        ...dateCells(saleAt ?? sale.occurredAt),
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
        unknownSaleDate
          ? period
            ? "Fecha real sin dato; evidencia histórica separada y excluida del periodo"
            : "Fecha real sin dato; no asignar a periodo contable"
          : "Importes capturados; autorización externa no comprobada",
        null,
        null,
        null,
        ...tail(unknownSaleDate),
      ]);
    for (const payment of includeSale ? sale.payments : []) {
      rows.push([
        "pago",
        sale.folio,
        payment.paymentId,
        ...dateCells(saleAt ?? sale.occurredAt),
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
        ...tail(unknownSaleDate),
      ]);
    }
    for (const event of sale.compensations) {
      const eventAt = realDate(event.occurredAt);
      if (eventAt === null && !period)
        throw new TypeError("Invalid compensation date");
      if (period && eventAt === null) {
        rows.push([
          `legado_${event.kind}_sin_fecha`,
          sale.folio,
          event.commandId,
          ...dateCells(null),
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
          "Fecha real de devolución sin dato; evidencia histórica separada y excluida del periodo",
          event.reason,
          event.paymentId,
          "Sin fecha verificable",
          ...tail(true),
        ]);
        continue;
      }
      if (eventAt === null || (period && !inPeriod(eventAt))) continue;
      if (sale.status === "cancelada")
        throw new TypeError(
          "Refund on an unpaid cancellation requires reconciliation",
        );
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
          ...tail(false),
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
            ...tail(false),
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
    saleCount: period ? periodSaleCount : snapshot.sales.length,
    rowCount: rows.length,
  };
}
