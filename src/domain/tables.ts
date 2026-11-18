import type { CommandBatch, CommandMeta, PosState } from "./journal.ts";
import { can } from "./access.ts";
import { CommandRejectedError } from "./commands.ts";

export const MAX_TABLE_COUNT = 99;

export function tableNumbers(state: PosState): number[] {
  return Array.from({ length: state.tableCount }, (_, index) => index + 1);
}

export function tableLabel(table: number | null): string {
  return table === null ? "" : `Mesa ${table}`;
}

export function configureTables(
  state: PosState,
  meta: CommandMeta,
  input: { count: number },
): CommandBatch {
  if (!can(meta.actor.role, "configure-tables")) {
    throw new CommandRejectedError("not-allowed", "configure-tables");
  }
  if (
    !Number.isSafeInteger(input.count) ||
    input.count < 0 ||
    input.count > MAX_TABLE_COUNT
  ) {
    throw new CommandRejectedError("invalid-table-count");
  }
  return {
    ...meta,
    actor: structuredClone(meta.actor),
    events: [{ type: "tables-configured", count: input.count }],
  };
}
