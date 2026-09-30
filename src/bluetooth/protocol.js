import { validateEvent } from "../domain/order-domain.js";

export const BLUETOOTH_PROTOCOL = "karma-ble/1";
export const MAX_COMMAND_BYTES = 64 * 1024;
export const MAX_EVENTS_PER_COMMAND = 100;
export const MAX_MESSAGE_BYTES = MAX_COMMAND_BYTES + 4096;

const messageKinds = new Set(["HELLO", "COMMAND_BATCH", "ACK", "ERROR"]);
const ackResults = new Set(["committed", "duplicate", "conflict"]);
const errorCodes = new Set([
  "UNSUPPORTED_VERSION", "UNSUPPORTED_SCHEMA", "PAIRING_REQUIRED", "PAIRING_REJECTED",
  "AUTH_FAILED", "REPLAY_OR_ORDER", "INVALID_BATCH", "TOO_LARGE", "CONFLICT",
  "COORDINATOR_CONFLICT", "PERMISSION_REQUIRED", "BLUETOOTH_UNAVAILABLE",
  "DISCONNECTED", "STORAGE_FAILED", "BACKEND_PENDING", "BACKEND_CONFLICT",
]);

/** Validate the full EVL-113 immutable command-batch envelope before encoding or applying. */
export function validateCommandBatch(batch) {
  requireObject(batch, "command batch");
  for (const field of ["commandId", "aggregateId", "actorId", "deviceId", "occurredAt"]) {
    requireNonEmptyString(batch[field], field);
  }
  requireSchemaVersion(batch.schemaVersion, "batch schemaVersion");
  if (Number.isNaN(Date.parse(batch.occurredAt))) throw protocolError("INVALID_BATCH", "occurredAt must be an ISO-compatible timestamp");
  if (!Array.isArray(batch.events) || batch.events.length === 0) throw protocolError("INVALID_BATCH", "events must be a non-empty array");
  if (batch.events.length > MAX_EVENTS_PER_COMMAND) throw protocolError("TOO_LARGE", `a command may contain at most ${MAX_EVENTS_PER_COMMAND} events`);

  const eventIds = new Set();
  for (const event of batch.events) {
    try {
      validateEvent(event);
    } catch (error) {
      throw protocolError("INVALID_BATCH", error.message);
    }
    if (event.schemaVersion !== 1 || batch.schemaVersion !== 1) {
      throw protocolError("UNSUPPORTED_SCHEMA", `domain schema ${event.schemaVersion} is not supported by karma-ble/1`);
    }
    for (const field of ["commandId", "aggregateId", "actorId", "deviceId", "occurredAt", "schemaVersion"]) {
      if (event[field] !== batch[field]) throw protocolError("INVALID_BATCH", `event ${field} must match the command-batch metadata`);
    }
    if (eventIds.has(event.eventId)) throw protocolError("INVALID_BATCH", `duplicate eventId: ${event.eventId}`);
    eventIds.add(event.eventId);
  }
  assertJsonValue(batch, new Set());
  const bytes = utf8Encode(canonicalJson(batch));
  if (bytes.byteLength > MAX_COMMAND_BYTES) throw protocolError("TOO_LARGE", `canonical command exceeds ${MAX_COMMAND_BYTES} bytes`);
  return true;
}

/** Return deterministic UTF-8 JSON bytes; cryptographic digest/encryption are handled by native integration. */
export function encodeCommandBatch(batch) {
  validateCommandBatch(batch);
  return utf8Encode(canonicalJson(batch));
}

/** Decode only canonical, bounded JSON and validate the complete domain command before returning it. */
export function decodeCommandBatch(bytes) {
  requireBytes(bytes, MAX_COMMAND_BYTES, "command batch");
  let batch;
  try {
    batch = JSON.parse(utf8Decode(bytes));
  } catch (error) {
    throw protocolError("INVALID_BATCH", `command batch is not valid UTF-8 JSON: ${error.message}`);
  }
  validateCommandBatch(batch);
  if (!bytesEqual(bytes, utf8Encode(canonicalJson(batch)))) {
    throw protocolError("INVALID_BATCH", "command batch JSON must use the canonical encoding");
  }
  return batch;
}

/** Validate message shape and optionally bind it to the current authenticated session/sequence. */
export function validateProtocolMessage(message, expected = {}) {
  requireObject(message, "protocol message");
  if (message.protocol !== BLUETOOTH_PROTOCOL) throw protocolError("UNSUPPORTED_VERSION", `expected ${BLUETOOTH_PROTOCOL}`);
  for (const field of ["sessionId", "senderDeviceId", "recipientDeviceId", "messageId"]) requireNonEmptyString(message[field], field);
  if (!Number.isSafeInteger(message.sequence) || message.sequence < 0) throw protocolError("REPLAY_OR_ORDER", "sequence must be a non-negative safe integer");
  if (!messageKinds.has(message.kind)) throw protocolError("INVALID_BATCH", `unknown message kind: ${message.kind}`);
  if (expected.sessionId !== undefined && message.sessionId !== expected.sessionId) throw protocolError("REPLAY_OR_ORDER", "message belongs to a different session");
  if (expected.senderDeviceId !== undefined && message.senderDeviceId !== expected.senderDeviceId) throw protocolError("AUTH_FAILED", "sender does not match the authenticated peer");
  if (expected.recipientDeviceId !== undefined && message.recipientDeviceId !== expected.recipientDeviceId) throw protocolError("AUTH_FAILED", "recipient does not match this device");
  if (expected.sequence !== undefined && message.sequence !== expected.sequence) throw protocolError("REPLAY_OR_ORDER", "message sequence is repeated, skipped, or out of order");

  requireObject(message.body, "message body");
  if (message.kind === "HELLO") {
    requireNonEmptyString(message.body.branchId, "branchId");
    requireNonEmptyString(message.body.coordinatorDeviceId, "coordinatorDeviceId");
    requireNonEmptyString(message.body.coordinatorEpoch, "coordinatorEpoch");
    if (!Array.isArray(message.body.supportedVersions) || !message.body.supportedVersions.includes(BLUETOOTH_PROTOCOL)) {
      throw protocolError("UNSUPPORTED_VERSION", "HELLO must list a supported karma-ble protocol version");
    }
  } else if (message.kind === "COMMAND_BATCH") {
    validateCommandBatch(message.body.commandBatch);
  } else if (message.kind === "ACK") {
    requireNonEmptyString(message.body.commandId, "commandId");
    requireNonEmptyString(message.body.contentDigest, "contentDigest");
    if (!ackResults.has(message.body.result)) throw protocolError("INVALID_BATCH", "ACK result is invalid");
  } else if (message.kind === "ERROR") {
    if (!errorCodes.has(message.body.code)) throw protocolError("INVALID_BATCH", "ERROR code is unknown");
    if (typeof message.body.retryable !== "boolean") throw protocolError("INVALID_BATCH", "ERROR retryable must be boolean");
  }
  assertJsonValue(message, new Set());
  if (utf8Encode(canonicalJson(message)).byteLength > MAX_MESSAGE_BYTES) throw protocolError("TOO_LARGE", "protocol message exceeds maximum size");
  return true;
}

/** Pure sequence guard for one authenticated direction. Call only after AEAD authentication. */
export function assertExpectedSequence(expectedSequence, receivedSequence) {
  if (!Number.isSafeInteger(expectedSequence) || expectedSequence < 0) throw new TypeError("expectedSequence must be a non-negative safe integer");
  if (receivedSequence !== expectedSequence) throw protocolError("REPLAY_OR_ORDER", `expected sequence ${expectedSequence}, received ${receivedSequence}`);
  return expectedSequence + 1;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertJsonValue(value, ancestors) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw protocolError("INVALID_BATCH", "JSON numbers must be finite");
    return;
  }
  if (typeof value !== "object") throw protocolError("INVALID_BATCH", "command contains a non-JSON value");
  if (ancestors.has(value)) throw protocolError("INVALID_BATCH", "command contains a circular value");
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw protocolError("INVALID_BATCH", "command objects must be plain JSON objects");
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => assertJsonValue(item, ancestors));
  } else {
    for (const key of Object.keys(value)) assertJsonValue(value[key], ancestors);
  }
  ancestors.delete(value);
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw protocolError("INVALID_BATCH", `${label} must be an object`);
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw protocolError("INVALID_BATCH", `${label} is required`);
}

function requireSchemaVersion(value, label) {
  if (!Number.isInteger(value) || value < 1) throw protocolError("INVALID_BATCH", `${label} must be a positive integer`);
}

function requireBytes(value, maximum, label) {
  if (!(value instanceof Uint8Array)) throw protocolError("INVALID_BATCH", `${label} must be UTF-8 bytes`);
  if (value.byteLength > maximum) throw protocolError("TOO_LARGE", `${label} exceeds ${maximum} bytes`);
}

function utf8Encode(value) {
  return new TextEncoder().encode(value);
}

function utf8Decode(bytes) {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function bytesEqual(left, right) {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function protocolError(code, message) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}
