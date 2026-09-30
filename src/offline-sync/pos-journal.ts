import type { OrderLineSnapshot } from "../domain/contracts.ts";

export const POS_JOURNAL_SCHEMA_VERSION = 1 as const;
export const POS_ORDER_SNAPSHOT_ACTION = "order.snapshot.saved" as const;

export type PosOrderType = "dine-in" | "pickup" | "delivery" | "counter";

export interface PosOrderSnapshot {
  orderId: string;
  status: "draft" | "open";
  orderType: PosOrderType;
  tableId: string | null;
  customer: {
    name: string | null;
    phone: string | null;
    address: string | null;
  } | null;
  lines: readonly OrderLineSnapshot[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  currency: "MXN";
  capturedAt: string;
}

export interface PosSnapshotCommandInput {
  commandId: string;
  branchId: string;
  aggregateId: string;
  actorId: string;
  deviceId: string;
  occurredAt: string;
  schemaVersion: typeof POS_JOURNAL_SCHEMA_VERSION;
  expectedRevision: number;
  action: typeof POS_ORDER_SNAPSHOT_ACTION;
  payload: { order: PosOrderSnapshot };
}

export interface PosJournalCommand extends PosSnapshotCommandInput {
  aggregateKey: string;
  revision: number;
}

export interface PosOrderProjection {
  aggregateId: string;
  branchId: string;
  revision: number;
  order: PosOrderSnapshot;
  lastCommand: {
    commandId: string;
    actorId: string;
    deviceId: string;
    occurredAt: string;
  };
}

export interface PosServerReceipt {
  commandId: string;
  serverReceivedAt: string;
  outcome: "inserted" | "identical-retry";
}

export interface PosSyncBlock {
  commandId: string;
  code: string;
  blockedAt: string;
}

export interface PosRevisionConflict {
  command: PosSnapshotCommandInput;
  expectedRevision: number;
  currentRevision: number;
  detectedAt: string;
}

export type PosDiagnosticKind = "storage" | "sync" | "conflict" | "recovery";

export interface PosDiagnostic {
  diagnosticId: string;
  kind: PosDiagnosticKind;
  code: string;
  recordedAt: string;
  commandId?: string;
}

export interface PosJournalScope {
  readonly branchId: string;
  readonly deviceId: string;
}

export interface PosJournalSnapshot {
  scope: PosJournalScope;
  commands: PosJournalCommand[];
  projections: PosOrderProjection[];
  receipts: PosServerReceipt[];
  blocks: PosSyncBlock[];
  conflicts: PosRevisionConflict[];
  diagnostics: PosDiagnostic[];
  queue: Array<{
    command: PosJournalCommand;
    state: "pending" | "acknowledged" | "blocked";
    code?: string;
  }>;
}

export interface AppendPosSnapshotResult {
  command: PosJournalCommand;
  projection: PosOrderProjection;
  duplicate: boolean;
}

interface ValidatedAggregateState {
  revision: number;
  projection: PosOrderProjection | null;
}

export class PosJournalError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class PosRevisionConflictError extends PosJournalError {
  constructor(
    readonly expectedRevision: number,
    readonly currentRevision: number,
  ) {
    super(
      "LOCAL_REVISION_CONFLICT",
      `Order revision changed: expected ${expectedRevision}, found ${currentRevision}`,
    );
  }
}

export class PosCommandIdentityConflictError extends PosJournalError {
  constructor(commandId: string) {
    super(
      "LOCAL_COMMAND_ID_CONFLICT",
      `Command ID was reused with different content: ${commandId}`,
    );
  }
}

export class PosJournalIntegrityError extends PosJournalError {
  constructor(message: string) {
    super("LOCAL_JOURNAL_INTEGRITY_ERROR", message);
  }
}

const databasePrefix = "karma-pos-journal-v1-";
const storeNames = {
  commands: "commands",
  heads: "aggregateHeads",
  projections: "orderProjections",
  receipts: "serverReceipts",
  blocks: "syncBlocks",
  conflicts: "revisionConflicts",
  diagnostics: "diagnostics",
} as const;

const openJournals = new WeakMap<
  IDBFactory,
  Map<string, Promise<PosJournal>>
>();

export async function openPosJournal(
  scope: PosJournalScope,
  options: { indexedDBFactory?: IDBFactory; cryptoProvider?: Crypto } = {},
): Promise<PosJournal> {
  validateScope(scope);
  const journalScope = Object.freeze(structuredClone(scope));
  const factory = options.indexedDBFactory ?? globalThis.indexedDB;
  const cryptoProvider = options.cryptoProvider ?? globalThis.crypto;
  if (!factory)
    throw new PosJournalError(
      "LOCAL_STORAGE_UNAVAILABLE",
      "Durable browser storage is unavailable.",
    );
  if (!cryptoProvider?.subtle)
    throw new PosJournalError(
      "LOCAL_STORAGE_UNAVAILABLE",
      "Secure local database naming is unavailable.",
    );

  const databaseName = await getScopedDatabaseName(
    journalScope,
    cryptoProvider,
  );
  let factoryJournals = openJournals.get(factory);
  if (!factoryJournals) {
    factoryJournals = new Map();
    openJournals.set(factory, factoryJournals);
  }
  const cached = factoryJournals.get(databaseName);
  if (cached) return cached;

  const opening = openDatabase(factory, databaseName).then(
    (database) =>
      new PosJournal(database, journalScope, () => {
        if (factoryJournals?.get(databaseName) === opening)
          factoryJournals.delete(databaseName);
      }),
  );
  factoryJournals.set(databaseName, opening);
  try {
    return await opening;
  } catch (error) {
    if (factoryJournals.get(databaseName) === opening)
      factoryJournals.delete(databaseName);
    throw error;
  }
}

/** Deterministic local reducer. It replaces the saved open/draft snapshot only. */
export function reducePosSnapshotCommand(
  previous: PosOrderProjection | null,
  command: PosJournalCommand,
): PosOrderProjection {
  validateStoredCommand(command);
  if (command.action !== POS_ORDER_SNAPSHOT_ACTION)
    throw new PosJournalError(
      "UNSUPPORTED_LOCAL_ACTION",
      "Unsupported local POS action.",
    );
  if (command.payload.order.orderId !== command.aggregateId)
    throw new PosJournalIntegrityError(
      "Order snapshot ID does not match its aggregate.",
    );
  if (previous && previous.aggregateId !== command.aggregateId)
    throw new PosJournalIntegrityError(
      "Projection aggregate does not match its command.",
    );

  return {
    aggregateId: command.aggregateId,
    branchId: command.branchId,
    revision: command.revision,
    order: structuredClone(command.payload.order),
    lastCommand: {
      commandId: command.commandId,
      actorId: command.actorId,
      deviceId: command.deviceId,
      occurredAt: command.occurredAt,
    },
  };
}

export function validatePosSnapshotCommand(
  value: PosSnapshotCommandInput,
  scope: PosJournalScope,
): PosSnapshotCommandInput {
  if (!value || typeof value !== "object")
    throw new TypeError("A POS journal command is required.");
  assertOnlyKeys(value, [
    "commandId",
    "branchId",
    "aggregateId",
    "actorId",
    "deviceId",
    "occurredAt",
    "schemaVersion",
    "expectedRevision",
    "action",
    "payload",
  ]);
  validateScope(scope);
  for (const [field, candidate] of Object.entries({
    commandId: value.commandId,
    aggregateId: value.aggregateId,
    actorId: value.actorId,
    branchId: value.branchId,
    deviceId: value.deviceId,
  }))
    assertId(candidate, field);
  if (value.branchId !== scope.branchId || value.deviceId !== scope.deviceId)
    throw new PosJournalError(
      "LOCAL_SCOPE_MISMATCH",
      "Command branch or device does not match this local journal.",
    );
  if (value.schemaVersion !== POS_JOURNAL_SCHEMA_VERSION)
    throw new PosJournalError(
      "UNSUPPORTED_SCHEMA_VERSION",
      "Unsupported local command version.",
    );
  if (value.action !== POS_ORDER_SNAPSHOT_ACTION)
    throw new PosJournalError(
      "UNSUPPORTED_LOCAL_ACTION",
      "Unsupported local POS action.",
    );
  if (
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 0
  )
    throw new TypeError(
      "expectedRevision must be a non-negative safe integer.",
    );
  assertUtcInstant(value.occurredAt, "occurredAt");
  if (!value.payload || typeof value.payload !== "object")
    throw new TypeError("Command payload is required.");
  assertOnlyKeys(value.payload, ["order"]);
  validateOrderSnapshot(value.payload.order, value.aggregateId);
  return structuredClone(value);
}

export function replayPosJournalCommands(
  commands: readonly PosJournalCommand[],
): PosOrderProjection[] {
  const sorted = [...commands].sort(
    (left, right) =>
      left.aggregateKey.localeCompare(right.aggregateKey) ||
      left.revision - right.revision,
  );
  const projections = new Map<string, PosOrderProjection>();
  for (const command of sorted) {
    validateStoredCommand(command);
    const previous = projections.get(command.aggregateKey) ?? null;
    const expectedNextRevision = (previous?.revision ?? 0) + 1;
    if (command.revision !== expectedNextRevision)
      throw new PosJournalIntegrityError(
        `Order revision gap for ${command.aggregateId}: expected ${expectedNextRevision}, found ${command.revision}.`,
      );
    projections.set(
      command.aggregateKey,
      reducePosSnapshotCommand(previous, command),
    );
  }
  return [...projections.values()].sort((left, right) =>
    left.aggregateId.localeCompare(right.aggregateId),
  );
}

export class PosJournal {
  private closed = false;

  constructor(
    private readonly database: IDBDatabase,
    readonly scope: PosJournalScope,
    private readonly removeFromCache: () => void,
  ) {
    this.database.onversionchange = () => this.invalidate();
  }

  async appendSnapshot(
    input: PosSnapshotCommandInput,
  ): Promise<AppendPosSnapshotResult> {
    this.assertOpen();
    const commandInput = validatePosSnapshotCommand(input, this.scope);
    const aggregateKey = createAggregateKey(
      commandInput.branchId,
      commandInput.aggregateId,
    );

    return new Promise((resolve, reject) => {
      let result: AppendPosSnapshotResult | undefined;
      let failure: unknown;
      const transaction = this.database.transaction(
        [
          storeNames.commands,
          storeNames.heads,
          storeNames.projections,
          storeNames.conflicts,
          storeNames.diagnostics,
        ],
        "readwrite",
      );
      transaction.oncomplete = () => {
        if (failure) reject(failure);
        else if (result) resolve(result);
        else
          reject(
            new PosJournalIntegrityError(
              "Local command transaction produced no result.",
            ),
          );
      };
      transaction.onabort = () =>
        reject(failure ?? transaction.error ?? storageError());
      transaction.onerror = () => {
        failure ??= transaction.error ?? storageError();
      };

      const abort = (error: unknown) => {
        failure = error;
        try {
          transaction.abort();
        } catch {
          reject(error);
        }
      };

      const commands = transaction.objectStore(storeNames.commands);
      const commandRequest = commands.get(commandInput.commandId);
      commandRequest.onerror = () => {
        failure = commandRequest.error ?? storageError();
      };
      commandRequest.onsuccess = () => {
        const existing = commandRequest.result as PosJournalCommand | undefined;
        if (existing) {
          try {
            validateStoredCommand(existing);
            assertCommandInScope(existing, this.scope);
          } catch (error) {
            abort(asIntegrityError(error, "Retried command is malformed."));
            return;
          }
          if (!sameCommandContent(existing, commandInput)) {
            abort(new PosCommandIdentityConflictError(commandInput.commandId));
            return;
          }
        }

        readAggregateStateInTransaction(
          transaction,
          this.scope,
          aggregateKey,
          (aggregateState) => {
            if (existing) {
              if (!aggregateState.projection) {
                abort(
                  new PosJournalIntegrityError(
                    "Retried command is missing from its aggregate history.",
                  ),
                );
                return;
              }
              result = {
                command: existing,
                projection: aggregateState.projection,
                duplicate: true,
              };
              return;
            }

            const previousConflictRequest = transaction
              .objectStore(storeNames.conflicts)
              .get(commandInput.commandId);
            previousConflictRequest.onerror = () => {
              failure = previousConflictRequest.error ?? storageError();
            };
            previousConflictRequest.onsuccess = () => {
              const previousConflict = previousConflictRequest.result as
                PosRevisionConflict | undefined;
              if (previousConflict) {
                try {
                  validateRevisionConflict(previousConflict, this.scope);
                } catch (error) {
                  abort(
                    asIntegrityError(
                      error,
                      "Saved revision conflict is malformed.",
                    ),
                  );
                  return;
                }
                if (!sameJson(previousConflict.command, commandInput)) {
                  abort(
                    new PosCommandIdentityConflictError(commandInput.commandId),
                  );
                  return;
                }
                failure = new PosRevisionConflictError(
                  previousConflict.expectedRevision,
                  previousConflict.currentRevision,
                );
                return;
              }

              const currentRevision = aggregateState.revision;
              if (currentRevision !== commandInput.expectedRevision) {
                const conflict: PosRevisionConflict = {
                  command: commandInput,
                  expectedRevision: commandInput.expectedRevision,
                  currentRevision,
                  detectedAt: new Date().toISOString(),
                };
                const diagnostic: PosDiagnostic = {
                  diagnosticId: `revision:${commandInput.commandId}`,
                  kind: "conflict",
                  code: "LOCAL_REVISION_CONFLICT",
                  recordedAt: conflict.detectedAt,
                  commandId: commandInput.commandId,
                };
                try {
                  transaction.objectStore(storeNames.conflicts).add(conflict);
                  transaction
                    .objectStore(storeNames.diagnostics)
                    .put(diagnostic);
                  failure = new PosRevisionConflictError(
                    commandInput.expectedRevision,
                    currentRevision,
                  );
                } catch (error) {
                  abort(error);
                }
                return;
              }

              const command: PosJournalCommand = {
                ...commandInput,
                aggregateKey,
                revision: currentRevision + 1,
              };
              let projection: PosOrderProjection;
              try {
                projection = reducePosSnapshotCommand(
                  aggregateState.projection,
                  command,
                );
              } catch (error) {
                abort(error);
                return;
              }

              try {
                commands.add(command);
                transaction
                  .objectStore(storeNames.heads)
                  .put({ aggregateKey, revision: command.revision });
                transaction.objectStore(storeNames.projections).put({
                  ...projection,
                  aggregateKey,
                });
                result = { command, projection, duplicate: false };
              } catch (error) {
                abort(
                  error instanceof PosJournalError ? error : storageError(),
                );
              }
            };
          },
          abort,
        );
      };
    });
  }

  /** Call only after an authenticated server RPC has acknowledged this command. */
  async recordServerReceipt(receipt: PosServerReceipt): Promise<void> {
    this.assertOpen();
    validateReceipt(receipt);
    return new Promise((resolve, reject) => {
      let failure: unknown;
      const transaction = this.database.transaction(
        [storeNames.commands, storeNames.receipts, storeNames.blocks],
        "readwrite",
      );
      transaction.oncomplete = () => (failure ? reject(failure) : resolve());
      transaction.onabort = () =>
        reject(failure ?? transaction.error ?? storageError());
      transaction.onerror = () => {
        failure ??= transaction.error ?? storageError();
      };
      const abort = (error: unknown) => {
        failure = error;
        try {
          transaction.abort();
        } catch {
          reject(error);
        }
      };
      const commandRequest = transaction
        .objectStore(storeNames.commands)
        .get(receipt.commandId);
      commandRequest.onerror = () => {
        failure = commandRequest.error ?? storageError();
      };
      commandRequest.onsuccess = () => {
        if (!commandRequest.result) {
          abort(
            new PosJournalError(
              "UNKNOWN_LOCAL_COMMAND",
              "Cannot acknowledge an unknown local command.",
            ),
          );
          return;
        }
        try {
          validateStoredCommand(commandRequest.result as PosJournalCommand);
          assertCommandInScope(
            commandRequest.result as PosJournalCommand,
            this.scope,
          );
        } catch (error) {
          abort(
            asIntegrityError(error, "Receipt command is outside its scope."),
          );
          return;
        }
        const receipts = transaction.objectStore(storeNames.receipts);
        const blocks = transaction.objectStore(storeNames.blocks);
        const existingRequest = receipts.get(receipt.commandId);
        existingRequest.onerror = () => {
          failure = existingRequest.error ?? storageError();
        };
        existingRequest.onsuccess = () => {
          const existing = existingRequest.result as
            PosServerReceipt | undefined;
          if (existing) {
            if (!sameJson(existing, receipt)) {
              abort(new PosCommandIdentityConflictError(receipt.commandId));
            } else {
              blocks.delete(receipt.commandId);
            }
            return;
          }
          try {
            receipts.add(receipt);
            blocks.delete(receipt.commandId);
          } catch (error) {
            abort(error instanceof PosJournalError ? error : storageError());
          }
        };
      };
    });
  }

  async recordSyncBlock(block: PosSyncBlock): Promise<void> {
    this.assertOpen();
    validateSyncBlock(block);
    return new Promise((resolve, reject) => {
      let failure: unknown;
      const transaction = this.database.transaction(
        [storeNames.commands, storeNames.receipts, storeNames.blocks],
        "readwrite",
      );
      transaction.oncomplete = () => (failure ? reject(failure) : resolve());
      transaction.onabort = () =>
        reject(failure ?? transaction.error ?? storageError());
      transaction.onerror = () => {
        failure ??= transaction.error ?? storageError();
      };
      const abort = (error: unknown) => {
        failure = error;
        try {
          transaction.abort();
        } catch {
          reject(error);
        }
      };
      const commands = transaction.objectStore(storeNames.commands);
      const commandRequest = commands.get(block.commandId);
      commandRequest.onerror = () => {
        failure = commandRequest.error ?? storageError();
      };
      commandRequest.onsuccess = () => {
        if (!commandRequest.result) {
          abort(
            new PosJournalError(
              "UNKNOWN_LOCAL_COMMAND",
              "Cannot block an unknown local command.",
            ),
          );
          return;
        }
        try {
          validateStoredCommand(commandRequest.result as PosJournalCommand);
          assertCommandInScope(
            commandRequest.result as PosJournalCommand,
            this.scope,
          );
        } catch (error) {
          abort(
            asIntegrityError(error, "Blocked command is outside its scope."),
          );
          return;
        }
        const receipts = transaction.objectStore(storeNames.receipts);
        const receiptRequest = receipts.get(block.commandId);
        receiptRequest.onerror = () => {
          failure = receiptRequest.error ?? storageError();
        };
        receiptRequest.onsuccess = () => {
          if (receiptRequest.result) {
            abort(
              new PosJournalError(
                "COMMAND_ALREADY_ACKNOWLEDGED",
                "An acknowledged command cannot be blocked.",
              ),
            );
            return;
          }
          const blocks = transaction.objectStore(storeNames.blocks);
          const existingRequest = blocks.get(block.commandId);
          existingRequest.onerror = () => {
            failure = existingRequest.error ?? storageError();
          };
          existingRequest.onsuccess = () => {
            const existing = existingRequest.result as PosSyncBlock | undefined;
            if (existing) {
              if (existing.code !== block.code)
                abort(new PosCommandIdentityConflictError(block.commandId));
              return;
            }
            try {
              blocks.add(block);
            } catch (error) {
              abort(error instanceof PosJournalError ? error : storageError());
            }
          };
        };
      };
    });
  }

  async recordDiagnostic(diagnostic: PosDiagnostic): Promise<void> {
    this.assertOpen();
    validateDiagnostic(diagnostic);
    return new Promise((resolve, reject) => {
      let failure: unknown;
      const transaction = this.database.transaction(
        storeNames.diagnostics,
        "readwrite",
      );
      transaction.oncomplete = () => (failure ? reject(failure) : resolve());
      transaction.onabort = () =>
        reject(failure ?? transaction.error ?? storageError());
      transaction.onerror = () => {
        failure ??= transaction.error ?? storageError();
      };
      const store = transaction.objectStore(storeNames.diagnostics);
      const existingRequest = store.get(diagnostic.diagnosticId);
      existingRequest.onerror = () => {
        failure = existingRequest.error ?? storageError();
      };
      existingRequest.onsuccess = () => {
        const existing = existingRequest.result as PosDiagnostic | undefined;
        if (existing) {
          if (!sameJson(existing, diagnostic))
            failure = new PosCommandIdentityConflictError(
              diagnostic.diagnosticId,
            );
          return;
        }
        try {
          store.add(diagnostic);
        } catch (error) {
          failure = error instanceof PosJournalError ? error : storageError();
          try {
            transaction.abort();
          } catch {
            reject(error);
          }
        }
      };
    });
  }

  async readSnapshot(): Promise<PosJournalSnapshot> {
    this.assertOpen();
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(
        [
          storeNames.commands,
          storeNames.heads,
          storeNames.projections,
          storeNames.receipts,
          storeNames.blocks,
          storeNames.conflicts,
          storeNames.diagnostics,
        ],
        "readonly",
      );
      const values: Record<string, unknown[]> = {};
      let failure: unknown;
      transaction.oncomplete = () => {
        if (failure) {
          reject(failure);
          return;
        }
        try {
          const commands = values.commands as PosJournalCommand[];
          const projections = validateAllDerivedState(
            commands,
            values.heads as unknown[],
            values.projections as unknown[],
            this.scope,
          );
          commands.sort(
            (left, right) =>
              left.aggregateKey.localeCompare(right.aggregateKey) ||
              left.revision - right.revision,
          );
          const receipts = values.receipts as PosServerReceipt[];
          const blocks = values.blocks as PosSyncBlock[];
          const conflicts = values.conflicts as PosRevisionConflict[];
          const diagnostics = values.diagnostics as PosDiagnostic[];
          const commandIds = new Set(
            commands.map((command) => command.commandId),
          );
          for (const receipt of receipts) {
            try {
              validateReceipt(receipt);
            } catch (error) {
              throw asIntegrityError(
                error,
                "Saved server receipt is malformed.",
              );
            }
            if (!commandIds.has(receipt.commandId))
              throw new PosJournalIntegrityError(
                "Receipt references an unknown local command.",
              );
          }
          for (const block of blocks) {
            try {
              validateSyncBlock(block);
            } catch (error) {
              throw asIntegrityError(error, "Saved sync block is malformed.");
            }
            if (!commandIds.has(block.commandId))
              throw new PosJournalIntegrityError(
                "Sync block references an unknown local command.",
              );
          }
          for (const conflict of conflicts) {
            try {
              validateRevisionConflict(conflict, this.scope);
            } catch (error) {
              throw asIntegrityError(
                error,
                "Saved revision conflict is malformed.",
              );
            }
          }
          for (const diagnostic of diagnostics) {
            try {
              validateDiagnostic(diagnostic);
            } catch (error) {
              throw asIntegrityError(error, "Saved diagnostic is malformed.");
            }
          }
          const receiptIds = new Set(
            receipts.map((receipt) => receipt.commandId),
          );
          const blockIds = new Set(blocks.map((block) => block.commandId));
          if ([...receiptIds].some((commandId) => blockIds.has(commandId)))
            throw new PosJournalIntegrityError(
              "A command cannot be both acknowledged and actively blocked.",
            );
          const blockById = new Map(
            blocks.map((block) => [block.commandId, block]),
          );
          resolve({
            scope: structuredClone(this.scope),
            commands: commands.map((command) => structuredClone(command)),
            projections: projections.map((projection) =>
              structuredClone(projection),
            ),
            receipts: receipts.map((receipt) => structuredClone(receipt)),
            blocks: blocks.map((block) => structuredClone(block)),
            conflicts: conflicts.map((conflict) => structuredClone(conflict)),
            diagnostics: diagnostics.map((item) => structuredClone(item)),
            queue: commands.map((command) => {
              const block = blockById.get(command.commandId);
              return {
                command: structuredClone(command),
                state: receiptIds.has(command.commandId)
                  ? "acknowledged"
                  : block
                    ? "blocked"
                    : "pending",
                ...(block ? { code: block.code } : {}),
              };
            }),
          });
        } catch (error) {
          reject(error);
        }
      };
      transaction.onabort = () => reject(transaction.error ?? storageError());
      transaction.onerror = () => {
        failure ??= transaction.error ?? storageError();
      };
      for (const name of [
        storeNames.commands,
        storeNames.heads,
        storeNames.projections,
        storeNames.receipts,
        storeNames.blocks,
        storeNames.conflicts,
        storeNames.diagnostics,
      ]) {
        const request = transaction.objectStore(name).getAll();
        request.onsuccess = () => {
          values[
            name === storeNames.commands
              ? "commands"
              : name === storeNames.heads
                ? "heads"
                : name === storeNames.projections
                  ? "projections"
                  : name === storeNames.receipts
                    ? "receipts"
                    : name === storeNames.blocks
                      ? "blocks"
                      : name === storeNames.conflicts
                        ? "conflicts"
                        : "diagnostics"
          ] = request.result;
        };
        request.onerror = () => {
          failure = request.error ?? storageError();
        };
      }
    });
  }

  close(): void {
    this.invalidate();
  }

  private invalidate(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.database.close();
    } finally {
      this.removeFromCache();
    }
  }

  private assertOpen(): void {
    if (this.closed)
      throw new PosJournalError(
        "LOCAL_DATABASE_CLOSED",
        "Local POS journal is closed.",
      );
  }
}

function readAggregateStateInTransaction(
  transaction: IDBTransaction,
  scope: PosJournalScope,
  aggregateKey: string,
  onSuccess: (state: ValidatedAggregateState) => void,
  onFailure: (error: unknown) => void,
): void {
  let history: PosJournalCommand[] | undefined;
  let head: unknown;
  let projection: unknown;
  let remainingReads = 3;
  const finishRead = () => {
    remainingReads -= 1;
    if (remainingReads !== 0) return;
    try {
      onSuccess(
        validateAggregateState(
          scope,
          aggregateKey,
          history ?? [],
          head,
          projection,
        ),
      );
    } catch (error) {
      onFailure(error);
    }
  };

  try {
    const historyRequest = transaction
      .objectStore(storeNames.commands)
      .index("byAggregateRevision")
      .getAll(
        IDBKeyRange.bound(
          [aggregateKey, 1],
          [aggregateKey, Number.MAX_SAFE_INTEGER],
        ),
      );
    const headRequest = transaction
      .objectStore(storeNames.heads)
      .get(aggregateKey);
    const projectionRequest = transaction
      .objectStore(storeNames.projections)
      .get(aggregateKey);

    historyRequest.onerror = () =>
      onFailure(historyRequest.error ?? storageError());
    historyRequest.onsuccess = () => {
      history = historyRequest.result as PosJournalCommand[];
      finishRead();
    };
    headRequest.onerror = () => onFailure(headRequest.error ?? storageError());
    headRequest.onsuccess = () => {
      head = headRequest.result;
      finishRead();
    };
    projectionRequest.onerror = () =>
      onFailure(projectionRequest.error ?? storageError());
    projectionRequest.onsuccess = () => {
      projection = projectionRequest.result;
      finishRead();
    };
  } catch (error) {
    onFailure(error);
  }
}

function validateAggregateState(
  scope: PosJournalScope,
  aggregateKey: string,
  commands: readonly PosJournalCommand[],
  headValue: unknown,
  projectionValue: unknown,
): ValidatedAggregateState {
  try {
    return validateAggregateStateUnchecked(
      scope,
      aggregateKey,
      commands,
      headValue,
      projectionValue,
    );
  } catch (error) {
    throw asIntegrityError(error, "Saved aggregate state is malformed.");
  }
}

function validateAggregateStateUnchecked(
  scope: PosJournalScope,
  aggregateKey: string,
  commands: readonly PosJournalCommand[],
  headValue: unknown,
  projectionValue: unknown,
): ValidatedAggregateState {
  for (const command of commands) {
    validateStoredCommand(command);
    assertCommandInScope(command, scope);
    if (command.aggregateKey !== aggregateKey)
      throw new PosJournalIntegrityError(
        "Aggregate index returned a command from another aggregate.",
      );
  }
  const replayed = replayPosJournalCommands(commands);
  if (replayed.length > 1)
    throw new PosJournalIntegrityError(
      "Aggregate history contains multiple order projections.",
    );
  const projection = replayed[0] ?? null;
  const expectedRevision = projection?.revision ?? 0;

  if (!projection) {
    if (headValue !== undefined || projectionValue !== undefined)
      throw new PosJournalIntegrityError(
        "Aggregate head or projection exists without immutable command history.",
      );
    return { revision: 0, projection: null };
  }

  if (!headValue || !projectionValue)
    throw new PosJournalIntegrityError(
      "Aggregate head or projection is missing from immutable command history.",
    );
  if (typeof headValue !== "object" || Array.isArray(headValue))
    throw new PosJournalIntegrityError("Aggregate head is malformed.");
  const head = headValue as { aggregateKey?: unknown; revision?: unknown };
  assertOnlyKeys(head, ["aggregateKey", "revision"]);
  if (
    head.aggregateKey !== aggregateKey ||
    head.revision !== expectedRevision ||
    !Number.isSafeInteger(head.revision)
  )
    throw new PosJournalIntegrityError(
      "Aggregate head differs from immutable command history.",
    );

  if (typeof projectionValue !== "object" || Array.isArray(projectionValue))
    throw new PosJournalIntegrityError("Saved order projection is malformed.");
  const savedProjection = projectionValue as PosOrderProjection & {
    aggregateKey?: unknown;
  };
  assertOnlyKeys(savedProjection, [
    "aggregateKey",
    "aggregateId",
    "branchId",
    "revision",
    "order",
    "lastCommand",
  ]);
  const expectedProjection = { ...projection, aggregateKey };
  if (!sameJson(savedProjection, expectedProjection))
    throw new PosJournalIntegrityError(
      "Saved order projection differs from immutable command history.",
    );
  return { revision: expectedRevision, projection };
}

function validateAllDerivedState(
  commands: readonly PosJournalCommand[],
  headValues: readonly unknown[],
  projectionValues: readonly unknown[],
  scope: PosJournalScope,
): PosOrderProjection[] {
  try {
    return validateAllDerivedStateUnchecked(
      commands,
      headValues,
      projectionValues,
      scope,
    );
  } catch (error) {
    throw asIntegrityError(error, "Saved journal state is malformed.");
  }
}

function validateAllDerivedStateUnchecked(
  commands: readonly PosJournalCommand[],
  headValues: readonly unknown[],
  projectionValues: readonly unknown[],
  scope: PosJournalScope,
): PosOrderProjection[] {
  const commandGroups = new Map<string, PosJournalCommand[]>();
  for (const command of commands) {
    validateStoredCommand(command);
    assertCommandInScope(command, scope);
    const group = commandGroups.get(command.aggregateKey) ?? [];
    group.push(command);
    commandGroups.set(command.aggregateKey, group);
  }

  const heads = indexDerivedRecords(headValues, "head", scope);
  const projections = indexDerivedRecords(
    projectionValues,
    "projection",
    scope,
  );
  const aggregateKeys = new Set([
    ...commandGroups.keys(),
    ...heads.keys(),
    ...projections.keys(),
  ]);
  for (const aggregateKey of aggregateKeys) {
    validateAggregateState(
      scope,
      aggregateKey,
      commandGroups.get(aggregateKey) ?? [],
      heads.get(aggregateKey),
      projections.get(aggregateKey),
    );
  }
  return replayPosJournalCommands(commands);
}

function indexDerivedRecords(
  values: readonly unknown[],
  recordType: "head" | "projection",
  scope: PosJournalScope,
): Map<string, unknown> {
  const indexed = new Map<string, unknown>();
  const prefix = `${scope.branchId}\u0000`;
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new PosJournalIntegrityError(`Saved ${recordType} is malformed.`);
    const record = value as { aggregateKey?: unknown };
    if (
      typeof record.aggregateKey !== "string" ||
      !record.aggregateKey.startsWith(prefix)
    )
      throw new PosJournalIntegrityError(
        `Saved ${recordType} is outside the active branch scope.`,
      );
    const aggregateId = record.aggregateKey.slice(prefix.length);
    try {
      assertId(aggregateId, "aggregateId");
    } catch {
      throw new PosJournalIntegrityError(
        `Saved ${recordType} key is malformed.`,
      );
    }
    if (indexed.has(record.aggregateKey))
      throw new PosJournalIntegrityError(`Duplicate saved ${recordType} key.`);
    indexed.set(record.aggregateKey, value);
  }
  return indexed;
}

function assertCommandInScope(
  command: PosJournalCommand,
  scope: PosJournalScope,
): void {
  if (
    command.branchId !== scope.branchId ||
    command.deviceId !== scope.deviceId
  )
    throw new PosJournalIntegrityError(
      "Command is stored outside its branch/device database.",
    );
}

function asIntegrityError(error: unknown, message: string): PosJournalError {
  return error instanceof PosJournalIntegrityError
    ? error
    : new PosJournalIntegrityError(message);
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(name, 1);
    } catch (error) {
      reject(openFailure(error));
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      const upgrade = request.transaction;
      if (!upgrade) return;
      const commands = database.objectStoreNames.contains(storeNames.commands)
        ? upgrade.objectStore(storeNames.commands)
        : database.createObjectStore(storeNames.commands, {
            keyPath: "commandId",
          });
      if (!commands.indexNames.contains("byAggregateRevision"))
        commands.createIndex(
          "byAggregateRevision",
          ["aggregateKey", "revision"],
          { unique: true },
        );
      if (!commands.indexNames.contains("byActorOccurredAt"))
        commands.createIndex("byActorOccurredAt", ["actorId", "occurredAt"]);
      if (!database.objectStoreNames.contains(storeNames.heads))
        database.createObjectStore(storeNames.heads, {
          keyPath: "aggregateKey",
        });
      if (!database.objectStoreNames.contains(storeNames.projections))
        database.createObjectStore(storeNames.projections, {
          keyPath: "aggregateKey",
        });
      if (!database.objectStoreNames.contains(storeNames.receipts))
        database.createObjectStore(storeNames.receipts, {
          keyPath: "commandId",
        });
      if (!database.objectStoreNames.contains(storeNames.blocks))
        database.createObjectStore(storeNames.blocks, { keyPath: "commandId" });
      if (!database.objectStoreNames.contains(storeNames.conflicts))
        database.createObjectStore(storeNames.conflicts, {
          keyPath: "command.commandId",
        });
      if (!database.objectStoreNames.contains(storeNames.diagnostics))
        database.createObjectStore(storeNames.diagnostics, {
          keyPath: "diagnosticId",
        });
    };
    let settled = false;
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(openFailure(request.error));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(
        new PosJournalError(
          "LOCAL_DATABASE_UPGRADE_BLOCKED",
          "Another open POS tab is preventing local storage from opening.",
        ),
      );
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      if (database.version !== POS_JOURNAL_SCHEMA_VERSION) {
        settled = true;
        database.close();
        reject(
          new PosJournalError(
            "LOCAL_SCHEMA_VERSION_UNSUPPORTED",
            "Local POS data was written by a different application version and cannot be opened safely.",
          ),
        );
        return;
      }
      settled = true;
      resolve(database);
    };
  });
}

function openFailure(error: unknown): PosJournalError {
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "VersionError"
  )
    return new PosJournalError(
      "LOCAL_SCHEMA_VERSION_UNSUPPORTED",
      "Local POS data was written by a newer application version and cannot be opened safely.",
    );
  return storageError();
}

function validateScope(scope: PosJournalScope): void {
  if (!scope || typeof scope !== "object")
    throw new TypeError("Journal scope is required.");
  assertId(scope.branchId, "branchId");
  assertId(scope.deviceId, "deviceId");
}

function validateStoredCommand(command: PosJournalCommand): void {
  const input: PosSnapshotCommandInput = {
    commandId: command.commandId,
    branchId: command.branchId,
    aggregateId: command.aggregateId,
    actorId: command.actorId,
    deviceId: command.deviceId,
    occurredAt: command.occurredAt,
    schemaVersion: command.schemaVersion,
    expectedRevision: command.expectedRevision,
    action: command.action,
    payload: command.payload,
  };
  validatePosSnapshotCommand(input, {
    branchId: command.branchId,
    deviceId: command.deviceId,
  });
  assertOnlyKeys(command, [
    "commandId",
    "branchId",
    "aggregateId",
    "actorId",
    "deviceId",
    "occurredAt",
    "schemaVersion",
    "expectedRevision",
    "action",
    "payload",
    "aggregateKey",
    "revision",
  ]);
  if (
    typeof command.aggregateKey !== "string" ||
    command.aggregateKey.length > 322
  )
    throw new PosJournalIntegrityError(
      "Stored command aggregate key is invalid.",
    );
  if (!Number.isSafeInteger(command.revision) || command.revision < 1)
    throw new PosJournalIntegrityError("Stored command revision is invalid.");
  if (command.expectedRevision !== command.revision - 1)
    throw new PosJournalIntegrityError(
      "Stored command expected revision is inconsistent.",
    );
  if (
    command.aggregateKey !==
    createAggregateKey(command.branchId, command.aggregateId)
  )
    throw new PosJournalIntegrityError(
      "Stored command aggregate key is invalid.",
    );
}

function validateOrderSnapshot(
  value: PosOrderSnapshot,
  aggregateId: string,
): void {
  if (!value || typeof value !== "object")
    throw new TypeError("Order snapshot is required.");
  assertOnlyKeys(value, [
    "orderId",
    "status",
    "orderType",
    "tableId",
    "customer",
    "lines",
    "subtotalCents",
    "discountCents",
    "totalCents",
    "currency",
    "capturedAt",
  ]);
  assertId(value.orderId, "orderId");
  if (value.orderId !== aggregateId)
    throw new TypeError("orderId must match aggregateId.");
  if (value.status !== "draft" && value.status !== "open")
    throw new PosJournalError(
      "UNSUPPORTED_ORDER_STATE",
      "Only draft and open orders are supported locally.",
    );
  if (
    !(["dine-in", "pickup", "delivery", "counter"] as string[]).includes(
      value.orderType,
    )
  )
    throw new TypeError("orderType is unsupported.");
  if (value.tableId !== null) assertId(value.tableId, "tableId");
  if (value.customer !== null) {
    assertOnlyKeys(value.customer, ["name", "phone", "address"]);
    for (const field of ["name", "phone", "address"] as const) {
      const item = value.customer?.[field];
      if (item !== null && typeof item !== "string")
        throw new TypeError(`customer.${field} must be a string or null.`);
      if (typeof item === "string" && item.length > 500)
        throw new RangeError(`customer.${field} is too long.`);
    }
  }
  if (!Array.isArray(value.lines))
    throw new TypeError("Order lines must be an array.");
  const lineIds = new Set<string>();
  let computedSubtotal = 0;
  const lines = value.lines as readonly OrderLineSnapshot[];
  for (const line of lines) {
    validateOrderLine(line);
    if (lineIds.has(line.lineId))
      throw new TypeError("Order line IDs must be unique.");
    lineIds.add(line.lineId);
    const modifierCents = line.modifierSnapshots.reduce(
      (sum, modifier) => sum + modifier.priceDeltaCents,
      0,
    );
    const unitCents = line.unitPriceCents + modifierCents;
    const lineCents = unitCents * line.quantity;
    if (
      !Number.isSafeInteger(modifierCents) ||
      !Number.isSafeInteger(unitCents) ||
      !Number.isSafeInteger(lineCents)
    )
      throw new RangeError(
        "Captured order line total exceeds safe integer range.",
      );
    computedSubtotal += lineCents;
    if (!Number.isSafeInteger(computedSubtotal))
      throw new RangeError("Order subtotal exceeds safe integer range.");
  }
  assertMoney(value.subtotalCents, "subtotalCents");
  assertMoney(value.discountCents, "discountCents");
  assertMoney(value.totalCents, "totalCents");
  if (value.discountCents > value.subtotalCents)
    throw new RangeError("Discount cannot exceed the saved subtotal.");
  if (computedSubtotal !== value.subtotalCents)
    throw new RangeError("Subtotal must equal the captured line snapshots.");
  if (value.totalCents !== value.subtotalCents - value.discountCents)
    throw new RangeError("Total must equal subtotal after the saved discount.");
  if (value.currency !== "MXN")
    throw new TypeError("POS order currency must be MXN.");
  assertUtcInstant(value.capturedAt, "order.capturedAt");
  assertJsonValue(value);
}

function validateOrderLine(line: OrderLineSnapshot): void {
  if (!line || typeof line !== "object")
    throw new TypeError("Order line snapshot is required.");
  assertOnlyKeys(line, [
    "lineId",
    "productId",
    "productNameSnapshot",
    "unitPriceCents",
    "quantity",
    "taxRateBasisPoints",
    "priceIncludesTax",
    "catalogPriceVersionId",
    "modifierSnapshots",
    "notesSnapshot",
  ]);
  assertId(line.lineId, "lineId");
  assertId(line.productId, "productId");
  assertId(line.catalogPriceVersionId, "catalogPriceVersionId");
  if (
    typeof line.productNameSnapshot !== "string" ||
    !line.productNameSnapshot.trim()
  )
    throw new TypeError("productNameSnapshot is required.");
  if (line.productNameSnapshot.length > 200)
    throw new RangeError("productNameSnapshot is too long.");
  assertMoney(line.unitPriceCents, "unitPriceCents");
  if (!Number.isSafeInteger(line.quantity) || line.quantity < 1)
    throw new RangeError("Line quantity must be a positive safe integer.");
  if (
    !Number.isSafeInteger(line.taxRateBasisPoints) ||
    line.taxRateBasisPoints < 0
  )
    throw new RangeError(
      "taxRateBasisPoints must be a non-negative safe integer.",
    );
  if (line.priceIncludesTax !== true)
    throw new TypeError("Captured POS prices must include tax.");
  if (!Array.isArray(line.modifierSnapshots))
    throw new TypeError("Modifier snapshots are required.");
  for (const modifier of line.modifierSnapshots) {
    assertOnlyKeys(modifier, [
      "modifierId",
      "nameSnapshot",
      "priceDeltaCents",
      "taxRateBasisPoints",
      "priceIncludesTax",
    ]);
    assertId(modifier.modifierId, "modifierId");
    if (
      typeof modifier.nameSnapshot !== "string" ||
      !modifier.nameSnapshot.trim()
    )
      throw new TypeError("Modifier name snapshot is required.");
    assertMoney(modifier.priceDeltaCents, "priceDeltaCents");
    if (
      !Number.isSafeInteger(modifier.taxRateBasisPoints) ||
      modifier.taxRateBasisPoints < 0
    )
      throw new RangeError(
        "Modifier tax rate must be a non-negative safe integer.",
      );
    if (modifier.priceIncludesTax !== true)
      throw new TypeError("Captured modifier prices must include tax.");
  }
  if (line.notesSnapshot !== undefined) {
    if (typeof line.notesSnapshot !== "string")
      throw new TypeError("Line notes must be a string when present.");
    if (line.notesSnapshot.length > 1000)
      throw new RangeError("Line notes are too long.");
  }
}

function validateReceipt(receipt: PosServerReceipt): void {
  if (!receipt || typeof receipt !== "object")
    throw new TypeError("Server receipt is required.");
  assertOnlyKeys(receipt, ["commandId", "serverReceivedAt", "outcome"]);
  assertId(receipt.commandId, "commandId");
  assertUtcInstant(receipt.serverReceivedAt, "serverReceivedAt");
  if (receipt.outcome !== "inserted" && receipt.outcome !== "identical-retry")
    throw new TypeError("Server receipt outcome is invalid.");
}

function validateSyncBlock(block: PosSyncBlock): void {
  if (!block || typeof block !== "object")
    throw new TypeError("Sync block is required.");
  assertOnlyKeys(block, ["commandId", "code", "blockedAt"]);
  assertId(block.commandId, "commandId");
  if (
    typeof block.code !== "string" ||
    !/^[A-Z0-9_.:-]{1,80}$/.test(block.code)
  )
    throw new TypeError("Sync block code must be a bounded safe code.");
  assertUtcInstant(block.blockedAt, "blockedAt");
}

function validateRevisionConflict(
  conflict: PosRevisionConflict,
  scope: PosJournalScope,
): void {
  if (!conflict || typeof conflict !== "object")
    throw new PosJournalIntegrityError(
      "Stored revision conflict is malformed.",
    );
  assertOnlyKeys(conflict, [
    "command",
    "expectedRevision",
    "currentRevision",
    "detectedAt",
  ]);
  validatePosSnapshotCommand(conflict.command, scope);
  if (
    conflict.expectedRevision !== conflict.command.expectedRevision ||
    !Number.isSafeInteger(conflict.currentRevision) ||
    conflict.currentRevision < 0 ||
    conflict.currentRevision === conflict.expectedRevision
  )
    throw new PosJournalIntegrityError(
      "Stored revision conflict is inconsistent.",
    );
  assertUtcInstant(conflict.detectedAt, "detectedAt");
}

function validateDiagnostic(diagnostic: PosDiagnostic): void {
  if (!diagnostic || typeof diagnostic !== "object")
    throw new TypeError("Diagnostic record is required.");
  assertOnlyKeys(diagnostic, [
    "diagnosticId",
    "kind",
    "code",
    "recordedAt",
    "commandId",
  ]);
  assertId(diagnostic.diagnosticId, "diagnosticId");
  if (!["storage", "sync", "conflict", "recovery"].includes(diagnostic.kind))
    throw new TypeError("Diagnostic kind is unsupported.");
  if (
    typeof diagnostic.code !== "string" ||
    !/^[A-Z0-9_.:-]{1,80}$/.test(diagnostic.code)
  )
    throw new TypeError("Diagnostic code must be a bounded safe code.");
  assertUtcInstant(diagnostic.recordedAt, "recordedAt");
  if (diagnostic.commandId !== undefined)
    assertId(diagnostic.commandId, "commandId");
}

function assertId(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 160 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new TypeError(`${field} must be a non-empty bounded string.`);
}

function assertOnlyKeys(value: object, allowed: readonly string[]): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key)))
    throw new TypeError("Journal record contains unsupported fields.");
}

function assertMoney(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new RangeError(
      `${field} must be a non-negative safe integer in centavos.`,
    );
}

function assertUtcInstant(
  value: unknown,
  field: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|\+00:00)$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new TypeError(`${field} must be a UTC ISO-8601 timestamp.`);
}

function assertJsonValue(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("POS journal data must be finite JSON.");
    return;
  }
  if (typeof value !== "object")
    throw new TypeError("POS journal data must be JSON serializable.");
  if (seen.has(value))
    throw new TypeError("POS journal data cannot contain cycles.");
  seen.add(value);
  if (Array.isArray(value)) {
    for (const child of value) assertJsonValue(child, seen);
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new TypeError("POS journal objects must be plain JSON values.");
    for (const child of Object.values(value)) assertJsonValue(child, seen);
  }
  seen.delete(value);
}

function sameCommandContent(
  stored: PosJournalCommand,
  incoming: PosSnapshotCommandInput,
): boolean {
  const command: PosSnapshotCommandInput = {
    commandId: stored.commandId,
    branchId: stored.branchId,
    aggregateId: stored.aggregateId,
    actorId: stored.actorId,
    deviceId: stored.deviceId,
    occurredAt: stored.occurredAt,
    schemaVersion: stored.schemaVersion,
    expectedRevision: stored.expectedRevision,
    action: stored.action,
    payload: stored.payload,
  };
  return sameJson(command, incoming);
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`,
    )
    .join(",")}}`;
}

function createAggregateKey(branchId: string, aggregateId: string): string {
  return `${branchId}\u0000${aggregateId}`;
}

async function getScopedDatabaseName(
  scope: PosJournalScope,
  cryptoProvider: Crypto,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    `${scope.branchId}\u0000${scope.deviceId}`,
  );
  const digest = new Uint8Array(
    await cryptoProvider.subtle.digest("SHA-256", bytes),
  );
  const suffix = [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${databasePrefix}${suffix}`;
}

function storageError(): PosJournalError {
  return new PosJournalError(
    "LOCAL_STORAGE_FAILED",
    "The POS change could not be saved locally. No change was confirmed.",
  );
}
