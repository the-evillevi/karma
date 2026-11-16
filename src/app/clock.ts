/**
 * The device's local time as ISO 8601 with its UTC offset, e.g.
 * "2026-11-15T10:05:00.000-06:00". The date part is the local calendar day,
 * which is what "today's sales" means to the café.
 */
export function localIso(date: Date = new Date()): string {
  const pad = (value: number, length = 2) =>
    String(value).padStart(length, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const absolute = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  );
}

/** "10:05" from a local ISO timestamp. */
export function timeOfDay(iso: string): string {
  return iso.slice(11, 16);
}
