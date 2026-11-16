// Vitest setup. Unmounts React trees between UI tests; domain tests run in the
// node environment and skip it, so the fast loop stays fast.
import { afterEach } from "vitest";

if (typeof document !== "undefined") {
  // Newer Node versions define their own (unconfigured) `localStorage` global,
  // which hides jsdom's. Point it back at the jsdom window's storage.
  const jsdomWindow = (globalThis as { jsdom?: { window: Window } }).jsdom
    ?.window;
  if (jsdomWindow && globalThis.localStorage !== jsdomWindow.localStorage) {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: jsdomWindow.localStorage,
    });
  }

  const { cleanup } = await import("@testing-library/react");
  afterEach(() => cleanup());
}
