const POLICY_FIELDS = [
  "enabled",
  "timeZone",
  "window",
  "leapDayRule",
  "benefit",
];
const EVENT_FIELDS = [
  "commandId",
  "kind",
  "expectedRevision",
  "actorId",
  "actorName",
  "roleSnapshot",
  "occurredAt",
  "reason",
  "payload",
];

export class CustomerBirthdayError extends Error {
  constructor(code) {
    super(code);
    this.name = "CustomerBirthdayError";
    this.code = code;
  }
}

function fail(code) {
  throw new CustomerBirthdayError(code);
}

function exactRecord(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("invalid_record");
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail("invalid_record");
}

function text(value, max = 160) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > max
  )
    fail("invalid_text");
  return value;
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function strictUtcInstant(value) {
  if (typeof value !== "string" || value.length > 40) return false;
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(
      value,
    );
  if (!match) return false;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return false;
  const milliseconds = (match[5] || "").padEnd(3, "0") || "000";
  return (
    parsed.toISOString() ===
    `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${milliseconds}Z`
  );
}

export function validateCustomerBirthDate(value) {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length !== 10 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  )
    fail("invalid_birth_date");
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1 || year > 9999 || month < 1 || month > 12)
    fail("invalid_birth_date");
  const days = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (day < 1 || day > days[month - 1]) fail("invalid_birth_date");
  return value;
}

function validTimeZone(value) {
  if (typeof value !== "string" || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function canonicalWindow(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("invalid_policy");
  if (value.kind === "exact_day") {
    exactRecord(value, ["kind"]);
    return { kind: "exact_day" };
  }
  if (value.kind === "window") {
    exactRecord(value, ["kind", "daysBefore", "daysAfter"]);
    for (const key of ["daysBefore", "daysAfter"]) {
      if (
        !Number.isSafeInteger(value[key]) ||
        value[key] < 0 ||
        value[key] > 30
      )
        fail("invalid_policy");
    }
    if (value.daysBefore + value.daysAfter === 0) fail("invalid_policy");
    return {
      kind: "window",
      daysBefore: value.daysBefore,
      daysAfter: value.daysAfter,
    };
  }
  fail("invalid_policy");
}

function canonicalBenefit(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("invalid_policy");
  if (value.kind === "product" || value.kind === "category") {
    exactRecord(value, ["kind", "id", "nameSnapshot"]);
    return {
      kind: value.kind,
      id: text(value.id, 120),
      nameSnapshot: text(value.nameSnapshot, 120),
    };
  }
  if (value.kind === "maximum_cents") {
    exactRecord(value, ["kind", "maxCoveredCents"]);
    if (
      !Number.isSafeInteger(value.maxCoveredCents) ||
      value.maxCoveredCents < 1
    )
      fail("invalid_policy");
    return { kind: "maximum_cents", maxCoveredCents: value.maxCoveredCents };
  }
  fail("invalid_policy");
}

export function validateCustomerBirthdayPolicy(value) {
  exactRecord(value, POLICY_FIELDS);
  if (typeof value.enabled !== "boolean") fail("invalid_policy");
  const timeZone = value.timeZone === null ? null : text(value.timeZone, 100);
  const window = canonicalWindow(value.window);
  const leapDayRule = value.leapDayRule;
  if (
    leapDayRule !== null &&
    !["feb28", "mar01", "leap_years_only"].includes(leapDayRule)
  )
    fail("invalid_policy");
  const benefit = canonicalBenefit(value.benefit);
  const complete =
    timeZone !== null &&
    window !== null &&
    leapDayRule !== null &&
    benefit !== null;
  if (timeZone !== null && !validTimeZone(timeZone)) fail("invalid_time_zone");
  if (value.enabled && !complete) fail("incomplete_policy");
  if (
    !complete &&
    (timeZone !== null ||
      window !== null ||
      leapDayRule !== null ||
      benefit !== null)
  )
    fail("incomplete_policy");
  return { enabled: value.enabled, timeZone, window, leapDayRule, benefit };
}

export function createCustomerBirthdayPolicyLedger() {
  return { schemaVersion: 1, events: [] };
}

function canonicalEvent(value) {
  exactRecord(value, [...EVENT_FIELDS, "revision", "syncStatus"]);
  if (value.kind !== "birthday.policy.set.v1") fail("invalid_history");
  for (const key of ["commandId", "actorId", "actorName"]) text(value[key]);
  text(value.reason, 250);
  if (value.roleSnapshot !== "duena") fail("not_authorized");
  if (
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 0
  )
    fail("invalid_history");
  if (!strictUtcInstant(value.occurredAt)) fail("invalid_timestamp");
  if (
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    value.syncStatus !== "local_pending"
  )
    fail("invalid_history");
  return { ...value, payload: validateCustomerBirthdayPolicy(value.payload) };
}

function replay(events) {
  let policy = {
    enabled: false,
    timeZone: null,
    window: null,
    leapDayRule: null,
    benefit: null,
  };
  const commands = new Map();
  let revision = 0;
  for (const raw of events) {
    const event = canonicalEvent(raw);
    if (
      commands.has(event.commandId) ||
      event.expectedRevision !== revision ||
      event.revision !== revision + 1
    )
      fail("invalid_history");
    policy = event.payload;
    revision = event.revision;
    commands.set(event.commandId, event);
  }
  return { policy, revision, commands };
}

export function validateCustomerBirthdayPolicyLedger(value) {
  exactRecord(value, ["schemaVersion", "events"]);
  if (
    value.schemaVersion !== 1 ||
    !Array.isArray(value.events) ||
    value.events.length > 100000
  )
    fail("invalid_history");
  replay(value.events);
  return structuredClone(value);
}

export function customerBirthdayPolicySnapshot(value) {
  const ledger = validateCustomerBirthdayPolicyLedger(value);
  const current = replay(ledger.events);
  return {
    policy: structuredClone(current.policy),
    revision: current.revision,
  };
}

function canonicalPolicyCommand(value) {
  exactRecord(value, EVENT_FIELDS);
  if (value.kind !== "birthday.policy.set.v1") fail("unsupported_action");
  for (const key of ["commandId", "actorId", "actorName"]) text(value[key]);
  text(value.reason, 250);
  if (value.roleSnapshot !== "duena") fail("not_authorized");
  if (
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 0
  )
    fail("invalid_history");
  if (!strictUtcInstant(value.occurredAt)) fail("invalid_timestamp");
  return { ...value, payload: validateCustomerBirthdayPolicy(value.payload) };
}

export function planCustomerBirthdayPolicyCommand(
  value,
  commandValue,
  currentAuthority,
) {
  const ledger = validateCustomerBirthdayPolicyLedger(value);
  const command = canonicalPolicyCommand(commandValue);
  if (
    !currentAuthority ||
    currentAuthority.actorId !== command.actorId ||
    currentAuthority.role !== "duena"
  )
    fail("not_authorized");
  const current = replay(ledger.events);
  const previous = current.commands.get(command.commandId);
  if (previous) {
    const same = EVENT_FIELDS.every((field) =>
      field === "payload"
        ? JSON.stringify(previous.payload) === JSON.stringify(command.payload)
        : previous[field] === command[field],
    );
    if (!same) fail("command_conflict");
    return { ledger, event: previous, duplicate: true, changed: false };
  }
  if (command.expectedRevision !== current.revision) fail("stale_revision");
  const event = {
    ...command,
    revision: command.expectedRevision + 1,
    syncStatus: "local_pending",
  };
  const next = validateCustomerBirthdayPolicyLedger({
    schemaVersion: 1,
    events: [...ledger.events, event],
  });
  return { ledger: next, event, duplicate: false, changed: true };
}

function dateParts(value) {
  validateCustomerBirthDate(value);
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function localDateAt(instant, timeZone) {
  if (!strictUtcInstant(instant)) fail("invalid_timestamp");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const part = (type) => parts.find((entry) => entry.type === type)?.value;
  return `${String(part("year")).padStart(4, "0")}-${String(part("month")).padStart(2, "0")}-${String(part("day")).padStart(2, "0")}`;
}

function ordinal(date) {
  const { year, month, day } = dateParts(date);
  const value = new Date(0);
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCFullYear(year, month - 1, day);
  return Math.floor(value.getTime() / 86400000);
}

function occurrenceFor(birth, year, leapDayRule) {
  if (birth.month !== 2 || birth.day !== 29 || isLeapYear(year))
    return `${String(year).padStart(4, "0")}-${String(birth.month).padStart(2, "0")}-${String(birth.day).padStart(2, "0")}`;
  if (leapDayRule === "feb28") return `${year}-02-28`;
  if (leapDayRule === "mar01") return `${year}-03-01`;
  return null;
}

export function evaluateCustomerBirthdayEligibility({
  birthDate,
  policyLedger,
  now,
}) {
  const validBirthDate = validateCustomerBirthDate(birthDate);
  const snapshot = customerBirthdayPolicySnapshot(policyLedger);
  const { policy, revision } = snapshot;
  if (!policy.enabled)
    return {
      eligible: false,
      reason: "La regla de cumpleaños está desactivada.",
      policyRevision: revision,
    };
  if (!validBirthDate)
    return {
      eligible: false,
      reason: "El perfil no tiene fecha de nacimiento registrada.",
      policyRevision: revision,
    };
  const today = localDateAt(now, policy.timeZone);
  if (validBirthDate > today) {
    return {
      eligible: false,
      reason:
        "La fecha de nacimiento queda después de la fecha de la sucursal.",
      localDate: today,
      policyRevision: revision,
    };
  }
  const localYear = Number(today.slice(0, 4));
  const birth = dateParts(validBirthDate);
  const before = policy.window.kind === "window" ? policy.window.daysBefore : 0;
  const after = policy.window.kind === "window" ? policy.window.daysAfter : 0;
  let occurrence = null;
  let delta = null;
  for (const year of [localYear - 1, localYear, localYear + 1]) {
    if (year < 1 || year > 9999) continue;
    const candidate = occurrenceFor(birth, year, policy.leapDayRule);
    if (!candidate) continue;
    const distance = ordinal(today) - ordinal(candidate);
    if (distance >= -before && distance <= after) {
      occurrence = candidate;
      delta = distance;
      break;
    }
  }
  const benefit =
    policy.benefit.kind === "maximum_cents"
      ? `hasta $${(policy.benefit.maxCoveredCents / 100).toFixed(2)} MXN`
      : `${policy.benefit.kind === "product" ? "producto" : "categoría"}: ${policy.benefit.nameSnapshot}`;
  if (!occurrence) {
    return {
      eligible: false,
      reason: `Fuera de la ventana configurada (${policy.timeZone}).`,
      localDate: today,
      policyRevision: revision,
      benefit,
    };
  }
  return {
    eligible: true,
    reason:
      delta === 0
        ? "Hoy corresponde al cumpleaños según la regla configurada."
        : "La fecha está dentro de la ventana configurada.",
    localDate: today,
    birthdayOccurrenceDate: occurrence,
    birthdayCycleYear: Number(occurrence.slice(0, 4)),
    dayOffset: delta,
    policyRevision: revision,
    benefit,
    reservationStatus: "preview_only",
  };
}
