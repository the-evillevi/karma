import {
  adaptPosStateToCompatibleSnapshot,
  type PosCompatibleSnapshotInput,
} from "../offline-sync/pos-compatible-snapshot.ts";

export class ReportPeriodError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ReportPeriodError";
  }
}
export interface ReportPeriod {
  startUtc: string;
  endUtcExclusive: string;
  timeZone: string;
  label: string;
}
export type ReportPreset = "hoy" | "7d" | "30d";
export type RepeatedHourChoice = "reject" | "earlier" | "later";

/** A legacy display label or an impossible normalized date is not a timestamp. */
export function recordedUtcInstant(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return null;
  const iso = new Date(value).toISOString();
  return iso.slice(0, 19) === value.slice(0, 19) ? iso : null;
}
function formatter(timeZone: string) {
  if (typeof timeZone !== "string" || !timeZone || timeZone.length > 100)
    throw new ReportPeriodError("invalid_time_zone");
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new ReportPeriodError("invalid_time_zone");
  }
}
function localParts(format: Intl.DateTimeFormat, at: number) {
  const parts = new Map(format.formatToParts(at).map((p) => [p.type, p.value]));
  return ["year", "month", "day", "hour", "minute", "second"].map((key) =>
    Number(parts.get(key as Intl.DateTimeFormatPartTypes)),
  );
}
function partsUtc(parts: number[]) {
  return Date.UTC(
    parts[0]!,
    parts[1]! - 1,
    parts[2]!,
    parts[3]!,
    parts[4]!,
    parts[5]!,
  );
}
export function localReportTimeToUtc(
  value: string,
  timeZone: string,
  choice: RepeatedHourChoice = "reject",
): string {
  if (!["reject", "earlier", "later"].includes(choice))
    throw new ReportPeriodError("invalid_repeated_hour_choice");
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    value,
  );
  if (!match) throw new ReportPeriodError("invalid_local_time");
  const target = match
    .slice(1)
    .map((part) => (part === undefined ? 0 : Number(part)));
  if (target[0]! < 100 || target[0]! > 9999)
    throw new ReportPeriodError("invalid_local_time");
  const naive = partsUtc(target);
  const expected = value.length === 16 ? value + ":00" : value;
  if (
    !Number.isFinite(naive) ||
    new Date(naive).toISOString().slice(0, 19) !== expected
  )
    throw new ReportPeriodError("invalid_local_time");
  const format = formatter(timeZone);
  // Adjacent samples collect both offsets across a daylight-saving transition.
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = naive + hours * 3600000;
    offsets.add(partsUtc(localParts(format, sample)) - sample);
  }
  const candidates = [...offsets]
    .map((offset) => naive - offset)
    .filter((at) =>
      localParts(format, at).every((part, i) => part === target[i]),
    )
    .sort((a, b) => a - b);
  if (!candidates.length) throw new ReportPeriodError("nonexistent_local_time");
  if (candidates.length > 1 && choice === "reject")
    throw new ReportPeriodError("ambiguous_local_time");
  return new Date(
    choice === "later" ? candidates.at(-1)! : candidates[0]!,
  ).toISOString();
}
export function customReportPeriod(
  startLocal: string,
  endLocal: string,
  timeZone: string,
  choice: RepeatedHourChoice = "reject",
): ReportPeriod {
  const startUtc = localReportTimeToUtc(startLocal, timeZone, choice);
  const endUtcExclusive = localReportTimeToUtc(endLocal, timeZone, choice);
  if (Date.parse(endUtcExclusive) <= Date.parse(startUtc))
    throw new ReportPeriodError("invalid_period");
  return {
    startUtc,
    endUtcExclusive,
    timeZone,
    label: `${startLocal} a ${endLocal} (${timeZone}); final excluido`,
  };
}
export function presetReportPeriod(
  preset: ReportPreset,
  nowUtc: string,
  timeZone: string,
): ReportPeriod {
  const now = recordedUtcInstant(nowUtc);
  if (!now || !["hoy", "7d", "30d"].includes(preset))
    throw new ReportPeriodError("invalid_period");
  const parts = localParts(formatter(timeZone), Date.parse(now));
  const localDay = new Date(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!));
  localDay.setUTCDate(
    localDay.getUTCDate() - (preset === "7d" ? 6 : preset === "30d" ? 29 : 0),
  );
  const startLocal = localDay.toISOString().slice(0, 10) + "T00:00";
  const startUtc = localReportTimeToUtc(startLocal, timeZone, "earlier");
  return {
    startUtc,
    endUtcExclusive: new Date(Date.parse(now) + 1).toISOString(),
    timeZone,
    label: `${preset}: ${startLocal} a ${now} (${timeZone})`,
  };
}
function add(total: number, value: number): number {
  const next = total + value;
  if (!Number.isSafeInteger(next))
    throw new ReportPeriodError("unsafe_report_amount");
  return next;
}
function inPeriod(at: string | null, period: ReportPeriod) {
  return (
    at !== null &&
    Date.parse(at) >= Date.parse(period.startUtc) &&
    Date.parse(at) < Date.parse(period.endUtcExclusive)
  );
}
const methodNames = new Map([
  ["cash", "cash"],
  ["efectivo", "cash"],
  ["card", "card"],
  ["tarjeta", "card"],
  ["transfer", "transfer"],
  ["transferencia", "transfer"],
]);
function method(
  value: string | null,
): "cash" | "card" | "transfer" | "unknown" {
  return (methodNames.get(
    (value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase(),
  ) || "unknown") as "cash" | "card" | "transfer" | "unknown";
}

/** Financial totals use event dates: today's return may refer to an older sale. */
export function buildSalesPeriodReport(
  rawSales: unknown[],
  period: ReportPeriod,
  metadata: PosCompatibleSnapshotInput,
) {
  formatter(period.timeZone);
  if (
    !recordedUtcInstant(period.startUtc) ||
    !recordedUtcInstant(period.endUtcExclusive) ||
    Date.parse(period.endUtcExclusive) <= Date.parse(period.startUtc)
  )
    throw new ReportPeriodError("invalid_period");
  const snapshot = adaptPosStateToCompatibleSnapshot(
    { sales: rawSales },
    metadata,
  );
  const selectedIndexes: number[] = [],
    unknownDateIndexes: number[] = [];
  const refundEvents: Array<{
    saleIndex: number;
    commandId: string | null;
    kind: string;
    amountCents: number;
    occurredAt: string;
  }> = [];
  const receivedByMethod = { cash: 0, card: 0, transfer: 0, unknown: 0 };
  const returnedByMethod = { cash: 0, card: 0, transfer: 0, unknown: 0 };
  let grossReceiptsCents = 0,
    tipsCents = 0,
    refundsCents = 0,
    voidsCents = 0,
    completedCount = 0,
    cancelledCount = 0,
    unknownTipCount = 0,
    unknownPaymentCount = 0,
    unknownRefundDateCount = 0,
    unknownStatusCount = 0;
  snapshot.sales.forEach((sale, index) => {
    const at = recordedUtcInstant(sale.occurredAt);
    if (at === null) unknownDateIndexes.push(index);
    if (inPeriod(at, period)) {
      selectedIndexes.push(index);
      if (sale.status === "completada") {
        if (sale.money.totalCents === null)
          throw new ReportPeriodError("missing_sale_amount");
        grossReceiptsCents = add(grossReceiptsCents, sale.money.totalCents);
        completedCount++;
        if (sale.money.tipCents === null) unknownTipCount++;
        else {
          if (sale.money.tipCents > sale.money.totalCents)
            throw new ReportPeriodError("invalid_tip");
          tipsCents = add(tipsCents, sale.money.tipCents);
        }
        let allocated = 0;
        for (const payment of sale.payments) {
          if (payment.netAmountCents === null) {
            unknownPaymentCount++;
            continue;
          }
          const key = method(payment.method);
          receivedByMethod[key] = add(
            receivedByMethod[key],
            payment.netAmountCents,
          );
          allocated = add(allocated, payment.netAmountCents);
        }
        if (allocated < sale.money.totalCents) {
          unknownPaymentCount++;
          receivedByMethod.unknown = add(
            receivedByMethod.unknown,
            sale.money.totalCents - allocated,
          );
        }
        if (allocated > sale.money.totalCents)
          throw new ReportPeriodError("invalid_payment_total");
      } else if (sale.status === "cancelada") cancelledCount++;
      else unknownStatusCount++;
    }
    for (const event of sale.compensations) {
      const refundedAt = recordedUtcInstant(event.occurredAt);
      if (refundedAt === null) {
        unknownRefundDateCount++;
        continue;
      }
      if (!inPeriod(refundedAt, period)) continue;
      if (event.kind !== "refund" && event.kind !== "void")
        throw new ReportPeriodError("invalid_refund_kind");
      refundEvents.push({
        saleIndex: index,
        commandId: event.commandId,
        kind: event.kind,
        amountCents: event.amountCents,
        occurredAt: refundedAt,
      });
      if (event.kind === "void")
        voidsCents = add(voidsCents, event.amountCents);
      else refundsCents = add(refundsCents, event.amountCents);
      let allocated = 0;
      for (const allocation of event.allocations) {
        const key = method(allocation.method);
        returnedByMethod[key] = add(
          returnedByMethod[key],
          allocation.amountCents,
        );
        allocated = add(allocated, allocation.amountCents);
      }
      if (allocated < event.amountCents)
        returnedByMethod.unknown = add(
          returnedByMethod.unknown,
          event.amountCents - allocated,
        );
      if (allocated > event.amountCents)
        throw new ReportPeriodError("invalid_refund_allocation");
    }
  });
  const returnsCents = add(refundsCents, voidsCents);
  const netReceiptsCents = add(grossReceiptsCents, -returnsCents);
  return {
    period,
    selectedIndexes,
    unknownDateIndexes,
    refundEvents,
    grossReceiptsCents,
    grossSalesCents: unknownTipCount ? null : grossReceiptsCents - tipsCents,
    tipsCents,
    refundsCents,
    voidsCents,
    netReceiptsCents,
    completedCount,
    cancelledCount,
    unknownTipCount,
    unknownPaymentCount,
    unknownRefundDateCount,
    unknownStatusCount,
    receivedByMethod,
    returnedByMethod,
    netByMethod: {
      cash: receivedByMethod.cash - returnedByMethod.cash,
      card: receivedByMethod.card - returnedByMethod.card,
      transfer: receivedByMethod.transfer - returnedByMethod.transfer,
      unknown: receivedByMethod.unknown - returnedByMethod.unknown,
    },
  };
}
