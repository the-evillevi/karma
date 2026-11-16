// Tables (EVL-122 [A]). The number of tables is configurable by Admin and a
// table is optional: only orders of type "mesa" carry one.
import type { CommandBatch, CommandMeta, PosState } from "./journal.ts";

export const MAX_TABLE_COUNT = 99;

/** The table numbers that can be assigned today: 1..tableCount. */
export function tableNumbers(state: PosState): number[] {
  void state;
  throw new Error("not implemented");
}

/** "Mesa 3" for a table, or the empty string when there is none. */
export function tableLabel(table: number | null): string {
  void table;
  throw new Error("not implemented");
}

/** Changes how many tables exist. Admin only. */
export function configureTables(
  state: PosState,
  meta: CommandMeta,
  input: { count: number },
): CommandBatch {
  void state;
  void meta;
  void input;
  throw new Error("not implemented");
}
