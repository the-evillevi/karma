/** A new stable ID for an order, line or command. */
export function newId(): string {
  return crypto.randomUUID();
}
