import { afterEach } from "vitest";

if (typeof document !== "undefined") {
  const jsdomWindow = (globalThis as { jsdom?: { window: Window } }).jsdom
    ?.window;
  if (jsdomWindow && globalThis.localStorage !== jsdomWindow.localStorage) {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: jsdomWindow.localStorage,
    });
  }

  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  const { cleanup } = await import("@testing-library/react");
  afterEach(() => cleanup());
}
