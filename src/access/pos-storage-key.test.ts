import assert from "node:assert/strict";
import test from "node:test";
import { posAccessStorageKey } from "./pos-storage-key";

test("secure POS storage is isolated by branch and device and separate from the demo", () => {
  const first = posAccessStorageKey("secure", "centro", "register-1");
  assert.notEqual(first, posAccessStorageKey("secure", "sur", "register-1"));
  assert.notEqual(first, posAccessStorageKey("secure", "centro", "register-2"));
  assert.equal(posAccessStorageKey("demo"), "karma-pos-v1");
  assert.notEqual(first, posAccessStorageKey("demo"));
});

test("storage scope escapes branch and device delimiters", () => {
  assert.notEqual(
    posAccessStorageKey("secure", "a:b", "c"),
    posAccessStorageKey("secure", "a", "b:c"),
  );
});
