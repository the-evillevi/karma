import test from "node:test";
import assert from "node:assert/strict";
import {
  assertExpectedSequence,
  decodeCommandBatch,
  encodeCommandBatch,
  MAX_COMMAND_BYTES,
  MAX_EVENTS_PER_COMMAND,
  validateCommandBatch,
  validateProtocolMessage,
} from "./protocol.js";

test("command-batch encoding is deterministic and preserves ordered EVL-113 identity", () => {
  const batch = commandBatch();
  const variant = { ...batch, events: batch.events.map((event) => ({
    payload: event.payload,
    occurredAt: event.occurredAt,
    deviceId: event.deviceId,
    actorId: event.actorId,
    schemaVersion: event.schemaVersion,
    type: event.type,
    aggregateId: event.aggregateId,
    commandId: event.commandId,
    eventId: event.eventId,
  })) };
  const first = encodeCommandBatch(batch);
  const second = encodeCommandBatch(variant);
  assert.deepEqual(first, second);

  const decoded = decodeCommandBatch(first);
  assert.equal(decoded.commandId, batch.commandId);
  assert.equal(decoded.actorId, batch.actorId);
  assert.equal(decoded.deviceId, batch.deviceId);
  assert.deepEqual(decoded.events.map((event) => event.eventId), ["event-1", "event-2"]);
  assert.equal(decoded.events[1].payload.lineNameSnapshot, "Latte chai");
});

test("batch validator rejects mixed metadata, duplicate IDs, unsupported schema, and over-limit input", () => {
  const mixed = commandBatch();
  mixed.events[1].actorId = "another-actor";
  assert.throws(() => validateCommandBatch(mixed), { code: "INVALID_BATCH" });

  const duplicate = commandBatch();
  duplicate.events[1].eventId = duplicate.events[0].eventId;
  assert.throws(() => encodeCommandBatch(duplicate), { code: "INVALID_BATCH" });

  const unsupported = commandBatch();
  unsupported.schemaVersion = 2;
  unsupported.events.forEach((event) => { event.schemaVersion = 2; });
  assert.throws(() => encodeCommandBatch(unsupported), { code: "UNSUPPORTED_SCHEMA" });

  const tooMany = commandBatch();
  tooMany.events = Array.from({ length: MAX_EVENTS_PER_COMMAND + 1 }, (_, index) => ({
    ...commandBatch().events[0],
    eventId: `event-${index}`,
  }));
  assert.throws(() => validateCommandBatch(tooMany), { code: "TOO_LARGE" });

  const tooLarge = commandBatch();
  tooLarge.events[0].payload.noteSnapshot = "x".repeat(MAX_COMMAND_BYTES);
  assert.throws(() => encodeCommandBatch(tooLarge), { code: "TOO_LARGE" });
});

test("decoder rejects invalid UTF-8, malformed, non-canonical, and non-object documents", () => {
  assert.throws(() => decodeCommandBatch(new Uint8Array([0xff])), { code: "INVALID_BATCH" });
  assert.throws(() => decodeCommandBatch(new TextEncoder().encode("{")), { code: "INVALID_BATCH" });
  assert.throws(() => decodeCommandBatch(new TextEncoder().encode("[]")), { code: "INVALID_BATCH" });

  const nonCanonical = JSON.stringify(commandBatch());
  assert.throws(() => decodeCommandBatch(new TextEncoder().encode(nonCanonical)), { code: "INVALID_BATCH" });
});

test("message guard binds expected session, peers, kind, and exact sequence", () => {
  const message = {
    protocol: "karma-ble/1",
    sessionId: "session-a",
    senderDeviceId: "device-a",
    recipientDeviceId: "device-b",
    sequence: 3,
    messageId: "message-3",
    kind: "COMMAND_BATCH",
    body: { commandBatch: commandBatch() },
  };
  assert.equal(validateProtocolMessage(message, {
    sessionId: "session-a",
    senderDeviceId: "device-a",
    recipientDeviceId: "device-b",
    sequence: 3,
  }), true);
  assert.throws(() => validateProtocolMessage(message, { sequence: 3 + 1 }), { code: "REPLAY_OR_ORDER" });
  assert.throws(() => validateProtocolMessage({ ...message, senderDeviceId: "unpaired" }, { senderDeviceId: "device-a" }), { code: "AUTH_FAILED" });
  assert.throws(() => validateProtocolMessage({ ...message, sessionId: "old-session" }, { sessionId: "session-a" }), { code: "REPLAY_OR_ORDER" });
  assert.equal(assertExpectedSequence(4, 4), 5);
  assert.throws(() => assertExpectedSequence(4, 3), { code: "REPLAY_OR_ORDER" });
});

test("message schemas reject invalid ACK and unsupported protocol versions", () => {
  const ack = {
    protocol: "karma-ble/1",
    sessionId: "session-a",
    senderDeviceId: "device-a",
    recipientDeviceId: "device-b",
    sequence: 0,
    messageId: "message-0",
    kind: "ACK",
    body: { commandId: "command-1", contentDigest: "sha256:test", result: "accepted" },
  };
  assert.throws(() => validateProtocolMessage(ack), { code: "INVALID_BATCH" });
  assert.throws(() => validateProtocolMessage({ ...ack, protocol: "karma-ble/2" }), { code: "UNSUPPORTED_VERSION" });
});

function commandBatch() {
  const common = {
    commandId: "command-1",
    aggregateId: "order-1",
    actorId: "actor-1",
    deviceId: "device-1",
    occurredAt: "2026-09-29T12:00:00.000Z",
    schemaVersion: 1,
  };
  return {
    ...common,
    events: [
      { ...common, eventId: "event-1", type: "OrderOpened", payload: { orderNameSnapshot: "Mesa 4" } },
      { ...common, eventId: "event-2", type: "LineAdded", payload: { lineId: "line-1", lineNameSnapshot: "Latte chai" } },
    ],
  };
}
