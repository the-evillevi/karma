import {
  applyPosOperationToOwnedState,
  authorizePosOperationCommand,
  PosOperationError,
  PosOperationRevisionConflict,
  replayPosOperationsWithChanges,
  validatePosOperationCommand,
  type ExpectedAggregateRevision,
  type OperationAggregateKind,
  type PosOperationAuthority,
  type PosOperationCommand,
  type PosOperationOrder,
  type PosOperationPreparation,
  type PosOperationSale,
  type PosOperationsScope,
  type PosOperationsState,
} from "../domain/pos-operations.ts";

export const POS_OPERATIONS_DATABASE_VERSION = 1 as const;
const databasePrefix = "karma-pos-operations-v1-";

export interface PosOperationsJournalOptions {
  indexedDBFactory?: IDBFactory;
  cryptoProvider?: Crypto;
}

export interface StoredPosOperationCommand {
  commandId: string;
  branchId: string;
  deviceId: string;
  sequence: number;
  command: PosOperationCommand;
}

export interface PosOperationsRevisionConflict {
  conflictId?: number;
  branchId: string;
  deviceId: string;
  detectedAt: string;
  command: PosOperationCommand;
  expected: ExpectedAggregateRevision;
  actualRevision: number;
}

export interface PosOperationsDiagnostic {
  diagnosticId?: number;
  branchId: string;
  deviceId: string;
  kind: "conflict";
  code: string;
  recordedAt: string;
  commandId?: string;
}

export interface PosOperationsJournalSnapshot {
  scope: PosOperationsScope;
  state: PosOperationsState;
  commands: StoredPosOperationCommand[];
  conflicts: PosOperationsRevisionConflict[];
  diagnostics: PosOperationsDiagnostic[];
  remoteStatus: "not-connected";
}

export interface AppendPosOperationResult {
  command: PosOperationCommand;
  duplicate: boolean;
  /** Verified connected component only. Use readSnapshot for complete branch state. */
  component: PosOperationsState;
}

export class PosOperationsJournalError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

interface StoredScope {
  key: "scope";
  branchId: string;
  deviceId: string;
}

interface StoredSequence {
  key: "sequence";
  value: number;
}

interface StoredAggregateEvent {
  branchId: string;
  deviceId: string;
  kind: OperationAggregateKind;
  aggregateId: string;
  revision: number;
  commandId: string;
  sequence: number;
}

interface StoredAggregateHead {
  branchId: string;
  deviceId: string;
  kind: OperationAggregateKind;
  aggregateId: string;
  revision: number;
  lastCommandId: string;
}

type AggregateValue =
  PosOperationOrder | PosOperationPreparation | PosOperationSale;

interface StoredAggregateProjection {
  branchId: string;
  deviceId: string;
  kind: OperationAggregateKind;
  aggregateId: string;
  revision: number;
  lastCommandId: string;
  value: AggregateValue;
}

interface AggregateBundle {
  state: PosOperationsState;
  commands: StoredPosOperationCommand[];
}

const stores = {
  commands: "operationCommands",
  events: "aggregateEvents",
  heads: "aggregateHeads",
  projections: "aggregateProjections",
  conflicts: "revisionConflicts",
  diagnostics: "diagnostics",
  metadata: "metadata",
} as const;

const openJournals = new WeakMap<
  IDBFactory,
  Map<string, Promise<PosOperationsJournal>>
>();

/**
 * Open a production operational journal. This database intentionally has a
 * separate prefix and schema from the earlier draft/open snapshot journal.
 */
export async function openPosOperationsJournal(
  scope: PosOperationsScope,
  options: PosOperationsJournalOptions = {},
): Promise<PosOperationsJournal> {
  validateScope(scope);
  const frozenScope = Object.freeze(structuredClone(scope));
  const factory = options.indexedDBFactory ?? globalThis.indexedDB;
  const cryptoProvider = options.cryptoProvider ?? globalThis.crypto;
  if (!factory || !cryptoProvider?.subtle)
    throw new PosOperationsJournalError(
      "LOCAL_STORAGE_UNAVAILABLE",
      "Durable operational storage is unavailable.",
    );

  const databaseName = await scopedDatabaseName(frozenScope, cryptoProvider);
  let byName = openJournals.get(factory);
  if (!byName) {
    byName = new Map();
    openJournals.set(factory, byName);
  }
  const existing = byName.get(databaseName);
  if (existing) return existing;

  let journal!: PosOperationsJournal;
  const opening = (async () => {
    const database = await openDatabase(factory, databaseName);
    const removeFromCache = () => {
      if (byName?.get(databaseName) === opening) byName.delete(databaseName);
    };
    journal = new PosOperationsJournal(database, frozenScope, removeFromCache);
    try {
      await journal.bindOrValidateScope();
      await journal.readSnapshot();
      return journal;
    } catch (error) {
      journal.close();
      throw error;
    }
  })();
  byName.set(databaseName, opening);
  try {
    return await opening;
  } catch (error) {
    if (byName.get(databaseName) === opening) byName.delete(databaseName);
    throw error;
  }
}

export class PosOperationsJournal {
  private closed = false;

  constructor(
    private readonly database: IDBDatabase,
    readonly scope: Readonly<PosOperationsScope>,
    private readonly removeFromCache: () => void,
  ) {
    this.database.onversionchange = () => this.invalidate();
  }

  /** Full cold-start/snapshot replay. It validates every saved record. */
  async readSnapshot(): Promise<PosOperationsJournalSnapshot> {
    this.assertOpen();
    const transaction = this.database.transaction(
      [
        stores.commands,
        stores.events,
        stores.heads,
        stores.projections,
        stores.conflicts,
        stores.diagnostics,
        stores.metadata,
      ],
      "readonly",
    );
    const done = transactionDone(transaction);
    let raw: SnapshotRecords;
    try {
      raw = await readSnapshotRecords(transaction);
      await done;
    } catch (error) {
      abortQuietly(transaction);
      await settleTransaction(done);
      throw asStorageError(error);
    }
    try {
      return validateSnapshotRecords(this.scope, raw);
    } catch (error) {
      throw asIntegrityError(error, "Could not verify operational history.");
    }
  }

  /**
   * Atomically append one immutable operation and all of its affected
   * projections/heads. `authority` must be the caller's fresh verified access
   * context; persisted roster or actor data is never used as authority.
   */
  async append(
    candidate: unknown,
    authority: PosOperationAuthority,
  ): Promise<AppendPosOperationResult> {
    this.assertOpen();
    const command = validatePosOperationCommand(candidate);
    const transaction = this.database.transaction(
      [
        stores.commands,
        stores.events,
        stores.heads,
        stores.projections,
        stores.conflicts,
        stores.diagnostics,
        stores.metadata,
      ],
      "readwrite",
    );
    const done = transactionDone(transaction);
    let result: AppendPosOperationResult | undefined;
    let failure: unknown;
    let retainedConflict = false;

    try {
      // Check current authority before inspecting an identical retry or a
      // previously rejected command ID.
      authorizePosOperationCommand(command, authority);
      const storedCommands = transaction.objectStore(stores.commands);
      const priorStored = await requestResult<
        StoredPosOperationCommand | undefined
      >(storedCommands.get(command.commandId));
      await validateCommandLedgerTail(transaction, this.scope);
      const initialRefs = [...command.expectedRevisions];
      if (priorStored) {
        try {
          validateStoredCommand(this.scope, priorStored);
        } catch (error) {
          throw asIntegrityError(error, "Retried command record is malformed.");
        }
        initialRefs.push(...priorStored.command.expectedRevisions);
      }
      let bundle: AggregateBundle;
      try {
        bundle = await loadAndValidateComponent(
          transaction,
          this.scope,
          initialRefs,
        );
      } catch (error) {
        if (error instanceof PosOperationsJournalError) throw error;
        if (
          typeof DOMException !== "undefined" &&
          error instanceof DOMException
        )
          throw asStorageError(error);
        throw integrity("Connected aggregate history failed validation.");
      }

      const priorConflicts = await requestResult<unknown[]>(
        transaction
          .objectStore(stores.conflicts)
          .index("byCommandId")
          .getAll(command.commandId),
      );
      for (const rawConflict of priorConflicts) {
        const conflict = validateStoredConflict(this.scope, rawConflict);
        if (stableJson(conflict.command) !== stableJson(command))
          throw new PosOperationError(
            "OPERATION_COMMAND_ID_CONFLICT",
            "Command ID was reused with different immutable content.",
          );
      }

      let applied;
      try {
        // This performs current-context identity and capability checks before
        // identical-retry recognition, including after actor revocation.
        if (
          priorStored &&
          !bundle.commands.some(
            (record) => record.commandId === command.commandId,
          )
        )
          throw integrity(
            "Existing command is missing from connected aggregate history.",
          );
        applied = applyPosOperationToOwnedState(
          bundle.state,
          command,
          authority,
        );
      } catch (error) {
        if (error instanceof PosOperationRevisionConflict) {
          const detectedAt = new Date().toISOString();
          try {
            transaction.objectStore(stores.conflicts).add({
              branchId: this.scope.branchId,
              deviceId: this.scope.deviceId,
              detectedAt,
              command,
              expected: error.aggregate,
              actualRevision: error.actualRevision,
            } satisfies PosOperationsRevisionConflict);
            transaction.objectStore(stores.diagnostics).add({
              branchId: this.scope.branchId,
              deviceId: this.scope.deviceId,
              kind: "conflict",
              code: error.code,
              recordedAt: detectedAt,
              commandId: command.commandId,
            } satisfies PosOperationsDiagnostic);
            failure = error;
            retainedConflict = true;
          } catch (writeError) {
            failure = asStorageError(writeError);
            abortQuietly(transaction);
          }
        } else {
          failure = error;
          abortQuietly(transaction);
        }
        applied = undefined;
      }

      if (applied) {
        if (applied.duplicate) {
          result = {
            command,
            duplicate: true,
            component: applied.state,
          };
        } else {
          const metadata = transaction.objectStore(stores.metadata);
          const sequenceEntry = await requestResult<StoredSequence | undefined>(
            metadata.get("sequence"),
          );
          const priorSequence = sequenceEntry?.value ?? 0;
          if (
            !Number.isSafeInteger(priorSequence) ||
            priorSequence < 0 ||
            priorSequence === Number.MAX_SAFE_INTEGER
          )
            throw new PosOperationsJournalError(
              "LOCAL_SEQUENCE_INVALID",
              "Operational command sequence is invalid.",
            );
          const sequence = priorSequence + 1;
          const stored: StoredPosOperationCommand = {
            commandId: command.commandId,
            branchId: this.scope.branchId,
            deviceId: this.scope.deviceId,
            sequence,
            command,
          };
          storedCommands.add(stored);
          metadata.put({
            key: "sequence",
            value: sequence,
          } satisfies StoredSequence);

          for (const ref of applied.changedAggregates) {
            const revision = ref.revision;
            const value = aggregateValue(applied.state, ref.kind, ref.id);
            if (!value || value.revision !== revision)
              throw new PosOperationsJournalError(
                "LOCAL_REDUCTION_INTEGRITY_ERROR",
                "Reducer output does not match the guarded aggregate revision.",
              );
            const event: StoredAggregateEvent = {
              branchId: this.scope.branchId,
              deviceId: this.scope.deviceId,
              kind: ref.kind,
              aggregateId: ref.id,
              revision,
              commandId: command.commandId,
              sequence,
            };
            const head: StoredAggregateHead = {
              branchId: this.scope.branchId,
              deviceId: this.scope.deviceId,
              kind: ref.kind,
              aggregateId: ref.id,
              revision,
              lastCommandId: command.commandId,
            };
            const projection: StoredAggregateProjection = {
              branchId: this.scope.branchId,
              deviceId: this.scope.deviceId,
              kind: ref.kind,
              aggregateId: ref.id,
              revision,
              lastCommandId: command.commandId,
              value,
            };
            transaction.objectStore(stores.events).add(event);
            transaction.objectStore(stores.heads).put(head);
            transaction.objectStore(stores.projections).put(projection);
          }
          result = {
            command,
            duplicate: false,
            component: applied.state,
          };
        }
      }
    } catch (error) {
      if (!failure)
        failure =
          error instanceof PosOperationError ||
          error instanceof PosOperationsJournalError
            ? error
            : asStorageError(error);
      if (!retainedConflict) abortQuietly(transaction);
    }

    try {
      await done;
    } catch (error) {
      if (retainedConflict) failure = asStorageError(error);
      else if (!failure) failure = asStorageError(error);
    }
    if (failure) throw failure;
    if (!result)
      throw new PosOperationsJournalError(
        "LOCAL_TRANSACTION_NO_RESULT",
        "Operational transaction completed without a result.",
      );
    return result;
  }

  close(): void {
    this.invalidate();
  }

  async bindOrValidateScope(): Promise<void> {
    const transaction = this.database.transaction(
      [stores.metadata],
      "readwrite",
    );
    const done = transactionDone(transaction);
    try {
      const metadata = transaction.objectStore(stores.metadata);
      const stored = await requestResult<StoredScope | undefined>(
        metadata.get("scope"),
      );
      if (!stored) {
        metadata.add({
          key: "scope",
          branchId: this.scope.branchId,
          deviceId: this.scope.deviceId,
        } satisfies StoredScope);
      } else {
        validateStoredScope(this.scope, stored);
      }
      await done;
    } catch (error) {
      abortQuietly(transaction);
      await settleTransaction(done);
      if (error instanceof PosOperationsJournalError) throw error;
      if (typeof DOMException !== "undefined" && error instanceof DOMException)
        throw asStorageError(error);
      throw asIntegrityError(error, "Operational database scope is invalid.");
    }
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
      throw new PosOperationsJournalError(
        "LOCAL_DATABASE_CLOSED",
        "Operational POS journal is closed.",
      );
  }
}

interface SnapshotRecords {
  metadata: unknown[];
  commands: unknown[];
  events: unknown[];
  heads: unknown[];
  projections: unknown[];
  conflicts: unknown[];
  diagnostics: unknown[];
}

async function readSnapshotRecords(
  transaction: IDBTransaction,
): Promise<SnapshotRecords> {
  const [
    metadata,
    commands,
    events,
    heads,
    projections,
    conflicts,
    diagnostics,
  ] = await Promise.all([
    requestResult<unknown[]>(transaction.objectStore(stores.metadata).getAll()),
    requestResult<unknown[]>(transaction.objectStore(stores.commands).getAll()),
    requestResult<unknown[]>(transaction.objectStore(stores.events).getAll()),
    requestResult<unknown[]>(transaction.objectStore(stores.heads).getAll()),
    requestResult<unknown[]>(
      transaction.objectStore(stores.projections).getAll(),
    ),
    requestResult<unknown[]>(
      transaction.objectStore(stores.conflicts).getAll(),
    ),
    requestResult<unknown[]>(
      transaction.objectStore(stores.diagnostics).getAll(),
    ),
  ]);
  return {
    metadata,
    commands,
    events,
    heads,
    projections,
    conflicts,
    diagnostics,
  };
}

function validateSnapshotRecords(
  scope: Readonly<PosOperationsScope>,
  raw: SnapshotRecords,
): PosOperationsJournalSnapshot {
  let scopeEntry: unknown;
  let sequenceEntry: unknown;
  for (const entry of raw.metadata) {
    if (!isRecord(entry) || typeof entry.key !== "string")
      throw integrity("Saved operational metadata is malformed.");
    if (entry.key === "scope") {
      if (scopeEntry !== undefined)
        throw integrity("Saved scope metadata is duplicated.");
      scopeEntry = entry;
    } else if (entry.key === "sequence") {
      if (sequenceEntry !== undefined)
        throw integrity("Saved sequence metadata is duplicated.");
      sequenceEntry = entry;
    } else {
      throw integrity(
        "Saved operational metadata contains an unsupported record.",
      );
    }
  }
  validateStoredScope(scope, scopeEntry);
  let lastSequence = 0;
  if (sequenceEntry !== undefined) {
    assertExactKeys(sequenceEntry, ["key", "value"]);
    const value = sequenceEntry as StoredSequence;
    if (
      value.key !== "sequence" ||
      !Number.isSafeInteger(value.value) ||
      value.value < 0
    )
      throw integrity("Saved command sequence is malformed.");
    lastSequence = value.value;
  }

  const commands = raw.commands.map((value) =>
    validateStoredCommand(scope, value),
  );
  commands.sort((left, right) => left.sequence - right.sequence);
  if (commands.length !== lastSequence)
    throw integrity(
      "Saved command sequence differs from the immutable command ledger.",
    );
  for (let index = 0; index < commands.length; index += 1) {
    if (commands[index]!.sequence !== index + 1)
      throw integrity(
        "Saved immutable command sequence has a gap or duplicate.",
      );
  }

  const replay = replayPosOperationsWithChanges(
    scope,
    commands.map((record) => record.command),
  );
  const state = replay.state;
  const expectedEvents = deriveEvents(scope, commands, replay.steps);
  const events = raw.events.map((value) => validateStoredEvent(scope, value));
  assertSameRecords(
    events,
    expectedEvents,
    "Aggregate event index differs from command history.",
  );

  const latestEvents = new Map<string, StoredAggregateEvent>();
  for (const event of expectedEvents) {
    const key = aggregateKey(event.kind, event.aggregateId);
    const previous = latestEvents.get(key);
    if (!previous || event.revision > previous.revision)
      latestEvents.set(key, event);
  }
  const expectedHeads: StoredAggregateHead[] = [];
  const expectedProjections: StoredAggregateProjection[] = [];
  for (const event of latestEvents.values()) {
    const value = aggregateValue(state, event.kind, event.aggregateId);
    if (!value || value.revision !== event.revision)
      throw integrity(
        "Replayed aggregate is missing its final command revision.",
      );
    expectedHeads.push({
      branchId: scope.branchId,
      deviceId: scope.deviceId,
      kind: event.kind,
      aggregateId: event.aggregateId,
      revision: event.revision,
      lastCommandId: event.commandId,
    });
    expectedProjections.push({
      branchId: scope.branchId,
      deviceId: scope.deviceId,
      kind: event.kind,
      aggregateId: event.aggregateId,
      revision: event.revision,
      lastCommandId: event.commandId,
      value,
    });
  }
  assertSameRecords(
    raw.heads.map((value) => validateStoredHead(scope, value)),
    expectedHeads,
    "Aggregate heads differ from immutable command history.",
  );
  assertSameRecords(
    raw.projections.map((value) => validateStoredProjection(scope, value)),
    expectedProjections,
    "Aggregate projections differ from immutable command replay.",
  );
  const conflicts = raw.conflicts.map((value) =>
    validateStoredConflict(scope, value),
  );
  const diagnostics = raw.diagnostics.map((value) =>
    validateStoredDiagnostic(scope, value),
  );

  return {
    scope: structuredClone(scope),
    state,
    commands,
    conflicts,
    diagnostics,
    remoteStatus: "not-connected",
  };
}

async function loadAndValidateComponent(
  transaction: IDBTransaction,
  scope: Readonly<PosOperationsScope>,
  initialRefs: readonly ExpectedAggregateRevision[],
): Promise<AggregateBundle> {
  const wanted = new Map<string, ExpectedAggregateRevision>();
  const queue = [...initialRefs];
  for (let index = 0; index < queue.length; index += 1) {
    const ref = queue[index]!;
    const key = aggregateKey(ref.kind, ref.id);
    if (wanted.has(key)) continue;
    wanted.set(key, { kind: ref.kind, id: ref.id, revision: ref.revision });

    const eventRange = IDBKeyRange.bound(
      [ref.kind, ref.id, 1],
      [ref.kind, ref.id, Number.MAX_SAFE_INTEGER],
    );
    const indexed = await requestResult<unknown[]>(
      transaction.objectStore(stores.events).getAll(eventRange),
    );
    for (const rawEvent of indexed) {
      const event = validateStoredEvent(scope, rawEvent);
      if (event.kind !== ref.kind || event.aggregateId !== ref.id)
        throw integrity("Aggregate event index returned another aggregate.");
      const stored = await requestResult<unknown>(
        transaction.objectStore(stores.commands).get(event.commandId),
      );
      const record = validateStoredCommand(scope, stored);
      if (record.sequence !== event.sequence)
        throw integrity("Aggregate event sequence differs from its command.");
      for (const dependency of record.command.expectedRevisions) {
        const dependencyKey = aggregateKey(dependency.kind, dependency.id);
        if (!wanted.has(dependencyKey)) queue.push(dependency);
      }
    }
  }

  const allCommands = new Map<string, StoredPosOperationCommand>();
  const indexedEvents: StoredAggregateEvent[] = [];
  for (const ref of wanted.values()) {
    const indexed = await requestResult<unknown[]>(
      transaction
        .objectStore(stores.events)
        .getAll(
          IDBKeyRange.bound(
            [ref.kind, ref.id, 1],
            [ref.kind, ref.id, Number.MAX_SAFE_INTEGER],
          ),
        ),
    );
    for (const rawEvent of indexed) {
      const event = validateStoredEvent(scope, rawEvent);
      indexedEvents.push(event);
      const stored = await requestResult<unknown>(
        transaction.objectStore(stores.commands).get(event.commandId),
      );
      const record = validateStoredCommand(scope, stored);
      allCommands.set(record.commandId, record);
    }
  }
  const commands = [...allCommands.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const replay = replayPosOperationsWithChanges(
    scope,
    commands.map((record) => record.command),
  );
  const state = replay.state;
  const expectedEvents = deriveEvents(scope, commands, replay.steps);
  assertSameRecords(
    indexedEvents,
    expectedEvents,
    "Connected aggregate history is incomplete or corrupt.",
  );

  const heads: unknown[] = [];
  const projections: unknown[] = [];
  for (const ref of wanted.values()) {
    heads.push(
      await requestResult<unknown>(
        transaction.objectStore(stores.heads).get([ref.kind, ref.id]),
      ),
    );
    projections.push(
      await requestResult<unknown>(
        transaction.objectStore(stores.projections).get([ref.kind, ref.id]),
      ),
    );
  }
  const latestEvents = latestEventByAggregate(expectedEvents);
  const expectedHeads: StoredAggregateHead[] = [];
  const expectedProjections: StoredAggregateProjection[] = [];
  for (const ref of wanted.values()) {
    const latest = latestEvents.get(aggregateKey(ref.kind, ref.id));
    const savedHead = heads.find(
      (value) =>
        isRecord(value) &&
        value.kind === ref.kind &&
        value.aggregateId === ref.id,
    );
    const savedProjection = projections.find(
      (value) =>
        isRecord(value) &&
        value.kind === ref.kind &&
        value.aggregateId === ref.id,
    );
    if (!latest) {
      if (savedHead !== undefined || savedProjection !== undefined)
        throw integrity(
          "Aggregate head or projection exists without command history.",
        );
      continue;
    }
    const value = aggregateValue(state, ref.kind, ref.id);
    if (!value || value.revision !== latest.revision)
      throw integrity(
        "Connected replay differs from its aggregate event head.",
      );
    expectedHeads.push({
      branchId: scope.branchId,
      deviceId: scope.deviceId,
      kind: ref.kind,
      aggregateId: ref.id,
      revision: latest.revision,
      lastCommandId: latest.commandId,
    });
    expectedProjections.push({
      branchId: scope.branchId,
      deviceId: scope.deviceId,
      kind: ref.kind,
      aggregateId: ref.id,
      revision: latest.revision,
      lastCommandId: latest.commandId,
      value,
    });
  }
  const presentHeads = heads
    .filter((value) => value !== undefined)
    .map((value) => validateStoredHead(scope, value));
  const presentProjections = projections
    .filter((value) => value !== undefined)
    .map((value) => validateStoredProjection(scope, value));
  assertSameRecords(
    presentHeads,
    expectedHeads,
    "Connected aggregate head differs from replay.",
  );
  assertSameRecords(
    presentProjections,
    expectedProjections,
    "Connected aggregate projection differs from replay.",
  );

  return {
    state,
    commands,
  };
}

async function validateCommandLedgerTail(
  transaction: IDBTransaction,
  scope: Readonly<PosOperationsScope>,
): Promise<void> {
  const metadata = transaction.objectStore(stores.metadata);
  const commands = transaction.objectStore(stores.commands);
  const [storedScope, sequenceEntry, totalCount] = await Promise.all([
    requestResult<unknown>(metadata.get("scope")),
    requestResult<unknown>(metadata.get("sequence")),
    requestResult<number>(commands.count()),
  ]);
  validateStoredScope(scope, storedScope);
  let sequence = 0;
  if (sequenceEntry !== undefined) {
    assertExactKeys(sequenceEntry, ["key", "value"]);
    const record = sequenceEntry as StoredSequence;
    if (
      record.key !== "sequence" ||
      !Number.isSafeInteger(record.value) ||
      record.value < 0
    )
      throw integrity("Saved command sequence is malformed.");
    sequence = record.value;
  }
  if (totalCount !== sequence)
    throw integrity("Saved command count differs from the scoped sequence.");
  if (sequence === 0) return;
  const indexedCount = await requestResult<number>(
    commands.index("bySequence").count(IDBKeyRange.bound(1, sequence)),
  );
  if (indexedCount !== sequence)
    throw integrity("Saved immutable command sequence has a gap.");
  const last = await requestResult<unknown>(
    commands.index("bySequence").get(sequence),
  );
  const record = validateStoredCommand(scope, last);
  if (record.sequence !== sequence)
    throw integrity("Saved immutable command tail differs from its sequence.");
}

function deriveEvents(
  scope: Readonly<PosOperationsScope>,
  commands: readonly StoredPosOperationCommand[],
  steps: readonly {
    command: PosOperationCommand;
    changedAggregates: ExpectedAggregateRevision[];
  }[],
): StoredAggregateEvent[] {
  const events: StoredAggregateEvent[] = [];
  const stepByCommandId = new Map(
    steps.map((step) => [step.command.commandId, step] as const),
  );
  for (const record of commands) {
    const step = stepByCommandId.get(record.commandId);
    if (!step) throw integrity("Replay did not produce a command step.");
    for (const ref of step.changedAggregates) {
      events.push({
        branchId: scope.branchId,
        deviceId: scope.deviceId,
        kind: ref.kind,
        aggregateId: ref.id,
        revision: ref.revision,
        commandId: record.commandId,
        sequence: record.sequence,
      });
    }
  }
  return events;
}

function latestEventByAggregate(
  events: readonly StoredAggregateEvent[],
): Map<string, StoredAggregateEvent> {
  const latest = new Map<string, StoredAggregateEvent>();
  for (const event of events) {
    const key = aggregateKey(event.kind, event.aggregateId);
    const previous = latest.get(key);
    if (!previous || event.revision > previous.revision) latest.set(key, event);
  }
  return latest;
}

function aggregateValue(
  state: PosOperationsState,
  kind: OperationAggregateKind,
  id: string,
): AggregateValue | undefined {
  if (kind === "order") return state.orders.find((item) => item.orderId === id);
  if (kind === "preparation")
    return state.preparations.find((item) => item.preparationId === id);
  return state.sales.find((item) => item.saleId === id);
}

function validateStoredCommand(
  scope: Readonly<PosOperationsScope>,
  value: unknown,
): StoredPosOperationCommand {
  assertExactKeys(value, [
    "commandId",
    "branchId",
    "deviceId",
    "sequence",
    "command",
  ]);
  const record = value as StoredPosOperationCommand;
  const command = validatePosOperationCommand(record.command);
  if (
    record.branchId !== scope.branchId ||
    record.deviceId !== scope.deviceId ||
    record.commandId !== command.commandId ||
    command.branchId !== scope.branchId ||
    command.deviceId !== scope.deviceId ||
    !Number.isSafeInteger(record.sequence) ||
    record.sequence < 1
  )
    throw integrity(
      "Stored operation command is outside its scope or malformed.",
    );
  return { ...record, command };
}

function validateStoredEvent(
  scope: Readonly<PosOperationsScope>,
  value: unknown,
): StoredAggregateEvent {
  assertExactKeys(value, [
    "branchId",
    "deviceId",
    "kind",
    "aggregateId",
    "revision",
    "commandId",
    "sequence",
  ]);
  const event = value as StoredAggregateEvent;
  if (
    event.branchId !== scope.branchId ||
    event.deviceId !== scope.deviceId ||
    !isAggregateKind(event.kind) ||
    !isId(event.aggregateId) ||
    !Number.isSafeInteger(event.revision) ||
    event.revision < 1 ||
    !isId(event.commandId) ||
    !Number.isSafeInteger(event.sequence) ||
    event.sequence < 1
  )
    throw integrity("Stored aggregate event is malformed or out of scope.");
  return structuredClone(event);
}

function validateStoredHead(
  scope: Readonly<PosOperationsScope>,
  value: unknown,
): StoredAggregateHead {
  assertExactKeys(value, [
    "branchId",
    "deviceId",
    "kind",
    "aggregateId",
    "revision",
    "lastCommandId",
  ]);
  const head = value as StoredAggregateHead;
  if (
    head.branchId !== scope.branchId ||
    head.deviceId !== scope.deviceId ||
    !isAggregateKind(head.kind) ||
    !isId(head.aggregateId) ||
    !Number.isSafeInteger(head.revision) ||
    head.revision < 1 ||
    !isId(head.lastCommandId)
  )
    throw integrity("Stored aggregate head is malformed or out of scope.");
  return structuredClone(head);
}

function validateStoredProjection(
  scope: Readonly<PosOperationsScope>,
  value: unknown,
): StoredAggregateProjection {
  assertExactKeys(value, [
    "branchId",
    "deviceId",
    "kind",
    "aggregateId",
    "revision",
    "lastCommandId",
    "value",
  ]);
  const projection = value as StoredAggregateProjection;
  const valueId =
    isRecord(projection.value) && projection.kind === "order"
      ? projection.value.orderId
      : isRecord(projection.value) && projection.kind === "preparation"
        ? projection.value.preparationId
        : isRecord(projection.value) && projection.kind === "sale"
          ? projection.value.saleId
          : undefined;
  if (
    projection.branchId !== scope.branchId ||
    projection.deviceId !== scope.deviceId ||
    !isAggregateKind(projection.kind) ||
    !isId(projection.aggregateId) ||
    valueId !== projection.aggregateId ||
    !Number.isSafeInteger(projection.revision) ||
    projection.revision < 1 ||
    !isId(projection.lastCommandId)
  )
    throw integrity(
      "Stored aggregate projection is malformed or out of scope.",
    );
  return structuredClone(projection);
}

function validateStoredConflict(
  scope: Readonly<PosOperationsScope>,
  value: unknown,
): PosOperationsRevisionConflict {
  assertExactKeys(value, [
    "conflictId",
    "branchId",
    "deviceId",
    "detectedAt",
    "command",
    "expected",
    "actualRevision",
  ]);
  const conflict = value as PosOperationsRevisionConflict;
  validatePosOperationCommand(conflict.command);
  validateExpectedRef(conflict.expected);
  if (
    !Number.isSafeInteger(conflict.conflictId) ||
    conflict.branchId !== scope.branchId ||
    conflict.deviceId !== scope.deviceId ||
    conflict.command.branchId !== scope.branchId ||
    conflict.command.deviceId !== scope.deviceId ||
    !isUtcInstant(conflict.detectedAt) ||
    !Number.isSafeInteger(conflict.actualRevision) ||
    conflict.actualRevision < 0
  )
    throw integrity("Saved revision conflict is malformed or out of scope.");
  if (
    conflict.expected.revision === conflict.actualRevision ||
    !conflict.command.expectedRevisions.some(
      (ref) =>
        ref.kind === conflict.expected.kind &&
        ref.id === conflict.expected.id &&
        ref.revision === conflict.expected.revision,
    )
  )
    throw integrity(
      "Saved revision conflict does not match its attempted command.",
    );
  return structuredClone(conflict);
}

function validateStoredDiagnostic(
  scope: Readonly<PosOperationsScope>,
  value: unknown,
): PosOperationsDiagnostic {
  assertExactKeys(value, [
    "diagnosticId",
    "branchId",
    "deviceId",
    "kind",
    "code",
    "recordedAt",
    "commandId",
  ]);
  const diagnostic = value as PosOperationsDiagnostic;
  if (
    !Number.isSafeInteger(diagnostic.diagnosticId) ||
    diagnostic.branchId !== scope.branchId ||
    diagnostic.deviceId !== scope.deviceId ||
    diagnostic.kind !== "conflict" ||
    typeof diagnostic.code !== "string" ||
    diagnostic.code.length < 1 ||
    diagnostic.code.length > 120 ||
    !isUtcInstant(diagnostic.recordedAt) ||
    (diagnostic.commandId !== undefined && !isId(diagnostic.commandId))
  )
    throw integrity("Saved diagnostic is malformed or out of scope.");
  return structuredClone(diagnostic);
}

function validateStoredScope(
  scope: Readonly<PosOperationsScope>,
  value: unknown,
): asserts value is StoredScope {
  assertExactKeys(value, ["key", "branchId", "deviceId"]);
  const stored = value as StoredScope;
  if (
    stored.key !== "scope" ||
    stored.branchId !== scope.branchId ||
    stored.deviceId !== scope.deviceId
  )
    throw integrity(
      "Operational database belongs to a different branch or device.",
    );
}

function validateExpectedRef(
  value: unknown,
): asserts value is ExpectedAggregateRevision {
  assertExactKeys(value, ["kind", "id", "revision"]);
  const ref = value as ExpectedAggregateRevision;
  if (
    !isAggregateKind(ref.kind) ||
    !isId(ref.id) ||
    !Number.isSafeInteger(ref.revision) ||
    ref.revision < 0
  )
    throw integrity("Saved expected aggregate reference is malformed.");
}

function assertSameRecords<T>(
  actual: readonly T[],
  expected: readonly T[],
  message: string,
): void {
  const normalize = (items: readonly T[]) =>
    items.map(stableJson).sort((left, right) => left.localeCompare(right));
  const left = normalize(actual);
  const right = normalize(expected);
  if (
    left.length !== right.length ||
    left.some((record, index) => record !== right[index])
  )
    throw integrity(message);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function assertExactKeys(value: unknown, keys: readonly string[]): void {
  if (!isRecord(value))
    throw integrity("Saved operational record is malformed.");
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    throw integrity(
      "Saved operational record contains missing or unexpected fields.",
    );
}

function validateScope(scope: PosOperationsScope): void {
  if (!isRecord(scope) || !isId(scope.branchId) || !isId(scope.deviceId))
    throw new PosOperationsJournalError(
      "INVALID_LOCAL_SCOPE",
      "Branch and device IDs are required.",
    );
}

function isAggregateKind(value: unknown): value is OperationAggregateKind {
  return value === "order" || value === "preparation" || value === "sale";
}

function isId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 160 &&
    !/[\u0000-\u001f]/u.test(value)
  );
}

function isUtcInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function aggregateKey(kind: OperationAggregateKind, id: string): string {
  return `${kind}\u0000${id}`;
}

function integrity(message: string): PosOperationsJournalError {
  return new PosOperationsJournalError(
    "LOCAL_OPERATIONS_INTEGRITY_ERROR",
    message,
  );
}

function asIntegrityError(error: unknown, message: string): Error {
  if (error instanceof PosOperationsJournalError) return error;
  return integrity(message);
}

function asStorageError(error: unknown): PosOperationsJournalError {
  if (error instanceof PosOperationsJournalError) return error;
  if (error instanceof PosOperationError)
    return new PosOperationsJournalError(error.code, error.message);
  return new PosOperationsJournalError(
    "LOCAL_STORAGE_FAILURE",
    "The operational POS write was not committed.",
  );
}

function abortQuietly(transaction: IDBTransaction): void {
  try {
    transaction.abort();
  } catch {
    // The transaction may already be aborted or complete.
  }
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

async function settleTransaction(done: Promise<void>): Promise<void> {
  try {
    await done;
  } catch {
    // Preserve the operation error that caused the abort.
  }
}

async function scopedDatabaseName(
  scope: Readonly<PosOperationsScope>,
  cryptoProvider: Crypto,
): Promise<string> {
  const canonicalScope = stableJson({
    branchId: scope.branchId,
    deviceId: scope.deviceId,
  });
  const digest = await cryptoProvider.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalScope),
  );
  const suffix = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${databasePrefix}${suffix}`;
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(name, POS_OPERATIONS_DATABASE_VERSION);
    } catch (error) {
      reject(asStorageError(error));
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(stores.commands)) {
        const commands = database.createObjectStore(stores.commands, {
          keyPath: "commandId",
        });
        commands.createIndex("bySequence", "sequence", { unique: true });
      }
      if (!database.objectStoreNames.contains(stores.events))
        database.createObjectStore(stores.events, {
          keyPath: ["kind", "aggregateId", "revision"],
        });
      if (!database.objectStoreNames.contains(stores.heads))
        database.createObjectStore(stores.heads, {
          keyPath: ["kind", "aggregateId"],
        });
      if (!database.objectStoreNames.contains(stores.projections))
        database.createObjectStore(stores.projections, {
          keyPath: ["kind", "aggregateId"],
        });
      const conflicts = database.objectStoreNames.contains(stores.conflicts)
        ? request.transaction!.objectStore(stores.conflicts)
        : database.createObjectStore(stores.conflicts, {
            keyPath: "conflictId",
            autoIncrement: true,
          });
      if (!conflicts.indexNames.contains("byCommandId"))
        conflicts.createIndex("byCommandId", "command.commandId");
      if (!database.objectStoreNames.contains(stores.diagnostics))
        database.createObjectStore(stores.diagnostics, {
          keyPath: "diagnosticId",
          autoIncrement: true,
        });
      if (!database.objectStoreNames.contains(stores.metadata))
        database.createObjectStore(stores.metadata, { keyPath: "key" });
    };
    let settled = false;
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(asStorageError(request.error));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(
        new PosOperationsJournalError(
          "LOCAL_DATABASE_UPGRADE_BLOCKED",
          "Another open POS tab is preventing operational storage from opening.",
        ),
      );
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      if (database.version !== POS_OPERATIONS_DATABASE_VERSION) {
        settled = true;
        database.close();
        reject(
          new PosOperationsJournalError(
            "LOCAL_DATABASE_VERSION_MISMATCH",
            "Operational POS storage has an unsupported version.",
          ),
        );
        return;
      }
      settled = true;
      resolve(database);
    };
  });
}
