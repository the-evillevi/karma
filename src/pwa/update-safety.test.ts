import test from "node:test";
import assert from "node:assert/strict";
import {
  canActivateUpdate,
  getUpdateSafety,
  getUpdateSafetyRevision,
  reportUpdateSafety,
  subscribeToUpdateSafety,
  type UpdateSafetySnapshot,
  unknownUpdateSafety,
} from "./update-safety.ts";
import { activateWaitingWorker } from "./update-worker.ts";

test("update activation requires safe app state and an explicit operator confirmation", () => {
  assert.equal(canActivateUpdate(unknownUpdateSafety, true), false);
  assert.equal(
    canActivateUpdate({ status: "blocked", reason: "checkout" }, true),
    false,
  );
  assert.equal(canActivateUpdate({ status: "safe", reason: "" }, false), false);
  assert.equal(canActivateUpdate({ status: "safe", reason: "" }, true), true);
});

test("app safety updates notify subscribers and return to the closed-state gate on unmount", () => {
  let notifications = 0;
  const unsubscribe = subscribeToUpdateSafety(() => notifications++);
  reportUpdateSafety({
    status: "blocked",
    reason: "Hay una cuenta sin guardar.",
  });
  assert.equal(getUpdateSafety().status, "blocked");
  assert.equal(notifications, 1);
  unsubscribe();
  const revision = getUpdateSafetyRevision();
  reportUpdateSafety(unknownUpdateSafety);
  assert.equal(notifications, 1);
  assert.equal(getUpdateSafetyRevision(), revision + 1);
});

test("waiting worker activation refuses unsafe state and invalidates confirmation after any safety transition", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { setTimeout, clearTimeout },
  });
  try {
    reportUpdateSafety({ status: "safe", reason: "" });
    let safety: UpdateSafetySnapshot = { status: "safe", reason: "" };
    let messages = 0;
    const worker = new EventTarget() as ServiceWorker & {
      state: string;
      postMessage: () => void;
    };
    worker.state = "installed";
    worker.postMessage = () => {
      messages += 1;
      worker.state = "activated";
      reportUpdateSafety({ status: "blocked", reason: "Se abrió un cobro." });
      reportUpdateSafety({ status: "safe", reason: "" });
      safety = { status: "safe", reason: "" };
      worker.dispatchEvent(new Event("statechange"));
    };
    const registration = {
      waiting: worker,
    } as unknown as ServiceWorkerRegistration;

    const staleConfirmationRevision = getUpdateSafetyRevision();
    reportUpdateSafety({
      status: "blocked",
      reason: "Hay una captura abierta.",
    });
    reportUpdateSafety({ status: "safe", reason: "" });
    await assert.rejects(
      activateWaitingWorker(
        registration,
        { status: "safe", reason: "" },
        true,
        () => safety,
        staleConfirmationRevision,
      ),
      /not confirmed safe/,
    );
    assert.equal(messages, 0);
    await assert.rejects(
      activateWaitingWorker(registration, safety, false, () => safety),
      /not confirmed safe/,
    );
    assert.equal(messages, 0);
    const mayReload = await activateWaitingWorker(
      registration,
      { status: "safe", reason: "" },
      true,
      () => safety,
    );
    assert.equal(messages, 1);
    assert.equal(mayReload, false);
  } finally {
    if (originalWindow)
      Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
